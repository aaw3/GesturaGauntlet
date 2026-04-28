"use client"

import React, { memo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { SelectionRing } from "../shared/SelectionRing"
import type { DeviceProps } from "../types"

export const AccentLight = memo(function AccentLight({
  color,
  intensity,
  isSelected,
}: DeviceProps & { color: string; intensity: number }) {
  const lightRef = useRef<THREE.PointLight>(null)

  useFrame(() => {
    if (lightRef.current) {
      lightRef.current.intensity = intensity * 2
      lightRef.current.color = new THREE.Color(color)
    }
  })

  return (
    <group position={[2, 0.5, -2]}>
      <mesh>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>

      <pointLight ref={lightRef} color={color} intensity={0} distance={8} />

      <SelectionRing radius={0.5} visible={isSelected} />
    </group>
  )
})
