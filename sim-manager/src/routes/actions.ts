import { Router } from "express";
import { DeviceStore, SimulatorApiError } from "../store/DeviceStore";
import { BulkActionRequest } from "../types";

export function actionsRouter(store: DeviceStore) {
  const router = Router();

  router.post("/bulk", async (req, res) => {
    try {
      const request = req.body as BulkActionRequest;
      const results = await Promise.all(request.actions.map((action) => store.applyAction(action)));
      res.json({
        ok: results.every((result) => result.ok),
        results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Simulator API request failed";
      const status = error instanceof SimulatorApiError && error.status ? error.status : 502;
      res.status(status).json({ error: message });
    }
  });

  return router;
}
