const { clone } = require('../utils');

const { randomUUID } = require('crypto');
const { createHash } = require('crypto');

class GloveConfigService {
  constructor({ mappingService, deviceRegistry, managerService, nodeRegistry, persistence, telemetryService }) {
    this.mappingService = mappingService;
    this.deviceRegistry = deviceRegistry;
    this.managerService = managerService;
    this.nodeRegistry = nodeRegistry;
    this.persistence = persistence;
    this.telemetryService = telemetryService;
    this.routeStates = new Map();
    this.passiveMetrics = [];
    this.wifiNetworks = new Map();
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
      endpoints: this.getEndpointMetadata(),
      wifiNetworks: this.listWifiNetworks(gloveId),
      routeStates: this.getRouteStates(),
      policy: {
        activeCommandBacklog: false,
        passiveMetricsBuffer: true,
        lanCooldownMs: 15_000,
      },
    };
  }

  async loadPersisted() {
    const payload = await this.persistence?.getAppConfiguration?.('glove_wifi_networks');
    for (const network of payload?.networks || []) {
      if (network?.id && network?.ssid) this.wifiNetworks.set(network.id, { ...network });
    }
  }

  getRouteStates() {
    return Array.from(this.routeStates.values()).map(clone);
  }

  getEndpointMetadata() {
    const nodes = this.nodeRegistry?.getAll?.() || [];
    const endpoints = {
      version: 1,
      generatedAt: new Date().toISOString(),
      nodes: nodes.map((node) => ({
        nodeId: node.id,
        name: node.name,
        online: node.online,
        lastHeartbeatAt: node.lastHeartbeatAt,
        interfaces: normalizeInterfaces(node.interfaces || []),
      })),
    };
    endpoints.hash = stableHash(endpoints.nodes);
    return endpoints;
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

  listWifiNetworks(gloveId) {
    return Array.from(this.wifiNetworks.values())
      .filter((network) => !gloveId || network.gloveId === gloveId)
      .map((network) => ({ ...network }));
  }

  upsertWifiNetwork(gloveId, input = {}) {
    const ssid = String(input.ssid || '').trim();
    if (!ssid) throw new Error('ssid is required');
    const network = {
      id: input.id || `${gloveId}:${ssid}`,
      gloveId,
      ssid,
      password: String(input.password || ''),
      updatedAt: new Date().toISOString(),
    };
    this.wifiNetworks.set(network.id, network);
    void this.persistWifiNetworks();
    return { ...network };
  }

  removeWifiNetwork(gloveId, idOrSsid) {
    const target = String(idOrSsid || '');
    for (const [id, network] of this.wifiNetworks.entries()) {
      if (network.gloveId === gloveId && (id === target || network.ssid === target)) {
        this.wifiNetworks.delete(id);
        void this.persistWifiNetworks();
        return true;
      }
    }
    return false;
  }

  async persistWifiNetworks() {
    await this.persistence?.setAppConfiguration?.('glove_wifi_networks', {
      networks: Array.from(this.wifiNetworks.values()),
    });
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

function normalizeInterfaces(interfaces = []) {
  const normalized = [];
  for (const item of interfaces) {
    if (!['lan', 'public'].includes(item.kind)) continue;
    for (const url of parseUrlList(item.urls || item.url)) {
      normalized.push({
        kind: item.kind,
        url,
        priority: Number(item.priority ?? (item.kind === 'lan' ? 10 : 50)),
        tls: String(url).startsWith('wss://') || String(url).startsWith('https://'),
      });
    }
  }
  return orderInterfaces(normalized);
}

function orderInterfaces(interfaces) {
  const lan = interfaces
    .filter((item) => item.kind === 'lan')
    .sort((left, right) => left.priority - right.priority)
    .map((item, index) => ({ ...item, priority: index + 10 }));
  const publicStart = lan.length ? lan[lan.length - 1].priority + 10 : 50;
  const pub = interfaces
    .filter((item) => item.kind === 'public')
    .sort((left, right) => left.priority - right.priority)
    .map((item, index) => ({ ...item, priority: publicStart + index }));
  return [...lan, ...pub];
}

function parseUrlList(value) {
  if (Array.isArray(value)) return value.map((url) => String(url).trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

module.exports = { GloveConfigService };
