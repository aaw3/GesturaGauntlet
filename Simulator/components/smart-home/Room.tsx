import { memo, useMemo } from "react"
import * as THREE from "three"

export const Room = memo(function Room({
  ambientColor,
  ambientIntensity,
}: {
  ambientColor: string
  ambientIntensity: number
}) {
  const wallMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#34384a",
        roughness: 0.72,
        metalness: 0.1,
      }),
    []
  )

  const floorMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#242638",
        roughness: 0.58,
        metalness: 0.2,
      }),
    []
  )

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <primitive object={floorMaterial} attach="material" />
      </mesh>

      {/* Back Wall */}
      <mesh position={[0, 2.5, -5]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <primitive object={wallMaterial} attach="material" />
      </mesh>

      {/* Left Wall */}
      <mesh position={[-5, 2.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <primitive object={wallMaterial} attach="material" />
      </mesh>

      {/* Right Wall */}
      <mesh position={[5, 2.5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <primitive object={wallMaterial} attach="material" />
      </mesh>

      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 5, 0]}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#303448" roughness={0.75} />
      </mesh>

      {/* Ambient glow based on productivity */}
      <pointLight
        position={[0, 0.1, 0]}
        color={ambientColor}
        intensity={ambientIntensity * 0.85}
        distance={15}
      />
    </group>
  )
})
