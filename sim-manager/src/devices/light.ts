import { DeviceStateSnapshot, SimDevice } from "../types";

export function createLight(managerId: string): SimDevice {
  return {
    id: "sim-light-1",
    managerId,
    source: "simulator",
    type: "light",
    name: "Sim Desk Lamp",
    online: "online",
    capabilities: [
      { id: "power", label: "Power", kind: "toggle" },
      {
        id: "brightness",
        label: "Brightness",
        kind: "range",
        range: { min: 0, max: 100, step: 1, unit: "%" },
      },
      {
        id: "hue",
        label: "Hue",
        kind: "range",
        range: { min: 0, max: 360, step: 1, unit: "deg" },
      },
      {
        id: "saturation",
        label: "Saturation",
        kind: "range",
        range: { min: 0, max: 100, step: 1, unit: "%" },
      },
    ],
  };
}

export function createLightState(deviceId: string): DeviceStateSnapshot {
  return {
    deviceId,
    ts: Date.now(),
    values: {
      power: true,
      brightness: 70,
      hue: 45,
      saturation: 80,
    },
  };
}
