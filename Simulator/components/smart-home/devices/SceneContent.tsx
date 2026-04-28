import { memo, useMemo } from "react"
import { OrbitControls } from "@react-three/drei"
import { Room } from "../Room"
import { CeilingLight } from "./CeilingLight"
import { DeskLamp } from "./DeskLamp"
import { AccentLight } from "./AccentLight"
import { SmartSwitch } from "./SmartSwitch"
import { SmartPlug } from "./SmartPlug"
import { Fan } from "./Fan"
import { TV } from "./TV"
import { Thermostat } from "./Thermostat"
import type { SmartHomeSceneProps } from "../types"

export const SceneContent = memo(function SceneContent(props: SmartHomeSceneProps) {
  const {
    ceilingLightOn,
    ceilingLightBrightness,
    deskLampOn,
    deskLampBrightness,
    accentLightColor,
    accentLightIntensity,
    switchOn,
    plugOn,
    fanOn,
    fanSpeed,
    tvOn,
    tvBrightness,
    thermostatOn,
    thermostatTemp,
    thermostatMode,
    passiveMode,
    productivityLevel,
    selectedDevice,
  } = props

  const ambientColor = useMemo(() => {
    if (!passiveMode) return "#222244"
    switch (productivityLevel) {
      case "high":
        return "#22ff88"
      case "medium":
        return "#ffcc22"
      case "low":
        return "#ff4444"
      default:
        return "#222244"
    }
  }, [passiveMode, productivityLevel])

  const ambientIntensity = passiveMode ? 0.3 : 0.1

  return (
    <>
      <hemisphereLight args={["#f7fbff", "#404052", 0.65]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 5]} intensity={0.65} castShadow />
      <pointLight position={[0, 3.2, 3.5]} intensity={0.45} distance={9} color="#d9e8ff" />

      <Room ambientColor={ambientColor} ambientIntensity={ambientIntensity} />

      <CeilingLight
        isOn={ceilingLightOn}
        brightness={ceilingLightBrightness}
        isSelected={selectedDevice === "ceilingLight"}
      />

      <DeskLamp
        isOn={deskLampOn}
        brightness={deskLampBrightness}
        isSelected={selectedDevice === "deskLamp"}
      />

      <AccentLight
        color={accentLightColor}
        intensity={accentLightIntensity}
        isSelected={selectedDevice === "accentLight"}
      />

      <SmartSwitch isOn={switchOn} isSelected={selectedDevice === "switch"} />

      <SmartPlug isOn={plugOn} isSelected={selectedDevice === "plug"} />

      <Fan isOn={fanOn} speed={fanSpeed} isSelected={selectedDevice === "fan"} />

      <TV isOn={tvOn} brightness={tvBrightness} isSelected={selectedDevice === "tv"} />

      <Thermostat
        isOn={thermostatOn}
        temp={thermostatTemp}
        mode={thermostatMode}
        isSelected={selectedDevice === "thermostat"}
      />

      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={3}
        maxDistance={15}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2 - 0.1}
        target={[0, 1.5, 0]}
      />
    </>
  )
})
