import { ID, TimestampMs } from "./common";
import { ManagedDevice } from "./device";
import { ManagerDisplayMetadata, ManagerInterface } from "./topology";

export interface DeviceStateSnapshot {
  deviceId: ID;
  ts: TimestampMs;
  values: Record<string, string | number | boolean | null>;
}

export interface DeviceManagerInfo {
  id: ID;
  nodeId: ID;
  name?: string;
  kind: string;
  version: string;
  online: boolean;
  interfaces: ManagerInterface[];
  metadata: ManagerDisplayMetadata & Record<string, unknown>;
  supportsDiscovery: boolean;
  supportsBulkActions: boolean;
  integrationType?: "native" | "external" | "node";
  baseUrl?: string;
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
  kind: string;
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
