const { WebSocketServer } = require('ws');
const { URL } = require('url');

function createGloveSocketHub({
  server,
  authService,
  gloveConfigService,
  telemetryService,
  actionRouter,
  statusSocketHub,
  onSensorUpdate,
  getMode,
  setMode,
}) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();
  const debug = isDebugEnabled();

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
    ws.isAlive = true;
    debugLog(debug, `connected gloveId=${ws.gloveId || 'unknown'} clients=${clients.size}`);
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
          debugLog(debug, `hello gloveId=${ws.gloveId}`);
          send(ws, {
            type: 'config_snapshot',
            gloveId: ws.gloveId,
            ts: Date.now(),
            mode: getMode(),
            config: gloveConfigService.getConfigSnapshot(ws.gloveId),
          });
          return;
        }

        if (payload.type === 'sensor_snapshot') {
          await onSensorUpdate(payload, `glove-ws:${ws.gloveId}`);
          return;
        }

        if (payload.type === 'mapped_action') {
          const action = payload.action || payload;
          send(ws, {
            type: 'mapped_action_ack',
            gloveId: ws.gloveId,
            ts: Date.now(),
            actionId: payload.actionId,
            mappingId: action.mappingId,
            accepted: true,
          });
          const result = await actionRouter.execute(action);
          const actionResultMessage = {
            type: 'mapped_action_result',
            gloveId: ws.gloveId,
            ts: Date.now(),
            actionId: payload.actionId,
            mappingId: action.mappingId,
            ok: Boolean(result?.ok),
            result,
          };
          send(ws, {
            ...actionResultMessage,
          });
          statusSocketHub?.broadcast?.('device.state', {
            source: 'glove',
            gloveId: ws.gloveId,
            actionId: payload.actionId,
            mappingId: action.mappingId,
            deviceId: result?.deviceId || action.deviceId,
            capabilityId: result?.capabilityId || action.capabilityId,
            result,
          });
          return;
        }

        if (payload.type === 'ping') {
          debugLog(debug, `received ping gloveId=${ws.gloveId} ts=${payload.ts || ''}`);
          send(ws, { type: 'pong', gloveId: ws.gloveId, ts: Date.now(), echo: payload.ts });
          debugLog(debug, `sent pong gloveId=${ws.gloveId}`);
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
          const metrics = payload.metrics || [];
          debugLog(debug, `received metrics gloveId=${ws.gloveId} count=${Array.isArray(metrics) ? metrics.length : 0}`);
          await gloveConfigService.ingestPassiveMetrics(ws.gloveId, metrics);
          debugLog(debug, `metrics stored gloveId=${ws.gloveId} count=${Array.isArray(metrics) ? metrics.length : 0}`);
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
        debugLog(debug, `handler error gloveId=${ws.gloveId} type=${payload.type} error=${error instanceof Error ? error.stack || error.message : error}`);
        send(ws, {
          type: 'error',
          ts: Date.now(),
          message: error instanceof Error ? error.message : 'Glove websocket request failed',
        });
      }
    });

    ws.on('ping', (data) => {
      debugLog(debug, `received ping gloveId=${ws.gloveId} bytes=${data?.length || 0}`);
      debugLog(debug, `sent pong gloveId=${ws.gloveId}`);
    });

    ws.on('close', (code, reason) => {
      clients.delete(ws);
      debugLog(debug, `socket closed gloveId=${ws.gloveId} code=${code} reason=${reason ? reason.toString() : ''} clients=${clients.size}`);
    });

    ws.on('pong', () => {
      ws.isAlive = true;
      debugLog(debug, `received pong gloveId=${ws.gloveId}`);
    });

    ws.on('error', (error) => {
      debugLog(debug, `socket error gloveId=${ws.gloveId} error=${error instanceof Error ? error.stack || error.message : error}`);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) {
        debugLog(debug, `socket terminate reason=heartbeat_timeout gloveId=${ws.gloveId}`);
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        debugLog(debug, `socket terminate reason=heartbeat_ping_failed gloveId=${ws.gloveId}`);
        ws.terminate();
        clients.delete(ws);
      }
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  return {
    broadcastModeUpdate(mode) {
      for (const ws of clients) {
        send(ws, { type: 'mode_update', gloveId: ws.gloveId, ts: Date.now(), mode });
      }
    },

    getClientCount() {
      return clients.size;
    },

    requestSensorSnapshot(gloveId) {
      let requested = 0;
      for (const ws of clients) {
        if (!gloveId || ws.gloveId === gloveId) {
          send(ws, { type: 'request_sensor_snapshot', gloveId: ws.gloveId, ts: Date.now() });
          requested++;
        }
      }
      return requested;
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

function isDebugEnabled() {
  const value = String(process.env.DEBUG || '').toLowerCase();
  return Boolean(value) && !['0', 'false', 'off', 'no'].includes(value);
}

function debugLog(enabled, message) {
  if (enabled) console.log(`[DEBUG][glove-ws] ${message}`);
}

module.exports = { createGloveSocketHub };
