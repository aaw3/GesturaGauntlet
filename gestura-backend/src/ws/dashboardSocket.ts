import { Server } from "socket.io";
import { GesturaServices } from "../services";

export function registerDashboardSocket(io: Server, services: GesturaServices) {
  io.of("/dashboard").on("connection", async (socket) => {
    socket.emit("managers", await services.managerService.getInfos());
    socket.emit("devices", services.deviceService.listDevices());
    socket.emit("mappings", services.mappingService.list());

    socket.on("syncDevices", async () => {
      await services.deviceSyncService.syncAllManagers();
      socket.emit("devices", services.deviceService.listDevices());
    });
  });
}
