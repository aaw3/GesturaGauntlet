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

  return router;
}
