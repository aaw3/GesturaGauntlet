import { CeilingLightControl } from "./CeilingLightControl"
import { DeskLampControl } from "./DeskLampControl"
import { AccentLightControl } from "./AccentLightControl"
import { OutletsControl } from "./OutletsControl"
import { FanControl } from "./FanControl"
import { TVControl } from "./TVControl"
import { ThermostatControl } from "./ThermostatControl"
import { PassiveModeControl } from "./PassiveModeControl"
import type { SmartHomeSceneProps } from "../smart-home/types"

type Props = {
  state: SmartHomeSceneProps
  onChange: <K extends keyof SmartHomeSceneProps>(key: K, value: SmartHomeSceneProps[K]) => void
}

export function ControlPanel({ state, onChange }: Props) {
  return (
    <div className="w-80 border-l border-border bg-card overflow-y-auto p-4 space-y-4">
      <h1 className="text-xl font-bold text-foreground">Smart Home Controls</h1>

      <CeilingLightControl
        ceilingLightOn={state.ceilingLightOn}
        ceilingLightBrightness={state.ceilingLightBrightness}
        onChange={onChange}
      />

      <DeskLampControl
        deskLampOn={state.deskLampOn}
        deskLampBrightness={state.deskLampBrightness}
        onChange={onChange}
      />

      <AccentLightControl
        accentLightColor={state.accentLightColor}
        accentLightIntensity={state.accentLightIntensity}
        onChange={onChange}
      />

      <OutletsControl
        switchOn={state.switchOn}
        plugOn={state.plugOn}
        onChange={onChange}
      />

      <FanControl
        fanOn={state.fanOn}
        fanSpeed={state.fanSpeed}
        onChange={onChange}
      />

      <TVControl
        tvOn={state.tvOn}
        tvBrightness={state.tvBrightness}
        onChange={onChange}
      />

      <ThermostatControl
        thermostatOn={state.thermostatOn}
        thermostatTemp={state.thermostatTemp}
        thermostatMode={state.thermostatMode}
        onChange={onChange}
      />

      <PassiveModeControl
        passiveMode={state.passiveMode}
        productivityLevel={state.productivityLevel}
        onChange={onChange}
      />
    </div>
  )
}
