const fs = require('fs');
const path = require('path');

class PostgresStore {
  constructor({ databaseUrl = process.env.DATABASE_URL, migrationsDir } = {}) {
    this.databaseUrl = databaseUrl;
    this.migrationsDir = migrationsDir || path.join(__dirname, '..', '..', 'migrations');
    this.pool = null;
  }

  get enabled() {
    return Boolean(this.pool);
  }

  async init() {
    if (!this.databaseUrl) return false;

    let Pool;
    try {
      ({ Pool } = require('pg'));
    } catch (err) {
      throw new Error('DATABASE_URL is set, but dependency "pg" is not installed. Run npm install in gestura-backend.');
    }

    this.pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });

    await this.migrate();
    return true;
  }

  async close() {
    if (this.pool) await this.pool.end();
  }

  async migrate() {
    if (!this.pool) return;

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS gestura_schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const id = file.replace(/\.sql$/, '');
      const existing = await this.pool.query(
        'SELECT id FROM gestura_schema_migrations WHERE id = $1',
        [id],
      );
      if (existing.rowCount > 0) continue;

      const sql = fs.readFileSync(path.join(this.migrationsDir, file), 'utf8');
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO gestura_schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
          [id],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  }

  async listManagerConfigs() {
    if (!this.pool) return [];

    const result = await this.pool.query(`
      SELECT dm.id, dm.name, dm.kind, dm.integration_type, dm.version, dm.online,
        dm.supports_discovery, dm.supports_bulk_actions, dm.base_url, dm.auth_token,
        dm.config, dm.metadata, dm.node_id,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'kind', mi.kind,
              'url', mi.url,
              'priority', mi.priority
            )
          ) FILTER (WHERE mi.id IS NOT NULL),
          '[]'::jsonb
        ) AS interfaces
      FROM device_managers dm
      LEFT JOIN manager_interfaces mi ON mi.manager_id = dm.id
      GROUP BY dm.id
      ORDER BY dm.created_at ASC
    `);

    return result.rows.map(rowToManagerConfig);
  }

  async listNodes() {
    if (!this.pool) return [];
    const result = await this.pool.query(`
      SELECT id, name, online, last_seen_at, metadata
      FROM nodes
      ORDER BY created_at ASC
    `);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      online: row.online,
      lastHeartbeatAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
      managerIds: [],
      metadata: row.metadata || {},
    }));
  }

  async listManagedDevices() {
    if (!this.pool) return [];
    const result = await this.pool.query('SELECT payload FROM managed_devices ORDER BY created_at ASC');
    return result.rows.map((row) => row.payload);
  }

  async upsertManagerConfig({ info, baseUrl, authToken, config = {} }) {
    if (!this.pool) return;

    await this.pool.query(
      `
        INSERT INTO device_managers (
          id, name, kind, integration_type, version, online, supports_discovery,
          supports_bulk_actions, base_url, auth_token, config, metadata, node_id,
          display_name, description, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, now())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          kind = EXCLUDED.kind,
          integration_type = EXCLUDED.integration_type,
          version = EXCLUDED.version,
          online = EXCLUDED.online,
          supports_discovery = EXCLUDED.supports_discovery,
          supports_bulk_actions = EXCLUDED.supports_bulk_actions,
          base_url = EXCLUDED.base_url,
          auth_token = EXCLUDED.auth_token,
          config = EXCLUDED.config,
          metadata = EXCLUDED.metadata,
          node_id = EXCLUDED.node_id,
          display_name = EXCLUDED.display_name,
          description = EXCLUDED.description,
          updated_at = now()
      `,
      [
        info.id,
        info.name,
        info.kind,
        info.integrationType || 'external',
        info.version || '1.0.0',
        info.online !== false,
        Boolean(info.supportsDiscovery),
        Boolean(info.supportsBulkActions),
        baseUrl || info.baseUrl || null,
        authToken || null,
        JSON.stringify(config),
        JSON.stringify(info.metadata || {}),
        info.nodeId || config.nodeId || null,
        info.metadata?.name || info.name || info.id,
        info.metadata?.description || null,
      ],
    );

    await this.replaceManagerInterfaces(info.id, info.interfaces || []);
  }

  async deleteManagerConfig(managerId) {
    if (!this.pool) return;
    await this.pool.query('DELETE FROM device_managers WHERE id = $1', [managerId]);
  }

  async getAppConfiguration(key) {
    if (!this.pool) return null;
    const result = await this.pool.query('SELECT payload FROM app_configurations WHERE key = $1', [key]);
    return result.rows[0]?.payload || null;
  }

  async setAppConfiguration(key, payload) {
    if (!this.pool) return payload;
    await this.pool.query(
      `
        INSERT INTO app_configurations (key, payload)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (key)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
      `,
      [key, JSON.stringify(payload)],
    );
    return payload;
  }

  async saveDevicesForManager(managerId, devices = []) {
    if (!this.pool) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const device of devices) {
        await client.query(
          `
            INSERT INTO managed_devices (id, manager_id, payload, online, updated_at)
            VALUES ($1, $2, $3::jsonb, $4, now())
            ON CONFLICT (id) DO UPDATE SET
              manager_id = EXCLUDED.manager_id,
              payload = EXCLUDED.payload,
              online = EXCLUDED.online,
              updated_at = now()
          `,
          [device.id, managerId, JSON.stringify(device), device.online || 'unknown'],
        );
        await client.query(
          `
            UPDATE managed_devices
            SET node_id = $2,
              type = $3,
              name = $4,
              metadata = $5::jsonb
            WHERE id = $1
          `,
          [
            device.id,
            device.provenance?.nodeId || null,
            device.type || null,
            device.name || null,
            JSON.stringify(device.metadata || {}),
          ],
        );
        await client.query('DELETE FROM device_capabilities WHERE device_id = $1', [device.id]);
        for (const capability of device.capabilities || []) {
          await client.query(
            `
              INSERT INTO device_capabilities (
                device_id, capability_id, label, kind, config_json, updated_at
              )
              VALUES ($1, $2, $3, $4, $5::jsonb, now())
              ON CONFLICT (device_id, capability_id) DO UPDATE SET
                label = EXCLUDED.label,
                kind = EXCLUDED.kind,
                config_json = EXCLUDED.config_json,
                updated_at = now()
            `,
            [
              device.id,
              capability.id,
              capability.label || capability.id,
              capability.kind || capability.type || 'custom',
              JSON.stringify(capability),
            ],
          );
        }
      }
      await client.query(
        `
          UPDATE managed_devices
          SET online = 'offline',
            payload = jsonb_set(payload, '{online}', '"offline"', true),
            updated_at = now()
          WHERE manager_id = $1 AND NOT (id = ANY($2::text[]))
        `,
        [managerId, devices.map((device) => device.id)],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async clearManagerDevices(managerId) {
    if (!this.pool) return;
    await this.pool.query('DELETE FROM managed_devices WHERE manager_id = $1', [managerId]);
  }

  async listMappings(gloveId) {
    if (!this.pool) return [];
    const params = [];
    let where = '';
    if (gloveId) {
      params.push(gloveId);
      where = 'WHERE glove_id = $1';
    }

    const result = await this.pool.query(
      `SELECT payload FROM glove_mappings ${where} ORDER BY created_at ASC`,
      params,
    );
    return result.rows.map((row) => row.payload);
  }

  async upsertMapping(mapping) {
    if (!this.pool) return;
    await this.pool.query(
      `
        INSERT INTO glove_mappings (
          id, glove_id, input_source, target_device_id, target_capability_id,
          enabled, payload, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET
          glove_id = EXCLUDED.glove_id,
          input_source = EXCLUDED.input_source,
          target_device_id = EXCLUDED.target_device_id,
          target_capability_id = EXCLUDED.target_capability_id,
          enabled = EXCLUDED.enabled,
          payload = EXCLUDED.payload,
          updated_at = now()
      `,
      [
        mapping.id,
        mapping.gloveId,
        mapping.inputSource,
        mapping.targetDeviceId,
        mapping.targetCapabilityId,
        mapping.enabled !== false,
        JSON.stringify(mapping),
      ],
    );
  }

  async replaceMappingsForDevice(deviceId, mappings = []) {
    if (!this.pool) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM glove_mappings WHERE target_device_id = $1', [deviceId]);
      for (const mapping of mappings) {
        await client.query(
          `
            INSERT INTO glove_mappings (
              id, glove_id, input_source, target_device_id, target_capability_id,
              enabled, payload, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
            ON CONFLICT (id) DO UPDATE SET
              glove_id = EXCLUDED.glove_id,
              input_source = EXCLUDED.input_source,
              target_device_id = EXCLUDED.target_device_id,
              target_capability_id = EXCLUDED.target_capability_id,
              enabled = EXCLUDED.enabled,
              payload = EXCLUDED.payload,
              updated_at = now()
          `,
          [
            mapping.id,
            mapping.gloveId,
            mapping.inputSource,
            mapping.targetDeviceId,
            mapping.targetCapabilityId,
            mapping.enabled !== false,
            JSON.stringify(mapping),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteMapping(mappingId) {
    if (!this.pool) return;
    await this.pool.query('DELETE FROM glove_mappings WHERE id = $1', [mappingId]);
  }

  async upsertNode(node) {
    if (!this.pool) return;
    await this.pool.query(
      `
        INSERT INTO nodes (id, name, online, last_seen_at, metadata, updated_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          online = EXCLUDED.online,
          last_seen_at = EXCLUDED.last_seen_at,
          metadata = EXCLUDED.metadata,
          updated_at = now()
      `,
      [
        node.id,
        node.name || node.id,
        node.online !== false,
        node.lastHeartbeatAt || node.lastSeenAt || new Date().toISOString(),
        JSON.stringify(node.metadata || {}),
      ],
    );
  }

  async replaceManagerInterfaces(managerId, interfaces = []) {
    if (!this.pool) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM manager_interfaces WHERE manager_id = $1', [managerId]);
      for (const iface of interfaces) {
        if (!iface?.url || (iface.kind !== 'lan' && iface.kind !== 'public')) continue;
        await client.query(
          `
            INSERT INTO manager_interfaces (manager_id, kind, url, priority, updated_at)
            VALUES ($1, $2, $3, $4, now())
            ON CONFLICT (manager_id, kind, url) DO UPDATE SET
              priority = EXCLUDED.priority,
              updated_at = now()
          `,
          [managerId, iface.kind, iface.url, Number(iface.priority ?? 100)],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async saveRouteAttemptMetric(metric) {
    if (!this.pool) return;
    await this.pool.query(
      `
        INSERT INTO route_attempt_metrics (
          id, manager_id, node_id, device_id, attempted_route, final_route,
          success, latency_ms, error, message, payload, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, to_timestamp($12 / 1000.0))
        ON CONFLICT (id) DO NOTHING
      `,
      [
        metric.id,
        metric.managerId,
        metric.nodeId || null,
        metric.deviceId || null,
        metric.attemptedRoute || 'public',
        metric.finalRoute || null,
        metric.success === true,
        Number.isFinite(Number(metric.latencyMs)) ? Number(metric.latencyMs) : null,
        metric.error || null,
        metric.message || null,
        JSON.stringify(metric),
        metric.ts || Date.now(),
      ],
    );
  }

  async saveTelemetryEvents(events = []) {
    if (!this.pool || events.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const event of events) {
        await client.query(
          `
            INSERT INTO telemetry_events (id, node_id, manager_id, event_type, payload, created_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, to_timestamp($6 / 1000.0))
            ON CONFLICT (id) DO NOTHING
          `,
          [
            event.id,
            event.nodeId || null,
            event.managerId || null,
            event.eventType,
            JSON.stringify(event.payload || event),
            event.ts || Date.now(),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async savePassiveMetricUpload(gloveId, payload) {
    if (!this.pool) return;
    await this.pool.query(
      `
        INSERT INTO passive_metric_uploads (id, glove_id, payload_json)
        VALUES ($1, $2, $3::jsonb)
      `,
      [payload.id, gloveId, JSON.stringify(payload)],
    );
  }

  async listScenes() {
    if (!this.pool) return [];
    const result = await this.pool.query('SELECT payload FROM scenes ORDER BY created_at ASC');
    return result.rows.map((row) => row.payload);
  }

  async upsertScene(scene) {
    if (!this.pool) return;
    await this.pool.query(
      `
        INSERT INTO scenes (id, name, payload, updated_at)
        VALUES ($1, $2, $3::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          payload = EXCLUDED.payload,
          updated_at = now()
      `,
      [scene.id, scene.name, JSON.stringify(scene)],
    );
  }
}

function rowToManagerConfig(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    integrationType: row.integration_type,
    version: row.version,
    online: row.online,
    supportsDiscovery: row.supports_discovery,
    supportsBulkActions: row.supports_bulk_actions,
    baseUrl: row.base_url,
    authToken: row.auth_token,
    config: row.config || {},
    metadata: row.metadata || {},
    nodeId: row.node_id,
    interfaces: row.interfaces || [],
  };
}

module.exports = { PostgresStore };
