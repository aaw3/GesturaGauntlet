const { requireDependency } = require('../utils/requireDependency');
const { io } = requireDependency('socket.io-client');
const { LocalNodeCache } = require('../cache/LocalNodeCache');
const { TelemetryBuffer } = require('../telemetry/TelemetryBuffer');
const { ManagerAttachmentServer } = require('./ManagerAttachmentServer');

const DEBUG = process.argv.includes('--debug') || process.env.DEBUG === '1';
const debug = (...args) => {
  if (DEBUG) console.log('[NodeAgent][debug]', ...args);
};

class NodeAgent {
  constructor({
    centralApiUrl,
    centralWsUrl,
    centralUrl,
    node,
    managers = [],
    cache = new LocalNodeCache(),
    managerAttachPort = 3201,
    managerToken,
    managerTokenMap,
  }) {
    this.centralApiUrl = centralApiUrl || centralUrl;
    this.centralWsUrl = centralWsUrl || centralUrl;
    this.node = node;
    this.managers = new Map(managers.map((manager) => [manager.getInfo().id, manager]));
    this.managerSocketIds = new Map();
    this.cache = cache;
    this.telemetry = new TelemetryBuffer({ nodeId: node.id });
    this.socket = null;
    this.heartbeatInterval = null;
    this.managerAttachmentServer = new ManagerAttachmentServer({
      port: managerAttachPort,
      token: managerToken,
      tokenMap: managerTokenMap,
      onAttach: (manager) => this.attachManager(manager),
      onDetach: (socketId) => this.detachManagerBySocket(socketId),
      onInventory: (managerId, devices) => this.updateManagerInventory(managerId, devices),
      onHealth: (managerId, health) => this.updateManagerHealth(managerId, health),
    });
  }

  async start() {
    if (!this.node?.token) {
      throw new Error('NODE_TOKEN is required for node-agent -> central authentication');
    }

    this.socket = io(`${this.centralWsUrl}/nodes`, {
      transports: ['websocket', 'polling'],
      auth: { token: this.node.token, nodeId: this.node.id },
    });

    this.socket.on('connect', () => {
      debug('connected to central', {
        url: `${this.centralWsUrl}/nodes`,
        socketId: this.socket.id,
      });
      void this.register();
    });

    this.socket.on('connect_error', (err) => {
      console.error('[NodeAgent] central connect error:', err.message);
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('[NodeAgent] central disconnected:', reason);
    });
    this.socket.on('manager:listDevices', (payload, ack) => this.handleManagerCall(payload, ack, 'listDevices'));
    this.socket.on('manager:getDeviceState', (payload, ack) =>
      this.handleManagerCall(payload, ack, 'getDeviceState', payload.deviceId)
    );
    this.socket.on('manager:executeAction', (payload, ack) =>
      this.handleManagerCall(payload, ack, 'executeAction', payload.action)
    );

    this.telemetry.start((events) => this.emitWithAck('telemetry:batch', { events }));
    this.managerAttachmentServer.start();

    this.heartbeatInterval = setInterval(() => {
      const event = {
        eventType: 'node_heartbeat',
        nodeId: this.node.id,
        payload: { online: true, managerCount: this.managers.size },
      };
      this.telemetry.record(event);
      this.socket?.emit('node:heartbeat', { nodeId: this.node.id, ts: Date.now() });
    }, 10_000);
    this.heartbeatInterval.unref?.();
  }

  async register() {
    const managerIds = Array.from(this.managers.keys());
    debug('registering node', {
      nodeId: this.node.id,
      managerIds,
    });
    
    this.socket.emit('node:register', { ...this.node, managerIds }, async (response) => {
      debug('node:register response', response);
      if (response?.config) this.cache.setConfigSnapshot(response.config);
      this.telemetry.record({
        eventType: 'node_registered',
        payload: { managerIds },
      });
      for (const manager of this.managers.values()) {
        await this.registerManager(manager);
      }
    });
  }

  async registerManager(manager) {
    const info = manager.getInfo();
    const devices = await manager.listDevices().catch(() => []);
    this.cache.setManagerDevices(info.id, devices);
    this.telemetry.record({
      eventType: 'manager_registered',
      managerId: info.id,
      payload: { info, deviceCount: devices.length },
    });
    this.socket.emit('manager:register', {
      nodeId: this.node.id,
      info: { ...info, nodeId: this.node.id, integrationType: 'node' },
      devices,
    });
  }

  async handleManagerCall(payload, ack, method, argument) {
    const manager = this.managers.get(payload.managerId);
    if (!manager || typeof manager[method] !== 'function') {
      ack?.({ ok: false, error: `Manager ${payload.managerId} cannot handle ${method}` });
      return;
    }

    try {
      const startedAt = Date.now();
      const data = await manager[method](argument);
      if (method === 'executeAction') {
        this.telemetry.record({
          eventType: 'route_attempt',
          managerId: payload.managerId,
          payload: {
            managerId: payload.managerId,
            nodeId: this.node.id,
            deviceId: argument?.deviceId,
            attemptedRoute: 'lan',
            finalRoute: 'lan',
            success: true,
            latencyMs: Date.now() - startedAt,
          },
        });
      }
      ack?.({ ok: true, data });
    } catch (err) {
      if (method === 'executeAction') {
        this.telemetry.record({
          eventType: 'route_attempt',
          managerId: payload.managerId,
          payload: {
            managerId: payload.managerId,
            nodeId: this.node.id,
            deviceId: argument?.deviceId,
            attemptedRoute: 'lan',
            finalRoute: 'public',
            success: false,
            error: err.message,
          },
        });
      }
      ack?.({ ok: false, error: err.message });
    }
  }

  async attachManager(manager) {
    const info = manager.getInfo();
    this.managers.set(info.id, manager);
    if (manager.socket?.id) this.managerSocketIds.set(manager.socket.id, info.id);
    await this.registerManager(manager);
  }

  detachManagerBySocket(socketId) {
    const managerId = this.managerSocketIds.get(socketId);
    if (!managerId) return;
    this.managerSocketIds.delete(socketId);
    this.managers.delete(managerId);
    this.telemetry.record({
      eventType: 'manager_disconnected',
      managerId,
      payload: { managerId },
    });
    this.socket?.emit('manager:status', {
      nodeId: this.node.id,
      managerId,
      online: false,
      health: 'disconnected',
      ts: Date.now(),
    });
  }

  async updateManagerInventory(managerId, devices = []) {
    this.cache.setManagerDevices(managerId, devices);
    this.telemetry.record({
      eventType: 'manager_inventory',
      managerId,
      payload: { managerId, deviceCount: devices.length },
    });
    this.socket?.emit('devices:sync', { nodeId: this.node.id, managerId, devices });
  }

  async updateManagerHealth(managerId, health) {
    this.telemetry.record({
      eventType: 'manager_heartbeat',
      managerId,
      payload: { managerId, ...health },
    });
    this.socket?.emit('manager:status', {
      nodeId: this.node.id,
      managerId,
      ...health,
    });
  }

  emitWithAck(event, payload) {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Central socket is not connected'));
        return;
      }
      this.socket.timeout(5000).emit(event, payload, (err, response) => {
        if (err) reject(err);
        else if (response?.ok === false) reject(new Error(response.message || response.error || `${event} failed`));
        else resolve(response);
      });
    });
  }

  async stop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    await this.telemetry.flush();
    this.telemetry.stop();
    this.managerAttachmentServer.stop();
    this.socket?.disconnect();
    for (const manager of this.managers.values()) {
      await manager.shutdown?.();
    }
  }
}

module.exports = { NodeAgent };
