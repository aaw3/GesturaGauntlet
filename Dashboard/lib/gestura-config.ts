export type CapabilityType = "toggle" | "range" | "color" | "discrete";

export interface DeviceCapability {
  id: string;
  label: string;
  type: CapabilityType;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  readable?: boolean;
  writable?: boolean;
}

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
  hostedManagerCount?: number;
  interfaces?: ManagerInterface[];
  metadata?: Record<string, unknown>;
}

export interface SystemStatus {
  controlPlane: {
    api: string;
    uptimeSec: number;
    startedAt: string;
  };
  database: {
    configured: boolean;
    connected: boolean;
  };
  influxdb: {
    enabled: boolean;
    status: string;
    lastError?: string | null;
    lastSuccessAt?: string | null;
  };
  websocketHub: {
    online: boolean;
    connectedNodeCount: number;
    connectedDashboardCount: number;
    connectedGloveCount?: number;
  };
  inventory: {
    nodeCount: number;
    managerCount: number;
    deviceCount: number;
  };
  telemetry: {
    recentEventCount: number;
    recentRouteMetricCount: number;
  };
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

export interface DeviceDefinition {
  id: string;
  managerId: string;
  name: string;
  type: string;
  online: "online" | "offline" | "unknown";
  capabilities: DeviceCapability[];
  provenance?: DeviceProvenance;
  managerInterfaces?: ManagerInterface[];
}

export interface DeviceManagerInfo {
  id: string;
  nodeId?: string;
  name: string;
  kind: string;
  version: string;
  online: boolean;
  supportsDiscovery: boolean;
  supportsBulkActions: boolean;
  integrationType?: "native" | "external" | "node";
  baseUrl?: string;
  interfaces?: ManagerInterface[];
  metadata?: ManagerDisplayMetadata & Record<string, unknown>;
}

export interface BackendRangeSpec {
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

export interface BackendCapability {
  id: string;
  label: string;
  kind: "toggle" | "range" | "color" | "discrete" | "scene";
  readable?: boolean;
  writable?: boolean;
  range?: BackendRangeSpec;
  options?: string[];
}

export interface BackendManagedDevice {
  id: string;
  managerId: string;
  source?: string;
  type: string;
  name: string;
  online: "online" | "offline" | "unknown";
  capabilities: BackendCapability[];
  metadata?: Record<string, unknown>;
  provenance?: DeviceProvenance;
  managerInterfaces?: ManagerInterface[];
}

export type MappingMode =
  | "toggle"
  | "continuous_absolute"
  | "continuous_delta"
  | "step"
  | "scene";

export interface ActionMapping {
  source: string;
  mode: MappingMode;
  targetDevice: string;
  targetAction: string;
  min: number;
  max: number;
  deadzone: number;
  step: number;
  invert: boolean;
  offset: number;
  smoothing: number;
}

export interface GloveMappingContract {
  id: string;
  gloveId: string;
  enabled: boolean;
  inputSource: string;
  targetDeviceId: string;
  targetCapabilityId: string;
  mode: MappingMode;
  transform: {
    deadzone: number;
    invert: boolean;
    offset: number;
    min: number;
    max: number;
    step: number;
    smoothing: number;
  };
}

export const sourceInputs = [
  "top_double_tap",
  "bottom_double_tap",
  "top_hold_roll",
  "bottom_tap",
  "bottom_hold_roll",
  "glove.roll",
  "glove.pitch",
] as const;

export function mapBackendDeviceToDefinition(
  device: BackendManagedDevice,
  manager?: DeviceManagerInfo,
): DeviceDefinition {
  return {
    id: device.id,
    managerId: device.managerId,
    name: device.name,
    type: device.type || manager?.kind || "device",
    online: device.online || "unknown",
    capabilities: device.capabilities.map(mapBackendCapability),
    provenance: device.provenance,
    managerInterfaces: device.managerInterfaces,
  };
}

function mapBackendCapability(capability: BackendCapability): DeviceCapability {
  return {
    id: capability.id,
    label: capability.label,
    type: capability.kind === "scene" ? "discrete" : capability.kind,
    min: capability.range?.min,
    max: capability.range?.max,
    step: capability.range?.step,
    options: capability.options,
    readable: capability.readable,
    writable: capability.writable,
  };
}

export function mapGloveMappingContractToActionMapping(mapping: GloveMappingContract): ActionMapping {
  return {
    source: mapping.inputSource,
    mode: mapping.mode,
    targetDevice: mapping.targetDeviceId,
    targetAction: mapping.targetCapabilityId,
    min: mapping.transform.min,
    max: mapping.transform.max,
    deadzone: mapping.transform.deadzone,
    step: mapping.transform.step,
    invert: mapping.transform.invert,
    offset: mapping.transform.offset,
    smoothing: mapping.transform.smoothing,
  };
}
