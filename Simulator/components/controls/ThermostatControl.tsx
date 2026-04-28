import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import type { SmartHomeSceneProps } from "../smart-home/types"

type Props = {
  thermostatOn: SmartHomeSceneProps["thermostatOn"]
  thermostatTemp: SmartHomeSceneProps["thermostatTemp"]
  thermostatMode: SmartHomeSceneProps["thermostatMode"]
  onChange: <K extends keyof SmartHomeSceneProps>(key: K, value: SmartHomeSceneProps[K]) => void
}

export function ThermostatControl({ thermostatOn, thermostatTemp, thermostatMode, onChange }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          Thermostat
          <Switch
            checked={thermostatOn}
            onCheckedChange={(v) => onChange("thermostatOn", v)}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Temperature: {thermostatTemp}°F
          </Label>
          <Slider
            value={[thermostatTemp]}
            onValueChange={([v]) => onChange("thermostatTemp", v)}
            min={60}
            max={85}
            step={1}
            disabled={!thermostatOn}
          />
        </div>
        <div className="flex gap-2">
          {(["cool", "heat", "off"] as const).map((mode) => (
            <Button
              key={mode}
              variant={thermostatMode === mode ? "default" : "outline"}
              size="sm"
              onClick={() => onChange("thermostatMode", mode)}
              disabled={!thermostatOn}
              className="flex-1 capitalize"
            >
              {mode}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
