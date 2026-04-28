import { DeviceRegistry } from "../managers/base/DeviceRegistry";
import { DeviceActionRequest, DeviceActionResult } from "../types/api";
import { ManagerService } from "./ManagerService";

export class ActionRouter {
  constructor(
    private managerService: ManagerService,
    private registry: DeviceRegistry,
  ) {}

  async execute(action: DeviceActionRequest): Promise<DeviceActionResult> {
    const device = this.registry.getById(action.deviceId);
    if (!device) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: "Device not found in registry",
      };
    }

    const capability = device.capabilities.find(
      (candidate) => candidate.id === action.capabilityId,
    );
    if (!capability) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: "Capability not found",
      };
    }

    const manager = this.managerService.get(device.managerId);
    if (!manager) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: `Manager ${device.managerId} not found`,
      };
    }

    return manager.executeAction(action);
  }

  async route(action: DeviceActionRequest): Promise<DeviceActionResult> {
    return this.execute(action);
  }
}
