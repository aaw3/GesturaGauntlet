const express = require('express');

function createGlovesRouter({ gloveConfigService }) {
  const router = express.Router();

  router.get('/:gloveId/config', (req, res) => {
    res.json(gloveConfigService.getConfigSnapshot(req.params.gloveId));
  });

  router.get('/:gloveId/endpoints', (_req, res) => {
    res.json(gloveConfigService.getEndpointMetadata());
  });

  router.get('/:gloveId/wifi-networks', (req, res) => {
    res.json(gloveConfigService.listWifiNetworks(req.params.gloveId));
  });

  router.post('/:gloveId/wifi-networks', (req, res) => {
    try {
      res.json(gloveConfigService.upsertWifiNetwork(req.params.gloveId, req.body));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/:gloveId/wifi-networks/:id', (req, res) => {
    res.json({ ok: gloveConfigService.removeWifiNetwork(req.params.gloveId, req.params.id) });
  });

  router.post('/:gloveId/route-state', (req, res) => {
    if (!req.body?.managerId) {
      res.status(400).json({ error: 'managerId is required' });
      return;
    }
    res.json(gloveConfigService.upsertRouteState(req.body));
  });

  router.post('/:gloveId/passive-metrics', async (req, res) => {
    res.json(await gloveConfigService.ingestPassiveMetrics(req.params.gloveId, req.body?.metrics || []));
  });

  return router;
}

module.exports = { createGlovesRouter };
