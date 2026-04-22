import { Router } from "express";

export function managerRouter(managerId: string) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      id: managerId,
      name: "Simulator Manager",
      version: "1.0.0",
      supportsBulkActions: true,
    });
  });

  return router;
}
