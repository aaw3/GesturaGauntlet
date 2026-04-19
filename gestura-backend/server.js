const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const net = require('net');
const aedes = require('aedes')();

process.loadEnvFile();

const app = express();
app.use(cors());
app.use(express.json());

// --- MQTT BROKER ---
const MQTT_BROKER_PORT = Number(process.env.MQTT_BROKER_PORT || 1883);
const brokerServer = net.createServer(aedes.handle);
brokerServer.listen(MQTT_BROKER_PORT, () => {
  console.log(`MQTT broker listening on tcp://0.0.0.0:${MQTT_BROKER_PORT}`);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let currentMode = 'passive';
let isInternalPublish = false; // Flag to prevent feedback loops

// --- MQTT TOPICS ---
const MQTT_TOPIC_SENSORS = 'gauntlet/sensors';
const MQTT_TOPIC_MODE = 'gauntlet/mode';

function publishMode(mode) {
  const payload = String(mode).toUpperCase();
  console.log(`[Server] Publishing mode to MQTT: ${payload}`);
  
  isInternalPublish = true;
  aedes.publish({
    topic: MQTT_TOPIC_MODE,
    payload: Buffer.from(payload),
    qos: 0,
    retain: true
  }, () => {
    isInternalPublish = false;
  });
}

// Relay broker publishes to the frontend
aedes.on('publish', (packet, client) => {
  if (packet.topic.startsWith('$SYS')) return;

  // 1. Sensor Data
  if (packet.topic === MQTT_TOPIC_SENSORS) {
    try {
      const data = JSON.parse(packet.payload.toString());
      io.emit('sensorData', {
        x: data.x ?? 0, y: data.y ?? 0, z: data.z ?? 0,
        gx: data.gx ?? 0, gy: data.gy ?? 0, gz: data.gz ?? 0,
        pressure: data.pressure ?? 0
      });
    } catch (err) {}
    return;
  }

  // 2. Mode Toggles (From Pico or Server)
  if (packet.topic === MQTT_TOPIC_MODE) {
    // If it's internal, we already updated currentMode and emitted to Socket.IO in setMode
    if (isInternalPublish) return;

    const rawMode = packet.payload.toString().toLowerCase().trim();
    if (rawMode === 'active' || rawMode === 'passive') {
      if (rawMode !== currentMode) {
        currentMode = rawMode;
        console.log(`[Hardware] Mode changed to: ${currentMode}`);
        io.emit('modeUpdate', currentMode);
      }
    }
  }
});

// --- WEBSOCKETS ---
io.on('connection', (socket) => {
  console.log(`[Socket] Frontend connected: ${socket.id}`);
  socket.emit('modeUpdate', currentMode);

  socket.on('getMode', () => {
    socket.emit('modeUpdate', currentMode);
  });

  socket.on('setMode', (mode) => {
    const targetMode = mode.toLowerCase();
    console.log(`[Dashboard] Requesting mode: ${targetMode}`);
    currentMode = targetMode;
    io.emit('modeUpdate', currentMode);
    publishMode(currentMode);
  });

  socket.on('disconnect', () => console.log('[Socket] Frontend disconnected'));
});

// --- HTTP FALLBACK ---
app.post('/api/data', (req, res) => {
  io.emit('sensorData', req.body);
  res.json({ mode: currentMode });
});

const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, () => {
  console.log(`Gestura Backend running on http://localhost:${PORT}`);
});
