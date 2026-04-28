const { clone } = require('../utils');

class SceneService {
  constructor(actionRouter, { persistence } = {}) {
    this.actionRouter = actionRouter;
    this.persistence = persistence;
    this.scenes = new Map();
  }

  async loadPersisted() {
    const scenes = await this.persistence?.listScenes?.();
    for (const scene of scenes || []) {
      this.scenes.set(scene.id, clone(scene));
    }
  }

  list() {
    return Array.from(this.scenes.values()).map(clone);
  }

  async upsert(scene) {
    this.scenes.set(scene.id, clone(scene));
    await this.persistence?.upsertScene?.(scene);
    return clone(scene);
  }

  async run(sceneId) {
    const scene = this.scenes.get(sceneId);
    if (!scene) {
      return [
        {
          ok: false,
          deviceId: sceneId,
          capabilityId: 'run',
          message: 'Scene not found',
        },
      ];
    }

    return Promise.all(scene.actions.map((action) => this.actionRouter.execute(action)));
  }
}

module.exports = { SceneService };
