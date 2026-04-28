"use client"

import React, { memo } from "react"
import { SelectionRing } from "../shared/SelectionRing"
import type { DeviceProps } from "../types"

export const Thermostat = memo(function Thermostat({
  isOn,
  temp,
  mode,
  isSelected,
}: DeviceProps & {
  isOn: boolean
  temp: number
  mode: "cool" | "heat" | "off"
}) {
  const color =
    mode === "cool" ? "#00aaff" :
    mode === "heat" ? "#ff5500" :
    "#444455"

  return (
    <group position={[3, 2, -3]}>
      <mesh>
        <boxGeometry args={[0.6, 0.6, 0.1]} />
        <meshStandardMaterial color="#222233" />
      </mesh>

      <mesh position={[0, 0, 0.06]}>
        <planeGeometry args={[0.4, 0.4]} />
        <meshStandardMaterial
          color={isOn ? color : "#000"}
          emissive={isOn ? color : "#000"}
          emissiveIntensity={isOn ? 1 : 0}
        />
      </mesh>

      <SelectionRing radius={0.6} visible={isSelected} />
    </group>
  )
})
