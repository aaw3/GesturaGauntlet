import { DeviceStateSnapshot, SimDevice } from "../types";

export function createThermostat(managerId: string): SimDevice {
  return {
    id: "sim-thermostat-1",
    managerId,
    source: "simulator",
    type: "thermostat",
    name: "Sim Thermostat",
    online: "online",
    capabilities: [
      {
        id: "temperature",
        label: "Temperature",
        kind: "range",
        range: { min: 60, max: 85, step: 1, unit: "F" },
      },
    ],
  };
}

export function createThermostatState(deviceId: string): DeviceStateSnapshot {
  return {
    deviceId,
    ts: Date.now(),
    values: {
      temperature: 72,
    },
  };
}
