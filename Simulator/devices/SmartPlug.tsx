"use client"

import React, { memo } from "react"
import { SelectionRing } from "../shared/SelectionRing"
import type { DeviceProps } from "../types"

export const SmartPlug = memo(function SmartPlug({
  isOn,
  isSelected,
}: DeviceProps & { isOn: boolean }) {
  return (
    <group position={[3, 0.5, -4]}>
      <mesh>
        <boxGeometry args={[0.5, 0.6, 0.2]} />
        <meshStandardMaterial color="#2a2a3a" />
      </mesh>

      <mesh position={[0, -0.1, 0.11]}>
        <boxGeometry args={[0.2, 0.2, 0.05]} />
        <meshStandardMaterial
          color={isOn ? "#00ff88" : "#444455"}
          emissive={isOn ? "#00ff88" : "#000"}
          emissiveIntensity={isOn ? 0.8 : 0}
        />
      </mesh>

      <SelectionRing radius={0.5} visible={isSelected} />
    </group>
  )
})
