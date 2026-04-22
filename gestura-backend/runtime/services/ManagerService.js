const { clone } = require('../utils');

class ManagerService {
  constructor({ persistence } = {}) {
    this.managers = new Map();
    this.persistence = persistence;
  }

  async register(manager, config = {}) {
    const info = manager.getInfo();
    this.managers.set(info.id, manager);
    await this.persistence?.upsertManagerConfig?.({
      info,
      baseUrl: config.baseUrl,
      authToken: config.authToken,
      config,
    });
    return clone(info);
  }

  async unregister(managerId) {
    const manager = this.managers.get(managerId);
    const removed = this.managers.delete(managerId);
    if (removed && typeof manager?.shutdown === 'function') {
      void manager.shutdown().catch((err) => {
        console.error(`[ManagerService] Manager shutdown failed: ${err.message}`);
      });
    }
    if (removed) {
      await this.persistence?.deleteManagerConfig?.(managerId);
    }
    return removed;
  }

  get(managerId) {
    return this.managers.get(managerId) ?? null;
  }

  getAll() {
    return Array.from(this.managers.entries()).map(([id, manager]) => ({ id, manager }));
  }

  getInfos() {
    return this.getAll().map(({ manager }) => clone(manager.getInfo()));
  }

  async listManagerDevices() {
    return Promise.all(
      this.getAll().map(async ({ manager }) => ({
        manager: clone(manager.getInfo()),
        devices: await manager.listDevices(),
      }))
    );
  }
}

module.exports = { ManagerService };
