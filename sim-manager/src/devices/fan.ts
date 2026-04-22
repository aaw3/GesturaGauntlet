import { DeviceStateSnapshot, SimDevice } from "../types";

export function createFan(managerId: string): SimDevice {
  return {
    id: "sim-fan-1",
    managerId,
    source: "simulator",
    type: "fan",
    name: "Sim Desk Fan",
    online: "online",
    capabilities: [
      { id: "power", label: "Power", kind: "toggle" },
      {
        id: "speed",
        label: "Speed",
        kind: "range",
        range: { min: 0, max: 3, step: 1 },
      },
    ],
  };
}

export function createFanState(deviceId: string): DeviceStateSnapshot {
  return {
    deviceId,
    ts: Date.now(),
    values: {
      power: false,
      speed: 0,
    },
  };
}
