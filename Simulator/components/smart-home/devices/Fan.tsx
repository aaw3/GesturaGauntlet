import { memo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { SelectionRing } from "../SelectionRing"
import type { DeviceProps } from "../types"

export const Fan = memo(function Fan({
  isOn,
  speed,
  isSelected,
}: DeviceProps & { isOn: boolean; speed: number }) {
  const bladesRef = useRef<THREE.Group>(null)
  const currentSpeed = useRef(0)

  useFrame((_, delta) => {
    const targetSpeed = isOn ? speed : 0
    currentSpeed.current += (targetSpeed - currentSpeed.current) * 0.05

    if (bladesRef.current) {
      bladesRef.current.rotation.y += currentSpeed.current * delta * 15
    }
  })

  return (
    <group position={[0, 4.5, 2]}>
      {/* Mount */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.2, 16]} />
        <meshStandardMaterial color="#333344" metalness={0.7} />
      </mesh>

      {/* Rod */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.4, 8]} />
        <meshStandardMaterial color="#444455" metalness={0.6} />
      </mesh>

      {/* Motor housing */}
      <mesh position={[0, -0.25, 0]}>
        <cylinderGeometry args={[0.15, 0.12, 0.15, 16]} />
        <meshStandardMaterial color="#2a2a3a" metalness={0.5} roughness={0.3} />
      </mesh>

      {/* Blades group */}
      <group ref={bladesRef} position={[0, -0.35, 0]}>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh
            key={i}
            position={[Math.cos((i * Math.PI * 2) / 5) * 0.4, 0, Math.sin((i * Math.PI * 2) / 5) * 0.4]}
            rotation={[0.1, (i * Math.PI * 2) / 5, 0]}
          >
            <boxGeometry args={[0.5, 0.02, 0.1]} />
            <meshStandardMaterial color="#3a3a4a" roughness={0.4} />
          </mesh>
        ))}
      </group>

      {/* Status light */}
      <mesh position={[0, -0.18, 0.13]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial
          color={isOn ? "#00ff88" : "#444455"}
          emissive={isOn ? "#00ff88" : "#000000"}
          emissiveIntensity={isOn ? 0.8 : 0}
        />
      </mesh>

      <SelectionRing radius={0.8} visible={isSelected} />
    </group>
  )
})
