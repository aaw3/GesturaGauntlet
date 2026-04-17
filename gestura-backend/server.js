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

// --- MQTT BROKER (Hosts the broker locally) ---
const MQTT_BROKER_PORT = Number(process.env.MQTT_BROKER_PORT || 1883);
const brokerServer = net.createServer(aedes.handle);
brokerServer.listen(MQTT_BROKER_PORT, () => {
  console.log(`MQTT broker listening on tcp://0.0.0.0:${MQTT_BROKER_PORT}`);
});

// Broker connection logs
aedes.on('clientReady', (client) => {
  console.log(`MQTT client connected: ${client && client.id ? client.id : 'unknown'}`);
});
aedes.on('clientDisconnect', (client) => {
  console.log(`MQTT client disconnected: ${client && client.id ? client.id : 'unknown'}`);
});

// Set up the HTTP server and WebSockets
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allows your Next.js app to connect
    methods: ["GET", "POST"]
  }
});

let currentMode = 'passive';

// --- MQTT TOPICS (Broker-owned) ---
const MQTT_TOPIC_SENSORS = 'gauntlet/sensors';
const MQTT_TOPIC_MODE = 'gauntlet/mode';

function publishMode(mode) {
  aedes.publish({
    topic: MQTT_TOPIC_MODE,
    payload: Buffer.from(String(mode).toUpperCase()),
    qos: 0,
    retain: true
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
  }

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
});

// --- WEBSOCKET CONNECTION (Talks to React) ---
io.on('connection', (socket) => {
  console.log('Frontend connected:', socket.id);
  
  // Send the current mode to the dashboard as soon as it loads
  socket.emit('modeUpdate', currentMode);
  // Sync the Pico immediately on new frontend connections
  publishMode(currentMode);

  // Listen for the dashboard clicking 'Active' or 'Passive'
  socket.on('setMode', (mode) => {
    currentMode = mode;
    console.log('Mode changed to:', mode);
    io.emit('modeUpdate', currentMode); // Update all connected screens
    publishMode(currentMode);
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

const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, () => {
  console.log(`Gestura Broker running on http://localhost:${PORT}`);
});
