import { DeviceStore } from "./store/DeviceStore";
import dotenv from "dotenv";

dotenv.config();

let io: any;
try {
  ({ io } = require("socket.io-client"));
} catch {
  ({ io } = require("../../Dashboard/node_modules/socket.io-client"));
}

const DEBUG = process.argv.includes("--debug");

function debugLog(...args: unknown[]) {
  if (DEBUG) {
    console.log(...args);
  }
}

function debugWarn(...args: unknown[]) {
  if (DEBUG) {
    console.warn(...args);
  }
}

function debugError(...args: unknown[]) {
  if (DEBUG) {
    console.error(...args);
  }
}

export function attachSimulatorToNodeAgent(store: DeviceStore) {
  const nodeAgentUrl =
    process.env.NODE_AGENT_WS_URL ||
    process.env.NODE_AGENT_URL ||
    "http://localhost:3201";

  debugLog("[SimManager] Attempting to connect to Node Agent at", nodeAgentUrl);

  const socket = io(nodeAgentUrl, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    timeout: 5000,
  });

  let managerId: string | null = null;

  socket.on("connect", async () => {
    debugLog("[SimManager] Socket connected to Node Agent");
    debugLog("[SimManager] socket.id =", socket.id);

    try {
      const info = await store.getManagerInfo();
      const devices = await store.listDevices();
      managerId = info.id;

      debugLog("[SimManager] Attaching manager:", info);

      socket.emit(
        "manager:attach",
        {
          token: process.env.MANAGER_TOKEN,
          info,
          devices,
        },
        (ack: unknown) => {
          debugLog("[SimManager] manager:attach ack:", ack);
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Simulator API unavailable";

      console.error("[SimManager] attach preparation failed:", message);

      socket.emit("manager:attach:error", {
        error: message,
        simulatorApiUrl: store.simulatorApiUrl,
        ts: Date.now(),
      });
    }
  });

  socket.on("connect_error", (error: Error) => {
    debugError("[SimManager] connect_error:", error.message);
  });

  socket.on("disconnect", (reason: string) => {
    debugWarn("[SimManager] disconnected from Node Agent:", reason);
  });

  socket.on("reconnect_attempt", (attempt: number) => {
    debugLog("[SimManager] reconnect_attempt:", attempt);
  });

  socket.on("reconnect", (attempt: number) => {
    debugLog("[SimManager] reconnected after attempts:", attempt);
  });

  socket.on("error", (error: unknown) => {
    debugError("[SimManager] socket error:", error);
  });

  const heartbeat = setInterval(async () => {
    if (!managerId) return;

    try {
      await store.getManagerInfo();
      socket.emit("manager:heartbeat", {
        managerId,
        health: "ok",
        ts: Date.now(),
      });
    } catch (error) {
      socket.emit("manager:heartbeat", {
        managerId,
        health: "error",
        error:
          error instanceof Error ? error.message : "Simulator API unavailable",
        ts: Date.now(),
      });
    }
  }, Number(process.env.MANAGER_HEARTBEAT_MS || 10_000));

  (heartbeat as unknown as { unref?: () => void }).unref?.();

  socket.on("manager:listDevices", async (_payload: unknown, ack?: Function) => {
    try {
      ack?.({ ok: true, data: await store.listDevices() });
    } catch (error) {
      ack?.({
        ok: false,
        error: error instanceof Error ? error.message : "List devices failed",
      });
    }
  });

  socket.on(
    "manager:getDeviceState",
    async (payload: { deviceId?: string }, ack?: Function) => {
      try {
        if (!payload?.deviceId) {
          ack?.({ ok: false, error: "Missing deviceId" });
          return;
        }

        const state = await store.getState(payload.deviceId);

        if (!state) {
          ack?.({
            ok: false,
            deviceId: payload.deviceId,
            error: "Device state not found",
          });
          return;
        }

        ack?.({ ok: true, data: state });
      } catch (error) {
        ack?.({
          ok: false,
          error: error instanceof Error ? error.message : "Get state failed",
        });
      }
    },
  );

  socket.on("manager:listDeviceStates", async (_payload: unknown, ack?: Function) => {
    try {
      ack?.({ ok: true, data: await store.listStates() });
    } catch (error) {
      ack?.({
        ok: false,
        error: error instanceof Error ? error.message : "List states failed",
      });
    }
  });

  socket.on(
    "manager:executeAction",
    async (payload: { action?: any }, ack?: Function) => {
      try {
        if (!payload?.action) {
          ack?.({ ok: false, error: "Missing action payload" });
          return;
        }

        const result = await store.applyAction(payload.action);
        ack?.(result);
      } catch (error) {
        ack?.({
          ok: false,
          error: error instanceof Error ? error.message : "Action failed",
        });
      }
    },
  );

  return socket;
}