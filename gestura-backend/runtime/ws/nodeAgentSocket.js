function registerNodeAgentSocket(io, services) {
  const namespace = io.of('/nodes');

  namespace.use((socket, next) => {
    const expectedToken = process.env.NODE_TOKEN || process.env.CENTRAL_NODE_TOKEN;
    if (expectedToken && socket.handshake.auth?.token !== expectedToken) {
      next(new Error('Invalid node token'));
      return;
    }
    next();
  });

  namespace.on('connection', (socket) => {
    let currentNodeId = null;

    socket.on('node:register', async (payload = {}, ack) => {
      currentNodeId = String(payload.id || socket.id);
      const node = services.nodeRegistry.upsert({
        id: currentNodeId,
        name: payload.name || currentNodeId,
        online: true,
        lastHeartbeatAt: new Date().toISOString(),
        managerIds: payload.managerIds || [],
        interfaces: payload.interfaces || [],
        metadata: payload.metadata || {},
      });
      ack?.({ ok: true, node, config: services.gloveConfigService.getConfigSnapshot('default') });
      io.emit('nodes', services.nodeRegistry.getAll());
    });

    socket.on('node:heartbeat', (payload = {}, ack) => {
      const nodeId = payload.nodeId || currentNodeId;
      if (nodeId) services.nodeRegistry.markHeartbeat(nodeId);
      ack?.({ ok: true, ts: Date.now() });
    });

    socket.on('manager:register', async (payload = {}, ack) => {
      const nodeId = payload.nodeId || currentNodeId;
      if (!nodeId) {
        ack?.({ ok: false, error: 'Node must register before managers.' });
        return;
      }

      const info = {
        ...(payload.info || payload),
        nodeId,
        integrationType: 'node',
      };
      const manager = createNodeSocketManager({ socket, info });
      await services.managerService.register(manager, {
        nodeId,
        kind: info.kind,
        integrationType: 'node',
      });
      const devices = enrichDevices(payload.devices || [], info, nodeId);
      await services.deviceRegistry.upsertMany(devices);
      await services.persistence?.saveDevicesForManager?.(info.id, devices);
      services.nodeRegistry.attachManager(nodeId, info.id);
      ack?.({ ok: true, manager: manager.getInfo() });
      io.emit('managers', services.managerService.getInfos());
      io.emit('devices', services.deviceRegistry.getAll());
    });

    socket.on('devices:sync', async (payload = {}, ack) => {
      const manager = services.managerService.get(payload.managerId);
      const info = manager?.getInfo?.() || { id: payload.managerId, nodeId };
      const devices = enrichDevices(payload.devices || [], info, info.nodeId || payload.nodeId);
      await services.deviceRegistry.upsertMany(devices);
      await services.persistence?.saveDevicesForManager?.(info.id, devices);
      ack?.({ ok: true, count: devices.length });
      io.emit('devices', services.deviceRegistry.getAll());
    });

    socket.on('manager:status', async (payload = {}, ack) => {
      const managerId = payload.managerId;
      if (!managerId) {
        ack?.({ ok: false, error: 'managerId is required' });
        return;
      }
      const info = services.managerService.updateStatus(managerId, {
        online: payload.online !== false,
        metadata: {
          ...(services.managerService.get(managerId)?.getInfo?.().metadata || {}),
          lastHeartbeatAt: payload.ts ? new Date(payload.ts).toISOString() : new Date().toISOString(),
          health: payload.health || 'ok',
        },
      });
      ack?.({ ok: Boolean(info), manager: info });
      io.emit('managers', services.managerService.getInfos());
    });

    socket.on('route:metric', async (metric = {}, ack) => {
      const recorded = await services.routeMetricsService.record(metric);
      ack?.({ ok: true, metric: recorded });
    });

    socket.on('telemetry:batch', async (payload = {}, ack) => {
      const events = Array.isArray(payload) ? payload : payload.events;
      const result = await services.telemetryService.ingestBatch(events || []);
      for (const event of events || []) {
        if ((event.eventType || event.type) === 'route_attempt') {
          services.routeMetricsService.remember({
            id: event.id,
            ts: event.ts || event.timestamp || Date.now(),
            ...(event.payload || {}),
            nodeId: event.nodeId || event.payload?.nodeId,
            managerId: event.managerId || event.payload?.managerId,
          });
        }
      }
      ack?.(result);
    });

    socket.on('disconnect', () => {
      if (currentNodeId) {
        services.nodeRegistry.markOffline(currentNodeId);
        io.emit('nodes', services.nodeRegistry.getAll());
      }
    });
  });
}

function enrichDevices(devices, managerInfo, nodeId) {
  return (devices || []).map((device) => ({
    ...device,
    managerId: device.managerId || managerInfo.id,
    provenance: {
      nodeId,
      managerId: managerInfo.id,
      managerName: managerInfo.metadata?.name || managerInfo.name,
      managerKind: managerInfo.kind,
      managerIconKey: managerInfo.metadata?.iconKey,
      managerColorKey: managerInfo.metadata?.colorKey,
      ...(device.provenance || {}),
    },
    managerInterfaces: managerInfo.interfaces || [],
  }));
}

function createNodeSocketManager({ socket, info }) {
  let currentInfo = { ...info };
  return {
    getInfo() {
      return currentInfo;
    },

    updateInfo(updates) {
      currentInfo = {
        ...currentInfo,
        ...updates,
        metadata: {
          ...(currentInfo.metadata || {}),
          ...(updates.metadata || {}),
        },
      };
    },

    async listDevices() {
      return emitWithAck(socket, 'manager:listDevices', { managerId: info.id });
    },

    async getDeviceState(deviceId) {
      return emitWithAck(socket, 'manager:getDeviceState', { managerId: info.id, deviceId });
    },

    async executeAction(action) {
      return emitWithAck(socket, 'manager:executeAction', { managerId: info.id, action });
    },
  };
}

class SocketRequestError extends Error {
  constructor(message, { status = 502, code = 'SOCKET_REQUEST_FAILED', details } = {}) {
    super(message);
    this.name = 'SocketRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (err, response) => {
      if (err) {
        reject(
          new SocketRequestError(`Node agent did not acknowledge ${event}`, {
            status: 504,
            code: 'NODE_AGENT_TIMEOUT',
            details: { event, payload },
          }),
        );
        return;
      }

      if (response?.ok === false) {
        reject(
          new SocketRequestError(
            response.error || response.message || `${event} failed`,
            {
              status: response.status || 502,
              code: response.code || 'NODE_AGENT_ACTION_FAILED',
            },
          ),
        );
        return;
      }

      resolve(response?.data ?? response);
    });
  });
}

module.exports = { emitWithAck, SocketRequestError };

module.exports = { registerNodeAgentSocket };
