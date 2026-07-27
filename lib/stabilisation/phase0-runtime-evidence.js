"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  selectStabilisationSchedules,
  validateStabilisationSchedule,
} = require("./scheduler-profile");
const { valueHash } = require("./runtime-config");

const GOVERNANCE_TABLES = Object.freeze([
  "publication_lifecycle_events",
  "platform_dispatch_ledger",
  "platform_publication_state",
  "runtime_leases",
  "operator_audit_log",
]);

const IMMUTABILITY_TRIGGERS = Object.freeze([
  "trg_publication_lifecycle_events_immutable_update",
  "trg_publication_lifecycle_events_immutable_delete",
  "trg_platform_dispatch_ledger_immutable_update",
  "trg_platform_dispatch_ledger_immutable_delete",
  "trg_operator_audit_log_immutable_update",
  "trg_operator_audit_log_immutable_delete",
]);

function quoteIdentifier(value) {
  const text = String(value || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    throw new Error("unsafe_sql_identifier");
  }
  return `"${text}"`;
}

function objectNames(db, type) {
  return new Set(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'",
      )
      .all(type)
      .map((row) => row.name),
  );
}

function columnsFor(db, table) {
  if (!objectNames(db, "table").has(table)) return new Set();
  return new Set(
    db
      .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all()
      .map((row) => row.name),
  );
}

function hasColumns(db, table, columns) {
  const available = columnsFor(db, table);
  return columns.every((column) => available.has(column));
}

function count(db, sql, parameters = []) {
  return Number(db.prepare(sql).get(...parameters)?.count || 0);
}

function databaseFingerprint(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return {
      path_class: dbPath ? "configured_file_unavailable" : "in_memory_or_unknown",
      size_bytes: null,
      modified_at: null,
      sha256: null,
    };
  }
  const stats = fs.statSync(dbPath);
  return {
    path_class: path.basename(dbPath),
    size_bytes: stats.size,
    modified_at: stats.mtime.toISOString(),
    sha256: crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex"),
  };
}

function appliedMigrations(db, tables) {
  if (!tables.has("schema_migrations")) return [];
  const columns = columnsFor(db, "schema_migrations");
  if (!columns.has("version")) return [];
  return db
    .prepare(
      `SELECT version, filename, applied_at
       FROM schema_migrations
       ORDER BY version`,
    )
    .all()
    .map((row) => ({
      version: String(row.version),
      filename: row.filename || null,
      applied_at: row.applied_at || null,
    }));
}

function conflictCounts(db, tables) {
  const conflicts = {
    stories_published_without_youtube_id: null,
    stories_failed_with_youtube_id: null,
    duplicate_story_youtube_ids: null,
    platform_published_without_external_id: null,
    platform_failed_with_external_id: null,
    duplicate_platform_external_ids: null,
    duplicate_platform_idempotency_keys: null,
    orphan_platform_posts: null,
  };

  if (
    tables.has("stories") &&
    hasColumns(db, "stories", [
      "publish_status",
      "youtube_post_id",
    ])
  ) {
    conflicts.stories_published_without_youtube_id = count(
      db,
      `SELECT COUNT(*) AS count
       FROM stories
       WHERE LOWER(COALESCE(publish_status, '')) = 'published'
         AND NULLIF(TRIM(COALESCE(youtube_post_id, '')), '') IS NULL`,
    );
    conflicts.stories_failed_with_youtube_id = count(
      db,
      `SELECT COUNT(*) AS count
       FROM stories
       WHERE LOWER(COALESCE(publish_status, '')) = 'failed'
         AND NULLIF(TRIM(COALESCE(youtube_post_id, '')), '') IS NOT NULL`,
    );
    conflicts.duplicate_story_youtube_ids = count(
      db,
      `SELECT COUNT(*) AS count FROM (
         SELECT youtube_post_id
         FROM stories
         WHERE NULLIF(TRIM(COALESCE(youtube_post_id, '')), '') IS NOT NULL
         GROUP BY youtube_post_id
         HAVING COUNT(*) > 1
       )`,
    );
  }

  if (
    tables.has("platform_posts") &&
    hasColumns(db, "platform_posts", [
      "story_id",
      "platform",
      "status",
      "external_id",
      "idempotency_key",
    ])
  ) {
    conflicts.platform_published_without_external_id = count(
      db,
      `SELECT COUNT(*) AS count
       FROM platform_posts
       WHERE LOWER(status) = 'published'
         AND NULLIF(TRIM(COALESCE(external_id, '')), '') IS NULL`,
    );
    conflicts.platform_failed_with_external_id = count(
      db,
      `SELECT COUNT(*) AS count
       FROM platform_posts
       WHERE LOWER(status) = 'failed'
         AND NULLIF(TRIM(COALESCE(external_id, '')), '') IS NOT NULL`,
    );
    conflicts.duplicate_platform_external_ids = count(
      db,
      `SELECT COUNT(*) AS count FROM (
         SELECT platform, external_id
         FROM platform_posts
         WHERE NULLIF(TRIM(COALESCE(external_id, '')), '') IS NOT NULL
         GROUP BY platform, external_id
         HAVING COUNT(*) > 1
       )`,
    );
    conflicts.duplicate_platform_idempotency_keys = count(
      db,
      `SELECT COUNT(*) AS count FROM (
         SELECT idempotency_key
         FROM platform_posts
         WHERE NULLIF(TRIM(COALESCE(idempotency_key, '')), '') IS NOT NULL
         GROUP BY idempotency_key
         HAVING COUNT(*) > 1
       )`,
    );
    if (tables.has("stories") && columnsFor(db, "stories").has("id")) {
      conflicts.orphan_platform_posts = count(
        db,
        `SELECT COUNT(*) AS count
         FROM platform_posts AS posts
         LEFT JOIN stories ON stories.id = posts.story_id
         WHERE stories.id IS NULL`,
      );
    }
  }
  return conflicts;
}

function buildDatabaseIntegrityReport({
  db,
  dbPath = null,
  metadata,
} = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("read_only_database_handle_required");
  }
  db.pragma("query_only = ON");
  const tables = objectNames(db, "table");
  const triggers = objectNames(db, "trigger");
  const relevantTables = [
    "stories",
    "platform_posts",
    "jobs",
    "schedules",
    ...GOVERNANCE_TABLES,
  ];
  const tableCounts = {};
  for (const table of relevantTables) {
    tableCounts[table] = tables.has(table)
      ? count(db, `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
      : null;
  }

  const quickCheckRows = db.pragma("quick_check");
  const integrityRows = db.pragma("integrity_check");
  const quickCheck = quickCheckRows.map((row) => Object.values(row)[0]).join("; ");
  const integrityCheck = integrityRows
    .map((row) => Object.values(row)[0])
    .join("; ");
  const missingGovernanceTables = GOVERNANCE_TABLES.filter(
    (table) => !tables.has(table),
  );
  const missingImmutabilityTriggers = IMMUTABILITY_TRIGGERS.filter(
    (trigger) => !triggers.has(trigger),
  );
  const conflicts = conflictCounts(db, tables);
  const conflictTotal = Object.values(conflicts)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const blockers = [];
  if (quickCheck !== "ok" || integrityCheck !== "ok") {
    blockers.push("sqlite_integrity_check_failed");
  }
  if (missingGovernanceTables.length) {
    blockers.push("stabilisation_governance_schema_not_materialised");
  }
  if (missingImmutabilityTriggers.length) {
    blockers.push("immutable_audit_triggers_not_materialised");
  }
  if (conflictTotal > 0) blockers.push("publication_state_conflicts_present");
  blockers.push("local_database_is_not_production_authority");

  return {
    schema_version: "pulse-phase0-database-integrity-v1",
    metadata,
    read_only: true,
    database: databaseFingerprint(dbPath),
    integrity: {
      quick_check: quickCheck,
      integrity_check: integrityCheck,
    },
    schema: {
      table_counts: tableCounts,
      applied_migrations: appliedMigrations(db, tables),
      required_governance_tables: [...GOVERNANCE_TABLES],
      missing_governance_tables: missingGovernanceTables,
      missing_immutability_triggers: missingImmutabilityTriggers,
    },
    conflicts,
    conflict_total: conflictTotal,
    verdict: blockers.length > 1 ? "BLOCKED" : "LOCAL_ONLY_PASS",
    release_ready: false,
    blockers,
    mutations_performed: [],
  };
}

function scheduleRows(db, tables) {
  if (!tables.has("schedules")) return [];
  const required = ["id", "name", "kind", "cron_expr", "payload", "enabled"];
  if (!hasColumns(db, "schedules", required)) return [];
  return db
    .prepare(
      `SELECT id, name, kind, cron_expr, payload, enabled
       FROM schedules
       ORDER BY id`,
    )
    .all();
}

function jobStatusCounts(db, tables) {
  if (!tables.has("jobs") || !hasColumns(db, "jobs", ["status"])) return {};
  return Object.fromEntries(
    db
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM jobs
         GROUP BY status
         ORDER BY status`,
      )
      .all()
      .map((row) => [String(row.status), Number(row.count)]),
  );
}

function schedulerLease(db, tables, now) {
  if (!tables.has("runtime_leases")) {
    return {
      schema_present: false,
      observed: false,
      live: false,
      owner_hash: null,
      heartbeat_at: null,
      expires_at: null,
    };
  }
  const row = db
    .prepare(
      `SELECT owner_id, heartbeat_at, expires_at
       FROM runtime_leases
       WHERE name = 'scheduler:primary'`,
    )
    .get();
  if (!row) {
    return {
      schema_present: true,
      observed: false,
      live: false,
      owner_hash: null,
      heartbeat_at: null,
      expires_at: null,
    };
  }
  return {
    schema_present: true,
    observed: true,
    live: String(row.expires_at) > now.toISOString(),
    owner_hash: valueHash(row.owner_id),
    heartbeat_at: row.heartbeat_at,
    expires_at: row.expires_at,
  };
}

function buildSchedulerOwnershipReport({
  db,
  metadata,
  now = new Date(),
  staticLeaseGuardPresent = false,
  codeSchedules = [],
} = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("read_only_database_handle_required");
  }
  db.pragma("query_only = ON");
  const tables = objectNames(db, "table");
  const configured = scheduleRows(db, tables);
  const enabled = configured.filter((row) => Number(row.enabled) === 1);
  const active = selectStabilisationSchedules(enabled);
  const profile = validateStabilisationSchedule(active);
  const codeActive = selectStabilisationSchedules(codeSchedules);
  const codeProfile = validateStabilisationSchedule(codeActive);
  const lease = schedulerLease(db, tables, now);
  const blockers = [];
  if (!staticLeaseGuardPresent) blockers.push("scheduler_lease_guard_not_verified");
  if (!codeProfile.valid) blockers.push("code_default_stabilisation_schedule_invalid");
  if (!profile.valid) blockers.push("stabilisation_schedule_invalid");
  if (!lease.schema_present) blockers.push("durable_scheduler_lease_schema_missing");
  if (!lease.live) blockers.push("no_live_scheduler_owner_observed");
  blockers.push("local_database_is_not_production_authority");

  return {
    schema_version: "pulse-phase0-scheduler-ownership-v1",
    metadata,
    read_only: true,
    configured: {
      schedule_count: configured.length,
      enabled_count: enabled.length,
      names: enabled.map((row) => row.name),
    },
    active_profile: {
      id: "stabilisation_30d",
      schedule_count: active.length,
      names: active.map((row) => row.name),
      suppressed_enabled_count: Math.max(0, enabled.length - active.length),
    },
    profile,
    code_default_profile: {
      schedule_count: codeActive.length,
      ...codeProfile,
    },
    job_status_counts: jobStatusCounts(db, tables),
    static_lease_guard_present: staticLeaseGuardPresent,
    lease,
    single_owner_proved_for_observed_database:
      staticLeaseGuardPresent && profile.valid && lease.live,
    production_single_owner_proved: false,
    verdict: blockers.length > 1 ? "BLOCKED" : "LOCAL_ONLY_PASS",
    blockers,
    mutations_performed: [],
  };
}

module.exports = {
  GOVERNANCE_TABLES,
  IMMUTABILITY_TRIGGERS,
  buildDatabaseIntegrityReport,
  buildSchedulerOwnershipReport,
  quoteIdentifier,
};
