const express = require('express');

function createManagersRouter({ managerService, deviceRegistry, deviceSyncService }) {
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

    if (typeof manager.discover === 'function') {
      await manager.discover();
    }

    res.json(await deviceSyncService.syncManager(req.params.managerId));
  });

  return router;
}

module.exports = { createManagersRouter };
