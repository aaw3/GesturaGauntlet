export type ManagerInterfaceKind = "lan" | "public";

export interface ManagerInterface {
  kind: ManagerInterfaceKind;
  url: string;
  priority: number;
}

export interface ManagerDisplayMetadata {
  name: string;
  description?: string;
  iconKey?: string;
  colorKey?: string;
}

export interface NodeInfo {
  id: string;
  name: string;
  online: boolean;
  lastHeartbeatAt?: string | null;
  managerIds: string[];
  interfaces?: ManagerInterface[];
  metadata?: Record<string, unknown>;
}

export interface DeviceManagerInfo {
  id: string;
  nodeId: string;
  kind: string;
  version: string;
  online: boolean;
  interfaces: ManagerInterface[];
  metadata: ManagerDisplayMetadata;
  supportsDiscovery?: boolean;
  supportsBulkActions?: boolean;
  integrationType?: "native" | "external" | "node";
  baseUrl?: string;
}

export interface DeviceProvenance {
  nodeId: string;
  nodeName?: string;
  managerId: string;
  managerName?: string;
  managerKind?: string;
  managerIconKey?: string;
  managerColorKey?: string;
}

export interface DeviceCapability {
  id: string;
  label: string;
  kind: string;
  readable?: boolean;
  writable?: boolean;
  range?: Record<string, unknown>;
  options?: string[];
}

export interface ManagedDevice {
  id: string;
  managerId: string;
  source: string;
  type: string;
  name: string;
  online: "online" | "offline" | "unknown";
  capabilities: DeviceCapability[];
  metadata?: Record<string, unknown>;
  provenance?: DeviceProvenance;
  managerInterfaces?: ManagerInterface[];
}

export interface DeviceStateSnapshot {
  deviceId: string;
  ts: number;
  values: Record<string, string | number | boolean | null>;
}

export interface RouteAttemptMetric {
  id: string;
  ts: number;
  managerId: string;
  nodeId?: string;
  deviceId?: string;
  attemptedRoute: ManagerInterfaceKind;
  finalRoute?: ManagerInterfaceKind;
  success: boolean;
  latencyMs?: number;
  error?: string;
  fallback?: boolean;
  message?: string;
}

export interface TelemetryEvent {
  id: string;
  ts: number;
  nodeId?: string;
  managerId?: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface TelemetryBatchPayload {
  events: TelemetryEvent[];
}

export interface NodeRegistrationPayload extends NodeInfo {
  token?: string;
}

export interface ManagerRegistrationPayload {
  nodeId: string;
  info: DeviceManagerInfo;
  devices?: ManagedDevice[];
}

export interface ManagerRouteState {
  managerId: string;
  activeRoute: ManagerInterfaceKind | null;
  lanCooldownUntil?: number;
  lastLanSuccessAt?: number;
  lastLanFailureAt?: number;
  lastPublicSuccessAt?: number;
}
