const express = require('express');

function createTelemetryRouter({ telemetryService }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(
      telemetryService.list({
        nodeId: req.query.nodeId,
        managerId: req.query.managerId,
        eventType: req.query.eventType,
      }),
    );
  });

  router.post('/batch', async (req, res) => {
    res.status(202).json(await telemetryService.ingestBatch(req.body?.events || []));
  });

  return router;
}

module.exports = { createTelemetryRouter };
