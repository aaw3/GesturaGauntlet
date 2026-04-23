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
    private options: { name?: string; baseUrl?: string; managerInfo?: DeviceManagerInfo } = {},
  ) {}

  async getInfo(): Promise<DeviceManagerInfo> {
    if (this.options.managerInfo) {
      return {
        ...this.options.managerInfo,
        name: this.options.name ?? this.options.managerInfo.name,
        integrationType: "external",
        baseUrl: this.options.baseUrl ?? this.options.managerInfo.baseUrl,
        nodeId: this.options.managerInfo.nodeId ?? "node-agent-required",
        interfaces: this.options.managerInfo.interfaces?.length
          ? this.options.managerInfo.interfaces
          : this.options.baseUrl
            ? [{ kind: "public", url: this.options.baseUrl, priority: 20 }]
            : [],
        metadata: {
          name: this.options.name ?? this.options.managerInfo.metadata?.name ?? this.options.managerInfo.name ?? "Simulator Manager",
          description: this.options.managerInfo.metadata?.description ?? "Simulator devices exposed through the manager contract.",
          iconKey: this.options.managerInfo.metadata?.iconKey ?? "cpu",
          colorKey: this.options.managerInfo.metadata?.colorKey ?? "cyan",
          ...this.options.managerInfo.metadata,
        },
      };
    }

    try {
      const info = await this.client.getJson<DeviceManagerInfo>("/api/manager");
      return {
        ...info,
        id: info.id || this.managerId,
        name: this.options.name ?? info.name,
        integrationType: "external",
        baseUrl: this.options.baseUrl ?? info.baseUrl,
        nodeId: info.nodeId ?? "node-agent-required",
        interfaces: info.interfaces?.length
          ? info.interfaces
          : this.options.baseUrl
            ? [{ kind: "public", url: this.options.baseUrl, priority: 20 }]
            : [],
        metadata: {
          name: this.options.name ?? info.metadata?.name ?? info.name ?? "Simulator Manager",
          description: info.metadata?.description ?? "Simulator devices exposed through the manager contract.",
          iconKey: info.metadata?.iconKey ?? "cpu",
          colorKey: info.metadata?.colorKey ?? "cyan",
          ...info.metadata,
        },
      };
    } catch {
      // Fall back to configured metadata so a temporarily offline external
      // manager can still be represented in the backend manager list.
    }

    return {
      id: this.managerId,
      name: this.options.name ?? "Simulator Manager",
      kind: "simulator",
      version: "1.0.0",
      online: true,
      nodeId: "node-agent-required",
      interfaces: this.options.baseUrl ? [{ kind: "public", url: this.options.baseUrl, priority: 20 }] : [],
      metadata: {
        name: this.options.name ?? "Simulator Manager",
        description: "Simulator devices exposed through the manager contract.",
        iconKey: "cpu",
        colorKey: "cyan",
      },
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
