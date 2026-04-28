import { memo } from "react"
import { RoundedBox } from "@react-three/drei"
import { SelectionRing } from "../SelectionRing"
import type { DeviceProps } from "../types"

export const SmartPlug = memo(function SmartPlug({
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
