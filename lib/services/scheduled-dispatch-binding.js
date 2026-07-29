"use strict";

const crypto = require("node:crypto");

const MAX_CONTROL_TOWER_AGE_MS = 15 * 60 * 1000;
const MAX_SCHEDULE_DRIFT_MS = 15 * 60 * 1000;
const MAX_FRESH_CONTROL_AGE_MS = 60 * 1000;

function text(value) {
  return String(value || "").trim();
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function timestamp(value, code) {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) fail(code);
  return parsed;
}

function databaseDataVersion(db) {
  if (typeof db.pragma === "function") {
    const value = Number(db.pragma("data_version", { simple: true }));
    if (Number.isInteger(value)) return value;
  }
  const row = db.prepare("PRAGMA data_version").get();
  const value = Number(row?.data_version);
  if (!Number.isInteger(value)) fail("guarded_database_data_version_invalid");
  return value;
}

function readScheduledRows(db) {
  return db
    .prepare(`
      SELECT
        state.story_id,
        state.platform,
        state.lifecycle_state,
        event.id AS scheduled_event_id,
        event.evidence_json,
        event.created_at AS scheduled_event_created_at
      FROM platform_publication_state AS state
      JOIN publication_lifecycle_events AS event
        ON event.id = (
          SELECT candidate.id
          FROM publication_lifecycle_events AS candidate
          WHERE candidate.story_id = state.story_id
            AND candidate.platform = state.platform
            AND candidate.to_state = 'SCHEDULED'
          ORDER BY candidate.id DESC
          LIMIT 1
        )
      WHERE state.platform = 'youtube'
        AND state.lifecycle_state = 'SCHEDULED'
      ORDER BY event.id ASC
    `)
    .all();
}

function resolveExactScheduledDispatchBindingFromRows({
  rows,
  now = new Date(),
  databaseDataVersion = null,
} = {}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(effectiveNow.getTime())) {
    fail("scheduled_dispatch_time_invalid");
  }

  const scheduledRows = Array.isArray(rows) ? rows : [];
  if (scheduledRows.length !== 1) {
    fail("fresh_scheduled_candidate_count_must_be_one");
  }
  const row = scheduledRows[0];
  const evidence = parseObject(row.evidence_json);
  if (
    row.platform !== "youtube" ||
    row.lifecycle_state !== "SCHEDULED" ||
    evidence.schedule_verified !== true
  ) {
    fail("scheduled_youtube_lifecycle_evidence_invalid");
  }
  if (text(evidence.control_tower_verdict).toUpperCase() !== "GREEN") {
    fail("scheduled_control_tower_not_green");
  }
  if (
    evidence.kill_switch_healthy !== true ||
    evidence.operating_contract_valid !== true
  ) {
    fail("scheduled_runtime_controls_not_green");
  }

  const nowMs = effectiveNow.getTime();
  const checkedAtMs = timestamp(
    evidence.control_tower_checked_at,
    "scheduled_control_tower_checked_at_invalid",
  );
  if (
    checkedAtMs > nowMs ||
    nowMs - checkedAtMs > MAX_CONTROL_TOWER_AGE_MS
  ) {
    fail("scheduled_control_tower_evidence_stale");
  }
  const scheduledAtMs = timestamp(
    evidence.scheduled_for,
    "scheduled_for_invalid",
  );
  if (Math.abs(nowMs - scheduledAtMs) > MAX_SCHEDULE_DRIFT_MS) {
    fail("scheduled_dispatch_outside_window");
  }

  const dispatchIdempotencyKey = text(
    evidence.dispatch_idempotency_key,
  );
  const requestFingerprint = text(
    evidence.request_fingerprint,
  ).toLowerCase();
  if (!dispatchIdempotencyKey) {
    fail("scheduled_dispatch_idempotency_key_required");
  }
  if (!/^[a-f0-9]{64}$/.test(requestFingerprint)) {
    fail("scheduled_request_fingerprint_invalid");
  }

  return Object.freeze({
    storyId: text(row.story_id),
    platform: "youtube",
    scheduledFor: new Date(scheduledAtMs).toISOString(),
    scheduledEventId: Number(row.scheduled_event_id),
    dispatchIdempotencyKey,
    requestFingerprint,
    runwayLockSha256:
      text(evidence.runway_lock_sha256).toLowerCase() || null,
    databaseDataVersion:
      Number.isInteger(databaseDataVersion) ? databaseDataVersion : null,
  });
}

function resolveExactScheduledDispatchBinding({
  db,
  now = new Date(),
} = {}) {
  if (!db || typeof db.prepare !== "function") {
    fail("scheduled_dispatch_database_required");
  }
  return resolveExactScheduledDispatchBindingFromRows({
    rows: readScheduledRows(db),
    now,
    databaseDataVersion: databaseDataVersion(db),
  });
}

function resolveExactScheduledDispatchBindingWithFreshControl({
  db,
  rows = null,
  now = new Date(),
  databaseDataVersion: suppliedDataVersion = null,
  fresh_control: freshControl,
} = {}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(effectiveNow.getTime())) {
    fail("scheduled_dispatch_time_invalid");
  }
  if (
    !freshControl ||
    typeof freshControl !== "object" ||
    Array.isArray(freshControl)
  ) {
    fail("scheduled_fresh_control_required");
  }
  if (
    text(freshControl.verdict).toUpperCase() !== "GREEN" ||
    freshControl.kill_switch_healthy !== true ||
    freshControl.operating_contract_valid !== true ||
    freshControl.scheduler_owner_healthy !== true
  ) {
    fail("scheduled_fresh_control_not_green");
  }
  const checkedAtMs = timestamp(
    freshControl.checked_at,
    "scheduled_fresh_control_checked_at_invalid",
  );
  const ageMs = effectiveNow.getTime() - checkedAtMs;
  if (
    ageMs < 0 ||
    ageMs > MAX_FRESH_CONTROL_AGE_MS
  ) {
    fail("scheduled_fresh_control_stale");
  }
  const sourceRows =
    rows === null
      ? db && typeof db.prepare === "function"
        ? readScheduledRows(db)
        : fail("scheduled_dispatch_database_required")
      : rows;
  const refreshedRows = (Array.isArray(sourceRows)
    ? sourceRows
    : []
  ).map((row) => {
    const evidence = parseObject(row.evidence_json);
    return {
      ...row,
      evidence_json: JSON.stringify({
        ...evidence,
        control_tower_verdict: "GREEN",
        control_tower_checked_at: new Date(
          checkedAtMs,
        ).toISOString(),
        kill_switch_healthy: true,
        operating_contract_valid: true,
      }),
    };
  });
  const effectiveDataVersion =
    Number.isInteger(suppliedDataVersion)
      ? suppliedDataVersion
      : db && typeof db.prepare === "function"
        ? databaseDataVersion(db)
        : null;
  const binding = resolveExactScheduledDispatchBindingFromRows({
    rows: refreshedRows,
    now: effectiveNow,
    databaseDataVersion: effectiveDataVersion,
  });
  if (!/^[a-f0-9]{64}$/.test(binding.runwayLockSha256 || "")) {
    fail("scheduled_runway_lock_sha256_required");
  }
  const freshControlEvidence = Object.freeze({
    schema_version:
      "pulse-governed-youtube-t0-fresh-control-v1",
    verdict: "GREEN",
    checked_at: new Date(checkedAtMs).toISOString(),
    kill_switch_healthy: true,
    operating_contract_valid: true,
    scheduler_owner_healthy: true,
  });
  return Object.freeze({
    ...binding,
    freshControlEvidence,
    freshControlSha256: canonicalSha256(
      freshControlEvidence,
    ),
  });
}

module.exports = {
  MAX_CONTROL_TOWER_AGE_MS,
  MAX_FRESH_CONTROL_AGE_MS,
  MAX_SCHEDULE_DRIFT_MS,
  resolveExactScheduledDispatchBinding,
  resolveExactScheduledDispatchBindingFromRows,
  resolveExactScheduledDispatchBindingWithFreshControl,
};
