const http = require('http');
const { requireDependency } = require('../utils/requireDependency');
const express = requireDependency('express');
const cors = requireDependency('cors');
const { Server } = requireDependency('socket.io');
const { AttachedManager } = require('../managers/AttachedManager');

class ManagerAttachmentServer {
  constructor({ port = 3201, token, onAttach, onDetach, onInventory, onHealth }) {
    this.port = port;
    this.token = token;
    this.onAttach = onAttach;
    this.onDetach = onDetach;
    this.onInventory = onInventory;
    this.onHealth = onHealth;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
  }

  start() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.get('/health', (_req, res) => res.json({ ok: true }));

    this.io.on('connection', (socket) => {
      socket.on('manager:attach', async (payload = {}, ack) => {
        if (this.token && payload.token !== this.token) {
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

    this.server.listen(this.port, () => {
      console.log(`[NodeAgent] Manager attachment server listening on http://localhost:${this.port}`);
    });
  }

  stop() {
    this.io.close();
    this.server.close();
  }
}

function normalizeManagerInfo(info = {}) {
  const interfaces = [];
  if (info.lanUrl || process.env.MANAGER_LAN_URL) {
    interfaces.push({ kind: 'lan', url: info.lanUrl || process.env.MANAGER_LAN_URL, priority: 10 });
  }
  if (info.publicUrl || process.env.MANAGER_PUBLIC_URL) {
    interfaces.push({ kind: 'public', url: info.publicUrl || process.env.MANAGER_PUBLIC_URL, priority: 20 });
  }
  for (const iface of info.interfaces || []) {
    if ((iface.kind === 'lan' || iface.kind === 'public') && iface.url) interfaces.push(iface);
  }

  return {
    id: info.id || info.managerId,
    name: info.name,
    kind: String(info.kind || 'custom'),
    version: info.version || '1.0.0',
    online: info.online !== false,
    supportsDiscovery: Boolean(info.supportsDiscovery),
    supportsBulkActions: Boolean(info.supportsBulkActions),
    interfaces,
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
