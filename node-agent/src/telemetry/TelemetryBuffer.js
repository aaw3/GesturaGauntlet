class TelemetryBuffer {
  constructor({ nodeId, flushIntervalMs = 5000, maxSize = 1000 } = {}) {
    this.nodeId = nodeId;
    this.flushIntervalMs = flushIntervalMs;
    this.maxSize = maxSize;
    this.events = [];
    this.flushTimer = null;
    this.sender = null;
  }

  start(sender) {
    this.sender = sender;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  stop() {
    if (this.flushTimer) clearInterval(this.flushTimer);
  }

  record(event) {
    this.events.push({
      id: event.id || `${this.nodeId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ts: event.ts || Date.now(),
      nodeId: event.nodeId || this.nodeId,
      ...event,
    });
    if (this.events.length > this.maxSize) {
      this.events.splice(0, this.events.length - this.maxSize);
    }
  }

  async flush() {
    if (!this.sender || this.events.length === 0) return { ok: true, sent: 0 };
    const batch = this.events.splice(0, this.events.length);
    try {
      await this.sender(batch);
      return { ok: true, sent: batch.length };
    } catch {
      this.events.unshift(...batch);
      if (this.events.length > this.maxSize) {
        this.events.splice(0, this.events.length - this.maxSize);
      }
      return { ok: false, sent: 0 };
    }
  }
}

module.exports = { TelemetryBuffer };
