const { clone } = require('../../../gestura-backend/runtime/utils');

class LocalNodeCache {
  constructor() {
    this.configSnapshot = null;
    this.deviceInventory = new Map();
    this.deviceStates = new Map();
    this.pendingTelemetry = [];
  }

  setConfigSnapshot(snapshot) {
    this.configSnapshot = clone(snapshot);
  }

  getConfigSnapshot() {
    return clone(this.configSnapshot);
  }

  setManagerDevices(managerId, devices = []) {
    this.deviceInventory.set(managerId, devices.map(clone));
  }

  getAllDevices() {
    return Array.from(this.deviceInventory.values()).flat().map(clone);
  }

  setDeviceState(deviceId, state) {
    this.deviceStates.set(deviceId, clone(state));
  }

  enqueueTelemetry(metric) {
    this.pendingTelemetry.push({ ts: Date.now(), ...metric });
  }

  drainTelemetry() {
    const drained = this.pendingTelemetry.map(clone);
    this.pendingTelemetry = [];
    return drained;
  }
}

module.exports = { LocalNodeCache };
