import { DeviceManager } from "../base/DeviceManager";
import { DeviceManagerInfo, DeviceStateSnapshot } from "../../types/manager";
import { ManagedDevice } from "../../types/device";
import {
  DeviceActionRequest,
  DeviceActionResult,
  BulkActionRequest,
  BulkActionResult,
} from "../../types/api";
import { SimulatorClient } from "./simulator-client";

export class SimulatorDeviceManager implements DeviceManager {
  constructor(
    private managerId: string,
    private client: SimulatorClient,
    private options: { name?: string; baseUrl?: string } = {},
  ) {}

  async getInfo(): Promise<DeviceManagerInfo> {
    return {
      id: this.managerId,
      name: this.options.name ?? "Simulator Manager",
      kind: "simulator",
      version: "1.0.0",
      online: true,
      supportsDiscovery: false,
      supportsBulkActions: true,
      integrationType: "external",
      baseUrl: this.options.baseUrl,
    };
  }

  async listDevices(): Promise<ManagedDevice[]> {
    return this.client.getJson<ManagedDevice[]>("/api/devices");
  }

  async getDevice(deviceId: string): Promise<ManagedDevice | null> {
    try {
      const devices = await this.listDevices();
      return devices.find((device) => device.id === deviceId) ?? null;
    } catch {
      return null;
    }
  }

  async getDeviceState(deviceId: string): Promise<DeviceStateSnapshot | null> {
    return this.client.getJson<DeviceStateSnapshot>(`/api/devices/${deviceId}/state`);
  }

  async executeAction(action: DeviceActionRequest): Promise<DeviceActionResult> {
    return this.client.postJson<DeviceActionResult>(
      `/api/devices/${action.deviceId}/actions/${action.capabilityId}`,
      action,
    );
  }

  async executeBulkActions(request: BulkActionRequest): Promise<BulkActionResult> {
    return this.client.postJson<BulkActionResult>("/api/actions/bulk", request);
  }
}
