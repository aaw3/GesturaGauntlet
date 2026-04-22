import { DeviceCapability, ManagedDevice } from "../../types/device";
import { KasaDiscoveredDevice } from "./kasa-types";

export function mapKasaDeviceToManaged(
  managerId: string,
  source: KasaDiscoveredDevice,
): ManagedDevice {
  const capabilities: DeviceCapability[] = [
    {
      id: "power",
      label: "Power",
      kind: "toggle",
      readable: true,
      writable: true,
    },
  ];

  if (source.type === "light") {
    capabilities.push(
      {
        id: "brightness",
        label: "Brightness",
        kind: "range",
        readable: true,
        writable: true,
        range: { min: 0, max: 100, step: 1, unit: "%" },
      },
      {
        id: "hue",
        label: "Hue",
        kind: "range",
        readable: true,
        writable: true,
        range: { min: 0, max: 360, step: 1, unit: "deg" },
      },
      {
        id: "saturation",
        label: "Saturation",
        kind: "range",
        readable: true,
        writable: true,
        range: { min: 0, max: 100, step: 1, unit: "%" },
      },
    );
  }

  return {
    id: source.id,
    managerId,
    source: "kasa",
    type: source.type,
    name: source.alias,
    online: "online",
    capabilities,
    metadata: {
      host: source.host,
      mac: source.mac,
      model: source.model,
    },
  };
}
