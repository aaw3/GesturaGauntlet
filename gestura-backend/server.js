const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const net = require('net');
const aedes = require('aedes')();
const kasa = require('./kasa');

try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const app = express();
app.use(cors());
app.use(express.json());

// HTTP + WebSocket server is created before MQTT callbacks so live sensor
// updates can always be forwarded to dashboards.
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// MQTT Topics
const MQTT_TOPIC_SENSORS = 'gauntlet/sensors';
const MQTT_TOPIC_MODE = 'gauntlet/mode';

// Focus Score Engine
const WINDOW_SIZE = Number(process.env.FOCUS_WINDOW_SIZE || 50); // ~1 second at 50Hz
const FIDGET_THRESHOLD = Number(process.env.FIDGET_THRESHOLD || 0.08);
const STILL_THRESHOLD = Number(process.env.STILL_THRESHOLD || 0.002);
const SCORE_SMOOTHING = Number(process.env.SCORE_SMOOTHING || 0.1);
const FOCUS_KASA_ACTIONS_ENABLED = String(process.env.FOCUS_KASA_ACTIONS_ENABLED || 'true') !== 'false';

const accelWindow = [];
let focusScore = 75;
let currentMode = 'passive';
let lastKasaActionAt = 0;
let lastFocusEmitAt = 0;

// Live Sensor State
const SENSOR_HISTORY_SIZE = Number(process.env.SENSOR_HISTORY_SIZE || 200);
const sensorHistory = [];
const liveSensorState = {
  latest: null,
  sampleCount: 0,
  lastUpdatedAt: null,
  source: null,
};

// Live X-axis -> Kasa bulb brightness control.
// Default: only active mode drives the bulb. Use GYRO_BULB_CONTROL_MODE=always
// if you want passive dashboard viewing and bulb control at the same time.
const gyroBulbControl = {
  enabled: String(process.env.GYRO_BULB_CONTROL_ENABLED || 'true') !== 'false',
  mode: process.env.GYRO_BULB_CONTROL_MODE || 'active', // active | passive | always
  axis: process.env.GYRO_BULB_AXIS || 'x',
  axisMin: Number(process.env.GYRO_BULB_AXIS_MIN || -1),
  axisMax: Number(process.env.GYRO_BULB_AXIS_MAX || 1),
  smoothing: Number(process.env.GYRO_BULB_SMOOTHING || 0.6),
  throttleMs: Number(process.env.GYRO_BULB_THROTTLE_MS || 125),
  minBrightnessDelta: Number(process.env.GYRO_BULB_MIN_DELTA || 1),
  transitionMs: Number(process.env.GYRO_BULB_TRANSITION_MS || 80),
  powerOffAtZero: String(process.env.GYRO_BULB_POWER_OFF_AT_ZERO || 'true') !== 'false',
  smoothedAxis: null,
  lastBrightness: null,
  lastSentAt: 0,
  inFlight: false,
  pending: null,
  pendingTimer: null,
  lastResult: null,
};

function publishMode(mode) {
  aedes.publish({
    topic: MQTT_TOPIC_MODE,
    payload: Buffer.from(String(mode).toUpperCase()),
    qos: 0,
    retain: true,
  });
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSensorPayload(data = {}) {
  return {
    x: toFiniteNumber(data.x ?? data.ax ?? data.accel_x),
    y: toFiniteNumber(data.y ?? data.ay ?? data.accel_y),
    z: toFiniteNumber(data.z ?? data.az ?? data.accel_z),
    gx: toFiniteNumber(data.gx ?? data.gyro_x),
    gy: toFiniteNumber(data.gy ?? data.gyro_y),
    gz: toFiniteNumber(data.gz ?? data.gyro_z),
  };
}

function parseJsonPayload(buffer) {
  const raw = buffer ? buffer.toString() : '';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    throw new Error(`Payload is not JSON: ${trimmed.slice(0, 120)}`);
  }
  return JSON.parse(trimmed);
}

function computeVariance(window) {
  if (window.length < 2) return 0;
  const magnitudes = window.map((sample) => {
    const accel = Math.sqrt(sample.x ** 2 + sample.y ** 2 + sample.z ** 2);
    const gyro = Math.sqrt(sample.gx ** 2 + sample.gy ** 2 + sample.gz ** 2) / 250;
    return accel * 0.7 + gyro * 0.3;
  });
  const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
  return magnitudes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / magnitudes.length;
}

function updateFocusScore(variance) {
  let target;
  if (variance > FIDGET_THRESHOLD) {
    target = Math.max(0, 100 - (variance / FIDGET_THRESHOLD) * 40);
  } else if (variance < STILL_THRESHOLD) {
    target = Math.max(0, focusScore - 0.5);
  } else {
    target = Math.min(100, focusScore + 1);
  }

  focusScore = focusScore * (1 - SCORE_SMOOTHING) + target * SCORE_SMOOTHING;
  return Math.round(focusScore);
}

function isGyroBulbControlActive() {
  if (!gyroBulbControl.enabled) return false;
  if (gyroBulbControl.mode === 'always') return true;
  return gyroBulbControl.mode === currentMode;
}

async function handleFocusAction(score) {
  if (!FOCUS_KASA_ACTIONS_ENABLED) return;

  const now = Date.now();
  if (now - lastKasaActionAt < 10_000) return;

  const gyroOwnsBulb = isGyroBulbControlActive();

  if (score < 25) {
    lastKasaActionAt = now;
    console.log(`[Focus] Critical (${score}) - enforcing break`);
    await kasa.setPlugPower(false);
    if (!gyroOwnsBulb) await kasa.applyBreakPreset();
  } else if (score < 50) {
    lastKasaActionAt = now;
    console.log(`[Focus] Low (${score}) - nudging`);
    if (!gyroOwnsBulb) await kasa.applyAlertPreset();
  } else if (score >= 80) {
    lastKasaActionAt = now;
    console.log(`[Focus] Good (${score}) - restoring focus env`);
    await kasa.setPlugPower(true);
    if (!gyroOwnsBulb) await kasa.applyFocusedPreset();
  }
}

function brightnessChangedEnough(brightness) {
  return (
    gyroBulbControl.lastBrightness === null ||
    Math.abs(brightness - gyroBulbControl.lastBrightness) >= gyroBulbControl.minBrightnessDelta
  );
}

function schedulePendingGyroBulbUpdate(delayMs) {
  if (gyroBulbControl.pendingTimer) return;

  gyroBulbControl.pendingTimer = setTimeout(() => {
    gyroBulbControl.pendingTimer = null;
    const pending = gyroBulbControl.pending;
    gyroBulbControl.pending = null;
    if (!pending || !brightnessChangedEnough(pending.brightness)) return;

    void sendGyroBulbBrightness(pending).catch((err) => {
      console.error('[GyroBulb] Pending control error:', err.message);
    });
  }, Math.max(0, delayMs));
}

async function sendGyroBulbBrightness(update) {
  if (gyroBulbControl.inFlight) {
    gyroBulbControl.pending = update;
    return;
  }

  const now = Date.now();
  const elapsed = now - gyroBulbControl.lastSentAt;
  if (elapsed < gyroBulbControl.throttleMs) {
    gyroBulbControl.pending = update;
    schedulePendingGyroBulbUpdate(gyroBulbControl.throttleMs - elapsed);
    return;
  }

  gyroBulbControl.inFlight = true;
  gyroBulbControl.lastSentAt = now;
  gyroBulbControl.lastBrightness = update.brightness;

  try {
    const result = await kasa.setBulbBrightness(update.brightness, {
      transitionMs: gyroBulbControl.transitionMs,
      powerOffAtZero: gyroBulbControl.powerOffAtZero,
    });

    gyroBulbControl.lastResult = {
      ...result,
      axis: gyroBulbControl.axis,
      axisValue: update.axisValue,
      smoothedAxis: update.smoothedAxis,
      brightness: update.brightness,
      updatedAt: new Date().toISOString(),
    };

    io.emit('gyroBulbUpdate', gyroBulbControl.lastResult);
  } finally {
    gyroBulbControl.inFlight = false;

    const pending = gyroBulbControl.pending;
    if (pending && brightnessChangedEnough(pending.brightness)) {
      schedulePendingGyroBulbUpdate(gyroBulbControl.throttleMs);
    }
  }
}

async function handleGyroBulbControl(sensor) {
  if (!isGyroBulbControlActive()) return;

  const rawAxis = toFiniteNumber(sensor[gyroBulbControl.axis], NaN);
  if (!Number.isFinite(rawAxis)) return;

  const alpha = Math.max(0, Math.min(1, gyroBulbControl.smoothing));
  gyroBulbControl.smoothedAxis = gyroBulbControl.smoothedAxis === null
    ? rawAxis
    : gyroBulbControl.smoothedAxis * (1 - alpha) + rawAxis * alpha;

  const brightness = kasa.axisToPercent(
    gyroBulbControl.smoothedAxis,
    gyroBulbControl.axisMin,
    gyroBulbControl.axisMax
  );

  const now = Date.now();
  const update = {
    axis: gyroBulbControl.axis,
    axisValue: rawAxis,
    smoothedAxis: gyroBulbControl.smoothedAxis,
    brightness,
    queuedAt: now,
  };

  if (!brightnessChangedEnough(brightness)) return;
  await sendGyroBulbBrightness(update);
}

async function handleSensorUpdate(data, source = 'unknown') {
  const payload = normalizeSensorPayload(data);
  const timestamp = new Date().toISOString();

  liveSensorState.latest = { ...payload, timestamp };
  liveSensorState.sampleCount += 1;
  liveSensorState.lastUpdatedAt = timestamp;
  liveSensorState.source = source;

  sensorHistory.push(liveSensorState.latest);
  while (sensorHistory.length > SENSOR_HISTORY_SIZE) sensorHistory.shift();

  io.emit('sensorData', liveSensorState.latest);

  accelWindow.push(payload);
  while (accelWindow.length > WINDOW_SIZE) accelWindow.shift();

  const score = updateFocusScore(computeVariance(accelWindow));
  const now = Date.now();
  if (now - lastFocusEmitAt >= 250) {
    lastFocusEmitAt = now;
    io.emit('focusScore', score);
  }

  void handleFocusAction(score).catch((err) => {
    console.error('[Focus] Kasa action error:', err.message);
  });
  void handleGyroBulbControl(payload).catch((err) => {
    console.error('[GyroBulb] Control error:', err.message);
  });
}

function updateGyroBulbControl(nextConfig = {}) {
  if (nextConfig.enabled !== undefined) {
    gyroBulbControl.enabled = parseBoolean(nextConfig.enabled, gyroBulbControl.enabled);
  }
  if (nextConfig.mode !== undefined && ['active', 'passive', 'always'].includes(nextConfig.mode)) {
    gyroBulbControl.mode = nextConfig.mode;
  }
  if (nextConfig.axis !== undefined && ['x', 'y', 'z', 'gx', 'gy', 'gz'].includes(nextConfig.axis)) {
    gyroBulbControl.axis = nextConfig.axis;
    gyroBulbControl.smoothedAxis = null;
    gyroBulbControl.pending = null;
  }

  for (const key of ['axisMin', 'axisMax', 'smoothing', 'throttleMs', 'minBrightnessDelta', 'transitionMs']) {
    if (nextConfig[key] !== undefined) gyroBulbControl[key] = toFiniteNumber(nextConfig[key], gyroBulbControl[key]);
  }

  gyroBulbControl.smoothing = Math.max(0, Math.min(1, gyroBulbControl.smoothing));
  gyroBulbControl.throttleMs = Math.max(75, gyroBulbControl.throttleMs);
  gyroBulbControl.minBrightnessDelta = Math.max(0, gyroBulbControl.minBrightnessDelta);
  gyroBulbControl.transitionMs = Math.max(0, gyroBulbControl.transitionMs);

  if (nextConfig.powerOffAtZero !== undefined) {
    gyroBulbControl.powerOffAtZero = parseBoolean(nextConfig.powerOffAtZero, gyroBulbControl.powerOffAtZero);
  }

  io.emit('gyroBulbControl', publicGyroBulbControl());
  return publicGyroBulbControl();
}

function publicGyroBulbControl() {
  return {
    enabled: gyroBulbControl.enabled,
    mode: gyroBulbControl.mode,
    active: isGyroBulbControlActive(),
    axis: gyroBulbControl.axis,
    axisMin: gyroBulbControl.axisMin,
    axisMax: gyroBulbControl.axisMax,
    smoothing: gyroBulbControl.smoothing,
    throttleMs: gyroBulbControl.throttleMs,
    minBrightnessDelta: gyroBulbControl.minBrightnessDelta,
    transitionMs: gyroBulbControl.transitionMs,
    powerOffAtZero: gyroBulbControl.powerOffAtZero,
    inFlight: gyroBulbControl.inFlight,
    pendingBrightness: gyroBulbControl.pending?.brightness ?? null,
    smoothedAxis: gyroBulbControl.smoothedAxis,
    lastBrightness: gyroBulbControl.lastBrightness,
    lastResult: gyroBulbControl.lastResult,
  };
}

// MQTT Broker (embedded - no external Mosquitto needed)
const MQTT_BROKER_PORT = Number(process.env.MQTT_BROKER_PORT || 1883);
const brokerServer = net.createServer(aedes.handle);
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

  if (packet.topic === MQTT_TOPIC_MODE && client) {
    const newMode = packet.payload.toString().trim().toLowerCase();
    if (newMode === 'active' || newMode === 'passive') {
      currentMode = newMode;
      console.log('[MQTT] Hardware mode changed to:', currentMode);
      io.emit('modeUpdate', currentMode);
      io.emit('gyroBulbControl', publicGyroBulbControl());
    }
  }
});

// WebSocket API
io.on('connection', (socket) => {
  console.log('[WS] Dashboard connected:', socket.id);

  socket.emit('modeUpdate', currentMode);
  socket.emit('focusScore', Math.round(focusScore));
  socket.emit('sensorStatus', liveSensorState);
  socket.emit('gyroBulbControl', publicGyroBulbControl());
  publishMode(currentMode);

  socket.on('setMode', async (mode) => {
    if (mode !== 'active' && mode !== 'passive') {
      socket.emit('modeResult', { success: false, error: `Invalid mode: ${mode}` });
      return;
    }

    currentMode = mode;
    console.log('[WS] Mode changed to:', mode);
    io.emit('modeUpdate', currentMode);
    io.emit('gyroBulbControl', publicGyroBulbControl());
    publishMode(currentMode);

    if (mode === 'active') {
      await kasa.setPlugPower(true);
      if (!isGyroBulbControlActive()) await kasa.applyFocusedPreset();
    }

    socket.emit('modeResult', { success: true, mode: currentMode });
  });

  socket.on('setGyroBulbControl', (config) => {
    socket.emit('gyroBulbControl', updateGyroBulbControl(config));
  });

  socket.on('setPlug', async ({ state } = {}) => {
    const result = await kasa.setPlugPower(state);
    socket.emit('plugResult', result);
  });

  socket.on('setBulb', async (lightState) => {
    const result = await kasa.setBulbState(lightState);
    socket.emit('bulbResult', result);
  });

  socket.on('setBulbBrightness', async ({ brightness, transitionMs } = {}) => {
    const result = await kasa.setBulbBrightness(brightness, { transitionMs });
    socket.emit('bulbResult', result);
  });

  socket.on('applyBulbPreset', async ({ preset } = {}) => {
    const result = await kasa.applyPreset(preset);
    socket.emit('bulbResult', result);
  });

  socket.on('getKasaStatus', async () => {
    socket.emit('kasaStatus', await kasa.getDeviceStatus());
  });

  socket.on('sendMessage', (message) => {
    console.log('[WS] OLED message:', message);
  });

  socket.on('disconnect', () => {
    console.log('[WS] Dashboard disconnected:', socket.id);
  });
});

// HTTP Endpoints
app.post('/api/data', async (req, res) => {
  try {
    await handleSensorUpdate(req.body, 'http');
    res.json({ mode: currentMode, sensor: liveSensorState.latest, gyroBulbControl: publicGyroBulbControl() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    mode: currentMode,
    focusScore: Math.round(focusScore),
    windowSize: accelWindow.length,
    sensor: liveSensorState,
    gyroBulbControl: publicGyroBulbControl(),
  });
});

app.get('/api/sensors/latest', (req, res) => {
  res.json(liveSensorState.latest || {});
});

app.get('/api/sensors/history', (req, res) => {
  res.json(sensorHistory);
});

app.post('/api/mode', (req, res) => {
  const mode = req.body?.mode;
  if (mode !== 'active' && mode !== 'passive') {
    res.status(400).json({ error: `Invalid mode: ${mode}` });
    return;
  }
  currentMode = mode;
  publishMode(currentMode);
  io.emit('modeUpdate', currentMode);
  io.emit('gyroBulbControl', publicGyroBulbControl());
  res.json({ success: true, mode: currentMode });
});

app.get('/api/kasa/status', async (req, res) => {
  res.json(await kasa.getDeviceStatus());
});

app.post('/api/kasa/plug', async (req, res) => {
  res.json(await kasa.setPlugPower(req.body?.state));
});

app.post('/api/kasa/bulb', async (req, res) => {
  res.json(await kasa.setBulbState(req.body || {}));
});

app.post('/api/kasa/bulb/brightness', async (req, res) => {
  res.json(await kasa.setBulbBrightness(req.body?.brightness, {
    transitionMs: req.body?.transitionMs,
    powerOffAtZero: req.body?.powerOffAtZero,
  }));
});

app.post('/api/kasa/bulb/axis', async (req, res) => {
  res.json(await kasa.setBulbBrightnessFromAxis(req.body?.value, {
    axisMin: req.body?.axisMin ?? -1,
    axisMax: req.body?.axisMax ?? 1,
    transitionMs: req.body?.transitionMs,
    powerOffAtZero: req.body?.powerOffAtZero ?? true,
  }));
});

app.post('/api/kasa/bulb/preset', async (req, res) => {
  res.json(await kasa.applyPreset(req.body?.preset));
});

app.get('/api/gyro-bulb-control', (req, res) => {
  res.json(publicGyroBulbControl());
});

app.post('/api/gyro-bulb-control', (req, res) => {
  res.json(updateGyroBulbControl(req.body || {}));
});

// Boot
const PORT = Number(process.env.PORT || 3001);
server.on('error', (err) => {
  console.error(`[Server] HTTP/WebSocket server failed on port ${PORT}: ${err.message}`);
  process.exitCode = 1;
});
server.listen(PORT, () => {
  console.log(`[Server] Gestura Broker on http://localhost:${PORT}`);
  console.log(`[Server] Kasa Plug IP : ${process.env.PLUG_IP || 'PLUG_IP not set'}`);
  console.log(`[Server] Kasa Bulb IP : ${process.env.BULB_IP || 'BULB_IP not set'}`);
  console.log(`[Server] Gyro bulb   : ${gyroBulbControl.enabled ? 'enabled' : 'disabled'} (${gyroBulbControl.axis} ${gyroBulbControl.axisMin}..${gyroBulbControl.axisMax} -> 0..100%, mode=${gyroBulbControl.mode})`);
});
