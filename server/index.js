import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`GlassShare signaling server active on port ${PORT}`);

// Active connections: clientID -> { socket, name, deviceType, room }
const clients = new Map();

/**
 * Retrieves the visible peers list for a given client based on their room context
 * @param {string} clientId - Target client ID
 * @returns {Array} List of peer objects
 */
function getVisiblePeers(clientId) {
  const client = clients.get(clientId);
  if (!client) return [];

  const visiblePeers = [];
  for (const [id, peer] of clients.entries()) {
    if (id === clientId) continue;

    // Room separation logic:
    // If a client is in a room, they only see others in the same room.
    // If not in a room, they see all others who are also not in a room (Local network lobby).
    if (client.room) {
      if (peer.room === client.room) {
        visiblePeers.push({ id, name: peer.name, deviceType: peer.deviceType });
      }
    } else {
      if (!peer.room) {
        visiblePeers.push({ id, name: peer.name, deviceType: peer.deviceType });
      }
    }
  }
  return visiblePeers;
}

/**
 * Broadcasts updated peer lists to all clients in a specific room context
 * @param {string|null} room - Room code (null for local subnet lobby)
 */
function broadcastPeerList(room = null) {
  for (const [id, client] of clients.entries()) {
    // Only send updates to clients matching the room context
    if (room && client.room !== room) continue;
    if (!room && client.room) continue;

    if (client.socket.readyState === 1) { // WebSocket.OPEN
      const peers = getVisiblePeers(id);
      client.socket.send(JSON.stringify({
        type: 'peer-list',
        peers
      }));
    }
  }
}

wss.on('connection', (ws) => {
  let clientId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'register':
          clientId = data.id;
          ws.id = clientId;
          
          clients.set(clientId, {
            socket: ws,
            name: data.name,
            deviceType: data.deviceType,
            room: null // Defaults to local subnet
          });
          
          console.log(`Device registered: ${data.name} (${clientId})`);
          broadcastPeerList(null); // Notify local network lobby
          break;

        case 'join-room':
          if (!clientId) return;
          const client = clients.get(clientId);
          
          if (client) {
            const oldRoom = client.room;
            client.room = data.room;
            console.log(`Device ${client.name} joined room: ${data.room}`);
            
            // Broadcast updates to old subnet/room and new room
            broadcastPeerList(oldRoom);
            broadcastPeerList(data.room);
          }
          break;

        case 'offer':
        case 'answer':
        case 'candidate':
          // Relay peer-to-peer WebRTC negotiations directly to target client
          const targetClient = clients.get(data.target);
          if (targetClient && targetClient.socket.readyState === 1) {
            targetClient.socket.send(JSON.stringify(data));
          }
          break;
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (clientId) {
      const client = clients.get(clientId);
      const room = client ? client.room : null;
      
      console.log(`Device disconnected: ${client ? client.name : clientId}`);
      clients.delete(clientId);
      
      // Let other peers in the room/lobby know this peer left
      for (const [id, peer] of clients.entries()) {
        if (room && peer.room === room && peer.socket.readyState === 1) {
          peer.socket.send(JSON.stringify({ type: 'peer-disconnected', peerId: clientId }));
        } else if (!room && !peer.room && peer.socket.readyState === 1) {
          peer.socket.send(JSON.stringify({ type: 'peer-disconnected', peerId: clientId }));
        }
      }

      broadcastPeerList(room);
    }
  });

  ws.on('error', (err) => {
    console.error(`Socket error from client ${clientId || 'unknown'}:`, err);
  });
});
