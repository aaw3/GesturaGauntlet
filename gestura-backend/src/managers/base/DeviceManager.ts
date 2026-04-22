import {
  DeviceManagerInfo,
  DeviceStateSnapshot,
  ManagerSyncResult,
} from "../../types/manager";
import { ManagedDevice } from "../../types/device";
import {
  DeviceActionRequest,
  DeviceActionResult,
  BulkActionRequest,
  BulkActionResult,
} from "../../types/api";

export interface DeviceManager {
  getInfo(): Promise<DeviceManagerInfo>;

  listDevices(): Promise<ManagedDevice[]>;

  getDevice(deviceId: string): Promise<ManagedDevice | null>;

  getDeviceState(deviceId: string): Promise<DeviceStateSnapshot | null>;

  executeAction(action: DeviceActionRequest): Promise<DeviceActionResult>;

  executeBulkActions?(request: BulkActionRequest): Promise<BulkActionResult>;

  discover?(): Promise<ManagerSyncResult>;

  shutdown?(): Promise<void>;
}
