# GlassShare - Local File Sharing

GlassShare is a native Linux desktop + Android app for fast, peer-to-peer file sharing over your local network. No internet required. No central server. Devices discover each other automatically via UDP multicast and transfer files over HTTP — similar to LocalSend.

## Features

- **Zero-config discovery**: Devices appear automatically via UDP multicast (no QR scanning needed on LAN)
- **Direct HTTP transfers**: Files go device-to-device, no middleman, no data limits
- **Automatic receive**: Incoming files land in `~/Downloads/GlassShare/`
- **No server required**: Only the local network — works fully offline
- **Dark glassmorphism UI**: Purple/cyan accents, right-side panel layout
- **Cross-platform**: Native Linux + Web + Android (same UI, different backends)

## Architecture

```
glassshare/
├── src/
│   ├── main.js          (App state orchestrator — shared UI)
│   ├── style.css        (Dark theme CSS)
│   ├── wakelock.js      (Screen Wake Lock utility)
│   └── qr.js            (QR code generator + camera scanner)
├── src-tauri/
│   ├── src/lib.rs       (Rust backend: UDP discovery + HTTP transfer server)
│   ├── Cargo.toml       (Rust dependencies)
│   └── tauri.conf.json  (Tauri desktop configuration)
├── android/
│   └── [Gradle]         (Capacitor native Android app)
├── public/
│   ├── app-icon.png
│   ├── manifest.json
│   └── sw.js
└── build/
    └── icon.png
```

### How it works

1. **Discovery**: Each device sends a UDP multicast heartbeat (`224.0.0.167:53317`) every 3 seconds. Other devices on the LAN hear it and appear in the peer list.
2. **Transfer**: When you select a file and target a peer, the sender POSTs file metadata to the receiver's HTTP server (running on port 53317), then streams the file data.
3. **No signaling server**: Everything happens directly between devices on your LAN.

## Linux Desktop (Tauri)

Build a native `.deb` or `.AppImage` (no Electron overhead — uses system WebKitGTK):

```bash
npm install
npm run app:build
```

Output lands in `src-tauri/target/release/bundle/`.

## Development

```bash
npm run dev          # Vite dev server at http://localhost:5173
npm run tauri dev    # Vite + Tauri window with hot reload
```

## Android (Capacitor)

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleRelease
# APK at android/app/build/outputs/apk/release/app-release-unsigned.apk
```

## Requirements

- **Linux**: `libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`, Rust toolchain
- **Android**: Android Studio, Android SDK 36+, Java 17+

## License

MIT
