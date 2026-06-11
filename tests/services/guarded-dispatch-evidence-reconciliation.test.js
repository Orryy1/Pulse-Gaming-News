"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildGuardedDispatchEvidenceReconciliationReport,
  buildPlatformPostsIntegrityReport,
} = require("../../lib/ops/guarded-dispatch-evidence-reconciliation");
const {
  selectNextGuardedLiveAction,
} = require("../../lib/goal-guarded-live-dispatch-executor");

function action(storyId, platform, overrides = {}) {
  return {
    action_id: `${storyId}:${platform}`,
    story_id: storyId,
    platform,
    title: overrides.title || "Test Story",
    ...overrides,
  };
}

test("reconciliation treats legacy YouTube result as terminal even when platform_posts row is missing", async () => {
  const stories = [
    {
      id: "1s49ty7",
      title: "Poison Story",
      youtube_error: "duplicate_blocked: existing upload",
      instagram_error: "script_validation_review_required_public_row_repair",
      facebook_error: "script_validation_review_required_public_row_repair",
    },
    {
      id: "1s4j81q",
      title: "Deus Ex Composer Says The Jobs Vanished",
      youtube_post_id: "U4XB3MEaCg0",
      youtube_url: "https://youtube.com/shorts/U4XB3MEaCg0",
      published_at: "2026-06-11T14:00:02.003Z",
    },
  ];
  const selector = await selectNextGuardedLiveAction({
    executorPlan: {
      handoff_ready_actions: [
        action("1s49ty7", "youtube_shorts"),
        action("1s49ty7", "instagram_reels"),
        action("1s49ty7", "facebook_reels"),
        action("1s4j81q", "youtube_shorts"),
        action("1s4j81q", "instagram_reels"),
      ],
    },
    stories,
    allowedPlatforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
  });

  const report = buildGuardedDispatchEvidenceReconciliationReport({
    story: stories[1],
    stories,
    platformRows: [],
    selector,
    runtimeSentinel: {
      verdict: "green",
      scheduler_window_readiness: { safe_to_observe_next_window: true },
    },
    queueInspect: { verdict: "pass" },
    publishCadence: {
      verdict: "green",
      next_safe_publish: { next_safe_publish_at_utc: "2026-06-11T19:00:00.000Z" },
    },
    publishReadiness: { overall_verdict: "amber" },
  });

  assert.equal(selector.action_id, "1s4j81q:instagram_reels");
  assert.equal(report.verdict, "partial");
  assert.equal(report.partial_youtube_evidence.retry_risk, false);
  assert.equal(report.partial_youtube_evidence.platform_posts_structured_gap, true);
  assert.equal(
    report.partial_youtube_evidence.selector_terminal_state.reason,
    "already_published",
  );
  assert.equal(report.poison_action_terminal_state.verdict, "pass");
  assert.equal(report.next_window_scheduler_verification.safe_to_observe_next_window, true);
});

test("reconciliation fails if selector would retry the already-uploaded YouTube action", () => {
  const story = {
    id: "1s4j81q",
    title: "Deus Ex Composer Says The Jobs Vanished",
    youtube_post_id: "U4XB3MEaCg0",
  };
  const report = buildGuardedDispatchEvidenceReconciliationReport({
    story,
    stories: [story],
    platformRows: [],
    selector: {
      action_id: "1s4j81q:youtube_shorts",
      action: action("1s4j81q", "youtube_shorts"),
      skipped_actions: [],
    },
    runtimeSentinel: { verdict: "green" },
    queueInspect: { verdict: "pass" },
    publishCadence: { verdict: "green" },
    publishReadiness: { overall_verdict: "amber" },
  });

  assert.equal(report.verdict, "fail");
  assert.ok(
    report.blockers.includes("selector_would_retry_existing_youtube_action"),
  );
});

test("platform_posts integrity separates aggregate historical gaps from target gaps", () => {
  const report = buildPlatformPostsIntegrityReport({
    stories: [
      { id: "target", title: "Target", youtube_post_id: "yt_target" },
      { id: "historical", title: "Old", instagram_media_id: "ig_old" },
    ],
    platformRows: [
      {
        story_id: "target",
        platform: "youtube",
        status: "published",
        external_id: "yt_target",
      },
    ],
    targetStoryIds: ["target"],
  });

  assert.equal(report.counts.legacy_published_evidence_count, 2);
  assert.equal(report.counts.missing_structured_evidence_count, 1);
  assert.equal(report.counts.target_missing_structured_evidence_count, 0);
  assert.equal(report.verdict, "pass");
});
