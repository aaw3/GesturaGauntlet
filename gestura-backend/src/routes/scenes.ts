import { Router } from "express";
import { GesturaServices } from "../services";
import { SceneDefinition } from "../services/SceneService";

export function scenesRouter(services: GesturaServices) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(services.sceneService.list());
  });

  router.post("/", (req, res) => {
    res.status(201).json(services.sceneService.upsert(req.body as SceneDefinition));
  });

  router.post("/:sceneId/run", async (req, res) => {
    res.json(await services.sceneService.run(req.params.sceneId));
  });

  return router;
}
