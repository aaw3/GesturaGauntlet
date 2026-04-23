import { DeviceManager } from "../base/DeviceManager";
import {
  DeviceManagerInfo,
  DeviceStateSnapshot,
  ManagerSyncResult,
} from "../../types/manager";
import { ManagedDevice } from "../../types/device";
import { DeviceActionRequest, DeviceActionResult } from "../../types/api";
import { KasaDiscoveredDevice } from "./kasa-types";
import { mapKasaDeviceToManaged } from "./kasa-mapper";

export class KasaDeviceManager implements DeviceManager {
  private devices: ManagedDevice[] = [];

  constructor(
    private managerId: string,
    initialDevices: KasaDiscoveredDevice[] = [],
    private options: { name?: string } = {},
  ) {
    this.devices = initialDevices.map((device) =>
      mapKasaDeviceToManaged(this.managerId, device),
    );
  }

  async getInfo(): Promise<DeviceManagerInfo> {
    return {
      id: this.managerId,
      name: this.options.name ?? "Kasa Manager",
      kind: "kasa",
      version: "1.0.0",
      online: true,
      nodeId: "node-agent-required",
      interfaces: [],
      metadata: {
        name: this.options.name ?? "Kasa Manager",
        description: "TP-Link Kasa bulbs and plugs hosted by a node agent.",
        iconKey: "lightbulb",
        colorKey: "amber",
      },
      supportsDiscovery: true,
      supportsBulkActions: false,
      integrationType: "node",
    };
  }

  async listDevices(): Promise<ManagedDevice[]> {
    return this.devices.map((device) => ({ ...device }));
  }

  async getDevice(deviceId: string): Promise<ManagedDevice | null> {
    const device = this.devices.find((candidate) => candidate.id === deviceId);
    return device ? { ...device } : null;
  }

  async getDeviceState(deviceId: string): Promise<DeviceStateSnapshot | null> {
    const device = await this.getDevice(deviceId);
    if (!device) return null;

    const values: Record<string, string | number | boolean | null> = {};
    for (const capability of device.capabilities) {
      values[capability.id] = null;
    }

    return {
      deviceId,
      ts: Date.now(),
      values,
    };
  }

  async executeAction(action: DeviceActionRequest): Promise<DeviceActionResult> {
    const device = await this.getDevice(action.deviceId);
    if (!device) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: "Kasa device not found",
      };
    }

    const capability = device.capabilities.find(
      (capability) => capability.id === action.capabilityId,
    );

    if (!capability) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: "Capability not supported by device",
      };
    }

    if (action.commandType === "set" && action.value === undefined) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: "Missing value for set command",
      };
    }

    if (action.commandType === "delta" && action.delta === undefined) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: "Missing delta for delta command",
      };
    }

    if (action.commandType === "toggle" && capability.kind !== "toggle") {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: "Toggle command only valid for toggle capability",
      };
    }

    return {
      ok: true,
      deviceId: action.deviceId,
      capabilityId: action.capabilityId,
      appliedValue: action.value ?? action.delta ?? null,
      message: "Kasa action accepted by manager placeholder",
    };
  }

  async discover(): Promise<ManagerSyncResult> {
    return {
      managerId: this.managerId,
      discovered: this.devices.length,
      added: 0,
      updated: this.devices.length,
      offlineMarked: 0,
      errors: [],
    };
  }
}
