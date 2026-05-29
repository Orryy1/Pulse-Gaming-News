"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const SECRET_PATTERNS = [
  /\b(access_token|refresh_token|client_secret|api_key|authorization)\b\s*[:=]\s*["']?[^"',\s}]+/gi,
  /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /([?&](?:access_token|refresh_token|token|client_secret|api_key)=)[^&\s]+/gi,
];

function clean(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return redact(text);
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map(clean).filter(Boolean)));
}

function countActionsByPlatform(actions = []) {
  const counts = {};
  for (const action of asArray(actions)) {
    const platform = platformKey(action.platform);
    if (!platform) continue;
    counts[platform] = (counts[platform] || 0) + 1;
  }
  return counts;
}

function formatActionCounts(counts = {}) {
  return Object.entries(counts)
    .map(([platform, count]) => `${platform}=${count}`)
    .join(", ");
}

function redact(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "$1[REDACTED]");
  return text;
}

function platformLabel(platform) {
  const key = clean(platform).toLowerCase();
  if (key === "x" || key === "twitter") return "X";
  if (key === "tiktok") return "TikTok";
  if (key === "youtube_shorts") return "YouTube Shorts";
  if (key === "instagram_reels") return "Instagram Reels";
  if (key === "facebook_reels") return "Facebook Reels";
  if (key === "threads") return "Threads";
  if (key === "pinterest") return "Pinterest";
  return clean(platform);
}

function platformKey(value) {
  const key = clean(value).toLowerCase();
  if (key === "twitter") return "x";
  if (key === "instagram_reel") return "instagram_reels";
  if (key === "facebook_reel") return "facebook_reels";
  return key;
}

function doctorPlatformEvidence(platformDoctor = {}, platform) {
  const platforms = platformDoctor.platforms || {};
  const key = platformKey(platform);
  const raw =
    platforms[key] ||
    (key === "x" ? platforms.twitter : null) ||
    (key === "instagram_reels" ? platforms.instagram_reel : null) ||
    (key === "facebook_reels" ? platforms.facebook_reel : null) ||
    {};

  return {
    status: clean(raw.status || raw.state),
    reason: clean(raw.reason || raw.operational_reason || raw.blocker),
    recommendation: clean(raw.recommendation || raw.next_action),
    enablement_gaps: unique(raw.enablement_gaps || raw.blockers || raw.gaps),
  };
}

function operatorActionsFor(platform, gaps = [], nextAction = "") {
  const key = platformKey(platform);
  const all = unique([...gaps, nextAction]);
  const actions = [];

  if (key === "tiktok") {
    if (all.some((gap) => /token|credential|auth/i.test(gap))) {
      actions.push("Refresh or sync the local TikTok token with the operator present.");
    }
    actions.push("Run the platform doctor again and require the local token to prove usable before any inbox upload.");
    actions.push("Keep direct public posting blocked unless TikTok app review/direct-post approval is declared.");
  } else if (key === "x") {
    if (all.some((gap) => /billing|paid/i.test(gap))) {
      actions.push("Confirm paid X API/billing access before enabling the operator switch.");
    }
    if (all.some((gap) => /operator|disabled/i.test(gap))) {
      actions.push("Enable the X operator switch only after credentials and billing are confirmed.");
    }
    actions.push("Rerun the platform doctor and strict dry-run before counting X as ready.");
  } else if (key === "threads") {
    actions.push("Configure the Threads platform integration before counting this platform as ready.");
    actions.push("Generate a Threads-specific pack and rerun strict dry-run before any live action.");
  } else if (key === "pinterest") {
    actions.push("Configure the Pinterest platform integration before counting this platform as ready.");
    actions.push("Generate a Pinterest-safe evergreen or affiliate-safe pack and rerun strict dry-run before any live action.");
  } else {
    actions.push("Resolve platform enablement gaps, then rerun platform doctor and strict dry-run.");
  }

  return unique(actions);
}

function validationCommandsFor(platform) {
  const key = platformKey(platform);
  const commands = ["npm run ops:platform-doctor", "npm run ops:goal-dry-run-publish"];
  if (key === "tiktok") commands.unshift("npm run tiktok:auth-doctor");
  if (key === "x") commands.unshift("npm run ops:platform:status");
  return unique(commands);
}

function buildPlatformRecord({ platform, actions = [], platformDoctor = {}, dryRunPlatform = {} } = {}) {
  const storyIds = unique(actions.map((action) => action.story_id));
  const firstAction = actions[0] || {};
  const doctor = doctorPlatformEvidence(platformDoctor, platform);
  const gaps = unique([
    ...actions.flatMap((action) => asArray(action.platform_enablement_gaps)),
    ...asArray(dryRunPlatform.enablement_gaps),
    ...asArray(doctor.enablement_gaps),
    clean(firstAction.platform_operational_reason),
    clean(dryRunPlatform.operational_reason),
    clean(dryRunPlatform.reason),
  ]);
  const nextAction = clean(
    firstAction.platform_enablement_next_action ||
      dryRunPlatform.enablement_next_action ||
      doctor.recommendation,
  );
  const operationalState = clean(
    firstAction.platform_operational_state ||
      dryRunPlatform.operational_state ||
      dryRunPlatform.state ||
      doctor.status ||
      "disabled",
  );
  const operationalReason = clean(
    firstAction.platform_operational_reason ||
      dryRunPlatform.operational_reason ||
      dryRunPlatform.reason ||
      doctor.reason ||
      gaps[0] ||
      "platform_enablement_required",
  );

  return {
    platform: platformKey(platform),
    label: platformLabel(platform),
    status: "operator_action_required",
    operational_state: operationalState,
    operational_reason: operationalReason,
    deferred_action_count: actions.length,
    story_count: storyIds.length,
    story_ids: storyIds,
    enablement_gaps: gaps,
    enablement_next_action: nextAction || null,
    operator_actions: operatorActionsFor(platform, gaps, nextAction),
    validation_commands: validationCommandsFor(platform),
    required_evidence: [
      "platform doctor evidence is fresh",
      "strict dry-run still has zero blocked enabled-platform actions",
      "no disabled platform is counted as publishable",
      "no live upload happens before operator review",
    ],
    safe_to_enable_without_operator: false,
    live_publish_allowed_before_enablement: false,
  };
}

function buildGoalPlatformEnablementWorkOrder({
  dryRunPlan = {},
  platformDoctor = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const actions = asArray(dryRunPlan.actions);
  const deferredActions = actions.filter((action) => {
    if (clean(action.action) === "would_queue_when_enabled") return true;
    if (clean(action.live_execution_gate) === "platform_enablement_required") return true;
    return action.platform_enabled === false && clean(action.action) !== "would_publish";
  });
  const byPlatform = new Map();
  for (const action of deferredActions) {
    const key = platformKey(action.platform);
    if (!key) continue;
    if (!byPlatform.has(key)) byPlatform.set(key, []);
    byPlatform.get(key).push(action);
  }

  const dryRunPlatforms = dryRunPlan.platform_status_matrix?.platforms || {};
  const platforms = {};
  for (const [platform, platformActions] of byPlatform.entries()) {
    platforms[platform] = buildPlatformRecord({
      platform,
      actions: platformActions,
      platformDoctor,
      dryRunPlatform: dryRunPlatforms[platform] || dryRunPlatforms[platformKey(platform)] || {},
    });
  }

  const enabledPlatforms = Object.entries(dryRunPlatforms)
    .filter(([, platform]) => clean(platform.status) === "ready_now" || clean(platform.operational_state) === "enabled")
    .map(([key, platform]) => platformKey(platform.platform || platform.name || key))
    .filter(Boolean);
  const enabledActions = actions.filter((action) => {
    const actionName = clean(action.action);
    return action.platform_enabled === true && actionName !== "would_queue_when_enabled";
  });

  const platformRecords = Object.values(platforms);
  return {
    schema_version: 1,
    generated_at: clean(generatedAt),
    mode: "PLATFORM_ENABLEMENT_WORK_ORDER",
    source_dry_run_generated_at: clean(dryRunPlan.generated_at) || null,
    source_dry_run_verdict: clean(dryRunPlan.overall_verdict) || null,
    summary: {
      deferred_platform_count: platformRecords.length,
      total_deferred_actions: deferredActions.length,
      affected_story_count: unique(deferredActions.map((action) => action.story_id)).length,
      enabled_platforms_human_review_only: unique(enabledPlatforms),
      enabled_platform_action_counts: countActionsByPlatform(enabledActions),
      deferred_platform_action_counts: countActionsByPlatform(deferredActions),
      enabled_platform_dry_run_actions: Number(dryRunPlan.summary?.platform_enabled_dry_run_action_count || 0),
      live_publish_actions_allowed: Number(dryRunPlan.summary?.live_publish_allowed_action_count || 0),
      ready_for_unattended_publish: false,
    },
    platforms,
    operator_sequence: [
      "Review the enabled-platform human-review queue first; no unattended publish is authorised by this report.",
      "Resolve each platform enablement work order with the operator present.",
      "Rerun platform doctor, strict dry-run publish and human-review queue after any platform setting changes.",
      "Only count a platform as ready when strict dry-run reports it enabled and not deferred.",
    ],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      secrets_redacted: true,
    },
  };
}

function renderGoalPlatformEnablementWorkOrderMarkdown(report = {}) {
  const lines = [
    "# Platform Enablement Work Order",
    "",
    `Generated: ${clean(report.generated_at)}`,
    `Source dry-run verdict: ${clean(report.source_dry_run_verdict) || "unknown"}`,
    `Deferred platforms: ${Number(report.summary?.deferred_platform_count || 0)}`,
    `Deferred actions: ${Number(report.summary?.total_deferred_actions || 0)}`,
    `Live publish actions allowed: ${Number(report.summary?.live_publish_actions_allowed || 0)}`,
    `Enabled human-review platforms: ${asArray(report.summary?.enabled_platforms_human_review_only).join(", ") || "none"}`,
    `Enabled platform action counts: ${formatActionCounts(report.summary?.enabled_platform_action_counts) || "none"}`,
    `Deferred platform action counts: ${formatActionCounts(report.summary?.deferred_platform_action_counts) || "none"}`,
    "",
    "## Safety",
    "- No publish API calls are made.",
    "- No OAuth or token mutation is performed.",
    "- Disabled platforms stay non-publishable until strict dry-run proves otherwise.",
    "",
  ];

  for (const platform of Object.values(report.platforms || {})) {
    lines.push(`## ${platform.label}`);
    lines.push(`Status: ${platform.status}`);
    lines.push(`Operational state: ${platform.operational_state}`);
    lines.push(`Deferred actions: ${platform.deferred_action_count}`);
    lines.push(`Stories: ${asArray(platform.story_ids).join(", ") || "none"}`);
    if (asArray(platform.enablement_gaps).length) {
      lines.push(`Gaps: ${platform.enablement_gaps.join(", ")}`);
    }
    if (platform.enablement_next_action) lines.push(`Next action: ${platform.enablement_next_action}`);
    lines.push("Operator actions:");
    for (const action of asArray(platform.operator_actions)) lines.push(`- ${action}`);
    lines.push("Validation:");
    for (const command of asArray(platform.validation_commands)) lines.push(`- ${command}`);
    lines.push("");
  }

  if (asArray(report.operator_sequence).length) {
    lines.push("## Operator Sequence");
    for (const step of asArray(report.operator_sequence)) lines.push(`- ${step}`);
  }

  return redact(lines.join("\n")).trimEnd() + "\n";
}

async function writeGoalPlatformEnablementWorkOrder(report = {}, { outputDir } = {}) {
  const dir = outputDir || path.join(process.cwd(), "output", "goal-contract");
  await fs.ensureDir(dir);
  const jsonPath = path.join(dir, "platform_enablement_work_order.json");
  const mdPath = path.join(dir, "platform_enablement_work_order.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderGoalPlatformEnablementWorkOrderMarkdown(report));
  return { jsonPath, mdPath };
}

module.exports = {
  buildGoalPlatformEnablementWorkOrder,
  renderGoalPlatformEnablementWorkOrderMarkdown,
  writeGoalPlatformEnablementWorkOrder,
};
