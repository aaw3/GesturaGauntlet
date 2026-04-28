const { clone } = require('../utils');

class DeviceRegistry {
  constructor({ persistence } = {}) {
    this.devices = new Map();
    this.persistence = persistence;
  }

  async upsertMany(devices = []) {
    for (const device of devices) {
      this.devices.set(device.id, clone(device));
    }
  }

  getAll(managerId) {
    const devices = Array.from(this.devices.values()).map(clone);
    return managerId ? devices.filter((device) => device.managerId === managerId) : devices;
  }

  getById(deviceId) {
    const device = this.devices.get(deviceId);
    return device ? clone(device) : null;
  }

  getByManager(managerId) {
    return this.getAll(managerId);
  }

  markOfflineMissing(managerId, activeIds) {
    for (const [deviceId, device] of this.devices.entries()) {
      if (device.managerId === managerId && !activeIds.has(deviceId)) {
        this.devices.set(deviceId, { ...device, online: 'offline' });
      }
    }
  }

  async clearManagerDevices(managerId) {
    for (const [deviceId, device] of this.devices.entries()) {
      if (device.managerId === managerId) {
        this.devices.delete(deviceId);
      }
    }
    await this.persistence?.clearManagerDevices?.(managerId);
  }
}

module.exports = { DeviceRegistry };
