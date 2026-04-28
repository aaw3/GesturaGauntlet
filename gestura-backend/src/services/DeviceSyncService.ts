import { DeviceRegistry } from "../managers/base/DeviceRegistry";
import { ManagerSyncResult } from "../types/manager";
import { ManagerService } from "./ManagerService";

export class DeviceSyncService {
  constructor(
    private managerService: ManagerService,
    private deviceRegistry: DeviceRegistry,
  ) {}

  async syncManager(managerId: string): Promise<ManagerSyncResult> {
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

      this.deviceRegistry.upsertMany(devices);
      this.deviceRegistry.markOfflineMissing(managerId, activeIds);

      return {
        managerId,
        discovered: devices.length,
        added,
        updated,
        offlineMarked,
        errors: [],
      };
    } catch (error) {
      return {
        managerId,
        discovered: 0,
        added: 0,
        updated: 0,
        offlineMarked: 0,
        errors: [error instanceof Error ? error.message : "Unknown sync error"],
      };
    }
  }

  async syncAllManagers(): Promise<ManagerSyncResult[]> {
    return Promise.all(
      this.managerService
        .getAll()
        .map(({ id }) => this.syncManager(id)),
    );
  }
}
