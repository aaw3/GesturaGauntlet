import { Button } from "@/components/ui/button"
import type { SmartHomeSceneProps } from "../smart-home/types"

type DeviceKey = NonNullable<SmartHomeSceneProps["selectedDevice"]>

const DEVICE_LABELS: Record<DeviceKey, string> = {
  ceilingLight: "Ceiling Light",
  deskLamp: "Desk Lamp",
  accentLight: "Accent Light",
  switch: "Smart Switch",
  plug: "Smart Plug",
  fan: "Fan",
  tv: "TV",
  thermostat: "Thermostat",
}

type Props = {
  selectedDevice: SmartHomeSceneProps["selectedDevice"]
  onSelect: (device: DeviceKey | null) => void
}

export function DeviceSelector({ selectedDevice, onSelect }: Props) {
  return (
    <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2 justify-center">
      {(Object.keys(DEVICE_LABELS) as DeviceKey[]).map((device) => (
        <Button
          key={device}
          variant={selectedDevice === device ? "default" : "secondary"}
          size="sm"
          onClick={() => onSelect(selectedDevice === device ? null : device)}
          className="text-xs"
        >
          {DEVICE_LABELS[device]}
        </Button>
      ))}
    </div>
  )
}
