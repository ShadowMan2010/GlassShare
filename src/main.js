import './style.css';
import { setupWakeLockControls, requestWakeLock, releaseWakeLock } from './wakelock.js';
import { generateQRCode, startQRScanner, stopQRScanner } from './qr.js';

const isTauri = '__TAURI__' in window;

let invoke, listen;
if (isTauri) {
  import('@tauri-apps/api/core').then(m => invoke = m.invoke);
  import('@tauri-apps/api/event').then(m => listen = m.listen);
}

const localDeviceNameEl = document.getElementById('local-device-name');
const localIpEl = document.getElementById('local-ip');
const connectionStatusEl = document.getElementById('connection-status');
const peersGridEl = document.getElementById('peers-grid');
const fileInputEl = document.getElementById('file-input');
const fileDropZoneEl = document.getElementById('file-drop-zone');
const selectedFilesListEl = document.getElementById('selected-files-list');
const receivedFilesListEl = document.getElementById('received-files-list');
const sendBtn = document.getElementById('send-btn');

const tabSendBtn = document.getElementById('tab-send');
const tabReceiveBtn = document.getElementById('tab-receive');
const sendPane = document.getElementById('send-pane');
const receivePane = document.getElementById('receive-pane');

const showQrBtn = document.getElementById('show-qr-btn');
const scanQrBtn = document.getElementById('scan-qr-btn');
const qrModal = document.getElementById('qr-modal');
const scannerModal = document.getElementById('scanner-modal');
const closeQrModalBtn = document.getElementById('close-qr-modal');
const closeScannerModalBtn = document.getElementById('close-scanner-modal');
const qrFallbackUrl = document.getElementById('qr-fallback-url');

let selectedFiles = [];
let targetPeerId = null;
let devices = [];
let localIP = window.location.hostname;
let localName = `Web-${Math.floor(100 + Math.random() * 900)}`;

document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  setupWakeLockControls();

  if (isTauri) {
    const { invoke: inv, listen: lis } = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event')
    ]);
    invoke = inv.invoke;
    listen = lis.listen;

    const info = await invoke('get_local_info');
    localIP = info.ip;
    localName = info.name;

    listen('discovery:device-found', (event) => {
      const d = event.payload;
      if (!devices.find(p => p.id === d.id)) {
        devices.push(d);
        renderPeerList();
      }
    });

    listen('discovery:device-lost', (event) => {
      devices = devices.filter(d => d.id !== event.payload);
      renderPeerList();
    });

    listen('transfer:progress', (event) => {
      const d = event.payload;
      handleFileProgress(d.progress, d.name, d.direction, d.bytes);
    });

    listen('transfer:received', (event) => {
      handleFileReceived(event.payload);
    });
  }

  localDeviceNameEl.textContent = localName;
  localIpEl.textContent = localIP;
  connectionStatusEl.textContent = 'Online';
  connectionStatusEl.className = 'stat-badge online';

  setupUIEventListeners();
  if (window.lucide) window.lucide.createIcons();
});

function renderPeerList() {
  peersGridEl.innerHTML = '';

  if (devices.length === 0) {
    peersGridEl.innerHTML = `<div class="no-peers"><i data-lucide="compass"></i><p>Scanning for devices...</p></div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  devices.forEach(peer => {
    const isSelected = peer.id === targetPeerId;
    const node = document.createElement('div');
    node.className = `peer-item ${isSelected ? 'selected' : ''}`;
    node.dataset.id = peer.id;
    const iconName = peer.device_type === 'mobile' ? 'smartphone' : 'monitor';
    node.innerHTML = `<i data-lucide="${iconName}"></i><div><div class="name">${peer.name}</div><div class="type">${peer.device_type === 'mobile' ? 'Mobile' : 'Desktop'}</div></div>`;
    node.addEventListener('click', () => {
      if (isSelected) {
        targetPeerId = null;
        node.classList.remove('selected');
        sendBtn.classList.add('disabled-btn');
        sendBtn.disabled = true;
      } else {
        targetPeerId = peer.id;
        document.querySelectorAll('.peer-item').forEach(n => n.classList.remove('selected'));
        node.classList.add('selected');
        sendBtn.classList.remove('disabled-btn');
        sendBtn.disabled = false;
      }
    });
    peersGridEl.appendChild(node);
  });

  if (window.lucide) window.lucide.createIcons();
}

function setupUIEventListeners() {
  tabSendBtn.addEventListener('click', () => {
    tabSendBtn.classList.add('active');
    tabReceiveBtn.classList.remove('active');
    sendPane.classList.add('active');
    receivePane.classList.remove('active');
  });

  tabReceiveBtn.addEventListener('click', () => {
    tabReceiveBtn.classList.add('active');
    tabSendBtn.classList.remove('active');
    receivePane.classList.add('active');
    sendPane.classList.remove('active');
  });

  showQrBtn.addEventListener('click', () => {
    qrModal.classList.remove('hidden');
    const payload = JSON.stringify({ server: localIP, type: 'glassshare-peer' });
    generateQRCode('qr-code-display', payload);
    qrFallbackUrl.textContent = `IP: ${localIP}`;
  });

  closeQrModalBtn.addEventListener('click', () => qrModal.classList.add('hidden'));

  scanQrBtn.addEventListener('click', () => {
    scannerModal.classList.remove('hidden');
    startQRScanner(handleScannedPayload);
  });

  closeScannerModalBtn.addEventListener('click', () => {
    scannerModal.classList.add('hidden');
    stopQRScanner();
  });

  fileDropZoneEl.addEventListener('click', () => fileInputEl.click());
  fileDropZoneEl.addEventListener('dragover', (e) => { e.preventDefault(); fileDropZoneEl.classList.add('dragover'); });
  fileDropZoneEl.addEventListener('dragleave', () => { fileDropZoneEl.classList.remove('dragover'); });
  fileDropZoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDropZoneEl.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFilesSelected(e.dataTransfer.files);
  });

  fileInputEl.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFilesSelected(e.target.files);
  });

  sendBtn.addEventListener('click', () => {
    if (selectedFiles.length > 0 && targetPeerId) {
      const peer = devices.find(d => d.id === targetPeerId);
      if (!peer) return;
      if (isTauri && invoke) {
        const fileInfos = selectedFiles.map(f => ({
          name: f.name, size: f.size, mime_type: f.type || 'application/octet-stream', path: f.path || f.name
        }));
        invoke('send_files', { targetIp: peer.ip, targetPort: peer.port, files: fileInfos });
      }
    }
  });
}

function handleScannedPayload(payload) {
  try {
    const config = JSON.parse(payload);
    if (config.type === 'glassshare-peer' && config.server) {
      const id = `manual-${config.server}`;
      if (!devices.find(d => d.id === id)) {
        devices.push({ id, name: config.name || `Device (${config.server})`, device_type: 'unknown', ip: config.server, port: 53317 });
        renderPeerList();
      }
    }
  } catch (err) { console.error('Invalid QR payload'); }
}

function handleFilesSelected(filesList) {
  selectedFiles = Array.from(filesList);
  selectedFilesListEl.innerHTML = '';
  selectedFilesListEl.classList.remove('hidden');
  selectedFiles.forEach((file, index) => {
    const row = document.createElement('div');
    row.className = 'file-row';
    let icon = 'file';
    if (file.type.startsWith('image/')) icon = 'image';
    else if (file.type.startsWith('video/')) icon = 'video';
    else if (file.type.startsWith('audio/')) icon = 'music';
    row.innerHTML = `<i data-lucide="${icon}"></i><div class="info"><div class="name">${file.name}</div><div class="meta">${formatBytes(file.size)}</div></div><button class="remove" data-index="${index}"><i data-lucide="x"></i></button>`;
    row.querySelector('.remove').addEventListener('click', (e) => { e.stopPropagation(); selectedFiles.splice(index, 1); handleFilesSelected(selectedFiles); });
    selectedFilesListEl.appendChild(row);
  });
  if (selectedFiles.length === 0) selectedFilesListEl.classList.add('hidden');
  sendBtn.disabled = !(selectedFiles.length > 0 && targetPeerId);
  sendBtn.classList.toggle('disabled-btn', sendBtn.disabled);
  if (window.lucide) window.lucide.createIcons();
}

function handleFileProgress(percent, filename, direction, bytesTransferred) {
  const isSending = direction === 'sending';
  const container = document.getElementById(isSending ? 'send-pane' : 'received-files-list');
  if (!container) return;
  let item = document.getElementById(`progress-${filename}`);
  if (!item) {
    item = document.createElement('div');
    item.className = 'transfer-item';
    item.id = `progress-${filename}`;
    item.innerHTML = `<div class="transfer-head"><span class="title">${isSending ? 'Sending' : 'Receiving'}: ${filename}</span><span class="pct" id="pct-${filename}">0%</span></div><div class="progress-bg"><div class="progress-fill" id="bar-${filename}" style="width:0%"></div></div><div class="transfer-meta"><span>Transferring...</span><span id="size-${filename}">${formatBytes(bytesTransferred)}</span></div>`;
    if (isSending) { container.insertBefore(item, sendBtn); }
    else { const empty = container.querySelector('.empty-files'); if (empty) empty.remove(); container.insertBefore(item, container.firstChild); }
  } else {
    const pctEl = document.getElementById(`pct-${filename}`);
    const barEl = document.getElementById(`bar-${filename}`);
    const sizeEl = document.getElementById(`size-${filename}`);
    if (pctEl) pctEl.textContent = `${Math.floor(percent)}%`;
    if (barEl) barEl.style.width = `${percent}%`;
    if (sizeEl) sizeEl.textContent = `${formatBytes(bytesTransferred)}`;
    if (percent >= 100) {
      const meta = item.querySelector('.transfer-meta');
      if (meta) meta.innerHTML = `<span class="success">Transfer Complete</span><span>Done</span>`;
      setTimeout(() => item.remove(), 5000);
    }
  }
}

function handleFileReceived(file) {
  const container = document.getElementById('received-files-list');
  if (!container) return;
  const emptyMsg = container.querySelector('.empty-files');
  if (emptyMsg) emptyMsg.remove();
  const node = document.createElement('div');
  node.className = 'file-row';
  node.innerHTML = `<i data-lucide="file-check" style="color:var(--success)"></i><div class="info"><div class="name">${file.name}</div><div class="meta">${formatBytes(file.size)} &bull; Complete</div></div>`;
  container.insertBefore(node, container.firstChild);
  if (window.lucide) window.lucide.createIcons();
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
