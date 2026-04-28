import { DeviceRegistry } from "../managers/base/DeviceRegistry";
import { ActionRouter } from "./ActionRouter";
import { DeviceService } from "./DeviceService";
import { DeviceSyncService } from "./DeviceSyncService";
import { GloveStateService } from "./GloveStateService";
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
