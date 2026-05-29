"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "24_corrections_retractions_takedowns";

const CLEAR_SOURCE_STATUSES = new Set(["clear", "current", "pass", "unchanged", "verified"]);
const ACTIONABLE_SOURCE_STATUSES = new Set([
  "changed",
  "debunked",
  "retracted",
  "unsafe",
  "takedown_requested",
  "unavailable",
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function passLike(value) {
  return ["pass", "passed", "ready", "green", "ok", "clear"].includes(normaliseStatus(value));
}

function failuresFrom(...values) {
  const failures = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    failures.push(
      ...asArray(value.failures),
      ...asArray(value.blockers),
      ...asArray(value.publish_blockers),
      ...asArray(value.direct_safety_blockers),
      ...asArray(value.direct_registry_blockers),
      ...asArray(value.upstream_blockers),
      ...asArray(value.reason_codes),
      ...asArray(value.errors),
    );
  }
  return unique(failures);
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function buildGoal23Index(upstreamSecurityReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamSecurityReport.stories || upstreamSecurityReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamBlockers(storyId, securityIndex = new Map()) {
  const row = securityIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal23_security_secrets_deployment_safety_missing"];
  const blockers = failuresFrom(row);
  const status = normaliseStatus(row.status || row.verdict || row.final_verdict);
  if (status === "skipped" || row.skipped_by_upstream === true || normaliseStatus(row.upstream_status) === "skipped") return [];
  if (passLike(status) && blockers.length === 0) return [];
  return unique(["upstream:goal23_security_secrets_deployment_safety_blocked", ...blockers]);
}

function upstreamSkippedInfo(storyId, securityIndex = new Map()) {
  const row = securityIndex.get(cleanText(storyId));
  if (!row) return null;
  const status = normaliseStatus(row.status || row.verdict || row.final_verdict);
  if (status !== "skipped" && row.skipped_by_upstream !== true && normaliseStatus(row.upstream_status) !== "skipped") return null;
  return {
    status: "skipped",
    reason: cleanText(row.skipped_reason || row.reason || "upstream skipped before Goal 24"),
  };
}

function sourceStatusFeedPresent(sourceStatusReport = {}) {
  return Boolean(sourceStatusReport.generated_at || sourceStatusReport.generatedAt) && Array.isArray(sourceStatusReport.stories);
}

function buildSourceStatusIndex(sourceStatusReport = {}) {
  const index = new Map();
  for (const row of asArray(sourceStatusReport.stories || sourceStatusReport.signals || sourceStatusReport.sources)) {
    const storyId = cleanText(row.story_id || row.id || row.storyId);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function publicIdsFrom(storyPackage = {}, platformManifest = {}) {
  const outputs = platformManifest.outputs || {};
  const publicIds = {
    youtube_post_id: cleanText(storyPackage.youtube_post_id || outputs.youtube?.post_id || outputs.youtube_shorts?.post_id),
    youtube_url: cleanText(storyPackage.youtube_url || outputs.youtube?.url || outputs.youtube_shorts?.url),
    tiktok_post_id: cleanText(storyPackage.tiktok_post_id || outputs.tiktok?.post_id),
    instagram_media_id: cleanText(storyPackage.instagram_media_id || outputs.instagram?.media_id || outputs.instagram_reels?.media_id),
    facebook_post_id: cleanText(storyPackage.facebook_post_id || outputs.facebook?.post_id || outputs.facebook_reels?.post_id),
    x_post_id: cleanText(storyPackage.x_post_id || storyPackage.twitter_post_id || outputs.x?.post_id || outputs.twitter?.post_id),
  };
  return Object.fromEntries(Object.entries(publicIds).filter(([, value]) => value));
}

async function loadStoryPackage(storyPackage = {}, { workspaceRoot } = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const sourceManifest = await readJsonIfPresent(path.join(artifactDir, "source_manifest.json"), {});
  const claimInventory = await readJsonIfPresent(path.join(artifactDir, "claim_inventory.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const affiliateManifest = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  const landingPageManifest = await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"), {});
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    title: cleanText(canonical.selected_title || canonical.canonical_title || storyPackage.title),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.subject || storyPackage.canonical_subject),
    primary_source: cleanText(sourceManifest.primary_source || canonical.primary_source),
    primary_source_url: cleanText(sourceManifest.primary_source_url || canonical.primary_source_url || storyPackage.source_url),
    confirmed_claims: asArray(claimInventory.confirmed_claims || claimInventory.claim_inventory?.map((item) => item.claim)),
    public_ids: publicIdsFrom(storyPackage, platformManifest),
    has_affiliate_links: Boolean(affiliateManifest.primary_link || asArray(affiliateManifest.links).length),
    landing_page_path: cleanText(landingPageManifest.path || landingPageManifest.url || landingPageManifest.output_path),
    source_material: {
      canonical_story_manifest_present: Object.keys(canonical).length > 0,
      source_manifest_present: Object.keys(sourceManifest).length > 0,
      claim_inventory_present: Object.keys(claimInventory).length > 0,
      platform_publish_manifest_present: Object.keys(platformManifest).length > 0,
      affiliate_link_manifest_present: Object.keys(affiliateManifest).length > 0,
      landing_page_manifest_present: Object.keys(landingPageManifest).length > 0,
    },
  };
}

function severityFor(signal = {}) {
  const severity = normaliseStatus(signal.severity || signal.risk || signal.priority);
  if (["critical", "p0", "high"].includes(severity)) return "high";
  if (["medium", "p1", "review"].includes(severity)) return "medium";
  if (["low", "p2"].includes(severity)) return "low";
  const status = normaliseStatus(signal.source_status || signal.status);
  if (["debunked", "retracted", "unsafe", "takedown_requested"].includes(status)) return "high";
  if (status === "changed" || status === "unavailable") return "medium";
  return "low";
}

function recommendedPublicStatus(signal = {}, story = {}) {
  const status = normaliseStatus(signal.source_status || signal.status);
  const severity = severityFor(signal);
  const hasPublicIds = Object.keys(story.public_ids || {}).length > 0;
  if (!hasPublicIds) return "hold_publish_queue";
  if (status === "takedown_requested") return "escalate_takedown_review";
  if (severity === "high" || ["debunked", "retracted", "unsafe"].includes(status)) return "escalate_unlist_review";
  if (status === "changed") return "description_and_comment_update";
  return "operator_review";
}

function sourceSignalBlockers(signal = {}, story = {}) {
  const status = normaliseStatus(signal.source_status || signal.status);
  if (CLEAR_SOURCE_STATUSES.has(status)) return [];
  if (!status) return ["corrections:story_source_status_missing"];
  if (!ACTIONABLE_SOURCE_STATUSES.has(status)) return ["corrections:source_status_unknown"];
  const blockers = [`corrections:${status}_source_signal`, "corrections:human_authorisation_required"];
  if (Object.keys(story.public_ids || {}).length > 0) blockers.push("corrections:public_content_review_required");
  return unique(blockers);
}

function buildAffectedItem(story = {}, signal = {}) {
  const status = normaliseStatus(signal.source_status || signal.status);
  const affectedClaims = asArray(signal.affected_claims || signal.claims).length
    ? asArray(signal.affected_claims || signal.claims)
    : story.confirmed_claims;
  return {
    story_id: story.story_id,
    title: story.title,
    canonical_subject: story.canonical_subject,
    source_status: status,
    severity: severityFor(signal),
    reason: cleanText(signal.reason || signal.summary || "Source status requires operator review."),
    source_url: cleanText(signal.source_url || story.primary_source_url),
    evidence_url: cleanText(signal.evidence_url || signal.url),
    affected_claims: affectedClaims,
    public_ids: story.public_ids,
    has_affiliate_links: story.has_affiliate_links,
    landing_page_path: story.landing_page_path || null,
    recommended_public_status: recommendedPublicStatus(signal, story),
    operator_authorisation_required: true,
  };
}

function queueItemForAffected(affected = {}, index = 0) {
  return {
    id: `${affected.story_id || "story"}_correction_${index + 1}`,
    story_id: affected.story_id,
    priority: affected.severity === "high" ? "P0" : affected.severity === "medium" ? "P1" : "P2",
    status: "needs_operator_review",
    action: "review_correction_or_takedown_plan",
    reason: affected.reason,
    recommended_public_status: affected.recommended_public_status,
    human_authorisation_required: true,
  };
}

function queueItemForMissingStatus(story = {}, reasonCode = "corrections:source_status_signal_missing") {
  return {
    id: `${story.story_id || "story"}_source_status_required`,
    story_id: story.story_id,
    priority: "P1",
    status: "blocked",
    action: "collect_current_source_status",
    reason_code: reasonCode,
    human_authorisation_required: false,
  };
}

function buildSourceStatusSignal(story = {}, generatedAt = null) {
  const publicIds = publicIdsFrom(story, {});
  const hasPublicOutput = Object.keys(story.public_ids || publicIds).length > 0;
  const hasLockedPrimarySource = Boolean(story.primary_source_url && story.primary_source);
  if (!hasLockedPrimarySource) {
    return {
      story_id: story.story_id,
      source_status: "unknown",
      monitor_status: "locked_primary_source_missing",
      checked_at: generatedAt,
      source_name: story.primary_source || null,
      source_url: story.primary_source_url || null,
      reason: "The package does not have enough locked primary-source evidence for correction monitoring.",
    };
  }
  if (hasPublicOutput) {
    return {
      story_id: story.story_id,
      source_status: "unknown",
      monitor_status: "live_public_source_check_required",
      checked_at: generatedAt,
      source_name: story.primary_source,
      source_url: story.primary_source_url,
      reason: "This story has public post identifiers, so an operator or live source check must confirm the source status before the correction gate clears.",
    };
  }
  return {
    story_id: story.story_id,
    source_status: "current",
    monitor_status: "baseline_from_locked_source",
    checked_at: generatedAt,
    source_name: story.primary_source,
    source_url: story.primary_source_url,
    reason: "No public post identifiers are attached; the correction watch baseline was created from the locked primary source.",
    evidence: {
      canonical_subject: story.canonical_subject || null,
      title: story.title || null,
      primary_source_locked: true,
      public_output_present: false,
    },
  };
}

async function buildSourceStatusReportFromStoryPackages({
  storyPackages = [],
  upstreamSecurityReport = {},
  workspaceRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
} = {}) {
  const securityIndex = buildGoal23Index(upstreamSecurityReport);
  const stories = [];
  const skipped = [];
  for (const storyPackage of asArray(storyPackages)) {
    const loaded = await loadStoryPackage(storyPackage, { workspaceRoot });
    const skippedInfo = upstreamSkippedInfo(loaded.story_id, securityIndex);
    if (skippedInfo) {
      skipped.push({
        story_id: loaded.story_id,
        status: "skipped",
        reason: skippedInfo.reason,
      });
      continue;
    }
    stories.push(buildSourceStatusSignal(loaded, generatedAt));
  }
  const currentCount = stories.filter((story) => CLEAR_SOURCE_STATUSES.has(normaliseStatus(story.source_status))).length;
  const reviewCount = stories.length - currentCount;
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    monitor: "locked_source_baseline",
    stories,
    skipped,
    summary: {
      story_count: stories.length,
      current_count: currentCount,
      review_required_count: reviewCount,
      skipped_story_count: skipped.length,
    },
    safety: {
      report_only: true,
      no_external_posting: true,
      no_platform_mutation: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildCorrectionPlan(affectedItems = []) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    mode: "LOCAL_PROOF",
    operator_authorisation_required: affectedItems.length > 0,
    description_updates: affectedItems.map((item) => ({
      story_id: item.story_id,
      status: "draft_not_applied",
      draft: `Correction note: ${item.reason} Re-check the linked source before treating the earlier claim as current.`,
      target_public_ids: item.public_ids,
    })),
    pinned_comment_corrections: affectedItems.map((item) => ({
      story_id: item.story_id,
      status: "draft_not_posted",
      draft: `Correction for this short: ${item.reason} We are holding the earlier claim until the source record is resolved.`,
      target_public_ids: item.public_ids,
    })),
    platform_actions: affectedItems.map((item) => ({
      story_id: item.story_id,
      recommended_public_status: item.recommended_public_status,
      status: "not_applied",
      live_action_allowed_by_goal24: false,
    })),
    landing_page_changes: affectedItems
      .filter((item) => item.landing_page_path)
      .map((item) => ({
        story_id: item.story_id,
        path: item.landing_page_path,
        status: "draft_not_applied",
        action: "add_correction_banner_and_source_status",
      })),
    affiliate_disablements: affectedItems
      .filter((item) => item.has_affiliate_links)
      .map((item) => ({
        story_id: item.story_id,
        status: "draft_not_applied",
        action: "disable_related_affiliate_modules_until_operator_review",
      })),
    correction_logs: affectedItems.map((item) => ({
      story_id: item.story_id,
      status: "draft",
      event: "source_status_change_detected",
      reason: item.reason,
      evidence_url: item.evidence_url || null,
    })),
  };
}

function buildTakedownResponseLog(affectedItems = [], generatedAt = null) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    entries: affectedItems.map((item, index) => ({
      id: `${item.story_id || "story"}_takedown_${index + 1}`,
      story_id: item.story_id,
      source_status: item.source_status,
      recommended_public_status: item.recommended_public_status,
      target_public_ids: item.public_ids,
      status: "draft_not_sent",
      operator_authorisation_required: true,
      no_live_takedown_performed: true,
    })),
    safety: {
      no_external_posting: true,
      no_live_unlist_delete: true,
    },
  };
}

function finaliseStory({ story, upstream, directBlockers, signal, affected }) {
  const blockers = unique([...upstream, ...directBlockers]);
  return {
    ...story,
    status: blockers.length ? "blocked" : "ready",
    upstream_status: upstream.length ? "blocked" : "ready",
    direct_corrections_status: directBlockers.length ? "blocked" : "pass",
    source_status: normaliseStatus(signal?.source_status || signal?.status) || null,
    blockers,
    upstream_blockers: upstream,
    direct_corrections_blockers: directBlockers,
    affected_content: Boolean(affected),
    recommended_public_status: affected?.recommended_public_status || null,
    publish_allowed_by_goal24: false,
    safety: {
      local_proof_only: true,
      no_external_posting: true,
      no_platform_mutation: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function finaliseSkippedStory({ story, skipped }) {
  return {
    ...story,
    status: "skipped",
    skipped_reason: skipped?.reason || "upstream skipped before Goal 24",
    upstream_status: "skipped",
    direct_corrections_status: "skipped",
    source_status: null,
    blockers: [],
    upstream_blockers: [],
    direct_corrections_blockers: [],
    affected_content: false,
    recommended_public_status: null,
    publish_allowed_by_goal24: false,
    safety: {
      local_proof_only: true,
      no_external_posting: true,
      no_platform_mutation: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function directRiskCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.direct_corrections_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

async function buildGoal24CorrectionsRetractionsTakedowns({
  storyPackages = [],
  upstreamSecurityReport = {},
  sourceStatusReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal24CorrectionsRetractionsTakedowns requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const sourceFeedPresent = sourceStatusFeedPresent(sourceStatusReport);
  const sourceIndex = buildSourceStatusIndex(sourceStatusReport);
  const securityIndex = buildGoal23Index(upstreamSecurityReport);
  const loadedStories = [];
  for (const storyPackage of asArray(storyPackages)) {
    loadedStories.push(await loadStoryPackage(storyPackage, { workspaceRoot }));
  }

  const affectedItems = [];
  const missingStatusItems = [];
  const stories = loadedStories.map((story) => {
    const skipped = upstreamSkippedInfo(story.story_id, securityIndex);
    if (skipped) return finaliseSkippedStory({ story, skipped });

    const upstream = upstreamBlockers(story.story_id, securityIndex);
    const directBlockers = [];
    const signal = sourceIndex.get(story.story_id);
    let affected = null;

    if (!sourceFeedPresent) {
      directBlockers.push("corrections:source_status_signal_missing");
      missingStatusItems.push(queueItemForMissingStatus(story));
    } else if (!signal) {
      directBlockers.push("corrections:story_source_status_missing");
      missingStatusItems.push(queueItemForMissingStatus(story, "corrections:story_source_status_missing"));
    } else {
      directBlockers.push(...sourceSignalBlockers(signal, story));
      if (directBlockers.includes("corrections:human_authorisation_required")) {
        affected = buildAffectedItem(story, signal);
        affectedItems.push(affected);
      }
    }

    return finaliseStory({ story, upstream, directBlockers: unique(directBlockers), signal, affected });
  });

  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const skippedStories = stories.filter((story) => story.status === "skipped");
  const directPassStories = stories.filter((story) => story.direct_corrections_status === "pass");
  const directBlockedStories = stories.filter((story) => story.direct_corrections_status === "blocked");
  const upstreamBlockedStories = stories.filter((story) => story.upstream_status === "blocked");
  const activeStories = stories.filter((story) => story.status !== "skipped");
  const verdict = !stories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : activeStories.length || skippedStories.length
          ? "PASS"
          : "PASS";
  const directCorrectionsVerdict = !stories.length
    ? "FAIL"
    : directBlockedStories.length && directPassStories.length
      ? "PARTIAL"
      : directBlockedStories.length
        ? "BLOCKED"
        : "PASS";

  const correctionQueue = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    status: affectedItems.length || missingStatusItems.length ? "needs_review" : "clear",
    items: [
      ...affectedItems.map(queueItemForAffected),
      ...missingStatusItems,
    ],
    safety: {
      no_public_replies_sent: true,
      no_description_updates_applied: true,
      no_platform_mutation: true,
    },
  };
  const affectedContentReport = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    affected_items: affectedItems,
    affected_count: affectedItems.length,
    safety: {
      report_only: true,
      no_live_unlist_delete: true,
    },
  };
  const correctionPlan = buildCorrectionPlan(affectedItems);
  const takedownResponseLog = buildTakedownResponseLog(affectedItems, generatedAt);

  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    direct_corrections_verdict: directCorrectionsVerdict,
    summary: {
      story_count: stories.length,
      correction_ready_story_count: readyStories.length,
      skipped_story_count: skippedStories.length,
      blocked_story_count: blockedStories.length,
      direct_corrections_pass_story_count: directPassStories.length,
      direct_corrections_blocked_story_count: directBlockedStories.length,
      upstream_blocked_story_count: upstreamBlockedStories.length,
      affected_content_count: affectedItems.length,
      correction_queue_item_count: correctionQueue.items.length,
      publish_now_count: 0,
    },
    source_status_report: {
      present: sourceFeedPresent,
      generated_at: sourceStatusReport.generated_at || sourceStatusReport.generatedAt || null,
      signal_count: sourceIndex.size,
    },
    blocker_counts: blockerCounts(stories),
    direct_risk_counts: directRiskCounts(stories),
    upstream_blockers: {
      goal23_security_secrets_deployment_safety:
        "Goal 24 can compile correction and takedown readiness artefacts, but public correction readiness requires Goal 23 and earlier campaign gates to pass first.",
      note:
        "This gate emits LOCAL_PROOF files only. It does not edit descriptions, post pinned comments, unlist, delete, disable affiliate links, mutate production rows or call platform APIs.",
    },
    stories,
    correction_queue: correctionQueue,
    affected_content_report: affectedContentReport,
    correction_plan: correctionPlan,
    takedown_response_log: takedownResponseLog,
    safety: {
      local_proof_only: true,
      dry_run_publish_only: true,
      no_external_posting: true,
      no_platform_mutation: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_live_unlist_delete: true,
      no_affiliate_disablement_applied: true,
      no_gate_weakened: true,
    },
  };
}

function renderGoal24CorrectionsRetractionsTakedownsMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 24 - Corrections, Retractions and Takedowns");
  lines.push("");
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct corrections verdict: ${report.direct_corrections_verdict || "UNKNOWN"}`);
  lines.push(`Mode: ${report.mode || "LOCAL_PROOF"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Stories checked: ${report.summary?.story_count ?? 0}`);
  lines.push(`- Ready stories: ${report.summary?.correction_ready_story_count ?? 0}`);
  lines.push(`- Skipped stories: ${report.summary?.skipped_story_count ?? 0}`);
  lines.push(`- Blocked stories: ${report.summary?.blocked_story_count ?? 0}`);
  lines.push(`- Upstream-blocked stories: ${report.summary?.upstream_blocked_story_count ?? 0}`);
  lines.push(`- Direct corrections pass stories: ${report.summary?.direct_corrections_pass_story_count ?? 0}`);
  lines.push(`- Direct corrections blocked stories: ${report.summary?.direct_corrections_blocked_story_count ?? 0}`);
  lines.push(`- Affected content items: ${report.summary?.affected_content_count ?? 0}`);
  lines.push(`- Correction queue items: ${report.summary?.correction_queue_item_count ?? 0}`);
  lines.push(`- Publish-now actions: ${report.summary?.publish_now_count ?? 0}`);
  lines.push("");
  lines.push("## Direct Blockers");
  const directBlockers = Object.keys(report.direct_risk_counts || {});
  if (directBlockers.length) {
    for (const blocker of directBlockers) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  } else {
    lines.push("- None.");
  }
  lines.push("");
  lines.push("## Main Blockers");
  const blockers = Object.keys(report.blocker_counts || {});
  if (blockers.length) {
    for (const blocker of blockers.slice(0, 40)) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
    if (blockers.length > 40) lines.push(`- Additional blocker types: ${blockers.length - 40}`);
  } else {
    lines.push("- None.");
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- LOCAL_PROOF only.");
  lines.push("- No public correction, unlist, delete, affiliate disablement or platform mutation was performed.");
  lines.push("- No production DB mutation, OAuth/token mutation or external posting occurred.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal24CorrectionsRetractionsTakedowns(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal24CorrectionsRetractionsTakedowns requires outputDir");
  await fs.ensureDir(outputDir);
  const paths = {
    readinessJson: path.join(outputDir, "goal24_readiness_report.json"),
    readinessMarkdown: path.join(outputDir, "goal24_readiness_report.md"),
    correctionQueue: path.join(outputDir, "correction_queue.json"),
    affectedContentReport: path.join(outputDir, "affected_content_report.json"),
    correctionPlan: path.join(outputDir, "correction_plan.json"),
    takedownResponseLog: path.join(outputDir, "takedown_response_log.json"),
  };
  await fs.writeJson(paths.readinessJson, report, { spaces: 2 });
  await fs.outputFile(paths.readinessMarkdown, renderGoal24CorrectionsRetractionsTakedownsMarkdown(report));
  await fs.writeJson(paths.correctionQueue, report.correction_queue || {}, { spaces: 2 });
  await fs.writeJson(paths.affectedContentReport, report.affected_content_report || {}, { spaces: 2 });
  await fs.writeJson(paths.correctionPlan, report.correction_plan || {}, { spaces: 2 });
  await fs.writeJson(paths.takedownResponseLog, report.takedown_response_log || {}, { spaces: 2 });
  return paths;
}

module.exports = {
  GOAL_ID,
  ACTIONABLE_SOURCE_STATUSES,
  buildSourceStatusReportFromStoryPackages,
  buildGoal24CorrectionsRetractionsTakedowns,
  renderGoal24CorrectionsRetractionsTakedownsMarkdown,
  writeGoal24CorrectionsRetractionsTakedowns,
};
