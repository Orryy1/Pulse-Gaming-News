-- 025_green_autopilot_runtime_control.sql
-- Durable fail-closed controls and runtime identity for GREEN autopilot.
-- Applying this migration to production requires migration-025 approval,
-- verified backup evidence and the separately reviewed cutover procedure.

ALTER TABLE runtime_leases
  ADD COLUMN fencing_token INTEGER NOT NULL DEFAULT 0
    CHECK (fencing_token >= 0);

ALTER TABLE jobs
  ADD COLUMN claim_token INTEGER NOT NULL DEFAULT 0
    CHECK (claim_token >= 0);

ALTER TABLE jobs
  ADD COLUMN claim_generation INTEGER NOT NULL DEFAULT 0
    CHECK (claim_generation >= 0);

CREATE INDEX idx_jobs_claim_identity
  ON jobs(id, claimed_by, claim_token, claim_generation);

CREATE TABLE control_switches (
  name TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('ENGAGED','CLEAR')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  authority_decision_id TEXT
);

CREATE TABLE control_switch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  from_state TEXT CHECK (from_state IS NULL OR from_state IN ('ENGAGED','CLEAR')),
  to_state TEXT NOT NULL CHECK (to_state IN ('ENGAGED','CLEAR')),
  version INTEGER NOT NULL CHECK (version >= 1),
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  authority_decision_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (name) REFERENCES control_switches(name)
);

CREATE UNIQUE INDEX ux_control_switch_event_version
  ON control_switch_events(name, version);

CREATE TRIGGER control_switch_clear_authority_insert
BEFORE INSERT ON control_switches
WHEN NEW.state = 'CLEAR' AND NULLIF(trim(NEW.authority_decision_id), '') IS NULL
BEGIN
  SELECT RAISE(ABORT, 'control_switch_clear_authority_required');
END;

CREATE TRIGGER control_switch_update_guard
BEFORE UPDATE ON control_switches
WHEN NEW.name <> OLD.name OR NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'control_switch_version_transition_invalid');
END;

CREATE TRIGGER control_switch_clear_authority_update
BEFORE UPDATE ON control_switches
WHEN NEW.state = 'CLEAR' AND NULLIF(trim(NEW.authority_decision_id), '') IS NULL
BEGIN
  SELECT RAISE(ABORT, 'control_switch_clear_authority_required');
END;

CREATE TRIGGER control_switch_events_no_update
BEFORE UPDATE ON control_switch_events
BEGIN
  SELECT RAISE(ABORT, 'immutable_control_switch_events');
END;

CREATE TRIGGER control_switch_events_no_delete
BEFORE DELETE ON control_switch_events
BEGIN
  SELECT RAISE(ABORT, 'immutable_control_switch_events');
END;

INSERT INTO control_switches
  (name, state, version, updated_at, actor_id, reason, authority_decision_id)
VALUES
  ('external_mutations', 'ENGAGED', 1, datetime('now'),
   'MIGRATION_025', 'FAIL_CLOSED_INITIAL_STATE', NULL);

INSERT INTO control_switch_events
  (name, from_state, to_state, version, actor_id, reason,
   authority_decision_id, created_at)
VALUES
  ('external_mutations', NULL, 'ENGAGED', 1,
   'MIGRATION_025', 'FAIL_CLOSED_INITIAL_STATE', NULL, datetime('now'));

CREATE TABLE circuit_breakers (
  scope TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('CLOSED','OPEN','HALF_OPEN')),
  version INTEGER NOT NULL CHECK (version >= 1),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  failure_threshold INTEGER NOT NULL DEFAULT 3 CHECK (failure_threshold >= 1),
  opened_at TEXT,
  cooldown_until TEXT,
  probe_token TEXT,
  probe_owner_id TEXT,
  probe_issued_at TEXT,
  last_error_class TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_circuit_breaker_probe_token
  ON circuit_breakers(probe_token)
  WHERE probe_token IS NOT NULL;

CREATE TABLE circuit_breaker_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  from_state TEXT,
  to_state TEXT NOT NULL CHECK (to_state IN ('CLOSED','OPEN','HALF_OPEN')),
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (scope) REFERENCES circuit_breakers(scope)
);

CREATE UNIQUE INDEX ux_circuit_breaker_event_version
  ON circuit_breaker_events(scope, version);

CREATE TRIGGER circuit_breaker_update_guard
BEFORE UPDATE ON circuit_breakers
WHEN NEW.scope <> OLD.scope OR NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'circuit_breaker_version_transition_invalid');
END;

CREATE TRIGGER circuit_breaker_events_no_update
BEFORE UPDATE ON circuit_breaker_events
BEGIN
  SELECT RAISE(ABORT, 'immutable_circuit_breaker_events');
END;

CREATE TRIGGER circuit_breaker_events_no_delete
BEFORE DELETE ON circuit_breaker_events
BEGIN
  SELECT RAISE(ABORT, 'immutable_circuit_breaker_events');
END;

CREATE TABLE runtime_components (
  component_id TEXT PRIMARY KEY,
  instance_key TEXT NOT NULL UNIQUE,
  component_type TEXT NOT NULL,
  role TEXT NOT NULL,
  commit_sha TEXT NOT NULL
    CHECK (length(commit_sha) = 40 AND commit_sha NOT GLOB '*[^0-9a-f]*'),
  configuration_sha256 TEXT NOT NULL
    CHECK (length(configuration_sha256) = 64
      AND configuration_sha256 NOT GLOB '*[^0-9a-f]*'),
  process_id INTEGER NOT NULL CHECK (process_id > 0),
  process_started_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('STARTING','READY','DEGRADED','STOPPED')),
  registered_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  stopped_at TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  version INTEGER NOT NULL CHECK (version >= 1)
);

CREATE INDEX idx_runtime_components_expiry
  ON runtime_components(state, expires_at);

CREATE INDEX idx_runtime_components_role
  ON runtime_components(component_type, role, state);

CREATE TABLE runtime_component_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  from_state TEXT,
  to_state TEXT NOT NULL CHECK (to_state IN ('STARTING','READY','DEGRADED','STOPPED')),
  event_type TEXT NOT NULL,
  evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (component_id) REFERENCES runtime_components(component_id)
);

CREATE UNIQUE INDEX ux_runtime_component_event_version
  ON runtime_component_events(component_id, version);

CREATE TRIGGER runtime_component_update_guard
BEFORE UPDATE ON runtime_components
WHEN NEW.component_id <> OLD.component_id
  OR NEW.instance_key <> OLD.instance_key
  OR NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'runtime_component_version_transition_invalid');
END;

CREATE TRIGGER runtime_component_events_no_update
BEFORE UPDATE ON runtime_component_events
BEGIN
  SELECT RAISE(ABORT, 'immutable_runtime_component_events');
END;

CREATE TRIGGER runtime_component_events_no_delete
BEFORE DELETE ON runtime_component_events
BEGIN
  SELECT RAISE(ABORT, 'immutable_runtime_component_events');
END;
