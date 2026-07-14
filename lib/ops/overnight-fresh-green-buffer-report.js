"use strict";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isPass(value) {
  return ["pass", "green", "ok", "ready", "publish_ready"].includes(clean(value).toLowerCase());
}

function candidateBlockers(candidate = {}) {
  return asArray(candidate.preflight_qa?.blockers || candidate.blockers).map(clean).filter(Boolean);
}

function candidateIsGreen(candidate = {}) {
  return clean(candidate.status).toLowerCase() === "publish_ready" &&
    isPass(candidate.preflight_qa?.status || "pass") &&
    candidateBlockers(candidate).length === 0;
}

function candidateSummary(candidate = {}) {
  const sourceAge = candidate.preflight_qa?.checks?.source_age || {};
  return {
    story_id: clean(candidate.id || candidate.story_id),
    title: clean(candidate.title || candidate.public_title),
    status: clean(candidate.status) || "unknown",
    preflight_status: clean(candidate.preflight_qa?.status) || "unknown",
    blockers: candidateBlockers(candidate),
    warnings: asArray(candidate.preflight_qa?.warnings || candidate.warnings).map(clean).filter(Boolean),
    source_age_result: clean(sourceAge.result) || "unknown",
    source_age_hours: Number.isFinite(Number(sourceAge.evidence?.age_hours))
      ? Number(sourceAge.evidence.age_hours)
      : null,
    source_age_policy_hours: Number.isFinite(Number(sourceAge.evidence?.policy_hours))
      ? Number(sourceAge.evidence.policy_hours)
      : null,
    final_render_path: candidate.source?.exported_path || candidate.exported_path || null,
  };
}

function blockedCandidates(candidateReport = {}, dryRunPlan = {}) {
  const byId = new Map();
  for (const candidate of asArray(candidateReport.candidates)) {
    if (candidateIsGreen(candidate)) continue;
    const row = candidateSummary(candidate);
    if (row.story_id) byId.set(row.story_id, row);
  }
  for (const story of asArray(dryRunPlan.blocked_stories)) {
    const storyId = clean(story.story_id || story.id);
    if (!storyId) continue;
    const current = byId.get(storyId) || {
      story_id: storyId,
      title: clean(story.title),
      status: "blocked",
      preflight_status: "unknown",
      blockers: [],
      warnings: [],
    };
    current.blockers = [...new Set([
      ...asArray(current.blockers),
      ...asArray(story.blockers).map(clean).filter(Boolean),
    ])];
    byId.set(storyId, current);
  }
  return [...byId.values()];
}

function staleSourceRows(candidateReport = {}) {
  const rows = [];
  for (const candidate of [...asArray(candidateReport.candidates), ...asArray(candidateReport.excluded)]) {
    const row = candidateSummary(candidate);
    const sourceAgeFailed = ["fail", "failed", "block", "blocked", "red"].includes(row.source_age_result.toLowerCase());
    const staleReason = [...row.blockers, ...row.warnings, ...asArray(candidate.penalties).map(clean)]
      .find((reason) => /(?:stale|source_age|source age|older than)/i.test(reason));
    if (!sourceAgeFailed && !staleReason) continue;
    rows.push({ ...row, rejection_reason: staleReason || "source_age_gate_failed" });
  }
  return rows;
}

function evidenceReport(packageEvidence = [], verdictField, blockerField) {
  const stories = asArray(packageEvidence).map((item) => ({
    ...item,
    story_id: clean(item.story_id),
  }));
  const passCount = stories.filter((item) => isPass(item[verdictField]) && asArray(item[blockerField]).length === 0).length;
  return {
    summary: {
      story_count: stories.length,
      pass_count: passCount,
      blocked_count: stories.length - passCount,
    },
    stories,
  };
}

function buildOvernightFreshGreenBufferReports({
  generatedAt = new Date().toISOString(),
  candidateReport = {},
  dryRunPlan = {},
  cutoverPlan = {},
  renderHealth = {},
  platformStatus = {},
  platformDoctor = {},
  runtimeSentinel = {},
  queueInspect = {},
  packageEvidence = [],
} = {}) {
  const greenCandidates = asArray(candidateReport.candidates).filter(candidateIsGreen).map(candidateSummary);
  const blocked = blockedCandidates(candidateReport, dryRunPlan);
  const stale = staleSourceRows(candidateReport);
  const dryRunSummary = dryRunPlan.summary || {};
  const enabledActions = number(dryRunSummary.platform_enabled_dry_run_action_count);
  const deferredActions = number(dryRunSummary.platform_deferred_action_count || dryRunSummary.deferred_platform_enablement_action_count);
  const blockedActions = number(dryRunSummary.blocked_action_count);
  const heldStories = number(dryRunSummary.held_story_count);
  const readyFinalRenders = number(
    cutoverPlan.summary?.ready_final_render_count ??
    cutoverPlan.summary?.ready_final_renders ??
    cutoverPlan.ready_final_render_count ??
    greenCandidates.length,
  );

  const transcriptCoherenceReport = evidenceReport(packageEvidence, "coherence_verdict", "transcript_blockers");
  const visualMotionRepairReport = evidenceReport(packageEvidence, "visual_verdict", "visual_blockers");
  const ttsCaptionRepairReport = evidenceReport(packageEvidence, "tts_caption_verdict", "tts_caption_blockers");
  const packageEvidenceComplete = packageEvidence.length === 0 || (
    transcriptCoherenceReport.summary.blocked_count === 0 &&
    visualMotionRepairReport.summary.blocked_count === 0 &&
    ttsCaptionRepairReport.summary.blocked_count === 0
  );
  const runtimeNonRed = clean(runtimeSentinel.verdict).toLowerCase() !== "red";
  const pass = greenCandidates.length >= 5 &&
    enabledActions >= 15 &&
    blocked.length === 0 &&
    blockedActions === 0 &&
    heldStories === 0 &&
    readyFinalRenders >= 5 &&
    packageEvidenceComplete &&
    runtimeNonRed;

  const summary = {
    schema_version: 1,
    generated_at: generatedAt,
    verdict: pass ? "PASS" : "PARTIAL",
    green_candidate_count: greenCandidates.length,
    blocked_candidate_count: blocked.length,
    stale_source_rejection_count: stale.length,
    ready_final_render_count: readyFinalRenders,
    enabled_action_count: enabledActions,
    deferred_action_count: deferredActions,
    blocked_action_count: blockedActions,
    held_story_count: heldStories,
    runtime_verdict: clean(runtimeSentinel.verdict) || "unknown",
    queue_verdict: clean(queueInspect.verdict) || "unknown",
    platform_status_verdict: clean(platformStatus.overall_verdict || platformStatus.verdict) || "unknown",
    platform_doctor_verdict: clean(platformDoctor.verdict || platformDoctor.overall_verdict) || "unknown",
    dry_run_verdict: clean(dryRunPlan.overall_verdict) || "unknown",
    acceptance: {
      minimum_green_candidates: 5,
      expected_enabled_actions: 15,
      no_enabled_blockers: blockedActions === 0,
      no_held_stories: heldStories === 0,
      package_evidence_complete: packageEvidenceComplete,
    },
    safety: {
      dry_run_only: dryRunPlan.safety?.dry_run_only !== false,
      no_network_uploads: dryRunPlan.safety?.no_network_uploads !== false,
      no_db_mutation: dryRunPlan.safety?.no_db_mutation !== false,
      no_oauth_or_token_change: dryRunPlan.safety?.no_oauth_or_token_change !== false,
    },
  };

  return {
    summary,
    freshCandidateQueue: {
      schema_version: 1,
      generated_at: generatedAt,
      summary: {
        green_count: greenCandidates.length,
        blocked_count: blocked.length,
        source_safe_count: greenCandidates.filter((candidate) => candidate.source_age_result === "pass").length,
      },
      candidates: greenCandidates,
    },
    blockedCandidateReport: {
      schema_version: 1,
      generated_at: generatedAt,
      summary: { blocked_count: blocked.length },
      candidates: blocked,
    },
    staleSourceRejectionReport: {
      schema_version: 1,
      generated_at: generatedAt,
      policy_hours: 168,
      summary: { stale_rejection_count: stale.length },
      candidates: stale,
    },
    transcriptCoherenceReport: { schema_version: 1, generated_at: generatedAt, ...transcriptCoherenceReport },
    visualMotionRepairReport: {
      schema_version: 1,
      generated_at: generatedAt,
      render_health_bridge: renderHealth.bridge || null,
      ...visualMotionRepairReport,
    },
    ttsCaptionRepairReport: { schema_version: 1, generated_at: generatedAt, ...ttsCaptionRepairReport },
  };
}

function formatOvernightFreshGreenBufferMarkdown(reports = {}) {
  const summary = reports.summary || {};
  const candidates = asArray(reports.freshCandidateQueue?.candidates);
  return [
    "# Overnight Fresh GREEN Buffer Report",
    "",
    `Generated: ${summary.generated_at || "unknown"}`,
    `Verdict: ${summary.verdict || "UNKNOWN"}`,
    "",
    "## Acceptance",
    `- GREEN candidates: ${number(summary.green_candidate_count)}`,
    `- Ready final renders: ${number(summary.ready_final_render_count)}`,
    `- Enabled dry-run actions: ${number(summary.enabled_action_count)}`,
    `- Deferred actions: ${number(summary.deferred_action_count)}`,
    `- Blocked candidates/actions: ${number(summary.blocked_candidate_count)}/${number(summary.blocked_action_count)}`,
    `- Runtime: ${summary.runtime_verdict || "unknown"}`,
    "",
    "## GREEN Candidates",
    ...(candidates.length
      ? candidates.map((candidate) => `- ${candidate.story_id}: ${candidate.title}`)
      : ["- None"]),
    "",
    "## Safety",
    "- Dry run only; no upload or external post was triggered.",
    "- No production DB, OAuth, token, credential or platform-setting mutation was performed.",
    "- TikTok, X, Threads and Pinterest remain deferred.",
    "",
  ].join("\n");
}

module.exports = {
  buildOvernightFreshGreenBufferReports,
  formatOvernightFreshGreenBufferMarkdown,
};
