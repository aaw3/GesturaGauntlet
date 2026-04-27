const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require("cookie-parser");


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
const { InfluxTelemetrySink } = require('./runtime/metrics/InfluxTelemetrySink');
const { GloveConfigService } = require('./runtime/glove/GloveConfigService');
const { AuthService } = require('./runtime/auth/AuthService');
const { createAuthRouter } = require('./runtime/routes/auth');
const { createManagersRouter } = require('./runtime/routes/managers');
const { createDevicesRouter } = require('./runtime/routes/devices');
const { createMappingsRouter } = require('./runtime/routes/mappings');
const { createScenesRouter } = require('./runtime/routes/scenes');
const { createNodesRouter } = require('./runtime/routes/nodes');
const { createRouteMetricsRouter } = require('./runtime/routes/routeMetrics');
const { createGlovesRouter } = require('./runtime/routes/gloves');
const { createTelemetryRouter } = require('./runtime/routes/telemetry');
const { createSystemRouter } = require('./runtime/routes/system');
const { createGloveSocketHub } = require('./runtime/ws/gloveSocket');
const { registerNodeAgentSocket } = require('./runtime/ws/nodeAgentSocket');
const { normalizeSensorPayload } = require('./runtime/utils');

try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

// optional: add dev defaults
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push(
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8080",
    "http://127.0.0.1:8080"
  );
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

// Parse cookies nicely for auth
app.use(cookieParser());

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
  cors: { origin: true, methods: ['GET', 'POST'], credentials: true },
});

const persistence = new PostgresStore();
const deviceRegistry = new DeviceRegistry({ persistence });
const nodeRegistry = new NodeRegistry({ persistence });
const managerService = new ManagerService({ persistence, nodeRegistry });
const deviceSyncService = new DeviceSyncService(managerService, deviceRegistry, { persistence });
const influxTelemetrySink = new InfluxTelemetrySink();
const telemetryService = new TelemetryService({ persistence, telemetrySink: influxTelemetrySink });
const routeMetricsService = new RouteMetricsService({ persistence, telemetryService });
const actionRouter = new ActionRouter(managerService, deviceRegistry, { routeMetricsService });
const mappingService = new MappingService({ persistence });
const sceneService = new SceneService(actionRouter, { persistence });
const gloveConfigService = new GloveConfigService({
  mappingService,
  deviceRegistry,
  managerService,
  nodeRegistry,
  persistence,
  telemetryService,
});
const authService = new AuthService();
let gloveSocketHub = null;

let currentMode = 'passive';

function setMode(mode, source = 'api') {
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (normalizedMode !== 'active' && normalizedMode !== 'passive') {
    throw new Error(`Invalid mode: ${mode}`);
  }

  currentMode = normalizedMode;
  console.log(`[Mode] ${source} set mode to ${currentMode}`);
  io.emit('modeUpdate', currentMode);
  gloveSocketHub?.broadcastModeUpdate(currentMode);
  void telemetryService.ingestBatch([
    {
      eventType: 'mode_changed',
      payload: { mode: currentMode, source },
    },
  ]);
  return currentMode;
}

async function handleSensorUpdate(data, source = 'unknown') {
  const latest = {
    ...normalizeSensorPayload(data),
    timestamp: new Date().toISOString(),
    source,
  };
  io.emit('sensorData', latest);
  return latest;
}

function publicStatus() {
  const system = systemStatus();
  return {
    mode: currentMode,
    system,
    realtime: {
      dashboardSocketPath: '/',
      gloveSocketPath: '/glove',
    },
    managers: managerService.getInfos(),
    nodes: nodeRegistry.getAll(),
    routeMetrics: routeMetricsService.list().slice(-20),
    telemetry: telemetryService.list().slice(-20),
    influxdb: system.influxdb,
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
    influxdb: {
      enabled: influxTelemetrySink.enabled,
      status: influxTelemetrySink.enabled ? (influxTelemetrySink.lastError ? 'error' : 'connected') : 'disabled',
      lastError: influxTelemetrySink.lastError || null,
      lastSuccessAt: influxTelemetrySink.lastSuccessAt || null,
    },
    websocketHub: {
      online: true,
      connectedNodeCount: io.of('/nodes').sockets.size,
      connectedDashboardCount: io.of('/').sockets.size,
      connectedGloveCount: gloveSocketHub?.getClientCount?.() || 0,
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

io.of('/').use((socket, next) => authService.authenticateDashboardSocket(socket, next));

io.of('/').on('connection', (socket) => {
  console.log('[WS] Dashboard connected:', socket.id);

  socket.emit('modeUpdate', currentMode);
  socket.emit('managers', managerService.getInfos());
  socket.emit('nodes', nodeRegistry.getAll());
  socket.emit('devices', deviceRegistry.getAll());

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

  socket.on('requestSensorSnapshot', (payload = {}, ack) => {
    const direct = gloveSocketHub?.requestSensorSnapshot?.(payload.gloveId) || 0;
    io.of('/nodes').emit('glove:requestSensorSnapshot', { gloveId: payload.gloveId });
    ack?.({ ok: direct > 0 || io.of('/nodes').sockets.size > 0, requested: direct });
  });

  socket.on('disconnect', () => {
    console.log('[WS] Dashboard disconnected:', socket.id);
  });
});

app.use('/api/auth', createAuthRouter({ authService }));

app.post('/api/data', authService.requireDashboardOrPicoToken(), async (req, res) => {
  try {
    await handleSensorUpdate(req.body, 'http');
    res.json({ ok: true, mode: currentMode });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/status', authService.requireDashboardAuth(), (req, res) => {
  res.json(publicStatus());
});

app.post('/api/mode', authService.requireDashboardOrPicoToken(), (req, res) => {
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
  influxTelemetrySink,
  gloveConfigService,
  systemStatus,
  authService,
};

app.use('/api/managers', authService.requireDashboardAuth(), createManagersRouter(services));
app.use('/api/devices', authService.requireDashboardAuth(), createDevicesRouter(services));
app.use('/api/mappings', authService.requireDashboardAuth(), createMappingsRouter(services));
app.use('/api/scenes', authService.requireDashboardAuth(), createScenesRouter(services));
app.use('/api/nodes', authService.requireDashboardAuth(), createNodesRouter(services));
app.use('/api/route-metrics', authService.requireDashboardAuth(), createRouteMetricsRouter(services));
app.use('/api/telemetry', authService.requireDashboardAuth(), createTelemetryRouter(services));
app.use('/api/system', authService.requireDashboardAuth(), createSystemRouter(services));
app.use('/api/gloves', authService.requireDashboardOrPicoToken(), createGlovesRouter(services));
registerNodeAgentSocket(io, services);
gloveSocketHub = createGloveSocketHub({
  server,
  authService,
  gloveConfigService,
  telemetryService,
  actionRouter,
  onSensorUpdate: handleSensorUpdate,
  getMode: () => currentMode,
  setMode,
});

const PORT = Number(process.env.PORT || 3001);
server.on('error', (err) => {
  console.error(`[Server] HTTP/WebSocket server failed on port ${PORT}: ${err.message}`);
  process.exitCode = 1;
});

async function start() {
  const authConfigErrors = authService.validateConfig();
  if (
    !process.env.NODE_SHARED_TOKEN &&
    !process.env.NODE_TOKEN &&
    !process.env.CENTRAL_NODE_TOKEN &&
    !process.env.NODE_TOKEN_MAP
  ) {
    authConfigErrors.push('NODE_SHARED_TOKEN, NODE_TOKEN, CENTRAL_NODE_TOKEN, or NODE_TOKEN_MAP is required');
  }
  if (authConfigErrors.length) {
    console.error(`[Auth] Startup failed: ${authConfigErrors.join('; ')}`);
    process.exitCode = 1;
    return;
  }

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
    console.log(`[Server] Glove websocket endpoint: ws://localhost:${PORT}/glove`);
  });
}

void start();
