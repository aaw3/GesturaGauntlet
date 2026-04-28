import { memo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { RoundedBox } from "@react-three/drei"
import * as THREE from "three"
import { SelectionRing } from "../SelectionRing"
import type { DeviceProps } from "../types"

export const TV = memo(function TV({
  isOn,
  brightness,
  isSelected,
}: DeviceProps & { isOn: boolean; brightness: number }) {
  const screenRef = useRef<THREE.Mesh>(null)
  const currentBrightness = useRef(0)

  useFrame((state) => {
    const target = isOn ? brightness : 0
    currentBrightness.current += (target - currentBrightness.current) * 0.1

    if (screenRef.current) {
      const mat = screenRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = currentBrightness.current * 1.5

      // Subtle screen flicker when on
      if (isOn) {
        mat.emissiveIntensity += Math.sin(state.clock.elapsedTime * 10) * 0.05
      }
    }
  })

  return (
    <group position={[-2, 1.5, -4.9]}>
      {/* TV frame */}
      <RoundedBox args={[2.2, 1.3, 0.08]} radius={0.02}>
        <meshStandardMaterial color="#111122" roughness={0.3} metalness={0.5} />
      </RoundedBox>

      {/* Screen */}
      <mesh ref={screenRef} position={[0, 0, 0.045]}>
        <planeGeometry args={[2, 1.1]} />
        <meshStandardMaterial
          color={isOn ? "#1a1a3a" : "#050510"}
          emissive={isOn ? "#4466ff" : "#000000"}
          emissiveIntensity={0}
        />
      </mesh>

      {/* Stand */}
      <mesh position={[0, -0.8, 0.1]}>
        <boxGeometry args={[0.6, 0.05, 0.2]} />
        <meshStandardMaterial color="#222233" metalness={0.6} />
      </mesh>

      {/* Screen light when on */}
      {isOn && (
        <pointLight
          position={[0, 0, 0.5]}
          color="#4466ff"
          intensity={brightness * 0.5}
          distance={3}
        />
      )}

      <SelectionRing radius={1.3} visible={isSelected} />
    </group>
  )
})
