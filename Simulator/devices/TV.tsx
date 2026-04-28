"use client"

import React, { memo } from "react"
import { SelectionRing } from "../shared/SelectionRing"
import type { DeviceProps } from "../types"

export const TV = memo(function TV({
  isOn,
  brightness,
  isSelected,
}: DeviceProps & { isOn: boolean; brightness: number }) {
  return (
    <group position={[0, 1.5, -4]}>
      <mesh>
        <boxGeometry args={[2, 1.2, 0.1]} />
        <meshStandardMaterial color="#111" />
      </mesh>

      <mesh position={[0, 0, 0.06]}>
        <planeGeometry args={[1.8, 1]} />
        <meshStandardMaterial
          color={isOn ? "#ffffff" : "#000000"}
          emissive={isOn ? "#ffffff" : "#000000"}
          emissiveIntensity={isOn ? brightness : 0}
        />
      </mesh>

      <SelectionRing radius={1.2} visible={isSelected} />
    </group>
  )
})
