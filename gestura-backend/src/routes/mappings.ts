import { Router } from "express";
import { GesturaServices } from "../services";
import { GloveMapping } from "../types/mapping";

export function mappingsRouter(services: GesturaServices) {
  const router = Router();

  router.get("/", (req, res) => {
    res.json(services.mappingService.list(req.query.gloveId as string | undefined));
  });

  router.post("/", (req, res) => {
    const mapping = req.body as GloveMapping;
    res.status(201).json(services.mappingService.upsert(mapping));
  });

  router.put("/devices/:deviceId", (req, res) => {
    res.json(services.mappingService.replaceForDevice(req.params.deviceId, req.body ?? []));
  });

  router.delete("/:mappingId", (req, res) => {
    res.json({ ok: services.mappingService.remove(req.params.mappingId) });
  });

  router.put("/:mappingId", (req, res) => {
    res.json(
      services.mappingService.upsert({
        ...req.body,
        id: req.params.mappingId,
      }),
    );
  });

  return router;
}
