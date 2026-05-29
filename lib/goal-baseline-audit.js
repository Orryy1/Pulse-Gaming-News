"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const TRUTH_SURFACES = [
  "live_db_truth",
  "bridge_artefact_truth",
  "dry_run_package_truth",
  "platform_upload_truth",
  "publish_control_truth",
];

const OUTPUT_FILES = {
  baseline_audit_report_json: "baseline_audit_report.json",
  baseline_audit_report_md: "baseline_audit_report.md",
  blocker_taxonomy_json: "blocker_taxonomy.json",
  immediate_repair_order_json: "immediate_repair_order.json",
  cutover_readiness_matrix_json: "cutover_readiness_matrix.json",
};

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === "object") {
    for (const key of ["stories", "candidates", "bridge_candidates", "items", "work_orders", "jobs"]) {
      if (Array.isArray(value[key])) return value[key].filter(Boolean);
    }
  }
  return [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value) {
  const number = numberOrNull(value);
  return number == null ? 0 : number;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number != null) return number;
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function upperVerdict(value, fallback = "UNKNOWN") {
  const text = cleanText(value).toUpperCase();
  if (["GREEN", "AMBER", "RED", "PASS", "FAIL", "BLOCKED", "READY"].includes(text)) {
    if (text === "PASS" || text === "READY") return "GREEN";
    if (text === "FAIL" || text === "BLOCKED") return "RED";
    return text;
  }
  return fallback;
}

function normaliseJsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalisePlatformMap(report = {}) {
  const raw = normaliseJsonObject(report).platforms || {};
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map((entry) => [cleanText(entry.platform || entry.id || entry.name), entry]).filter(([key]) => key));
  }
  return normaliseJsonObject(raw);
}

function hasAnyKeyValue(object = {}, keys = [], expectedValue) {
  if (!object || typeof object !== "object") return false;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key) && object[key] === expectedValue) return true;
  }
  return false;
}

function blockerTextForStory(storyId, storyBlockers = new Map()) {
  return cleanText(asArray(storyBlockers.get(storyId)).join(" "));
}

function indexStoryBlockers({ storyPackages = [], dryRunPlan = {} } = {}) {
  const map = new Map();
  const add = (storyId, blockers) => {
    const id = cleanText(storyId);
    if (!id) return;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(...asArray(blockers).map(cleanText).filter(Boolean));
  };

  for (const story of asArray(storyPackages)) {
    add(story.story_id || story.id, story.blockers || story.rejection_reasons || story.reason_codes);
  }
  for (const story of asArray(dryRunPlan.blocked_stories || dryRunPlan.failed_preflight_candidates)) {
    add(story.story_id || story.id, story.blockers || story.rejection_reasons || story.reason_codes);
  }
  return map;
}

function evidenceStories(dryRunPlan = {}, explicitIncidentGuardReport = null) {
  const incident = normaliseJsonObject(explicitIncidentGuardReport || dryRunPlan.incident_guard_report);
  return asArray(incident.stories || incident.results || incident.candidates);
}

function skippedStoryIdSet(dryRunPlan = {}) {
  return new Set(
    asArray(dryRunPlan.skipped_stories)
      .map((story) => cleanText(story.story_id || story.id))
      .filter(Boolean),
  );
}

function countMissingEvidence({
  stories = [],
  storyBlockers = new Map(),
  evidenceKeys = [],
  blockerPatterns = [],
} = {}) {
  const missing = new Set();
  for (const story of stories) {
    const storyId = cleanText(story.story_id || story.id);
    const evidence = normaliseJsonObject(story.file_evidence || story.evidence || story.files);
    if (storyId && hasAnyKeyValue(evidence, evidenceKeys, false)) missing.add(storyId);
  }

  for (const [storyId, blockers] of storyBlockers.entries()) {
    const haystack = lowerText(blockers.join(" "));
    if (blockerPatterns.some((pattern) => pattern.test(haystack))) missing.add(storyId);
  }

  return missing.size;
}

function buildDryRunPackageTruth({
  storyPackages = [],
  dryRunPlan = {},
  incidentGuardReport = null,
} = {}) {
  const summary = normaliseJsonObject(dryRunPlan.summary);
  const storyBlockers = indexStoryBlockers({ storyPackages, dryRunPlan });
  const skippedIds = skippedStoryIdSet(dryRunPlan);
  const stories = evidenceStories(dryRunPlan, incidentGuardReport).filter(
    (story) => !skippedIds.has(cleanText(story.story_id || story.id)),
  );
  const count = (evidenceKeys, blockerPatterns) =>
    countMissingEvidence({ stories, storyBlockers, evidenceKeys, blockerPatterns });

  return {
    story_count: firstNumber(summary.story_count, storyPackages.length, asArray(dryRunPlan.stories).length) || 0,
    ready_story_count: numberOrZero(summary.ready_story_count),
    blocked_story_count: numberOrZero(summary.blocked_story_count || asArray(dryRunPlan.blocked_stories).length),
    skipped_story_count: numberOrZero(summary.skipped_story_count || asArray(dryRunPlan.skipped_stories).length),
    planned_action_count: firstNumber(summary.planned_action_count, asArray(dryRunPlan.actions).length) || 0,
    candidate_platform_action_count:
      firstNumber(summary.candidate_platform_action_count, summary.planned_action_count, asArray(dryRunPlan.actions).length) || 0,
    enabled_platform_dry_run_action_count:
      firstNumber(summary.platform_enabled_dry_run_action_count, summary.platform_publish_now_action_count) || 0,
    enabled_human_review_action_count:
      firstNumber(summary.enabled_human_review_action_count, summary.human_review_required_action_count) || 0,
    deferred_platform_enablement_action_count:
      firstNumber(summary.deferred_platform_enablement_action_count, summary.platform_deferred_action_count) || 0,
    live_publish_allowed_action_count: firstNumber(summary.live_publish_allowed_action_count) || 0,
    blocked_action_count: numberOrZero(summary.blocked_action_count || asArray(dryRunPlan.blocked_actions).length),
    scheduler_preflight_checked_story_count: numberOrZero(summary.preflight_checked_story_count),
    incident_guard_failed_story_count: numberOrZero(summary.incident_guard_failed_story_count),
    missing_final_mp4_count: count(
      ["mp4_ready", "final_mp4_ready", "final_render_ready", "video_ready"],
      [/\bmissing[_: -]?final[_: -]?mp4\b/i, /\bmp4[_: -]?missing\b/i, /\bmissing[_: -]?mp4\b/i],
    ),
    missing_narration_audio_count: count(
      ["narration_ready", "narration_audio_ready", "final_narration_audio_ready", "audio_ready"],
      [/\bmissing[_: -]?narration\b/i, /\bnarration[_: -]?audio[_: -]?missing\b/i, /\baudio[_: -]?missing\b/i],
    ),
    missing_word_timestamps_count: count(
      ["word_timestamps_ready", "timestamps_ready", "word_timing_ready"],
      [/\bmissing[_: -]?word[_: -]?timestamps\b/i, /\btimestamps[_: -]?missing\b/i],
    ),
    missing_captions_count: count(
      ["captions_ready", "caption_file_ready", "srt_ready"],
      [/\bmissing[_: -]?captions\b/i, /\bcaption[_: -]?missing\b/i, /\bsrt[_: -]?missing\b/i],
    ),
    missing_materialised_motion_clips_count: count(
      ["materialised_motion_ready", "materialised_motion_clips_ready", "motion_clips_ready"],
      [/\bmissing[_: -]?materialised[_: -]?motion\b/i, /\bmaterialised[_: -]?motion[_: -]?clips[_: -]?missing\b/i],
    ),
    missing_distinct_motion_families_count: count(
      ["distinct_motion_families_ready", "motion_families_ready"],
      [/\bmissing[_: -]?distinct[_: -]?motion\b/i, /\bdistinct[_: -]?motion[_: -]?families[_: -]?missing\b/i],
    ),
    incomplete_rights_record_count: count(
      ["rights_ledger_ready", "rights_record_ready", "rights_ready"],
      [/\bmissing[_: -]?rights\b/i, /\bright(s)?[_: -]?record[_: -]?missing\b/i, /\bright(s)?[_: -]?ledger[_: -]?missing\b/i],
    ),
  };
}

function buildLiveDbTruth({ renderHealthReport = {}, liveDbHealthReport = {} } = {}) {
  const live = normaliseJsonObject(liveDbHealthReport);
  const render = normaliseJsonObject(renderHealthReport);
  return {
    stamped_render_count: firstNumber(live.stamped_render_count, live.stamped, render.stamped) || 0,
    unstamped_legacy_row_count: firstNumber(live.unstamped_legacy_row_count, live.unstamped, render.unstamped) || 0,
    missing_mp4_count: firstNumber(live.missing_mp4_count, live.missing_mp4s, render.missing_mp4_count),
    total_recent_rows: firstNumber(live.total_recent_rows, live.total_in_window, render.total_in_window),
    thin_legacy_render_count: firstNumber(live.thin_legacy_render_count, live.thin_count, render.thin_count) || 0,
    lane_counts: normaliseJsonObject(live.lane_counts || live.lane || render.lane),
    source: live.source || render.source || "render_health_report",
  };
}

function candidateVerdict(candidate = {}) {
  return upperVerdict(
    firstString(
      candidate.control_tower_verdict,
      candidate.publish_verdict && candidate.publish_verdict.verdict,
      candidate.verdict,
      candidate.publish_status,
      candidate.status,
    ),
  );
}

function hasEvidence(candidate = {}, keys = []) {
  const haystack = normaliseJsonObject(candidate.evidence || candidate.file_evidence || candidate.proof || {});
  return keys.some((key) => {
    const value = candidate[key] ?? haystack[key];
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    if (typeof value === "number") return value > 0;
    return Boolean(value);
  });
}

function buildBridgeArtefactTruth({ schedulerBridgeCandidates = [], bridgeHealthReport = {} } = {}) {
  const candidates = asArray(schedulerBridgeCandidates);
  const counts = { GREEN: 0, AMBER: 0, RED: 0, UNKNOWN: 0 };
  for (const candidate of candidates) counts[candidateVerdict(candidate)] = (counts[candidateVerdict(candidate)] || 0) + 1;
  const bridgeHealth = normaliseJsonObject(bridgeHealthReport);
  return {
    candidate_count: candidates.length,
    green_count: counts.GREEN || 0,
    amber_count: counts.AMBER || 0,
    red_count: counts.RED || 0,
    unknown_count: counts.UNKNOWN || 0,
    final_render_evidence_count: candidates.filter((candidate) =>
      hasEvidence(candidate, ["exported_path", "final_render_path", "final_mp4_path", "mp4_path", "final_render_evidence", "final_mp4_evidence"]),
    ).length,
    narration_evidence_count: candidates.filter((candidate) =>
      hasEvidence(candidate, ["audio_path", "narration_path", "final_narration_audio_path", "narration_evidence"]),
    ).length,
    timestamp_evidence_count: candidates.filter((candidate) =>
      hasEvidence(candidate, ["timestamps_path", "word_timestamps_path", "word_timestamp_evidence", "timestamp_evidence"]),
    ).length,
    materialised_motion_evidence_count: candidates.filter((candidate) =>
      hasEvidence(candidate, [
        "visual_v4_bridge_video_clips",
        "video_clips",
        "visual_v4_render_bridge_clip_count",
        "materialised_motion_manifest_path",
        "motion_evidence",
        "motion_materialisation_evidence",
      ]),
    ).length,
    rights_evidence_count: candidates.filter((candidate) =>
      hasEvidence(candidate, ["rights_ledger", "rights_ledger_path", "rights_evidence", "rights_manifest_id"]),
    ).length,
    bridge_health_summary: normaliseJsonObject(bridgeHealth.summary || bridgeHealth),
  };
}

function normalisePlatformStatus(platform = {}) {
  const state = firstString(platform.state, platform.operational_state, platform.status, "unknown");
  const status = firstString(platform.status, platform.state, state);
  const blockers = asArray(platform.blockers || platform.failures || platform.rejection_reasons).map(cleanText).filter(Boolean);
  const warnings = asArray(platform.warnings).map(cleanText).filter(Boolean);
  return {
    platform: firstString(platform.platform, platform.id, platform.name),
    state,
    status,
    operational_state: firstString(platform.operational_state, state),
    publish_now_action_count: numberOrZero(platform.publish_now_action_count || platform.publishable_now_count),
    deferred_action_count: numberOrZero(platform.deferred_action_count || platform.queued_when_enabled_count),
    blocked_action_count: numberOrZero(platform.blocked_action_count),
    blockers,
    warnings,
  };
}

function buildPlatformUploadTruth({ platformStatusMatrix = {}, platformUploadPreflightReport = {} } = {}) {
  const summary = normaliseJsonObject(platformStatusMatrix.summary || platformUploadPreflightReport.summary);
  const rawPlatforms = normalisePlatformMap(platformStatusMatrix);
  const platforms = {};
  for (const [key, value] of Object.entries(rawPlatforms)) {
    platforms[key] = normalisePlatformStatus({ platform: key, ...normaliseJsonObject(value) });
  }
  const allPlatforms = Object.values(platforms);
  const disabledCount = allPlatforms.filter((platform) =>
    ["disabled", "operator_disabled", "blocked_external"].includes(lowerText(platform.state || platform.operational_state)),
  ).length;
  const instagramFailures = allPlatforms.filter((platform) =>
    /instagram|meta|facebook/.test(lowerText(platform.platform)) &&
      [platform.status, platform.state, platform.operational_state, platform.blockers.join(" "), platform.warnings.join(" ")]
        .some((value) => /fail|blocked|error|url processing/.test(lowerText(value))),
  ).length;

  return {
    overall_verdict: upperVerdict(platformStatusMatrix.overall_verdict || platformUploadPreflightReport.verdict, "UNKNOWN"),
    platform_count: firstNumber(summary.platform_count, allPlatforms.length) || 0,
    disabled_platform_count: firstNumber(summary.disabled_platform_count, disabledCount) || 0,
    blocked_action_count: firstNumber(summary.blocked_action_count, allPlatforms.reduce((sum, platform) => sum + platform.blocked_action_count, 0)) || 0,
    publish_now_action_count: firstNumber(summary.publish_now_action_count, allPlatforms.reduce((sum, platform) => sum + platform.publish_now_action_count, 0)) || 0,
    instagram_meta_failure_count: instagramFailures,
    platforms,
  };
}

function buildPublishControlTruth({ publishVerdict = {}, dryRunPlan = {} } = {}) {
  const summary = normaliseJsonObject(publishVerdict.summary || dryRunPlan.summary);
  const verdict = upperVerdict(publishVerdict.verdict || dryRunPlan.overall_verdict || dryRunPlan.verdict, "UNKNOWN");
  const safe = publishVerdict.safe_to_publish_boolean ?? publishVerdict.safe_to_publish ?? dryRunPlan.safe_to_publish_boolean ?? false;
  return {
    verdict,
    safe_to_publish_boolean: safe === true,
    mode: firstString(publishVerdict.mode, dryRunPlan.mode, "DRY_RUN_PUBLISH"),
    planned_action_count: firstNumber(publishVerdict.planned_action_count, summary.planned_action_count) || 0,
    candidate_platform_action_count:
      firstNumber(publishVerdict.candidate_platform_action_count, summary.candidate_platform_action_count, summary.planned_action_count) || 0,
    enabled_platform_dry_run_action_count:
      firstNumber(
        publishVerdict.enabled_platform_dry_run_action_count,
        publishVerdict.platform_enabled_dry_run_action_count,
        publishVerdict.platform_publish_now_action_count,
        summary.platform_enabled_dry_run_action_count,
        summary.platform_publish_now_action_count,
      ) || 0,
    enabled_human_review_action_count:
      firstNumber(
        publishVerdict.enabled_human_review_action_count,
        publishVerdict.human_review_required_action_count,
        summary.enabled_human_review_action_count,
        summary.human_review_required_action_count,
      ) || 0,
    deferred_platform_enablement_action_count:
      firstNumber(
        publishVerdict.deferred_platform_enablement_action_count,
        publishVerdict.platform_deferred_action_count,
        summary.deferred_platform_enablement_action_count,
        summary.platform_deferred_action_count,
      ) || 0,
    live_publish_allowed_action_count:
      firstNumber(publishVerdict.live_publish_allowed_action_count, summary.live_publish_allowed_action_count) || 0,
    blockers: asArray(publishVerdict.blockers || dryRunPlan.blockers).map(cleanText).filter(Boolean),
  };
}

function buildAnalyticsLoopTruth(report = {}) {
  const input = normaliseJsonObject(report);
  const status = firstString(input.status, input.verdict, input.overall_status, input.state, "unknown");
  return {
    status,
    fallback_used: input.fallback_used === true || input.deterministic_fallback_used === true,
    failures: asArray(input.failures || input.errors || input.blockers).map(cleanText).filter(Boolean),
    recommendation_count: asArray(input.recommendations).length,
  };
}

function buildLocalLlmTruth(report = {}) {
  const input = normaliseJsonObject(report);
  return {
    status: firstString(input.status, input.verdict, input.overall_status, input.state, "unknown"),
    failures: asArray(input.failures || input.errors || input.blockers).map(cleanText).filter(Boolean),
    fallback_used: input.fallback_used === true || input.deterministic_fallback_used === true,
  };
}

function buildRepairBacklog({ renderInputWorkOrder = {}, pipelineBacklog = {} } = {}) {
  const summary = normaliseJsonObject(renderInputWorkOrder.summary || pipelineBacklog.summary);
  const orders = asArray(renderInputWorkOrder.work_orders || renderInputWorkOrder.jobs || pipelineBacklog.items);
  return {
    story_count: numberOrZero(summary.story_count),
    blocked_story_count: numberOrZero(summary.blocked_on_render_inputs_count || summary.blocked_story_count),
    auto_repairable_blocker_count: numberOrZero(summary.auto_repairable_jobs || summary.auto_repairable_blockers),
    operator_required_blocker_count: numberOrZero(summary.operator_required_jobs || summary.operator_required_blockers),
    dead_end_blocker_count: numberOrZero(summary.dead_end_blocker_jobs || summary.dead_end_blockers),
    work_order_count: orders.length,
    work_orders: orders.map((order) => {
      const action = asArray(order.actions)[0] || {};
      return {
        story_id: cleanText(order.story_id || order.id),
        blocker_type: cleanText(
          order.blocker_type ||
            order.type ||
            asArray(order.blockers)[0] ||
            action.exact_missing_input ||
            asArray(action.reason_codes)[0] ||
            action.action_id,
        ),
        repair_lane: cleanText(order.repair_lane || order.lane || action.repair_lane),
        recommended_command: cleanText(order.recommended_command || order.command || action.recommended_command),
      };
    }),
  };
}

function buildProductionRenderTruth({
  storyPackages = [],
  dryRunPlan = {},
  schedulerBridgeCandidates = [],
} = {}) {
  const packages = asArray(storyPackages);
  const bridgeCandidates = asArray(schedulerBridgeCandidates);
  const dryRunSummary = normaliseJsonObject(dryRunPlan.summary);
  const counts = { GREEN: 0, AMBER: 0, RED: 0, UNKNOWN: 0 };
  for (const story of packages) {
    const verdict = upperVerdict(story.verdict || story.publish_status || story.status, "UNKNOWN");
    counts[verdict] = (counts[verdict] || 0) + 1;
  }
  return {
    package_count: packages.length,
    green_count: counts.GREEN || 0,
    amber_count: counts.AMBER || 0,
    red_count: counts.RED || 0,
    unknown_count: counts.UNKNOWN || 0,
    artifact_dir_count: packages.filter((story) => cleanText(story.artifact_dir || story.artifactDir)).length,
    dry_run_ready_story_count: firstNumber(dryRunSummary.ready_story_count, asArray(dryRunPlan.ready_stories).length) || 0,
    dry_run_blocked_story_count: firstNumber(dryRunSummary.blocked_story_count, asArray(dryRunPlan.blocked_stories).length) || 0,
    scheduler_bridge_candidate_count: bridgeCandidates.length,
    scheduler_bridge_final_render_evidence_count: bridgeCandidates.filter((candidate) =>
      hasEvidence(candidate, ["exported_path", "final_render_path", "final_mp4_path", "mp4_path", "final_render_evidence", "final_mp4_evidence"]),
    ).length,
  };
}

function readinessVerdict(report = {}) {
  const dryRunPackageTruth = normaliseJsonObject(report.dry_run_package_truth || report.dryRunPackageTruth);
  const platformUploadTruth = normaliseJsonObject(report.platform_upload_truth || report.platformUploadTruth);
  const publishControlTruth = normaliseJsonObject(report.publish_control_truth || report.publishControlTruth);
  const bridgeArtefactTruth = normaliseJsonObject(report.bridge_artefact_truth || report.bridgeArtefactTruth);
  if (publishControlTruth.safe_to_publish_boolean !== true) return "RED";
  if (publishControlTruth.verdict === "RED") return "RED";
  if (dryRunPackageTruth.ready_story_count <= 0) return "RED";
  if (bridgeArtefactTruth.green_count <= 0) return "RED";
  if (platformUploadTruth.blocked_action_count > 0 || platformUploadTruth.disabled_platform_count > 0) return "AMBER";
  return "GREEN";
}

function buildBaselineAuditReport(inputs = {}) {
  const storyPackages = asArray(inputs.storyPackages);
  const dryRunPlan = normaliseJsonObject(inputs.dryRunPlan);
  const renderInputWorkOrder = normaliseJsonObject(inputs.renderInputWorkOrder);
  const liveDbTruth = buildLiveDbTruth(inputs);
  const bridgeArtefactTruth = buildBridgeArtefactTruth(inputs);
  const dryRunPackageTruth = buildDryRunPackageTruth({
    storyPackages,
    dryRunPlan,
    incidentGuardReport: inputs.incidentGuardReport,
  });
  const platformUploadTruth = buildPlatformUploadTruth(inputs);
  const publishControlTruth = buildPublishControlTruth(inputs);
  const repairBacklog = buildRepairBacklog({ renderInputWorkOrder, pipelineBacklog: inputs.pipelineBacklog });
  const productionRenderTruth = buildProductionRenderTruth({
    storyPackages,
    dryRunPlan,
    schedulerBridgeCandidates: inputs.schedulerBridgeCandidates,
  });
  const analyticsLoopTruth = buildAnalyticsLoopTruth(inputs.analyticsReport);
  const localLlmTruth = buildLocalLlmTruth(inputs.localLlmReport);
  const report = {
    schema_version: 1,
    report_type: "current_state_baseline_audit",
    generated_at: inputs.generatedAt || new Date().toISOString(),
    mode: "LOCAL_PROOF",
    readiness_verdict: "UNKNOWN",
    truth_surfaces: TRUTH_SURFACES,
    production_render_truth: productionRenderTruth,
    live_db_truth: liveDbTruth,
    bridge_artefact_truth: bridgeArtefactTruth,
    dry_run_package_truth: dryRunPackageTruth,
    platform_upload_truth: platformUploadTruth,
    publish_control_truth: publishControlTruth,
    analytics_loop_truth: analyticsLoopTruth,
    local_llm_truth: localLlmTruth,
    repair_backlog: repairBacklog,
    safety: {
      no_live_publish: true,
      no_external_posting: true,
      no_production_db_mutation: true,
      no_oauth_or_token_mutation: true,
      no_token_or_env_exposure: true,
    },
  };
  report.readiness_verdict = readinessVerdict(report);
  report.blocker_summary = buildBlockerTaxonomy(report).summary;
  return report;
}

function emptyCategory(name, command = "") {
  return {
    name,
    count: 0,
    story_ids: [],
    blockers: [],
    recommended_command: command,
  };
}

function categoryForBlocker(blocker = "") {
  const text = lowerText(blocker);
  if (/narration|audio|timestamp|caption|mp4|motion|family|render_input/.test(text)) return "render_inputs";
  if (/right|licen[cs]e|asset_governance/.test(text)) return "rights";
  if (/platform|instagram|meta|tiktok|youtube|twitter|\bx\b|upload/.test(text)) return "platform_upload";
  if (/title|thumbnail|source|reddit|coherence|public|internal qa|script/.test(text)) return "public_output";
  if (/governance|control|verdict|incident|preflight/.test(text)) return "publish_control";
  if (/analytics|retention|llm|ollama|model/.test(text)) return "analytics";
  return "unknown";
}

function addCategoryBlocker(categories, categoryKey, storyId, blocker) {
  const category = categories[categoryKey] || categories.unknown;
  category.count += 1;
  const id = cleanText(storyId);
  const reason = cleanText(blocker);
  if (id && !category.story_ids.includes(id)) category.story_ids.push(id);
  if (reason && !category.blockers.includes(reason)) category.blockers.push(reason);
}

function buildBlockerTaxonomy(report = {}) {
  const categories = {
    render_inputs: emptyCategory("Render inputs", "npm run ops:goal-render-inputs"),
    rights: emptyCategory("Rights ledger", "npm run ops:bridge-live-rights-repair"),
    public_output: emptyCategory("Public output coherence", "npm run ops:goal-public-copy-repair"),
    platform_upload: emptyCategory("Platform upload", "npm run ops:platform-doctor"),
    publish_control: emptyCategory("Publish control", "npm run ops:goal-dry-run-publish"),
    analytics: emptyCategory("Analytics and local LLM", "npm run ops:retention-intelligence"),
    unknown: emptyCategory("Unknown", "npm run ops:pipeline-backlog"),
  };

  const dryRun = normaliseJsonObject(report.dry_run_package_truth);
  const missingPairs = [
    ["render_inputs", "missing_final_mp4", dryRun.missing_final_mp4_count],
    ["render_inputs", "missing_final_narration_audio", dryRun.missing_narration_audio_count],
    ["render_inputs", "missing_word_timestamps", dryRun.missing_word_timestamps_count],
    ["render_inputs", "missing_caption_file", dryRun.missing_captions_count],
    ["render_inputs", "missing_materialised_motion_clips", dryRun.missing_materialised_motion_clips_count],
    ["render_inputs", "missing_distinct_motion_families", dryRun.missing_distinct_motion_families_count],
    ["rights", "incomplete_rights_record", dryRun.incomplete_rights_record_count],
    ["platform_upload", "disabled_platform", report.platform_upload_truth && report.platform_upload_truth.disabled_platform_count],
    ["platform_upload", "platform_blocked_action", report.platform_upload_truth && report.platform_upload_truth.blocked_action_count],
    ["publish_control", "publish_control_red", report.publish_control_truth && report.publish_control_truth.verdict === "RED" ? 1 : 0],
    ["analytics", "analytics_loop_failure", lowerText(report.analytics_loop_truth && report.analytics_loop_truth.status).includes("fail") ? 1 : 0],
    ["analytics", "local_llm_failure", lowerText(report.local_llm_truth && report.local_llm_truth.status).includes("fail") ? 1 : 0],
  ];

  for (const [category, blocker, count] of missingPairs) {
    for (let index = 0; index < numberOrZero(count); index += 1) addCategoryBlocker(categories, category, "", blocker);
  }

  for (const order of asArray(report.repair_backlog && report.repair_backlog.work_orders)) {
    const blocker = cleanText(order.blocker_type || order.repair_lane);
    addCategoryBlocker(categories, categoryForBlocker(blocker), order.story_id, blocker);
  }

  return {
    schema_version: 1,
    generated_at: report.generated_at || new Date().toISOString(),
    categories,
    summary: {
      total_blocker_count: Object.values(categories).reduce((sum, category) => sum + category.count, 0),
      top_category: Object.entries(categories).sort((a, b) => b[1].count - a[1].count)[0][0],
    },
  };
}

function addRepair(repairs, blockerType, count, command, lane, reason) {
  if (numberOrZero(count) <= 0) return;
  repairs.push({
    priority: repairs.length + 1,
    blocker_type: blockerType,
    blocker_count: numberOrZero(count),
    repair_lane: lane,
    recommended_command: command,
    reason,
    db_mutation_needed: false,
    operator_approval_needed: false,
    post_repair_validation_command: "npm run ops:goal-dry-run-publish",
  });
}

function buildImmediateRepairOrder(report = {}) {
  const dryRun = normaliseJsonObject(report.dry_run_package_truth);
  const repairs = [];
  addRepair(
    repairs,
    "missing_final_narration_audio",
    dryRun.missing_narration_audio_count,
    "npm run ops:goal-audio-timestamps",
    "audio_timestamps",
    "Final narration is required before render or publish readiness can be claimed.",
  );
  addRepair(
    repairs,
    "missing_word_timestamps",
    dryRun.missing_word_timestamps_count,
    "npm run ops:goal-audio-timestamps",
    "audio_timestamps",
    "Word timestamps are required for caption timing and forensic QA.",
  );
  addRepair(
    repairs,
    "missing_materialised_motion_clips",
    dryRun.missing_materialised_motion_clips_count,
    "npm run ops:goal-owned-motion",
    "owned_motion_materialiser",
    "V4 bridge packages need real motion evidence, not plan-only assets.",
  );
  addRepair(
    repairs,
    "missing_distinct_motion_families",
    dryRun.missing_distinct_motion_families_count,
    "npm run ops:goal-owned-motion",
    "owned_motion_materialiser",
    "Distinct motion families block thin or repeated visual packages.",
  );
  addRepair(
    repairs,
    "incomplete_rights_record",
    dryRun.incomplete_rights_record_count,
    "npm run ops:bridge-live-rights-repair",
    "rights_ledger_repair",
    "Every used asset must keep visible rights evidence across bridge and final render QA.",
  );
  addRepair(
    repairs,
    "missing_final_mp4",
    dryRun.missing_final_mp4_count,
    "npm run ops:goal-production-render",
    "production_render_materialiser",
    "Final MP4 evidence is required after narration, timestamps, motion and rights are fixed.",
  );
  addRepair(
    repairs,
    "missing_caption_file",
    dryRun.missing_captions_count,
    "npm run ops:goal-audio-timestamps",
    "caption_chunker",
    "Captions must match narration before scheduler preflight.",
  );
  addRepair(
    repairs,
    "platform_upload_failures",
    (report.platform_upload_truth && report.platform_upload_truth.blocked_action_count) || 0,
    "npm run ops:platform-doctor",
    "platform_upload_preflight",
    "Platform package failures must stay blocked until repair lanes classify them.",
  );
  addRepair(
    repairs,
    "disabled_platforms_visible",
    (report.platform_upload_truth && report.platform_upload_truth.disabled_platform_count) || 0,
    "npm run ops:platform:status",
    "platform_state_visibility",
    "Disabled platforms must stay visible and must not count as publishable.",
  );
  return repairs.map((repair, index) => ({ ...repair, priority: index + 1 }));
}

function statusFromTruth(surface, report = {}) {
  if (surface === "live_db_truth") {
    const truth = normaliseJsonObject(report.live_db_truth);
    if (truth.unstamped_legacy_row_count > 0 || truth.thin_legacy_render_count > 0 || truth.missing_mp4_count > 0) return "AMBER";
    if (truth.stamped_render_count > 0) return "GREEN";
    return "AMBER";
  }
  if (surface === "bridge_artefact_truth") {
    const truth = normaliseJsonObject(report.bridge_artefact_truth);
    if (truth.red_count > 0 || truth.green_count <= 0) return "RED";
    if (
      truth.final_render_evidence_count < truth.candidate_count ||
      truth.narration_evidence_count < truth.candidate_count ||
      truth.timestamp_evidence_count < truth.candidate_count ||
      truth.materialised_motion_evidence_count < truth.candidate_count ||
      truth.rights_evidence_count < truth.candidate_count
    ) {
      return "RED";
    }
    if (truth.amber_count > 0) return "AMBER";
    return "GREEN";
  }
  if (surface === "dry_run_package_truth") {
    const truth = normaliseJsonObject(report.dry_run_package_truth);
    if (truth.ready_story_count <= 0 || truth.blocked_story_count > 0) return "RED";
    return "GREEN";
  }
  if (surface === "platform_upload_truth") {
    const truth = normaliseJsonObject(report.platform_upload_truth);
    if (truth.blocked_action_count > 0 || truth.disabled_platform_count > 0 || truth.instagram_meta_failure_count > 0) return "RED";
    if (truth.publish_now_action_count <= 0) return "AMBER";
    return "GREEN";
  }
  if (surface === "publish_control_truth") {
    const truth = normaliseJsonObject(report.publish_control_truth);
    if (truth.verdict === "RED" || truth.safe_to_publish_boolean !== true) return "RED";
    if (truth.verdict === "AMBER") return "AMBER";
    return "GREEN";
  }
  return "UNKNOWN";
}

function blockersForSurface(surface, report = {}) {
  const blockers = [];
  if (surface === "live_db_truth") {
    const truth = normaliseJsonObject(report.live_db_truth);
    if (truth.unstamped_legacy_row_count > 0) blockers.push("live_db_unstamped_legacy_rows");
    if (truth.thin_legacy_render_count > 0) blockers.push("live_db_thin_legacy_renders");
    if (truth.missing_mp4_count > 0) blockers.push("live_db_missing_mp4s");
  }
  if (surface === "bridge_artefact_truth") {
    const truth = normaliseJsonObject(report.bridge_artefact_truth);
    if (truth.red_count > 0) blockers.push("bridge_red_candidates");
    if (truth.green_count <= 0) blockers.push("bridge_has_no_green_candidates");
    if (truth.final_render_evidence_count < truth.candidate_count) blockers.push("bridge_missing_final_render_evidence");
    if (truth.narration_evidence_count < truth.candidate_count) blockers.push("bridge_missing_narration_evidence");
    if (truth.timestamp_evidence_count < truth.candidate_count) blockers.push("bridge_missing_timestamp_evidence");
    if (truth.materialised_motion_evidence_count < truth.candidate_count) blockers.push("bridge_missing_motion_evidence");
    if (truth.rights_evidence_count < truth.candidate_count) blockers.push("bridge_missing_rights_evidence");
  }
  if (surface === "dry_run_package_truth") {
    const truth = normaliseJsonObject(report.dry_run_package_truth);
    if (truth.ready_story_count <= 0) blockers.push("dry_run_has_no_ready_stories");
    if (truth.blocked_story_count > 0) blockers.push("dry_run_blocked_stories");
  }
  if (surface === "platform_upload_truth") {
    const truth = normaliseJsonObject(report.platform_upload_truth);
    if (truth.disabled_platform_count > 0) blockers.push("disabled_platforms_visible");
    if (truth.blocked_action_count > 0) blockers.push("platform_blocked_actions");
    if (truth.instagram_meta_failure_count > 0) blockers.push("instagram_meta_failures");
  }
  if (surface === "publish_control_truth") {
    const truth = normaliseJsonObject(report.publish_control_truth);
    if (truth.verdict !== "GREEN") blockers.push(`publish_verdict_${lowerText(truth.verdict || "unknown")}`);
    if (truth.safe_to_publish_boolean !== true) blockers.push("safe_to_publish_boolean_false");
  }
  return blockers;
}

function buildCutoverReadinessMatrix(report = {}) {
  const matrix = {
    schema_version: 1,
    generated_at: report.generated_at || new Date().toISOString(),
    readiness_verdict: report.readiness_verdict || "UNKNOWN",
  };
  for (const surface of TRUTH_SURFACES) {
    const status = statusFromTruth(surface, report);
    matrix[surface] = {
      status,
      ready: status === "GREEN",
      blockers: blockersForSurface(surface, report),
      evidence: report[surface] || {},
    };
  }
  return matrix;
}

function formatCount(label, value) {
  return `- ${label}: ${value == null ? "unknown" : value}`;
}

function renderBaselineAuditMarkdown(report = {}) {
  const matrix = buildCutoverReadinessMatrix(report);
  const repairOrder = buildImmediateRepairOrder(report);
  const lines = [
    "# Goal 02 baseline audit",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Readiness verdict: ${report.readiness_verdict || "UNKNOWN"}`,
    `Mode: ${report.mode || "LOCAL_PROOF"}`,
    "",
    "## Live DB truth",
    formatCount("Stamped renders", report.live_db_truth && report.live_db_truth.stamped_render_count),
    formatCount("Unstamped legacy rows", report.live_db_truth && report.live_db_truth.unstamped_legacy_row_count),
    formatCount("Missing MP4s", report.live_db_truth && report.live_db_truth.missing_mp4_count),
    formatCount("Thin legacy renders", report.live_db_truth && report.live_db_truth.thin_legacy_render_count),
    `Status: ${matrix.live_db_truth.status}`,
    "",
    "## Bridge artefact truth",
    formatCount("Bridge candidates", report.bridge_artefact_truth && report.bridge_artefact_truth.candidate_count),
    formatCount("GREEN", report.bridge_artefact_truth && report.bridge_artefact_truth.green_count),
    formatCount("AMBER", report.bridge_artefact_truth && report.bridge_artefact_truth.amber_count),
    formatCount("RED", report.bridge_artefact_truth && report.bridge_artefact_truth.red_count),
    `Status: ${matrix.bridge_artefact_truth.status}`,
    "",
    "## Dry-run package truth",
    formatCount("Stories", report.dry_run_package_truth && report.dry_run_package_truth.story_count),
    formatCount("Ready stories", report.dry_run_package_truth && report.dry_run_package_truth.ready_story_count),
    formatCount("Blocked stories", report.dry_run_package_truth && report.dry_run_package_truth.blocked_story_count),
    formatCount("Missing narration audio", report.dry_run_package_truth && report.dry_run_package_truth.missing_narration_audio_count),
    formatCount("Missing word timestamps", report.dry_run_package_truth && report.dry_run_package_truth.missing_word_timestamps_count),
    formatCount("Missing materialised motion clips", report.dry_run_package_truth && report.dry_run_package_truth.missing_materialised_motion_clips_count),
    formatCount("Missing distinct motion families", report.dry_run_package_truth && report.dry_run_package_truth.missing_distinct_motion_families_count),
    formatCount("Incomplete rights records", report.dry_run_package_truth && report.dry_run_package_truth.incomplete_rights_record_count),
    `Status: ${matrix.dry_run_package_truth.status}`,
    "",
    "## Platform upload truth",
    formatCount("Platforms", report.platform_upload_truth && report.platform_upload_truth.platform_count),
    formatCount("Disabled platforms", report.platform_upload_truth && report.platform_upload_truth.disabled_platform_count),
    formatCount("Blocked platform actions", report.platform_upload_truth && report.platform_upload_truth.blocked_action_count),
    formatCount("Instagram/Meta failures", report.platform_upload_truth && report.platform_upload_truth.instagram_meta_failure_count),
    `Status: ${matrix.platform_upload_truth.status}`,
    "",
    "## Publish-control truth",
    `Verdict: ${report.publish_control_truth && report.publish_control_truth.verdict}`,
    `Safe to publish: ${report.publish_control_truth && report.publish_control_truth.safe_to_publish_boolean === true}`,
    formatCount(
      "Candidate platform actions (enabled + deferred)",
      report.publish_control_truth && report.publish_control_truth.candidate_platform_action_count,
    ),
    formatCount(
      "Enabled dry-run actions",
      report.publish_control_truth && report.publish_control_truth.enabled_platform_dry_run_action_count,
    ),
    formatCount(
      "Enabled actions requiring human review",
      report.publish_control_truth && report.publish_control_truth.enabled_human_review_action_count,
    ),
    formatCount(
      "Live publish actions allowed by this dry run",
      report.publish_control_truth && report.publish_control_truth.live_publish_allowed_action_count,
    ),
    formatCount(
      "Deferred until platform enablement",
      report.publish_control_truth && report.publish_control_truth.deferred_platform_enablement_action_count,
    ),
    `Status: ${matrix.publish_control_truth.status}`,
    "",
    "## Repair order",
  ];
  if (repairOrder.length === 0) {
    lines.push("- No immediate repair commands were generated.");
  } else {
    for (const repair of repairOrder) {
      lines.push(`- P${repair.priority} ${repair.blocker_type}: ${repair.recommended_command} (${repair.blocker_count})`);
    }
  }
  lines.push(
    "",
    "## Safety",
    "- No live publishing was triggered.",
    "- No external posting was triggered.",
    "- No production DB mutation was performed.",
    "- No OAuth, token or .env material was read into the report.",
  );
  return `${lines.join("\n")}\n`;
}

async function writeBaselineAuditArtifacts(report = {}, { outDir } = {}) {
  if (!outDir) throw new Error("outDir is required");
  const resolvedOutDir = path.resolve(outDir);
  await fs.ensureDir(resolvedOutDir);
  const taxonomy = buildBlockerTaxonomy(report);
  const repairOrder = buildImmediateRepairOrder(report);
  const matrix = buildCutoverReadinessMatrix(report);
  const files = {};

  files.baseline_audit_report_json = path.join(resolvedOutDir, OUTPUT_FILES.baseline_audit_report_json);
  files.baseline_audit_report_md = path.join(resolvedOutDir, OUTPUT_FILES.baseline_audit_report_md);
  files.blocker_taxonomy_json = path.join(resolvedOutDir, OUTPUT_FILES.blocker_taxonomy_json);
  files.immediate_repair_order_json = path.join(resolvedOutDir, OUTPUT_FILES.immediate_repair_order_json);
  files.cutover_readiness_matrix_json = path.join(resolvedOutDir, OUTPUT_FILES.cutover_readiness_matrix_json);

  await fs.outputJson(files.baseline_audit_report_json, report, { spaces: 2 });
  await fs.outputFile(files.baseline_audit_report_md, renderBaselineAuditMarkdown(report));
  await fs.outputJson(files.blocker_taxonomy_json, taxonomy, { spaces: 2 });
  await fs.outputJson(files.immediate_repair_order_json, repairOrder, { spaces: 2 });
  await fs.outputJson(files.cutover_readiness_matrix_json, matrix, { spaces: 2 });

  return { out_dir: resolvedOutDir, files };
}

module.exports = {
  TRUTH_SURFACES,
  buildBaselineAuditReport,
  buildBlockerTaxonomy,
  buildCutoverReadinessMatrix,
  buildImmediateRepairOrder,
  renderBaselineAuditMarkdown,
  writeBaselineAuditArtifacts,
};
