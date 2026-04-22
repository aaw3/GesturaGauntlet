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
      SELECT id, name, kind, integration_type, version, online, supports_discovery,
        supports_bulk_actions, base_url, auth_token, config, metadata
      FROM device_managers
      ORDER BY created_at ASC
    `);

    return result.rows.map(rowToManagerConfig);
  }

  async upsertManagerConfig({ info, baseUrl, authToken, config = {} }) {
    if (!this.pool) return;

    await this.pool.query(
      `
        INSERT INTO device_managers (
          id, name, kind, integration_type, version, online, supports_discovery,
          supports_bulk_actions, base_url, auth_token, config, metadata, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, now())
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
      ],
    );
  }

  async deleteManagerConfig(managerId) {
    if (!this.pool) return;
    await this.pool.query('DELETE FROM device_managers WHERE id = $1', [managerId]);
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
  };
}

module.exports = { PostgresStore };
