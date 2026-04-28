import { memo } from "react"
import { RoundedBox } from "@react-three/drei"
import { SelectionRing } from "../SelectionRing"
import type { DeviceProps } from "../types"

export const SmartSwitch = memo(function SmartSwitch({
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
