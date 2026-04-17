/**
 * kasa.js — Gestura Gauntlet Kasa Device Manager
 *
 * Handles lazy-initialization and control of the Kasa Smart Plug
 * and Kasa Smart Bulb over the local network.
 *
 * Lazy-init means the device objects are created on first use,
 * so the server boots cleanly even if devices are offline.
 */

const { Client } = require('tplink-smarthome-api');

const kasaClient = new Client();

// Device handles — populated on first successful connection
let plug = null;
let bulb = null;

// ─── Internal: connect to a device by IP ─────────────────────────────────────

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

// ─── Plug Controls ────────────────────────────────────────────────────────────

/**
 * Turn the smart plug on or off.
 * @param {boolean} state - true = on, false = off
 */
async function setPlugPower(state) {
  try {
    const device = await getPlug();
    await device.setPowerState(state);
    console.log(`[Kasa] Plug turned ${state ? 'ON' : 'OFF'}`);
    return { success: true, state };
  } catch (err) {
    // Reset cached handle so next call retries the connection
    plug = null;
    console.error(`[Kasa] Plug error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Bulb Controls ────────────────────────────────────────────────────────────

/**
 * Set the bulb to a specific light state.
 * All fields are optional — only pass what you want to change.
 *
 * @param {object} lightState
 * @param {number}  [lightState.on_off]        - 1 = on, 0 = off
 * @param {number}  [lightState.brightness]    - 0–100
 * @param {number}  [lightState.hue]           - 0–360 (color bulbs only)
 * @param {number}  [lightState.saturation]    - 0–100 (color bulbs only)
 * @param {number}  [lightState.color_temp]    - Kelvin, e.g. 2700 (warm) – 6500 (cool)
 * @param {number}  [lightState.transition_period] - ms for smooth transition
 */
async function setBulbState(lightState) {
  try {
    const device = await getBulb();
    await device.lighting.setLightState(lightState);
    console.log(`[Kasa] Bulb state updated:`, lightState);
    return { success: true, lightState };
  } catch (err) {
    bulb = null;
    console.error(`[Kasa] Bulb error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Shorthand: turn the bulb on or off without changing other settings.
 * @param {boolean} state
 */
async function setBulbPower(state) {
  return setBulbState({ on_off: state ? 1 : 0 });
}

/**
 * Set bulb brightness only (keeps current color/temp).
 * @param {number} brightness - 0–100
 */
async function setBulbBrightness(brightness) {
  const clamped = Math.max(0, Math.min(100, Math.round(brightness)));
  return setBulbState({ brightness: clamped });
}

// ─── Focus Score Presets ──────────────────────────────────────────────────────
// Convenience wrappers called by the focus score logic in server.js

/** Calm, warm light for focused work */
async function applyFocusedPreset() {
  return setBulbState({
    on_off: 1,
    brightness: 80,
    color_temp: 4000,   // Neutral white
    transition_period: 1500,
  });
}

/** Dim, warm light to signal a break */
async function applyBreakPreset() {
  return setBulbState({
    on_off: 1,
    brightness: 30,
    color_temp: 2700,   // Warm amber
    transition_period: 2000,
  });
}

/** Bright, cool light as a wake-up/refocus nudge */
async function applyAlertPreset() {
  return setBulbState({
    on_off: 1,
    brightness: 100,
    color_temp: 6000,   // Cool daylight
    transition_period: 500,
  });
}

module.exports = {
  setPlugPower,
  setBulbState,
  setBulbPower,
  setBulbBrightness,
  applyFocusedPreset,
  applyBreakPreset,
  applyAlertPreset,
};
