import { Router } from "express";
import { DeviceStore } from "../store/DeviceStore";

export function devicesRouter(store: DeviceStore) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(store.listDevices());
  });

  router.get("/:deviceId/state", (req, res) => {
    const state = store.getState(req.params.deviceId);
    if (!state) {
      res.status(404).json({ error: "Device state not found" });
      return;
    }
    res.json(state);
  });

  router.post("/:deviceId/actions/:capabilityId", (req, res) => {
    res.json(
      store.applyAction({
        ...req.body,
        deviceId: req.params.deviceId,
        capabilityId: req.params.capabilityId,
      }),
    );
  });

  return router;
}
