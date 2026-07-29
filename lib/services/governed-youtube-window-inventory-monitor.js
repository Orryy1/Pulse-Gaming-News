"use strict";

const {
  canonicalSha256,
  GUARDED_PUBLISH_HOURS_UTC,
} = require("./governed-youtube-release-runway");

const SCHEMA_VERSION =
  "pulse-governed-youtube-window-inventory-report-v1";
const AUTHORITY_SCHEMA_VERSION =
  "pulse-governed-youtube-window-candidate-authority-v1";
const WINDOW_HOURS_UTC = Object.freeze(
  [...GUARDED_PUBLISH_HOURS_UTC].sort((a, b) => a - b),
);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const T75_OFFSET_MS = 75 * 60 * 1000;
const T90_OFFSET_MS = 90 * 60 * 1000;
const REVIEW_OFFSET_MS = 120 * 60 * 1000;

function text(value) {
  return String(value ?? "").trim();
}

function utcDate(value, code) {
  if (value instanceof Date) {
    const copy = new Date(value.getTime());
    if (!Number.isNaN(copy.getTime())) return copy;
  }
  let raw = text(value);
  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
      raw,
    )
  ) {
    raw = `${raw.replace(" ", "T")}Z`;
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return parsed;
}

function objectValue(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }
  try {
    const parsed = JSON.parse(text(value) || "{}");
    return parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function sha256(value) {
  const hash = text(value).toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

function upcomingWindows(now, horizonHours) {
  const horizon = Number(horizonHours);
  if (
    !Number.isFinite(horizon) ||
    horizon <= 0 ||
    horizon > 48
  ) {
    throw new Error(
      "governed_window_inventory_horizon_must_be_1_to_48_hours",
    );
  }
  const end = new Date(now.getTime() + horizon * 60 * 60 * 1000);
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const windows = [];
  for (let day = 0; day <= 2; day += 1) {
    for (const hour of WINDOW_HOURS_UTC) {
      const scheduledAt = new Date(
        midnight + day * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000,
      );
      if (
        scheduledAt.getTime() > now.getTime() &&
        scheduledAt.getTime() <= end.getTime()
      ) {
        windows.push(scheduledAt);
      }
    }
  }
  return windows.sort((a, b) => a.getTime() - b.getTime());
}

function authorityRoleForAction(action) {
  if (action === "governed_youtube_window_primary") {
    return "PRIMARY";
  }
  if (action === "governed_youtube_runway_standby") {
    return "STANDBY";
  }
  return null;
}

function validateAuthorityAudit(audit, scheduledFor) {
  const blockers = [];
  const actionRole = authorityRoleForAction(text(audit?.action));
  const evidence = objectValue(audit?.evidence_json);
  const evidenceRole = text(evidence.role).toUpperCase();
  if (
    !actionRole ||
    audit?.decision !== "APPROVED" ||
    audit?.target_type !== "story" ||
    evidence.schema_version !== AUTHORITY_SCHEMA_VERSION ||
    evidence.platform !== "youtube" ||
    evidenceRole !== actionRole ||
    evidence.scheduled_for !== scheduledFor ||
    text(evidence.story_id) !== text(audit?.target_id)
  ) {
    blockers.push("governed_window_authority_contract_invalid");
  }
  const claimedBinding = sha256(
    evidence.authority_binding_sha256,
  );
  const body = { ...evidence };
  delete body.authority_binding_sha256;
  if (
    !claimedBinding ||
    canonicalSha256(body) !== claimedBinding
  ) {
    blockers.push("governed_window_authority_binding_invalid");
  }
  if (!sha256(evidence.candidate_revision_sha256)) {
    blockers.push(
      "governed_window_candidate_revision_sha256_required",
    );
  }
  for (const field of [
    "media_sha256",
    "script_sha256",
    "qa_report_sha256",
    "rights_ledger_sha256",
    "source_evidence_sha256",
  ]) {
    if (!sha256(evidence.evidence_hashes?.[field])) {
      blockers.push(`governed_window_${field}_required`);
    }
  }
  if (
    !Number.isInteger(Number(evidence.human_review_audit_id)) ||
    Number(evidence.human_review_audit_id) <= 0 ||
    !sha256(evidence.human_review_audit_sha256) ||
    !sha256(evidence.human_review_evidence_sha256)
  ) {
    blockers.push(
      "governed_window_exact_human_review_binding_required",
    );
  }
  if (
    evidence.admission?.human_review_status !== "approved" ||
    evidence.admission?.confirmation_story_id !==
      evidence.story_id ||
    evidence.admission?.scheduled_for !== scheduledFor
  ) {
    blockers.push("governed_window_admission_packet_invalid");
  }
  if (
    actionRole === "STANDBY" &&
    evidence.standby_authorised !== true
  ) {
    blockers.push(
      "governed_window_standby_authorisation_invalid",
    );
  }
  if (
    evidence.publish_authority !== false ||
    evidence.external_posting !== false ||
    evidence.immediate_scheduling !== false
  ) {
    blockers.push("governed_window_authority_safety_invalid");
  }
  return {
    valid: blockers.length === 0,
    blockers,
    role: actionRole,
    audit_id: Number(audit?.id) || null,
    story_id: text(evidence.story_id),
    authority_binding_sha256: claimedBinding,
    candidate_revision_sha256: sha256(
      evidence.candidate_revision_sha256,
    ),
    scheduled_for: scheduledFor,
    admission_run_at: evidence.admission_run_at || null,
    evidence,
  };
}

function activeJobStatus(value) {
  return ["pending", "claimed", "running"].includes(
    text(value).toLowerCase(),
  );
}

function exactPrimaryAdmissionJob({
  jobs,
  primary,
  scheduledAt,
}) {
  if (!primary) return null;
  const expectedRunAt = new Date(
    scheduledAt.getTime() - T75_OFFSET_MS,
  ).getTime();
  return (
    jobs
      .map((job) => ({
        ...job,
        payload: objectValue(job?.payload),
      }))
      .filter(
        (job) =>
          job.kind === "admit_governed_publication" &&
          activeJobStatus(job.status) &&
          text(job.story_id) === primary.story_id,
      )
      .find((job) => {
        let runAt;
        try {
          runAt = utcDate(
            job.run_at,
            "governed_window_primary_admission_run_at_invalid",
          ).getTime();
        } catch {
          return false;
        }
        return (
          runAt === expectedRunAt &&
          job.payload?.candidate_revision_sha256 ===
            primary.candidate_revision_sha256 &&
          job.payload?.admission?.scheduled_for ===
            primary.scheduled_for &&
          Number(
            job.payload?.window_candidate_authority?.audit_id,
          ) === primary.audit_id &&
          job.payload?.window_candidate_authority
            ?.authority_binding_sha256 ===
            primary.authority_binding_sha256
        );
      }) || null
  );
}

function uncoveredStatus(minutesRemaining) {
  if (minutesRemaining <= 90) {
    return {
      coverage_status: "MISSED_T90",
      escalation: "INCIDENT",
    };
  }
  if (minutesRemaining < 180) {
    return {
      coverage_status: "CRITICAL",
      escalation: "CRITICAL",
    };
  }
  if (minutesRemaining <= 360) {
    return {
      coverage_status: "AT_RISK",
      escalation: "WARNING",
    };
  }
  return {
    coverage_status: "BUILDING",
    escalation: "NONE",
  };
}

function windowInventory({
  now,
  scheduledAt,
  authorityAudits,
  jobs,
}) {
  const scheduledFor = scheduledAt.toISOString();
  const relevant = authorityAudits
    .filter((audit) => {
      const evidence = objectValue(audit?.evidence_json);
      return (
        evidence.scheduled_for === scheduledFor &&
        authorityRoleForAction(text(audit?.action))
      );
    })
    .map((audit) =>
      validateAuthorityAudit(audit, scheduledFor),
    );
  const blockers = relevant.flatMap((candidate) =>
    candidate.valid ? [] : candidate.blockers,
  );
  const valid = relevant.filter((candidate) => candidate.valid);
  const primaries = valid.filter(
    (candidate) => candidate.role === "PRIMARY",
  );
  const standbys = valid.filter(
    (candidate) => candidate.role === "STANDBY",
  );
  if (primaries.length !== 1) {
    blockers.push(
      primaries.length > 1
        ? "governed_window_multiple_primary_authorities"
        : "governed_window_primary_authority_required",
    );
  }
  if (standbys.length < 1) {
    blockers.push(
      "governed_window_standby_authority_required",
    );
  }
  const primary = primaries.length === 1 ? primaries[0] : null;
  const standby =
    standbys
      .slice()
      .sort((a, b) => b.audit_id - a.audit_id)[0] || null;
  if (
    primary &&
    standby &&
    primary.story_id === standby.story_id
  ) {
    blockers.push(
      "governed_window_distinct_candidates_required",
    );
  }
  const primaryJob = exactPrimaryAdmissionJob({
    jobs,
    primary,
    scheduledAt,
  });
  if (primary && !primaryJob) {
    blockers.push(
      "governed_window_primary_admission_t75_required",
    );
  }
  const uniqueBlockers = [...new Set(blockers)];
  const minutesRemaining = Math.floor(
    (scheduledAt.getTime() - now.getTime()) / (60 * 1000),
  );
  const covered = uniqueBlockers.length === 0;
  const state = covered
    ? {
        coverage_status: "COVERED",
        escalation: "NONE",
      }
    : uncoveredStatus(minutesRemaining);
  const roleCount =
    (primary ? 1 : 0) +
    (standby &&
    (!primary || standby.story_id !== primary.story_id)
      ? 1
      : 0);
  return {
    window_id: `youtube:${scheduledFor}`,
    platform: "youtube",
    scheduled_for: scheduledFor,
    minutes_remaining: minutesRemaining,
    review_deadline: new Date(
      scheduledAt.getTime() - REVIEW_OFFSET_MS,
    ).toISOString(),
    lock_deadline: new Date(
      scheduledAt.getTime() - T90_OFFSET_MS,
    ).toISOString(),
    coverage_status: state.coverage_status,
    escalation: state.escalation,
    verdict: covered ? "GREEN" : "HOLD",
    primary,
    standby,
    standby_count: standbys.length,
    primary_admission_job: primaryJob,
    supply_deficit: Math.max(0, 2 - roleCount),
    blockers: uniqueBlockers,
    catch_up_allowed: false,
    publish_authority: false,
    external_posting: false,
  };
}

function buildGovernedYoutubeWindowInventoryReport({
  now = new Date(),
  horizonHours = 36,
  authorityAudits = [],
  jobs = [],
} = {}) {
  const evaluatedAt = utcDate(
    now,
    "governed_window_inventory_time_invalid",
  );
  const windows = upcomingWindows(
    evaluatedAt,
    horizonHours,
  ).map((scheduledAt) =>
    windowInventory({
      now: evaluatedAt,
      scheduledAt,
      authorityAudits: Array.isArray(authorityAudits)
        ? authorityAudits
        : [],
      jobs: Array.isArray(jobs) ? jobs : [],
    }),
  );
  const blockers =
    windows.length === 0
      ? ["governed_window_inventory_no_upcoming_window"]
      : windows.flatMap((window) =>
          window.blockers.map(
            (blocker) => `${window.window_id}:${blocker}`,
          ),
        );
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: evaluatedAt.toISOString(),
    horizon_hours: Number(horizonHours),
    verdict:
      windows.length > 0 &&
      windows.every((window) => window.verdict === "GREEN")
        ? "GREEN"
        : "HOLD",
    windows,
    next_window: windows[0] || null,
    blockers: [...new Set(blockers)],
    catch_up_allowed: false,
    publish_authority: false,
    external_posting: false,
  };
}

function readGovernedYoutubeWindowInventoryReport({
  db,
  now = new Date(),
  horizonHours = 36,
} = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error(
      "governed_window_inventory_database_required",
    );
  }
  const authorityAudits = db
    .prepare(
      `SELECT
         id,
         action,
         target_type,
         target_id,
         decision,
         evidence_json
       FROM operator_audit_log
       WHERE action IN (
         'governed_youtube_window_primary',
         'governed_youtube_runway_standby'
       )
       ORDER BY id ASC`,
    )
    .all();
  const jobs = db
    .prepare(
      `SELECT
         id,
         kind,
         story_id,
         status,
         run_at,
         payload
       FROM jobs
       WHERE kind = 'admit_governed_publication'
         AND status IN ('pending', 'claimed', 'running')
       ORDER BY id ASC`,
    )
    .all();
  const report =
    buildGovernedYoutubeWindowInventoryReport({
      now,
      horizonHours,
      authorityAudits,
      jobs,
    });
  return {
    ...report,
    source: {
      authority_rows_read: authorityAudits.length,
      job_rows_read: jobs.length,
      candidate_page_limit_used: false,
      database_read_only: true,
    },
  };
}

function renderGovernedYoutubeWindowInventoryMarkdown(report = {}) {
  const lines = [
    "# Governed YouTube window inventory",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Overall verdict: ${report.verdict || "HOLD"}`,
    "Catch-up publishing: forbidden",
    "",
  ];
  for (const window of report.windows || []) {
    lines.push(
      `## ${window.scheduled_for || "unknown"} — ` +
        `${window.coverage_status || "UNKNOWN"} ` +
        `(${window.verdict || "HOLD"})`,
      "",
      `Minutes remaining: ${window.minutes_remaining}`,
      `Primary: ${window.primary?.story_id || "missing"}`,
      `Standby: ${window.standby?.story_id || "missing"}`,
      `T-75 admission: ${window.primary_admission_job?.id || "missing"}`,
      `Escalation: ${window.escalation || "UNKNOWN"}`,
      `Blockers: ${(window.blockers || []).join(", ") || "none"}`,
      "",
    );
  }
  if (!(report.windows || []).length) {
    lines.push("No upcoming governed window was found.", "");
  }
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  AUTHORITY_SCHEMA_VERSION,
  SCHEMA_VERSION,
  WINDOW_HOURS_UTC,
  buildGovernedYoutubeWindowInventoryReport,
  readGovernedYoutubeWindowInventoryReport,
  renderGovernedYoutubeWindowInventoryMarkdown,
  validateAuthorityAudit,
};
