import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import type { SmartHomeSceneProps } from "../smart-home/types"

type Props = {
  fanOn: SmartHomeSceneProps["fanOn"]
  fanSpeed: SmartHomeSceneProps["fanSpeed"]
  onChange: <K extends keyof SmartHomeSceneProps>(key: K, value: SmartHomeSceneProps[K]) => void
}

export function FanControl({ fanOn, fanSpeed, onChange }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          Ceiling Fan
          <Switch
            checked={fanOn}
            onCheckedChange={(v) => onChange("fanOn", v)}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Speed</Label>
          <Slider
            value={[fanSpeed * 100]}
            onValueChange={([v]) => onChange("fanSpeed", v / 100)}
            max={100}
            step={1}
            disabled={!fanOn}
          />
        </div>
      </CardContent>
    </Card>
  )
}
