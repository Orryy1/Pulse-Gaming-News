-- 024_publication_authority_audit.sql
-- Autonomous publication authority is deliberately separate from human
-- operator decisions. Each immutable authority record is pre-bound to one
-- exact candidate digest and one lifecycle event idempotency key.

CREATE TABLE publication_authority_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  authority_type TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision = 'APPROVED'),
  reason TEXT,
  evidence_json TEXT NOT NULL
    CHECK (
      json_valid(evidence_json)
      AND json_type(evidence_json) = 'object'
    ),
  authority_binding_sha256 TEXT NOT NULL
    CHECK (
      length(authority_binding_sha256) = 64
      AND authority_binding_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
  lifecycle_idempotency_key TEXT NOT NULL
    CHECK (length(trim(lifecycle_idempotency_key)) > 0),
  idempotency_key TEXT NOT NULL
    CHECK (length(trim(idempotency_key)) > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

CREATE UNIQUE INDEX ux_publication_authority_audit_idempotency
  ON publication_authority_audit_log(idempotency_key);

CREATE UNIQUE INDEX ux_publication_authority_audit_binding
  ON publication_authority_audit_log(authority_binding_sha256);

CREATE UNIQUE INDEX ux_publication_authority_audit_lifecycle_use
  ON publication_authority_audit_log(lifecycle_idempotency_key);

CREATE INDEX idx_publication_authority_audit_story
  ON publication_authority_audit_log(story_id, platform, id);

CREATE TRIGGER trg_publication_authority_audit_immutable_update
BEFORE UPDATE ON publication_authority_audit_log
BEGIN
  SELECT RAISE(ABORT, 'immutable_publication_authority_audit_log');
END;

CREATE TRIGGER trg_publication_authority_audit_immutable_delete
BEFORE DELETE ON publication_authority_audit_log
BEGIN
  SELECT RAISE(ABORT, 'immutable_publication_authority_audit_log');
END;

ALTER TABLE publication_lifecycle_events
  ADD COLUMN publication_authority_audit_id INTEGER
  REFERENCES publication_authority_audit_log(id);

CREATE UNIQUE INDEX ux_publication_lifecycle_authority_audit_use
  ON publication_lifecycle_events(publication_authority_audit_id)
  WHERE publication_authority_audit_id IS NOT NULL;

CREATE TRIGGER trg_autonomous_lifecycle_authority_required
BEFORE INSERT ON publication_lifecycle_events
WHEN NEW.to_state = 'AUTONOMOUSLY_APPROVED'
 AND NEW.publication_authority_audit_id IS NULL
BEGIN
  SELECT RAISE(
    ABORT,
    'publication_authority_lifecycle_binding_required'
  );
END;

CREATE TRIGGER trg_autonomous_lifecycle_authority_binding
BEFORE INSERT ON publication_lifecycle_events
WHEN NEW.to_state = 'AUTONOMOUSLY_APPROVED'
 AND NEW.publication_authority_audit_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
   FROM publication_authority_audit_log AS authority
   WHERE authority.id = NEW.publication_authority_audit_id
     AND authority.story_id = NEW.story_id
     AND authority.platform = NEW.platform
     AND authority.decision = 'APPROVED'
     AND authority.lifecycle_idempotency_key = NEW.idempotency_key
     AND NEW.actor_type = 'system'
     AND NEW.actor_id IS NULL
 )
BEGIN
  SELECT RAISE(
    ABORT,
    'publication_authority_lifecycle_binding_mismatch'
  );
END;

CREATE TRIGGER trg_publication_authority_autonomous_only
BEFORE INSERT ON publication_lifecycle_events
WHEN NEW.to_state <> 'AUTONOMOUSLY_APPROVED'
 AND NEW.publication_authority_audit_id IS NOT NULL
BEGIN
  SELECT RAISE(
    ABORT,
    'publication_authority_only_for_autonomous_approval'
  );
END;
