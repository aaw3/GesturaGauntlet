export type CapabilityType = "toggle" | "range" | "color" | "discrete";

export type DeviceKind =
  | "kasa-bulb"
  | "kasa-plug"
  | "sim-light"
  | "sim-fan"
  | "sim-thermostat"
  | "scene"
  | "other";

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
  grafana: {
    enabled: boolean;
    status: string;
    lastError?: string | null;
    lastSuccessAt?: string | null;
  };
  websocketHub: {
    online: boolean;
    connectedNodeCount: number;
    connectedDashboardCount: number;
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
  source: "kasa" | "simulator" | "custom";
  integrationType: "native" | "external" | "node";
  name: string;
  kind: DeviceKind;
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
  source: "kasa" | "simulator" | "custom";
  type: "light" | "plug" | "fan" | "thermostat" | "scene" | "other";
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

export const deviceKinds: { id: DeviceKind; label: string }[] = [
  { id: "kasa-bulb", label: "Kasa bulb" },
  { id: "kasa-plug", label: "Kasa plug" },
  { id: "sim-light", label: "Simulator light" },
  { id: "sim-fan", label: "Simulator fan" },
  { id: "sim-thermostat", label: "Simulator thermostat" },
  { id: "scene", label: "Scene" },
  { id: "other", label: "Other" },
];

export const capabilityLibrary: DeviceCapability[] = [
  { id: "power", label: "Power", type: "toggle", options: ["off", "on"] },
  { id: "brightness", label: "Brightness", type: "range", min: 0, max: 100, step: 5 },
  { id: "hue", label: "Hue", type: "range", min: 0, max: 360, step: 5 },
  { id: "saturation", label: "Saturation", type: "range", min: 0, max: 100, step: 5 },
  { id: "color_temp", label: "Color temperature", type: "range", min: 2500, max: 6500, step: 100 },
  { id: "speed", label: "Speed", type: "range", min: 0, max: 3, step: 1 },
  { id: "temperature", label: "Temperature", type: "range", min: 60, max: 85, step: 1 },
  { id: "scene", label: "Scene", type: "discrete", options: ["focus", "break", "alert"] },
];

export const defaultDevices: DeviceDefinition[] = [];

export const defaultMapping: ActionMapping = {
  source: "glove.roll",
  mode: "continuous_absolute",
  targetDevice: "desk_lamp",
  targetAction: "brightness",
  min: 0,
  max: 100,
  deadzone: 0.12,
  step: 5,
  invert: false,
  offset: 0,
  smoothing: 0.25,
};

export function mapBackendDeviceToDefinition(
  device: BackendManagedDevice,
  manager?: DeviceManagerInfo,
): DeviceDefinition {
  return {
    id: device.id,
    managerId: device.managerId,
    source: device.source,
    integrationType: manager?.integrationType ?? (device.source === "kasa" ? "native" : "external"),
    name: device.name,
    kind: mapDeviceKind(device),
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

function mapDeviceKind(device: BackendManagedDevice): DeviceKind {
  if (device.source === "kasa" && device.type === "light") return "kasa-bulb";
  if (device.source === "kasa" && device.type === "plug") return "kasa-plug";
  if (device.source === "simulator" && device.type === "light") return "sim-light";
  if (device.source === "simulator" && device.type === "fan") return "sim-fan";
  if (device.source === "simulator" && device.type === "thermostat") return "sim-thermostat";
  if (device.type === "scene") return "scene";
  return "other";
}
