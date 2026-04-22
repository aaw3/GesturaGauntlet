import { Router } from "express";
import { GesturaServices } from "../services";

export function devicesRouter(services: GesturaServices) {
  const router = Router();

  router.get("/", (req, res) => {
    res.json(services.deviceService.listDevices(req.query.managerId as string | undefined));
  });

  router.get("/:deviceId", (req, res) => {
    const device = services.deviceService.getDevice(req.params.deviceId);
    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }
    res.json(device);
  });

  router.get("/:deviceId/state", async (req, res) => {
    const state = await services.deviceService.getDeviceState(req.params.deviceId);
    if (!state) {
      res.status(404).json({ error: "Device state not found" });
      return;
    }
    res.json(state);
  });

  router.post("/:deviceId/actions/:capabilityId", async (req, res) => {
    res.json(
      await services.actionRouter.execute({
        ...req.body,
        deviceId: req.params.deviceId,
        capabilityId: req.params.capabilityId,
      }),
    );
  });

  return router;
}
