import { memo, useEffect, useRef, useState } from "react"
import { useFrame } from "@react-three/fiber"
import { RoundedBox, Html } from "@react-three/drei"
import * as THREE from "three"
import { SelectionRing } from "../SelectionRing"
import type { DeviceProps } from "../types"

export const TV = memo(function TV({
  isOn,
  isSelected,
}: DeviceProps & { isOn: boolean }) {
  const screenRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.PointLight>(null)
  const currentBrightness = useRef(0)

  const [imgVersion, setImgVersion] = useState(0)
  const [imgLoaded, setImgLoaded] = useState(false)

  useEffect(() => {
    if (!isOn) {
      setImgLoaded(false)
      return
    }

    setImgLoaded(false)
    setImgVersion((version) => version + 1)
  }, [isOn])

  useFrame((state) => {
    const target = isOn ? 0.82 : 0
    currentBrightness.current += (target - currentBrightness.current) * 0.08

    if (screenRef.current) {
      const mat = screenRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity =
        currentBrightness.current * 1.5 +
        Math.sin(state.clock.elapsedTime * 1.6) * 0.04
    }

    if (glowRef.current) {
      glowRef.current.intensity = currentBrightness.current * 2.6
    }
  })

  return (
    <group position={[-1.1, 2.05, -5.035]} scale={[1.18, 1.18, 1]}>
      <pointLight
        ref={glowRef}
        position={[0, 0, 0.45]}
        color="#b03cff"
        intensity={0}
        distance={6.6}
      />

      <RoundedBox args={[4.0, 1.95, 0.08]} radius={0.025} castShadow>
        <meshStandardMaterial color="#080910" roughness={0.24} metalness={0.55} />
      </RoundedBox>

      <mesh ref={screenRef} position={[0, 0, 0.05]}>
        <planeGeometry args={[3.75, 1.72]} />
        <meshStandardMaterial
          color={isOn ? "#000000" : "#030306"}
          emissive="#000000"
          emissiveIntensity={0}
          roughness={0.16}
          transparent
          opacity={isOn ? 0.03 : 1}
        />

        {isOn && (
          <Html
            transform
            position={[0, 0, 0.12]}
            distanceFactor={4}
            style={{
              width: "375px",
              height: "172px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              userSelect: "none",
              overflow: "hidden",
              padding: 0,
              margin: 0,
              lineHeight: 0,
              background: "#000",
            }}
          >
            {!imgLoaded && (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background: "#000",
                }}
              />
            )}

            <img
              key={imgVersion}
              src={`/southpark.gif?v=${imgVersion}`}
              alt=""
              onLoad={() => setImgLoaded(true)}
              onError={() => {
                setImgLoaded(false)
                window.setTimeout(() => {
                  setImgVersion((version) => version + 1)
                }, 250)
              }}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "fill",
                display: imgLoaded ? "block" : "none",
              }}
            />
          </Html>
        )}
      </mesh>

      <group position={[0, -1.36, 0.42]}>
        <RoundedBox args={[4.55, 0.5, 0.62]} radius={0.035} castShadow receiveShadow>
          <meshStandardMaterial color="#3c241b" roughness={0.6} metalness={0.06} />
        </RoundedBox>
        <RoundedBox args={[1.25, 0.16, 0.16]} position={[0, 0.35, 0.03]} radius={0.04} castShadow>
          <meshStandardMaterial color="#101018" roughness={0.42} />
        </RoundedBox>
        <RoundedBox args={[0.45, 0.32, 0.44]} position={[1.55, 0.24, 0.05]} radius={0.04} castShadow>
          <meshStandardMaterial color="#161722" roughness={0.45} />
        </RoundedBox>
        <RoundedBox args={[0.42, 0.2, 0.34]} position={[-1.45, 0.32, 0.08]} radius={0.04} castShadow>
          <meshStandardMaterial color="#17222d" roughness={0.48} />
        </RoundedBox>
        <mesh position={[-1.9, 0.42, 0.05]}>
          <sphereGeometry args={[0.2, 32, 16]} />
          <meshStandardMaterial color="#fff0cc" emissive="#ffb86b" emissiveIntensity={0.9} roughness={0.35} />
        </mesh>
        <pointLight position={[-1.9, 0.52, 0.15]} color="#ffb56d" intensity={0.65} distance={2.5} />
        <mesh position={[0, -0.3, 0.05]}>
          <boxGeometry args={[4.05, 0.06, 0.06]} />
          <meshStandardMaterial color="#d42dce" emissive="#d42dce" emissiveIntensity={isOn ? 1.7 : 0.15} />
        </mesh>
        <pointLight position={[0, -0.28, 0.25]} color="#df34ff" intensity={isOn ? 1.0 : 0.1} distance={3.5} />
      </group>

      <SelectionRing radius={1.9} visible={isSelected} />
    </group>
  )
})