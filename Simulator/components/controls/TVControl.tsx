import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import type { SmartHomeSceneProps } from "../smart-home/types"

type Props = {
  tvOn: SmartHomeSceneProps["tvOn"]
  tvBrightness: SmartHomeSceneProps["tvBrightness"]
  onChange: <K extends keyof SmartHomeSceneProps>(key: K, value: SmartHomeSceneProps[K]) => void
}

export function TVControl({ tvOn, tvBrightness, onChange }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          TV
          <Switch
            checked={tvOn}
            onCheckedChange={(v) => onChange("tvOn", v)}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Brightness</Label>
          <Slider
            value={[tvBrightness * 100]}
            onValueChange={([v]) => onChange("tvBrightness", v / 100)}
            max={100}
            step={1}
            disabled={!tvOn}
          />
        </div>
      </CardContent>
    </Card>
  )
}
