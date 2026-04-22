const { clone } = require('../utils');

class MappingService {
  constructor({ persistence } = {}) {
    this.mappings = new Map();
    this.persistence = persistence;
  }

  async loadPersisted() {
    const mappings = await this.persistence?.listMappings?.();
    for (const mapping of mappings || []) {
      this.mappings.set(mapping.id, clone(mapping));
    }
  }

  list(gloveId) {
    const all = Array.from(this.mappings.values()).map(clone);
    return gloveId ? all.filter((mapping) => mapping.gloveId === gloveId) : all;
  }

  get(id) {
    const mapping = this.mappings.get(id);
    return mapping ? clone(mapping) : null;
  }

  async upsert(mapping) {
    this.mappings.set(mapping.id, clone(mapping));
    await this.persistence?.upsertMapping?.(mapping);
    return clone(mapping);
  }

  async replaceForDevice(deviceId, mappings = []) {
    for (const mapping of this.list()) {
      if (mapping.targetDeviceId === deviceId) {
        this.mappings.delete(mapping.id);
      }
    }

    for (const mapping of mappings) {
      this.mappings.set(mapping.id, clone(mapping));
    }

    await this.persistence?.replaceMappingsForDevice?.(deviceId, mappings);
    return this.list().filter((mapping) => mapping.targetDeviceId === deviceId);
  }

  async remove(id) {
    const removed = this.mappings.delete(id);
    if (removed) await this.persistence?.deleteMapping?.(id);
    return removed;
  }

  findForInput(gloveId, inputSource) {
    return this.list(gloveId).filter(
      (mapping) => mapping.enabled && mapping.inputSource === inputSource,
    );
  }
}

module.exports = { MappingService };
