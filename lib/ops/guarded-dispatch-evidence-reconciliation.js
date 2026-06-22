"use strict";

const ENABLED_ACTION_PLATFORMS = [
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
];

const ACTION_TO_STRUCTURED_PLATFORM = {
  youtube_shorts: "youtube",
  tiktok: "tiktok",
  instagram_reels: "instagram_reel",
  instagram_stories: "instagram_story",
  facebook_reels: "facebook_reel",
  facebook_stories: "facebook_story",
  x_video: "twitter_video",
  x_image: "twitter_image",
};

const LEGACY_PLATFORM_FIELDS = {
  youtube: {
    idField: "youtube_post_id",
    urlField: "youtube_url",
    publishedAtFields: ["youtube_published_at", "published_at"],
  },
  instagram_reel: {
    idField: "instagram_media_id",
    urlField: null,
    publishedAtFields: ["instagram_published_at", "published_at"],
  },
  facebook_reel: {
    idField: "facebook_post_id",
    urlField: null,
    publishedAtFields: ["facebook_published_at", "published_at"],
  },
  tiktok: {
    idField: "tiktok_post_id",
    urlField: null,
    publishedAtFields: ["tiktok_published_at", "published_at"],
  },
};

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function clean(value) {
  return String(value || "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function statusVerdict(value) {
  return lower(value?.verdict || value?.overall_verdict || value?.status || "");
}

function isNonRed(value) {
  return statusVerdict(value) !== "red";
}

function normaliseActionPlatform(platform) {
  return ACTION_TO_STRUCTURED_PLATFORM[clean(platform)] || clean(platform);
}

function storyExternalEvidence(story = {}, structuredPlatform = "") {
  const fields = LEGACY_PLATFORM_FIELDS[structuredPlatform] || {};
  const externalId = clean(story[fields.idField]);
  const externalUrl = fields.urlField ? clean(story[fields.urlField]) : "";
  const publishedAt = asArray(fields.publishedAtFields)
    .map((field) => clean(story[field]))
    .find(Boolean);
  return {
    platform: structuredPlatform,
    legacy_id_field: fields.idField || null,
    legacy_url_field: fields.urlField || null,
    external_id: externalId || null,
    external_url: externalUrl || null,
    published_at: publishedAt || null,
    present: !!externalId,
  };
}

function findPlatformRows(platformRows = [], storyId = "", structuredPlatform = "") {
  return asArray(platformRows).filter(
    (row) =>
      clean(row.story_id) === clean(storyId) &&
      clean(row.platform) === clean(structuredPlatform),
  );
}

function hasPublishedPlatformRow(platformRows = [], storyId = "", structuredPlatform = "", externalId = "") {
  return findPlatformRows(platformRows, storyId, structuredPlatform).some((row) => {
    if (clean(row.status) !== "published") return false;
    if (!externalId) return true;
    return clean(row.external_id) === clean(externalId);
  });
}

function buildPartialYoutubeEvidenceReport({
  story = null,
  platformRows = [],
  storyId = "1s4j81q",
  actionId = "1s4j81q:youtube_shorts",
  expectedYoutubeId = "U4XB3MEaCg0",
  selector = {},
} = {}) {
  const youtube = storyExternalEvidence(story || {}, "youtube");
  const rows = findPlatformRows(platformRows, storyId, "youtube");
  const selectorSkip = asArray(selector.skipped_actions).find(
    (action) => clean(action.action_id) === actionId,
  );
  const publishedRowPresent = hasPublishedPlatformRow(
    platformRows,
    storyId,
    "youtube",
    youtube.external_id || expectedYoutubeId,
  );
  const expectedIdMatches =
    !expectedYoutubeId || youtube.external_id === expectedYoutubeId;
  const willRetry = clean(selector.action_id) === actionId;

  const blockers = [];
  if (!story) blockers.push("canonical_story_row_missing");
  if (!youtube.present) blockers.push("youtube_result_missing_from_story_row");
  if (!expectedIdMatches) blockers.push("youtube_result_does_not_match_expected_id");
  if (willRetry) blockers.push("selector_would_retry_existing_youtube_action");

  return {
    story_id: storyId,
    action_id: actionId,
    expected_youtube_id: expectedYoutubeId,
    story_row_present: !!story,
    story_youtube_evidence: youtube,
    platform_posts_rows: rows,
    platform_posts_published_row_present: publishedRowPresent,
    platform_posts_structured_gap:
      youtube.present && !publishedRowPresent,
    selector_terminal_state: selectorSkip
      ? {
          action_id: selectorSkip.action_id,
          reason: selectorSkip.reason,
          external_id: selectorSkip.external_id || null,
        }
      : null,
    retry_risk: willRetry,
    verdict: blockers.length ? "fail" : publishedRowPresent ? "pass" : "partial",
    blockers,
    advisory: publishedRowPresent
      ? []
      : [
          "legacy story row prevents retry, but structured platform_posts evidence is missing for this historical upload",
        ],
  };
}

function buildPoisonActionTerminalStateReport({
  selector = {},
  poisonStoryId = "1s49ty7",
} = {}) {
  const skipped = asArray(selector.skipped_actions).filter(
    (action) => clean(action.story_id) === poisonStoryId,
  );
  const selectedPoison = clean(selector.action?.story_id) === poisonStoryId;
  const platforms = {};
  for (const action of skipped) {
    platforms[clean(action.platform)] = {
      action_id: clean(action.action_id),
      reason: clean(action.reason),
      external_id: action.external_id || null,
      error: action.error || null,
    };
  }
  const blockers = [];
  if (selectedPoison) blockers.push("poison_story_selected_for_next_live_action");
  const absentFromCurrentHandoff = !selectedPoison && skipped.length === 0;

  return {
    story_id: poisonStoryId,
    selected_for_next_action: selectedPoison,
    skipped_action_count: skipped.length,
    skipped_actions: skipped,
    platforms,
    terminal_or_held:
      absentFromCurrentHandoff ||
      (
        !selectedPoison &&
        skipped.length > 0 &&
        skipped.every((action) =>
          [
            "already_published",
            "duplicate_blocked",
            "previous_story_public_copy_failure",
            "previous_platform_failure",
          ].includes(clean(action.reason)),
        )
      ),
    verdict: blockers.length ? "fail" : absentFromCurrentHandoff ? "not_applicable" : "pass",
    blockers,
  };
}

function legacyPublishedEvidenceForStory(story = {}) {
  const rows = [];
  for (const [platform, fields] of Object.entries(LEGACY_PLATFORM_FIELDS)) {
    const externalId = clean(story[fields.idField]);
    if (!externalId) continue;
    rows.push({
      story_id: clean(story.id),
      title: clean(story.title),
      platform,
      external_id: externalId,
      external_url: fields.urlField ? clean(story[fields.urlField]) || null : null,
      published_at:
        asArray(fields.publishedAtFields)
          .map((field) => clean(story[field]))
          .find(Boolean) || null,
    });
  }
  return rows;
}

function buildPlatformPostsIntegrityReport({
  stories = [],
  platformRows = [],
  targetStoryIds = [],
  exampleLimit = 20,
} = {}) {
  const legacyEvidence = asArray(stories).flatMap(legacyPublishedEvidenceForStory);
  const missingStructuredEvidence = legacyEvidence.filter(
    (item) =>
      !hasPublishedPlatformRow(
        platformRows,
        item.story_id,
        item.platform,
        item.external_id,
      ),
  );
  const targetSet = new Set(asArray(targetStoryIds).map(clean).filter(Boolean));
  const targetMissing = missingStructuredEvidence.filter((item) =>
    targetSet.has(item.story_id),
  );
  const publishedPlatformRows = asArray(platformRows).filter(
    (row) => clean(row.status) === "published",
  );
  const failedWithExternalId = asArray(platformRows).filter(
    (row) => clean(row.status) === "failed" && clean(row.external_id),
  );

  return {
    generated_scope: "read_only_local_db_snapshot",
    counts: {
      stories_seen: asArray(stories).length,
      platform_posts_rows_seen: asArray(platformRows).length,
      legacy_published_evidence_count: legacyEvidence.length,
      published_platform_posts_count: publishedPlatformRows.length,
      missing_structured_evidence_count: missingStructuredEvidence.length,
      target_missing_structured_evidence_count: targetMissing.length,
      failed_platform_posts_with_external_id_count: failedWithExternalId.length,
    },
    target_story_ids: Array.from(targetSet),
    target_missing_structured_evidence: targetMissing,
    missing_structured_evidence_examples: missingStructuredEvidence.slice(0, exampleLimit),
    failed_platform_posts_with_external_id_examples: failedWithExternalId.slice(0, exampleLimit),
    verdict: targetMissing.length || failedWithExternalId.length ? "partial" : "pass",
    advisory: targetMissing.length
      ? [
          "target story has legacy publication evidence but lacks structured platform_posts evidence; do not backfill without operator-approved repair plan",
        ]
      : [],
  };
}

function buildNextWindowSchedulerVerification({
  runtimeSentinel = {},
  queueInspect = {},
  publishCadence = {},
  publishReadiness = {},
  selector = {},
} = {}) {
  const blockers = [];
  const skippedActions = asArray(selector.skipped_actions);
  const schedulerScopedReadiness =
    publishReadiness.readiness_scope?.name === "enabled_platform_guarded_scheduler_window" &&
    publishReadiness.readiness_scope?.guard_ready === true;
  const scopedExecutorPlanAlreadyConsumed =
    selector.exhausted === true &&
    skippedActions.length > 0 &&
    skippedActions.every((action) => clean(action.reason) === "already_published");
  if (!isNonRed(runtimeSentinel)) blockers.push("runtime_sentinel_red");
  if (!isNonRed(queueInspect)) blockers.push("queue_inspect_red");
  if (!isNonRed(publishCadence)) blockers.push("publish_cadence_red");
  if (!isNonRed(publishReadiness)) blockers.push("publish_readiness_red");
  if (selector.exhausted === true && !schedulerScopedReadiness && !scopedExecutorPlanAlreadyConsumed) {
    blockers.push("no_next_guarded_live_action");
  }

  const nextAction = selector.action
    ? {
        action_id: selector.action_id || selector.action.action_id || null,
        story_id: selector.action.story_id || null,
        platform: selector.action.platform || null,
        structured_platform: normaliseActionPlatform(selector.action.platform),
        title: selector.action.title || null,
      }
    : null;

  return {
    runtime_sentinel_verdict: statusVerdict(runtimeSentinel) || "unknown",
    queue_inspect_verdict: statusVerdict(queueInspect) || "unknown",
    publish_cadence_verdict: statusVerdict(publishCadence) || "unknown",
    publish_readiness_verdict: statusVerdict(publishReadiness) || "unknown",
    next_safe_publish_at_utc:
      publishCadence.next_safe_publish?.next_safe_publish_at_utc ||
      publishCadence.summary?.next_safe_publish_at_utc ||
      null,
    scheduler_window_readiness:
      runtimeSentinel.scheduler_window_readiness || null,
    next_guarded_action: nextAction,
    scheduler_scoped_selection_deferred_until_window: schedulerScopedReadiness && !nextAction,
    scoped_executor_plan_already_consumed: scopedExecutorPlanAlreadyConsumed,
    skipped_before_next_action: skippedActions,
    safe_to_observe_next_window:
      blockers.length === 0 &&
      (runtimeSentinel.scheduler_window_readiness?.safe_to_observe_next_window !== false),
    blockers,
    verdict: blockers.length ? "fail" : "pass",
  };
}

function buildGuardedDispatchEvidenceReconciliationReport({
  generatedAt = new Date().toISOString(),
  story = null,
  stories = [],
  platformRows = [],
  selector = {},
  runtimeSentinel = {},
  queueInspect = {},
  publishCadence = {},
  publishReadiness = {},
  storyId = "1s4j81q",
  actionId = "1s4j81q:youtube_shorts",
  expectedYoutubeId = "U4XB3MEaCg0",
  poisonStoryId = "1s49ty7",
} = {}) {
  const partialYoutubeEvidence = buildPartialYoutubeEvidenceReport({
    story,
    platformRows,
    storyId,
    actionId,
    expectedYoutubeId,
    selector,
  });
  const poisonActionTerminalState = buildPoisonActionTerminalStateReport({
    selector,
    poisonStoryId,
  });
  const platformPostsIntegrity = buildPlatformPostsIntegrityReport({
    stories,
    platformRows,
    targetStoryIds: [storyId, poisonStoryId],
  });
  const nextWindowSchedulerVerification = buildNextWindowSchedulerVerification({
    runtimeSentinel,
    queueInspect,
    publishCadence,
    publishReadiness,
    selector,
  });

  const blockers = [
    ...partialYoutubeEvidence.blockers,
    ...poisonActionTerminalState.blockers,
    ...nextWindowSchedulerVerification.blockers,
  ];
  const hasStructuredGap = partialYoutubeEvidence.platform_posts_structured_gap;
  const verdict = blockers.length ? "fail" : hasStructuredGap ? "partial" : "pass";

  return {
    generated_at: generatedAt,
    mode: "GUARDED_DISPATCH_EVIDENCE_RECONCILIATION",
    verdict,
    safety: {
      read_only: true,
      live_publish_attempted: false,
      db_mutation: false,
      oauth_or_token_mutation: false,
      disabled_platforms_counted_live: false,
      enabled_action_platforms: ENABLED_ACTION_PLATFORMS,
      deferred_platforms: ["tiktok", "x", "threads", "pinterest"],
    },
    summary: {
      target_story_id: storyId,
      target_youtube_action_id: actionId,
      target_youtube_id: expectedYoutubeId,
      target_youtube_retry_risk: partialYoutubeEvidence.retry_risk,
      target_structured_evidence_gap: hasStructuredGap,
      poison_story_id: poisonStoryId,
      poison_story_selected: poisonActionTerminalState.selected_for_next_action,
      next_guarded_action:
        nextWindowSchedulerVerification.next_guarded_action?.action_id || null,
      safe_to_observe_next_window:
        nextWindowSchedulerVerification.safe_to_observe_next_window,
    },
    partial_youtube_evidence: partialYoutubeEvidence,
    poison_action_terminal_state: poisonActionTerminalState,
    platform_posts_integrity: platformPostsIntegrity,
    next_window_scheduler_verification: nextWindowSchedulerVerification,
    blockers,
    advisory: [
      ...partialYoutubeEvidence.advisory,
      ...platformPostsIntegrity.advisory,
    ],
    next_action: blockers.length
      ? "hold_scheduler_or_dispatch_and_repair_blockers"
      : "observe_next_guarded_scheduler_window_without_manual_publish",
  };
}

function formatGuardedDispatchEvidenceReconciliationMarkdown(report = {}) {
  const nextAction = report.next_window_scheduler_verification?.next_guarded_action || {};
  return [
    "# Guarded Dispatch Evidence Reconciliation",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${String(report.verdict || "unknown").toUpperCase()}`,
    "",
    "## Partial YouTube Evidence",
    "",
    `Story: ${report.partial_youtube_evidence?.story_id || "unknown"}`,
    `Action: ${report.partial_youtube_evidence?.action_id || "unknown"}`,
    `YouTube ID: ${report.partial_youtube_evidence?.story_youtube_evidence?.external_id || "missing"}`,
    `Retry risk: ${report.partial_youtube_evidence?.retry_risk === true ? "yes" : "no"}`,
    `Structured platform_posts row: ${
      report.partial_youtube_evidence?.platform_posts_published_row_present ? "present" : "missing"
    }`,
    "",
    "## Poison Action",
    "",
    `Story: ${report.poison_action_terminal_state?.story_id || "unknown"}`,
    `Selected next: ${report.poison_action_terminal_state?.selected_for_next_action === true ? "yes" : "no"}`,
    `Skipped actions: ${report.poison_action_terminal_state?.skipped_action_count ?? 0}`,
    "",
    "## Next Window",
    "",
    `Runtime sentinel: ${report.next_window_scheduler_verification?.runtime_sentinel_verdict || "unknown"}`,
    `Queue inspect: ${report.next_window_scheduler_verification?.queue_inspect_verdict || "unknown"}`,
    `Cadence: ${report.next_window_scheduler_verification?.publish_cadence_verdict || "unknown"}`,
    `Readiness: ${report.next_window_scheduler_verification?.publish_readiness_verdict || "unknown"}`,
    `Next safe publish UTC: ${report.next_window_scheduler_verification?.next_safe_publish_at_utc || "unknown"}`,
    `Next action: ${nextAction.action_id || "none"} (${nextAction.platform || "none"})`,
    `Safe to observe: ${
      report.next_window_scheduler_verification?.safe_to_observe_next_window ? "yes" : "no"
    }`,
    "",
    "## Blockers",
    "",
    ...(report.blockers?.length ? report.blockers.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Advisory",
    "",
    ...(report.advisory?.length ? report.advisory.map((item) => `- ${item}`) : ["- none"]),
    "",
    `Next action: ${report.next_action || "unknown"}`,
    "",
  ].join("\n");
}

module.exports = {
  ACTION_TO_STRUCTURED_PLATFORM,
  ENABLED_ACTION_PLATFORMS,
  buildGuardedDispatchEvidenceReconciliationReport,
  buildNextWindowSchedulerVerification,
  buildPartialYoutubeEvidenceReport,
  buildPlatformPostsIntegrityReport,
  buildPoisonActionTerminalStateReport,
  formatGuardedDispatchEvidenceReconciliationMarkdown,
  normaliseActionPlatform,
};
