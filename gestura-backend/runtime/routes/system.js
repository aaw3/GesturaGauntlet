const express = require('express');

function createSystemRouter({ systemStatus }) {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    res.json(systemStatus());
  });

  return router;
}

module.exports = { createSystemRouter };
