import express from "express";
import cors from "cors";
import { actionsRouter } from "./routes/actions";
import { devicesRouter } from "./routes/devices";
import { managerRouter } from "./routes/manager";
import { DeviceStore } from "./store/DeviceStore";
import { attachSimulatorToNodeAgent } from "./nodeAgentAttachment";
import dotenv from "dotenv";

dotenv.config();

export function createSimulatorApp() {
  const store = new DeviceStore();
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api/manager", managerRouter(store));
  app.use("/api/devices", devicesRouter(store));
  app.use("/api/actions", actionsRouter(store));
  attachSimulatorToNodeAgent(store);

  return { app, store, simulatorApiUrl: store.simulatorApiUrl };
}

function getHostPortFromEnv() {
  const fallback = { host: "0.0.0.0", port: 3102 };

  const raw = process.env.SIM_MANAGER_URL;
  if (!raw) return fallback;

  try {
    const url = new URL(raw);

    return {
      host: url.hostname || fallback.host,
      port: Number(url.port || fallback.port),
    };
  } catch {
    return fallback;
  }
}

if (require.main === module) {
  const { app } = createSimulatorApp();
  const { host, port } = getHostPortFromEnv();
    
  app.listen(port, host, () => {
    console.log(`[SimManager] listening on http://${host}:${port}`);
  });
}
