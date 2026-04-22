import { ID } from "./common";

export type ActionCommandType = "set" | "delta" | "toggle" | "execute";

export interface DeviceActionRequest {
  deviceId: ID;
  capabilityId: string;
  commandType: ActionCommandType;
  value?: string | number | boolean;
  delta?: number;
  command?: string;
  params?: Record<string, unknown>;
}

export interface DeviceActionResult {
  ok: boolean;
  deviceId: ID;
  capabilityId: string;
  appliedValue?: string | number | boolean | null;
  message?: string;
}

export interface BulkActionRequest {
  actions: DeviceActionRequest[];
}

export interface BulkActionResult {
  ok: boolean;
  results: DeviceActionResult[];
}
