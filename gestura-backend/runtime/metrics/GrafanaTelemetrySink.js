class GrafanaTelemetrySink {
  constructor({
    url = process.env.GRAFANA_URL,
    apiKey = process.env.GRAFANA_API_KEY,
    orgId = process.env.GRAFANA_ORG_ID,
  } = {}) {
    this.url = url;
    this.apiKey = apiKey;
    this.orgId = orgId;
    this.enabled = Boolean(url && apiKey);
    this.lastError = null;
    this.lastSuccessAt = null;
  }

  async publishBatch(events = []) {
    if (!this.enabled || events.length === 0) return { enabled: false, sent: 0 };

    const endpoint = `${this.url.replace(/\/$/, '')}/api/annotations`;
    let sent = 0;
    for (const event of events) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...(this.orgId ? { 'X-Grafana-Org-Id': this.orgId } : {}),
        },
        body: JSON.stringify({
          time: event.ts || Date.now(),
          tags: ['gestura', event.eventType || event.type || 'telemetry'],
          text: JSON.stringify(event),
        }),
      });
      if (!response.ok) {
        throw new Error(`Grafana annotation upload failed with ${response.status}`);
      }
      sent += 1;
    }
    this.lastError = null;
    this.lastSuccessAt = new Date().toISOString();
    return { enabled: true, sent };
  }
}

module.exports = { GrafanaTelemetrySink };
