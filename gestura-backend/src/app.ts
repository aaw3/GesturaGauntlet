import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { createServices } from "./services";
import { devicesRouter } from "./routes/devices";
import { glovesRouter } from "./routes/gloves";
import { managersRouter } from "./routes/managers";
import { mappingsRouter } from "./routes/mappings";
import { scenesRouter } from "./routes/scenes";
import { MqttBroker, registerGloveMqtt } from "./mqtt/gloveMqtt";
import { registerDashboardSocket } from "./ws/dashboardSocket";

export interface CreateAppOptions {
  mqttBroker?: MqttBroker;
}

export function createApp(options: CreateAppOptions = {}) {
  const services = createServices();
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api/gloves", glovesRouter(services));
  app.use("/api/devices", devicesRouter(services));
  app.use("/api/managers", managersRouter(services));
  app.use("/api/mappings", mappingsRouter(services));
  app.use("/api/scenes", scenesRouter(services));

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] },
  });

  registerDashboardSocket(io, services);
  if (options.mqttBroker) {
    registerGloveMqtt(options.mqttBroker, services, io);
  }

  return { app, server, io, services };
}

if (require.main === module) {
  const { server } = createApp();
  const port = Number(process.env.PORT || 3001);
  server.listen(port, () => {
    console.log(`[Gestura] API listening on http://localhost:${port}`);
  });
}
