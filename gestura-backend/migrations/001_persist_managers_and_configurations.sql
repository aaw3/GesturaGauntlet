CREATE TABLE IF NOT EXISTS gestura_schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_managers (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('kasa', 'simulator', 'custom')),
  integration_type text NOT NULL CHECK (integration_type IN ('native', 'external')),
  version text NOT NULL DEFAULT '1.0.0',
  online boolean NOT NULL DEFAULT true,
  supports_discovery boolean NOT NULL DEFAULT false,
  supports_bulk_actions boolean NOT NULL DEFAULT false,
  base_url text,
  auth_token text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS managed_devices (
  id text PRIMARY KEY,
  manager_id text NOT NULL REFERENCES device_managers(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  online text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS managed_devices_manager_id_idx
  ON managed_devices(manager_id);

CREATE TABLE IF NOT EXISTS glove_mappings (
  id text PRIMARY KEY,
  glove_id text NOT NULL,
  input_source text NOT NULL,
  target_device_id text NOT NULL,
  target_capability_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS glove_mappings_glove_input_idx
  ON glove_mappings(glove_id, input_source);

CREATE INDEX IF NOT EXISTS glove_mappings_target_device_idx
  ON glove_mappings(target_device_id);

CREATE TABLE IF NOT EXISTS scenes (
  id text PRIMARY KEY,
  name text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_configurations (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
