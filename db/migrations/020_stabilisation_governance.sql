-- 020_stabilisation_governance.sql
-- Durable publication truth for the Pulse v1 stabilisation release.
-- Applying this migration to production still requires an approved backup,
-- change window and post-migration integrity check.

CREATE TABLE IF NOT EXISTS publication_lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  platform TEXT,
  from_state TEXT,
  to_state TEXT NOT NULL,
  event_reason TEXT,
  retryability_class TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  evidence_json TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_publication_lifecycle_event_idempotency
  ON publication_lifecycle_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_publication_lifecycle_story
  ON publication_lifecycle_events(story_id, platform, id);

CREATE TRIGGER IF NOT EXISTS trg_publication_lifecycle_events_immutable_update
BEFORE UPDATE ON publication_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'immutable_publication_lifecycle_events');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_lifecycle_events_immutable_delete
BEFORE DELETE ON publication_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'immutable_publication_lifecycle_events');
END;

CREATE TABLE IF NOT EXISTS platform_dispatch_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  channel_id TEXT,
  platform TEXT NOT NULL,
  idempotency_key TEXT,
  event_type TEXT NOT NULL,
  external_id TEXT,
  external_url TEXT,
  request_fingerprint TEXT,
  retryability_class TEXT,
  verification_status TEXT,
  verification_evidence_json TEXT,
  operator_decision_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_dispatch_idempotency
  ON platform_dispatch_ledger(platform, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_dispatch_external_id
  ON platform_dispatch_ledger(platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_dispatch_story
  ON platform_dispatch_ledger(story_id, platform, id);

CREATE TRIGGER IF NOT EXISTS trg_platform_dispatch_ledger_immutable_update
BEFORE UPDATE ON platform_dispatch_ledger
BEGIN
  SELECT RAISE(ABORT, 'immutable_platform_dispatch_ledger');
END;

CREATE TRIGGER IF NOT EXISTS trg_platform_dispatch_ledger_immutable_delete
BEFORE DELETE ON platform_dispatch_ledger
BEGIN
  SELECT RAISE(ABORT, 'immutable_platform_dispatch_ledger');
END;

-- Backstop new writes to the legacy projection without rewriting historical
-- conflicts. Existing inconsistencies remain visible for reconciliation.
CREATE TRIGGER IF NOT EXISTS trg_platform_posts_external_id_unique_insert
BEFORE INSERT ON platform_posts
WHEN NEW.external_id IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM platform_posts
   WHERE platform = NEW.platform AND external_id = NEW.external_id
 )
BEGIN
  SELECT RAISE(ABORT, 'duplicate_platform_external_id');
END;

CREATE TRIGGER IF NOT EXISTS trg_platform_posts_external_id_unique_update
BEFORE UPDATE OF platform, external_id ON platform_posts
WHEN NEW.external_id IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM platform_posts
   WHERE platform = NEW.platform
     AND external_id = NEW.external_id
     AND id <> NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'duplicate_platform_external_id');
END;

CREATE TABLE IF NOT EXISTS platform_publication_state (
  story_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  external_id TEXT,
  external_url TEXT,
  verification_status TEXT,
  verified_at TEXT,
  last_event_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (story_id, platform),
  FOREIGN KEY (story_id) REFERENCES stories(id),
  FOREIGN KEY (last_event_id) REFERENCES platform_dispatch_ledger(id)
);

CREATE TRIGGER IF NOT EXISTS trg_published_state_requires_verification_insert
BEFORE INSERT ON platform_publication_state
WHEN NEW.lifecycle_state = 'PUBLISHED'
 AND (
   NULLIF(TRIM(NEW.external_id), '') IS NULL
   OR COALESCE(NEW.verification_status, '') <> 'confirmed'
   OR NULLIF(TRIM(NEW.verified_at), '') IS NULL
   OR julianday(NEW.verified_at) IS NULL
   OR NEW.last_event_id IS NULL
   OR NOT EXISTS (
     SELECT 1
     FROM platform_dispatch_ledger AS ledger
     WHERE ledger.id = NEW.last_event_id
       AND ledger.story_id = NEW.story_id
       AND ledger.platform = NEW.platform
       AND ledger.event_type = 'PUBLISHED'
       AND ledger.verification_status = 'confirmed'
       AND json_extract(
         ledger.verification_evidence_json,
         '$.external_id'
       ) = NEW.external_id
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'published_state_requires_platform_verification');
END;

CREATE TRIGGER IF NOT EXISTS trg_published_state_requires_verification_update
BEFORE UPDATE ON platform_publication_state
WHEN NEW.lifecycle_state = 'PUBLISHED'
 AND (
   NULLIF(TRIM(NEW.external_id), '') IS NULL
   OR COALESCE(NEW.verification_status, '') <> 'confirmed'
   OR NULLIF(TRIM(NEW.verified_at), '') IS NULL
   OR julianday(NEW.verified_at) IS NULL
   OR NEW.last_event_id IS NULL
   OR NOT EXISTS (
     SELECT 1
     FROM platform_dispatch_ledger AS ledger
     WHERE ledger.id = NEW.last_event_id
       AND ledger.story_id = NEW.story_id
       AND ledger.platform = NEW.platform
       AND ledger.event_type = 'PUBLISHED'
       AND ledger.verification_status = 'confirmed'
       AND json_extract(
         ledger.verification_evidence_json,
         '$.external_id'
       ) = NEW.external_id
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'published_state_requires_platform_verification');
END;

CREATE TABLE IF NOT EXISTS runtime_leases (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_runtime_leases_expiry
  ON runtime_leases(expires_at);

CREATE TABLE IF NOT EXISTS operator_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  decision TEXT,
  reason TEXT,
  evidence_json TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_operator_audit_idempotency
  ON operator_audit_log(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_operator_audit_log_immutable_update
BEFORE UPDATE ON operator_audit_log
BEGIN
  SELECT RAISE(ABORT, 'immutable_operator_audit_log');
END;

CREATE TRIGGER IF NOT EXISTS trg_operator_audit_log_immutable_delete
BEFORE DELETE ON operator_audit_log
BEGIN
  SELECT RAISE(ABORT, 'immutable_operator_audit_log');
END;
