const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mqtt = require('mqtt');

process.loadEnvFile();

const app = express();
app.use(cors());
app.use(express.json());

// Set up the HTTP server and WebSockets
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allows your Next.js app to connect
    methods: ["GET", "POST"]
  }
});

let currentMode = 'passive';

// --- MQTT SETUP (Talks to Pico) ---
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_TOPIC_SENSORS = 'gauntlet/sensors';
const MQTT_TOPIC_MODE = 'gauntlet/mode';

const mqttClient = mqtt.connect(MQTT_URL);

mqttClient.on('connect', () => {
  console.log(`MQTT connected: ${MQTT_URL}`);
  mqttClient.subscribe(MQTT_TOPIC_SENSORS);
  // Publish current mode on connect so the Pico syncs immediately
  mqttClient.publish(MQTT_TOPIC_MODE, currentMode.toUpperCase());
});

mqttClient.on('message', (topic, message) => {
  if (topic !== MQTT_TOPIC_SENSORS) return;

  try {
    const data = JSON.parse(message.toString());
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
    console.error('MQTT sensor parse error:', err);
  }
});

// --- WEBSOCKET CONNECTION (Talks to React) ---
io.on('connection', (socket) => {
  console.log('Frontend connected:', socket.id);
  
  // Send the current mode to the dashboard as soon as it loads
  socket.emit('modeUpdate', currentMode);

  // Listen for the dashboard clicking 'Active' or 'Passive'
  socket.on('setMode', (mode) => {
    currentMode = mode;
    console.log('Mode changed to:', mode);
    io.emit('modeUpdate', currentMode); // Update all connected screens
    if (mqttClient.connected) {
      mqttClient.publish(MQTT_TOPIC_MODE, currentMode.toUpperCase());
    }
  });

  socket.on('disconnect', () => {
    console.log('Frontend disconnected');
  });
});

// --- HTTP ENDPOINT (Talks to Pico) ---
// The Pico will send a POST request here 50 times a second
app.post('/api/data', (req, res) => {
  const { x, y, z, gx, gy, gz } = req.body;
  
  if (currentMode === 'passive') {
    // Blast the sensor data to the React dashboard instantly
    io.emit('sensorData', { x, y, z, gx, gy, gz });
  }

  // Reply to the Pico with the current mode so it knows if it should display ACTIVE
  res.json({ mode: currentMode });
});

const PORT = process.env.PORT;
server.listen(PORT, () => {
  console.log(`Gestura Broker running on http://localhost:${PORT}`);
});
