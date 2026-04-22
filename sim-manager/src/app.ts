import express from "express";
import cors from "cors";
import { actionsRouter } from "./routes/actions";
import { devicesRouter } from "./routes/devices";
import { managerRouter } from "./routes/manager";
import { DeviceStore } from "./store/DeviceStore";

export function createSimulatorApp() {
  const managerId = process.env.SIM_MANAGER_ID || "sim-manager-1";
  const store = new DeviceStore(managerId);
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api/manager", managerRouter(managerId));
  app.use("/api/devices", devicesRouter(store));
  app.use("/api/actions", actionsRouter(store));

  return { app, store, managerId };
}

if (require.main === module) {
  const { app } = createSimulatorApp();
  const port = Number(process.env.PORT || 3101);
  app.listen(port, () => {
    console.log(`[SimManager] listening on http://localhost:${port}`);
  });
}
