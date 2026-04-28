"use client"

import { useState, useCallback, useEffect } from "react"
import dynamic from "next/dynamic"
import { ControlPanel } from "@/components/controls/ControlPanel"
import { DeviceSelector } from "@/components/controls/DeviceSelector"
import type { SmartHomeSceneProps } from "@/components/smart-home/types"
import type { DeviceStateSnapshot } from "@/lib/simulator-api"

// Dynamic import to avoid SSR issues with Three.js
const SmartHomeScene = dynamic(() => import("@/components/smart-home/SmartHomeScene"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#0a0a12]">
      <div className="text-muted-foreground">Loading 3D scene...</div>
    </div>
  ),
})

type DeviceKey = NonNullable<SmartHomeSceneProps["selectedDevice"]>
type ApiControlKey = Exclude<keyof SmartHomeSceneProps, "selectedDevice" | "passiveMode" | "productivityLevel">

const API_CONTROL_MAP: Partial<Record<ApiControlKey, { deviceId: string; capabilityId: string }>> = {
  ceilingLightOn: { deviceId: "sim-ceiling-light", capabilityId: "power" },
  ceilingLightBrightness: { deviceId: "sim-ceiling-light", capabilityId: "brightness" },
  deskLampOn: { deviceId: "sim-desk-lamp", capabilityId: "power" },
  deskLampBrightness: { deviceId: "sim-desk-lamp", capabilityId: "brightness" },
  accentLightColor: { deviceId: "sim-accent-light", capabilityId: "color" },
  accentLightIntensity: { deviceId: "sim-accent-light", capabilityId: "intensity" },
  switchOn: { deviceId: "sim-switch", capabilityId: "power" },
  plugOn: { deviceId: "sim-plug", capabilityId: "power" },
  fanOn: { deviceId: "sim-fan", capabilityId: "power" },
  fanSpeed: { deviceId: "sim-fan", capabilityId: "speed" },
  tvOn: { deviceId: "sim-tv", capabilityId: "power" },
  tvBrightness: { deviceId: "sim-tv", capabilityId: "brightness" },
  thermostatOn: { deviceId: "sim-thermostat", capabilityId: "power" },
  thermostatTemp: { deviceId: "sim-thermostat", capabilityId: "temperature" },
  thermostatMode: { deviceId: "sim-thermostat", capabilityId: "mode" },
}

const DEFAULT_STATE: SmartHomeSceneProps = {
  ceilingLightOn: true,
  ceilingLightBrightness: 0.8,
  deskLampOn: true,
  deskLampBrightness: 0.6,
  accentLightColor: "#ff00ff",
  accentLightIntensity: 0.5,
  switchOn: true,
  plugOn: true,
  fanOn: true,
  fanSpeed: 0.7,
  tvOn: true,
  tvBrightness: 0.8,
  thermostatOn: true,
  thermostatTemp: 72,
  thermostatMode: "cool",
  passiveMode: true,
  productivityLevel: "high",
  selectedDevice: null,
}

export default function SmartHomeDemoPage() {
  const [state, setState] = useState<SmartHomeSceneProps>(DEFAULT_STATE)

  const handleChange = useCallback(
    <K extends keyof SmartHomeSceneProps>(key: K, value: SmartHomeSceneProps[K]) => {
      setState((prev) => ({ ...prev, [key]: value }))

      const apiTarget = API_CONTROL_MAP[key as ApiControlKey]
      if (apiTarget) {
        void postDeviceAction(apiTarget.deviceId, apiTarget.capabilityId, value)
      }
    },
    []
  )

  const handleSelectDevice = useCallback((device: DeviceKey | null) => {
    setState((prev) => ({ ...prev, selectedDevice: device }))
  }, [])

  useEffect(() => {
    let isCancelled = false

    const loadInitialState = async () => {
      const nextState = await fetchInitialSceneState()
      if (!isCancelled && nextState) {
        setState((prev) => ({ ...prev, ...nextState }))
      }
    }

    void loadInitialState()

    const source = new EventSource("/api/simulator-events")

    const onConnected = (event: MessageEvent) => {
      try {
        console.log("SSE connected:", JSON.parse(event.data))
      } catch {
        console.log("SSE connected")
      }
    }

    const onDeviceStateChange = (event: MessageEvent) => {
    if (isCancelled) return

    try {
        const snapshot = JSON.parse(event.data) as DeviceStateSnapshot

        if (!snapshot?.deviceId || !snapshot?.values) {
        console.warn("Ignoring malformed simulator event:", snapshot)
        return
        }

        setState((prev) => ({
        ...prev,
        ...applySnapshotToSceneState({}, snapshot),
        }))
        } catch (err) {
            console.error("Failed to parse simulator event:", err, event.data)
        }
    }

    source.addEventListener("connected", onConnected)
    source.addEventListener("device-state-change", onDeviceStateChange)

    source.onerror = (err) => {
      console.error("SSE error", err)
    }

    return () => {
      isCancelled = true
      source.removeEventListener("connected", onConnected)
      source.removeEventListener("device-state-change", onDeviceStateChange)
      source.close()
    }
  }, [])

  return (
    <div className="flex h-screen bg-background">
      <div className="flex-1 relative">
        <SmartHomeScene {...state} />
        <DeviceSelector
          selectedDevice={state.selectedDevice}
          onSelect={handleSelectDevice}
        />
      </div>

      <ControlPanel state={state} onChange={handleChange} />
    </div>
  )
}

async function fetchInitialSceneState(): Promise<Partial<SmartHomeSceneProps> | null> {
  try {
    const response = await fetchWithTimeout("/api/devices/state", 3000)
    if (!response.ok) return null

    const snapshots = (await response.json()) as DeviceStateSnapshot[]

    return snapshots.reduce<Partial<SmartHomeSceneProps>>((next, snapshot) => {
      if (!snapshot) return next
      return applySnapshotToSceneState(next, snapshot)
    }, {})
  } catch {
    return null
  }
}

function applySnapshotToSceneState(
  next: Partial<SmartHomeSceneProps>,
  snapshot: DeviceStateSnapshot,
): Partial<SmartHomeSceneProps> {
  const values = snapshot.values

  switch (snapshot.deviceId) {
    case "sim-ceiling-light":
      next.ceilingLightOn = Boolean(values.power)
      next.ceilingLightBrightness = toUnit(values.brightness)
      break
    case "sim-desk-lamp":
      next.deskLampOn = Boolean(values.power)
      next.deskLampBrightness = toUnit(values.brightness)
      break
    case "sim-accent-light":
      next.accentLightIntensity = Boolean(values.power) ? toUnit(values.intensity) : 0
      if (typeof values.color === "string") next.accentLightColor = values.color
      break
    case "sim-switch":
      next.switchOn = Boolean(values.power)
      break
    case "sim-plug":
      next.plugOn = Boolean(values.power)
      break
    case "sim-fan":
      next.fanOn = Boolean(values.power)
      next.fanSpeed = toUnit(values.speed)
      break
    case "sim-tv":
      next.tvOn = Boolean(values.power)
      next.tvBrightness = toUnit(values.brightness)
      break
    case "sim-thermostat":
      next.thermostatOn = Boolean(values.power)
      if (typeof values.temperature === "number") next.thermostatTemp = values.temperature
      if (values.mode === "cool" || values.mode === "heat" || values.mode === "off") {
        next.thermostatMode = values.mode
      }
      break
  }

  return next
}

function toUnit(value: DeviceStateSnapshot["values"][string]) {
  return Math.max(0, Math.min(1, Number(value ?? 0) / 100))
}

async function postDeviceAction<K extends keyof SmartHomeSceneProps>(
  deviceId: string,
  capabilityId: string,
  value: SmartHomeSceneProps[K],
) {
  const nextValue = typeof value === "number" && value <= 1 ? Math.round(value * 100) : value

  await fetch(`/api/devices/${encodeURIComponent(deviceId)}/actions/${encodeURIComponent(capabilityId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commandType: "set",
      value: nextValue,
    }),
  }).catch(() => undefined)
}

async function fetchWithTimeout(input: string, ms = 5000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ms)

  try {
    return await fetch(input, {
      cache: "no-store",
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}