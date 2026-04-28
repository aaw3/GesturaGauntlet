import { memo, useMemo } from "react"
import { Text } from "@react-three/drei"
import { SelectionRing } from "../SelectionRing"
import type { DeviceProps } from "../types"

export const Thermostat = memo(function Thermostat({
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
