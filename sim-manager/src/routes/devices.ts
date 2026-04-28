import { Router } from "express";
import { DeviceStore, SimulatorApiError } from "../store/DeviceStore";

export function devicesRouter(store: DeviceStore) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      res.json(await store.listDevices());
    } catch (error) {
      respondWithProxyError(res, error);
    }
  });

  router.get("/state", async (_req, res) => {
    try {
      res.json(await store.listStates());
    } catch (error) {
      respondWithProxyError(res, error);
    }
  });

  router.get("/:deviceId/state", async (req, res) => {
    try {
      const state = await store.getState(req.params.deviceId);
      if (!state) {
        res.status(404).json({ error: "Device state not found" });
        return;
      }
      res.json(state);
    } catch (error) {
      respondWithProxyError(res, error);
    }
  });

  router.post("/:deviceId/actions/:capabilityId", async (req, res) => {
    try {
      const result = await store.applyAction({
        ...req.body,
        deviceId: req.params.deviceId,
        capabilityId: req.params.capabilityId,
      });
      res.status(result.ok ? 200 : 404).json(result);
    } catch (error) {
      respondWithProxyError(res, error);
    }
  });

  return router;
}

function respondWithProxyError(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown) {
  const message = error instanceof Error ? error.message : "Simulator API request failed";
  const status = error instanceof SimulatorApiError && error.status ? error.status : 502;
  res.status(status).json({ error: message });
}
