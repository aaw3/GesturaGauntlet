import { ID } from "../types/common";
import { DeviceActionRequest, DeviceActionResult } from "../types/api";
import { ActionRouter } from "./ActionRouter";

export interface SceneDefinition {
  id: ID;
  name: string;
  actions: DeviceActionRequest[];
}

export class SceneService {
  private scenes = new Map<ID, SceneDefinition>();

  constructor(private actionRouter: ActionRouter) {}

  list(): SceneDefinition[] {
    return Array.from(this.scenes.values());
  }

  upsert(scene: SceneDefinition): SceneDefinition {
    this.scenes.set(scene.id, scene);
    return scene;
  }

  async run(sceneId: ID): Promise<DeviceActionResult[]> {
    const scene = this.scenes.get(sceneId);
    if (!scene) {
      return [
        {
          ok: false,
          deviceId: sceneId,
          capabilityId: "run",
          message: "Scene not found",
        },
      ];
    }

    return Promise.all(scene.actions.map((action) => this.actionRouter.execute(action)));
  }
}
