-- 023_stabilisation_governance_hardening.sql
-- Forward-only hardening that was previously added illegally to migration 020.
-- Migration 020 is immutable because its shipped checksum is already recorded.

ALTER TABLE operator_audit_log
  ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_operator_audit_idempotency
  ON operator_audit_log(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS trg_published_state_requires_verification_insert;
CREATE TRIGGER trg_published_state_requires_verification_insert
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

DROP TRIGGER IF EXISTS trg_published_state_requires_verification_update;
CREATE TRIGGER trg_published_state_requires_verification_update
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
