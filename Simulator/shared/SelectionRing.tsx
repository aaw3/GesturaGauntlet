"use client"

import React, { memo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

export const SelectionRing = memo(function SelectionRing({
  radius = 0.5,
  visible,
}: {
  radius?: number
  visible: boolean
}) {
  const ringRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (ringRef.current && visible) {
      ringRef.current.rotation.z = state.clock.elapsedTime * 2
    }
  })

  if (!visible) return null

  return (
    <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
      <ringGeometry args={[radius * 0.9, radius * 1.1, 32]} />
      <meshBasicMaterial color="#00ffff" transparent opacity={0.8} side={THREE.DoubleSide} />
    </mesh>
  )
})