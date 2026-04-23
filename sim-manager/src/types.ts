export type OnlineStatus = "online" | "offline" | "unknown";
export type DeviceType = "light" | "plug" | "fan" | "thermostat" | "other";
export type CapabilityKind = "toggle" | "range" | "color" | "discrete";
export type ActionCommandType = "set" | "delta" | "toggle" | "execute";

export interface RangeSpec {
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

export interface DeviceCapability {
  id: string;
  label: string;
  kind: CapabilityKind;
  readable?: boolean;
  writable?: boolean;
  range?: RangeSpec;
  options?: string[];
}

export interface SimDevice {
  id: string;
  managerId: string;
  source: "simulator";
  type: DeviceType;
  name: string;
  online: OnlineStatus;
  capabilities: DeviceCapability[];
}

export interface ManagerInterface {
  kind: "lan" | "public";
  url: string;
  priority: number;
}

export interface ManagerDisplayMetadata {
  name: string;
  description?: string;
  iconKey?: string;
  colorKey?: string;
}

export interface DeviceStateSnapshot {
  deviceId: string;
  ts: number;
  values: Record<string, string | number | boolean | null>;
}

export interface DeviceActionRequest {
  deviceId: string;
  capabilityId: string;
  commandType: ActionCommandType;
  value?: string | number | boolean | null;
  delta?: number;
  command?: string;
  params?: Record<string, unknown>;
}

export interface DeviceActionResult {
  ok: boolean;
  deviceId: string;
  capabilityId: string;
  appliedValue?: string | number | boolean | null;
  changed?: boolean;
  message?: string;
}

export interface DeviceManagerInfo {
  id: string;
  name: string;
  kind: string;
  version: string;
  online: boolean;
  supportsDiscovery: boolean;
  supportsBulkActions: boolean;
  integrationType?: string;
  nodeId?: string;
  interfaces?: ManagerInterface[];
  metadata: Record<string, unknown>;
}

export interface BulkActionRequest {
  actions: DeviceActionRequest[];
}

export interface BulkActionResult {
  ok: boolean;
  results: DeviceActionResult[];
}
