import { Server } from "socket.io";
import { GesturaServices } from "../services";
import { GloveEvent, GloveSignal, GloveStatus } from "../types/glove";

export const GLOVE_MQTT_TOPICS = {
  status: "gauntlet/glove/status",
  events: "gauntlet/glove/events",
  signals: "gauntlet/glove/signals",
  sensors: "gauntlet/sensors",
  mode: "gauntlet/mode",
} as const;

interface MqttPacket {
  topic?: string;
  payload?: Buffer | Uint8Array | string;
}

interface MqttClient {
  id?: string;
}

export interface MqttBroker {
  on(event: "publish", handler: (packet: MqttPacket, client?: MqttClient) => void): void;
}

export function registerGloveMqtt(
  broker: MqttBroker,
  services: GesturaServices,
  io: Server,
) {
  const dashboard = io.of("/dashboard");

  broker.on("publish", (packet, client) => {
    if (!packet.topic || packet.topic.startsWith("$SYS")) return;

    if (packet.topic === GLOVE_MQTT_TOPICS.status) {
      const status = parseJsonPayload<GloveStatus>(packet.payload);
      if (!status) return;

      services.gloveStateService.updateStatus(status);
      dashboard.emit("gloveStatus", {
        ...status,
        source: `mqtt:${client?.id ?? "broker"}`,
      });
      return;
    }

    if (packet.topic === GLOVE_MQTT_TOPICS.events) {
      const event = parseJsonPayload<GloveEvent>(packet.payload);
      if (!event) return;

      void services.gloveStateService.handleEvent(event).then((results) => {
        dashboard.emit("gloveEvent", {
          ...event,
          source: `mqtt:${client?.id ?? "broker"}`,
        });
        dashboard.emit("actionResults", results);
      });
      return;
    }

    if (packet.topic === GLOVE_MQTT_TOPICS.signals) {
      const signal = parseJsonPayload<GloveSignal>(packet.payload);
      if (!signal) return;

      void services.gloveStateService.handleSignal(signal).then((results) => {
        dashboard.emit("gloveSignal", {
          ...signal,
          source: `mqtt:${client?.id ?? "broker"}`,
        });
        dashboard.emit("actionResults", results);
      });
      return;
    }

    if (packet.topic === GLOVE_MQTT_TOPICS.sensors) {
      const payload = parseJsonPayload<Record<string, unknown>>(packet.payload);
      if (!payload) return;

      for (const signal of sensorPayloadToSignals(payload)) {
        void services.gloveStateService.handleSignal(signal).then((results) => {
          dashboard.emit("gloveSignal", {
            ...signal,
            source: `mqtt:${client?.id ?? "broker"}`,
          });
          dashboard.emit("actionResults", results);
        });
      }
    }
  });
}

function parseJsonPayload<T>(payload: MqttPacket["payload"]): T | null {
  try {
    const raw =
      typeof payload === "string" ? payload : Buffer.from(payload ?? "").toString("utf8");
    return JSON.parse(raw.trim()) as T;
  } catch {
    return null;
  }
}

function sensorPayloadToSignals(payload: Record<string, unknown>): GloveSignal[] {
  const gloveId = String(payload.gloveId ?? "primary_glove");
  const ts = Number(payload.ts ?? Date.now());
  const signals: GloveSignal[] = [];

  const roll = toFiniteNumber(payload.roll ?? payload.x);
  if (roll !== null) {
    signals.push({
      gloveId,
      ts,
      signal: "roll",
      raw: roll,
      normalized: clampNormalized(roll),
    });
  }

  const pitch = toFiniteNumber(payload.pitch ?? payload.y);
  if (pitch !== null) {
    signals.push({
      gloveId,
      ts,
      signal: "pitch",
      raw: pitch,
      normalized: clampNormalized(pitch),
    });
  }

  const pressureTop = toFiniteNumber(payload.pressure_top ?? payload.topPressure);
  if (pressureTop !== null) {
    signals.push({
      gloveId,
      ts,
      signal: "pressure_top",
      raw: pressureTop,
      normalized: clampNormalized(pressureTop),
    });
  }

  const pressureBottom = toFiniteNumber(payload.pressure_bottom ?? payload.bottomPressure);
  if (pressureBottom !== null) {
    signals.push({
      gloveId,
      ts,
      signal: "pressure_bottom",
      raw: pressureBottom,
      normalized: clampNormalized(pressureBottom),
    });
  }

  return signals;
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampNormalized(value: number) {
  return Math.max(-1, Math.min(1, value));
}
