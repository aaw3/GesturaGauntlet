ALTER TABLE device_managers
  DROP CONSTRAINT IF EXISTS device_managers_kind_check,
  DROP CONSTRAINT IF EXISTS device_managers_integration_type_check;

ALTER TABLE device_managers
  ADD COLUMN IF NOT EXISTS node_id text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS description text;

CREATE TABLE IF NOT EXISTS nodes (
  id text PRIMARY KEY,
  name text NOT NULL,
  online boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE device_managers
  ADD CONSTRAINT device_managers_node_id_fkey
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS device_managers_node_id_idx
  ON device_managers(node_id);

CREATE TABLE IF NOT EXISTS manager_interfaces (
  id bigserial PRIMARY KEY,
  manager_id text NOT NULL REFERENCES device_managers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('lan', 'public')),
  url text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manager_id, kind, url)
);

ALTER TABLE managed_devices
  ADD COLUMN IF NOT EXISTS node_id text REFERENCES nodes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS managed_devices_node_id_idx
  ON managed_devices(node_id);

CREATE TABLE IF NOT EXISTS device_capabilities (
  id bigserial PRIMARY KEY,
  device_id text NOT NULL REFERENCES managed_devices(id) ON DELETE CASCADE,
  capability_id text NOT NULL,
  label text NOT NULL,
  kind text NOT NULL,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, capability_id)
);

CREATE TABLE IF NOT EXISTS device_state_snapshots (
  id bigserial PRIMARY KEY,
  device_id text NOT NULL REFERENCES managed_devices(id) ON DELETE CASCADE,
  state_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_state_snapshots_device_created_idx
  ON device_state_snapshots(device_id, created_at DESC);

ALTER TABLE glove_mappings
  ADD COLUMN IF NOT EXISTS mode text,
  ADD COLUMN IF NOT EXISTS transform_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS route_attempt_metrics (
  id text PRIMARY KEY,
  manager_id text NOT NULL,
  node_id text,
  device_id text,
  attempted_route text NOT NULL CHECK (attempted_route IN ('lan', 'public')),
  final_route text CHECK (final_route IN ('lan', 'public')),
  success boolean NOT NULL,
  latency_ms integer,
  error text,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS route_attempt_metrics_manager_created_idx
  ON route_attempt_metrics(manager_id, created_at DESC);

CREATE INDEX IF NOT EXISTS route_attempt_metrics_node_created_idx
  ON route_attempt_metrics(node_id, created_at DESC);

CREATE TABLE IF NOT EXISTS telemetry_events (
  id text PRIMARY KEY,
  node_id text,
  manager_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telemetry_events_type_created_idx
  ON telemetry_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS telemetry_events_node_created_idx
  ON telemetry_events(node_id, created_at DESC);

CREATE TABLE IF NOT EXISTS passive_metric_uploads (
  id text PRIMARY KEY,
  glove_id text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS passive_metric_uploads_glove_created_idx
  ON passive_metric_uploads(glove_id, created_at DESC);
