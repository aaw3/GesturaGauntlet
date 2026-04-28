"use client"

import React, { memo } from "react"

export const SceneLights = memo(function SceneLights() {
  return (
    <>
      <hemisphereLight args={["#f7fbff", "#404052", 0.65]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 5]} intensity={0.65} castShadow />
      <pointLight position={[0, 3.2, 3.5]} intensity={0.45} distance={9} color="#d9e8ff" />
    </>
  )
})
