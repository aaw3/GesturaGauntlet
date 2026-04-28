import { Router } from "express";
import { DeviceStore, SimulatorApiError } from "../store/DeviceStore";

export function managerRouter(store: DeviceStore) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      res.json(await store.getManagerInfo());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Simulator API request failed";
      const status = error instanceof SimulatorApiError && error.status ? error.status : 502;
      res.status(status).json({ error: message });
    }
  });

  router.post("/discover", async (_req, res) => {
    try {
      const devices = await store.listDevices();
      res.json({
        ok: true,
        discovered: devices.length,
        added: 0,
        updated: devices.length,
        offlineMarked: 0,
        errors: [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Simulator discovery failed";
      const status = error instanceof SimulatorApiError && error.status ? error.status : 502;
      res.status(status).json({ error: message });
    }
  });

  router.post("/clear-storage", async (_req, res) => {
    try {
      const devices = await store.listDevices();
      res.json({
        ok: true,
        cleared: true,
        reinitialized: true,
        discovered: devices.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Simulator storage clear failed";
      const status = error instanceof SimulatorApiError && error.status ? error.status : 502;
      res.status(status).json({ error: message });
    }
  });

  return router;
}
