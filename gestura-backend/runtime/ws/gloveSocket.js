const { WebSocketServer } = require('ws');
const { URL } = require('url');

function createGloveSocketHub({
  server,
  authService,
  gloveConfigService,
  telemetryService,
  onSensorUpdate,
  getMode,
  setMode,
}) {
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

    if (url.pathname !== '/glove') return;

    if (!authService.hasValidPicoTokenRequest(req, url.searchParams)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.gloveId = url.searchParams.get('gloveId') || 'primary_glove';
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    send(ws, {
      type: 'welcome',
      gloveId: ws.gloveId,
      ts: Date.now(),
      mode: getMode(),
      config: gloveConfigService.getConfigSnapshot(ws.gloveId),
    });

    ws.on('message', async (raw) => {
      const payload = parse(raw);
      if (!payload?.type) return;

      try {
        if (payload.type === 'hello') {
          ws.gloveId = payload.gloveId || ws.gloveId;
          send(ws, {
            type: 'config_snapshot',
            gloveId: ws.gloveId,
            ts: Date.now(),
            mode: getMode(),
            config: gloveConfigService.getConfigSnapshot(ws.gloveId),
          });
          return;
        }

        if (payload.type === 'sensor_update') {
          await onSensorUpdate(payload, `glove-ws:${ws.gloveId}`);
          return;
        }

        if (payload.type === 'mode_set') {
          const mode = setMode(payload.mode, `glove:${ws.gloveId}`);
          send(ws, { type: 'mode_update', gloveId: ws.gloveId, ts: Date.now(), mode });
          return;
        }

        if (payload.type === 'route_state' && payload.managerId) {
          gloveConfigService.upsertRouteState({ ...payload, gloveId: ws.gloveId });
          return;
        }

        if (payload.type === 'passive_metrics') {
          await gloveConfigService.ingestPassiveMetrics(ws.gloveId, payload.metrics || []);
          send(ws, { type: 'passive_metrics_ack', gloveId: ws.gloveId, ts: Date.now() });
          return;
        }

        if (payload.type === 'button_action') {
          await telemetryService?.ingestBatch?.([
            {
              ts: Date.now(),
              eventType: 'glove_button_action',
              gloveId: ws.gloveId,
              payload: {
                gloveId: ws.gloveId,
                action: payload.action || 'unknown',
                button: payload.button || 'unknown',
              },
            },
          ]);
        }
      } catch (error) {
        send(ws, {
          type: 'error',
          ts: Date.now(),
          message: error instanceof Error ? error.message : 'Glove websocket request failed',
        });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  return {
    broadcastModeUpdate(mode) {
      for (const ws of clients) {
        send(ws, { type: 'mode_update', gloveId: ws.gloveId, ts: Date.now(), mode });
      }
    },

    getClientCount() {
      return clients.size;
    },
  };
}

function parse(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

module.exports = { createGloveSocketHub };
