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
const { createManagersRouter } = require('./runtime/routes/managers');
const { createDevicesRouter } = require('./runtime/routes/devices');
const { createMappingsRouter } = require('./runtime/routes/mappings');
const { createScenesRouter } = require('./runtime/routes/scenes');
const { createExternalManager } = require('./runtime/managers/externalManager');
const { createKasaManager } = require('./runtime/managers/kasaManager');

try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const app = express();
app.use(cors());
app.use(express.json());

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
const managerService = new ManagerService({ persistence });
const deviceSyncService = new DeviceSyncService(managerService, deviceRegistry, { persistence });
const actionRouter = new ActionRouter(managerService, deviceRegistry);
const mappingService = new MappingService({ persistence });
const sceneService = new SceneService(actionRouter, { persistence });
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
  return {
    mode: currentMode,
    sensor: sensorStore.getState(),
    mqtt: {
      brokerUrl: `tcp://localhost:${MQTT_BROKER_PORT}`,
      topics: {
        mode: MQTT_TOPIC_MODE,
        sensors: MQTT_TOPIC_SENSORS,
      },
    },
    managers: managerService.getInfos(),
    deviceCount: deviceRegistry.getAll().length,
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
};

app.use('/api/managers', createManagersRouter(services));
app.use('/api/devices', createDevicesRouter(services));
app.use('/api/mappings', createMappingsRouter(services));
app.use('/api/scenes', createScenesRouter(services));

const PORT = Number(process.env.PORT || 3001);
server.on('error', (err) => {
  console.error(`[Server] HTTP/WebSocket server failed on port ${PORT}: ${err.message}`);
  process.exitCode = 1;
});

async function hydrateManagersFromPersistence() {
  const managerConfigs = await persistence.listManagerConfigs();

  for (const config of managerConfigs) {
    try {
      if (config.integrationType === 'external') {
        await managerService.register(
          createExternalManager({
            info: {
              id: config.id,
              name: config.name,
              kind: config.kind,
              version: config.version,
              online: config.online,
              supportsDiscovery: config.supportsDiscovery,
              supportsBulkActions: config.supportsBulkActions,
              integrationType: 'external',
              metadata: config.metadata,
            },
            baseUrl: config.baseUrl,
            authToken: config.authToken,
          }),
          config,
        );
      } else if (config.kind === 'kasa') {
        await managerService.register(
          createKasaManager({
            id: config.id,
            name: config.name,
            discoveryTimeoutMs: Number(config.config?.discoveryTimeoutMs || 3000),
            scanIntervalMs: Number(config.config?.scanIntervalMs || 5 * 60 * 1000),
          }),
          config,
        );
      }

      await deviceSyncService.syncManager(config.id);
    } catch (err) {
      console.error(`[Persistence] Failed to hydrate manager ${config.id}: ${err.message}`);
    }
  }
}

async function start() {
  try {
    const persistenceEnabled = await persistence.init();
    if (persistenceEnabled) {
      await mappingService.loadPersisted();
      await sceneService.loadPersisted();
      await hydrateManagersFromPersistence();
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
