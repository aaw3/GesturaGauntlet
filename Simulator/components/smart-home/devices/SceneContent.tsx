import { memo, useEffect } from "react"
import { useThree } from "@react-three/fiber"
import { ContactShadows, OrbitControls } from "@react-three/drei"
import { Room } from "../Room"
import { AccentLight } from "./AccentLight"
import { TV } from "./TV"
import { Thermostat } from "./Thermostat"
import type { SmartHomeSceneProps } from "../types"

export const SceneContent = memo(function SceneContent(props: SmartHomeSceneProps) {
  const { camera } = useThree()
  const {
    tableLampOn,
    tableLampBrightness,
    tableLampColor,
    cornerLedColor,
    cornerLedIntensity,
    accentLightColor,
    accentLightIntensity,
    tvOn,
    thermostatOn,
    thermostatTemp,
    thermostatMode,
    selectedDevice,
  } = props

  useEffect(() => {
    camera.position.set(2.65, 1.38, 4.65)
    camera.lookAt(-2.65, 1.62, -4.72)
    camera.updateProjectionMatrix()
  }, [camera])

  return (
    <>
      <color attach="background" args={["#171925"]} />
      <fog attach="fog" args={["#171925", 15, 30]} />
      <hemisphereLight args={["#ffe7c8", "#37314d", 1.18]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 6.4, 4.5]} intensity={0.52} castShadow shadow-mapSize={[1536, 1536]} />

      <Room
        cornerLedColor={cornerLedColor}
        cornerLedIntensity={cornerLedIntensity}
        tableLampOn={tableLampOn}
        tableLampBrightness={tableLampBrightness}
        tableLampColor={tableLampColor}
        tableLampSelected={selectedDevice === "tableLamp"}
      />

      <AccentLight
        color={accentLightColor}
        intensity={accentLightIntensity}
        isSelected={selectedDevice === "accentLight"}
      />

      <TV isOn={tvOn} isSelected={selectedDevice === "tv"} />

      <Thermostat
        isOn={thermostatOn}
        temp={thermostatTemp}
        mode={thermostatMode}
        isSelected={selectedDevice === "thermostat"}
      />

      <ContactShadows
        position={[0, 0.025, 0]}
        opacity={0.3}
        scale={10}
        blur={2.4}
        far={5}
        color="#11131f"
      />

      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={2.4}
        maxDistance={13}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2 - 0.1}
        target={[-2.65, 1.62, -4.72]}
      />
    </>
  )
})
