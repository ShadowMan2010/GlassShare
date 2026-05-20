import { initVisualizer, setVisualizerStatus } from './visualizer.js';
import { setupWakeLockControls, requestWakeLock, releaseWakeLock } from './wakelock.js';
import { generateQRCode, startQRScanner, stopQRScanner } from './qr.js';
import * as WebRTC from './webrtc.js';

// DOM Selectors
const localDeviceNameEl = document.getElementById('local-device-name');
const connectionStatusEl = document.getElementById('connection-status');
const peersGridEl = document.getElementById('peers-grid');
const fileInputEl = document.getElementById('file-input');
const fileDropZoneEl = document.getElementById('file-drop-zone');
const selectedFilesListEl = document.getElementById('selected-files-list');
const receivedFilesListEl = document.getElementById('received-files-list');
const sendBtn = document.getElementById('send-btn');

// Mode buttons
const modeLocalBtn = document.getElementById('mode-local-btn');
const modeRemoteBtn = document.getElementById('mode-remote-btn');
const modeDescEl = document.getElementById('mode-desc');
const ipContainer = document.getElementById('signaling-server-ip-container');
const roomCodeContainer = document.getElementById('room-code-container');

// Tabs
const tabSendBtn = document.getElementById('tab-send');
const tabReceiveBtn = document.getElementById('tab-receive');
const sendPane = document.getElementById('send-pane');
const receivePane = document.getElementById('receive-pane');

// Modals
const showQrBtn = document.getElementById('show-qr-btn');
const scanQrBtn = document.getElementById('scan-qr-btn');
const qrModal = document.getElementById('qr-modal');
const scannerModal = document.getElementById('scanner-modal');
const closeQrModalBtn = document.getElementById('close-qr-modal');
const closeScannerModalBtn = document.getElementById('close-scanner-modal');
const qrFallbackUrl = document.getElementById('qr-fallback-url');

// Local State
let selectedFiles = [];
let targetPeerId = null;
let roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
let signalingPort = '8080';
let signalingServerIp = window.location.hostname;
let lastProgressTime = 0;
let lastProgressBytes = 0;

// Initialize Everything
document.addEventListener('DOMContentLoaded', () => {
  // PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker registered:', reg.scope))
      .catch(err => console.warn('Service Worker registration failed:', err));
  }

  // 1. Init visualizers and wake lock controls
  initVisualizer();
  setVisualizerStatus('IDLE');
  setupWakeLockControls();

  // 2. Set default names and settings
  localDeviceNameEl.textContent = WebRTC.localName;
  document.getElementById('room-code').value = roomCode;

  // 3. Connect to local signaling server
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultSignalingUrl = `${protocol}//${signalingServerIp}:${signalingPort}`;
  document.getElementById('signaling-server-ip').value = signalingServerIp;
  WebRTC.connectSignaling(defaultSignalingUrl);

  // 4. Setup WebRTC Event Hooks
  WebRTC.registerCallbacks({
    onPeerListUpdate: renderPeerList,
    onConnectionStateChange: handleConnectionStateChange,
    onFileProgress: handleFileProgress,
    onFileReceived: handleFileReceived,
    onSocketStatusChange: handleSocketStatusChange
  });

  // 5. Setup UI Event Listeners
  setupUIEventListeners();
  
  // Render Lucide Icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

// Setup UI Actions
function setupUIEventListeners() {
  // Mode Selection
  modeLocalBtn.addEventListener('click', () => {
    switchMode('local');
  });

  modeRemoteBtn.addEventListener('click', () => {
    switchMode('remote');
  });

  // Server manual overrides
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
      WebRTC.socket.send(JSON.stringify({
        type: 'join-room',
        room: code
      }));
    }
  });

  // Tab switching
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

  // Modals trigger
  showQrBtn.addEventListener('click', () => {
    qrModal.classList.remove('hidden');
    
    // Package server IP and room configuration
    const pairingPayload = JSON.stringify({
      server: signalingServerIp,
      room: roomCode,
      mode: WebRTC.connectionMode
    });
    
    generateQRCode('qr-code-display', pairingPayload);
    qrFallbackUrl.textContent = `Server: ${signalingServerIp} | Room: ${roomCode}`;
  });

  closeQrModalBtn.addEventListener('click', () => {
    qrModal.classList.add('hidden');
  });

  scanQrBtn.addEventListener('click', () => {
    scannerModal.classList.remove('hidden');
    startQRScanner(handleScannedPayload);
  });

  closeScannerModalBtn.addEventListener('click', () => {
    scannerModal.classList.add('hidden');
    stopQRScanner();
  });

  // Drag and Drop Files
  fileDropZoneEl.addEventListener('click', () => {
    fileInputEl.click();
  });

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

  // File sender button
  sendBtn.addEventListener('click', () => {
    if (selectedFiles.length > 0 && targetPeerId) {
      WebRTC.sendFiles(selectedFiles);
    }
  });
}

// Handle Mode Switching
function switchMode(mode) {
  if (mode === 'local') {
    modeLocalBtn.classList.add('active');
    modeRemoteBtn.classList.remove('active');
    modeDescEl.textContent = 'Shares directly on your local network using automated device discovery.';
    ipContainer.classList.remove('hidden');
    roomCodeContainer.classList.add('hidden');
    
    WebRTC.setConnectionMode('local');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    WebRTC.connectSignaling(`${protocol}//${signalingServerIp}:${signalingPort}`);
  } else {
    modeRemoteBtn.classList.add('active');
    modeLocalBtn.classList.remove('active');
    modeDescEl.textContent = 'Device-to-device room mode. Input matching room code to connect over WAN.';
    ipContainer.classList.add('hidden');
    roomCodeContainer.classList.remove('hidden');
    
    WebRTC.setConnectionMode('remote');
    if (WebRTC.socket && WebRTC.socket.readyState === WebSocket.OPEN) {
      WebRTC.socket.send(JSON.stringify({
        type: 'join-room',
        room: roomCode
      }));
    }
  }
}

// QR Code scanned payload parser
function handleScannedPayload(payload) {
  try {
    const config = JSON.parse(payload);
    if (config.server && config.room) {
      signalingServerIp = config.server;
      roomCode = config.room;
      document.getElementById('signaling-server-ip').value = config.server;
      document.getElementById('room-code').value = config.room;
      
      switchMode(config.mode || 'remote');
      
      // Attempt connection to the scanned server & room
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      WebRTC.connectSignaling(`${protocol}//${config.server}:${signalingPort}`);
      
      console.log(`Paired successfully via QR code. Server: ${config.server}, Room: ${config.room}`);
    }
  } catch (err) {
    console.error('Invalid QR code scanned, text:', payload);
  }
}

// Render Peer List in Dashboard
function renderPeerList(peers) {
  peersGridEl.innerHTML = '';
  
  if (peers.length === 0) {
    peersGridEl.innerHTML = `
      <div class="no-peers-message">
        <i data-lucide="compass" class="scanning-icon"></i>
        <p>Scanning for nearby devices...</p>
        <small>Make sure the app is open on the other device.</small>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  peers.forEach(peer => {
    const isSelected = peer.id === targetPeerId;
    const isConnected = WebRTC.activePeer && WebRTC.activePeer.id === peer.id;
    
    const node = document.createElement('div');
    node.className = `peer-node ${isSelected ? 'selected' : ''} ${isConnected ? 'connected' : ''}`;
    node.dataset.id = peer.id;

    // Pick icon based on device type
    const iconName = peer.deviceType === 'mobile' ? 'smartphone' : 'monitor';
    
    node.innerHTML = `
      <i data-lucide="${iconName}" class="peer-icon"></i>
      <span class="peer-name">${peer.name}</span>
      <span class="peer-type">${peer.deviceType === 'mobile' ? 'Mobile' : 'Desktop'}</span>
    `;

    node.addEventListener('click', () => {
      // Toggle select
      if (isSelected) {
        targetPeerId = null;
        node.classList.remove('selected');
        sendBtn.classList.add('disabled-btn');
        sendBtn.disabled = true;
      } else {
        targetPeerId = peer.id;
        
        // Remove selection from all other nodes
        document.querySelectorAll('.peer-node').forEach(n => n.classList.remove('selected'));
        node.classList.add('selected');
        
        sendBtn.classList.remove('disabled-btn');
        sendBtn.disabled = false;
        
        // Initiate peer connection
        if (!isConnected) {
          WebRTC.initiateConnection(peer);
        }
      }
    });

    peersGridEl.appendChild(node);
  });

  if (window.lucide) window.lucide.createIcons();
}

// Handle socket server status changes
function handleSocketStatusChange(status) {
  if (status === 'online') {
    connectionStatusEl.textContent = 'Online';
    connectionStatusEl.className = 'value status-badge online';
    // If in remote room mode, make sure to announce room
    if (WebRTC.connectionMode === 'remote') {
      WebRTC.socket.send(JSON.stringify({
        type: 'join-room',
        room: roomCode
      }));
    }
  } else {
    connectionStatusEl.textContent = 'Offline';
    connectionStatusEl.className = 'value status-badge offline';
  }
}

// Handle WebRTC Peer Connection changes
function handleConnectionStateChange(state) {
  console.log(`Connection State Hooked: ${state}`);
  
  if (state === 'connected') {
    setVisualizerStatus('IDLE'); // Reset visualizer to slow spin
    
    // Apply visual connected class to the peer node
    if (targetPeerId) {
      const node = document.querySelector(`.peer-node[data-id="${targetPeerId}"]`);
      if (node) node.classList.add('connected');
    }
    requestWakeLock(); // Request Screen Wake Lock when connection established
  } else if (state === 'connecting') {
    setVisualizerStatus('CONNECTING');
  } else if (state === 'disconnected') {
    setVisualizerStatus('IDLE');
    document.querySelectorAll('.peer-node').forEach(node => {
      node.classList.remove('connected');
    });
    releaseWakeLock(); // Release screen lock on disconnect
  } else if (state === 'error') {
    setVisualizerStatus('ERROR');
    releaseWakeLock();
  }
}

// Handle File Selection
function handleFilesSelected(filesList) {
  selectedFiles = Array.from(filesList);
  selectedFilesListEl.innerHTML = '';
  selectedFilesListEl.classList.remove('hidden');

  selectedFiles.forEach((file, index) => {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    
    // Choose file icon based on type
    let icon = 'file';
    if (file.type.startsWith('image/')) icon = 'image';
    else if (file.type.startsWith('video/')) icon = 'video';
    else if (file.type.startsWith('audio/')) icon = 'music';
    
    fileItem.innerHTML = `
      <i data-lucide="${icon}" class="file-item-icon"></i>
      <div class="file-item-info">
        <span class="file-item-name">${file.name}</span>
        <div class="file-item-meta">
          <span>${formatBytes(file.size)}</span>
        </div>
      </div>
      <button class="remove-file-btn" data-index="${index}">
        <i data-lucide="trash-2"></i>
      </button>
    `;

    // Hook up delete button
    fileItem.querySelector('.remove-file-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      selectedFiles.splice(index, 1);
      handleFilesSelected(selectedFiles); // rerender
    });

    selectedFilesListEl.appendChild(fileItem);
  });

  if (selectedFiles.length === 0) {
    selectedFilesListEl.classList.add('hidden');
  }

  // Adjust button state
  if (selectedFiles.length > 0 && targetPeerId) {
    sendBtn.classList.remove('disabled-btn');
    sendBtn.disabled = false;
  } else {
    sendBtn.classList.add('disabled-btn');
    sendBtn.disabled = true;
  }

  if (window.lucide) window.lucide.createIcons();
}

// Handle File Progress (Sends and Receives)
function handleFileProgress(percent, filename, direction, bytesTransferred) {
  const isSending = direction === 'sending';
  const containerId = isSending ? 'send-pane' : 'received-files-list';
  const container = document.getElementById(containerId);
  if (!container) return;

  // Set visualizer to high rotation
  if (percent > 0 && percent < 100) {
    setVisualizerStatus('TRANSFERRING');
  } else if (percent >= 100) {
    setVisualizerStatus('COMPLETED');
  }

  // Render or update transfer progress indicator
  let progressItem = document.getElementById(`progress-${filename}`);
  
  // Calculate speed
  const now = performance.now();
  let speedText = '';
  if (lastProgressTime > 0 && bytesTransferred > lastProgressBytes) {
    const timeDelta = (now - lastProgressTime) / 1000; // seconds
    const bytesDelta = bytesTransferred - lastProgressBytes;
    if (timeDelta > 0.1) { // Throttle calculations
      const speed = bytesDelta / timeDelta; // B/s
      speedText = `${formatBytes(speed)}/s`;
      lastProgressTime = now;
      lastProgressBytes = bytesTransferred;
    }
  } else {
    lastProgressTime = now;
    lastProgressBytes = bytesTransferred;
  }

  if (!progressItem) {
    // Inject progress item
    progressItem = document.createElement('div');
    progressItem.className = 'transfer-item';
    progressItem.id = `progress-${filename}`;

    const insertBeforeEl = isSending ? sendBtn : container.firstChild;
    
    progressItem.innerHTML = `
      <div class="transfer-header">
        <span class="transfer-title">${isSending ? 'Sending' : 'Receiving'}: ${filename}</span>
        <span class="transfer-percentage" id="pct-${filename}">0%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="bar-${filename}" style="width: 0%"></div>
      </div>
      <div class="transfer-meta">
        <span id="speed-${filename}">Calculating speed...</span>
        <span id="size-${filename}">${formatBytes(bytesTransferred)}</span>
      </div>
    `;
    
    if (isSending) {
      container.insertBefore(progressItem, insertBeforeEl);
    } else {
      // Clear empty state message if any
      const emptyMsg = container.querySelector('.no-files-message');
      if (emptyMsg) emptyMsg.remove();
      container.insertBefore(progressItem, container.firstChild);
    }
  } else {
    // Update existing progress item
    const pctEl = document.getElementById(`pct-${filename}`);
    const barEl = document.getElementById(`bar-${filename}`);
    const speedEl = document.getElementById(`speed-${filename}`);
    const sizeEl = document.getElementById(`size-${filename}`);

    if (pctEl) pctEl.textContent = `${Math.floor(percent)}%`;
    if (barEl) barEl.style.width = `${percent}%`;
    if (speedText && speedEl) speedEl.textContent = speedText;
    if (sizeEl) sizeEl.textContent = `${formatBytes(bytesTransferred)}`;

    if (percent >= 100) {
      // Wrap it up as complete
      const metaContainer = progressItem.querySelector('.transfer-meta');
      if (metaContainer) {
        metaContainer.innerHTML = `
          <span class="success-text">Transfer Completed Successfully</span>
          <span>Done</span>
        `;
      }
      
      // Auto-dim screen logic if checked
      const autoDim = document.getElementById('auto-dim-toggle').checked;
      if (autoDim && !isSending) {
        document.getElementById('dim-overlay').classList.remove('hidden');
      }

      // Remove progress item after 5 seconds
      setTimeout(() => {
        progressItem.remove();
      }, 5000);
    }
  }
}

// Handle File Complete Received
function handleFileReceived(file) {
  const container = document.getElementById('received-files-list');
  if (!container) return;

  // Remove empty state message if it is still there
  const emptyMsg = container.querySelector('.no-files-message');
  if (emptyMsg) emptyMsg.remove();

  // Create received download element
  const fileNode = document.createElement('div');
  fileNode.className = 'file-item';
  
  fileNode.innerHTML = `
    <i data-lucide="file-check" class="file-item-icon text-success" style="color: var(--success)"></i>
    <div class="file-item-info">
      <span class="file-item-name">${file.name}</span>
      <div class="file-item-meta">
        <span>${formatBytes(file.size)}</span>
        <span>• Complete</span>
      </div>
    </div>
    <a href="${file.blobUrl}" download="${file.name}" class="glass-btn small-btn primary-btn">
      <i data-lucide="download"></i> Save
    </a>
  `;

  container.insertBefore(fileNode, container.firstChild);
  if (window.lucide) window.lucide.createIcons();
}

// Formatting helpers
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
