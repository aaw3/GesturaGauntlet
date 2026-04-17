const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const net = require('net');
const aedes = require('aedes')();
const kasa = require('./kasa');
 
process.loadEnvFile();
 
const app = express();
app.use(cors());
app.use(express.json());
 
// ─── MQTT Broker (embedded — no external Mosquitto needed) ────────────────────
 
const MQTT_BROKER_PORT = Number(process.env.MQTT_BROKER_PORT || 1883);
const brokerServer = net.createServer(aedes.handle);
brokerServer.listen(MQTT_BROKER_PORT, () => {
  console.log(`[MQTT] Broker listening on tcp://0.0.0.0:${MQTT_BROKER_PORT}`);
});
 
aedes.on('clientReady', (client) => {
  console.log(`[MQTT] Client connected    : ${client?.id ?? 'unknown'}`);
});
aedes.on('clientDisconnect', (client) => {
  console.log(`[MQTT] Client disconnected : ${client?.id ?? 'unknown'}`);
});
 
// ─── MQTT Topics ──────────────────────────────────────────────────────────────
 
const MQTT_TOPIC_SENSORS = 'gauntlet/sensors';
const MQTT_TOPIC_MODE    = 'gauntlet/mode';
 
/** Publish the current mode to the Pico via the embedded broker. */
function publishMode(mode) {
  aedes.publish({
    topic:   MQTT_TOPIC_MODE,
    payload: Buffer.from(String(mode).toUpperCase()),
    qos:     0,
    retain:  true,   // retain=true so a reconnecting Pico gets it immediately
  });
}

// Relay broker publishes to the frontend
aedes.on('publish', (packet, client) => {
  
  // 1. Handle Sensor Data
  if (packet.topic === MQTT_TOPIC_SENSORS) {
    try {
      const data = JSON.parse(packet.payload.toString());
      const payload = {
        x: data.x ?? 0,
        y: data.y ?? 0,
        z: data.z ?? 0,
        gx: data.gx ?? 0,
        gy: data.gy ?? 0,
        gz: data.gz ?? 0
      };
      // Only blast sensor data if we are in passive mode
      if (currentMode === 'passive') {
        io.emit('sensorData', payload);
      }
    } catch (err) {
      console.error('MQTT sensor parse error:', err);
    }
  }

  const raw = packet.payload ? packet.payload.toString() : '';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    console.warn(
      'MQTT sensor payload ignored (not JSON):',
      trimmed.slice(0, 120)
    );
    return;
  }

  try {
    const data = JSON.parse(trimmed);
    // console.log(
    //   `MQTT sensor update from ${client && client.id ? client.id : 'unknown'}: ` +
    //   `x=${data.x ?? 0}, y=${data.y ?? 0}, z=${data.z ?? 0}, ` +
    //   `gx=${data.gx ?? 0}, gy=${data.gy ?? 0}, gz=${data.gz ?? 0}`
    // );
    const payload = {
      x: data.x ?? 0,
      y: data.y ?? 0,
      z: data.z ?? 0,
      gx: data.gx ?? 0,
      gy: data.gy ?? 0,
      gz: data.gz ?? 0
    };
    io.emit('sensorData', payload);
  } catch (err) {
    console.error('MQTT sensor parse error:', err, 'payload=', trimmed.slice(0, 120));
  // 2. NEW: Handle Mode Toggles from the physical double-tap
  if (packet.topic === MQTT_TOPIC_MODE && client) {
    // The "client" check ensures we don't react to our own server messages
    const newMode = packet.payload.toString().toLowerCase();
    
    if (newMode === 'active' || newMode === 'passive') {
      currentMode = newMode;
      console.log('Hardware button toggled mode to:', currentMode);
      
      // Tell the React dashboard to flip its UI instantly
      io.emit('modeUpdate', currentMode);
    }
  }
}
});
 
// ─── Focus Score Engine ───────────────────────────────────────────────────────
 
const WINDOW_SIZE      = 50;    // ~1 second at 50Hz
const FIDGET_THRESHOLD = 0.08;  // variance above = excessive movement
const STILL_THRESHOLD  = 0.002; // variance below = zoned out / AFK
const SCORE_SMOOTHING  = 0.1;   // EMA alpha
 
const accelWindow    = [];
let focusScore       = 75;
let currentMode      = 'passive';
let lastKasaActionAt = 0;
 
/**
 * Variance of blended accel+gyro magnitudes across the rolling window.
 * Gyro catches rotational fidgeting that accel alone misses.
 */
function computeVariance(window) {
  if (window.length < 2) return 0;
  const magnitudes = window.map(s => {
    const accel = Math.sqrt(s.x ** 2 + s.y ** 2 + s.z ** 2);
    const gyro  = Math.sqrt(s.gx ** 2 + s.gy ** 2 + s.gz ** 2) / 250;
    return accel * 0.7 + gyro * 0.3;
  });
  const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
  return magnitudes.reduce((sum, m) => sum + (m - mean) ** 2, 0) / magnitudes.length;
}
 
/** EMA-smoothed focus score. Fidgeting and stillness both penalize. */
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
 
/** Drive Kasa based on focus thresholds. Debounced to once per 10 seconds. */
async function handleFocusAction(score) {
  const now = Date.now();
  if (now - lastKasaActionAt < 10_000) return;
 
  if (score < 25) {
    lastKasaActionAt = now;
    console.log(`[Focus] Critical (${score}) — enforcing break`);
    await kasa.setPlugPower(false);
    await kasa.applyBreakPreset();
  } else if (score < 50) {
    lastKasaActionAt = now;
    console.log(`[Focus] Low (${score}) — nudging`);
    await kasa.applyAlertPreset();
  } else if (score >= 80) {
    lastKasaActionAt = now;
    console.log(`[Focus] Good (${score}) — restoring focus env`);
    await kasa.setPlugPower(true);
    await kasa.applyFocusedPreset();
  }
}
 
// ─── HTTP + WebSocket Server ──────────────────────────────────────────────────
 
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
 
io.on('connection', (socket) => {
  console.log('[WS] Dashboard connected:', socket.id);
 
  socket.emit('modeUpdate', currentMode);
  socket.emit('focusScore', Math.round(focusScore));
  publishMode(currentMode); // sync Pico on new dashboard connection
 
  socket.on('setMode', async (mode) => {
    currentMode = mode;
    console.log('[WS] Mode changed to:', mode);
    io.emit('modeUpdate', currentMode);
    publishMode(currentMode);
    if (mode === 'active') {
      await kasa.setPlugPower(true);
      await kasa.applyFocusedPreset();
    }
  });
 
  socket.on('setPlug', async ({ state }) => {
    const result = await kasa.setPlugPower(state);
    socket.emit('plugResult', result);
  });
 
  socket.on('setBulb', async (lightState) => {
    const result = await kasa.setBulbState(lightState);
    socket.emit('bulbResult', result);
  });
 
  socket.on('sendMessage', (message) => {
    console.log('[WS] OLED message:', message);
  });
 
  socket.on('disconnect', () => {
    console.log('[WS] Dashboard disconnected:', socket.id);
  });
});
 
// ─── HTTP Endpoints ───────────────────────────────────────────────────────────
 
// Fallback for HTTP-based Pico testing
app.post('/api/data', (req, res) => {
  const { x, y, z, gx, gy, gz } = req.body;
  if (currentMode === 'passive') io.emit('sensorData', { x, y, z, gx, gy, gz });
  res.json({ mode: currentMode });
});
 
app.get('/api/status', (req, res) => {
  res.json({
    mode:       currentMode,
    focusScore: Math.round(focusScore),
    windowSize: accelWindow.length,
  });
});
 
// ─── Boot ─────────────────────────────────────────────────────────────────────
 
const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, () => {
  console.log(`[Server] Gestura Broker on http://localhost:${PORT}`);
  console.log(`[Server] Kasa Plug IP : ${process.env.PLUG_IP || '⚠  PLUG_IP not set'}`);
  console.log(`[Server] Kasa Bulb IP : ${process.env.BULB_IP || '⚠  BULB_IP not set'}`);
});