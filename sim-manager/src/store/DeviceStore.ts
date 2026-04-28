import {
  DeviceActionRequest,
  DeviceActionResult,
  DeviceManagerInfo,
  DeviceStateSnapshot,
  ManagerInterface,
  SimDevice,
} from "../types";

export class SimulatorApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SimulatorApiError";
  }
}

export class DeviceStore {
  readonly simulatorApiUrl: string;

  constructor(
    simulatorApiUrl =
      process.env.SIMULATOR_API_URL || process.env.SIMULATOR_URL || "http://localhost:3000",
  ) {
    this.simulatorApiUrl = simulatorApiUrl.replace(/\/+$/, "");
  }

  async getManagerInfo(): Promise<DeviceManagerInfo> {
    const info = await this.fetchJson<DeviceManagerInfo>("/api/manager");
    return {
      ...info,
      kind: process.env.MANAGER_KIND || info.kind || "simulator",
      metadata: {
        ...(info.metadata || {}),
        name: process.env.MANAGER_NAME || info.name,
        description:
          process.env.MANAGER_DESCRIPTION ||
          "Simulator manager attached to a Gestura node agent.",
        iconKey: process.env.MANAGER_ICON_KEY || "cpu",
        colorKey: process.env.MANAGER_COLOR_KEY || "cyan",
      },
      interfaces: managerInterfacesFromEnv(),
    };
  }

  async listDevices(): Promise<SimDevice[]> {
    return this.fetchJson<SimDevice[]>("/api/devices");
  }

  async getDevice(deviceId: string): Promise<SimDevice | undefined> {
    const devices = await this.listDevices();
    return devices.find((device) => device.id === deviceId);
  }

  async listStates(): Promise<DeviceStateSnapshot[]> {
    return this.fetchJson<DeviceStateSnapshot[]>("/api/devices/state");
  }

  async getState(deviceId: string): Promise<DeviceStateSnapshot | undefined> {
    const state = await this.fetchJson<DeviceStateSnapshot | { error?: string }>(
      `/api/devices/${encodeURIComponent(deviceId)}/state`,
      { allowNotFound: true },
    );
    return "deviceId" in state ? state : undefined;
  }

  async applyAction(action: DeviceActionRequest): Promise<DeviceActionResult> {
    return this.fetchJson<DeviceActionResult>(
      `/api/devices/${encodeURIComponent(action.deviceId)}/actions/${encodeURIComponent(
        action.capabilityId,
      )}`,
      {
        method: "POST",
        body: JSON.stringify(action),
        headers: { "content-type": "application/json" },
      },
    );
  }

  private async fetchJson<T>(
    path: string,
    options: RequestInit & { allowNotFound?: boolean } = {},
  ): Promise<T> {
    const { allowNotFound, ...fetchOptions } = options;
    const url = `${this.simulatorApiUrl}${path}`;
    let response: Response;

    try {
      response = await fetch(url, fetchOptions);
    } catch (error) {
      throw new SimulatorApiError(
        `Simulator API is unreachable at ${this.simulatorApiUrl}: ${
          error instanceof Error ? error.message : "request failed"
        }`,
      );
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok && !(allowNotFound && response.status === 404)) {
      throw new SimulatorApiError(
        typeof payload?.error === "string"
          ? payload.error
          : `Simulator API request failed: ${response.status}`,
        response.status,
      );
    }

    return payload as T;
  }
}

function managerInterfacesFromEnv() {
  const interfaces: ManagerInterface[] = [];
  const lanUrls = parseUrlList(process.env.MANAGER_LAN_URLS || process.env.MANAGER_LAN_URL);
  const publicUrls = parseUrlList(process.env.MANAGER_PUBLIC_URLS || process.env.MANAGER_PUBLIC_URL);
  lanUrls.forEach((url, index) => interfaces.push({ kind: "lan", url, priority: 10 + index }));
  const publicStart = interfaces.length ? interfaces[interfaces.length - 1].priority + 10 : 50;
  publicUrls.forEach((url, index) => interfaces.push({ kind: "public", url, priority: publicStart + index }));
  return interfaces;
}

function parseUrlList(value?: string) {
  return String(value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}
