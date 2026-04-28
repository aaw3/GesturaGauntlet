import { DeviceManager } from "../managers/base/DeviceManager";
import { DeviceManagerInfo, ManagerDeviceListResult } from "../types/manager";

export class ManagerService {
  private managers = new Map<string, DeviceManager>();

  register(managerId: string, manager: DeviceManager) {
    this.managers.set(managerId, manager);
  }

  unregister(managerId: string): boolean {
    return this.managers.delete(managerId);
  }

  async registerValidated(managerId: string, manager: DeviceManager) {
    const info = await manager.getInfo();
    if (info.id !== managerId) {
      throw new Error(`Manager ID mismatch: expected ${managerId}, got ${info.id}`);
    }

    this.register(managerId, manager);
  }

  get(managerId: string): DeviceManager | null {
    return this.managers.get(managerId) ?? null;
  }

  getAll(): Array<{ id: string; manager: DeviceManager }> {
    return Array.from(this.managers.entries()).map(([id, manager]) => ({
      id,
      manager,
    }));
  }

  async getInfos(): Promise<DeviceManagerInfo[]> {
    return Promise.all(this.getAll().map(({ manager }) => manager.getInfo()));
  }

  async listManagerDevices(): Promise<ManagerDeviceListResult[]> {
    return Promise.all(
      this.getAll().map(async ({ manager }) => ({
        manager: await manager.getInfo(),
        devices: await manager.listDevices(),
      })),
    );
  }
}
