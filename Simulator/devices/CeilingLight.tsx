"use client"

import React, { memo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { SelectionRing } from "../shared/SelectionRing"
import type { DeviceProps } from "../types"

export const CeilingLight = memo(function CeilingLight({
  isOn,
  brightness,
  isSelected,
}: DeviceProps & { isOn: boolean; brightness: number }) {
  const lightRef = useRef<THREE.PointLight>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const currentBrightness = useRef(0)

  useFrame(() => {
    const target = isOn ? brightness : 0
    currentBrightness.current += (target - currentBrightness.current) * 0.1

    if (lightRef.current) {
      lightRef.current.intensity = currentBrightness.current * 3
    }

    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = currentBrightness.current * 2
    }
  })

  return (
    <group position={[0, 4.8, 0]}>
      <mesh>
        <cylinderGeometry args={[0.3, 0.4, 0.15, 16]} />
        <meshStandardMaterial color="#333344" metalness={0.8} roughness={0.2} />
      </mesh>

      <mesh ref={glowRef} position={[0, -0.2, 0]}>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffeecc"
          emissiveIntensity={0}
          transparent
          opacity={0.9}
        />
      </mesh>

      <pointLight
        ref={lightRef}
        position={[0, -0.3, 0]}
        color="#ffeecc"
        intensity={0}
        distance={10}
        castShadow
      />

      <SelectionRing radius={0.6} visible={isSelected} />
    </group>
  )
})
