use axum::{
    extract::Query,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};
use tokio::net::UdpSocket;

const MULTICAST_ADDR: &str = "224.0.0.167:53317";
const MULTICAST_GROUP: &str = "224.0.0.167";
const TRANSFER_PORT: u16 = 53317;
const ANNOUNCE_SECS: u64 = 3;
const STALE_SECS: u64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DeviceInfo {
    alias: String,
    device_type: String,
    fingerprint: String,
    port: u16,
    #[serde(skip)]
    last_seen: std::time::Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Device {
    id: String,
    name: String,
    device_type: String,
    ip: String,
    port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrepareRequest {
    files: Vec<FileMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FileMeta {
    name: String,
    size: u64,
    mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrepareResponse {
    session_id: String,
    files: Vec<RemoteFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteFile {
    id: String,
    token: String,
    name: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct UploadParams {
    session_id: String,
    file_id: String,
    token: String,
}

struct AppState {
    devices: Arc<Mutex<HashMap<String, DeviceInfo>>>,
    device_info: DeviceInfo,
    sessions: Arc<Mutex<HashMap<String, SessionState>>>,
    receive_path: PathBuf,
}

struct SessionState {
    total_files: usize,
    completed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DeviceFile {
    name: String,
    size: u64,
    mime_type: String,
    path: String,
}

#[tauri::command]
fn get_local_info(state: State<AppState>) -> Device {
    let info = &state.device_info;
    Device {
        id: info.fingerprint.clone(),
        name: info.alias.clone(),
        device_type: info.device_type.clone(),
        ip: local_ip_address(),
        port: info.port,
    }
}

#[tauri::command]
async fn send_files(
    app: tauri::AppHandle,
    target_ip: String,
    target_port: u16,
    files: Vec<DeviceFile>,
) -> Result<String, String> {
    let port = if target_port > 0 { target_port } else { TRANSFER_PORT };

    let metas: Vec<FileMeta> = files
        .iter()
        .map(|f| FileMeta {
            name: f.name.clone(),
            size: f.size,
            mime_type: f.mime_type.clone(),
        })
        .collect();

    let client = reqwest::Client::new();

    let prepare = PrepareRequest { files: metas };
    let resp: PrepareResponse = client
        .post(format!("http://{}:{}/api/prepare-upload", target_ip, port))
        .json(&prepare)
        .send()
        .await
        .map_err(|e| format!("prepare failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("parse failed: {}", e))?;

    for (i, file) in files.iter().enumerate() {
        if i >= resp.files.len() {
            break;
        }
        let rf = &resp.files[i];
        let data =
            std::fs::read(&file.path).map_err(|e| format!("read failed: {}", e))?;

        client
            .post(format!(
                "http://{}:{}/api/upload?session_id={}&file_id={}&token={}",
                target_ip, port, resp.session_id, rf.id, rf.token
            ))
            .body(data)
            .send()
            .await
            .map_err(|e| format!("upload failed: {}", e))?;

        app.emit(
            "transfer:progress",
            serde_json::json!({
                "progress": ((i + 1) as f64 / files.len() as f64 * 100.0) as u32,
                "name": file.name,
                "direction": "sending",
                "bytes": file.size,
            }),
        )
        .ok();
    }

    app.emit("transfer:complete", serde_json::json!({"status": "done"})).ok();
    Ok("ok".into())
}

fn start_discovery(
    app: tauri::AppHandle,
    devices: Arc<Mutex<HashMap<String, DeviceInfo>>>,
    device_info: DeviceInfo,
) {
    tokio::spawn(async move {
        let sock = match UdpSocket::bind(format!("0.0.0.0:{}", TRANSFER_PORT)).await {
            Ok(s) => s,
            Err(e) => {
                log::error!("Failed to bind UDP: {}", e);
                return;
            }
        };
        if let Err(e) = sock.join_multicast_v4(
            MULTICAST_GROUP.parse::<Ipv4Addr>().unwrap(),
            Ipv4Addr::UNSPECIFIED,
        ) {
            log::error!("Failed to join multicast: {}", e);
            return;
        }
        sock.set_multicast_ttl_v4(2).ok();

        let announce = serde_json::json!({
            "alias": device_info.alias,
            "deviceType": device_info.device_type,
            "fingerprint": device_info.fingerprint,
            "port": device_info.port,
            "protocol": "http"
        })
        .to_string();

        loop {
            sock.send_to(announce.as_bytes(), MULTICAST_ADDR).await.ok();

            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            let mut buf = [0u8; 2048];
            while let Ok((len, src)) = sock.try_recv_from(&mut buf) {
                if let Ok(msg) = String::from_utf8(buf[..len].to_vec()) {
                    if let Ok(peer) = serde_json::from_str::<serde_json::Value>(&msg) {
                        let fp = peer["fingerprint"].as_str().unwrap_or("");
                        if !fp.is_empty() && fp != device_info.fingerprint {
                            let mut map = devices.lock().unwrap();
                            let was_new = !map.contains_key(fp);
                            map.insert(fp.to_string(), DeviceInfo {
                                alias: peer["alias"].as_str().unwrap_or("Unknown").to_string(),
                                device_type: peer["deviceType"].as_str().unwrap_or("desktop").to_string(),
                                fingerprint: fp.to_string(),
                                port: peer["port"].as_u64().unwrap_or(TRANSFER_PORT as u64) as u16,
                                last_seen: std::time::Instant::now(),
                            });
                            if was_new {
                                app.emit("discovery:device-found", Device {
                                    id: fp.to_string(),
                                    name: peer["alias"].as_str().unwrap_or("Unknown").to_string(),
                                    device_type: peer["deviceType"].as_str().unwrap_or("desktop").to_string(),
                                    ip: src.ip().to_string(),
                                    port: peer["port"].as_u64().unwrap_or(TRANSFER_PORT as u64) as u16,
                                }).ok();
                            }
                        }
                    }
                }
            }

            {
                let mut map = devices.lock().unwrap();
                let stale: Vec<String> = map
                    .iter()
                    .filter(|(_, d)| d.last_seen.elapsed() > std::time::Duration::from_secs(STALE_SECS))
                    .map(|(k, _)| k.clone())
                    .collect();
                for fp in stale {
                    map.remove(&fp);
                    app.emit("discovery:device-lost", &fp).ok();
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(ANNOUNCE_SECS)).await;
        }
    });
}

fn start_transfer_server(
    sessions: Arc<Mutex<HashMap<String, SessionState>>>,
    receive_path: PathBuf,
) {
    tokio::spawn(async move {
        let srv_sessions = sessions.clone();
        let srv_path = receive_path.clone();

        let router = Router::new()
            .route("/api/info", get(handle_info))
            .route("/api/prepare-upload", post({
                let s = srv_sessions.clone();
                move |body| handle_prepare_upload(s.clone(), body)
            }))
            .route("/api/upload", post({
                let s = srv_sessions.clone();
                let p = srv_path.clone();
                move |query, body| handle_upload(s.clone(), p.clone(), query, body)
            }))
            .layer(tower_http::cors::CorsLayer::permissive());

        let listener = match tokio::net::TcpListener::bind("0.0.0.0:53317").await {
            Ok(l) => l,
            Err(e) => {
                log::error!("Failed to bind HTTP server: {}", e);
                return;
            }
        };
        axum::serve(listener, router).await.unwrap();
    });
}

async fn handle_info() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "alias": "GlassShare",
        "deviceType": "desktop",
        "version": "1.0"
    }))
}

async fn handle_prepare_upload(
    sessions: Arc<Mutex<HashMap<String, SessionState>>>,
    axum::Json(payload): axum::Json<PrepareRequest>,
) -> Result<Json<PrepareResponse>, StatusCode> {
    let mut rng = rand::rng();
    let session_id: String = std::iter::repeat_with(|| {
        let c: u8 = rng.random_range(b'a'..=b'z');
        c as char
    })
    .take(8)
    .collect();

    let files: Vec<RemoteFile> = payload
        .files
        .iter()
        .map(|f| {
            let id: String = std::iter::repeat_with(|| {
                let c: u8 = rng.random_range(b'a'..=b'z');
                c as char
            })
            .take(6)
            .collect();
            let token: String = std::iter::repeat_with(|| {
                let c: u8 = rng.random_range(b'a'..=b'z');
                c as char
            })
            .take(8)
            .collect();
            RemoteFile {
                id,
                token,
                name: f.name.clone(),
                size: f.size,
            }
        })
        .collect();

    sessions.lock().unwrap().insert(
        session_id.clone(),
        SessionState {
            total_files: files.len(),
            completed: 0,
        },
    );

    Ok(Json(PrepareResponse { session_id, files }))
}

async fn handle_upload(
    sessions: Arc<Mutex<HashMap<String, SessionState>>>,
    receive_path: PathBuf,
    Query(params): Query<UploadParams>,
    body: axum::body::Bytes,
) -> StatusCode {
    let mut session = sessions.lock().unwrap();
    let session_state = match session.get_mut(&params.session_id) {
        Some(s) => s,
        None => return StatusCode::NOT_FOUND,
    };

    std::fs::create_dir_all(&receive_path).ok();
    let file_path = receive_path.join(&params.file_id);
    tokio::fs::write(&file_path, &body).await.ok();

    session_state.completed += 1;
    if session_state.completed >= session_state.total_files {
        session.remove(&params.session_id);
    }

    StatusCode::OK
}

fn local_ip_address() -> String {
    for iface in pnet::datalink::interfaces() {
        if iface.is_up() && !iface.is_loopback() {
            for ip in iface.ips {
                if ip.ip().is_ipv4() {
                    return ip.ip().to_string();
                }
            }
        }
    }
    "127.0.0.1".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let devices: Arc<Mutex<HashMap<String, DeviceInfo>>> = Arc::new(Mutex::new(HashMap::new()));
    let sessions: Arc<Mutex<HashMap<String, SessionState>>> = Arc::new(Mutex::new(HashMap::new()));
    let mut rng = rand::rng();
    let fingerprint = format!("{:016x}", rng.random::<u64>());

    let device_info = DeviceInfo {
        alias: format!("Linux-{}", rng.random_range(100..999)),
        device_type: "desktop".to_string(),
        fingerprint: fingerprint.clone(),
        port: TRANSFER_PORT,
        last_seen: std::time::Instant::now(),
    };

    let receive_path = dirs::download_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("GlassShare");

    tauri::Builder::default()
        .manage(AppState {
            devices: devices.clone(),
            device_info: device_info.clone(),
            sessions: sessions.clone(),
            receive_path: receive_path.clone(),
        })
        .invoke_handler(tauri::generate_handler![get_local_info, send_files])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let handle = app.handle().clone();
            start_discovery(handle, devices.clone(), device_info.clone());
            start_transfer_server(sessions.clone(), receive_path.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
