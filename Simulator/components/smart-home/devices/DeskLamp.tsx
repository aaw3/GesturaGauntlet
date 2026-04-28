import { memo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { RoundedBox } from "@react-three/drei"
import * as THREE from "three"
import { SelectionRing } from "../SelectionRing"
import type { DeviceProps } from "../types"

export const DeskLamp = memo(function DeskLamp({
  isOn,
  brightness,
  isSelected,
}: DeviceProps & { isOn: boolean; brightness: number }) {
  const lightRef = useRef<THREE.SpotLight>(null)
  const bulbRef = useRef<THREE.Mesh>(null)
  const currentBrightness = useRef(0)

  useFrame(() => {
    const target = isOn ? brightness : 0
    currentBrightness.current += (target - currentBrightness.current) * 0.1

    if (lightRef.current) {
      lightRef.current.intensity = currentBrightness.current * 5
    }
    if (bulbRef.current) {
      const mat = bulbRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = currentBrightness.current * 1.5
    }
  })

  return (
    <group position={[3, 0, -3]}>
      {/* Desk */}
      <RoundedBox args={[2, 0.1, 1]} position={[0, 0.8, 0]} radius={0.02}>
        <meshStandardMaterial color="#2a2a3a" roughness={0.5} />
      </RoundedBox>

      {/* Desk legs */}
      {[
        [-0.9, 0.4, -0.4],
        [0.9, 0.4, -0.4],
        [-0.9, 0.4, 0.4],
        [0.9, 0.4, 0.4],
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]}>
          <cylinderGeometry args={[0.03, 0.03, 0.8, 8]} />
          <meshStandardMaterial color="#1a1a2a" />
        </mesh>
      ))}

      {/* Lamp base */}
      <mesh position={[0.5, 0.9, 0]}>
        <cylinderGeometry args={[0.12, 0.15, 0.05, 16]} />
        <meshStandardMaterial color="#333344" metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Lamp arm */}
      <mesh position={[0.5, 1.15, 0]} rotation={[0, 0, 0.2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.5, 8]} />
        <meshStandardMaterial color="#444455" metalness={0.6} />
      </mesh>

      {/* Lamp head */}
      <mesh position={[0.6, 1.35, 0]} rotation={[0.3, 0, 0.2]}>
        <coneGeometry args={[0.15, 0.2, 16, 1, true]} />
        <meshStandardMaterial color="#333344" metalness={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* Bulb */}
      <mesh ref={bulbRef} position={[0.6, 1.3, 0]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffddaa" emissiveIntensity={0} />
      </mesh>

      {/* Spotlight */}
      <spotLight
        ref={lightRef}
        position={[0.6, 1.3, 0]}
        angle={0.5}
        penumbra={0.5}
        color="#ffddaa"
        intensity={0}
        distance={3}
        target-position={[0.6, 0.85, 0]}
        castShadow
      />

      <SelectionRing radius={1.2} visible={isSelected} />
    </group>
  )
})
