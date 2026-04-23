const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const net = require('net');
const aedes = require('aedes')();

const { parseJsonPayload } = require('./runtime/utils');
const { SensorStore } = require('./runtime/sensorStore');
const { DeviceRegistry } = require('./runtime/services/DeviceRegistry');
const { ManagerService } = require('./runtime/services/ManagerService');
const { DeviceSyncService } = require('./runtime/services/DeviceSyncService');
const { ActionRouter } = require('./runtime/services/ActionRouter');
const { MappingService } = require('./runtime/services/MappingService');
const { SceneService } = require('./runtime/services/SceneService');
const { PostgresStore } = require('./runtime/persistence/PostgresStore');
const { NodeRegistry } = require('./runtime/registries/NodeRegistry');
const { RouteMetricsService } = require('./runtime/metrics/RouteMetricsService');
const { TelemetryService } = require('./runtime/metrics/TelemetryService');
const { GrafanaTelemetrySink } = require('./runtime/metrics/GrafanaTelemetrySink');
const { GloveConfigService } = require('./runtime/glove/GloveConfigService');
const { createManagersRouter } = require('./runtime/routes/managers');
const { createDevicesRouter } = require('./runtime/routes/devices');
const { createMappingsRouter } = require('./runtime/routes/mappings');
const { createScenesRouter } = require('./runtime/routes/scenes');
const { createNodesRouter } = require('./runtime/routes/nodes');
const { createRouteMetricsRouter } = require('./runtime/routes/routeMetrics');
const { createGlovesRouter } = require('./runtime/routes/gloves');
const { createTelemetryRouter } = require('./runtime/routes/telemetry');
const { createSystemRouter } = require('./runtime/routes/system');
const { registerNodeAgentSocket } = require('./runtime/ws/nodeAgentSocket');

try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const app = express();
app.use(cors());
app.use(express.json());

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);

  res.status(err.status || 500).json({
    ok: false,
    error: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_SERVER_ERROR',
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const MQTT_TOPIC_SENSORS = process.env.MQTT_TOPIC_SENSORS || 'gauntlet/sensors';
const MQTT_TOPIC_MODE = process.env.MQTT_TOPIC_MODE || 'gauntlet/mode';
const MQTT_BROKER_PORT = Number(process.env.MQTT_BROKER_PORT || 1883);
const SENSOR_HISTORY_SIZE = Number(process.env.SENSOR_HISTORY_SIZE || 200);

const sensorStore = new SensorStore({ historySize: SENSOR_HISTORY_SIZE });
const persistence = new PostgresStore();
const deviceRegistry = new DeviceRegistry({ persistence });
const nodeRegistry = new NodeRegistry({ persistence });
const managerService = new ManagerService({ persistence, nodeRegistry });
const deviceSyncService = new DeviceSyncService(managerService, deviceRegistry, { persistence });
const grafanaSink = new GrafanaTelemetrySink();
const telemetryService = new TelemetryService({ persistence, grafanaSink });
const routeMetricsService = new RouteMetricsService({ persistence, telemetryService });
const actionRouter = new ActionRouter(managerService, deviceRegistry, { routeMetricsService });
const mappingService = new MappingService({ persistence });
const sceneService = new SceneService(actionRouter, { persistence });
const gloveConfigService = new GloveConfigService({
  mappingService,
  deviceRegistry,
  managerService,
  persistence,
  telemetryService,
});
const brokerServer = net.createServer(aedes.handle);

let currentMode = 'passive';
let isInternalPublish = false;

function publishMode(mode) {
  const payload = String(mode).toUpperCase();

  isInternalPublish = true;
  aedes.publish(
    {
      topic: MQTT_TOPIC_MODE,
      payload: Buffer.from(payload),
      qos: 0,
      retain: true,
    },
    () => {
      isInternalPublish = false;
    }
  );
}

function setMode(mode, source = 'api') {
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (normalizedMode !== 'active' && normalizedMode !== 'passive') {
    throw new Error(`Invalid mode: ${mode}`);
  }

  currentMode = normalizedMode;
  console.log(`[Mode] ${source} set mode to ${currentMode}`);
  publishMode(currentMode);
  io.emit('modeUpdate', currentMode);
  return currentMode;
}

async function handleSensorUpdate(data, source = 'unknown') {
  const latest = sensorStore.record(data, source);
  io.emit('sensorData', latest);
  io.emit('sensorStatus', sensorStore.getState());
  return latest;
}

function publicStatus() {
  const system = systemStatus();
  return {
    mode: currentMode,
    system,
    sensor: sensorStore.getState(),
    mqtt: {
      brokerUrl: `tcp://localhost:${MQTT_BROKER_PORT}`,
      topics: {
        mode: MQTT_TOPIC_MODE,
        sensors: MQTT_TOPIC_SENSORS,
      },
    },
    managers: managerService.getInfos(),
    nodes: nodeRegistry.getAll(),
    routeMetrics: routeMetricsService.list().slice(-20),
    telemetry: telemetryService.list().slice(-20),
    grafana: system.grafana,
    deviceCount: deviceRegistry.getAll().length,
  };
}

function systemStatus() {
  return {
    controlPlane: {
      api: 'online',
      uptimeSec: Math.round(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    },
    database: {
      configured: Boolean(process.env.DATABASE_URL),
      connected: persistence.enabled,
    },
    grafana: {
      enabled: grafanaSink.enabled,
      status: grafanaSink.enabled ? (grafanaSink.lastError ? 'error' : 'connected') : 'disabled',
      lastError: grafanaSink.lastError || null,
      lastSuccessAt: grafanaSink.lastSuccessAt || null,
    },
    websocketHub: {
      online: true,
      connectedNodeCount: io.of('/nodes').sockets.size,
      connectedDashboardCount: io.of('/').sockets.size,
    },
    inventory: {
      nodeCount: nodeRegistry.getAll().length,
      managerCount: managerService.getInfos().length,
      deviceCount: deviceRegistry.getAll().length,
    },
    telemetry: {
      recentEventCount: telemetryService.list().length,
      recentRouteMetricCount: routeMetricsService.list().length,
    },
  };
}

brokerServer.on('error', (err) => {
  console.error(`[MQTT] Broker failed on port ${MQTT_BROKER_PORT}: ${err.message}`);
  process.exitCode = 1;
});

brokerServer.listen(MQTT_BROKER_PORT, () => {
  console.log(`[MQTT] Broker listening on tcp://0.0.0.0:${MQTT_BROKER_PORT}`);
});

aedes.on('clientReady', (client) => {
  console.log(`[MQTT] Client connected    : ${client?.id ?? 'unknown'}`);
});

aedes.on('clientDisconnect', (client) => {
  console.log(`[MQTT] Client disconnected : ${client?.id ?? 'unknown'}`);
});

aedes.on('publish', (packet, client) => {
  if (packet.topic?.startsWith('$SYS')) return;

  if (packet.topic === MQTT_TOPIC_SENSORS) {
    try {
      const data = parseJsonPayload(packet.payload);
      void handleSensorUpdate(data, `mqtt:${client?.id ?? 'broker'}`).catch((err) => {
        console.error('[MQTT] Sensor handling error:', err.message);
      });
    } catch (err) {
      console.error('[MQTT] Sensor parse error:', err.message);
    }
    return;
  }

  if (packet.topic === MQTT_TOPIC_MODE) {
    if (isInternalPublish) return;

    const newMode = packet.payload.toString().trim().toLowerCase();
    if (newMode === 'active' || newMode === 'passive') {
      currentMode = newMode;
      console.log('[MQTT] Hardware mode changed to:', currentMode);
      io.emit('modeUpdate', currentMode);
    }
  }
});

io.on('connection', (socket) => {
  console.log('[WS] Dashboard connected:', socket.id);

  socket.emit('modeUpdate', currentMode);
  socket.emit('sensorStatus', sensorStore.getState());
  socket.emit('managers', managerService.getInfos());
  socket.emit('nodes', nodeRegistry.getAll());
  socket.emit('devices', deviceRegistry.getAll());
  publishMode(currentMode);

  socket.on('getMode', () => {
    socket.emit('modeUpdate', currentMode);
  });

  socket.on('setMode', (mode) => {
    try {
      const nextMode = setMode(mode, 'dashboard');
      socket.emit('modeResult', { success: true, mode: nextMode });
    } catch (err) {
      socket.emit('modeResult', { success: false, error: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('[WS] Dashboard disconnected:', socket.id);
  });
});

app.post('/api/data', async (req, res) => {
  try {
    const latest = await handleSensorUpdate(req.body, 'http');
    res.json({ mode: currentMode, sensor: latest });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json(publicStatus());
});

app.get('/api/sensors/latest', (req, res) => {
  res.json(sensorStore.getState().latest || {});
});

app.get('/api/sensors/history', (req, res) => {
  res.json(sensorStore.getHistory());
});

app.post('/api/mode', (req, res) => {
  try {
    res.json({ success: true, mode: setMode(req.body?.mode, 'http') });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const services = {
  managerService,
  deviceRegistry,
  deviceSyncService,
  actionRouter,
  mappingService,
  sceneService,
  persistence,
  nodeRegistry,
  routeMetricsService,
  telemetryService,
  grafanaSink,
  gloveConfigService,
  systemStatus,
};

app.use('/api/managers', createManagersRouter(services));
app.use('/api/devices', createDevicesRouter(services));
app.use('/api/mappings', createMappingsRouter(services));
app.use('/api/scenes', createScenesRouter(services));
app.use('/api/nodes', createNodesRouter(services));
app.use('/api/route-metrics', createRouteMetricsRouter(services));
app.use('/api/telemetry', createTelemetryRouter(services));
app.use('/api/system', createSystemRouter(services));
app.use('/api/gloves', createGlovesRouter(services));
registerNodeAgentSocket(io, services);

const PORT = Number(process.env.PORT || 3001);
server.on('error', (err) => {
  console.error(`[Server] HTTP/WebSocket server failed on port ${PORT}: ${err.message}`);
  process.exitCode = 1;
});

async function start() {
  try {
    const persistenceEnabled = await persistence.init();
    if (persistenceEnabled) {
      for (const node of await persistence.listNodes()) {
        nodeRegistry.upsert({ ...node, online: false });
      }
      for (const config of await persistence.listManagerConfigs()) {
        if (config.nodeId) {
          await managerService.registerSnapshot({
            id: config.id,
            nodeId: config.nodeId,
            name: config.name,
            kind: config.kind,
            version: config.version,
            online: false,
            supportsDiscovery: config.supportsDiscovery,
            supportsBulkActions: config.supportsBulkActions,
            integrationType: 'node',
            metadata: config.metadata,
            interfaces: config.interfaces,
          });
        }
      }
      await deviceRegistry.upsertMany(await persistence.listManagedDevices());
      await mappingService.loadPersisted();
      await sceneService.loadPersisted();
      console.log('[Persistence] Postgres persistence enabled.');
    } else {
      console.log('[Persistence] DATABASE_URL not set; using in-memory managers and configuration.');
    }
  } catch (err) {
    console.error(`[Persistence] Startup failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  server.listen(PORT, () => {
    console.log(`[Server] Gestura backend on http://localhost:${PORT}`);
    console.log(`[Server] MQTT sensor topic: ${MQTT_TOPIC_SENSORS}`);
    console.log(`[Server] MQTT mode topic  : ${MQTT_TOPIC_MODE}`);
  });
}

void start();
