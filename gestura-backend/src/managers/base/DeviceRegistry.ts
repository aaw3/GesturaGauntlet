import { ManagedDevice } from "../../types/device";

export class DeviceRegistry {
  private devices = new Map<string, ManagedDevice>();

  upsertMany(devices: ManagedDevice[]) {
    for (const device of devices) {
      this.devices.set(device.id, { ...device });
    }
  }

  upsert(device: ManagedDevice) {
    this.devices.set(device.id, { ...device });
  }

  getAll(): ManagedDevice[] {
    return Array.from(this.devices.values()).map((device) => ({ ...device }));
  }

  getById(id: string): ManagedDevice | null {
    const device = this.devices.get(id);
    return device ? { ...device } : null;
  }

  getByManager(managerId: string): ManagedDevice[] {
    return this.getAll().filter((device) => device.managerId === managerId);
  }

  markOfflineMissing(managerId: string, activeIds: Set<string>) {
    for (const [id, device] of this.devices.entries()) {
      if (device.managerId === managerId && !activeIds.has(id)) {
        this.devices.set(id, {
          ...device,
          online: "offline",
        });
      }
    }
  }

  clearManagerDevices(managerId: string) {
    for (const [id, device] of this.devices.entries()) {
      if (device.managerId === managerId) {
        this.devices.delete(id);
      }
    }
  }
}
