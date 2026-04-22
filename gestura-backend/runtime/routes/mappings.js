const express = require('express');

function createMappingsRouter({ mappingService }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(mappingService.list(req.query.gloveId));
  });

  router.post('/', async (req, res) => {
    res.status(201).json(await mappingService.upsert(req.body));
  });

  router.put('/devices/:deviceId', async (req, res) => {
    res.json(await mappingService.replaceForDevice(req.params.deviceId, req.body ?? []));
  });

  router.delete('/:mappingId', async (req, res) => {
    res.json({ ok: await mappingService.remove(req.params.mappingId) });
  });

  router.put('/:mappingId', async (req, res) => {
    res.json(
      await mappingService.upsert({
        ...req.body,
        id: req.params.mappingId,
      }),
    );
  });

  return router;
}

module.exports = { createMappingsRouter };
