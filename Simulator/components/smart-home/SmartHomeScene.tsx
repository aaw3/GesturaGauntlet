"use client"

import { Suspense } from "react"
import { Canvas } from "@react-three/fiber"
import * as THREE from "three"
import { SceneContent } from "./devices/SceneContent"
import type { SmartHomeSceneProps } from "./types"

/**
 * SmartHomeScene - A 3D visualization of a smart home room
 *
 * All state is managed externally and passed in via props.
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

export type { SmartHomeSceneProps }
export type { SmartHomeSceneProps as SmartHomeProps } from "./types"
