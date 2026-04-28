"use client"

import React, { memo } from "react"
import { SelectionRing } from "../shared/SelectionRing"
import type { DeviceProps } from "../types"

export const SmartSwitch = memo(function SmartSwitch({
  isOn,
  isSelected,
}: DeviceProps & { isOn: boolean }) {
  return (
    <group position={[-3, 1.5, -4]}>
      <mesh>
        <boxGeometry args={[0.6, 0.8, 0.1]} />
        <meshStandardMaterial color="#222233" />
      </mesh>

      <mesh position={[0, isOn ? 0.1 : -0.1, 0.06]}>
        <boxGeometry args={[0.2, 0.4, 0.05]} />
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
