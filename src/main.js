import './style.css';
import { setupWakeLockControls, requestWakeLock, releaseWakeLock } from './wakelock.js';
import { generateQRCode, startQRScanner, stopQRScanner } from './qr.js';
import * as WebRTC from './webrtc.js';

const localDeviceNameEl = document.getElementById('local-device-name');
const connectionStatusEl = document.getElementById('connection-status');
const peersGridEl = document.getElementById('peers-grid');
const fileInputEl = document.getElementById('file-input');
const fileDropZoneEl = document.getElementById('file-drop-zone');
const selectedFilesListEl = document.getElementById('selected-files-list');
const receivedFilesListEl = document.getElementById('received-files-list');
const sendBtn = document.getElementById('send-btn');

const modeLocalBtn = document.getElementById('mode-local-btn');
const modeRemoteBtn = document.getElementById('mode-remote-btn');
const modeDescEl = document.getElementById('mode-desc');
const ipContainer = document.getElementById('signaling-server-ip-container');
const roomCodeContainer = document.getElementById('room-code-container');

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
let roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
let signalingPort = '8080';
let signalingServerIp = window.location.hostname;
let lastProgressTime = 0;
let lastProgressBytes = 0;

document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  setupWakeLockControls();

  localDeviceNameEl.textContent = WebRTC.localName;
  document.getElementById('room-code').value = roomCode;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultSignalingUrl = `${protocol}//${signalingServerIp}:${signalingPort}`;
  document.getElementById('signaling-server-ip').value = signalingServerIp;
  WebRTC.connectSignaling(defaultSignalingUrl);

  WebRTC.registerCallbacks({
    onPeerListUpdate: renderPeerList,
    onConnectionStateChange: handleConnectionStateChange,
    onFileProgress: handleFileProgress,
    onFileReceived: handleFileReceived,
    onSocketStatusChange: handleSocketStatusChange
  });

  setupUIEventListeners();

  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function setupUIEventListeners() {
  modeLocalBtn.addEventListener('click', () => switchMode('local'));
  modeRemoteBtn.addEventListener('click', () => switchMode('remote'));

  document.getElementById('connect-server-btn').addEventListener('click', () => {
    const ip = document.getElementById('signaling-server-ip').value.trim();
    if (ip) {
      signalingServerIp = ip;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      WebRTC.connectSignaling(`${protocol}//${ip}:${signalingPort}`);
    }
  });

  document.getElementById('join-room-btn').addEventListener('click', () => {
    const code = document.getElementById('room-code').value.trim().toUpperCase();
    if (code && WebRTC.socket && WebRTC.socket.readyState === WebSocket.OPEN) {
      roomCode = code;
      WebRTC.socket.send(JSON.stringify({ type: 'join-room', room: code }));
    }
  });

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
    const pairingPayload = JSON.stringify({
      server: signalingServerIp,
      room: roomCode,
      mode: WebRTC.connectionMode
    });
    generateQRCode('qr-code-display', pairingPayload);
    qrFallbackUrl.textContent = `Server: ${signalingServerIp} | Room: ${roomCode}`;
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

  fileDropZoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileDropZoneEl.classList.add('dragover');
  });

  fileDropZoneEl.addEventListener('dragleave', () => {
    fileDropZoneEl.classList.remove('dragover');
  });

  fileDropZoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDropZoneEl.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  });

  fileInputEl.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFilesSelected(e.target.files);
    }
  });

  sendBtn.addEventListener('click', () => {
    if (selectedFiles.length > 0 && targetPeerId) {
      WebRTC.sendFiles(selectedFiles);
    }
  });
}

function switchMode(mode) {
  if (mode === 'local') {
    modeLocalBtn.classList.add('active');
    modeRemoteBtn.classList.remove('active');
    modeDescEl.textContent = 'Shares directly on your local network';
    ipContainer.classList.remove('hidden');
    roomCodeContainer.classList.add('hidden');
    WebRTC.setConnectionMode('local');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    WebRTC.connectSignaling(`${protocol}//${signalingServerIp}:${signalingPort}`);
  } else {
    modeRemoteBtn.classList.add('active');
    modeLocalBtn.classList.remove('active');
    modeDescEl.textContent = 'Input matching room code to pair over WAN';
    ipContainer.classList.add('hidden');
    roomCodeContainer.classList.remove('hidden');
    WebRTC.setConnectionMode('remote');
    if (WebRTC.socket && WebRTC.socket.readyState === WebSocket.OPEN) {
      WebRTC.socket.send(JSON.stringify({ type: 'join-room', room: roomCode }));
    }
  }
}

function handleScannedPayload(payload) {
  try {
    const config = JSON.parse(payload);
    if (config.server && config.room) {
      signalingServerIp = config.server;
      roomCode = config.room;
      document.getElementById('signaling-server-ip').value = config.server;
      document.getElementById('room-code').value = config.room;
      switchMode(config.mode || 'remote');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      WebRTC.connectSignaling(`${protocol}//${config.server}:${signalingPort}`);
    }
  } catch (err) {
    console.error('Invalid QR payload');
  }
}

function renderPeerList(peers) {
  peersGridEl.innerHTML = '';

  if (peers.length === 0) {
    peersGridEl.innerHTML = `
      <div class="no-peers">
        <i data-lucide="compass"></i>
        <p>Scanning for devices...</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  peers.forEach(peer => {
    const isSelected = peer.id === targetPeerId;
    const isConnected = WebRTC.activePeer && WebRTC.activePeer.id === peer.id;

    const node = document.createElement('div');
    node.className = `peer-item ${isSelected ? 'selected' : ''}`;
    node.dataset.id = peer.id;

    const iconName = peer.deviceType === 'mobile' ? 'smartphone' : 'monitor';

    node.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <div>
        <div class="name">${peer.name}</div>
        <div class="type">${peer.deviceType === 'mobile' ? 'Mobile' : 'Desktop'}</div>
      </div>
    `;

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
        if (!isConnected) {
          WebRTC.initiateConnection(peer);
        }
      }
    });

    peersGridEl.appendChild(node);
  });

  if (window.lucide) window.lucide.createIcons();
}

function handleSocketStatusChange(status) {
  if (status === 'online') {
    connectionStatusEl.textContent = 'Online';
    connectionStatusEl.className = 'stat-badge online';
    if (WebRTC.connectionMode === 'remote') {
      WebRTC.socket.send(JSON.stringify({ type: 'join-room', room: roomCode }));
    }
  } else {
    connectionStatusEl.textContent = 'Offline';
    connectionStatusEl.className = 'stat-badge offline';
  }
}

function handleConnectionStateChange(state) {
  if (state === 'connected') {
    if (targetPeerId) {
      const node = document.querySelector(`.peer-item[data-id="${targetPeerId}"]`);
      if (node) node.style.borderColor = 'var(--success)';
    }
    requestWakeLock();
  } else if (state === 'disconnected') {
    document.querySelectorAll('.peer-item').forEach(n => n.style.borderColor = '');
    releaseWakeLock();
  } else if (state === 'error') {
    releaseWakeLock();
  }
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

    row.innerHTML = `
      <i data-lucide="${icon}"></i>
      <div class="info">
        <div class="name">${file.name}</div>
        <div class="meta">${formatBytes(file.size)}</div>
      </div>
      <button class="remove" data-index="${index}"><i data-lucide="x"></i></button>
    `;

    row.querySelector('.remove').addEventListener('click', (e) => {
      e.stopPropagation();
      selectedFiles.splice(index, 1);
      handleFilesSelected(selectedFiles);
    });

    selectedFilesListEl.appendChild(row);
  });

  if (selectedFiles.length === 0) {
    selectedFilesListEl.classList.add('hidden');
  }

  if (selectedFiles.length > 0 && targetPeerId) {
    sendBtn.classList.remove('disabled-btn');
    sendBtn.disabled = false;
  } else {
    sendBtn.classList.add('disabled-btn');
    sendBtn.disabled = true;
  }

  if (window.lucide) window.lucide.createIcons();
}

function handleFileProgress(percent, filename, direction, bytesTransferred) {
  const isSending = direction === 'sending';
  const container = document.getElementById(isSending ? 'send-pane' : 'received-files-list');
  if (!container) return;

  let item = document.getElementById(`progress-${filename}`);

  const now = performance.now();
  let speedText = '';
  if (lastProgressTime > 0 && bytesTransferred > lastProgressBytes) {
    const timeDelta = (now - lastProgressTime) / 1000;
    const bytesDelta = bytesTransferred - lastProgressBytes;
    if (timeDelta > 0.1) {
      const speed = bytesDelta / timeDelta;
      speedText = `${formatBytes(speed)}/s`;
      lastProgressTime = now;
      lastProgressBytes = bytesTransferred;
    }
  } else {
    lastProgressTime = now;
    lastProgressBytes = bytesTransferred;
  }

  if (!item) {
    item = document.createElement('div');
    item.className = 'transfer-item';
    item.id = `progress-${filename}`;

    item.innerHTML = `
      <div class="transfer-head">
        <span class="title">${isSending ? 'Sending' : 'Receiving'}: ${filename}</span>
        <span class="pct" id="pct-${filename}">0%</span>
      </div>
      <div class="progress-bg">
        <div class="progress-fill" id="bar-${filename}" style="width:0%"></div>
      </div>
      <div class="transfer-meta">
        <span id="speed-${filename}">Calculating...</span>
        <span id="size-${filename}">${formatBytes(bytesTransferred)}</span>
      </div>
    `;

    if (isSending) {
      container.insertBefore(item, sendBtn);
    } else {
      const empty = container.querySelector('.empty-files');
      if (empty) empty.remove();
      container.insertBefore(item, container.firstChild);
    }
  } else {
    const pctEl = document.getElementById(`pct-${filename}`);
    const barEl = document.getElementById(`bar-${filename}`);
    const speedEl = document.getElementById(`speed-${filename}`);
    const sizeEl = document.getElementById(`size-${filename}`);

    if (pctEl) pctEl.textContent = `${Math.floor(percent)}%`;
    if (barEl) barEl.style.width = `${percent}%`;
    if (speedText && speedEl) speedEl.textContent = speedText;
    if (sizeEl) sizeEl.textContent = `${formatBytes(bytesTransferred)}`;

    if (percent >= 100) {
      const meta = item.querySelector('.transfer-meta');
      if (meta) {
        meta.innerHTML = `
          <span class="success">Transfer Complete</span>
          <span>Done</span>
        `;
      }

      const autoDim = document.getElementById('auto-dim-toggle').checked;
      if (autoDim && !isSending) {
        document.getElementById('dim-overlay').classList.remove('hidden');
      }

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

  node.innerHTML = `
    <i data-lucide="file-check" style="color:var(--success)"></i>
    <div class="info">
      <div class="name">${file.name}</div>
      <div class="meta">${formatBytes(file.size)} &bull; Complete</div>
    </div>
    <a href="${file.blobUrl}" download="${file.name}" class="panel-btn small primary" style="width:auto">
      <i data-lucide="download"></i> Save
    </a>
  `;

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
