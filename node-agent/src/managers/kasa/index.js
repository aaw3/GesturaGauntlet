const { createKasaManager } = require('../../../../kasa-manager/src/KasaManager');

function createKasaNodeManager(options = {}) {
  return createKasaManager({
    id: options.id || 'kasa-main',
    name: options.name || 'Kasa Main',
    discoveryTimeoutMs: options.discoveryTimeoutMs,
    scanIntervalMs: options.scanIntervalMs,
  });
}

module.exports = { createKasaNodeManager };
