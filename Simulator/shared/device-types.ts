export type ToggleDeviceProps = {
  isOn: boolean
  isSelected: boolean
}

export type DimmableDeviceProps = ToggleDeviceProps & {
  brightness: number
}
