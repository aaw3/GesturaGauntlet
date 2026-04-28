const { clone } = require('../utils');

class ManagerService {
  constructor({ persistence, nodeRegistry } = {}) {
    this.managers = new Map();
    this.persistence = persistence;
    this.nodeRegistry = nodeRegistry;
  }

  async register(manager, config = {}) {

    const info = normalizeManagerInfo(manager.getInfo(), config);
    const wrappedManager = withNormalizedInfo(manager, config);
    this.managers.set(info.id, wrappedManager);
    this.nodeRegistry?.attachManager?.(info.nodeId, info.id);
    await this.persistence?.upsertManagerConfig?.({
      info,
      baseUrl: config.baseUrl,
      authToken: config.authToken,
      config,
    });
    return clone(info);
  }

  async registerSnapshot(info) {
    const normalized = normalizeManagerInfo({ ...info, online: false }, { nodeId: info.nodeId });
    const manager = {
      getInfo() {
        return normalized;
      },
      updateInfo(updates) {
        Object.assign(normalized, updates);
        normalized.metadata = {
          ...(normalized.metadata || {}),
          ...(updates.metadata || {}),
        };
      },
      async listDevices() {
        return [];
      },
      async getDeviceState() {
        return null;
      },
      async executeAction(action) {
        return {
          ok: false,
          deviceId: action.deviceId,
          capabilityId: action.capabilityId,
          message: `Manager ${normalized.id} is not connected to a node-agent`,
        };
      },
    };
    this.managers.set(normalized.id, manager);
    this.nodeRegistry?.attachManager?.(normalized.nodeId, normalized.id);
    return clone(normalized);
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

  updateStatus(managerId, updates = {}) {
    const manager = this.managers.get(managerId);
    if (!manager) return null;
    if (typeof manager.updateInfo === 'function') {
      manager.updateInfo(updates);
      return clone(manager.getInfo());
    }

    const current = manager.getInfo();
    manager.getInfo = () => normalizeManagerInfo({ ...current, ...updates }, { nodeId: current.nodeId });
    return clone(manager.getInfo());
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

function normalizeManagerInfo(info, config = {}) {
  const nodeId = info.nodeId || config.nodeId;
  if (!nodeId) {
    throw new Error(`Manager ${info.id || '<unknown>'} is missing nodeId; managers must be owned by a node-agent.`);
  }
  const displayName = info.metadata?.name || info.name || info.id;
  const interfaces = normalizeInterfaces(info, config);

  return {
    ...info,
    nodeId,
    kind: String(info.kind || config.kind || 'custom'),
    interfaces,
    metadata: {
      name: displayName,
      description: info.metadata?.description || defaultManagerDescription(info, config),
      iconKey: info.metadata?.iconKey || defaultIconKey(info.kind),
      colorKey: info.metadata?.colorKey || defaultColorKey(info.kind),
      ...(isPlainObject(info.metadata) ? info.metadata : {}),
    },
  };
}

function withNormalizedInfo(manager, config) {
  if (manager.__gesturaNormalizedInfo) return manager;
  const getInfo = manager.getInfo.bind(manager);
  manager.getInfo = () => normalizeManagerInfo(getInfo(), config);
  manager.__gesturaNormalizedInfo = true;
  return manager;
}

function normalizeInterfaces(info, config = {}) {
  const interfaces = Array.isArray(info.interfaces) ? info.interfaces : [];
  const configured = Array.isArray(config.interfaces) ? config.interfaces : [];
  const baseUrl = info.baseUrl || config.baseUrl;
  const merged = [...interfaces, ...configured];

  if (baseUrl && !merged.some((item) => item.kind === 'public' && item.url === baseUrl)) {
    merged.push({ kind: 'public', url: baseUrl, priority: 20 });
  }

  if (config.lanUrl && !merged.some((item) => item.kind === 'lan' && item.url === config.lanUrl)) {
    merged.push({ kind: 'lan', url: config.lanUrl, priority: 10 });
  }

  return merged
    .filter((item) => (item.kind === 'lan' || item.kind === 'public') && item.url)
    .sort((left, right) => (left.priority ?? 100) - (right.priority ?? 100));
}

function defaultManagerDescription(info, config) {
  if (config.description) return config.description;
  if (info.kind === 'kasa') return 'TP-Link Kasa bulbs and plugs hosted by a node agent.';
  if (info.kind === 'simulator') return 'Simulator devices exposed through the manager contract.';
  return 'Device manager registered with the central server.';
}

function defaultIconKey(kind) {
  if (kind === 'kasa') return 'lightbulb';
  if (kind === 'simulator') return 'cpu';
  return 'server';
}

function defaultColorKey(kind) {
  if (kind === 'kasa') return 'amber';
  if (kind === 'simulator') return 'cyan';
  return 'slate';
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

module.exports = { ManagerService, normalizeManagerInfo };
