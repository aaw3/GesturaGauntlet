const express = require('express');
const { createExternalManager, validateExternalManager } = require('../managers/externalManager');
const { createKasaManager } = require('../managers/kasaManager');

function createManagersRouter({ managerService, deviceRegistry, deviceSyncService }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(managerService.getInfos());
  });

  router.post('/kasa', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const id = String(req.body?.id || 'kasa-main').trim() || 'kasa-main';

    if (!name) {
      res.status(400).json({ error: 'Kasa manager name is required' });
      return;
    }

    const manager = createKasaManager({
      id,
      name,
      discoveryTimeoutMs: Number(req.body?.discoveryTimeoutMs || 3000),
      scanIntervalMs: Number(req.body?.scanIntervalMs || 5 * 60 * 1000),
    });

    const existing = managerService.get(id);
    if (existing) {
      await managerService.unregister(id);
      await deviceRegistry.clearManagerDevices(id);
    }

    await managerService.register(manager, {
      kind: 'kasa',
      integrationType: 'native',
      discoveryTimeoutMs: Number(req.body?.discoveryTimeoutMs || 3000),
      scanIntervalMs: Number(req.body?.scanIntervalMs || 5 * 60 * 1000),
    });
    const sync = await deviceSyncService.syncManager(id);
    manager.startAutoDiscovery(() => deviceSyncService.syncManager(id));

    res.status(201).json({ ...manager.getInfo(), sync });
  });

  router.post('/external', async (req, res) => {
    const validation = await validateExternalManager({
      name: req.body?.name,
      baseUrl: req.body?.baseUrl,
      authToken: req.body?.authToken,
    });

    if (!validation.ok || !validation.managerInfo) {
      res.status(400).json(validation);
      return;
    }

    const manager = createExternalManager({
      info: validation.managerInfo,
      baseUrl: req.body.baseUrl,
      authToken: req.body?.authToken,
    });
    await managerService.register(manager, {
      kind: validation.managerInfo.kind,
      integrationType: 'external',
      baseUrl: req.body.baseUrl,
      authToken: req.body?.authToken,
    });
    const sync = await deviceSyncService.syncManager(validation.managerInfo.id);

    res.status(201).json({
      ok: true,
      manager: manager.getInfo(),
      deviceCount: validation.deviceCount,
      sync,
    });
  });

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
