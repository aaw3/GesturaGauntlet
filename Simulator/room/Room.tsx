"use client"

import React, { memo, useMemo } from "react"
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <primitive object={floorMaterial} attach="material" />
      </mesh>

      <mesh position={[0, 2.5, -5]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <primitive object={wallMaterial} attach="material" />
      </mesh>

      <mesh position={[-5, 2.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <primitive object={wallMaterial} attach="material" />
      </mesh>

      <mesh position={[5, 2.5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <primitive object={wallMaterial} attach="material" />
      </mesh>

      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 5, 0]}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#16162a" />
      </mesh>

      <pointLight
        position={[0, 0.1, 0]}
        color={ambientColor}
        intensity={ambientIntensity * 0.5}
        distance={15}
      />
    </group>
  )
})