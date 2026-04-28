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
    this.centralRegistered = false;
    this.pendingManagerSyncs = new Map();
    this.pendingManagerStatuses = new Map();
    this.heartbeatInterval = null;
    this.managerAttachmentServer = new ManagerAttachmentServer({
      port: managerAttachPort,
      token: managerToken,
      tokenMap: managerTokenMap,
      onAttach: (manager) => this.attachManager(manager),
      onDetach: (socketId) => this.detachManagerBySocket(socketId),
      onInventory: (managerId, devices) => this.updateManagerInventory(managerId, devices),
      onHealth: (managerId, health) => this.updateManagerHealth(managerId, health),
      onGloveAction: (action) => this.executeGloveAction(action),
      onSensorSnapshot: (snapshot) => this.forwardSensorSnapshot(snapshot),
      getConfigSnapshot: () => this.cache.getConfigSnapshot(),
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
      this.centralRegistered = false;
      console.warn('[NodeAgent] central disconnected:', reason);
    });
    this.socket.on('manager:listDevices', (payload, ack) => this.handleManagerCall(payload, ack, 'listDevices'));
    this.socket.on('manager:getDeviceState', (payload, ack) =>
      this.handleManagerCall(payload, ack, 'getDeviceState', payload.deviceId)
    );
    this.socket.on('manager:executeAction', (payload, ack) =>
      this.handleManagerCall(payload, ack, 'executeAction', payload.action)
    );
    this.socket.on('manager:discover', (payload, ack) =>
      this.handleManagerCall(payload, ack, 'discover')
    );
    this.socket.on('manager:clearStorage', (payload, ack) =>
      this.handleManagerCall(payload, ack, 'clearStorage')
    );
    this.socket.on('glove:requestSensorSnapshot', (payload = {}) => {
      this.managerAttachmentServer.requestSensorSnapshot(payload.gloveId);
    });

    this.telemetry.start((events) => this.emitWithAck('telemetry:batch', { events }));
    this.managerAttachmentServer.start();

    this.heartbeatInterval = setInterval(() => {
      const devices = this.cache.getAllDevices?.() || [];
      const event = {
        eventType: 'node_heartbeat',
        nodeId: this.node.id,
        payload: {
          online: true,
          managerCount: this.managers.size,
          managers_connected_count: this.managers.size,
          connected_devices_count: devices.length,
          devices_online: devices.filter((device) => device.online !== 'offline').length,
          devices_offline: devices.filter((device) => device.online === 'offline').length,
          edge_node_uptime_sec: Math.round(process.uptime()),
        },
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
      if (response?.ok === false) {
        console.error('[NodeAgent] central rejected node registration:', response.error || response.message);
        return;
      }
      this.centralRegistered = true;
      if (response?.config) this.cache.setConfigSnapshot(response.config);
      this.telemetry.record({
        eventType: 'node_registered',
        payload: { managerIds },
      });
      for (const manager of this.managers.values()) {
        await this.registerManager(manager);
      }
      this.flushPendingCentralUpdates();
    });
  }

  async registerManager(manager) {
    const info = manager.getInfo();
    const devices = await manager.listDevices().catch(() => []);
    this.cache.setManagerDevices(info.id, devices);
    this.pendingManagerSyncs.set(info.id, { info, devices });
    this.telemetry.record({
      eventType: 'manager_registered',
      managerId: info.id,
      payload: { info, deviceCount: devices.length },
    });
    if (!this.canSendToCentral()) return;

    this.socket.emit('manager:register', {
      nodeId: this.node.id,
      info: { ...info, nodeId: this.node.id, integrationType: 'node' },
      devices,
    }, (response) => {
      if (response?.ok === false) {
        console.error(`[NodeAgent] central rejected manager ${info.id}:`, response.error || response.message);
        return;
      }
      this.pendingManagerSyncs.delete(info.id);
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
      if (method === 'discover') {
        this.telemetry.record({
          eventType: 'discovery_started',
          managerId: payload.managerId,
          payload: { managerId: payload.managerId, nodeId: this.node.id },
        });
      }
      const data = await manager[method](argument);
      if (method === 'discover') {
        const refreshedDevices = await manager.listDevices();
        await this.updateManagerInventory(payload.managerId, refreshedDevices);
        this.telemetry.record({
          eventType: 'discovery_completed',
          managerId: payload.managerId,
          payload: { managerId: payload.managerId, nodeId: this.node.id, deviceCount: refreshedDevices.length },
        });
      } else if (method === 'clearStorage') {
        await this.updateManagerInventory(payload.managerId, [], { clear: true });
        this.telemetry.record({
          eventType: 'storage_cleared',
          managerId: payload.managerId,
          payload: { managerId: payload.managerId, nodeId: this.node.id },
        });
      }
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
      if (method === 'discover') {
        this.telemetry.record({
          eventType: 'discovery_failed',
          managerId: payload.managerId,
          payload: { managerId: payload.managerId, nodeId: this.node.id, failure_reason: err.message },
        });
      }
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

  async executeGloveAction(action) {
    const device = this.cache.getDeviceById?.(action.deviceId);
    if (!device) {
      return { ok: false, deviceId: action.deviceId, capabilityId: action.capabilityId, message: 'Device not cached on edge node' };
    }
    const manager = this.managers.get(device.managerId);
    if (!manager || typeof manager.executeAction !== 'function') {
      return { ok: false, deviceId: action.deviceId, capabilityId: action.capabilityId, message: `Manager ${device.managerId} is not attached` };
    }

    const startedAt = Date.now();
    try {
      const result = await manager.executeAction(action);
      this.telemetry.record({
        eventType: 'route_attempt',
        managerId: device.managerId,
        payload: {
          managerId: device.managerId,
          nodeId: this.node.id,
          deviceId: action.deviceId,
          target_device_id: action.deviceId,
          attemptedRoute: 'lan',
          finalRoute: 'lan',
          route_path: 'local_edge',
          success: Boolean(result?.ok),
          action_success: Boolean(result?.ok),
          latencyMs: Date.now() - startedAt,
          route_latency_ms: Date.now() - startedAt,
          message: result?.message,
          failure_reason: result?.ok ? undefined : result?.message,
        },
      });
      return result;
    } catch (err) {
      this.telemetry.record({
        eventType: 'route_attempt',
        managerId: device.managerId,
        payload: {
          managerId: device.managerId,
          nodeId: this.node.id,
          deviceId: action.deviceId,
          target_device_id: action.deviceId,
          attemptedRoute: 'lan',
          finalRoute: 'lan',
          route_path: 'local_edge',
          success: false,
          action_success: false,
          latencyMs: Date.now() - startedAt,
          route_latency_ms: Date.now() - startedAt,
          message: err.message,
          failure_reason: err.message,
        },
      });
      return { ok: false, deviceId: action.deviceId, capabilityId: action.capabilityId, message: err.message };
    }
  }

  forwardSensorSnapshot(snapshot) {
    this.socket?.emit('glove:sensorSnapshot', { ...snapshot, nodeId: this.node.id });
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
    this.pendingManagerSyncs.delete(managerId);
    this.telemetry.record({
      eventType: 'manager_disconnected',
      managerId,
      payload: { managerId },
    });
    void this.updateManagerHealth(managerId, {
      online: false,
      health: 'disconnected',
      ts: Date.now(),
    });
  }

  async updateManagerInventory(managerId, devices = [], options = {}) {
    this.cache.setManagerDevices(managerId, devices);
    const manager = this.managers.get(managerId);
    const info = manager?.getInfo?.() || { id: managerId, nodeId: this.node.id };
    this.pendingManagerSyncs.set(managerId, { info, devices, clear: Boolean(options.clear) });
    this.telemetry.record({
      eventType: 'manager_inventory',
      managerId,
      payload: { managerId, deviceCount: devices.length },
    });
    if (!this.canSendToCentral()) return;

    this.socket.emit('devices:sync', {
      nodeId: this.node.id,
      managerId,
      devices,
      clear: Boolean(options.clear),
    }, (response) => {
      if (response?.ok === false) {
        console.error(`[NodeAgent] central rejected inventory for ${managerId}:`, response.error || response.message);
        return;
      }
      this.pendingManagerSyncs.delete(managerId);
    });
  }

  async updateManagerHealth(managerId, health) {
    this.pendingManagerStatuses.set(managerId, health);
    this.telemetry.record({
      eventType: 'manager_heartbeat',
      managerId,
      payload: { managerId, ...health },
    });
    if (!this.canSendToCentral()) return;

    this.socket.emit('manager:status', {
      nodeId: this.node.id,
      managerId,
      ...health,
    }, (response) => {
      if (response?.ok === false) return;
      this.pendingManagerStatuses.delete(managerId);
    });
  }

  canSendToCentral() {
    return Boolean(this.socket?.connected && this.centralRegistered);
  }

  flushPendingCentralUpdates() {
    if (!this.canSendToCentral()) return;

    for (const { info, devices, clear } of this.pendingManagerSyncs.values()) {
      this.socket.emit('manager:register', {
        nodeId: this.node.id,
        info: { ...info, nodeId: this.node.id, integrationType: 'node' },
        devices,
        clear: Boolean(clear),
      }, (response) => {
        if (response?.ok === false) {
          console.error(`[NodeAgent] central rejected manager ${info.id}:`, response.error || response.message);
          return;
        }
        this.pendingManagerSyncs.delete(info.id);
      });
    }

    for (const [managerId, health] of this.pendingManagerStatuses.entries()) {
      this.updateManagerHealth(managerId, health);
    }
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
