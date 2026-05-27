"use strict";

const {
  loadGoldStandardReferenceLibrary,
  REQUIRED_REFERENCE_PACKS,
} = require("./gold-standard-reference-library");

const RETENTION_TARGETS = {
  stayed_to_watch_short_term: 45,
  stayed_to_watch_scale: 50,
  average_watch_seconds_short_term: 15,
  subscriber_conversion_short_term: 0.1,
  top_short_breakout_target: 2500,
};

const DEFAULT_PLATFORM_RULES = [
  {
    id: "youtube_shorts_non_clickable_links",
    platform: "youtube",
    source_url: "https://support.google.com/youtube/answer/13748639",
    requirement:
      "Shorts descriptions and comments cannot be treated as the primary click path.",
    system_gate: "story_page_or_channel_profile_route_required",
  },
  {
    id: "youtube_retention_first_30_seconds",
    platform: "youtube",
    source_url: "https://support.google.com/youtube/answer/9314415",
    requirement:
      "The intro must match the title and cover promise and keep viewers interested.",
    system_gate: "first_seconds_hook_and_visual_parity_required",
  },
  {
    id: "youtube_shorts_claimed_content_over_60s",
    platform: "youtube",
    source_url: "https://support.google.com/youtube/answer/15424877",
    requirement:
      "Shorts longer than one minute with active Content ID claims can be blocked.",
    system_gate: "rights_and_runtime_risk_required",
  },
  {
    id: "tiktok_creative_center_frame_graph",
    platform: "tiktok",
    source_url: "https://ads.tiktok.com/business/creativecenter/",
    requirement:
      "Creative review should use second-by-second engagement and trend evidence where available.",
    system_gate: "retention_drop_to_timeline_adjustment_required",
  },
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function round(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

function pct(part, total) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return 0;
  return clamp((p / t) * 100);
}

function safeSummary(report = {}) {
  return report && typeof report === "object" && report.summary
    ? report.summary
    : report || {};
}

function packNames(library = {}) {
  return asArray(library.reference_packs)
    .map((pack) => pack.pack)
    .filter(Boolean);
}

function goldStandardCoverageScore(library = {}) {
  const referenceCount = Number(library.references?.length || library.summary?.total_references || 0);
  const ruleCount = Number(library.codex_rules?.length || 0);
  const packs = new Set(packNames(library));
  const referenceScore = clamp((referenceCount / 50) * 45);
  const ruleScore = clamp((ruleCount / 12) * 25);
  const packScore = clamp((packs.size / REQUIRED_REFERENCE_PACKS.length) * 30);
  return round(referenceScore + ruleScore + packScore, 0);
}

function retentionScore(baseline = {}) {
  const stayed = Number(baseline.stayed_to_watch);
  const avgWatch = Number(baseline.avg_watch_seconds_estimate);
  const conversion = Number(baseline.subscriber_conversion_estimate);
  const breakout = Number(baseline.top_short_ceiling_current);

  const stayedScore = Number.isFinite(stayed)
    ? clamp(stayed * 0.75)
    : 0;
  const watchScore = Number.isFinite(avgWatch)
    ? clamp((avgWatch / 20) * 12)
    : 0;
  const conversionScore = Number.isFinite(conversion)
    ? clamp((conversion / RETENTION_TARGETS.subscriber_conversion_short_term) * 10)
    : 0;
  const breakoutScore = Number.isFinite(breakout)
    ? clamp((breakout / RETENTION_TARGETS.top_short_breakout_target) * 10)
    : 0;

  return round(clamp(stayedScore + watchScore + conversionScore + breakoutScore), 0);
}

function renderPolishScore(summary = {}) {
  const stamped = Number(summary.stamped || 0);
  if (stamped <= 0) return 0;
  const premium = Number(summary.percentages?.quality?.premium ?? pct(summary.quality?.premium, stamped));
  const standard = Number(summary.percentages?.quality?.standard ?? pct(summary.quality?.standard, stamped));
  const fallback = Number(summary.percentages?.quality?.fallback ?? pct(summary.quality?.fallback, stamped));
  const thin = Number(summary.percentages?.thin ?? pct(summary.thin_count, stamped));
  const legacy = Number(summary.percentages?.lane?.legacy_multi_image ?? pct(summary.lane?.legacy_multi_image, stamped));
  const medianVisuals = Number(summary.visual_count?.median || 0);
  return round(
    premium * 0.5 +
      standard * 0.22 +
      clamp((medianVisuals / 7) * 18) -
      fallback * 0.22 -
      thin * 0.25 -
      legacy * 0.1,
    0,
  );
}

function motionReadinessScore({ sourceDeficit = {}, motionPacks = {} } = {}) {
  const deficit = safeSummary(sourceDeficit);
  const packs = safeSummary(motionPacks);
  const ready = Number(packs.ready ?? deficit.v4_ready_stories ?? 0);
  const blocked = Number(packs.blocked ?? deficit.blocked_stories ?? 0);
  const clips = Number(packs.clips || 0);
  const directReady = Number(deficit.direct_media_ready || 0);
  const licenceRequired = Number(deficit.licence_or_operator_required || 0);
  const missing = Number(deficit.direct_media_missing || 0);
  const storyReadiness = pct(ready, ready + blocked);
  const clipDepth = clamp((clips / Math.max(1, ready * 7 || 7)) * 35);
  const sourceDepth = clamp((directReady / Math.max(1, directReady + licenceRequired + missing)) * 30);
  const blockerPenalty = clamp(licenceRequired * 6 + missing * 8 + blocked * 15);
  return round(clamp(storyReadiness * 0.35 + clipDepth + sourceDepth - blockerPenalty), 0);
}

function revenueScore(digest = {}) {
  const totals = digest.totals || {};
  const paths = Number(totals.paths || 0);
  if (paths <= 0) return 0;
  const passRate = pct(totals.pass, paths);
  const reviewRate = pct(totals.review, paths);
  const blockedRate = pct(totals.blocked_for_compliance, paths);
  const average = Number(totals.average_revenue_path_score || 0);
  return round(average * 0.55 + passRate * 0.35 - reviewRate * 0.15 - blockedRate * 0.35, 0);
}

function platformConstraintScore(platformRules = DEFAULT_PLATFORM_RULES) {
  const rules = asArray(platformRules).filter((rule) => rule.id && rule.system_gate);
  const platforms = new Set(rules.map((rule) => rule.platform).filter(Boolean));
  return round(clamp((rules.length / 4) * 55 + (platforms.size / 3) * 45), 0);
}

function buildBlockers({ baseline, renderHealth, sourceDeficit, motionPacks, revenueDigest }) {
  const blockers = [];
  const deficit = safeSummary(sourceDeficit);
  const packs = safeSummary(motionPacks);
  const revenueTotals = revenueDigest.totals || {};

  if (Number(baseline.stayed_to_watch) > 0 && Number(baseline.stayed_to_watch) < RETENTION_TARGETS.stayed_to_watch_short_term) {
    blockers.push("shorts_retention_below_first_target");
  }
  if (Number(baseline.avg_watch_seconds_estimate) > 0 && Number(baseline.avg_watch_seconds_estimate) < RETENTION_TARGETS.average_watch_seconds_short_term) {
    blockers.push("average_watch_time_below_first_target");
  }
  if (Number(packs.blocked || deficit.blocked_stories || 0) > 0) {
    blockers.push("v4_motion_blocked_by_safe_source_shortage");
  }
  if (Number(deficit.licence_or_operator_required || 0) > 0) {
    blockers.push("licensed_or_operator_supplied_motion_sources_required");
  }
  if (Number(renderHealth.stamped || 0) > 0 && Number(renderHealth.quality?.premium || 0) === 0) {
    blockers.push("render_health_has_zero_premium_renders");
  }
  if (Number(renderHealth.percentages?.thin || 0) >= 30) {
    blockers.push("thin_render_rate_above_target");
  }
  if (Number(renderHealth.percentages?.lane?.legacy_multi_image || 0) >= 50) {
    blockers.push("render_lane_stuck_on_legacy_multi_image");
  }
  const revenuePaths = Number(revenueTotals.paths || 0);
  const revenueReviewRate = pct(revenueTotals.review, revenuePaths);
  const revenueComplianceBlocks = Number(revenueTotals.blocked_for_compliance || 0);
  if (revenuePaths > 0 && (revenueReviewRate > 20 || revenueComplianceBlocks > 0)) {
    blockers.push("revenue_paths_need_review_before_scaling");
  }
  return [...new Set(blockers)];
}

function workstream(id, title, priority, referencePacks, nextCommand, reason) {
  return {
    id,
    title,
    priority,
    reference_packs: referencePacks,
    next_command: nextCommand,
    reason,
  };
}

function buildWorkstreams({ blockers }) {
  const out = [];
  const has = (id) => blockers.includes(id);

  if (has("v4_motion_blocked_by_safe_source_shortage") || has("licensed_or_operator_supplied_motion_sources_required")) {
    out.push(
      workstream(
        "v4_motion_source_acquisition",
        "V4 motion source acquisition",
        "critical",
        ["Official Publisher Motion", "Pacing / Retention / Impact"],
        "npm run ops:v4-source-deficit -- --json",
        "Find, classify and validate enough safe motion families before claiming Visual V4.",
      ),
    );
  }
  if (has("shorts_retention_below_first_target") || has("average_watch_time_below_first_target")) {
    out.push(
      workstream(
        "first_three_seconds_retention",
        "First three seconds retention",
        "critical",
        ["Gaming News Core", "Social-First News", "Pacing / Retention / Impact"],
        "npm run ops:retention-intelligence -- --fixture",
        "Move named subject, consequence, proof and first visual change into the opening seconds.",
      ),
    );
  }
  if (has("render_health_has_zero_premium_renders") || has("thin_render_rate_above_target")) {
    out.push(
      workstream(
        "premium_render_density",
        "Premium render density",
        "high",
        ["Official Publisher Motion", "Explainer / Data Graphics", "Premium Visual Texture"],
        "npm run ops:render-health -- --json",
        "Raise visual count, reduce fallback renders and make premium the default target.",
      ),
    );
  }
  if (has("revenue_paths_need_review_before_scaling")) {
    out.push(
      workstream(
        "revenue_path_review_reduction",
        "Revenue path review reduction",
        "high",
        ["Gaming News Core", "Social-First News"],
        "npm run ops:revenue-paths",
        "Move story-matched offers through disclosure, landing page and trust gates.",
      ),
    );
  }
  out.push(
    workstream(
      "gold_standard_regression_gate",
      "Gold standard regression gate",
      "normal",
      REQUIRED_REFERENCE_PACKS,
      "npm test tests/services/media-house-benchmark.test.js",
      "Keep every render scored against the 50-reference workbook instead of relying on taste.",
    ),
  );
  return out;
}

function verdictFor(score, blockers) {
  if (blockers.length > 0 || score < 72) return "build_not_scale_ready";
  if (score >= 80) return "scale_candidate";
  return "needs_operator_review";
}

function buildEmpireReadinessAudit({
  generatedAt = new Date().toISOString(),
  library = loadGoldStandardReferenceLibrary(),
  retentionBaseline = {},
  renderHealthSummary = {},
  v4SourceDeficit = {},
  v4MotionPacks = {},
  revenuePathDigest = {},
  platformRules = DEFAULT_PLATFORM_RULES,
} = {}) {
  const renderHealth = renderHealthSummary || {};
  const scores = {
    gold_standard_coverage_score: goldStandardCoverageScore(library),
    retention_score: retentionScore(retentionBaseline),
    render_polish_score: renderPolishScore(renderHealth),
    motion_readiness_score: motionReadinessScore({
      sourceDeficit: v4SourceDeficit,
      motionPacks: v4MotionPacks,
    }),
    revenue_path_score: revenueScore(revenuePathDigest),
    platform_constraint_score: platformConstraintScore(platformRules),
  };
  scores.empire_readiness_score = round(
    scores.gold_standard_coverage_score * 0.12 +
      scores.retention_score * 0.22 +
      scores.render_polish_score * 0.2 +
      scores.motion_readiness_score * 0.22 +
      scores.revenue_path_score * 0.14 +
      scores.platform_constraint_score * 0.1,
    0,
  );

  const blockers = buildBlockers({
    baseline: retentionBaseline,
    renderHealth,
    sourceDeficit: safeSummary(v4SourceDeficit),
    motionPacks: safeSummary(v4MotionPacks),
    revenueDigest: revenuePathDigest || {},
  });

  return {
    schema_version: 1,
    engine: "pulse_empire_readiness_audit",
    generated_at: generatedAt,
    verdict: verdictFor(scores.empire_readiness_score, blockers),
    scores,
    targets: RETENTION_TARGETS,
    gold_standard_library: {
      workbook_path: library.workbook_path || null,
      reference_count: Number(library.references?.length || library.summary?.total_references || 0),
      rule_count: Number(library.codex_rules?.length || 0),
      required_packs: REQUIRED_REFERENCE_PACKS,
      available_packs: packNames(library),
      legal_rule: library.summary?.core_legal_rule || null,
    },
    platform_rules: asArray(platformRules),
    blockers,
    workstreams: buildWorkstreams({ blockers }),
    input_summaries: {
      retention_baseline: retentionBaseline,
      render_health: renderHealth,
      v4_source_deficit: safeSummary(v4SourceDeficit),
      v4_motion_packs: safeSummary(v4MotionPacks),
      revenue_paths: revenuePathDigest.totals || {},
    },
    safety: {
      read_only: true,
      no_publish_side_effects: true,
      no_social_posting_triggered: true,
      no_production_db_mutation_required: true,
      no_fantasy_revenue_projection: true,
      no_random_footage_permission: true,
    },
  };
}

function renderEmpireReadinessMarkdown(audit = {}) {
  const lines = [];
  lines.push("# Pulse Empire Readiness Audit");
  lines.push("");
  lines.push(`Generated: ${audit.generated_at || ""}`);
  lines.push(`Verdict: ${audit.verdict || "unknown"}`);
  lines.push(`Empire readiness score: ${audit.scores?.empire_readiness_score ?? 0}`);
  lines.push(`Gold references: ${audit.gold_standard_library?.reference_count || 0}`);
  lines.push("");
  lines.push("## Scores");
  for (const [key, value] of Object.entries(audit.scores || {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Blockers");
  if (!asArray(audit.blockers).length) lines.push("- none");
  for (const blocker of asArray(audit.blockers)) lines.push(`- ${blocker}`);
  lines.push("");
  lines.push("## Workstreams");
  for (const item of asArray(audit.workstreams)) {
    lines.push(`- ${item.title}: ${item.priority}. ${item.reason}`);
    lines.push(`  Command: ${item.next_command}`);
    lines.push(`  Benchmarks: ${item.reference_packs.join(", ")}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Read-only audit.");
  lines.push("- No publishing or account changes.");
  lines.push("- Revenue scoring avoids fantasy projections.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  DEFAULT_PLATFORM_RULES,
  RETENTION_TARGETS,
  buildEmpireReadinessAudit,
  renderEmpireReadinessMarkdown,
  _private: {
    goldStandardCoverageScore,
    motionReadinessScore,
    renderPolishScore,
    retentionScore,
    revenueScore,
  },
};
