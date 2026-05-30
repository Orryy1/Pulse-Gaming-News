"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { auditPublicOutputCoherenceArtifact } = require("./public-output-coherence-artifact");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstClean(values = []) {
  for (const value of asArray(values)) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function truncateWords(value, maxWords = 34) {
  const words = clean(value).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function sourceRecord(source = null, urlFallbacks = []) {
  const fallbackUrl = firstClean(urlFallbacks);
  if (!source) return fallbackUrl ? { name: null, url: fallbackUrl } : null;
  if (typeof source === "string") return { name: clean(source), url: fallbackUrl || null };
  return {
    name: clean(source.name || source.source_name || source.label || source.title || source.url) || null,
    url: clean(source.url || source.source_url || source.href) || fallbackUrl || null,
  };
}

function sourceRecords(sources = [], urlFallbacks = []) {
  return asArray(sources)
    .map((source, index) => sourceRecord(source, [asArray(urlFallbacks)[index]]))
    .filter(Boolean);
}

function sourceLine(source = {}) {
  const name = clean(source.name) || "missing";
  const url = clean(source.url);
  return url ? `${name} (${url})` : name;
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (filePath && await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function groupByStory(items = []) {
  const grouped = new Map();
  for (const item of asArray(items)) {
    const storyId = clean(item.story_id || item.storyId || item.id);
    if (!storyId) continue;
    if (!grouped.has(storyId)) grouped.set(storyId, []);
    grouped.get(storyId).push(item);
  }
  return grouped;
}

function inferArtifactDir({ incident = {}, actions = [] } = {}) {
  if (incident.artifact_dir) return incident.artifact_dir;
  const action = asArray(actions).find((candidate) => candidate.video_path || candidate.captions_path);
  const filePath = clean(action?.video_path || action?.captions_path);
  return filePath ? path.dirname(filePath) : "";
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map(clean).filter(Boolean)));
}

function actionPlatforms(actions = [], actionName) {
  return unique(asArray(actions).filter((action) => action.action === actionName).map((action) => action.platform));
}

function actionWarnings(actions = []) {
  return unique(asArray(actions).flatMap((action) => asArray(action.warnings)));
}

function platformEnablementRequirements(actions = []) {
  const requirements = [];
  const seen = new Set();
  for (const action of asArray(actions)) {
    if (action.action !== "would_queue_when_enabled") continue;
    const platform = clean(action.platform);
    if (!platform || seen.has(platform)) continue;
    seen.add(platform);
    const operationalState = clean(action.platform_operational_state) || "disabled";
    const operationalReason = clean(action.platform_operational_reason);
    const enablementGaps = unique([
      ...asArray(action.platform_enablement_gaps),
      operationalReason && !asArray(action.platform_enablement_gaps).length ? operationalReason : "",
    ]);
    requirements.push({
      platform,
      operational_state: operationalState,
      operational_reason: operationalReason || null,
      enablement_gaps: enablementGaps,
      enablement_next_action: clean(action.platform_enablement_next_action) || null,
      required_before_counting_platform_ready: true,
      live_publish_allowed_before_enablement: false,
    });
  }
  return requirements;
}

function tiktokCreatorRewardsJobByStory(workOrder = {}) {
  const map = new Map();
  for (const job of asArray(workOrder.jobs)) {
    const storyId = clean(job.story_id);
    if (!storyId || clean(job.platform) !== "tiktok") continue;
    if (clean(job.status) !== "needs_tiktok_creator_rewards_variant") continue;
    map.set(storyId, job);
  }
  return map;
}

function tiktokCreatorRewardsRepairByStory(report = {}) {
  const map = new Map();
  for (const job of asArray(report.jobs)) {
    const storyId = clean(job.story_id);
    if (!storyId) continue;
    if (!asArray(job.blockers).includes("tiktok_creator_rewards_platform_variant_materializer_required")) {
      continue;
    }
    map.set(storyId, job);
  }
  return map;
}

function normaliseRenderInputRequirement(action = {}, fallback = {}) {
  const status = clean(action.status || fallback.status);
  return {
    action_id: clean(action.action_id || fallback.blocker_type || fallback.action_id),
    status,
    repair_lane: clean(action.repair_lane || fallback.repair_lane),
    exact_missing_input: clean(action.exact_missing_input || fallback.exact_missing_input),
    required_artefact_path: clean(action.required_artefact_path || fallback.required_artefact_path),
    required_artefact_paths: unique([
      ...asArray(action.required_artefact_paths),
      ...asArray(fallback.required_artefact_paths),
      action.required_artefact_path,
      fallback.required_artefact_path,
    ]),
    recommended_command: clean(action.recommended_command || fallback.recommended_command),
    post_repair_validation_command: clean(
      action.post_repair_validation_command || fallback.post_repair_validation_command,
    ),
    reason_codes: unique([
      ...asArray(action.reason_codes),
      ...asArray(action.blockers),
      ...asArray(fallback.reason_codes),
      ...asArray(fallback.blockers),
    ]),
    auto_repairable: action.auto_repairable === true || fallback.auto_repairable === true,
    operator_approval_required: action.operator_approval_required === true || fallback.operator_approval_required === true,
    dead_end_blocker: action.dead_end_blocker === true || fallback.dead_end_blocker === true,
    reject_recommended:
      action.reject_recommended === true ||
      fallback.reject_recommended === true ||
      status === "reject_recommended",
  };
}

function renderInputRequirementsByStory(workOrder = {}) {
  const map = new Map();
  function ensure(storyId) {
    const id = clean(storyId);
    if (!id) return null;
    if (!map.has(id)) map.set(id, { blockers: [], requirements: [] });
    return map.get(id);
  }

  for (const story of asArray(workOrder.stories)) {
    const entry = ensure(story.story_id);
    if (!entry) continue;
    entry.blockers.push(...asArray(story.blockers));
    for (const action of asArray(story.actions)) {
      entry.requirements.push(normaliseRenderInputRequirement(action, story));
      entry.blockers.push(...asArray(action.reason_codes), ...asArray(action.blockers));
    }
  }

  for (const job of asArray(workOrder.jobs)) {
    const entry = ensure(job.story_id);
    if (!entry) continue;
    entry.blockers.push(...asArray(job.blockers), job.blocker_type);
    for (const action of asArray(job.actions)) {
      entry.requirements.push(normaliseRenderInputRequirement(action, job));
      entry.blockers.push(...asArray(action.reason_codes), ...asArray(action.blockers));
    }
  }

  for (const item of asArray(workOrder.repair_backlog?.items)) {
    const entry = ensure(item.story_id);
    if (!entry) continue;
    entry.blockers.push(...asArray(item.blockers), item.blocker_type);
    entry.requirements.push(normaliseRenderInputRequirement(item, item));
  }

  for (const entry of map.values()) {
    entry.blockers = unique(entry.blockers);
    entry.requirements = entry.requirements.filter((requirement, index, list) => {
      const key = [
        requirement.action_id,
        requirement.repair_lane,
        requirement.exact_missing_input,
        requirement.recommended_command,
      ].join("|");
      return list.findIndex((candidate) => [
        candidate.action_id,
        candidate.repair_lane,
        candidate.exact_missing_input,
        candidate.recommended_command,
      ].join("|") === key) === index;
    });
  }
  return map;
}

function renderRequirementNeedsOperator(requirement = {}) {
  const status = clean(requirement.status);
  return (
    requirement.operator_approval_required === true ||
    requirement.dead_end_blocker === true ||
    requirement.reject_recommended === true ||
    status === "operator_required" ||
    status === "reject_recommended"
  );
}

function sourceIntakeNeedsOperator(sourceIntakeDetails = null) {
  return asArray(sourceIntakeDetails?.intake_items).some(
    (item) => item.blocks_readiness_until_submitted !== false,
  );
}

function operatorSourceRequirementsByStory(operatorSourceQueue = {}) {
  const map = new Map();
  const stopCondition = clean(operatorSourceQueue.stop_condition?.status);
  for (const story of asArray(operatorSourceQueue.stories)) {
    const storyId = clean(story.story_id);
    if (!storyId) continue;
    map.set(storyId, {
      stop_condition: stopCondition || null,
      intake_items: asArray(story.intake_items)
        .map((item) => ({
          intake_type: clean(item.intake_type),
          reason: clean(item.reason),
          required_fields: asArray(item.required_fields).map(clean).filter(Boolean),
          template_kind: clean(item.template_kind),
          blocks_readiness_until_submitted: item.blocks_readiness_until_submitted !== false,
        }))
        .filter((item) => item.intake_type),
      official_source_template_entries: asArray(story.official_source_template_entries),
      licensed_media_template_entries: asArray(story.licensed_media_template_entries),
    });
  }
  return map;
}

function platformRepairRequirements({
  storyId = "",
  warnings = [],
  tiktokCreatorRewardsJobs = new Map(),
  tiktokCreatorRewardsRepairs = new Map(),
} = {}) {
  const requirements = [];
  if (asArray(warnings).includes("below_creator_rewards_duration")) {
    const job = tiktokCreatorRewardsJobs.get(clean(storyId)) || {};
    const repairReport = tiktokCreatorRewardsRepairs.get(clean(storyId)) || {};
    requirements.push({
      platform: "tiktok",
      warning: "below_creator_rewards_duration",
      repair_lane: "tiktok_creator_rewards_variant",
      work_order_status: clean(job.status) || "missing_work_order_job",
      current_duration_s: Number.isFinite(Number(job.current_duration_s)) ? Number(job.current_duration_s) : null,
      target_duration_seconds: job.target_duration_seconds || { min: 61, max: 75 },
      minimum_extension_seconds: Number.isFinite(Number(job.minimum_extension_seconds))
        ? Number(job.minimum_extension_seconds)
        : null,
      actions: asArray(job.actions),
      repair_report_status: clean(repairReport.status) || null,
      repair_report_blockers: asArray(repairReport.blockers).map(clean).filter(Boolean),
      required_action: clean(repairReport.required_action) || null,
      required_before_counting_commercially_ready: true,
      live_publish_allowed_before_repair: false,
      note: "TikTok base upload eligibility is separate from 61s+ creator-rewards readiness.",
    });
  }
  return requirements;
}

function blockedReasonList(story = {}, incident = {}) {
  return unique([
    ...asArray(story.blockers),
    ...asArray(incident.disaster_upload_blockers),
  ]);
}

async function buildReviewItem({
  storyId,
  incident = {},
  actions = [],
  blockedActions = [],
  tiktokCreatorRewardsJobs = new Map(),
  tiktokCreatorRewardsRepairs = new Map(),
} = {}) {
  const artifactDir = inferArtifactDir({ incident, actions });
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const publishNowPlatforms = actionPlatforms(actions, "would_publish");
  const deferredPlatforms = actionPlatforms(actions, "would_queue_when_enabled");
  const blockedPlatforms = unique(asArray(blockedActions).map((action) => action.platform));
  const firstAction = asArray(actions)[0] || {};
  const title = clean(
    canonical.selected_title ||
      canonical.short_title ||
      firstAction.title ||
      canonical.canonical_title ||
      canonical.title ||
      canonical.canonical_subject,
  );
  const videoPath = clean(firstAction.video_path || path.join(artifactDir, "visual_v4_render.mp4"));
  const captionsPath = clean(firstAction.captions_path || path.join(artifactDir, "captions.srt"));
  const firstFrameSource = clean(firstAction.cover_frame_source || videoPath);
  const warnings = unique([
    ...actionWarnings(actions),
    ...asArray(incident.warnings),
  ]);
  const platformRepairs = platformRepairRequirements({
    storyId,
    warnings,
    tiktokCreatorRewardsJobs,
    tiktokCreatorRewardsRepairs,
  });
  const platformEnablement = platformEnablementRequirements(actions);
  const fullPlatformVerdict = blockedPlatforms.length
    ? "RED"
    : deferredPlatforms.length || warnings.length
      ? "AMBER"
      : "GREEN";
  const approvalRequirements = [
    "Watch the first three seconds before approval.",
    "Check title, thumbnail, first line and source labels against the story.",
    "These are review candidates, not live publish actions.",
    "Approve only enabled platforms listed in enabled_review_platforms.",
  ];
  if (platformRepairs.length) {
    approvalRequirements.push("Do not count warning platforms as commercially ready until their repair work order passes.");
  }
  if (platformEnablement.length) {
    approvalRequirements.push("Do not count deferred platforms as ready until their enablement gaps are cleared.");
  }

  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    mode: "HUMAN_REVIEW",
    operator_queue_status: "review_required",
    enabled_platform_verdict: blockedPlatforms.length ? "RED" : "GREEN",
    full_platform_verdict: fullPlatformVerdict,
    enabled_review_platforms: publishNowPlatforms,
    publish_now_platforms: publishNowPlatforms,
    deferred_platforms: deferredPlatforms,
    blocked_platforms: blockedPlatforms,
    warnings,
    platform_repair_requirements: platformRepairs,
    platform_enablement_requirements: platformEnablement,
    public_copy: {
      title,
      thumbnail_headline: clean(canonical.thumbnail_headline || canonical.cover_headline),
      first_spoken_line: clean(canonical.first_spoken_line || canonical.narration_hook || canonical.hook),
      script_excerpt: truncateWords(canonical.narration_script || canonical.full_script || canonical.script),
      description: clean(canonical.description),
    },
    source_list: {
      primary: sourceRecord(canonical.primary_source, [
        canonical.primary_source_url,
        canonical.source_url,
        canonical.article_url,
        canonical.url,
      ]),
      official: sourceRecord(canonical.official_source, [
        canonical.official_source_url,
        canonical.official_url,
      ]),
      discovery: sourceRecord(canonical.discovery_source, [
        canonical.discovery_source_url,
        canonical.discovery_url,
      ]),
      secondary: sourceRecords(canonical.secondary_sources, canonical.secondary_source_urls),
    },
    evidence: {
      video_path: videoPath,
      captions_path: captionsPath,
      first_frame_source: firstFrameSource,
      canonical_manifest_path: path.join(artifactDir, "canonical_story_manifest.json"),
      platform_publish_manifest_path: path.join(artifactDir, "platform_publish_manifest.json"),
      platform_manifest_summary: {
        output_platforms: Object.keys(platformManifest.outputs || {}),
      },
      incident_guard_safe: incident.safe_to_publish_boolean === true,
      file_evidence: incident.file_evidence || null,
    },
    approval: {
      operator_approval_required: true,
      live_publish_allowed_before_approval: false,
      live_publish_allowed_from_queue: false,
      approval_requirements: approvalRequirements,
    },
  };
}

function blockedItemFrom(story = {}, incident = {}, renderInputDetails = {}, sourceIntakeDetails = null) {
  const renderInputRequirements = asArray(renderInputDetails.requirements);
  const operatorApprovalRequired =
    renderInputRequirements.some(renderRequirementNeedsOperator) ||
    sourceIntakeNeedsOperator(sourceIntakeDetails);
  const deadEndBlocker = renderInputRequirements.some((requirement) => requirement.dead_end_blocker === true);
  const rejectRecommended = renderInputRequirements.some((requirement) => requirement.reject_recommended === true);
  return {
    story_id: clean(story.story_id || incident.story_id || "unknown"),
    artifact_dir: clean(story.artifact_dir || incident.artifact_dir),
    status: "blocked_from_human_approval",
    operator_queue_status: operatorApprovalRequired ? "operator_required" : "repair_required",
    dead_end_blocker: deadEndBlocker,
    reject_recommended: rejectRecommended,
    required_action: rejectRecommended
      ? "reject_or_supply_repaired_source_evidence"
      : operatorApprovalRequired
        ? "operator_repair_or_review_required"
        : "repair_before_human_review",
    blockers: unique([
      ...blockedReasonList(story, incident),
      ...asArray(renderInputDetails.blockers),
    ]),
    render_input_requirements: renderInputRequirements,
    source_intake_requirements: sourceIntakeDetails || null,
    approval: {
      operator_approval_required: operatorApprovalRequired,
      live_publish_allowed_before_repair: false,
    },
  };
}

const REQUIRED_OPERATOR_CHECKS = [
  "watch_first_three_seconds",
  "verify_title_thumbnail_opening_source_parity",
  "verify_enabled_platforms_only",
  "confirm_no_disabled_platform_counted_ready",
  "record_approve_or_reject_decision",
];

function buildReviewPacketManifest({ generatedAt, reviewItems = [], blockedItems = [] } = {}) {
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "HUMAN_REVIEW",
    review_packets: asArray(reviewItems).map((item) => ({
      packet_id: `${item.story_id}:human_review`,
      story_id: item.story_id,
      title: item.public_copy?.title || item.story_id,
      verdict: item.full_platform_verdict || "AMBER",
      enabled_review_platforms: asArray(item.enabled_review_platforms || item.publish_now_platforms),
      deferred_platforms: asArray(item.deferred_platforms),
      blocked_platforms: asArray(item.blocked_platforms),
      public_copy: item.public_copy || {},
      source_list: item.source_list || {},
      artefacts: {
        video_path: clean(item.evidence?.video_path),
        first_frame_source: clean(item.evidence?.first_frame_source),
        captions_path: clean(item.evidence?.captions_path),
        canonical_manifest_path: clean(item.evidence?.canonical_manifest_path),
        platform_publish_manifest_path: clean(item.evidence?.platform_publish_manifest_path),
      },
      required_operator_checks: REQUIRED_OPERATOR_CHECKS,
      approval_gate: {
        operator_decision_required: true,
        live_publish_allowed_before_decision: false,
        disabled_platforms_must_remain_deferred: true,
      },
    })),
    blocked_packets: asArray(blockedItems).map((item) => ({
      story_id: item.story_id,
      status: item.status,
      operator_queue_status: item.operator_queue_status,
      blockers: asArray(item.blockers),
      required_action: item.required_action,
      live_publish_allowed_before_repair: false,
    })),
    safety: {
      no_live_publish_from_manifest: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildOperatorDecisionLog({ generatedAt } = {}) {
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "HUMAN_REVIEW_DECISION_LOG",
    decisions: [],
    decision_template: {
      story_id: "",
      operator: "",
      decision: "approve_enabled_platforms | reject | request_repairs",
      approved_platforms: [],
      rejected_platforms: [],
      repair_requested: "",
      reviewed_artefacts: [],
      risk_acceptance_notes: "",
      decided_at: "",
    },
    safety: {
      no_live_publish_from_log: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

async function buildGoalHumanReviewQueue({
  dryRunPlan = {},
  generatedAt = new Date().toISOString(),
  maxItems = 30,
  tiktokCreatorRewardsVariantWorkOrder = {},
  tiktokCreatorRewardsRepairReport = {},
  renderInputWorkOrder = {},
  operatorSourceQueue = {},
} = {}) {
  const actionsByStory = groupByStory(dryRunPlan.actions);
  const blockedActionsByStory = groupByStory(dryRunPlan.blocked_actions);
  const blockedStoriesByStory = new Map(asArray(dryRunPlan.blocked_stories).map((story) => [clean(story.story_id), story]));
  const skippedStoryIds = new Set(asArray(dryRunPlan.skipped_stories).map((story) => clean(story.story_id)));
  const incidentByStory = new Map(
    asArray(dryRunPlan.incident_guard_report?.stories).map((story) => [clean(story.story_id), story]),
  );
  const storyIds = unique([
    ...Array.from(actionsByStory.keys()),
    ...Array.from(blockedActionsByStory.keys()),
    ...Array.from(blockedStoriesByStory.keys()),
    ...Array.from(incidentByStory.keys()),
  ]).filter((storyId) => !skippedStoryIds.has(storyId));
  const tiktokCreatorRewardsJobs = tiktokCreatorRewardsJobByStory(tiktokCreatorRewardsVariantWorkOrder);
  const tiktokCreatorRewardsRepairs = tiktokCreatorRewardsRepairByStory(tiktokCreatorRewardsRepairReport);
  const renderInputDetailsByStory = renderInputRequirementsByStory(renderInputWorkOrder);
  const operatorSourceDetailsByStory = operatorSourceRequirementsByStory(operatorSourceQueue);

  const reviewItems = [];
  const blockedItems = [];
  for (const storyId of storyIds) {
    const incident = incidentByStory.get(storyId) || {};
    const blockedStory = blockedStoriesByStory.get(storyId);
    const storyActions = actionsByStory.get(storyId) || [];
    const storyBlockedActions = blockedActionsByStory.get(storyId) || [];
    if (
      blockedStory ||
      storyBlockedActions.length ||
      incident.verdict === "fail" ||
      incident.safe_to_publish_boolean === false
    ) {
      blockedItems.push(blockedItemFrom(
        blockedStory || { story_id: storyId },
        incident,
        renderInputDetailsByStory.get(storyId),
        operatorSourceDetailsByStory.get(storyId),
      ));
      continue;
    }
    if (!storyActions.length || incident.verdict !== "pass") {
      blockedItems.push(blockedItemFrom(
        { story_id: storyId, blockers: ["human_review_missing_safe_dry_run_evidence"] },
        incident,
        renderInputDetailsByStory.get(storyId),
        operatorSourceDetailsByStory.get(storyId),
      ));
      continue;
    }
    const artifactDir = inferArtifactDir({ incident, actions: storyActions });
    const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
    const coherenceArtifact = await auditPublicOutputCoherenceArtifact({ artifactDir, canonical });
    if (asArray(coherenceArtifact.blockers).length) {
      blockedItems.push(blockedItemFrom(
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: coherenceArtifact.blockers,
        },
        {
          ...incident,
          artifact_dir: artifactDir || incident.artifact_dir,
        },
        renderInputDetailsByStory.get(storyId),
        operatorSourceDetailsByStory.get(storyId),
      ));
      continue;
    }
    reviewItems.push(await buildReviewItem({
      storyId,
      incident,
      actions: storyActions,
      blockedActions: storyBlockedActions,
      tiktokCreatorRewardsJobs,
      tiktokCreatorRewardsRepairs,
    }));
  }

  const limitedReviewItems = reviewItems.slice(0, Math.max(0, Number(maxItems) || 0));
  const publishNowActionCount = limitedReviewItems.reduce(
    (total, item) => total + item.publish_now_platforms.length,
    0,
  );
  const deferredActionCount = limitedReviewItems.reduce(
    (total, item) => total + item.deferred_platforms.length,
    0,
  );

  const approvalRequirements = {
    schema_version: 1,
    generated_at: generatedAt,
    stories: limitedReviewItems.map((item) => ({
      story_id: item.story_id,
      operator_approval_required: true,
      live_publish_allowed_before_approval: false,
      enabled_review_platforms: item.enabled_review_platforms || item.publish_now_platforms,
      publish_now_platforms: item.publish_now_platforms,
      deferred_platforms: item.deferred_platforms,
      platform_repair_requirements: item.platform_repair_requirements,
      platform_enablement_requirements: item.platform_enablement_requirements,
      requirements: item.approval.approval_requirements,
    })),
  };
  const safePublishPlan = {
    schema_version: 1,
    generated_at: generatedAt,
    operating_mode: "HUMAN_REVIEW",
    can_publish_without_operator: false,
    required_next_step: "operator_human_review",
    live_publish_ready_story_count: 0,
    review_item_count: limitedReviewItems.length,
    blocked_item_count: blockedItems.length,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
  const reviewPacketManifest = buildReviewPacketManifest({
    generatedAt,
    reviewItems: limitedReviewItems,
    blockedItems,
  });
  const operatorDecisionLog = buildOperatorDecisionLog({ generatedAt });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "HUMAN_REVIEW",
    summary: {
      review_item_count: limitedReviewItems.length,
      blocked_item_count: blockedItems.length,
      publish_now_action_count: publishNowActionCount,
      deferred_platform_action_count: deferredActionCount,
      ready_for_unattended_publish: false,
      source_dry_run_verdict: dryRunPlan.overall_verdict || null,
    },
    review_items: limitedReviewItems,
    blocked_items: blockedItems,
    approval_requirements: approvalRequirements,
    review_packet_manifest: reviewPacketManifest,
    operator_decision_log: operatorDecisionLog,
    safe_publish_plan: safePublishPlan,
    safety: safePublishPlan.safety,
  };
}

function renderGoalHumanReviewQueueMarkdown(queue = {}) {
  const lines = [
    "# Human Review Queue",
    "",
    `Generated: ${queue.generated_at || "unknown"}`,
    `Review items: ${queue.summary?.review_item_count || 0}`,
    `Blocked items: ${queue.summary?.blocked_item_count || 0}`,
    "No uploads are triggered. No database rows, OAuth settings or token files are changed.",
    "No live publish is allowed before operator approval.",
    "",
  ];
  for (const item of asArray(queue.review_items)) {
    lines.push(
      `## ${item.public_copy?.title || item.story_id}`,
      "",
      `Story: ${item.story_id}`,
      `Verdict: ${item.full_platform_verdict}`,
    `Enabled review platforms: ${(item.enabled_review_platforms || item.publish_now_platforms).join(", ") || "none"}`,
    `Deferred platforms: ${item.deferred_platforms.join(", ") || "none"}`,
    `Platform repair requirements: ${asArray(item.platform_repair_requirements).map((repair) => `${repair.platform}:${repair.repair_lane}`).join(", ") || "none"}`,
    `Platform enablement requirements: ${asArray(item.platform_enablement_requirements).map((requirement) => {
      const gaps = requirement.enablement_gaps?.length ? ` gaps=${requirement.enablement_gaps.join("+")}` : "";
      const next = requirement.enablement_next_action ? ` next=${requirement.enablement_next_action}` : "";
      return `${requirement.platform}:${requirement.operational_state}${gaps}${next}`;
    }).join(", ") || "none"}`,
    `Thumbnail: ${item.public_copy?.thumbnail_headline || "missing"}`,
      `Opening: ${item.public_copy?.first_spoken_line || "missing"}`,
      `Primary source: ${sourceLine(item.source_list?.primary)}`,
      `Video: ${item.evidence?.video_path || "missing"}`,
      "",
    );
  }
  if (asArray(queue.blocked_items).length) {
    lines.push("## Blocked Items", "");
    for (const item of asArray(queue.blocked_items)) {
      const repairSummary = asArray(item.render_input_requirements)
        .map((requirement) => `${requirement.repair_lane || requirement.action_id || "repair"}:${requirement.status || "required"}`)
        .join(", ");
      const sourceSummary = asArray(item.source_intake_requirements?.intake_items)
        .map((requirement) => requirement.intake_type)
        .join(", ");
      const decisionSummary = [
        `queue: ${item.operator_queue_status || "blocked"}`,
        `dead-end: ${item.dead_end_blocker ? "yes" : "no"}`,
        `reject: ${item.reject_recommended ? "yes" : "no"}`,
      ].join(" | ");
      lines.push(
        `- ${item.story_id}: ${decisionSummary} | ${asArray(item.blockers).join(", ") || "blocked"}${repairSummary ? ` | repair: ${repairSummary}` : ""}${sourceSummary ? ` | source intake: ${sourceSummary}` : ""}`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}`;
}

async function writeGoalHumanReviewQueue(queue = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalHumanReviewQueue requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "human_review_queue.json");
  const markdownPath = path.join(outDir, "human_review_queue.md");
  const safePublishPlanPath = path.join(outDir, "safe_publish_plan.json");
  const approvalRequirementsPath = path.join(outDir, "approval_requirements.json");
  const reviewPacketManifestPath = path.join(outDir, "review_packet_manifest.json");
  const operatorDecisionLogPath = path.join(outDir, "operator_decision_log.json");
  const reviewPacketManifest = queue.review_packet_manifest || buildReviewPacketManifest({
    generatedAt: queue.generated_at || new Date().toISOString(),
    reviewItems: queue.review_items,
    blockedItems: queue.blocked_items,
  });
  const operatorDecisionLog = queue.operator_decision_log || buildOperatorDecisionLog({
    generatedAt: queue.generated_at || new Date().toISOString(),
  });
  await fs.writeJson(jsonPath, queue, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalHumanReviewQueueMarkdown(queue), "utf8");
  await fs.writeJson(safePublishPlanPath, queue.safe_publish_plan || {}, { spaces: 2 });
  await fs.writeJson(approvalRequirementsPath, queue.approval_requirements || {}, { spaces: 2 });
  await fs.writeJson(reviewPacketManifestPath, reviewPacketManifest, { spaces: 2 });
  await fs.writeJson(operatorDecisionLogPath, operatorDecisionLog, { spaces: 2 });
  return {
    outputDir: outDir,
    jsonPath,
    markdownPath,
    safePublishPlanPath,
    approvalRequirementsPath,
    reviewPacketManifestPath,
    operatorDecisionLogPath,
  };
}

module.exports = {
  buildGoalHumanReviewQueue,
  renderGoalHumanReviewQueueMarkdown,
  writeGoalHumanReviewQueue,
};
