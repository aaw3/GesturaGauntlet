const { randomUUID } = require('crypto');
const { clone } = require('../utils');

class TelemetryService {
  constructor({ persistence, telemetrySink, maxBuffered = 1000 } = {}) {
    this.persistence = persistence;
    this.telemetrySink = telemetrySink;
    this.maxBuffered = maxBuffered;
    this.events = [];
  }

  async ingestBatch(events = []) {
    const normalized = (Array.isArray(events) ? events : []).map((event) => normalizeTelemetryEvent(event));
    if (normalized.length === 0) return { ok: true, accepted: 0 };

    this.events.push(...normalized);
    if (this.events.length > this.maxBuffered) {
      this.events.splice(0, this.events.length - this.maxBuffered);
    }

    await this.persistence?.saveTelemetryEvents?.(normalized);
    for (const event of normalized) {
      if (event.eventType === 'route_attempt') {
        await this.persistence?.saveRouteAttemptMetric?.({
          id: event.id,
          ts: event.ts,
          ...(event.payload || {}),
          nodeId: event.nodeId || event.payload?.nodeId,
          managerId: event.managerId || event.payload?.managerId,
        });
      }
    }

    try {
      await this.telemetrySink?.publishBatch?.(normalized);
    } catch (err) {
      if (this.telemetrySink) this.telemetrySink.lastError = err.message;
      console.error(`[Telemetry] External telemetry upload failed: ${err.message}`);
    }

    return { ok: true, accepted: normalized.length };
  }

  list({ nodeId, managerId, eventType } = {}) {
    return this.events
      .filter((event) => !nodeId || event.nodeId === nodeId)
      .filter((event) => !managerId || event.managerId === managerId)
      .filter((event) => !eventType || event.eventType === eventType)
      .map(clone);
  }
}

function normalizeTelemetryEvent(event = {}) {
  return {
    id: event.id || randomUUID(),
    ts: event.ts || event.timestamp || Date.now(),
    nodeId: event.nodeId,
    managerId: event.managerId,
    eventType: event.eventType || event.type || 'telemetry',
    payload: event.payload || event,
  };
}

module.exports = { TelemetryService, normalizeTelemetryEvent };
