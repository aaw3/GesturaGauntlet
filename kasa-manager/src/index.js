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
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
    timeout: 5000,
  });

  let attachTimer = null;

  const scheduleAttach = (delayMs = 0) => {
    if (attachTimer) clearTimeout(attachTimer);
    attachTimer = setTimeout(() => {
      attachTimer = null;
      void attachToNodeAgent();
    }, delayMs);
    attachTimer.unref?.();
  };

  const attachToNodeAgent = async () => {
    if (!socket.connected) return;

    try {
      const devices = await manager.listDevices();
      socket.timeout(5000).emit('manager:attach', {
        token: process.env.MANAGER_TOKEN,
        info: manager.getInfo(),
        devices,
      },
      (err, ack) => {
        if (err || ack?.ok === false) {
          console.error(
            '[KasaManager] attach failed:',
            err?.message || ack?.error || ack?.message || 'No acknowledgement',
          );
          scheduleAttach(Number(process.env.MANAGER_ATTACH_RETRY_MS || 5000));
          return;
        }

        debugLog('[KasaManager] manager:attach ack:', ack);
      });
    } catch (err) {
      console.error('[KasaManager] attach preparation failed:', err.message);
      scheduleAttach(Number(process.env.MANAGER_ATTACH_RETRY_MS || 5000));
    }
  };

  socket.on('connect', () => {
    console.log(`[KasaManager] connected to node agent as socket ${socket.id}`);
    scheduleAttach();
  });

  socket.on('connect_error', (err) => {
    console.error('[KasaManager] node agent connection error:', err.message);
  });

  socket.on('disconnect', (reason) => {
    if (attachTimer) clearTimeout(attachTimer);
    console.warn('[KasaManager] disconnected from node agent:', reason);
  });

  const heartbeat = setInterval(() => {
    if (!socket.connected) return;
    socket.emit('manager:heartbeat', {
      managerId: manager.getInfo().id,
      health: 'ok',
      ts: Date.now(),
    });
  }, Number(process.env.MANAGER_HEARTBEAT_MS || 10_000));
  heartbeat.unref?.();

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

  socket.on('manager:discover', async (_payload, ack) => {
    try {
      const result = await manager.discover();
      socket.emit('manager:inventory', {
        managerId: manager.getInfo().id,
        devices: await manager.listDevices(),
      });
      ack?.({ ok: true, data: result });
    } catch (err) {
      ack?.({ ok: false, error: err.message || 'Failed to discover devices' });
    }
  });

  socket.on('manager:clearStorage', async (_payload, ack) => {
    try {
      const result = await manager.clearStorage();
      socket.emit('manager:inventory', {
        managerId: manager.getInfo().id,
        devices: [],
      });
      ack?.({ ok: true, data: result });
    } catch (err) {
      ack?.({ ok: false, error: err.message || 'Failed to clear storage' });
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
  const lanUrls = parseUrlList(process.env.MANAGER_LAN_URLS || process.env.MANAGER_LAN_URL);
  const publicUrls = parseUrlList(process.env.MANAGER_PUBLIC_URLS || process.env.MANAGER_PUBLIC_URL);
  lanUrls.forEach((url, index) => interfaces.push({ kind: 'lan', url, priority: 10 + index }));
  const publicStart = interfaces.length ? interfaces[interfaces.length - 1].priority + 10 : 50;
  publicUrls.forEach((url, index) => interfaces.push({ kind: 'public', url, priority: publicStart + index }));
  return interfaces;
}

function parseUrlList(value) {
  return String(value || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

if (require.main === module) {
  void main().catch((err) => {
    console.error(`[KasaManager] ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createKasaManager };
