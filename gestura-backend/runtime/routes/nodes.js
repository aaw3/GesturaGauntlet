const express = require('express');

function createNodesRouter({ nodeRegistry, managerService }) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    const managers = managerService.getInfos();
    res.json(
      nodeRegistry.getAll().map((node) => ({
        ...node,
        hostedManagerCount: managers.filter((manager) => manager.nodeId === node.id).length,
      }))
    );
  });

  router.get('/:nodeId', (req, res) => {
    const node = nodeRegistry.get(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    res.json(node);
  });

  return router;
}

module.exports = { createNodesRouter };
