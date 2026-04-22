import { ID } from "./common";

export type InputSource =
  | "top_double_tap"
  | "bottom_double_tap"
  | "bottom_tap"
  | "top_hold_roll"
  | "bottom_hold_roll"
  | "glove.roll"
  | "glove.pitch";

export type MappingMode =
  | "toggle"
  | "continuous_absolute"
  | "continuous_delta"
  | "step"
  | "scene";

export interface InputTransform {
  deadzone?: number;
  invert?: boolean;
  offset?: number;
  scale?: number;
  min?: number;
  max?: number;
  step?: number;
  smoothing?: number;
}

export interface GloveMapping {
  id: ID;
  gloveId: ID;
  enabled: boolean;
  inputSource: InputSource;
  targetDeviceId: ID;
  targetCapabilityId: string;
  mode: MappingMode;
  transform?: InputTransform;
}
