/**
 * kasa.js - Gestura Gauntlet Kasa Device Manager
 *
 * Lazy-connects to Kasa devices and exposes safe helpers for plug control,
 * multi-bulb state changes, presets, status reporting, and live updates.
 */

const { Client } = require('tplink-smarthome-api');

const kasaClient = new Client();
const KASA_TIMEOUT_MS = Math.max(1000, Number(process.env.KASA_TIMEOUT_MS || 4000));

let plug = null;
const bulbs = new Map();
const bulbQueues = new Map();
const lastBulbStateByHost = new Map();

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

function uniqueHosts(values) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    const host = String(value || '').trim();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    result.push(host);
  }

  return result;
}

function getBulbHosts() {
  const hosts = [];

  if (process.env.BULB_IP) {
    hosts.push(process.env.BULB_IP);
  }

  if (process.env.BULB_IPS) {
    hosts.push(
      ...String(process.env.BULB_IPS)
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    );
  }

  return uniqueHosts(hosts);
}

function getPrimaryBulbHost() {
  return getBulbHosts()[0] || null;
}

function resolveBulbHost(host) {
  const resolvedHost = String(host || '').trim() || getPrimaryBulbHost();
  if (!resolvedHost) {
    throw new Error('No bulb IPs are configured. Set BULB_IP or BULB_IPS in .env');
  }
  return resolvedHost;
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

function queueBulbCommand(host, task) {
  const resolvedHost = resolveBulbHost(host);
  const currentQueue = bulbQueues.get(resolvedHost) || Promise.resolve();
  const nextQueue = currentQueue.then(task, task);
  bulbQueues.set(resolvedHost, nextQueue.catch(() => {}));
  return nextQueue;
}

function withTimeout(label, operation, timeoutMs = KASA_TIMEOUT_MS) {
  let timer = null;

  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function clearBulbConnection(host) {
  bulbs.delete(host);
}

function blankBulbStatus(host) {
  return {
    host,
    configured: Boolean(host),
    connected: Boolean(bulbs.get(host)),
    lastState: lastBulbStateByHost.get(host) || {},
  };
}

async function getPlug() {
  if (plug) return plug;
  if (!process.env.PLUG_IP) throw new Error('PLUG_IP is not set in .env');

  console.log(`[Kasa] Connecting to plug at ${process.env.PLUG_IP}...`);
  plug = await withTimeout(
    `Connecting to plug at ${process.env.PLUG_IP}`,
    () => kasaClient.getDevice({ host: process.env.PLUG_IP })
  );
  console.log(`[Kasa] Plug connected: "${plug.alias}"`);
  return plug;
}

async function getBulb(host) {
  const resolvedHost = resolveBulbHost(host);
  if (bulbs.has(resolvedHost)) return bulbs.get(resolvedHost);

  console.log(`[Kasa] Connecting to bulb at ${resolvedHost}...`);
  const bulb = await withTimeout(
    `Connecting to bulb at ${resolvedHost}`,
    () => kasaClient.getDevice({ host: resolvedHost })
  );
  bulbs.set(resolvedHost, bulb);
  console.log(`[Kasa] Bulb connected [${resolvedHost}]: "${bulb.alias}"`);
  return bulb;
}

function resetConnections() {
  plug = null;
  bulbs.clear();
  bulbQueues.clear();
  lastBulbStateByHost.clear();
  return { success: true };
}

async function getDeviceStatus() {
  const status = {
    plug: { configured: Boolean(process.env.PLUG_IP), connected: Boolean(plug) },
    bulb: { configured: false, connected: false, lastState: {} },
    bulbs: [],
  };

  try {
    if (process.env.PLUG_IP) {
      const device = await getPlug();
      status.plug.connected = true;
      status.plug.alias = device.alias;
      if (typeof device.getPowerState === 'function') {
        status.plug.power = await withTimeout(
          'Fetching plug power state',
          () => device.getPowerState()
        );
      }
    }
  } catch (err) {
    plug = null;
    status.plug.error = err.message;
  }

  const bulbHosts = getBulbHosts();
  status.bulbs = await Promise.all(
    bulbHosts.map(async (host) => {
      const bulbStatus = blankBulbStatus(host);
      try {
        const device = await getBulb(host);
        bulbStatus.connected = true;
        bulbStatus.alias = device.alias;
        if (typeof device.getSysInfo === 'function') {
          bulbStatus.sysInfo = await withTimeout(
            `Fetching bulb sysInfo from ${host}`,
            () => device.getSysInfo()
          );
        }
      } catch (err) {
        clearBulbConnection(host);
        bulbStatus.error = err.message;
      }
      return bulbStatus;
    })
  );

  if (status.bulbs[0]) {
    status.bulb = status.bulbs[0];
  }

  return status;
}

async function setPlugPower(state) {
  try {
    const device = await getPlug();
    const powerState = Boolean(state);
    await withTimeout(
      `Setting plug power to ${powerState ? 'on' : 'off'}`,
      () => device.setPowerState(powerState)
    );
    console.log(`[Kasa] Plug turned ${powerState ? 'ON' : 'OFF'}`);
    return { success: true, state: powerState };
  } catch (err) {
    plug = null;
    console.error(`[Kasa] Plug error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function setBulbState(lightState = {}, options = {}) {
  let resolvedHost;
  try {
    resolvedHost = resolveBulbHost(options.host);
  } catch (err) {
    return { success: false, error: err.message };
  }

  return queueBulbCommand(resolvedHost, async () => {
    try {
      const device = await getBulb(resolvedHost);
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
        const requestedColorTemp = Number(nextState.color_temp);
        nextState.color_temp =
          requestedColorTemp === 0
            ? 0
            : Math.round(clamp(requestedColorTemp, 2500, 9000));
      }
      if (nextState.transition_period !== undefined) {
        nextState.transition_period = Math.round(
          clamp(nextState.transition_period, 0, 60_000)
        );
      }

      await withTimeout(
        `Applying bulb state to ${resolvedHost}`,
        () => device.lighting.setLightState(nextState)
      );

      const lastState = {
        ...(lastBulbStateByHost.get(resolvedHost) || {}),
        ...nextState,
        updatedAt: new Date().toISOString(),
      };
      lastBulbStateByHost.set(resolvedHost, lastState);

      console.log(`[Kasa] Bulb state updated [${resolvedHost}]:`, nextState);
      return { success: true, host: resolvedHost, lightState: nextState };
    } catch (err) {
      clearBulbConnection(resolvedHost);
      console.error(`[Kasa] Bulb ${resolvedHost} error: ${err.message}`);
      return { success: false, host: resolvedHost, error: err.message };
    }
  });
}

async function setBulbsState(lightState = {}, options = {}) {
  const hosts = uniqueHosts(
    Array.isArray(options.hosts) && options.hosts.length ? options.hosts : getBulbHosts()
  );

  if (!hosts.length) {
    return { success: false, error: 'No bulb IPs are configured. Set BULB_IP or BULB_IPS in .env', results: [] };
  }

  const results = await Promise.all(
    hosts.map((host) => setBulbState(lightState, { ...options, host }))
  );

  return {
    success: results.every((result) => result.success),
    results,
  };
}

async function setBulbPower(state, options = {}) {
  return setBulbState(
    {
      on_off: state ? 1 : 0,
      transition_period: options.transitionMs,
    },
    options
  );
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

  return setBulbState(lightState, options);
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

async function setBulbColor(
  { hue, saturation = 100, brightness, transitionMs } = {},
  options = {}
) {
  return setBulbState(
    {
      on_off: 1,
      hue,
      saturation,
      color_temp: 0,
      brightness,
      transition_period: transitionMs,
    },
    options
  );
}

async function setBulbColorTemperature(colorTemp, options = {}) {
  return setBulbState(
    {
      on_off: options.turnOn === false ? undefined : 1,
      color_temp: colorTemp,
      brightness: options.brightness,
      transition_period: options.transitionMs,
    },
    options
  );
}

async function applyPreset(name, options = {}) {
  const preset = BULB_PRESETS[String(name).toLowerCase()];
  if (!preset) {
    return { success: false, error: `Unknown preset: ${name}` };
  }
  return setBulbState(preset, options);
}

async function applyFocusedPreset(options = {}) {
  return applyPreset('focused', options);
}

async function applyBreakPreset(options = {}) {
  return applyPreset('break', options);
}

async function applyAlertPreset(options = {}) {
  return applyPreset('alert', options);
}

module.exports = {
  BULB_PRESETS,
  axisToPercent,
  getBulbHosts,
  getPrimaryBulbHost,
  resetConnections,
  getDeviceStatus,
  setPlugPower,
  setBulbState,
  setBulbsState,
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
