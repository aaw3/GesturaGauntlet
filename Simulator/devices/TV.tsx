"use client"

import React, { memo, useEffect, useState } from "react"
import { SelectionRing } from "../shared/SelectionRing"
import { Html } from "@react-three/drei"
import type { DeviceProps } from "../types"

export const TV = memo(function TV({
  isOn,
  brightness,
  isSelected,
}: DeviceProps & { isOn: boolean; brightness: number }) {
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

  return (
    <group position={[0, 1.5, -4]}>
      {/* TV Frame */}
      <mesh>
        <boxGeometry args={[2, 1.2, 0.1]} />
        <meshStandardMaterial color="#111" />
      </mesh>

      {/* TV Screen Plane */}
      <mesh position={[0, 0, 0.06]}>
        <planeGeometry args={[1.8, 1]} />
        <meshStandardMaterial
          color={isOn ? "#ffffff" : "#000000"}
          emissive={isOn ? "#ffffff" : "#000000"}
          emissiveIntensity={isOn ? brightness : 0}
          transparent
          opacity={isOn ? 0.05 : 1}
        />

        {isOn && (
          <Html
            transform
            position={[0, 0, 0.12]}
            distanceFactor={1.2}
            style={{
              width: "180px",
              height: "100px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#000",
              pointerEvents: "none",
              userSelect: "none",
              overflow: "hidden",
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
                objectFit: "cover",
                display: imgLoaded ? "block" : "none",
              }}
            />
          </Html>
        )}
      </mesh>

      <SelectionRing radius={1.2} visible={isSelected} />
    </group>
  )
})