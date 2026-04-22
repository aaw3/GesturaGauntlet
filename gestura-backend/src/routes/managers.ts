import { Router } from "express";
import { SimulatorClient } from "../managers/simulator/simulator-client";
import { SimulatorDeviceManager } from "../managers/simulator/SimulatorDeviceManager";
import { GesturaServices } from "../services";
import { CreateManagerRequest } from "../types/manager";

export function managersRouter(services: GesturaServices) {
  const router = Router();

  router.get("/", async (_req, res) => {
    res.json(await services.managerService.getInfos());
  });

  router.post("/", async (req, res) => {
    const payload = req.body as CreateManagerRequest;

    if (payload.kind !== "simulator" && payload.kind !== "custom") {
      res.status(400).json({ error: "Only simulator and custom managers can be added through the API" });
      return;
    }

    if (!payload.id || !payload.baseUrl) {
      res.status(400).json({ error: "Manager id and baseUrl are required" });
      return;
    }

    if (payload.kind === "custom") {
      res.status(501).json({ error: "Custom manager registration is not implemented yet" });
      return;
    }

    const manager = new SimulatorDeviceManager(
      payload.id,
      new SimulatorClient(payload.baseUrl, payload.authToken),
      {
        name: payload.name,
        baseUrl: payload.baseUrl,
      },
    );

    await services.managerService.registerValidated(payload.id, manager);
    res.status(201).json(await manager.getInfo());
  });

  router.get("/devices", async (_req, res) => {
    res.json(await services.managerService.listManagerDevices());
  });

  router.post("/:managerId/sync", async (req, res) => {
    res.json(await services.deviceSyncService.syncManager(req.params.managerId));
  });

  router.post("/:managerId/discover", async (req, res) => {
    res.json(await services.deviceSyncService.syncManager(req.params.managerId));
  });

  return router;
}
