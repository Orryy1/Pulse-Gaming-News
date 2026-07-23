"use strict";

const P0_POST_AGE_HOURS = 48;

function clean(value) {
  return String(value || "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function verdictIsGreen(value) {
  return clean(value).toLowerCase() === "green";
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ageHours(value, generatedAt) {
  const at = parseDate(value);
  const now = parseDate(generatedAt);
  if (!at || !now) return null;
  return Math.max(0, Math.round(((now.getTime() - at.getTime()) / 3_600_000) * 100) / 100);
}

function findVoice(ttsHealth, alias = "liam") {
  return asArray(ttsHealth?.voices).find(
    (voice) => clean(voice?.alias).toLowerCase() === clean(alias).toLowerCase(),
  ) || null;
}

function currentBottleneck({
  candidateCount,
  runtimeParity,
  voiceRightsReady,
  readinessVerdict,
}) {
  if (candidateCount === 0) {
    return "No scheduler-authoritative candidate is available.";
  }
  if (!runtimeParity) {
    return "Runtime commit parity is RED.";
  }
  if (!voiceRightsReady) {
    return "Generated narration voice rights are not approved.";
  }
  if (!verdictIsGreen(readinessVerdict)) {
    return "Publish readiness is not GREEN.";
  }
  return null;
}

function buildCadenceIncidentSnapshot({
  generatedAt = new Date().toISOString(),
  cadenceReport = {},
  candidateReport = {},
  readinessReport = {},
  runtimeReport = {},
  queueReport = {},
  ttsHealth = {},
  voiceRightsReview = {},
  externalEvidence = {},
  recentCandidateFailures = null,
  firstFreshCandidate = null,
  commercial = null,
} = {}) {
  const candidateCount = Number(candidateReport?.totals?.candidates || 0);
  const expectedCommit = clean(runtimeReport?.expected?.commit_sha);
  const runningCommit = clean(runtimeReport?.summary?.commit_sha);
  const runtimeParity = Boolean(
    expectedCommit &&
    runningCommit &&
    expectedCommit === runningCommit &&
    verdictIsGreen(runtimeReport?.verdict),
  );
  const processReady = (
    ttsHealth?.ready === true &&
    clean(ttsHealth?.status).toLowerCase() === "ok" &&
    clean(ttsHealth?.phase).toLowerCase() === "ready"
  );
  const voiceRightsReady = verdictIsGreen(voiceRightsReview?.verdict);
  const latestVerifiedPostAt = externalEvidence?.latest_verified_post_at || null;
  const latestVerifiedPostAgeHours = ageHours(latestVerifiedPostAt, generatedAt);
  const postTooOld = latestVerifiedPostAgeHours == null
    ? false
    : latestVerifiedPostAgeHours > P0_POST_AGE_HOURS;
  const cadenceP0 = candidateCount === 0 || postTooOld;
  const readinessVerdict = clean(readinessReport?.overall_verdict).toLowerCase() || "unknown";
  const voice = findVoice(ttsHealth);
  const bottleneck = currentBottleneck({
    candidateCount,
    runtimeParity,
    voiceRightsReady,
    readinessVerdict,
  });
  const nextSafeWindow = cadenceReport?.summary?.next_safe_publish_at_utc || null;
  const nextSafeWindowUsable = Boolean(
    nextSafeWindow &&
    candidateCount > 0 &&
    runtimeParity &&
    processReady &&
    voiceRightsReady &&
    verdictIsGreen(readinessVerdict),
  );

  return {
    schema_version: 2,
    generated_at: generatedAt,
    incident_id: `publish-cadence-p0-${generatedAt.slice(0, 10).replace(/-/g, "")}`,
    status: cadenceP0 || bottleneck ? "RED" : "GREEN",
    severity: cadenceP0 ? "P0" : null,
    reason: cadenceP0
      ? "latest externally evidenced post exceeds 48 hours or scheduler-authoritative candidate count is zero"
      : null,
    current_bottleneck: bottleneck,
    cadence: {
      latest_externally_verified_post_at: latestVerifiedPostAt,
      latest_externally_verified_post_age_hours: latestVerifiedPostAgeHours,
      external_platform_inventory_checked: externalEvidence?.inventory_checked === true,
      seven_day_post_count_by_enabled_platform:
        externalEvidence?.seven_day_post_count_by_enabled_platform ?? null,
      external_inventory_limitation: externalEvidence?.limitation || null,
      db_window_published_count: Number(cadenceReport?.summary?.published_count || 0),
      scheduled_count: Number(cadenceReport?.summary?.scheduled_count || 0),
    },
    scheduler: {
      authoritative_candidate_count: candidateCount,
      excluded_count: Number(candidateReport?.totals?.excluded || 0),
      authority_mode: candidateReport?.bridge_candidates?.mode || null,
      next_safe_window_at: nextSafeWindow,
      next_safe_window_usable: nextSafeWindowUsable,
      publish_readiness_verdict: readinessVerdict,
      publish_readiness_blockers: asArray(readinessReport?.blockers),
    },
    tts: {
      process_ready: processReady,
      process_status: ttsHealth?.status || null,
      process_phase: ttsHealth?.phase || null,
      voice_alias: voice?.alias || null,
      loaded_reference_id: voice?.accepted_reference_id || null,
      loaded_reference_present: voice?.reference_present === true,
      voice_rights_ready: voiceRightsReady,
      generated_voice_candidate_sha256:
        voiceRightsReview?.candidate?.sha256 ||
        voiceRightsReview?.reference?.sha256 ||
        voiceRightsReview?.candidate_sha256 ||
        null,
      voice_rights_blockers: asArray(voiceRightsReview?.blockers),
      effective_readiness: processReady && voiceRightsReady ? "GREEN" : "RED",
    },
    runtime: {
      verdict: clean(runtimeReport?.verdict).toUpperCase() || "UNKNOWN",
      expected_commit: expectedCommit || null,
      running_commit: runningCommit || null,
      commit_parity: runtimeParity,
      blockers: asArray(runtimeReport?.blockers),
      warnings: asArray(runtimeReport?.warnings),
      recommendation: runtimeReport?.recommendation || null,
    },
    queue: {
      verdict: queueReport?.verdict || null,
      counts: {
        pending: Number(queueReport?.counts?.pending || 0),
        running: Number(queueReport?.counts?.running || 0),
        failed: Number(queueReport?.counts?.failed || 0),
        done: Number(queueReport?.counts?.done || 0),
      },
      content_runway: queueReport?.contentRunway || null,
      warnings: asArray(queueReport?.warnings),
    },
    recent_candidate_failures: recentCandidateFailures,
    first_fresh_candidate: firstFreshCandidate,
    commercial: commercial || {
      realised_revenue_gbp: 0,
      evidence_status: "no_primary_revenue_evidence_available",
    },
    safety: {
      read_only: true,
      live_publish_triggered: false,
      database_mutated: false,
      oauth_or_tokens_changed: false,
      quality_or_rights_gate_weakened: false,
    },
  };
}

module.exports = {
  P0_POST_AGE_HOURS,
  buildCadenceIncidentSnapshot,
};
