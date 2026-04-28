const http = require('http');
const { requireDependency } = require('../utils/requireDependency');
const express = requireDependency('express');
const cors = requireDependency('cors');
const { Server } = requireDependency('socket.io');
const { WebSocket, WebSocketServer } = requireDependency('ws');
const { AttachedManager } = require('../managers/AttachedManager');

class ManagerAttachmentServer {
  constructor({
    port = 3201,
    token,
    tokenMap,
    onAttach,
    onDetach,
    onInventory,
    onHealth,
    onGloveAction,
    onSensorSnapshot,
    getConfigSnapshot,
  }) {
    this.port = port;
    this.token = token;
    this.tokenMap = tokenMap;
    this.onAttach = onAttach;
    this.onDetach = onDetach;
    this.onInventory = onInventory;
    this.onHealth = onHealth;
    this.onGloveAction = onGloveAction;
    this.onSensorSnapshot = onSensorSnapshot;
    this.getConfigSnapshot = getConfigSnapshot;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
    this.gloveWss = new WebSocketServer({ noServer: true });
    this.gloveClients = new Set();
  }

  start() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.get('/health', (_req, res) => res.json({ ok: true }));
    this.app.get('/api/gloves/:gloveId/config', (req, res) => {
      const snapshot = this.getConfigSnapshot?.(req.params.gloveId);
      if (!snapshot) {
        res.status(503).json({ ok: false, error: 'No cached glove config is available on this edge node' });
        return;
      }
      res.json(snapshot);
    });
    this.app.get('/api/gloves/:gloveId/endpoints', (req, res) => {
      const snapshot = this.getConfigSnapshot?.(req.params.gloveId);
      if (!snapshot?.endpoints) {
        res.status(503).json({ ok: false, error: 'No cached endpoint metadata is available on this edge node' });
        return;
      }
      res.json(snapshot.endpoints);
    });

    this.io.on('connection', (socket) => {
      socket.on('manager:attach', async (payload = {}, ack) => {
        const managerId = payload.info?.id || payload.info?.managerId || payload.id || payload.managerId;
        const expectedToken = resolveExpectedToken({
          id: managerId,
          sharedToken: this.token,
          tokenMap: this.tokenMap,
        });

        if (!expectedToken) {
          ack?.({ ok: false, error: 'Manager auth is not configured on this node agent' });
          socket.disconnect(true);
          return;
        }

        if (payload.token !== expectedToken) {
          ack?.({ ok: false, error: 'Invalid manager token' });
          socket.disconnect(true);
          return;
        }

        const info = normalizeManagerInfo(payload.info || payload);
        if (!info.id || !info.kind) {
          ack?.({ ok: false, error: 'Manager id and kind are required' });
          return;
        }

        const manager = new AttachedManager({ socket, info, devices: payload.devices || [] });
        await this.onAttach?.(manager);
        ack?.({ ok: true, manager: info });
      });

      socket.on('manager:inventory', async (payload = {}, ack) => {
        await this.onInventory?.(payload.managerId, payload.devices || []);
        ack?.({ ok: true });
      });

      socket.on('manager:heartbeat', async (payload = {}, ack) => {
        await this.onHealth?.(payload.managerId, {
          ts: payload.ts || Date.now(),
          health: payload.health || 'ok',
          online: true,
        });
        ack?.({ ok: true, ts: Date.now() });
      });

      socket.on('disconnect', () => {
        this.onDetach?.(socket.id);
      });
    });

    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== '/glove') return;

      const expectedToken = process.env.PICO_API_TOKEN || '';
      if (expectedToken && url.searchParams.get('api_key') !== expectedToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      this.gloveWss.handleUpgrade(req, socket, head, (ws) => {
        ws.gloveId = url.searchParams.get('gloveId') || 'primary_glove';
        this.gloveWss.emit('connection', ws, req);
      });
    });

    this.gloveWss.on('connection', (ws) => {
      this.gloveClients.add(ws);
      sendGloveMessage(ws, {
        type: 'welcome',
        gloveId: ws.gloveId,
        ts: Date.now(),
        config: this.getConfigSnapshot?.(ws.gloveId),
      });

      ws.on('message', async (raw) => {
        const payload = parseJson(raw);
        if (!payload?.type) return;
        if (payload.gloveId) ws.gloveId = payload.gloveId;

        if (payload.type === 'hello') {
          sendGloveMessage(ws, {
            type: 'config_snapshot',
            gloveId: ws.gloveId,
            ts: Date.now(),
            config: this.getConfigSnapshot?.(ws.gloveId),
          });
          return;
        }

        if (payload.type === 'passive_metrics') {
          sendGloveMessage(ws, { type: 'passive_metrics_ack', gloveId: ws.gloveId, ts: Date.now() });
          return;
        }

        if (payload.type === 'sensor_snapshot') {
          await this.onSensorSnapshot?.(payload);
          return;
        }

        if (payload.type === 'mapped_action') {
          const action = payload.action || payload;
          const result = await this.onGloveAction?.(action);
          sendGloveMessage(ws, {
            type: 'mapped_action_ack',
            gloveId: ws.gloveId,
            ts: Date.now(),
            mappingId: action.mappingId,
            ok: Boolean(result?.ok),
            result,
          });
        }
      });

      ws.on('close', () => {
        this.gloveClients.delete(ws);
      });
    });

    this.server.listen(this.port, () => {
      console.log(`[NodeAgent] Manager attachment server listening on http://localhost:${this.port}`);
    });
  }

  stop() {
    this.gloveWss.close();
    this.io.close();
    this.server.close();
  }

  requestSensorSnapshot(gloveId) {
    let requested = 0;
    for (const ws of this.gloveClients) {
      if (!gloveId || ws.gloveId === gloveId) {
        sendGloveMessage(ws, { type: 'request_sensor_snapshot', gloveId: ws.gloveId, ts: Date.now() });
        requested++;
      }
    }
    return requested;
  }
}

function normalizeManagerInfo(info = {}) {
  const interfaces = [];
  const lanUrls = parseUrlList(info.lanUrls || info.lanUrl || process.env.MANAGER_LAN_URLS || process.env.MANAGER_LAN_URL);
  const publicUrls = parseUrlList(info.publicUrls || info.publicUrl || process.env.MANAGER_PUBLIC_URLS || process.env.MANAGER_PUBLIC_URL);
  lanUrls.forEach((url, index) => interfaces.push({ kind: 'lan', url, priority: 10 + index }));
  publicUrls.forEach((url, index) => interfaces.push({ kind: 'public', url, priority: 50 + index }));
  for (const iface of info.interfaces || []) {
    for (const url of parseUrlList(iface.urls || iface.url)) {
      if ((iface.kind === 'lan' || iface.kind === 'public') && url) {
        interfaces.push({ ...iface, url, urls: undefined });
      }
    }
  }

  return {
    id: info.id || info.managerId,
    name: info.name,
    kind: String(info.kind || 'custom'),
    version: info.version || '1.0.0',
    online: info.online !== false,
    supportsDiscovery: Boolean(info.supportsDiscovery),
    supportsBulkActions: Boolean(info.supportsBulkActions),
    interfaces: orderInterfaces(interfaces),
    metadata: {
      name: info.metadata?.name || info.name || info.id,
      description: info.metadata?.description || info.description,
      iconKey: info.metadata?.iconKey || info.iconKey,
      colorKey: info.metadata?.colorKey || info.colorKey,
      ...(info.metadata || {}),
    },
  };
}

module.exports = { ManagerAttachmentServer };

function orderInterfaces(interfaces) {
  const lan = interfaces
    .filter((item) => item.kind === 'lan')
    .sort((left, right) => (left.priority ?? 100) - (right.priority ?? 100))
    .map((item, index) => ({ ...item, priority: index + 10 }));
  const publicStart = lan.length ? lan[lan.length - 1].priority + 10 : 50;
  const pub = interfaces
    .filter((item) => item.kind === 'public')
    .sort((left, right) => (left.priority ?? 100) - (right.priority ?? 100))
    .map((item, index) => ({ ...item, priority: publicStart + index }));
  return [...lan, ...pub];
}

function parseUrlList(value) {
  if (Array.isArray(value)) return value.map((url) => String(url).trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

function sendGloveMessage(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function parseJson(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}

function resolveExpectedToken({ id, sharedToken, tokenMap }) {
  const parsedMap = parseTokenMap(tokenMap);
  if (id && parsedMap[id]) return parsedMap[id];
  return sharedToken || '';
}

function parseTokenMap(raw) {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}

  return String(raw)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const separator = entry.indexOf(':');
      if (separator === -1) return acc;
      acc[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim();
      return acc;
    }, {});
}
