class DeviceSyncService {
  constructor(managerService, deviceRegistry, { persistence } = {}) {
    this.managerService = managerService;
    this.deviceRegistry = deviceRegistry;
    this.persistence = persistence;
  }

  async syncManager(managerId) {
    const manager = this.managerService.get(managerId);
    if (!manager) {
      return {
        managerId,
        discovered: 0,
        added: 0,
        updated: 0,
        offlineMarked: 0,
        errors: [`Manager ${managerId} not found`],
      };
    }

    try {
      const devices = await manager.listDevices();
      const activeIds = new Set(devices.map((device) => device.id));
      const existing = this.deviceRegistry.getByManager(managerId);
      const existingIds = new Set(existing.map((device) => device.id));
      let added = 0;
      let updated = 0;

      for (const device of devices) {
        if (existingIds.has(device.id)) updated++;
        else added++;
      }

      const offlineMarked = existing.filter((device) => !activeIds.has(device.id)).length;
      await this.deviceRegistry.upsertMany(devices);
      this.deviceRegistry.markOfflineMissing(managerId, activeIds);
      await this.persistence?.saveDevicesForManager?.(managerId, devices);

      return {
        managerId,
        discovered: devices.length,
        added,
        updated,
        offlineMarked,
        errors: [],
      };
    } catch (err) {
      return {
        managerId,
        discovered: 0,
        added: 0,
        updated: 0,
        offlineMarked: 0,
        errors: [err.message],
      };
    }
  }
}

module.exports = { DeviceSyncService };
