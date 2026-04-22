const express = require('express');

function createScenesRouter({ sceneService }) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    res.json(sceneService.list());
  });

  router.post('/', async (req, res) => {
    res.status(201).json(await sceneService.upsert(req.body));
  });

  router.post('/:sceneId/run', async (req, res) => {
    res.json(await sceneService.run(req.params.sceneId));
  });

  return router;
}

module.exports = { createScenesRouter };
