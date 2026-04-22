import { Router } from "express";
import { DeviceStore } from "../store/DeviceStore";
import { BulkActionRequest } from "../types";

export function actionsRouter(store: DeviceStore) {
  const router = Router();

  router.post("/bulk", (req, res) => {
    const request = req.body as BulkActionRequest;
    const results = request.actions.map((action) => store.applyAction(action));
    res.json({
      ok: results.every((result) => result.ok),
      results,
    });
  });

  return router;
}
