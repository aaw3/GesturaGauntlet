import { DeviceRegistry } from "../managers/base/DeviceRegistry";
import { ManagedDevice } from "../types/device";
import { DeviceStateSnapshot } from "../types/manager";
import { ManagerService } from "./ManagerService";

export class DeviceService {
  constructor(
    private managerService: ManagerService,
    private registry: DeviceRegistry,
  ) {}

  listDevices(managerId?: string): ManagedDevice[] {
    return managerId ? this.registry.getByManager(managerId) : this.registry.getAll();
  }

  getDevice(deviceId: string): ManagedDevice | null {
    return this.registry.getById(deviceId);
  }

  async getDeviceState(deviceId: string): Promise<DeviceStateSnapshot | null> {
    const device = this.registry.getById(deviceId);
    if (!device) return null;

    const manager = this.managerService.get(device.managerId);
    if (!manager) return null;

    return manager.getDeviceState(deviceId);
  }
}
