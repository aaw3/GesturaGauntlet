const { clone } = require('../utils');

const { randomUUID } = require('crypto');

class GloveConfigService {
  constructor({ mappingService, deviceRegistry, managerService, persistence, telemetryService }) {
    this.mappingService = mappingService;
    this.deviceRegistry = deviceRegistry;
    this.managerService = managerService;
    this.persistence = persistence;
    this.telemetryService = telemetryService;
    this.routeStates = new Map();
    this.passiveMetrics = [];
  }

  getConfigSnapshot(gloveId) {
    const managers = this.managerService.getInfos();
    const managerById = new Map(managers.map((manager) => [manager.id, manager]));
    return {
      gloveId,
      ts: Date.now(),
      mappings: this.mappingService.list(gloveId).filter((mapping) => mapping.enabled !== false),
      devices: this.deviceRegistry.getAll().map((device) => ({
        ...device,
        provenance: provenanceForDevice(device, managerById),
      })),
      managers,
      routeStates: this.getRouteStates(),
      policy: {
        activeCommandBacklog: false,
        passiveMetricsBuffer: true,
        lanCooldownMs: 15_000,
      },
    };
  }

  getRouteStates() {
    return Array.from(this.routeStates.values()).map(clone);
  }

  upsertRouteState(state) {
    const next = { ...this.routeStates.get(state.managerId), ...state };
    this.routeStates.set(state.managerId, next);
    return clone(next);
  }

  async ingestPassiveMetrics(gloveId, metrics = []) {
    const payload = {
      id: randomUUID(),
      gloveId,
      metrics: Array.isArray(metrics) ? metrics : [],
      ts: Date.now(),
    };
    const accepted = Array.isArray(metrics) ? metrics.length : 0;
    for (const metric of payload.metrics) {
      this.passiveMetrics.push({ gloveId, ts: Date.now(), ...metric });
    }
    await this.persistence?.savePassiveMetricUpload?.(gloveId, payload);
    await this.telemetryService?.ingestBatch?.([
      {
        id: payload.id,
        ts: payload.ts,
        eventType: 'passive_metric_upload',
        payload,
      },
    ]);
    return { ok: true, accepted, clearClientBuffer: true };
  }
}

function provenanceForDevice(device, managerById) {
  const manager = managerById.get(device.managerId);
  return {
    nodeId: manager?.nodeId || 'central',
    managerId: device.managerId,
    managerName: manager?.metadata?.name || manager?.name,
    managerKind: manager?.kind || device.source,
    managerIconKey: manager?.metadata?.iconKey,
    managerColorKey: manager?.metadata?.colorKey,
  };
}

module.exports = { GloveConfigService };
