const express = require('express');

function createManagersRouter({ managerService, deviceRegistry, deviceSyncService, mappingService, telemetryService }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(managerService.getInfos());
  });

  // router.post('/kasa', async (req, res) => {
  //   res.status(410).json({
  //     error: 'Kasa managers now run as standalone manager services and attach to node-agent over websocket.',
  //     expectedFlow: 'Start kasa-manager with NODE_AGENT_WS_URL and MANAGER_* env vars.',
  //   });
  // });

  // router.post('/external', async (req, res) => {
  //   res.status(410).json({
  //     error: 'HTTP external managers are deprecated. Managers must attach to node-agent over websocket.',
  //     expectedFlow: 'Start a manager process with NODE_AGENT_WS_URL and MANAGER_* env vars.',
  //   });
  // });

  router.delete('/:managerId', async (req, res) => {
    const removed = await managerService.unregister(req.params.managerId);
    if (!removed) {
      res.status(404).json({ error: 'Manager not found' });
      return;
    }

    await deviceRegistry.clearManagerDevices(req.params.managerId);
    res.json({ ok: true, managerId: req.params.managerId });
  });

  router.get('/devices', async (_req, res) => {
    res.json(await managerService.listManagerDevices());
  });

  router.post('/:managerId/sync', async (req, res) => {
    res.json(await deviceSyncService.syncManager(req.params.managerId));
  });

  router.post('/:managerId/discover', async (req, res) => {
    const manager = managerService.get(req.params.managerId);
    if (!manager) {
      res.status(404).json({ error: 'Manager not found' });
      return;
    }

    await telemetryService?.ingestBatch?.([
      {
        eventType: 'discovery_started',
        managerId: req.params.managerId,
        payload: { managerId: req.params.managerId, source: 'api' },
      },
    ]);

    let discoverResult = null;
    if (typeof manager.discover === 'function') {
      discoverResult = await manager.discover();
    }

    const sync = await deviceSyncService.syncManager(req.params.managerId);
    await telemetryService?.ingestBatch?.([
      {
        eventType: sync.errors?.length ? 'discovery_failed' : 'discovery_completed',
        managerId: req.params.managerId,
        payload: { managerId: req.params.managerId, discoverResult, sync },
      },
    ]);

    res.json(sync);
  });

  router.post('/:managerId/clear-storage', async (req, res) => {
    const manager = managerService.get(req.params.managerId);
    if (!manager) {
      res.status(404).json({ error: 'Manager not found' });
      return;
    }

    const existingDevices = deviceRegistry.getByManager(req.params.managerId);

    for (const device of existingDevices) {
      await mappingService?.replaceForDevice?.(device.id, []);
    }

    await deviceRegistry.clearManagerDevices(req.params.managerId);

    let clearResult = null;
    if (typeof manager.clearStorage === 'function') {
      clearResult = await manager.clearStorage();
    }

    await telemetryService?.ingestBatch?.([
      {
        eventType: 'storage_cleared',
        managerId: req.params.managerId,
        payload: {
          managerId: req.params.managerId,
          clearedDeviceCount: existingDevices.length,
          clearResult,
        },
      },
    ]);

    res.json({
      ok: true,
      managerId: req.params.managerId,
      clearedDeviceCount: existingDevices.length,
      clearResult,
      devices: [],
    });
  });

  return router;
}

module.exports = { createManagersRouter };
