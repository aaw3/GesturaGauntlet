import { ID, OnlineStatus, RangeSpec } from "./common";

export type CapabilityKind = "toggle" | "range" | "color" | "discrete" | "scene";

export interface BaseCapability {
  id: string;
  label: string;
  kind: CapabilityKind;
  readable?: boolean;
  writable?: boolean;
}

export interface ToggleCapability extends BaseCapability {
  kind: "toggle";
}

export interface RangeCapability extends BaseCapability {
  kind: "range";
  range: RangeSpec;
}

export interface ColorCapability extends BaseCapability {
  kind: "color";
  hue?: RangeSpec;
  saturation?: RangeSpec;
  brightness?: RangeSpec;
  colorTemp?: RangeSpec;
}

export interface DiscreteCapability extends BaseCapability {
  kind: "discrete";
  options: string[];
}

export interface SceneCapability extends BaseCapability {
  kind: "scene";
}

export type DeviceCapability =
  | ToggleCapability
  | RangeCapability
  | ColorCapability
  | DiscreteCapability
  | SceneCapability;

export interface ManagedDevice {
  id: ID;
  managerId: ID;
  source: "kasa" | "simulator" | "custom";
  type: "light" | "plug" | "fan" | "thermostat" | "scene" | "other";
  name: string;
  room?: string;
  online: OnlineStatus;
  capabilities: DeviceCapability[];
  metadata?: Record<string, unknown>;
}
