const express = require('express');

function createRouteMetricsRouter({ routeMetricsService }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(
      routeMetricsService.list({
        managerId: req.query.managerId,
        deviceId: req.query.deviceId,
      })
    );
  });

  router.post('/', async (req, res) => {
    res.status(201).json(await routeMetricsService.record(req.body || {}));
  });

  return router;
}

module.exports = { createRouteMetricsRouter };
