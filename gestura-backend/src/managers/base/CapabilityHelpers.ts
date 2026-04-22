import { DeviceActionRequest } from "../../types/api";
import { DeviceCapability } from "../../types/device";
import { GloveMapping, InputTransform } from "../../types/mapping";

export function findCapability(
  capabilities: DeviceCapability[],
  capabilityId: string,
): DeviceCapability | undefined {
  return capabilities.find((capability) => capability.id === capabilityId);
}

export function applyTransform(input: number, transform: InputTransform = {}) {
  const deadzone = transform.deadzone ?? 0;
  let value = input;

  if (Math.abs(value) < deadzone) {
    return { value: 0, deadzoneApplied: true };
  }

  if (transform.invert) value *= -1;
  value += transform.offset ?? 0;
  value *= transform.scale ?? 1;

  const min = transform.min ?? -1;
  const max = transform.max ?? 1;
  const normalized = Math.max(-1, Math.min(1, value));
  let mapped = min + ((normalized + 1) / 2) * (max - min);

  if (transform.step && transform.step > 0) {
    mapped = Math.round(mapped / transform.step) * transform.step;
  }

  return {
    value: Math.max(min, Math.min(max, mapped)),
    deadzoneApplied: false,
  };
}

export function mappingToAction(
  mapping: GloveMapping,
  normalizedInput: number,
): DeviceActionRequest | null {
  if (!mapping.enabled) return null;

  if (mapping.mode === "toggle") {
    return {
      deviceId: mapping.targetDeviceId,
      capabilityId: mapping.targetCapabilityId,
      commandType: "toggle",
    };
  }

  if (mapping.mode === "scene") {
    return {
      deviceId: mapping.targetDeviceId,
      capabilityId: mapping.targetCapabilityId,
      commandType: "execute",
      command: "run",
    };
  }

  const transformed = applyTransform(normalizedInput, mapping.transform);
  if (transformed.deadzoneApplied) return null;

  if (mapping.mode === "continuous_delta" || mapping.mode === "step") {
    return {
      deviceId: mapping.targetDeviceId,
      capabilityId: mapping.targetCapabilityId,
      commandType: "delta",
      delta: transformed.value,
    };
  }

  return {
    deviceId: mapping.targetDeviceId,
    capabilityId: mapping.targetCapabilityId,
    commandType: "set",
    value: transformed.value,
  };
}
