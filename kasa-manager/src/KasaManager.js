let Client;
try {
  ({ Client } = require('tplink-smarthome-api'));
} catch {
  ({ Client } = require('../../gestura-backend/node_modules/tplink-smarthome-api'));
}

const allowedDevices = ['plug', 'bulb'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function sanitizeId(value, fallback = 'device') {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
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
      rangeCapability('color_temp', 'Color temperature', 2500, 9000, 100, 'K'),
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

class KasaManager {
  constructor({
    id = 'kasa-main',
    name = 'Kasa Manager',
    discoveryTimeoutMs = 3000,
    scanIntervalMs = 5 * 60 * 1000,
    interfaces = [],
  } = {}) {
    this.id = id;
    this.name = name;
    this.discoveryTimeoutMs = discoveryTimeoutMs;
    this.scanIntervalMs = scanIntervalMs;
    this.interfaces = interfaces;
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
      integrationType: 'node',
      interfaces: this.interfaces,
      metadata: {
        name: this.name,
        description: 'TP-Link Kasa bulbs and plugs hosted by a node agent.',
        iconKey: 'lightbulb',
        colorKey: 'amber',
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
    if (!this.managedDevices.has(deviceId)) await this.listDevices();
    return clone(this.managedDevices.get(deviceId) ?? null);
  }

  async getDeviceState(deviceId) {
    const managed = await this.getDevice(deviceId);
    const raw = this.rawDevices.get(deviceId);
    if (!managed || !raw) return null;

    const values = {};
    for (const capability of managed.capabilities) values[capability.id] = null;

    try {
      if (typeof raw.getPowerState === 'function') values.power = await raw.getPowerState();
      if (managed.type === 'light' && raw.lighting?.getLightState) {
        const lightState = await raw.lighting.getLightState();
        values.brightness = lightState.brightness ?? null;
        values.hue = lightState.hue ?? null;
        values.saturation = lightState.saturation ?? null;
        values.color_temp = lightState.color_temp ?? lightState.color_temp_on ?? null;
      }
    } catch (err) {
      return { deviceId, ts: Date.now(), values, error: err.message };
    }

    return { deviceId, ts: Date.now(), values };
  }

  async executeAction(action) {
    let managed = await this.getDevice(action.deviceId);
    let raw = this.rawDevices.get(action.deviceId);
    if (!managed || !raw) {
      const hydrated = await this.hydrateDeviceForAction(action);
      managed = hydrated.managed || managed;
      raw = hydrated.raw || raw;
    }
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

  async hydrateDeviceForAction(action) {
    const metadata = action.metadata || action.device?.metadata || {};
    const host = metadata.host;
    if (!host) {
      await this.discoverDevices();
      return {
        managed: this.managedDevices.get(action.deviceId) || null,
        raw: this.rawDevices.get(action.deviceId) || null,
      };
    }

    try {
      const raw = await this.client.getDevice({
        host,
        port: Number(metadata.port || 9999),
      });
      const managed = {
        ...(action.device || mapKasaDevice(this.id, raw)),
        id: action.deviceId,
        managerId: this.id,
      };
      this.rawDevices.set(action.deviceId, raw);
      this.managedDevices.set(action.deviceId, managed);
      return { managed, raw };
    } catch {
      await this.discoverDevices();
      return {
        managed: this.managedDevices.get(action.deviceId) || null,
        raw: this.rawDevices.get(action.deviceId) || null,
      };
    }
  }

  async discover() {
    const before = new Set(this.managedDevices.keys());
    const devices = await this.discoverDevices();
    return {
      managerId: this.id,
      discovered: devices.length,
      added: devices.filter((device) => !before.has(device.id)).length,
      updated: devices.filter((device) => before.has(device.id)).length,
      offlineMarked: 0,
      errors: this.lastDiscoveryErrors,
    };
  }

  async clearStorage() {
    this.client.stopDiscovery();
    this.client.devices?.clear?.();
    this.rawDevices.clear();
    this.managedDevices.clear();
    this.queues.clear();
    this.lastDiscoveryAt = new Date().toISOString();
    this.lastDiscoveryStartedAt = null;
    this.lastDiscoveryErrors = [];
    return {
      ok: true,
      managerId: this.id,
      cleared: true,
    };
  }

  async shutdown() {
    if (this.scanInterval) clearInterval(this.scanInterval);
    this.client.stopDiscovery();
  }

  startAutoDiscovery(onScanComplete) {
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (!this.scanIntervalMs || this.scanIntervalMs <= 0) return;
    this.scanInterval = setInterval(() => {
      void this.discover()
        .then((result) => onScanComplete?.(result))
        .catch((err) => {
          this.lastDiscoveryErrors = [err.message];
          console.error(`[KasaManager] Scheduled scan failed: ${err.message}`);
        });
    }, this.scanIntervalMs);
    this.scanInterval.unref?.();
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
    const collect = (device) => {
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

    for (const device of this.client.devices?.values?.() ?? []) collect(device);

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
      return { ok: false, deviceId: action.deviceId, capabilityId: action.capabilityId, message: 'Capability not supported by device' };
    }
    if (action.commandType === 'set' && action.value === undefined) {
      return { ok: false, deviceId: action.deviceId, capabilityId: action.capabilityId, message: 'Missing value for set command' };
    }
    if (action.commandType === 'delta' && action.delta === undefined) {
      return { ok: false, deviceId: action.deviceId, capabilityId: action.capabilityId, message: 'Missing delta for delta command' };
    }
    if (action.commandType === 'toggle' && capability.kind !== 'toggle') {
      return { ok: false, deviceId: action.deviceId, capabilityId: action.capabilityId, message: 'Toggle command only valid for toggle capability' };
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
        const nextPower = action.commandType === 'toggle' ? !(await raw.getPowerState()) : Boolean(action.value);
        await raw.setPowerState(nextPower);
        return { ok: true, deviceId: action.deviceId, capabilityId: action.capabilityId, appliedValue: nextPower };
      }

      if (managed.type !== 'light' || !raw.lighting?.setLightState) {
        return { ok: false, deviceId: action.deviceId, capabilityId: action.capabilityId, message: 'Capability requires a Kasa light device' };
      }

      const state = await this.lightStateForAction(raw, action);
      await raw.lighting.setLightState(state);
      return { ok: true, deviceId: action.deviceId, capabilityId: action.capabilityId, appliedValue: state[action.capabilityId] };
    } catch (err) {
      return { ok: false, deviceId: action.deviceId, capabilityId: action.capabilityId, message: err.message };
    }
  }

  async lightStateForAction(raw, action) {
    const key = action.capabilityId;
    let value = action.commandType === 'delta' ? Number(action.delta) : action.value;
    if (action.commandType === 'delta') {
      const current = raw.lighting?.getLightState ? await raw.lighting.getLightState() : {};
      value = Number(current[key] ?? 0) + Number(action.delta);
    }
    return sanitizeLightState({ on_off: key === 'brightness' && Number(value) <= 0 ? 0 : 1, [key]: value });
  }
}

function sanitizeLightState(lightState = {}) {
  const nextState = { ...lightState };
  for (const key of Object.keys(nextState)) {
    if (nextState[key] === undefined) delete nextState[key];
  }
  if (nextState.brightness !== undefined) nextState.brightness = Math.round(clamp(nextState.brightness, 0, 100));
  if (nextState.hue !== undefined) nextState.hue = Math.round(clamp(nextState.hue, 0, 360));
  if (nextState.saturation !== undefined) nextState.saturation = Math.round(clamp(nextState.saturation, 0, 100));
  if (nextState.color_temp !== undefined) nextState.color_temp = Math.round(clamp(nextState.color_temp, 2500, 9000));
  if (nextState.transition_period !== undefined) nextState.transition_period = Math.round(clamp(nextState.transition_period, 0, 60_000));
  return nextState;
}

function createKasaManager(options) {
  return new KasaManager(options);
}

module.exports = { KasaManager, createKasaManager, mapKasaDevice };
