const { randomUUID } = require('crypto');
const { clone } = require('../utils');

class RouteMetricsService {
  constructor({ maxMetrics = 500, persistence, telemetryService } = {}) {
    this.maxMetrics = maxMetrics;
    this.persistence = persistence;
    this.telemetryService = telemetryService;
    this.metrics = [];
  }

  async record(metric) {
    const next = {
      id: metric.id || randomUUID(),
      ts: metric.ts || Date.now(),
      ...metric,
    };
    this.remember(next);
    await this.persistence?.saveRouteAttemptMetric?.(next);
    await this.telemetryService?.ingestBatch?.([
      {
        id: next.id,
        ts: next.ts,
        nodeId: next.nodeId,
        managerId: next.managerId,
        eventType: 'route_attempt',
        payload: next,
      },
    ]);
    return clone(next);
  }

  remember(metric) {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.splice(0, this.metrics.length - this.maxMetrics);
    }
    return clone(metric);
  }

  list({ managerId, deviceId } = {}) {
    return this.metrics
      .filter((metric) => !managerId || metric.managerId === managerId)
      .filter((metric) => !deviceId || metric.deviceId === deviceId)
      .map(clone);
  }
}

module.exports = { RouteMetricsService };
