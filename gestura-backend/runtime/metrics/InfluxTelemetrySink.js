const ADMIN_EVENT_TYPES = new Set([
  'discovery_started',
  'discovery_completed',
  'discovery_failed',
  'storage_cleared',
  'mapping_changed',
  'mode_changed',
]);

class InfluxTelemetrySink {
  constructor({
    url = process.env.INFLUXDB_URL,
    token = process.env.INFLUXDB_TOKEN,
    org = process.env.INFLUXDB_ORG,
    bucket = process.env.INFLUXDB_BUCKET,
  } = {}) {
    this.url = url;
    this.token = token;
    this.org = org;
    this.bucket = bucket;
    this.enabled = Boolean(url && token && org && bucket);
    this.lastError = null;
    this.lastSuccessAt = null;
  }

  async publishBatch(events = []) {
    if (!this.enabled || events.length === 0) return { enabled: false, sent: 0 };

    const lines = events.flatMap((event) => eventToLines(event));
    if (lines.length === 0) return { enabled: true, sent: 0 };

    const endpoint = new URL('/api/v2/write', this.url.replace(/\/$/, ''));
    endpoint.searchParams.set('org', this.org);
    endpoint.searchParams.set('bucket', this.bucket);
    endpoint.searchParams.set('precision', 'ms');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.token}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: lines.join('\n'),
    });

    if (!response.ok) {
      throw new Error(`InfluxDB write failed with ${response.status}: ${await response.text()}`);
    }

    this.lastError = null;
    this.lastSuccessAt = new Date().toISOString();
    return { enabled: true, sent: lines.length };
  }
}

function eventToLines(event = {}) {
  const eventType = event.eventType || event.type || 'telemetry';
  const payload = event.payload || {};
  const ts = Number(event.ts || event.timestamp || Date.now());
  const baseTags = tagsFor({
    event_type: eventType,
    node_id: event.nodeId || payload.nodeId || payload.edge_node_id,
    manager_id: event.managerId || payload.managerId,
    glove_id: event.gloveId || payload.gloveId,
  });

  if (eventType === 'passive_metric_upload' && Array.isArray(payload.metrics)) {
    return payload.metrics.map((metric) =>
      line({
        measurement: 'gestura_glove_status',
        tags: tagsFor({ ...baseTags, glove_id: payload.gloveId }),
        fields: fieldsFor(metric, { value: 1 }),
        ts,
      }),
    );
  }

  if (eventType === 'route_attempt') {
    return [
      line({
        measurement: 'gestura_route_action',
        tags: tagsFor({
          ...baseTags,
          route_path: payload.route_path || toRoutePath(payload.routePath || payload.finalRoute || payload.attemptedRoute),
          edge_node_id: payload.edge_node_id || payload.nodeId || event.nodeId,
          target_device_id: payload.target_device_id || payload.deviceId,
        }),
        fields: fieldsFor({
          route_latency_ms: payload.route_latency_ms ?? payload.latencyMs,
          manager_latency_ms: payload.manager_latency_ms,
          action_success: payload.action_success ?? payload.success,
          fallback_used: payload.fallback_used ?? payload.finalRoute !== payload.attemptedRoute,
          failure_reason: payload.failure_reason || payload.error || payload.message,
        }),
        ts,
      }),
    ];
  }

  if (eventType === 'node_heartbeat' || eventType.startsWith('manager_')) {
    return [
      line({
        measurement: 'gestura_edge_inventory',
        tags: tagsFor({
          ...baseTags,
          edge_node_id: payload.edge_node_id || payload.nodeId || event.nodeId,
          manager_id: payload.managerId || event.managerId,
        }),
        fields: fieldsFor({
          edge_node_uptime_sec: payload.edge_node_uptime_sec || payload.uptimeSec,
          managers_connected_count: payload.managers_connected_count ?? payload.managerCount,
          connected_devices_count: payload.connected_devices_count ?? payload.deviceCount,
          devices_online: payload.devices_online,
          devices_offline: payload.devices_offline,
          manager_online: payload.manager_online ?? payload.online,
          event_count: 1,
        }),
        ts,
      }),
    ];
  }

  if (ADMIN_EVENT_TYPES.has(eventType)) {
    return [
      line({
        measurement: 'gestura_admin_event',
        tags: baseTags,
        fields: fieldsFor(payload, { event_count: 1 }),
        ts,
      }),
    ];
  }

  return [
    line({
      measurement: eventType === 'glove_status' ? 'gestura_glove_status' : 'gestura_events',
      tags: baseTags,
      fields: fieldsFor(payload, { event_count: 1 }),
      ts,
    }),
  ];
}

function line({ measurement, tags, fields, ts }) {
  const tagText = Object.entries(tags)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${escapeKey(key)}=${escapeKey(String(value))}`)
    .join(',');
  const fieldText = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${escapeKey(key)}=${fieldValue(value)}`)
    .join(',');
  return `${escapeKey(measurement)}${tagText ? `,${tagText}` : ''} ${fieldText || 'event_count=1i'} ${ts}`;
}

function tagsFor(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'),
  );
}

function fieldsFor(value = {}, fallback = {}) {
  const fields = {};
  for (const [key, item] of Object.entries({ ...fallback, ...value })) {
    if (item === undefined || item === null || Array.isArray(item) || typeof item === 'object') continue;
    if (typeof item === 'number' && !Number.isFinite(item)) continue;
    fields[key] = item;
  }
  return fields;
}

function fieldValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? `${value}i` : String(value);
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function escapeKey(value) {
  return String(value).replace(/,/g, '\\,').replace(/ /g, '\\ ').replace(/=/g, '\\=');
}

function toRoutePath(route) {
  if (route === 'lan' || route === 'edge' || route === 'local') return 'local_edge';
  if (route === 'public' || route === 'central') return 'central_server';
  return route;
}

module.exports = { InfluxTelemetrySink, eventToLines };
