import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import type { SmartHomeSceneProps } from "../smart-home/types"

type Props = {
  passiveMode: SmartHomeSceneProps["passiveMode"]
  productivityLevel: SmartHomeSceneProps["productivityLevel"]
  onChange: <K extends keyof SmartHomeSceneProps>(key: K, value: SmartHomeSceneProps[K]) => void
}

export function PassiveModeControl({ passiveMode, productivityLevel, onChange }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          Passive Mode
          <Switch
            checked={passiveMode}
            onCheckedChange={(v) => onChange("passiveMode", v)}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          {(["high", "medium", "low"] as const).map((level) => (
            <Button
              key={level}
              variant={productivityLevel === level ? "default" : "outline"}
              size="sm"
              onClick={() => onChange("productivityLevel", level)}
              disabled={!passiveMode}
              className={`flex-1 capitalize ${
                level === "high"
                  ? "data-[state=active]:bg-green-600"
                  : level === "medium"
                    ? "data-[state=active]:bg-yellow-600"
                    : "data-[state=active]:bg-red-600"
              }`}
            >
              {level}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
