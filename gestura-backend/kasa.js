/**
 * kasa.js - Gestura Gauntlet Kasa Device Manager
 *
 * Lazy-connects to Kasa devices and exposes small, safe helpers for plug,
 * bulb, presets, status, and live sensor-driven brightness control.
 */

const { Client } = require('tplink-smarthome-api');

const kasaClient = new Client();

let plug = null;
let bulb = null;
let lastBulbState = {};
let bulbQueue = Promise.resolve();

const BULB_PRESETS = Object.freeze({
  focused: {
    on_off: 1,
    brightness: 80,
    color_temp: 4000,
    transition_period: 1500,
  },
  break: {
    on_off: 1,
    brightness: 30,
    color_temp: 2700,
    transition_period: 2000,
  },
  alert: {
    on_off: 1,
    brightness: 100,
    color_temp: 6000,
    transition_period: 500,
  },
  night: {
    on_off: 1,
    brightness: 10,
    color_temp: 2700,
    transition_period: 1500,
  },
  off: {
    on_off: 0,
    transition_period: 500,
  },
});

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function clampPercent(value) {
  return Math.round(clamp(value, 0, 100));
}

/** Map an axis value to percent. Default mapping: -1 => 0%, +1 => 100%. */
function axisToPercent(value, min = -1, max = 1) {
  const low = Number(min);
  const high = Number(max);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low === high) {
    throw new Error('Invalid axis range');
  }

  const axis = clamp(value, Math.min(low, high), Math.max(low, high));
  const percent = ((axis - low) / (high - low)) * 100;
  return clampPercent(percent);
}

function queueBulbCommand(task) {
  bulbQueue = bulbQueue.then(task, task);
  return bulbQueue;
}

async function getPlug() {
  if (plug) return plug;
  if (!process.env.PLUG_IP) throw new Error('PLUG_IP is not set in .env');

  console.log(`[Kasa] Connecting to plug at ${process.env.PLUG_IP}...`);
  plug = await kasaClient.getDevice({ host: process.env.PLUG_IP });
  console.log(`[Kasa] Plug connected: "${plug.alias}"`);
  return plug;
}

async function getBulb() {
  if (bulb) return bulb;
  if (!process.env.BULB_IP) throw new Error('BULB_IP is not set in .env');

  console.log(`[Kasa] Connecting to bulb at ${process.env.BULB_IP}...`);
  bulb = await kasaClient.getDevice({ host: process.env.BULB_IP });
  console.log(`[Kasa] Bulb connected: "${bulb.alias}"`);
  return bulb;
}

function resetConnections() {
  plug = null;
  bulb = null;
  lastBulbState = {};
  return { success: true };
}

async function getDeviceStatus() {
  const status = {
    plug: { configured: Boolean(process.env.PLUG_IP), connected: Boolean(plug) },
    bulb: { configured: Boolean(process.env.BULB_IP), connected: Boolean(bulb), lastState: lastBulbState },
  };

  try {
    if (process.env.PLUG_IP) {
      const device = await getPlug();
      status.plug.alias = device.alias;
      if (typeof device.getPowerState === 'function') {
        status.plug.power = await device.getPowerState();
      }
    }
  } catch (err) {
    plug = null;
    status.plug.error = err.message;
  }

  try {
    if (process.env.BULB_IP) {
      const device = await getBulb();
      status.bulb.alias = device.alias;
      if (typeof device.getSysInfo === 'function') {
        status.bulb.sysInfo = await device.getSysInfo();
      }
    }
  } catch (err) {
    bulb = null;
    status.bulb.error = err.message;
  }

  return status;
}

async function setPlugPower(state) {
  try {
    const device = await getPlug();
    const powerState = Boolean(state);
    await device.setPowerState(powerState);
    console.log(`[Kasa] Plug turned ${powerState ? 'ON' : 'OFF'}`);
    return { success: true, state: powerState };
  } catch (err) {
    plug = null;
    console.error(`[Kasa] Plug error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function setBulbState(lightState = {}) {
  return queueBulbCommand(async () => {
    try {
      const device = await getBulb();
      const nextState = { ...lightState };
      for (const key of Object.keys(nextState)) {
        if (nextState[key] === undefined) delete nextState[key];
      }

      if (nextState.brightness !== undefined) {
        nextState.brightness = clampPercent(nextState.brightness);
      }
      if (nextState.hue !== undefined) {
        nextState.hue = Math.round(clamp(nextState.hue, 0, 360));
      }
      if (nextState.saturation !== undefined) {
        nextState.saturation = clampPercent(nextState.saturation);
      }
      if (nextState.color_temp !== undefined) {
        nextState.color_temp = Math.round(clamp(nextState.color_temp, 2500, 9000));
      }
      if (nextState.transition_period !== undefined) {
        nextState.transition_period = Math.round(clamp(nextState.transition_period, 0, 60_000));
      }

      await device.lighting.setLightState(nextState);
      lastBulbState = { ...lastBulbState, ...nextState, updatedAt: new Date().toISOString() };
      console.log('[Kasa] Bulb state updated:', nextState);
      return { success: true, lightState: nextState };
    } catch (err) {
      bulb = null;
      console.error(`[Kasa] Bulb error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });
}

async function setBulbPower(state, options = {}) {
  return setBulbState({
    on_off: state ? 1 : 0,
    transition_period: options.transitionMs,
  });
}

async function setBulbBrightness(brightness, options = {}) {
  const percent = clampPercent(brightness);
  const lightState = {
    brightness: percent,
    transition_period: options.transitionMs,
  };

  if (options.powerOffAtZero) {
    lightState.on_off = percent > 0 ? 1 : 0;
  } else if (options.turnOn !== false && percent > 0) {
    lightState.on_off = 1;
  }

  return setBulbState(lightState);
}

async function setBulbBrightnessFromAxis(axisValue, options = {}) {
  const brightness = axisToPercent(
    axisValue,
    options.axisMin ?? -1,
    options.axisMax ?? 1
  );
  const result = await setBulbBrightness(brightness, options);
  return { ...result, axisValue: Number(axisValue), brightness };
}

async function setBulbColor({ hue, saturation = 100, brightness, transitionMs } = {}) {
  return setBulbState({
    on_off: 1,
    hue,
    saturation,
    brightness,
    transition_period: transitionMs,
  });
}

async function setBulbColorTemperature(colorTemp, options = {}) {
  return setBulbState({
    on_off: options.turnOn === false ? undefined : 1,
    color_temp: colorTemp,
    brightness: options.brightness,
    transition_period: options.transitionMs,
  });
}

async function applyPreset(name) {
  const preset = BULB_PRESETS[String(name).toLowerCase()];
  if (!preset) {
    return { success: false, error: `Unknown preset: ${name}` };
  }
  return setBulbState(preset);
}

async function applyFocusedPreset() {
  return applyPreset('focused');
}

async function applyBreakPreset() {
  return applyPreset('break');
}

async function applyAlertPreset() {
  return applyPreset('alert');
}

module.exports = {
  BULB_PRESETS,
  axisToPercent,
  resetConnections,
  getDeviceStatus,
  setPlugPower,
  setBulbState,
  setBulbPower,
  setBulbBrightness,
  setBulbBrightnessFromAxis,
  setBulbColor,
  setBulbColorTemperature,
  applyPreset,
  applyFocusedPreset,
  applyBreakPreset,
  applyAlertPreset,
};
