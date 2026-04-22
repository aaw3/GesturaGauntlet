import {
  DeviceActionRequest,
  DeviceActionResult,
  DeviceStateSnapshot,
  SimDevice,
} from "../types";
import { createFan, createFanState } from "../devices/fan";
import { createLight, createLightState } from "../devices/light";
import { createThermostat, createThermostatState } from "../devices/thermostat";

export class DeviceStore {
  private devices = new Map<string, SimDevice>();
  private states = new Map<string, DeviceStateSnapshot>();

  constructor(private managerId: string) {
    const seeded = [
      [createLight(managerId), createLightState("sim-light-1")],
      [createFan(managerId), createFanState("sim-fan-1")],
      [createThermostat(managerId), createThermostatState("sim-thermostat-1")],
    ] as const;

    for (const [device, state] of seeded) {
      this.devices.set(device.id, device);
      this.states.set(device.id, state);
    }
  }

  listDevices(): SimDevice[] {
    return Array.from(this.devices.values());
  }

  getDevice(deviceId: string): SimDevice | undefined {
    return this.devices.get(deviceId);
  }

  getState(deviceId: string): DeviceStateSnapshot | undefined {
    const state = this.states.get(deviceId);
    return state ? { ...state, ts: Date.now() } : undefined;
  }

  applyAction(action: DeviceActionRequest): DeviceActionResult {
    const device = this.devices.get(action.deviceId);
    const state = this.states.get(action.deviceId);
    if (!device || !state) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: "Device not found",
      };
    }

    const capability = device.capabilities.find(
      (candidate) => candidate.id === action.capabilityId,
    );
    if (!capability) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: "Capability not found",
      };
    }

    const currentValue = state.values[action.capabilityId];
    let nextValue: string | number | boolean | null = currentValue;

    if (action.commandType === "toggle") {
      nextValue = typeof currentValue === "boolean" ? !currentValue : true;
    } else if (action.commandType === "delta") {
      nextValue = clampRange(
        Number(currentValue ?? 0) + Number(action.delta ?? 0),
        capability.range?.min,
        capability.range?.max,
      );
    } else if (action.commandType === "set") {
      nextValue =
        typeof action.value === "number"
          ? clampRange(action.value, capability.range?.min, capability.range?.max)
          : action.value ?? null;
    }

    state.values[action.capabilityId] = nextValue;
    state.ts = Date.now();

    return {
      ok: true,
      deviceId: action.deviceId,
      capabilityId: action.capabilityId,
      appliedValue: nextValue,
    };
  }
}

function clampRange(value: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  return Math.max(min, Math.min(max, value));
}
