const express = require('express');

function createDevicesRouter({ managerService, deviceRegistry, actionRouter, nodeRegistry }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(withProvenance(deviceRegistry.getAll(req.query.managerId), managerService, nodeRegistry));
  });

  router.get('/:deviceId', (req, res) => {
    const device = deviceRegistry.getById(req.params.deviceId);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    res.json(withProvenance([device], managerService, nodeRegistry)[0]);
  });

  router.get('/:deviceId/state', async (req, res) => {
    const device = deviceRegistry.getById(req.params.deviceId);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const manager = managerService.get(device.managerId);
    if (!manager?.getDeviceState) {
      res.status(404).json({ error: 'Device state not available' });
      return;
    }

    try {
      const state = await manager.getDeviceState(req.params.deviceId);
      if (!state) {
        res.status(404).json({ error: 'Device state not found' });
        return;
      }
      res.json(state);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

router.post('/:deviceId/actions/:capabilityId', async (req, res) => {
  try {
    const result = await actionRouter.execute({
      ...req.body,
      deviceId: req.params.deviceId,
      capabilityId: req.params.capabilityId,
    });

    req.app?.locals?.statusSocketHub?.broadcast('device.state', {
      deviceId: req.params.deviceId,
      capabilityId: req.params.capabilityId,
      result,
    });
    res.status(result?.ok === false ? 502 : 200).json(result);
  } catch (err) {
    res.status(err.status || 502).json({
      ok: false,
      error: err.message || 'Action failed',
      code: err.code || 'ACTION_FAILED',
    });
  }
});

  return router;
}

function withProvenance(devices, managerService, nodeRegistry) {
  const managers = new Map(managerService.getInfos().map((manager) => [manager.id, manager]));
  return devices.map((device) => {
    const manager = managers.get(device.managerId);
    const node = manager?.nodeId ? nodeRegistry?.get(manager.nodeId) : null;
    return {
      ...device,
      provenance: {
        nodeId: manager?.nodeId || 'unknown',
        nodeName: node?.name,
        managerId: device.managerId,
        managerName: manager?.metadata?.name || manager?.name,
        managerKind: manager?.kind || device.source,
        managerIconKey: manager?.metadata?.iconKey,
        managerColorKey: manager?.metadata?.colorKey,
      },
      managerInterfaces: manager?.interfaces || [],
    };
  });
}

module.exports = { createDevicesRouter };
