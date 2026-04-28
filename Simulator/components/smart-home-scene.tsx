"use client"

import React, { useRef, useMemo, memo, Suspense } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, Text, RoundedBox } from "@react-three/drei"
import * as THREE from "three"

// ============================================================================
// TYPES
// ============================================================================

export type SmartHomeSceneProps = {
  ceilingLightOn: boolean
  ceilingLightBrightness: number // 0 to 1
  deskLampOn: boolean
  deskLampBrightness: number // 0 to 1
  accentLightColor: string // CSS or hex color
  accentLightIntensity: number // 0 to 1

  switchOn: boolean
  plugOn: boolean

  fanOn: boolean
  fanSpeed: number // 0 to 1

  tvOn: boolean
  tvBrightness: number // 0 to 1

  thermostatOn: boolean
  thermostatTemp: number
  thermostatMode: "cool" | "heat" | "off"

  passiveMode: boolean
  productivityLevel: "high" | "medium" | "low"

  selectedDevice?:
    | "ceilingLight"
    | "deskLamp"
    | "accentLight"
    | "switch"
    | "plug"
    | "fan"
    | "tv"
    | "thermostat"
    | null
}

type DeviceProps = {
  isSelected: boolean
}

// ============================================================================
// UTILITY HOOKS & COMPONENTS
// ============================================================================

// Selection ring that highlights the selected device
const SelectionRing = memo(function SelectionRing({
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

// ============================================================================
// ROOM COMPONENTS
// ============================================================================

const Room = memo(function Room({
  ambientColor,
  ambientIntensity,
}: {
  ambientColor: string
  ambientIntensity: number
}) {
  const wallMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#1a1a2e",
        roughness: 0.8,
        metalness: 0.1,
      }),
    []
  )

  const floorMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#0f0f1a",
        roughness: 0.6,
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
        <meshStandardMaterial color="#16162a" />
      </mesh>

      {/* Ambient glow based on productivity */}
      <pointLight
        position={[0, 0.1, 0]}
        color={ambientColor}
        intensity={ambientIntensity * 0.5}
        distance={15}
      />
    </group>
  )
})

// ============================================================================
// DEVICE COMPONENTS
// ============================================================================

const CeilingLight = memo(function CeilingLight({
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
      {/* Fixture base */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.4, 0.15, 16]} />
        <meshStandardMaterial color="#333344" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Light bulb */}
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

      {/* Actual light source */}
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

const DeskLamp = memo(function DeskLamp({
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

const AccentLight = memo(function AccentLight({
  color,
  intensity,
  isSelected,
}: DeviceProps & { color: string; intensity: number }) {
  const lightRef = useRef<THREE.PointLight>(null)
  const stripRef = useRef<THREE.Mesh>(null)

  useFrame(() => {
    if (lightRef.current) {
      lightRef.current.intensity = intensity * 2
    }
    if (stripRef.current) {
      const mat = stripRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = intensity * 2
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
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0} />
      </mesh>

      <pointLight ref={lightRef} position={[0.1, 0, 0]} color={color} intensity={0} distance={5} />

      <SelectionRing radius={0.5} visible={isSelected} />
    </group>
  )
})

const SmartSwitch = memo(function SmartSwitch({
  isOn,
  isSelected,
}: DeviceProps & { isOn: boolean }) {
  return (
    <group position={[-4.9, 1.5, -2]}>
      {/* Switch plate */}
      <RoundedBox args={[0.05, 0.15, 0.1]} radius={0.01} position={[0, 0, 0]}>
        <meshStandardMaterial color="#2a2a3a" roughness={0.4} metalness={0.3} />
      </RoundedBox>

      {/* Toggle button */}
      <mesh position={[0.03, isOn ? 0.02 : -0.02, 0]}>
        <boxGeometry args={[0.02, 0.04, 0.06]} />
        <meshStandardMaterial
          color={isOn ? "#00ff88" : "#444455"}
          emissive={isOn ? "#00ff88" : "#000000"}
          emissiveIntensity={isOn ? 0.5 : 0}
        />
      </mesh>

      {/* Status LED */}
      <mesh position={[0.03, 0.05, 0]}>
        <sphereGeometry args={[0.008, 8, 8]} />
        <meshStandardMaterial
          color={isOn ? "#00ff88" : "#ff3333"}
          emissive={isOn ? "#00ff88" : "#ff3333"}
          emissiveIntensity={0.8}
        />
      </mesh>

      <SelectionRing radius={0.15} visible={isSelected} />
    </group>
  )
})

const SmartPlug = memo(function SmartPlug({
  isOn,
  isSelected,
}: DeviceProps & { isOn: boolean }) {
  return (
    <group position={[-4.9, 0.5, 2]}>
      {/* Outlet plate */}
      <RoundedBox args={[0.05, 0.12, 0.08]} radius={0.01}>
        <meshStandardMaterial color="#2a2a3a" roughness={0.4} />
      </RoundedBox>

      {/* Outlet holes */}
      {[0.02, -0.02].map((y, i) => (
        <mesh key={i} position={[0.026, y, 0]}>
          <boxGeometry args={[0.01, 0.015, 0.005]} />
          <meshStandardMaterial color="#111122" />
        </mesh>
      ))}

      {/* Smart plug body */}
      <RoundedBox args={[0.08, 0.1, 0.06]} position={[0.06, 0, 0]} radius={0.01}>
        <meshStandardMaterial color="#1a1a2a" roughness={0.3} />
      </RoundedBox>

      {/* Status ring */}
      <mesh position={[0.1, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.025, 0.005, 8, 16]} />
        <meshStandardMaterial
          color={isOn ? "#00ff88" : "#ff3333"}
          emissive={isOn ? "#00ff88" : "#ff3333"}
          emissiveIntensity={0.8}
        />
      </mesh>

      <SelectionRing radius={0.15} visible={isSelected} />
    </group>
  )
})

const Fan = memo(function Fan({
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

const TV = memo(function TV({
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

const Thermostat = memo(function Thermostat({
  isOn,
  temp,
  mode,
  isSelected,
}: DeviceProps & {
  isOn: boolean
  temp: number
  mode: "cool" | "heat" | "off"
}) {
  const modeColor = useMemo(() => {
    if (!isOn || mode === "off") return "#444455"
    return mode === "cool" ? "#4488ff" : "#ff6644"
  }, [isOn, mode])

  const displayColor = useMemo(() => {
    if (!isOn) return "#222233"
    return mode === "cool" ? "#88ccff" : mode === "heat" ? "#ffaa88" : "#88ff88"
  }, [isOn, mode])

  return (
    <group position={[4.9, 1.8, -2]} rotation={[0, -Math.PI / 2, 0]}>
      {/* Body */}
      <mesh>
        <cylinderGeometry args={[0.2, 0.2, 0.05, 32]} />
        <meshStandardMaterial color="#1a1a2a" roughness={0.3} metalness={0.4} />
      </mesh>

      {/* Display ring */}
      <mesh position={[0, 0.026, 0]}>
        <torusGeometry args={[0.15, 0.02, 8, 32]} />
        <meshStandardMaterial
          color={modeColor}
          emissive={modeColor}
          emissiveIntensity={isOn ? 0.5 : 0}
        />
      </mesh>

      {/* Display screen */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.12, 32]} />
        <meshStandardMaterial
          color="#0a0a15"
          emissive={displayColor}
          emissiveIntensity={isOn ? 0.3 : 0}
        />
      </mesh>

      {/* Temperature text */}
      {isOn && (
        <Text
          position={[0, 0.035, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.06}
          color={displayColor}
          anchorX="center"
          anchorY="middle"
        >
          {`${Math.round(temp)}°`}
        </Text>
      )}

      {/* Mode indicator */}
      {isOn && mode !== "off" && (
        <Text
          position={[0, 0.035, 0.06]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.025}
          color={modeColor}
          anchorX="center"
          anchorY="middle"
        >
          {mode.toUpperCase()}
        </Text>
      )}

      <SelectionRing radius={0.3} visible={isSelected} />
    </group>
  )
})

// ============================================================================
// MAIN SCENE COMPONENT
// ============================================================================

const SceneContent = memo(function SceneContent(props: SmartHomeSceneProps) {
  const {
    ceilingLightOn,
    ceilingLightBrightness,
    deskLampOn,
    deskLampBrightness,
    accentLightColor,
    accentLightIntensity,
    switchOn,
    plugOn,
    fanOn,
    fanSpeed,
    tvOn,
    tvBrightness,
    thermostatOn,
    thermostatTemp,
    thermostatMode,
    passiveMode,
    productivityLevel,
    selectedDevice,
  } = props

  // Determine ambient color based on productivity level
  const ambientColor = useMemo(() => {
    if (!passiveMode) return "#222244"
    switch (productivityLevel) {
      case "high":
        return "#22ff88"
      case "medium":
        return "#ffcc22"
      case "low":
        return "#ff4444"
      default:
        return "#222244"
    }
  }, [passiveMode, productivityLevel])

  const ambientIntensity = passiveMode ? 0.3 : 0.1

  return (
    <>
      {/* Scene lighting */}
      <ambientLight intensity={0.15} />
      <directionalLight position={[5, 8, 5]} intensity={0.3} castShadow />

      {/* Room structure */}
      <Room ambientColor={ambientColor} ambientIntensity={ambientIntensity} />

      {/* Devices */}
      <CeilingLight
        isOn={ceilingLightOn}
        brightness={ceilingLightBrightness}
        isSelected={selectedDevice === "ceilingLight"}
      />

      <DeskLamp
        isOn={deskLampOn}
        brightness={deskLampBrightness}
        isSelected={selectedDevice === "deskLamp"}
      />

      <AccentLight
        color={accentLightColor}
        intensity={accentLightIntensity}
        isSelected={selectedDevice === "accentLight"}
      />

      <SmartSwitch isOn={switchOn} isSelected={selectedDevice === "switch"} />

      <SmartPlug isOn={plugOn} isSelected={selectedDevice === "plug"} />

      <Fan isOn={fanOn} speed={fanSpeed} isSelected={selectedDevice === "fan"} />

      <TV isOn={tvOn} brightness={tvBrightness} isSelected={selectedDevice === "tv"} />

      <Thermostat
        isOn={thermostatOn}
        temp={thermostatTemp}
        mode={thermostatMode}
        isSelected={selectedDevice === "thermostat"}
      />

      {/* Camera controls */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={3}
        maxDistance={15}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2 - 0.1}
        target={[0, 1.5, 0]}
      />
    </>
  )
})

// ============================================================================
// EXPORTED COMPONENT
// ============================================================================

/**
 * SmartHomeScene - A 3D visualization of a smart home room
 *
 * This component accepts props to control all smart devices in the scene.
 * All state should be managed externally and passed in via props.
 *
 * @example
 * // External state control from parent component or dashboard
 * const [state, setState] = useState<SmartHomeSceneProps>({
 *   ceilingLightOn: true,
 *   ceilingLightBrightness: 0.8,
 *   // ... other props
 * });
 *
 * <SmartHomeScene {...state} />
 */
export default function SmartHomeScene(props: SmartHomeSceneProps) {
  return (
    <Canvas
      shadows
      camera={{
        position: [6, 4, 6],
        fov: 50,
        near: 0.1,
        far: 100,
      }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.2,
      }}
      style={{ background: "#0a0a12" }}
    >
      <Suspense fallback={null}>
        <SceneContent {...props} />
      </Suspense>
    </Canvas>
  )
}

// Also export the props type for external usage
export type { SmartHomeSceneProps as SmartHomeProps }
