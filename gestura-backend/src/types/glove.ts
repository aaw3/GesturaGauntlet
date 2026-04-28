import { ID, TimestampMs } from "./common";

export type GloveMode = "active" | "passive";

export type GloveEventType =
  | "top_double_tap"
  | "bottom_double_tap"
  | "bottom_tap"
  | "top_hold_start"
  | "top_hold_end"
  | "bottom_hold_start"
  | "bottom_hold_end"
  | "recalibrate_requested"
  | "mode_toggled";

export interface GloveEvent {
  gloveId: ID;
  ts: TimestampMs;
  type: GloveEventType;
  mode?: GloveMode;
}

export type GloveSignalName = "roll" | "pitch" | "pressure_top" | "pressure_bottom";

export interface GloveSignal {
  gloveId: ID;
  ts: TimestampMs;
  signal: GloveSignalName;
  raw?: number;
  relative?: number;
  normalized: number;
  deadzoneApplied?: boolean;
}

export interface GloveStatus {
  gloveId: ID;
  ts: TimestampMs;
  mode: GloveMode;
  batteryPct?: number;
  wifiRssi?: number;
}
