import { Router } from "express";

export function managerRouter(managerId: string) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      id: managerId,
      name: "Simulator Manager",
      kind: "simulator",
      version: "1.0.0",
      online: true,
      supportsDiscovery: false,
      supportsBulkActions: true,
      integrationType: "external",
    });
  });

  return router;
}
