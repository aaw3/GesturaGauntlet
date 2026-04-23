const express = require('express');

function createGlovesRouter({ gloveConfigService }) {
  const router = express.Router();

  router.get('/:gloveId/config', (req, res) => {
    res.json(gloveConfigService.getConfigSnapshot(req.params.gloveId));
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
