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
  if (!process.env.MANAGER_TOKEN) {
    throw new Error("MANAGER_TOKEN is required for sim-manager -> node-agent authentication");
  }

  debugLog("[SimManager] Attempting to connect to Node Agent at", nodeAgentUrl);

  const socket = io(nodeAgentUrl, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    timeout: 5000,
  });

  let managerId: string | null = null;
  let attachTimer: NodeJS.Timeout | null = null;

  const scheduleAttach = (delayMs = 0) => {
    if (attachTimer) clearTimeout(attachTimer);
    attachTimer = setTimeout(() => {
      attachTimer = null;
      void attachToNodeAgent();
    }, delayMs);
    (attachTimer as unknown as { unref?: () => void }).unref?.();
  };

  const attachToNodeAgent = async () => {
    if (!socket.connected) return;

    try {
      const info = await store.getManagerInfo();
      const devices = await store.listDevices();
      managerId = info.id;

      debugLog("[SimManager] Attaching manager:", info);

      socket.timeout(5000).emit(
        "manager:attach",
        {
          token: process.env.MANAGER_TOKEN,
          info,
          devices,
        },
        (err: Error | null, ack: any) => {
          if (err || ack?.ok === false) {
            console.error(
              "[SimManager] attach failed:",
              err?.message || ack?.error || ack?.message || "Node agent rejected attach",
            );
            scheduleAttach(Number(process.env.MANAGER_ATTACH_RETRY_MS || 5000));
            return;
          }

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
      scheduleAttach(Number(process.env.MANAGER_ATTACH_RETRY_MS || 5000));
    }
  };

  socket.on("connect", async () => {
    debugLog("[SimManager] Socket connected to Node Agent");
    debugLog("[SimManager] socket.id =", socket.id);
    scheduleAttach();
  });

  socket.on("connect_error", (error: Error) => {
    debugError("[SimManager] connect_error:", error.message);
  });

  socket.on("disconnect", (reason: string) => {
    if (attachTimer) clearTimeout(attachTimer);
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

  socket.on("manager:discover", async (_payload: unknown, ack?: Function) => {
    try {
      const devices = await store.listDevices();
      if (managerId) {
        socket.emit("manager:inventory", {
          managerId,
          devices,
        });
      }
      ack?.({
        ok: true,
        data: {
          ok: true,
          managerId,
          discovered: devices.length,
        },
      });
    } catch (error) {
      ack?.({
        ok: false,
        error: error instanceof Error ? error.message : "Discovery failed",
      });
    }
  });

  socket.on("manager:clearStorage", async (_payload: unknown, ack?: Function) => {
    try {
      if (managerId) {
        socket.emit("manager:inventory", {
          managerId,
          devices: [],
        });
      }
      ack?.({
        ok: true,
        data: {
          ok: true,
          managerId,
          cleared: true,
          reinitialized: true,
        },
      });
    } catch (error) {
      ack?.({
        ok: false,
        error: error instanceof Error ? error.message : "Clear storage failed",
      });
    }
  });

  return socket;
}
