// WebRTC Peer Connection and File Transfer Module

const CHUNK_SIZE = 16384; // 16KB chunks
const BUFFER_THRESHOLD = 1048576; // 1MB buffer backpressure threshold

export const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// Application State Variables
export let socket = null;
export let peerConnection = null;
export let dataChannel = null;
export let activePeer = null; // Currently connected peer details {id, name, type}
export let localId = Math.random().toString(36).substring(2, 9);
export let localName = getDeviceDefaultName();
export let connectionMode = 'local'; // local or remote

// Callbacks registered from main.js
let callbacks = {
  onPeerListUpdate: () => {},
  onConnectionStateChange: () => {},
  onFileProgress: () => {},
  onFileReceived: () => {},
  onSocketStatusChange: () => {}
};

export function registerCallbacks(cbs) {
  callbacks = { ...callbacks, ...cbs };
}

// Generate an elegant, identifiable name based on user agent
function getDeviceDefaultName() {
  const ua = navigator.userAgent;
  let os = 'Unknown Device';
  if (/android/i.test(ua)) os = 'Android';
  else if (/iPad|iPhone|iPod/.test(ua)) os = 'iOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/windows/i.test(ua)) os = 'Windows';
  
  const rand = Math.floor(100 + Math.random() * 900);
  return `${os}-${rand}`;
}

export function setLocalName(name) {
  localName = name;
}

export function setConnectionMode(mode) {
  connectionMode = mode;
  // Disconnect existing peer when switching modes
  disconnectPeer();
}

// --- WebSocket Signaling Connection ---
export function connectSignaling(serverUrl) {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  console.log(`Connecting to signaling server: ${serverUrl}`);
  callbacks.onSocketStatusChange('connecting');

  try {
    socket = new WebSocket(serverUrl);

    socket.onopen = () => {
      console.log('Connected to signaling server');
      callbacks.onSocketStatusChange('online');
      // Announce yourself
      socket.send(JSON.stringify({
        type: 'register',
        id: localId,
        name: localName,
        deviceType: /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
      }));
    };

    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      console.log('Signaling Message received:', data.type);

      switch (data.type) {
        case 'peer-list':
          // Filter out ourselves
          const peers = data.peers.filter(p => p.id !== localId);
          callbacks.onPeerListUpdate(peers);
          break;

        case 'offer':
          await handleOffer(data.offer, data.sender);
          break;

        case 'answer':
          await handleAnswer(data.answer);
          break;

        case 'candidate':
          if (peerConnection) {
            try {
              await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
              console.error('Error adding ICE candidate:', err);
            }
          }
          break;

        case 'peer-disconnected':
          if (activePeer && activePeer.id === data.peerId) {
            disconnectPeer();
          }
          break;
      }
    };

    socket.onclose = () => {
      console.log('Disconnected from signaling server');
      callbacks.onSocketStatusChange('offline');
      // Try to reconnect in 5 seconds
      setTimeout(() => connectSignaling(serverUrl), 5000);
    };

    socket.onerror = (error) => {
      console.error('Signaling server connection error:', error);
      callbacks.onSocketStatusChange('offline');
    };
  } catch (err) {
    console.error('Failed to create WebSocket:', err);
    callbacks.onSocketStatusChange('offline');
  }
}

// --- WebRTC Protocol Initiation ---
export async function initiateConnection(targetPeer) {
  console.log(`Initiating WebRTC connection with: ${targetPeer.name} (${targetPeer.id})`);
  activePeer = targetPeer;
  callbacks.onConnectionStateChange('connecting');

  createPeerConnection(targetPeer.id);

  // Setup DataChannel (as initiator)
  dataChannel = peerConnection.createDataChannel('fileTransfer', {
    ordered: true
  });
  setupDataChannelHandlers();

  // Create & send SDP Offer
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.send(JSON.stringify({
      type: 'offer',
      target: targetPeer.id,
      sender: { id: localId, name: localName },
      offer: offer
    }));
  } catch (err) {
    console.error('Failed to create/send offer:', err);
    callbacks.onConnectionStateChange('error');
  }
}

function createPeerConnection(targetPeerId) {
  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'candidate',
        target: targetPeerId,
        candidate: event.candidate
      }));
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(`WebRTC Connection State: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === 'connected') {
      callbacks.onConnectionStateChange('connected');
    } else if (
      peerConnection.connectionState === 'disconnected' ||
      peerConnection.connectionState === 'failed' ||
      peerConnection.connectionState === 'closed'
    ) {
      disconnectPeer();
    }
  };

  // Handle incoming data channel (for receiver)
  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannelHandlers();
  };
}

async function handleOffer(offer, sender) {
  activePeer = sender;
  callbacks.onConnectionStateChange('connecting');

  createPeerConnection(sender.id);

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.send(JSON.stringify({
      type: 'answer',
      target: sender.id,
      answer: answer
    }));
  } catch (err) {
    console.error('Failed to handle SDP offer:', err);
    callbacks.onConnectionStateChange('error');
  }
}

async function handleAnswer(answer) {
  if (peerConnection) {
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('Failed to set remote description answer:', err);
      callbacks.onConnectionStateChange('error');
    }
  }
}

export function disconnectPeer() {
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  activePeer = null;
  callbacks.onConnectionStateChange('disconnected');
}

// --- Data Channel File Transfer Logic ---
let incomingFileBuffer = [];
let receivedBytes = 0;
let fileMetadata = null;

function setupDataChannelHandlers() {
  if (!dataChannel) return;

  dataChannel.binaryType = 'arraybuffer';
  dataChannel.bufferedAmountLowThreshold = BUFFER_THRESHOLD;

  dataChannel.onopen = () => {
    console.log('RTCDataChannel is open');
    callbacks.onConnectionStateChange('connected');
  };

  dataChannel.onclose = () => {
    console.log('RTCDataChannel is closed');
    callbacks.onConnectionStateChange('disconnected');
  };

  dataChannel.onmessage = (event) => {
    if (typeof event.data === 'string') {
      // JSON Metadata received
      const message = JSON.parse(event.data);
      if (message.type === 'metadata') {
        fileMetadata = message;
        incomingFileBuffer = [];
        receivedBytes = 0;
        callbacks.onFileProgress(0, fileMetadata.name, 'receiving', 0);
      }
    } else {
      // Binary File Chunk received
      if (!fileMetadata) return;

      incomingFileBuffer.push(event.data);
      receivedBytes += event.data.byteLength;

      const progress = Math.min((receivedBytes / fileMetadata.size) * 100, 100);
      callbacks.onFileProgress(progress, fileMetadata.name, 'receiving', receivedBytes);

      // File download triggered when complete
      if (receivedBytes >= fileMetadata.size) {
        const receivedBlob = new Blob(incomingFileBuffer, { type: fileMetadata.mimeType });
        const downloadUrl = URL.createObjectURL(receivedBlob);
        
        callbacks.onFileReceived({
          name: fileMetadata.name,
          size: fileMetadata.size,
          blobUrl: downloadUrl
        });

        // Reset metadata
        fileMetadata = null;
        incomingFileBuffer = [];
      }
    }
  };
}

// --- File Chunking and Transfer ---
export function sendFiles(files) {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    console.error('Cannot send files: DataChannel is not open');
    return;
  }

  // Handle multiple files sequentially
  let fileIndex = 0;

  function sendNextFile() {
    if (fileIndex >= files.length) {
      console.log('All files sent successfully');
      return;
    }

    const file = files[fileIndex];
    console.log(`Sending file: ${file.name} (${file.size} bytes)`);

    // Step 1: Send Metadata
    dataChannel.send(JSON.stringify({
      type: 'metadata',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream'
    }));

    // Step 2: Slice and Stream Chunks with Backpressure
    let offset = 0;
    const fileReader = new FileReader();

    const readSlice = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    };

    fileReader.onload = (e) => {
      const buffer = e.target.result;
      dataChannel.send(buffer);
      offset += buffer.byteLength;

      const progress = Math.min((offset / file.size) * 100, 100);
      callbacks.onFileProgress(progress, file.name, 'sending', offset);

      if (offset < file.size) {
        // Check backpressure (browser queue buffer threshold)
        if (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
          // Pause reading next slice until the buffer has emptied
          dataChannel.onbufferedamountlow = () => {
            dataChannel.onbufferedamountlow = null; // clear handler
            readSlice();
          };
        } else {
          // Send next chunk immediately if buffer space permits
          readSlice();
        }
      } else {
        // File completely sent
        fileIndex++;
        // Allow brief cooling down period between files
        setTimeout(sendNextFile, 200);
      }
    };

    fileReader.onerror = (err) => {
      console.error('FileReader error:', err);
      callbacks.onConnectionStateChange('error');
    };

    readSlice();
  }

  sendNextFile();
}
