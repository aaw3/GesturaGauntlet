import { ID, TimestampMs } from "./common";
import { ManagedDevice } from "./device";

export interface DeviceStateSnapshot {
  deviceId: ID;
  ts: TimestampMs;
  values: Record<string, string | number | boolean | null>;
}

export interface DeviceManagerInfo {
  id: ID;
  name: string;
  kind: "kasa" | "simulator" | "custom";
  version: string;
  online: boolean;
  supportsDiscovery: boolean;
  supportsBulkActions: boolean;
  integrationType?: "native" | "external";
  baseUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface ManagerSyncResult {
  managerId: ID;
  discovered: number;
  added: number;
  updated: number;
  offlineMarked: number;
  errors: string[];
}

export interface AddExternalManagerRequest {
  name?: string;
  baseUrl: string;
  authToken?: string;
}

export interface CreateManagerRequest extends AddExternalManagerRequest {
  id: ID;
  kind: "simulator" | "custom";
}

export interface AddNativeKasaManagerRequest {
  id?: ID;
  name: string;
}

export interface ExternalManagerValidationResult {
  ok: boolean;
  managerInfo?: DeviceManagerInfo;
  deviceCount?: number;
  errors: string[];
}

export interface ManagerDeviceListResult {
  manager: DeviceManagerInfo;
  devices: ManagedDevice[];
}
