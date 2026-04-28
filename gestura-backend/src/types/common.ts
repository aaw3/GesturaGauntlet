export type ID = string;
export type TimestampMs = number;

export type OnlineStatus = "online" | "offline" | "unknown";

export interface RangeSpec {
  min: number;
  max: number;
  step?: number;
  unit?: string;
}
