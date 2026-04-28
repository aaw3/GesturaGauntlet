const { Client } = require('tplink-smarthome-api');
const { clamp, clone, sanitizeId, sleep } = require('../utils');

const allowedDevices = ['plug', 'bulb'];

function clampPercent(value) {
  return Math.round(clamp(value, 0, 100));
}

function rangeCapability(id, label, min, max, step, unit) {
  return {
    id,
    label,
    kind: 'range',
    readable: true,
    writable: true,
    range: { min, max, step, unit },
  };
}

function capabilitiesForKasaType(type) {
  const capabilities = [
    { id: 'power', label: 'Power', kind: 'toggle', readable: true, writable: true },
  ];

  if (type === 'light') {
    capabilities.push(
      rangeCapability('brightness', 'Brightness', 0, 100, 1, '%'),
      rangeCapability('hue', 'Hue', 0, 360, 1, 'deg'),
      rangeCapability('saturation', 'Saturation', 0, 100, 1, '%'),
      rangeCapability('color_temp', 'Color temperature', 2500, 9000, 100, 'K')
    );
  }

  return capabilities;
}

function typeFromDevice(device) {
  return device.deviceType === 'bulb' ? 'light' : 'plug';
}

function mapKasaDevice(managerId, device) {
  const kasaId =
    device.deviceId ||
    device.id ||
    device.macNormalized ||
    device.mac ||
    `${device.host || 'kasa'}-${device.port || 9999}`;
  const type = typeFromDevice(device);

  return {
    id: `${managerId}-${sanitizeId(kasaId)}`,
    managerId,
    source: 'kasa',
    type,
    name: device.alias || (type === 'light' ? 'Kasa Light' : 'Kasa Plug'),
    online: device.status === 'offline' ? 'offline' : 'online',
    capabilities: capabilitiesForKasaType(type),
    metadata: {
      host: device.host,
      port: device.port,
      mac: device.macNormalized || device.mac,
      model: device.model,
      kasaDeviceId: device.deviceId,
    },
  };
}

function sanitizeLightState(lightState = {}) {
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

  return nextState;
}

class KasaManager {
  constructor({
    id = 'kasa-main',
    name = 'Kasa Manager',
    discoveryTimeoutMs = 3000,
    scanIntervalMs = 5 * 60 * 1000,
  } = {}) {
    this.id = id;
    this.name = name;
    this.discoveryTimeoutMs = discoveryTimeoutMs;
    this.scanIntervalMs = scanIntervalMs;
    this.client = new Client();
    this.rawDevices = new Map();
    this.managedDevices = new Map();
    this.queues = new Map();
    this.lastDiscoveryAt = null;
    this.lastDiscoveryStartedAt = null;
    this.lastDiscoveryErrors = [];
    this.isScanning = false;
    this.discoveryPromise = null;
    this.scanInterval = null;
  }

  getInfo() {
    return {
      id: this.id,
      name: this.name,
      kind: 'kasa',
      version: '1.0.0',
      online: true,
      supportsDiscovery: true,
      supportsBulkActions: false,
      integrationType: 'native',
      metadata: {
        deviceCount: this.managedDevices.size,
        lastDiscoveryAt: this.lastDiscoveryAt,
        lastDiscoveryStartedAt: this.lastDiscoveryStartedAt,
        isScanning: this.isScanning,
        scanIntervalMs: this.scanIntervalMs,
        discoveryTimeoutMs: this.discoveryTimeoutMs,
        errors: this.lastDiscoveryErrors,
      },
    };
  }

  async listDevices() {
    if (this.managedDevices.size === 0 && !this.lastDiscoveryAt) {
      await this.discoverDevices();
    }
    return Array.from(this.managedDevices.values()).map(clone);
  }

  async getDevice(deviceId) {
    if (!this.managedDevices.has(deviceId)) {
      await this.listDevices();
    }
    return clone(this.managedDevices.get(deviceId) ?? null);
  }

  async getDeviceState(deviceId) {
    const managed = await this.getDevice(deviceId);
    const raw = this.rawDevices.get(deviceId);
    if (!managed || !raw) return null;

    const values = {};
    for (const capability of managed.capabilities) values[capability.id] = null;

    try {
      if (typeof raw.getPowerState === 'function') {
        values.power = await raw.getPowerState();
      }

      if (managed.type === 'light' && raw.lighting?.getLightState) {
        const lightState = await raw.lighting.getLightState();
        values.brightness = lightState.brightness ?? null;
        values.hue = lightState.hue ?? null;
        values.saturation = lightState.saturation ?? null;
        values.color_temp = lightState.color_temp ?? lightState.color_temp_on ?? null;
      }
    } catch (err) {
      return {
        deviceId,
        ts: Date.now(),
        values,
        error: err.message,
      };
    }

    return { deviceId, ts: Date.now(), values };
  }

  async executeAction(action) {
    const managed = await this.getDevice(action.deviceId);
    const raw = this.rawDevices.get(action.deviceId);
    if (!managed || !raw) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: 'Kasa device not found. Sync the Kasa manager and try again.',
      };
    }

    const capability = managed.capabilities.find((item) => item.id === action.capabilityId);
    const validation = this.validateAction(action, capability);
    if (!validation.ok) return validation;

    return this.queueForDevice(action.deviceId, () => this.applyAction(raw, managed, action));
  }

  async discover() {
    const before = new Set(this.managedDevices.keys());
    const devices = await this.discoverDevices();
    let added = 0;
    let updated = 0;

    for (const device of devices) {
      if (before.has(device.id)) updated++;
      else added++;
    }

    return {
      managerId: this.id,
      discovered: devices.length,
      added,
      updated,
      offlineMarked: 0,
      errors: this.lastDiscoveryErrors,
    };
  }

  async shutdown() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.client.stopDiscovery();
  }

  startAutoDiscovery(onScanComplete) {
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (!this.scanIntervalMs || this.scanIntervalMs <= 0) return;

    this.scanInterval = setInterval(() => {
      void this.discover()
        .then(async (result) => {
          if (typeof onScanComplete === 'function') {
            await onScanComplete(result);
          }
        })
        .catch((err) => {
          this.lastDiscoveryErrors = [err.message];
          console.error(`[KasaManager] Scheduled scan failed: ${err.message}`);
        });
    }, this.scanIntervalMs);

    if (typeof this.scanInterval.unref === 'function') {
      this.scanInterval.unref();
    }
  }

  async discoverDevices() {
    if (this.discoveryPromise) return this.discoveryPromise;

    this.discoveryPromise = this.runDiscovery();
    try {
      return await this.discoveryPromise;
    } finally {
      this.discoveryPromise = null;
    }
  }

  async runDiscovery() {
    const found = new Map();
    const errors = [];
    const collect = (s) => {
      if (!device || !allowedDevices.includes(device.deviceType)) return;
      const managed = mapKasaDevice(this.id, device);
      found.set(managed.id, { raw: device, managed });
    };
    const onError = (err) => errors.push(err.message);

    this.client.on('device-new', collect);
    this.client.on('device-online', collect);
    this.client.on('error', onError);
    this.isScanning = true;
    this.lastDiscoveryStartedAt = new Date().toISOString();

    try {
      this.client.startDiscovery({
        deviceTypes: allowedDevices,
        discoveryInterval: 1000,
        discoveryTimeout: this.discoveryTimeoutMs,
      });
      await sleep(this.discoveryTimeoutMs + 250);
    } finally {
      this.client.stopDiscovery();
      this.client.off('device-new', collect);
      this.client.off('device-online', collect);
      this.client.off('error', onError);
      this.isScanning = false;
    }

    for (const device of this.client.devices?.values?.() ?? []) {
      collect(device);
    }

    this.rawDevices.clear();
    this.managedDevices.clear();
    for (const [id, value] of found.entries()) {
      this.rawDevices.set(id, value.raw);
      this.managedDevices.set(id, value.managed);
    }

    this.lastDiscoveryAt = new Date().toISOString();
    this.lastDiscoveryErrors = errors;
    return Array.from(this.managedDevices.values()).map(clone);
  }

  validateAction(action, capability) {
    if (!capability) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: 'Capability not supported by device',
      };
    }

    if (action.commandType === 'set' && action.value === undefined) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: 'Missing value for set command',
      };
    }

    if (action.commandType === 'delta' && action.delta === undefined) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: 'Missing delta for delta command',
      };
    }

    if (action.commandType === 'toggle' && capability.kind !== 'toggle') {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: 'Toggle command only valid for toggle capability',
      };
    }

    return { ok: true };
  }

  queueForDevice(deviceId, task) {
    const previous = this.queues.get(deviceId) || Promise.resolve();
    const next = previous.then(task, task);
    this.queues.set(deviceId, next.catch(() => undefined));
    return next;
  }

  async applyAction(raw, managed, action) {
    try {
      if (action.capabilityId === 'power') {
        const nextPower =
          action.commandType === 'toggle'
            ? !(await raw.getPowerState())
            : Boolean(action.value);
        await raw.setPowerState(nextPower);
        return {
          ok: true,
          deviceId: action.deviceId,
          capabilityId: action.capabilityId,
          appliedValue: nextPower,
        };
      }

      if (managed.type !== 'light' || !raw.lighting?.setLightState) {
        return {
          ok: false,
          deviceId: action.deviceId,
          capabilityId: action.capabilityId,
          message: 'Capability requires a Kasa light device',
        };
      }

      const state = await this.lightStateForAction(raw, action);
      await raw.lighting.setLightState(state);
      return {
        ok: true,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        appliedValue: state[action.capabilityId],
      };
    } catch (err) {
      return mapKasaError(err, action, raw);
    }
  }

  async lightStateForAction(raw, action) {
    const key = action.capabilityId;
    let value = action.commandType === 'delta' ? Number(action.delta) : action.value;

    if (action.commandType === 'delta') {
      const current = raw.lighting?.getLightState ? await raw.lighting.getLightState() : {};
      value = Number(current[key] ?? 0) + Number(action.delta);
    }

    return sanitizeLightState({
      on_off: key === 'brightness' && Number(value) <= 0 ? 0 : 1,
      [key]: value,
    });
  }
}

function createKasaManager(options) {
  return new KasaManager(options);
}

function mapKasaError(err, action, raw) {
  const message = err?.message || 'Unknown Kasa error';
  const host = raw?.host;
  const port = raw?.port;

  if (/TCP Timeout/i.test(message)) {
    console.log(`[KasaManager] TCP timeout error for device ${action.deviceId} at ${host}:${port}`);
    return {
      ok: false,
      status: 503,
      code: 'DEVICE_UNREACHABLE',
      deviceId: action.deviceId,
      capabilityId: action.capabilityId,
      message: 'Kasa device is offline or unreachable',
      details: {
        host,
        port,
        cause: message,
      },
    };
  }

  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(message)) {
    console.log(`[KasaManager] Network error for device ${action.deviceId} at ${host}:${port}: ${message}`);
    return {
      ok: false,
      status: 503,
      code: 'DEVICE_UNREACHABLE',
      deviceId: action.deviceId,
      capabilityId: action.capabilityId,
      message: 'Kasa device could not be reached over the network',
      details: {
        host,
        port,
        cause: message,
      },
    };
  }

  console.log(`[KasaManager] Error executing action on device ${action.deviceId} at ${host}:${port}: ${message}`);
  return {
    ok: false,
    status: 502,
    code: 'KASA_ACTION_FAILED',
    deviceId: action.deviceId,
    capabilityId: action.capabilityId,
    message: 'Kasa manager failed to execute action',
    details: {
      host,
      port,
      cause: message,
    },
  };
}

module.exports = {
  KasaManager,
  createKasaManager,
  mapKasaDevice,
};
