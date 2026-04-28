"use client"

import React, { memo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { SelectionRing } from "../shared/SelectionRing"
import type { DeviceProps } from "../types"

export const DeskLamp = memo(function DeskLamp({
  isOn,
  brightness,
  isSelected,
}: DeviceProps & { isOn: boolean; brightness: number }) {
  const lightRef = useRef<THREE.PointLight>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const current = useRef(0)

  useFrame(() => {
    const target = isOn ? brightness : 0
    current.current += (target - current.current) * 0.1

    if (lightRef.current) {
      lightRef.current.intensity = current.current * 2
    }

    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = current.current * 2
    }
  })

  return (
    <group position={[-2, 1, 1]}>
      {/* Base */}
      <mesh>
        <cylinderGeometry args={[0.2, 0.25, 0.1, 16]} />
        <meshStandardMaterial color="#2a2a3a" />
      </mesh>

      {/* Arm */}
      <mesh position={[0, 0.4, 0]} rotation={[0, 0, Math.PI / 6]}>
        <boxGeometry args={[0.05, 0.8, 0.05]} />
        <meshStandardMaterial color="#444455" />
      </mesh>

      {/* Head */}
      <mesh position={[0.25, 0.9, 0]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color="#333344" />
      </mesh>

      {/* Glow */}
      <mesh ref={glowRef} position={[0.25, 0.9, 0]}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial emissive="#ffeecc" emissiveIntensity={0} />
      </mesh>

      <pointLight
        ref={lightRef}
        position={[0.25, 0.9, 0]}
        intensity={0}
        distance={6}
      />

      <SelectionRing radius={0.6} visible={isSelected} />
    </group>
  )
})
