import { Router } from "express";
import { KasaDeviceManager } from "../managers/kasa/KasaDeviceManager";
import { SimulatorClient } from "../managers/simulator/simulator-client";
import { SimulatorDeviceManager } from "../managers/simulator/SimulatorDeviceManager";
import { GesturaServices } from "../services";
import { ManagedDevice } from "../types/device";
import {
  AddExternalManagerRequest,
  AddNativeKasaManagerRequest,
  DeviceManagerInfo,
  ExternalManagerValidationResult,
} from "../types/manager";

export function managersRouter(services: GesturaServices) {
  const router = Router();

  router.get("/", async (_req, res) => {
    res.json(await services.managerService.getInfos());
  });

  router.post("/kasa", async (req, res) => {
    const payload = req.body as AddNativeKasaManagerRequest;
    const managerId = payload.id || "kasa-main";

    if (!payload.name?.trim()) {
      res.status(400).json({ error: "Kasa manager name is required" });
      return;
    }

    const manager = new KasaDeviceManager(managerId, [], {
      name: payload.name,
    });

    await services.managerService.registerValidated(managerId, manager);
    res.status(201).json(await manager.getInfo());
  });

  router.post("/external", async (req, res) => {
    const payload = req.body as AddExternalManagerRequest;
    const validation = await validateExternalManager(payload);

    if (!validation.ok || !validation.managerInfo) {
      res.status(400).json(validation);
      return;
    }

    const manager = new SimulatorDeviceManager(
      validation.managerInfo.id,
      new SimulatorClient(payload.baseUrl, payload.authToken),
      {
        name: payload.name || validation.managerInfo.name,
        baseUrl: payload.baseUrl,
        managerInfo: {
          ...validation.managerInfo,
          name: payload.name || validation.managerInfo.name,
          baseUrl: payload.baseUrl,
        },
      },
    );

    await services.managerService.registerValidated(validation.managerInfo.id, manager);
    const sync = await services.deviceSyncService.syncManager(validation.managerInfo.id);

    res.status(201).json({
      ok: true,
      manager: await manager.getInfo(),
      deviceCount: validation.deviceCount,
      sync,
    });
  });

  router.delete("/:managerId", (req, res) => {
    const removed = services.managerService.unregister(req.params.managerId);
    if (!removed) {
      res.status(404).json({ error: "Manager not found" });
      return;
    }

    services.registry.clearManagerDevices(req.params.managerId);
    res.json({ ok: true, managerId: req.params.managerId });
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

async function validateExternalManager(
  request: AddExternalManagerRequest,
): Promise<ExternalManagerValidationResult> {
  const errors: string[] = [];

  if (!request.name?.trim()) errors.push("Display name is required");
  if (!request.baseUrl?.trim()) errors.push("Base URL is required");
  if (errors.length > 0) return { ok: false, errors };

  const client = new SimulatorClient(request.baseUrl, request.authToken);
  let managerInfo: DeviceManagerInfo;
  let devices: ManagedDevice[];

  try {
    managerInfo = await client.getJson<DeviceManagerInfo>("/api/manager");
  } catch (error) {
    return {
      ok: false,
      errors: [`GET /api/manager failed: ${error instanceof Error ? error.message : "Unknown error"}`],
    };
  }

  if (!managerInfo.id) errors.push("Manager info missing id");
  if (!managerInfo.name) errors.push("Manager info missing name");
  if (!managerInfo.kind) errors.push("Manager info missing kind");
  if (!managerInfo.version) errors.push("Manager info missing version");
  if (managerInfo.integrationType && managerInfo.integrationType !== "external") {
    errors.push("Manager integrationType must be external");
  }

  try {
    devices = await client.getJson<ManagedDevice[]>("/api/devices");
  } catch (error) {
    return {
      ok: false,
      managerInfo,
      errors: [
        ...errors,
        `GET /api/devices failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      ],
    };
  }

  if (!Array.isArray(devices)) {
    errors.push("GET /api/devices must return an array");
    devices = [];
  }

  for (const device of devices) {
    if (!device.id) errors.push("Device missing id");
    if (!device.name) errors.push(`Device ${device.id || "<unknown>"} missing name`);
    if (!device.type) errors.push(`Device ${device.id || "<unknown>"} missing type`);
    if (!Array.isArray(device.capabilities)) {
      errors.push(`Device ${device.id || "<unknown>"} missing capabilities array`);
      continue;
    }

    for (const capability of device.capabilities) {
      if (!capability.id) errors.push(`Device ${device.id} has capability missing id`);
      if (!capability.label) errors.push(`Device ${device.id} has capability missing label`);
      if (!capability.kind) errors.push(`Device ${device.id} has capability missing kind`);
    }
  }

  return {
    ok: errors.length === 0,
    managerInfo: {
      ...managerInfo,
      integrationType: "external",
      baseUrl: request.baseUrl,
    },
    deviceCount: devices.length,
    errors,
  };
}
