"use client"

import React, { Suspense } from "react"
import { Canvas } from "@react-three/fiber"
import * as THREE from "three"
import { SceneContent } from "./SceneContent"
import type { SmartHomeSceneProps } from "./types"

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
        <SceneContent {...props} />
    </Canvas>
  )
}

export type { SmartHomeSceneProps as SmartHomeProps } from "./types"
