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

  listForGloveOrAll(gloveId) {
    const exact = this.list(gloveId);
    return exact.length > 0 || !gloveId ? exact : this.list();
  }

  get(id) {
    const mapping = this.mappings.get(id);
    return mapping ? clone(mapping) : null;
  }

  async upsert(mapping) {
    const normalized = normalizeMapping(mapping);
    this.mappings.set(normalized.id, clone(normalized));
    await this.persistence?.upsertMapping?.(normalized);
    return clone(normalized);
  }

  async replaceForDevice(deviceId, mappings = []) {
    const normalizedMappings = normalizeReplacementMappings(deviceId, mappings);
    for (const mapping of this.list()) {
      if (mapping.targetDeviceId === deviceId) {
        this.mappings.delete(mapping.id);
      }
    }

    for (const mapping of normalizedMappings) {
      this.mappings.set(mapping.id, clone(mapping));
    }

    await this.persistence?.replaceMappingsForDevice?.(deviceId, normalizedMappings);
    return this.list().filter((mapping) => mapping.targetDeviceId === deviceId);
  }

  async remove(id) {
    const removed = this.mappings.delete(id);
    if (removed) await this.persistence?.deleteMapping?.(id);
    return removed;
  }

  findForInput(gloveId, inputSource) {
    return this.listForGloveOrAll(gloveId).filter(
      (mapping) => mapping.enabled && mapping.inputSource === inputSource,
    );
  }
}

function normalizeReplacementMappings(deviceId, mappings = []) {
  if (!Array.isArray(mappings)) {
    const err = new Error('Mapping replacement payload must be an array');
    err.status = 400;
    throw err;
  }

  const byId = new Map();
  for (const item of mappings) {
    const mapping = normalizeMapping({ ...item, targetDeviceId: deviceId });
    byId.set(mapping.id, mapping);
  }
  return Array.from(byId.values());
}

function normalizeMapping(mapping = {}) {
  const targetDeviceId = String(mapping.targetDeviceId || '').trim();
  const targetCapabilityId = String(mapping.targetCapabilityId || '').trim();
  const inputSource = String(mapping.inputSource || '').trim();
  const gloveId = String(mapping.gloveId || 'primary_glove').trim() || 'primary_glove';

  if (!targetDeviceId || !targetCapabilityId || !inputSource) {
    const err = new Error('Mapping requires targetDeviceId, targetCapabilityId, and inputSource');
    err.status = 400;
    throw err;
  }

  const id = String(mapping.id || `${targetDeviceId}.${targetCapabilityId}.${inputSource}`).trim();
  if (!id) {
    const err = new Error('Mapping id cannot be empty');
    err.status = 400;
    throw err;
  }

  return {
    ...mapping,
    id,
    gloveId,
    enabled: mapping.enabled !== false,
    inputSource,
    targetDeviceId,
    targetCapabilityId,
    mode: mapping.mode || 'toggle',
    transform: mapping.transform || {},
  };
}

module.exports = { MappingService, normalizeMapping, normalizeReplacementMappings };
