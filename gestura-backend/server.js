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

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// --- MQTT TOPICS ---
const MQTT_TOPIC_SENSORS = 'gauntlet/sensors';
const MQTT_TOPIC_MODE = 'gauntlet/mode';

function resolveBrokerPort() {
  const explicitPort = Number(process.env.MQTT_BROKER_PORT);
  if (Number.isFinite(explicitPort) && explicitPort > 0) {
    return explicitPort;
  }

  const mqttUrl = process.env.MQTT_URL;
  if (mqttUrl) {
    try {
      const normalized = mqttUrl.includes('://') ? mqttUrl : `mqtt://${mqttUrl}`;
      const parsed = new URL(normalized);
      const urlPort = Number(parsed.port || 1883);
      if (Number.isFinite(urlPort) && urlPort > 0) {
        return urlPort;
      }
    } catch (err) {
      console.warn(`[MQTT] Ignoring invalid MQTT_URL: ${err.message}`);
    }
  }

  return 1883;
}

// --- MQTT BROKER ---
const MQTT_BROKER_PORT = resolveBrokerPort();
const brokerServer = net.createServer(aedes.handle);
let isInternalPublish = false;

// Focus Score Engine
const WINDOW_SIZE = Number(process.env.FOCUS_WINDOW_SIZE || 50); // ~1 second at 50Hz
const FIDGET_THRESHOLD = Number(process.env.FIDGET_THRESHOLD || 0.08);
const STILL_THRESHOLD = Number(process.env.STILL_THRESHOLD || 0.002);
const SCORE_SMOOTHING = Number(process.env.SCORE_SMOOTHING || 0.1);

const accelWindow = [];
let focusScore = 75;
let currentMode = 'passive';
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

const PASSIVE_MOTION_WINDOW_SIZE = Number(process.env.PASSIVE_MOTION_WINDOW_SIZE || 8);
const PASSIVE_MOTION_MOVING_THRESHOLD = Number(
  process.env.PASSIVE_MOTION_MOVING_THRESHOLD || 0.08
);
const PASSIVE_MOTION_STILL_THRESHOLD = Number(
  process.env.PASSIVE_MOTION_STILL_THRESHOLD || 0.03
);
const PASSIVE_ACTIVITY_RESET_THRESHOLD = Number(
  process.env.PASSIVE_ACTIVITY_RESET_THRESHOLD || 0.02
);
const PASSIVE_STILL_DELAY_MS = Math.max(
  0,
  Number(process.env.PASSIVE_STILL_DELAY_MS || 60_000)
);
const PASSIVE_MOTION_BRIGHTNESS = Number(process.env.PASSIVE_MOTION_BRIGHTNESS || 100);
const PASSIVE_MOTION_TRANSITION_MS = Number(process.env.PASSIVE_MOTION_TRANSITION_MS || 0);
const PASSIVE_MOTION_ACCEL_DEADBAND = Math.max(
  0,
  Number(process.env.PASSIVE_MOTION_ACCEL_DEADBAND || 0.005)
);
const PASSIVE_MOTION_GYRO_DEADBAND_DPS = Math.max(
  0,
  Number(process.env.PASSIVE_MOTION_GYRO_DEADBAND_DPS || 12)
);
const PASSIVE_DEBUG_LOG_ENABLED =
  String(process.env.PASSIVE_DEBUG_LOG_ENABLED || 'true') !== 'false';
const PASSIVE_DEBUG_LOG_INTERVAL_MS = Math.max(
  100,
  Number(process.env.PASSIVE_DEBUG_LOG_INTERVAL_MS || 500)
);
const PASSIVE_SENSOR_STALE_MS = Math.max(
  500,
  Number(process.env.PASSIVE_SENSOR_STALE_MS || 2000)
);
const DEFAULT_PASSIVE_STILL_COLOR = normalizeHexColor(
  process.env.PASSIVE_MOTION_STILL_COLOR,
  '#ff0000'
);
const DEFAULT_PASSIVE_MOVING_COLOR = normalizeHexColor(
  process.env.PASSIVE_MOTION_MOVING_COLOR,
  '#00ff00'
);

const passiveMotionWindow = [];
const passiveBulbConfigs = new Map();
const passiveMotion = {
  lastSample: null,
  state: null,
  score: 0,
  updatedAt: null,
  lastAppliedState: null,
  commandInFlight: false,
  pendingState: null,
  lastColor: 'NONE',
  lastMotionScore: 0,
  lastAccelDelta: 0,
  lastGyroMagnitude: 0,
  lastEffectiveAccelDelta: 0,
  lastEffectiveGyroMagnitude: 0,
  lastSource: null,
  lastSensorAt: 0,
  lastMovementAt: 0,
  lastTelemetryLogAt: 0,
  staleWarned: false,
};

function publishMode(mode) {
  const payload = String(mode).toUpperCase();
  console.log(`[Server] Publishing mode to MQTT: ${payload}`);

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

function normalizeHexColor(value, fallback = '#ffffff') {
  let hex = String(value || '').trim().toLowerCase();
  if (!hex) return fallback;
  if (!hex.startsWith('#')) hex = `#${hex}`;
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    hex = `#${hex
      .slice(1)
      .split('')
      .map((char) => char + char)
      .join('')}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  return hex;
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex, '');
  const value = normalized.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToKasaColor({ r, g, b }) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
  }

  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  const saturation = max === 0 ? 0 : Math.round((delta / max) * 100);
  const brightness = Math.round(max * 100);

  return {
    hue,
    saturation,
    brightness: Math.max(1, brightness),
  };
}

function getPassiveBulbConfig(host) {
  if (!host) return null;

  if (!passiveBulbConfigs.has(host)) {
    passiveBulbConfigs.set(host, {
      host,
      stillColor: DEFAULT_PASSIVE_STILL_COLOR,
      movingColor: DEFAULT_PASSIVE_MOVING_COLOR,
    });
  }

  return passiveBulbConfigs.get(host);
}

function getPassiveBulbConfigs() {
  return kasa
    .getBulbHosts()
    .map((host) => getPassiveBulbConfig(host))
    .filter(Boolean);
}

function passiveHexForState(host, state) {
  const config = getPassiveBulbConfig(host);
  if (!config) return state === 'moving' ? DEFAULT_PASSIVE_MOVING_COLOR : DEFAULT_PASSIVE_STILL_COLOR;
  return state === 'moving' ? config.movingColor : config.stillColor;
}

function publicPassiveColorConfig(kasaStatus = null) {
  const bulbStatusByHost = new Map(
    (kasaStatus?.bulbs || []).map((bulb) => [bulb.host, bulb])
  );

  return {
    defaults: {
      stillColor: DEFAULT_PASSIVE_STILL_COLOR,
      movingColor: DEFAULT_PASSIVE_MOVING_COLOR,
    },
    devices: getPassiveBulbConfigs().map((config) => {
      const bulbStatus = bulbStatusByHost.get(config.host);
      return {
        ...config,
        alias: bulbStatus?.alias || config.host,
        connected: bulbStatus?.connected ?? false,
        error: bulbStatus?.error,
      };
    }),
  };
}

function updatePassiveColorConfig(nextConfig = {}) {
  const host = String(nextConfig.host || '').trim();
  if (!host) {
    throw new Error('host is required');
  }

  const config = getPassiveBulbConfig(host);
  config.stillColor = normalizeHexColor(nextConfig.stillColor, config.stillColor);
  config.movingColor = normalizeHexColor(nextConfig.movingColor, config.movingColor);
  passiveBulbConfigs.set(host, config);
  return config;
}

function computePassiveMotionMetrics(sensor) {
  if (!passiveMotion.lastSample) {
    passiveMotion.lastSample = sensor;
    return {
      score: 0,
      accelDelta: 0,
      gyroMagnitude: 0,
      effectiveAccelDelta: 0,
      effectiveGyroMagnitude: 0,
    };
  }

  const prev = passiveMotion.lastSample;
  passiveMotion.lastSample = sensor;

  const accelDelta = Math.sqrt(
    (sensor.x - prev.x) ** 2 +
      (sensor.y - prev.y) ** 2 +
      (sensor.z - prev.z) ** 2
  );
  const gyroMagnitude =
    Math.sqrt(sensor.gx ** 2 + sensor.gy ** 2 + sensor.gz ** 2) / 250;
  const effectiveAccelDelta = Math.max(0, accelDelta - PASSIVE_MOTION_ACCEL_DEADBAND);
  const effectiveGyroMagnitude = Math.max(
    0,
    gyroMagnitude - PASSIVE_MOTION_GYRO_DEADBAND_DPS / 250
  );

  return {
    score: effectiveAccelDelta + effectiveGyroMagnitude * 0.5,
    accelDelta,
    gyroMagnitude,
    effectiveAccelDelta,
    effectiveGyroMagnitude,
  };
}

function publicPassiveMotionState() {
  const now = Date.now();
  return {
    state: passiveMotion.state ?? 'unknown',
    score: Number(passiveMotion.score.toFixed(4)),
    rawMotionScore: Number(passiveMotion.lastMotionScore.toFixed(4)),
    accelDelta: Number(passiveMotion.lastAccelDelta.toFixed(4)),
    gyroMagnitude: Number(passiveMotion.lastGyroMagnitude.toFixed(4)),
    effectiveAccelDelta: Number(passiveMotion.lastEffectiveAccelDelta.toFixed(4)),
    effectiveGyroMagnitude: Number(passiveMotion.lastEffectiveGyroMagnitude.toFixed(4)),
    accelDeadband: PASSIVE_MOTION_ACCEL_DEADBAND,
    gyroDeadbandDps: PASSIVE_MOTION_GYRO_DEADBAND_DPS,
    activityResetThreshold: PASSIVE_ACTIVITY_RESET_THRESHOLD,
    movingThreshold: PASSIVE_MOTION_MOVING_THRESHOLD,
    stillThreshold: PASSIVE_MOTION_STILL_THRESHOLD,
    stillDelayMs: PASSIVE_STILL_DELAY_MS,
    windowSize: PASSIVE_MOTION_WINDOW_SIZE,
    lastAppliedState: passiveMotion.lastAppliedState ?? 'unknown',
    commandInFlight: passiveMotion.commandInFlight,
    pendingState: passiveMotion.pendingState ?? 'none',
    lastColor: passiveMotion.lastColor,
    lastSource: passiveMotion.lastSource,
    movementAgeMs: passiveMotion.lastMovementAt ? now - passiveMotion.lastMovementAt : null,
    sensorAgeMs: passiveMotion.lastSensorAt ? now - passiveMotion.lastSensorAt : null,
    updatedAt: passiveMotion.updatedAt,
  };
}

function logPassiveTelemetry(sensor) {
  if (!PASSIVE_DEBUG_LOG_ENABLED || currentMode !== 'passive') return;

  const now = Date.now();
  if (now - passiveMotion.lastTelemetryLogAt < PASSIVE_DEBUG_LOG_INTERVAL_MS) return;
  passiveMotion.lastTelemetryLogAt = now;

  console.log(
    `[Passive] sample src=${passiveMotion.lastSource} state=${passiveMotion.state ?? 'unknown'} ` +
      `bulb=${passiveMotion.lastColor} avg=${passiveMotion.score.toFixed(4)} ` +
      `raw=${passiveMotion.lastMotionScore.toFixed(4)} ` +
      `applied=${passiveMotion.lastAppliedState ?? 'unknown'} ` +
      `inFlight=${passiveMotion.commandInFlight} pending=${passiveMotion.pendingState ?? 'none'} ` +
      `moveAge=${passiveMotion.lastMovementAt ? now - passiveMotion.lastMovementAt : -1}ms ` +
      `dA=${passiveMotion.lastAccelDelta.toFixed(4)} eA=${passiveMotion.lastEffectiveAccelDelta.toFixed(4)} ` +
      `gMag=${passiveMotion.lastGyroMagnitude.toFixed(4)} eG=${passiveMotion.lastEffectiveGyroMagnitude.toFixed(4)} ` +
      `xyz=(${sensor.x.toFixed(3)},${sensor.y.toFixed(3)},${sensor.z.toFixed(3)}) ` +
      `gyro=(${sensor.gx.toFixed(3)},${sensor.gy.toFixed(3)},${sensor.gz.toFixed(3)})`
  );
}

function updatePassiveMotionState(sensor, source = 'unknown') {
  const now = Date.now();
  const motion = computePassiveMotionMetrics(sensor);
  const motionScore = motion.score;
  passiveMotion.lastMotionScore = motion.score;
  passiveMotion.lastAccelDelta = motion.accelDelta;
  passiveMotion.lastGyroMagnitude = motion.gyroMagnitude;
  passiveMotion.lastEffectiveAccelDelta = motion.effectiveAccelDelta;
  passiveMotion.lastEffectiveGyroMagnitude = motion.effectiveGyroMagnitude;
  passiveMotion.lastSource = source;
  passiveMotion.lastSensorAt = now;
  passiveMotion.staleWarned = false;

  passiveMotionWindow.push(motionScore);
  while (passiveMotionWindow.length > PASSIVE_MOTION_WINDOW_SIZE) {
    passiveMotionWindow.shift();
  }

  const averagedScore =
    passiveMotionWindow.reduce((sum, value) => sum + value, 0) /
    passiveMotionWindow.length;

  passiveMotion.score = averagedScore;

  if (!passiveMotion.lastMovementAt) {
    passiveMotion.lastMovementAt = now;
  }

  let nextState = passiveMotion.state;

  if (motionScore >= PASSIVE_MOTION_MOVING_THRESHOLD) {
    passiveMotion.lastMovementAt = now;
    nextState = 'moving';
  } else if (
    motionScore >= PASSIVE_ACTIVITY_RESET_THRESHOLD ||
    averagedScore >= PASSIVE_ACTIVITY_RESET_THRESHOLD
  ) {
    passiveMotion.lastMovementAt = now;
  }

  if (
    nextState === 'moving' &&
    now - passiveMotion.lastMovementAt >= PASSIVE_STILL_DELAY_MS &&
    averagedScore <= PASSIVE_MOTION_STILL_THRESHOLD
  ) {
    nextState = 'still';
  } else if (!nextState) {
    nextState = 'still';
  }

  if (nextState === passiveMotion.state) {
    return false;
  }

  passiveMotion.state = nextState;
  passiveMotion.updatedAt = new Date().toISOString();
  console.log(
    `[Passive] ${nextState.toUpperCase()} avg=${averagedScore.toFixed(4)} ` +
      `raw=${motion.score.toFixed(4)} dA=${motion.accelDelta.toFixed(4)} ` +
      `eA=${motion.effectiveAccelDelta.toFixed(4)} gMag=${motion.gyroMagnitude.toFixed(4)} ` +
      `eG=${motion.effectiveGyroMagnitude.toFixed(4)} ` +
      `moveAge=${now - passiveMotion.lastMovementAt}ms`
  );
  io.emit('passiveMotionState', publicPassiveMotionState());
  return true;
}

async function syncPassiveMotionBulb(force = false) {
  if (currentMode !== 'passive' || !passiveMotion.state) return;
  const desiredState = passiveMotion.state;

  if (!force && passiveMotion.lastAppliedState === desiredState && !passiveMotion.commandInFlight) {
    return;
  }

  if (passiveMotion.commandInFlight) {
    passiveMotion.pendingState = desiredState;
    return;
  }

  passiveMotion.commandInFlight = true;
  passiveMotion.pendingState = null;
  const bulbConfigs = getPassiveBulbConfigs();

  try {
    if (!bulbConfigs.length) {
      passiveMotion.lastAppliedState = desiredState;
      passiveMotion.lastColor = 'NONE';
    } else {
      const results = await Promise.all(
        bulbConfigs.map(async (bulbConfig) => {
          const hexColor = passiveHexForState(bulbConfig.host, desiredState);
          const kasaColor = rgbToKasaColor(hexToRgb(hexColor));
          kasaColor.brightness = Math.max(
            1,
            Math.min(PASSIVE_MOTION_BRIGHTNESS, kasaColor.brightness)
          );

          console.log(
            `[Passive] Bulb command [${bulbConfig.host}] -> ${hexColor} state=${desiredState} ` +
              `avg=${passiveMotion.score.toFixed(4)} raw=${passiveMotion.lastMotionScore.toFixed(4)}`
          );

          const result = await kasa.setBulbColor(
            {
              hue: kasaColor.hue,
              saturation: kasaColor.saturation,
              brightness: kasaColor.brightness,
              transitionMs: PASSIVE_MOTION_TRANSITION_MS,
            },
            { host: bulbConfig.host }
          );

          return {
            host: bulbConfig.host,
            alias: bulbConfig.alias || bulbConfig.host,
            hexColor,
            result,
          };
        })
      );

      const allSucceeded = results.every((entry) => entry.result.success);
      passiveMotion.lastAppliedState = allSucceeded ? desiredState : null;
      passiveMotion.lastColor = results[0]?.hexColor || 'NONE';

      for (const entry of results) {
        if (entry.result.success) {
          console.log(`[Passive] Bulb [${entry.host}] -> ${entry.hexColor}`);
        } else {
          console.error(
            `[Passive] Bulb command failed for ${entry.host} (${entry.hexColor}): ${entry.result.error}`
          );
        }
      }
    }
  } finally {
    passiveMotion.commandInFlight = false;

    const nextState = passiveMotion.pendingState;
    passiveMotion.pendingState = null;

    if (
      currentMode === 'passive' &&
      nextState &&
      nextState !== passiveMotion.lastAppliedState
    ) {
      console.log(`[Passive] Replaying queued state -> ${nextState.toUpperCase()}`);
      void syncPassiveMotionBulb(true).catch((err) => {
        console.error('[Passive] Queued bulb control error:', err.message);
      });
    }
  }
}

async function applyModeOutputs() {
  io.emit('modeUpdate', currentMode);
  io.emit('gyroBulbControl', publicGyroBulbControl());
  io.emit('passiveMotionState', publicPassiveMotionState());

  if (currentMode === 'passive') {
    passiveMotion.lastAppliedState = null;
    await syncPassiveMotionBulb(true);
    return;
  }

  passiveMotion.lastAppliedState = null;
  await Promise.all(
    kasa.getBulbHosts().map((host) => kasa.applyFocusedPreset({ host }))
  );
}

function isGyroBulbControlActive() {
  if (!gyroBulbControl.enabled) return false;
  if (gyroBulbControl.mode === 'always') return true;
  return gyroBulbControl.mode === currentMode;
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
  gyroBulbControl.smoothedAxis =
    gyroBulbControl.smoothedAxis === null
      ? rawAxis
      : gyroBulbControl.smoothedAxis * (1 - alpha) + rawAxis * alpha;

  const brightness = kasa.axisToPercent(
    gyroBulbControl.smoothedAxis,
    gyroBulbControl.axisMin,
    gyroBulbControl.axisMax
  );

  const update = {
    axis: gyroBulbControl.axis,
    axisValue: rawAxis,
    smoothedAxis: gyroBulbControl.smoothedAxis,
    brightness,
    queuedAt: Date.now(),
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

  updatePassiveMotionState(payload, source);
  logPassiveTelemetry(payload);

  accelWindow.push(payload);
  while (accelWindow.length > WINDOW_SIZE) accelWindow.shift();

  const score = updateFocusScore(computeVariance(accelWindow));
  const now = Date.now();
  if (now - lastFocusEmitAt >= 250) {
    lastFocusEmitAt = now;
    io.emit('focusScore', score);
  }

  if (currentMode === 'passive') {
    void syncPassiveMotionBulb().catch((err) => {
      console.error('[Passive] Bulb control error:', err.message);
    });
    return;
  }

  passiveMotion.lastAppliedState = null;
  void handleGyroBulbControl(payload).catch((err) => {
    console.error('[GyroBulb] Control error:', err.message);
  });
}

setInterval(() => {
  if (!PASSIVE_DEBUG_LOG_ENABLED || currentMode !== 'passive') return;
  if (!passiveMotion.lastSensorAt || passiveMotion.staleWarned) return;

  const ageMs = Date.now() - passiveMotion.lastSensorAt;
  if (ageMs < PASSIVE_SENSOR_STALE_MS) return;

  passiveMotion.staleWarned = true;
  console.warn(
    `[Passive] No sensor update for ${ageMs}ms; state=${passiveMotion.state ?? 'unknown'} ` +
      `bulb=${passiveMotion.lastColor}`
  );
}, 500);

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

function updateGyroBulbControl(nextConfig = {}) {
  if (nextConfig.enabled !== undefined) {
    gyroBulbControl.enabled = parseBoolean(nextConfig.enabled, gyroBulbControl.enabled);
  }
  if (
    nextConfig.mode !== undefined &&
    ['active', 'passive', 'always'].includes(nextConfig.mode)
  ) {
    gyroBulbControl.mode = nextConfig.mode;
  }
  if (
    nextConfig.axis !== undefined &&
    ['x', 'y', 'z', 'gx', 'gy', 'gz'].includes(nextConfig.axis)
  ) {
    gyroBulbControl.axis = nextConfig.axis;
    gyroBulbControl.smoothedAxis = null;
    gyroBulbControl.pending = null;
  }

  for (const key of [
    'axisMin',
    'axisMax',
    'smoothing',
    'throttleMs',
    'minBrightnessDelta',
    'transitionMs',
  ]) {
    if (nextConfig[key] !== undefined) {
      gyroBulbControl[key] = toFiniteNumber(nextConfig[key], gyroBulbControl[key]);
    }
  }

  gyroBulbControl.smoothing = Math.max(0, Math.min(1, gyroBulbControl.smoothing));
  gyroBulbControl.throttleMs = Math.max(75, gyroBulbControl.throttleMs);
  gyroBulbControl.minBrightnessDelta = Math.max(0, gyroBulbControl.minBrightnessDelta);
  gyroBulbControl.transitionMs = Math.max(0, gyroBulbControl.transitionMs);

  if (nextConfig.powerOffAtZero !== undefined) {
    gyroBulbControl.powerOffAtZero = parseBoolean(
      nextConfig.powerOffAtZero,
      gyroBulbControl.powerOffAtZero
    );
  }

  io.emit('gyroBulbControl', publicGyroBulbControl());
  return publicGyroBulbControl();
}

// MQTT Broker (embedded - no external Mosquitto needed)
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
      void applyModeOutputs().catch((err) => {
        console.error('[Mode] Passive/active output sync error:', err.message);
      });
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
  socket.emit('passiveMotionState', publicPassiveMotionState());
  publishMode(currentMode);

  socket.on('getMode', () => {
    socket.emit('modeUpdate', currentMode);
  });

  socket.on('setMode', async (mode) => {
    const normalizedMode = String(mode).trim().toLowerCase();
    if (normalizedMode !== 'active' && normalizedMode !== 'passive') {
      socket.emit('modeResult', { success: false, error: `Invalid mode: ${mode}` });
      return;
    }

    currentMode = normalizedMode;
    console.log('[WS] Mode changed to:', currentMode);
    publishMode(currentMode);
    await applyModeOutputs();

    if (currentMode === 'active') {
      await kasa.setPlugPower(true);
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

  socket.on('setBulb', async (payload = {}) => {
    const { host, ...lightState } = payload;
    const result = await kasa.setBulbState(lightState, { host });
    socket.emit('bulbResult', result);
  });

  socket.on('setBulbBrightness', async ({ host, brightness, transitionMs } = {}) => {
    const result = await kasa.setBulbBrightness(brightness, { host, transitionMs });
    socket.emit('bulbResult', result);
  });

  socket.on('applyBulbPreset', async ({ host, preset } = {}) => {
    const result = await kasa.applyPreset(preset, { host });
    socket.emit('bulbResult', result);
  });

  socket.on('getKasaStatus', async () => {
    socket.emit('kasaStatus', await kasa.getDeviceStatus());
  });

  socket.on('getPassiveColorConfig', async () => {
    const kasaStatus = await kasa.getDeviceStatus();
    socket.emit('passiveColorConfig', publicPassiveColorConfig(kasaStatus));
  });

  socket.on('setPassiveColorConfig', async (config = {}) => {
    try {
      updatePassiveColorConfig(config);
      if (currentMode === 'passive') {
        passiveMotion.lastAppliedState = null;
        await syncPassiveMotionBulb(true);
        io.emit('passiveMotionState', publicPassiveMotionState());
      }

      const kasaStatus = await kasa.getDeviceStatus();
      const payload = publicPassiveColorConfig(kasaStatus);
      io.emit('passiveColorConfig', payload);
      socket.emit('passiveColorConfigResult', { success: true, passiveColorConfig: payload });
    } catch (err) {
      socket.emit('passiveColorConfigResult', { success: false, error: err.message });
    }
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
    res.json({
      mode: currentMode,
      sensor: liveSensorState.latest,
      gyroBulbControl: publicGyroBulbControl(),
    });
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
    passiveMotion: publicPassiveMotionState(),
    passiveColorConfig: publicPassiveColorConfig(),
  });
});

app.get('/api/sensors/latest', (req, res) => {
  res.json(liveSensorState.latest || {});
});

app.get('/api/sensors/history', (req, res) => {
  res.json(sensorHistory);
});

app.post('/api/mode', (req, res) => {
  const mode = String(req.body?.mode || '').trim().toLowerCase();
  if (mode !== 'active' && mode !== 'passive') {
    res.status(400).json({ error: `Invalid mode: ${req.body?.mode}` });
    return;
  }

  currentMode = mode;
  publishMode(currentMode);
  void applyModeOutputs().catch((err) => {
    console.error('[Mode] HTTP output sync error:', err.message);
  });
  res.json({ success: true, mode: currentMode, passiveMotion: publicPassiveMotionState() });
});

app.get('/api/kasa/status', async (req, res) => {
  res.json(await kasa.getDeviceStatus());
});

app.post('/api/kasa/plug', async (req, res) => {
  res.json(await kasa.setPlugPower(req.body?.state));
});

app.post('/api/kasa/bulb', async (req, res) => {
  const { host, ...lightState } = req.body || {};
  res.json(await kasa.setBulbState(lightState, { host }));
});

app.post('/api/kasa/bulb/brightness', async (req, res) => {
  res.json(
    await kasa.setBulbBrightness(req.body?.brightness, {
      host: req.body?.host,
      transitionMs: req.body?.transitionMs,
      powerOffAtZero: req.body?.powerOffAtZero,
    })
  );
});

app.post('/api/kasa/bulb/axis', async (req, res) => {
  res.json(
    await kasa.setBulbBrightnessFromAxis(req.body?.value, {
      host: req.body?.host,
      axisMin: req.body?.axisMin ?? -1,
      axisMax: req.body?.axisMax ?? 1,
      transitionMs: req.body?.transitionMs,
      powerOffAtZero: req.body?.powerOffAtZero ?? true,
    })
  );
});

app.post('/api/kasa/bulb/preset', async (req, res) => {
  res.json(await kasa.applyPreset(req.body?.preset, { host: req.body?.host }));
});

app.get('/api/passive-config', async (req, res) => {
  const kasaStatus = await kasa.getDeviceStatus();
  res.json(publicPassiveColorConfig(kasaStatus));
});

app.post('/api/passive-config', async (req, res) => {
  try {
    updatePassiveColorConfig(req.body || {});
    if (currentMode === 'passive') {
      passiveMotion.lastAppliedState = null;
      await syncPassiveMotionBulb(true);
      io.emit('passiveMotionState', publicPassiveMotionState());
    }

    const kasaStatus = await kasa.getDeviceStatus();
    const payload = publicPassiveColorConfig(kasaStatus);
    io.emit('passiveColorConfig', payload);
    res.json({ success: true, passiveColorConfig: payload });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
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
  console.log(
    `[Server] Kasa Bulbs   : ${
      kasa.getBulbHosts().join(', ') || 'BULB_IP/BULB_IPS not set'
    }`
  );
  console.log(
    `[Server] Gyro bulb   : ${
      gyroBulbControl.enabled ? 'enabled' : 'disabled'
    } (${gyroBulbControl.axis} ${gyroBulbControl.axisMin}..${gyroBulbControl.axisMax} -> 0..100%, mode=${gyroBulbControl.mode})`
  );
  console.log(
    `[Server] Passive bulb: customizable per device (defaults still=${DEFAULT_PASSIVE_STILL_COLOR}, moving=${DEFAULT_PASSIVE_MOVING_COLOR}, window=${PASSIVE_MOTION_WINDOW_SIZE}, thresholds=${PASSIVE_MOTION_STILL_THRESHOLD}/${PASSIVE_MOTION_MOVING_THRESHOLD}, activityReset=${PASSIVE_ACTIVITY_RESET_THRESHOLD}, stillDelayMs=${PASSIVE_STILL_DELAY_MS})`
  );
});
