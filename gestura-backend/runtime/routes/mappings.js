const express = require('express');

function createMappingsRouter({ mappingService, telemetryService }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(mappingService.list(req.query.gloveId));
  });

  router.post('/', async (req, res) => {
    try {
      const mapping = await mappingService.upsert(req.body);
      await recordMappingChanged(telemetryService, 'upsert', mapping);
      broadcastMappings(req.app?.locals?.statusSocketHub, mappingService);
      res.status(201).json(mapping);
    } catch (err) {
      sendMappingError(res, err);
    }
  });

  router.put('/devices/:deviceId', async (req, res) => {
    try {
      const mappings = await mappingService.replaceForDevice(req.params.deviceId, req.body ?? []);
      await recordMappingChanged(telemetryService, 'replace_for_device', {
        deviceId: req.params.deviceId,
        mappingCount: mappings.length,
      });
      broadcastMappings(req.app?.locals?.statusSocketHub, mappingService);
      res.json(mappings);
    } catch (err) {
      sendMappingError(res, err);
    }
  });

  router.delete('/:mappingId', async (req, res) => {
    const ok = await mappingService.remove(req.params.mappingId);
    await recordMappingChanged(telemetryService, 'delete', { mappingId: req.params.mappingId, ok });
    broadcastMappings(req.app?.locals?.statusSocketHub, mappingService);
    res.json({ ok });
  });

  router.put('/:mappingId', async (req, res) => {
    try {
      const mapping = await mappingService.upsert({
        ...req.body,
        id: req.params.mappingId,
      });
      await recordMappingChanged(telemetryService, 'upsert', mapping);
      broadcastMappings(req.app?.locals?.statusSocketHub, mappingService);
      res.json(mapping);
    } catch (err) {
      sendMappingError(res, err);
    }
  });

  return router;
}

module.exports = { createMappingsRouter };

function recordMappingChanged(telemetryService, operation, payload) {
  return telemetryService?.ingestBatch?.([
    {
      eventType: 'mapping_changed',
      payload: { operation, ...payload },
    },
  ]);
}

function broadcastMappings(statusSocketHub, mappingService) {
  statusSocketHub?.broadcast('manager.registry', {
    mappings: mappingService.list(),
  });
}

function sendMappingError(res, err) {
  const status = err.status || (err.code === '23505' ? 409 : 500);
  res.status(status).json({
    ok: false,
    error: err.message || 'Failed to save mapping',
    code: err.code || 'MAPPING_SAVE_FAILED',
  });
}
