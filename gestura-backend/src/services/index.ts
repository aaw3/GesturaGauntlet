import { DeviceRegistry } from "../managers/base/DeviceRegistry";
import { SimulatorClient } from "../managers/simulator/simulator-client";
import { SimulatorDeviceManager } from "../managers/simulator/SimulatorDeviceManager";
import { ActionRouter } from "./ActionRouter";
import { DeviceService } from "./DeviceService";
import { DeviceSyncService } from "./DeviceSyncService";
import { GloveStateService } from "./GloveStateService";
import { KasaDeviceManager } from "../managers/kasa/KasaDeviceManager";
import { ManagerService } from "./ManagerService";
import { MappingService } from "./MappingService";
import { SceneService } from "./SceneService";

export interface GesturaServices {
  registry: DeviceRegistry;
  managerService: ManagerService;
  deviceService: DeviceService;
  deviceSyncService: DeviceSyncService;
  mappingService: MappingService;
  actionRouter: ActionRouter;
  sceneService: SceneService;
  gloveStateService: GloveStateService;
}

export function createServices(): GesturaServices {
  const registry = new DeviceRegistry();
  const managerService = new ManagerService();
  const mappingService = new MappingService();
  const actionRouter = new ActionRouter(managerService, registry);
  const deviceService = new DeviceService(managerService, registry);
  const deviceSyncService = new DeviceSyncService(managerService, registry);
  const sceneService = new SceneService(actionRouter);
  const gloveStateService = new GloveStateService(mappingService, actionRouter);

  managerService.register("kasa-main", new KasaDeviceManager("kasa-main"));

  const simulatorUrl = process.env.SIM_MANAGER_URL;
  if (simulatorUrl) {
    managerService.register(
      "sim-manager-1",
      new SimulatorDeviceManager(
        "sim-manager-1",
        new SimulatorClient(simulatorUrl, process.env.SIM_MANAGER_TOKEN),
      ),
    );
  }

  return {
    registry,
    managerService,
    deviceService,
    deviceSyncService,
    mappingService,
    actionRouter,
    sceneService,
    gloveStateService,
  };
}
