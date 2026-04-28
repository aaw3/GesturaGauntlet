export type SmartHomeSceneProps = {
  ceilingLightOn: boolean
  ceilingLightBrightness: number

  deskLampOn: boolean
  deskLampBrightness: number

  accentLightColor: string
  accentLightIntensity: number

  switchOn: boolean
  plugOn: boolean

  fanOn: boolean
  fanSpeed: number

  tvOn: boolean
  tvBrightness: number

  thermostatOn: boolean
  thermostatTemp: number
  thermostatMode: "cool" | "heat" | "off"

  passiveMode: boolean
  productivityLevel: "high" | "medium" | "low"

  selectedDevice?:
    | "ceilingLight"
    | "deskLamp"
    | "accentLight"
    | "switch"
    | "plug"
    | "fan"
    | "tv"
    | "thermostat"
    | null
}

export type DeviceProps = {
  isSelected: boolean
}