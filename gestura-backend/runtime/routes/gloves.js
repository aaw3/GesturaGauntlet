const express = require('express');

function createGlovesRouter({ gloveConfigService, actionRouter, statusSocketHub, nodeSocketNamespace }) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    res.json(gloveConfigService.listGloves());
  });

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
      const network = gloveConfigService.upsertWifiNetwork(req.params.gloveId, req.body);
      broadcastConfigUpdate({
        gloveId: req.params.gloveId,
        reason: 'wifi_network_changed',
        gloveConfigService,
        nodeSocketNamespace,
        statusSocketHub,
      });
      res.json(network);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/:gloveId/wifi-networks/:id', (req, res) => {
    const ok = gloveConfigService.removeWifiNetwork(req.params.gloveId, req.params.id);
    if (ok) {
      broadcastConfigUpdate({
        gloveId: req.params.gloveId,
        reason: 'wifi_network_removed',
        gloveConfigService,
        nodeSocketNamespace,
        statusSocketHub,
      });
    }
    res.json({ ok });
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

  router.post('/:gloveId/actions/:deviceId/:capabilityId', async (req, res) => {
    const action = {
      ...(req.body?.action || req.body || {}),
      deviceId: req.params.deviceId,
      capabilityId: req.params.capabilityId,
    };
    const actionId = req.body?.actionId;

    if (shouldAckImmediately(req)) {
      res.status(202).json({
        ok: true,
        accepted: true,
        gloveId: req.params.gloveId,
        actionId,
        mappingId: action.mappingId,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
      });
      void executeAndBroadcastAction({
        actionRouter,
        statusSocketHub,
        gloveId: req.params.gloveId,
        actionId,
        action,
      }).catch((err) => {
        logHttpActionFailure({
          gloveId: req.params.gloveId,
          actionId,
          action,
          result: {
            managerId: err.managerId,
            targetUrl: err.targetUrl,
            deviceId: err.deviceId,
            capabilityId: err.capabilityId,
            upstreamStatus: err.status,
            upstreamError: err.message,
          },
        });
      });
      return;
    }

    try {
      const result = await executeAndBroadcastAction({
        actionRouter,
        statusSocketHub,
        gloveId: req.params.gloveId,
        actionId,
        action,
      });
      res.status(result?.ok === false ? 502 : 200).json({
        ok: Boolean(result?.ok),
        gloveId: req.params.gloveId,
        actionId,
        mappingId: action.mappingId,
        error: result?.ok === false ? compactError(result) : undefined,
        result,
      });
    } catch (err) {
      logHttpActionFailure({
        gloveId: req.params.gloveId,
        actionId,
        action,
        result: {
          managerId: err.managerId,
          targetUrl: err.targetUrl,
          deviceId: err.deviceId,
          capabilityId: err.capabilityId,
          upstreamStatus: err.status,
          upstreamError: err.message,
        },
      });
      res.status(err.status || 502).json({
        ok: false,
        gloveId: req.params.gloveId,
        actionId,
        error: {
          message: err.message || 'Action failed',
          managerId: err.managerId,
          targetUrl: err.targetUrl,
          deviceId: err.deviceId || action.deviceId,
          capabilityId: err.capabilityId || action.capabilityId,
          upstreamStatus: err.status,
          upstreamError: err.message,
        },
        code: err.code || 'ACTION_FAILED',
      });
    }
  });

  return router;
}

module.exports = { createGlovesRouter };

async function executeAndBroadcastAction({ actionRouter, statusSocketHub, gloveId, actionId, action }) {
  const result = await actionRouter.execute(action);
  if (result?.ok === false) {
    logHttpActionFailure({
      gloveId,
      actionId,
      action,
      result,
    });
  }
  statusSocketHub?.broadcast?.('device.state', {
    source: 'glove-http',
    gloveId,
    actionId,
    mappingId: action.mappingId,
    deviceId: result?.deviceId || action.deviceId,
    capabilityId: result?.capabilityId || action.capabilityId,
    result,
  });
  return result;
}

function broadcastConfigUpdate({ gloveId, reason, gloveConfigService, nodeSocketNamespace, statusSocketHub }) {
  const config = gloveConfigService.getConfigSnapshot(gloveId);
  nodeSocketNamespace?.emit?.('glove:configUpdated', {
    type: 'config_snapshot',
    gloveId,
    reason,
    ts: Date.now(),
    config,
  });
  statusSocketHub?.broadcast?.('glove.config', {
    gloveId,
    reason,
    configHash: config.configHash,
    endpointHash: config.endpoints?.hash,
    wifiNetworkCount: Array.isArray(config.wifiNetworks) ? config.wifiNetworks.length : 0,
  });
}

function compactError(result = {}) {
  return {
    message: result.message || result.error || result.upstreamError || 'Action failed',
    managerId: result.managerId || null,
    targetUrl: redactUrl(result.targetUrl) || null,
    deviceId: result.deviceId,
    capabilityId: result.capabilityId,
    upstreamStatus: result.upstreamStatus,
    upstreamError: result.upstreamError || result.error || result.message,
  };
}

function redactUrl(url) {
  return String(url || '').replace(/([?&](?:api_key|token)=)[^&]+/gi, '$1<redacted>');
}

function logHttpActionFailure({ gloveId, actionId, action, result = {} }) {
  const details = compactError({
    ...result,
    deviceId: result.deviceId || action.deviceId,
    capabilityId: result.capabilityId || action.capabilityId,
  });
  console.warn('[Server] glove HTTP action failed', {
    gloveId,
    actionId,
    mappingId: action.mappingId,
    ...details,
  });
}

function shouldAckImmediately(req) {
  return req.query?.async === '1' || req.query?.async === 'true' || req.get('x-gestura-async') === 'true';
}
