"use client"

import React, { memo, useMemo } from "react"
import { OrbitControls } from "@react-three/drei"
import { Room } from "./room/Room"
import { SceneLights } from "./room/SceneLights"
import { CeilingLight } from "./devices/CeilingLight"
import { DeskLamp } from "./devices/DeskLamp"
import { AccentLight } from "./devices/AccentLight"
import { SmartSwitch } from "./devices/SmartSwitch"
import { SmartPlug } from "./devices/SmartPlug"
import { Fan } from "./devices/Fan"
import { TV } from "./devices/TV"
import { Thermostat } from "./devices/Thermostat"
import type { SmartHomeSceneProps } from "./types"

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
      <SceneLights />
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
        enablePan
        enableZoom
        enableRotate
        minDistance={3}
        maxDistance={15}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2 - 0.1}
        target={[0, 1.5, 0]}
      />
    </>
  )
})
