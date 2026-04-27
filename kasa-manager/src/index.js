require('dotenv').config();
let io;
try {
  ({ io } = require('socket.io-client'));
} catch {
  ({ io } = require('../../Dashboard/node_modules/socket.io-client'));
}
const { createKasaManager } = require('./KasaManager');

const DEBUG = process.argv.includes("--debug");

function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

async function main() {
  const nodeAgentUrl =
    process.env.NODE_AGENT_WS_URL ||
    process.env.NODE_AGENT_URL ||
    'http://localhost:3201';
  if (!process.env.MANAGER_TOKEN) {
    throw new Error('MANAGER_TOKEN is required for kasa-manager -> node-agent authentication');
  }

  const manager = createKasaManager({
    id: process.env.MANAGER_ID || 'kasa-main',
    name: process.env.MANAGER_NAME || 'Kasa Main',
    discoveryTimeoutMs: Number(process.env.KASA_DISCOVERY_TIMEOUT_MS || 3000),
    scanIntervalMs: Number(process.env.KASA_SCAN_INTERVAL_MS || 5 * 60 * 1000),
    interfaces: managerInterfacesFromEnv(),
  });

const socket = io(nodeAgentUrl, {
  transports: ['websocket', 'polling'],
  autoUnref: false,
  reconnection: true,
});

socket.on('connect', async () => {
  console.log(`[KasaManager] connected to node agent as socket ${socket.id}`);

  try {
    const devices = await manager.listDevices();
    socket.emit('manager:attach', {
      token: process.env.MANAGER_TOKEN,
      info: manager.getInfo(),
      devices,
    },
    (ack) => {
      debugLog("[SimManager] manager:attach ack:", ack);
    }
  );
  } catch (err) {
    console.error('[KasaManager] attach failed:', err.message);
  }
});

socket.on('connect_error', (err) => {
  console.error('[KasaManager] node agent connection error:', err.message);
});

socket.on('disconnect', (reason) => {
  console.warn('[KasaManager] disconnected from node agent:', reason);
});

setInterval(() => {
  socket.emit('manager:heartbeat', {
    managerId: manager.getInfo().id,
    health: 'ok',
    ts: Date.now(),
  });
}, Number(process.env.MANAGER_HEARTBEAT_MS || 10_000));

  socket.on('manager:listDevices', async (_payload, ack) => {
    try {
      const devices = await manager.listDevices();
      ack?.({ ok: true, data: devices });
    } catch (err) {
      ack?.({
        ok: false,
        message: err.message || 'Failed to list devices',
      });
    }
  });

  socket.on('manager:getDeviceState', async (payload, ack) => {
    try {
      const state = await manager.getDeviceState(payload.deviceId);
      if (!state) {
        ack?.({
          ok: false,
          deviceId: payload?.deviceId,
          message: 'Device state not found',
        });
        return;
      }

      ack?.({ ok: true, data: state });
    } catch (err) {
      ack?.({
        ok: false,
        deviceId: payload?.deviceId,
        message: err.message || 'Failed to get device state',
      });
    }
  });

  socket.on('manager:executeAction', async (payload, ack) => {
    try {
      const result = await manager.executeAction(payload.action);

      // IMPORTANT:
      // Return the action result directly instead of wrapping it inside { ok: true, data: ... }
      ack?.(result);

      if (result?.ok) {
        try {
          const devices = await manager.listDevices();
          socket.emit('manager:inventory', {
            managerId: manager.getInfo().id,
            devices,
          });
        } catch (err) {
          console.warn('[KasaManager] inventory refresh failed:', err.message);
        }
      }
    } catch (err) {
      ack?.({
        ok: false,
        deviceId: payload?.action?.deviceId,
        capabilityId: payload?.action?.capabilityId,
        message: err.message || 'Failed to execute action',
      });
    }
  });

  manager.startAutoDiscovery(async () => {
    try {
      socket.emit('manager:inventory', {
        managerId: manager.getInfo().id,
        devices: await manager.listDevices(),
      });
    } catch (err) {
      console.error('[KasaManager] auto-discovery inventory emit failed:', err.message);
    }
  });

  console.log(
    `[KasaManager] connecting ${manager.getInfo().id} to node agent ${nodeAgentUrl}`,
  );
}

function managerInterfacesFromEnv() {
  const interfaces = [];
  if (process.env.MANAGER_LAN_URL) {
    interfaces.push({ kind: 'lan', url: process.env.MANAGER_LAN_URL, priority: 10 });
  }
  if (process.env.MANAGER_PUBLIC_URL) {
    interfaces.push({ kind: 'public', url: process.env.MANAGER_PUBLIC_URL, priority: 20 });
  }
  return interfaces;
}

if (require.main === module) {
  void main().catch((err) => {
    console.error(`[KasaManager] ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createKasaManager };
