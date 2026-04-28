DELETE FROM nodes
WHERE id IN ('central-node', 'external-node');

DELETE FROM device_managers
WHERE node_id IS NULL
   OR node_id IN ('central-node', 'external-node');

ALTER TABLE device_managers
  DROP CONSTRAINT IF EXISTS device_managers_node_required;

ALTER TABLE device_managers
  ADD CONSTRAINT device_managers_node_required
  CHECK (node_id IS NOT NULL) NOT VALID;
