import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import type { SmartHomeSceneProps } from "../smart-home/types"

type Props = {
  accentLightColor: SmartHomeSceneProps["accentLightColor"]
  accentLightIntensity: SmartHomeSceneProps["accentLightIntensity"]
  onChange: <K extends keyof SmartHomeSceneProps>(key: K, value: SmartHomeSceneProps[K]) => void
}

export function AccentLightControl({ accentLightColor, accentLightIntensity, onChange }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Accent Light</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Color</Label>
          <input
            type="color"
            value={accentLightColor}
            onChange={(e) => onChange("accentLightColor", e.target.value)}
            className="w-full h-8 rounded border border-input cursor-pointer"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Intensity</Label>
          <Slider
            value={[accentLightIntensity * 100]}
            onValueChange={([v]) => onChange("accentLightIntensity", v / 100)}
            max={100}
            step={1}
          />
        </div>
      </CardContent>
    </Card>
  )
}
