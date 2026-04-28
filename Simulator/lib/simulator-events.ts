import { EventEmitter } from "events"

declare global {
  // eslint-disable-next-line no-var
  var __gesturaSimulatorEvents: EventEmitter | undefined
}

const eventBus = global.__gesturaSimulatorEvents ?? new EventEmitter()
eventBus.setMaxListeners(100)

if (!global.__gesturaSimulatorEvents) {
  global.__gesturaSimulatorEvents = eventBus
}

export type DeviceStateChangeEvent = {
  deviceId: string
  state: unknown
}

export function publishDeviceStateChange(event: DeviceStateChangeEvent) {
  eventBus.emit("device-state-change", event)
}

export function onDeviceStateChange(
  listener: (event: DeviceStateChangeEvent) => void,
) {
  eventBus.on("device-state-change", listener)
  return () => eventBus.off("device-state-change", listener)
}