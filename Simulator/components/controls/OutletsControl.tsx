import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import type { SmartHomeSceneProps } from "../smart-home/types"

type Props = {
  switchOn: SmartHomeSceneProps["switchOn"]
  plugOn: SmartHomeSceneProps["plugOn"]
  onChange: <K extends keyof SmartHomeSceneProps>(key: K, value: SmartHomeSceneProps[K]) => void
}

export function OutletsControl({ switchOn, plugOn, onChange }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Outlets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Smart Switch</Label>
          <Switch
            checked={switchOn}
            onCheckedChange={(v) => onChange("switchOn", v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-sm">Smart Plug</Label>
          <Switch
            checked={plugOn}
            onCheckedChange={(v) => onChange("plugOn", v)}
          />
        </div>
      </CardContent>
    </Card>
  )
}
