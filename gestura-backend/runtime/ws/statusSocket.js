const { WebSocketServer } = require('ws');
const { URL } = require('url');

function createStatusSocketHub({ server, authService, getSnapshot }) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== '/api/ws/status') return;

    const session = authService.authenticateDashboardUpgrade(req);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.session = session;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    send(ws, { type: 'status.snapshot', data: getSnapshot() });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  return {
    broadcast(type, data) {
      for (const ws of clients) {
        send(ws, { type, data });
      }
    },

    broadcastSnapshot() {
      const snapshot = getSnapshot();
      for (const ws of clients) {
        send(ws, { type: 'status.snapshot', data: snapshot });
      }
    },

    getClientCount() {
      return clients.size;
    },
  };
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

module.exports = { createStatusSocketHub };
