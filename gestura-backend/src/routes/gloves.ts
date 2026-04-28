import { Router } from "express";
import { GesturaServices } from "../services";
import { GloveEvent, GloveSignal, GloveStatus } from "../types/glove";

export function glovesRouter(services: GesturaServices) {
  const router = Router();

  router.get("/:gloveId/status", (req, res) => {
    const status = services.gloveStateService.getStatus(req.params.gloveId);
    if (!status) {
      res.status(404).json({ error: "Glove status not found" });
      return;
    }
    res.json(status);
  });

  router.post("/:gloveId/status", (req, res) => {
    res.json(
      services.gloveStateService.updateStatus({
        ...(req.body as GloveStatus),
        gloveId: req.params.gloveId,
      }),
    );
  });

  router.post("/:gloveId/events", async (req, res) => {
    res.json(
      await services.gloveStateService.handleEvent({
        ...(req.body as GloveEvent),
        gloveId: req.params.gloveId,
      }),
    );
  });

  router.post("/:gloveId/signals", async (req, res) => {
    res.json(
      await services.gloveStateService.handleSignal({
        ...(req.body as GloveSignal),
        gloveId: req.params.gloveId,
      }),
    );
  });

  return router;
}
