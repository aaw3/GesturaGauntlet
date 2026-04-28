import { memo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { SelectionRing } from "../SelectionRing"
import type { DeviceProps } from "../types"

export const AccentLight = memo(function AccentLight({
  color,
  intensity,
  isSelected,
}: DeviceProps & { color: string; intensity: number }) {
  const stripRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)

  useFrame(() => {
    if (stripRef.current) {
      const mat = stripRef.current.material as THREE.MeshStandardMaterial
      mat.emissive = new THREE.Color(color)
      mat.emissiveIntensity = intensity * 3.5
    }
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial
      mat.emissive = new THREE.Color(color)
      mat.emissiveIntensity = intensity * 2.5
      mat.opacity = 0.25 + intensity * 0.35
    }
  })

  return (
    <group position={[-4.9, 1, 0]}>
      {/* LED strip housing */}
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[4, 0.1, 0.05]} />
        <meshStandardMaterial color="#222233" />
      </mesh>

      {/* LED strip */}
      <mesh ref={stripRef} position={[0.03, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[3.8, 0.06, 0.02]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0}
          metalness={0.25}
          roughness={0.08}
        />
      </mesh>

      {/* Soft beam volume across the whole strip, not a center-point bulb. */}
      <mesh ref={glowRef} position={[0.12, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[3.9, 0.18, 0.08]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0}
          transparent
          opacity={0.35}
          roughness={0.05}
        />
      </mesh>

      {[-1.5, 0, 1.5].map((z) => (
        <pointLight
          key={z}
          position={[0.25, 0, z]}
          color={color}
          intensity={intensity * 1.25}
          distance={4.5}
          decay={1.6}
        />
      ))}

      <SelectionRing radius={0.5} visible={isSelected} />
    </group>
  )
})
