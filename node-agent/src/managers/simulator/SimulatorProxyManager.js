const { createExternalManager } = require('../../../../gestura-backend/runtime/managers/externalManager');

function createSimulatorProxyManager({ id = 'sim-local', name = 'Local Simulator', baseUrl, authToken }) {
  return createExternalManager({
    baseUrl,
    authToken,
    info: {
      id,
      name,
      kind: 'simulator',
      version: '1.0.0',
      online: true,
      supportsDiscovery: false,
      supportsBulkActions: true,
      integrationType: 'node',
      interfaces: [
        { kind: 'lan', url: baseUrl, priority: 10 },
        { kind: 'public', url: baseUrl, priority: 20 },
      ],
      metadata: {
        name,
        description: 'Simulator manager hosted by a node agent.',
        iconKey: 'cpu',
        colorKey: 'cyan',
      },
    },
  });
}

module.exports = { createSimulatorProxyManager };
