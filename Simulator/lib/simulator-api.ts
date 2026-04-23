export type OnlineStatus = "online" | "offline" | "unknown"
export type DeviceSource = "simulator"
export type DeviceType = "light" | "plug" | "fan" | "thermostat" | "other"
export type CapabilityKind = "toggle" | "range" | "color" | "discrete"
export type ActionCommandType = "set" | "delta" | "toggle" | "execute"

export interface RangeSpec {
  min: number
  max: number
  step?: number
  unit?: string
}

export interface ManagedCapability {
  id: string
  label: string
  kind: CapabilityKind
  readable?: boolean
  writable?: boolean
  range?: RangeSpec
  options?: string[]
}

export interface ManagedDevice {
  id: string
  managerId: string
  source: DeviceSource
  type: DeviceType
  name: string
  online: OnlineStatus
  capabilities: ManagedCapability[]
}

export interface DeviceStateSnapshot {
  deviceId: string
  ts: number
  values: Record<string, string | number | boolean | null>
}

export interface DeviceActionRequest {
  deviceId: string
  capabilityId: string
  commandType: ActionCommandType
  value?: string | number | boolean | null
  delta?: number
  command?: string
  params?: Record<string, unknown>
}

export interface DeviceActionResult {
  ok: boolean
  deviceId: string
  capabilityId: string
  appliedValue?: string | number | boolean | null
  changed?: boolean
  message?: string
}

export interface DeviceManagerInfo {
  id: string
  name: string
  kind: "simulator"
  version: string
  online: boolean
  supportsDiscovery: boolean
  supportsBulkActions: boolean
  integrationType: "external"
  metadata: Record<string, unknown>
}

type StoreShape = {
  devices: Map<string, ManagedDevice>
  states: Map<string, DeviceStateSnapshot>
}

const MANAGER_ID = process.env.SIMULATOR_MANAGER_ID || "simulator-lab"
const MANAGER_NAME = process.env.SIMULATOR_MANAGER_NAME || "Simulator Lab"

const DEVICE_DEFINITIONS: ManagedDevice[] = [
  lightDevice("sim-ceiling-light", "Ceiling Light", [
    powerCapability(),
    brightnessCapability(),
  ]),
  lightDevice("sim-desk-lamp", "Desk Lamp", [powerCapability(), brightnessCapability()]),
  lightDevice("sim-accent-light", "Accent Light Strip", [
    powerCapability(),
    colorCapability(),
    intensityCapability(),
  ]),
  plugDevice("sim-switch", "Smart Switch"),
  plugDevice("sim-plug", "Smart Plug"),
  {
    id: "sim-fan",
    managerId: MANAGER_ID,
    source: "simulator",
    type: "fan",
    name: "Ceiling Fan",
    online: "online",
    capabilities: [powerCapability(), speedCapability()],
  },
  lightDevice("sim-tv", "TV", [powerCapability(), brightnessCapability()]),
  {
    id: "sim-thermostat",
    managerId: MANAGER_ID,
    source: "simulator",
    type: "thermostat",
    name: "Thermostat",
    online: "online",
    capabilities: [powerCapability(), temperatureCapability(), modeCapability()],
  },
]

const INITIAL_STATES: DeviceStateSnapshot[] = [
  state("sim-ceiling-light", { power: true, brightness: 80 }),
  state("sim-desk-lamp", { power: true, brightness: 60 }),
  state("sim-accent-light", { power: true, color: "#ff00ff", intensity: 50 }),
  state("sim-switch", { power: true }),
  state("sim-plug", { power: true }),
  state("sim-fan", { power: true, speed: 70 }),
  state("sim-tv", { power: true, brightness: 80 }),
  state("sim-thermostat", { power: true, temperature: 72, mode: "cool" }),
]

declare global {
  var __gesturaSimulatorStore: StoreShape | undefined
}

export function getManagerInfo(): DeviceManagerInfo {
  return {
    id: MANAGER_ID,
    name: MANAGER_NAME,
    kind: "simulator",
    version: "1.0.0",
    online: true,
    supportsDiscovery: false,
    supportsBulkActions: true,
    integrationType: "external",
    metadata: {
      deviceCount: DEVICE_DEFINITIONS.length,
      apiContract: "gestura-device-manager",
    },
  }
}

export function listDevices(): ManagedDevice[] {
  return Array.from(getStore().devices.values()).map((device) => ({
    ...device,
    capabilities: device.capabilities.map((capability) => ({ ...capability })),
  }))
}

export function getDeviceState(deviceId: string): DeviceStateSnapshot | null {
  const current = getStore().states.get(deviceId)
  if (!current) return null

  return {
    deviceId: current.deviceId,
    ts: Date.now(),
    values: { ...current.values },
  }
}

export function listDeviceStates(): DeviceStateSnapshot[] {
  return listDevices()
    .map((device) => getDeviceState(device.id))
    .filter((snapshot): snapshot is DeviceStateSnapshot => Boolean(snapshot))
}

export function applyDeviceAction(action: DeviceActionRequest): DeviceActionResult {
  const store = getStore()
  const device = store.devices.get(action.deviceId)
  const state = store.states.get(action.deviceId)

  if (!device || !state) {
    return {
      ok: false,
      deviceId: action.deviceId,
      capabilityId: action.capabilityId,
      message: "Device not found",
    }
  }

  const capability = device.capabilities.find((candidate) => candidate.id === action.capabilityId)
  if (!capability) {
    return {
      ok: false,
      deviceId: action.deviceId,
      capabilityId: action.capabilityId,
      message: "Capability not found",
    }
  }

  const currentValue = state.values[action.capabilityId]
  const nextValue = getNextValue(action, capability, currentValue)
  const changed = !Object.is(currentValue, nextValue)

  if (changed) {
    state.values[action.capabilityId] = nextValue
    state.ts = Date.now()
  }

  return {
    ok: true,
    deviceId: action.deviceId,
    capabilityId: action.capabilityId,
    appliedValue: nextValue,
    changed,
  }
}

function getStore(): StoreShape {
  if (!globalThis.__gesturaSimulatorStore) {
    globalThis.__gesturaSimulatorStore = {
      devices: new Map(DEVICE_DEFINITIONS.map((device) => [device.id, device])),
      states: new Map(INITIAL_STATES.map((snapshot) => [snapshot.deviceId, snapshot])),
    }
  }

  return globalThis.__gesturaSimulatorStore
}

function getNextValue(
  action: DeviceActionRequest,
  capability: ManagedCapability,
  currentValue: string | number | boolean | null,
) {
  if (action.commandType === "toggle") {
    return typeof currentValue === "boolean" ? !currentValue : true
  }

  if (action.commandType === "delta") {
    return clampRange(
      Number(currentValue ?? 0) + Number(action.delta ?? 0),
      capability.range?.min,
      capability.range?.max,
    )
  }

  if (action.commandType === "set") {
    if (capability.kind === "range") {
      return clampRange(Number(action.value ?? 0), capability.range?.min, capability.range?.max)
    }

    if (capability.kind === "toggle") {
      return Boolean(action.value)
    }

    return action.value ?? null
  }

  return currentValue ?? null
}

function lightDevice(
  id: string,
  name: string,
  capabilities: ManagedCapability[],
): ManagedDevice {
  return {
    id,
    managerId: MANAGER_ID,
    source: "simulator",
    type: "light",
    name,
    online: "online",
    capabilities,
  }
}

function plugDevice(id: string, name: string): ManagedDevice {
  return {
    id,
    managerId: MANAGER_ID,
    source: "simulator",
    type: "plug",
    name,
    online: "online",
    capabilities: [powerCapability()],
  }
}

function state(
  deviceId: string,
  values: DeviceStateSnapshot["values"],
): DeviceStateSnapshot {
  return {
    deviceId,
    ts: Date.now(),
    values,
  }
}

function powerCapability(): ManagedCapability {
  return {
    id: "power",
    label: "Power",
    kind: "toggle",
    readable: true,
    writable: true,
  }
}

function brightnessCapability(): ManagedCapability {
  return {
    id: "brightness",
    label: "Brightness",
    kind: "range",
    readable: true,
    writable: true,
    range: { min: 0, max: 100, step: 1, unit: "percent" },
  }
}

function intensityCapability(): ManagedCapability {
  return {
    id: "intensity",
    label: "Intensity",
    kind: "range",
    readable: true,
    writable: true,
    range: { min: 0, max: 100, step: 1, unit: "percent" },
  }
}

function colorCapability(): ManagedCapability {
  return {
    id: "color",
    label: "Color",
    kind: "color",
    readable: true,
    writable: true,
  }
}

function speedCapability(): ManagedCapability {
  return {
    id: "speed",
    label: "Speed",
    kind: "range",
    readable: true,
    writable: true,
    range: { min: 0, max: 100, step: 1, unit: "percent" },
  }
}

function temperatureCapability(): ManagedCapability {
  return {
    id: "temperature",
    label: "Temperature",
    kind: "range",
    readable: true,
    writable: true,
    range: { min: 60, max: 85, step: 1, unit: "fahrenheit" },
  }
}

function modeCapability(): ManagedCapability {
  return {
    id: "mode",
    label: "Mode",
    kind: "discrete",
    readable: true,
    writable: true,
    options: ["cool", "heat", "off"],
  }
}

function clampRange(
  value: number,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
) {
  return Math.max(min, Math.min(max, value))
}
