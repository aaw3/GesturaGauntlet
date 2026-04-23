const { clone } = require('../utils');

class NodeRegistry {
  constructor({ persistence } = {}) {
    this.nodes = new Map();
    this.persistence = persistence;
  }

  upsert(node) {
    const existing = this.nodes.get(node.id) || {};
    const next = {
      ...existing,
      ...node,
      online: node.online ?? existing.online ?? true,
      lastHeartbeatAt: node.lastHeartbeatAt ?? new Date().toISOString(),
      managerIds: Array.from(new Set(node.managerIds || existing.managerIds || [])),
    };
    this.nodes.set(node.id, next);
    void this.persistence?.upsertNode?.(next).catch((err) => {
      console.error(`[NodeRegistry] Failed to persist node ${node.id}: ${err.message}`);
    });
    return clone(next);
  }

  markHeartbeat(nodeId) {
    const existing = this.nodes.get(nodeId);
    if (!existing) return null;
    return this.upsert({ ...existing, online: true, lastHeartbeatAt: new Date().toISOString() });
  }

  attachManager(nodeId, managerId) {
    const existing = this.nodes.get(nodeId);
    if (!existing) return null;
    return this.upsert({
      ...existing,
      managerIds: Array.from(new Set([...(existing.managerIds || []), managerId])),
    });
  }

  markOffline(nodeId) {
    const existing = this.nodes.get(nodeId);
    if (!existing) return null;
    this.nodes.set(nodeId, { ...existing, online: false });
    return clone(this.nodes.get(nodeId));
  }

  get(nodeId) {
    const node = this.nodes.get(nodeId);
    return node ? clone(node) : null;
  }

  getAll() {
    return Array.from(this.nodes.values()).map(clone);
  }
}

module.exports = { NodeRegistry };
