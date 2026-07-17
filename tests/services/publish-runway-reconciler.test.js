"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  publishRunwayNeedsSynchronousRepair,
  reconcilePublishRunway,
} = require("../../lib/ops/publish-runway-reconciler");

const NOW = "2026-07-17T08:30:00.000Z";
const GENERATION_ID = "publish-runway-2026-07-17-morning-v1";
const WINDOW = {
  id: "publish_morning_2026-07-17",
  starts_at: "2026-07-17T09:00:00.000Z",
  ends_at: "2026-07-17T10:00:00.000Z",
  evidence_fresh_after: "2026-07-17T07:00:00.000Z",
};

function youtubeAction(storyId, overrides = {}) {
  return {
    action_id: `${storyId}:youtube_shorts`,
    story_id: storyId,
    platform: "youtube_shorts",
    platform_enabled: true,
    youtube_first: true,
    executable: true,
    verdict: "GREEN",
    blockers: [],
    ...overrides,
  };
}

function reserveStory(storyId, overrides = {}) {
  return {
    story_id: storyId,
    role: "reserve",
    verdict: "GREEN",
    blockers: [],
    youtube_first: true,
    enabled_platforms: ["youtube_shorts"],
    ...overrides,
  };
}

function evidenceEnvelope(overrides = {}) {
  return {
    generation_id: GENERATION_ID,
    generated_at: "2026-07-17T08:10:00.000Z",
    window_id: WINDOW.id,
    verdict: "GREEN",
    blockers: [],
    critical_inputs: [],
    enabled_platforms: ["youtube_shorts", "instagram_reels"],
    disabled_platforms: ["tiktok", "x"],
    ...overrides,
  };
}

function greenEvidence(overrides = {}) {
  const runwayIds = Array.from({ length: 5 }, (_, index) => `runway-${index + 1}`);
  const reserveIds = Array.from({ length: 5 }, (_, index) => `reserve-${index + 1}`);
  const immediateActions = runwayIds.map((storyId) => youtubeAction(storyId));
  const reserveStories = reserveIds.map((storyId) => reserveStory(storyId));
  const candidateEvidence = evidenceEnvelope({
    candidates: [
      ...runwayIds.map((storyId) => ({
        story_id: storyId,
        verdict: "GREEN",
        blockers: [],
        youtube_first: true,
        enabled_platforms: ["youtube_shorts"],
      })),
      ...reserveStories,
    ],
    reserve_stories: reserveStories,
  });
  const preflightEvidence = evidenceEnvelope({
    executable_actions: immediateActions,
    reserve_stories: reserveStories,
  });
  const dryRunEvidence = evidenceEnvelope({
    actions: [
      ...immediateActions.map((action) => ({
        ...action,
        action: "would_publish",
        autonomous_green_lit_by_dry_run: true,
      })),
      {
        action_id: "disabled-only:tiktok",
        story_id: "disabled-only",
        platform: "tiktok",
        platform_enabled: false,
        youtube_first: false,
        executable: true,
        verdict: "GREEN",
        blockers: [],
        action: "would_publish",
      },
    ],
  });
  const guardedEvidence = evidenceEnvelope({
    ready_for_guarded_dispatch: true,
    dispatch_ready_actions: immediateActions,
  });
  const executorEvidence = evidenceEnvelope({
    ready_for_live_executor_handoff: true,
    handoff_ready_actions: immediateActions,
  });

  return {
    now: NOW,
    targetWindow: WINDOW,
    expectedGenerationId: GENERATION_ID,
    candidateEvidence,
    preflightEvidence,
    dryRunEvidence,
    guardedEvidence,
    executorEvidence,
    targetRunwayCount: 5,
    targetReserveCount: 5,
    ...overrides,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

test("publish runway reconciliation is GREEN only for one fresh canonical generation with immediate and reserve cover", () => {
  const report = reconcilePublishRunway(greenEvidence());

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.can_auto_publish, true);
  assert.equal(report.expected_generation_id, GENERATION_ID);
  assert.equal(report.window.id, WINDOW.id);
  assert.equal(report.window.state, "upcoming");
  assert.equal(report.window.freshness_cutoff, WINDOW.evidence_fresh_after);
  assert.equal(report.summary.executable_youtube_first_story_count, 5);
  assert.equal(report.summary.reserve_story_count, 5);
  assert.equal(report.summary.runway_target_met, true);
  assert.equal(report.summary.reserve_target_met, true);
  assert.deepEqual(
    report.executable_actions.map((action) => action.story_id),
    ["runway-1", "runway-2", "runway-3", "runway-4", "runway-5"],
  );
  assert.deepEqual(
    report.reserve_stories.map((story) => story.story_id),
    ["reserve-1", "reserve-2", "reserve-3", "reserve-4", "reserve-5"],
  );
  assert.equal(report.summary.ignored_disabled_platform_action_count, 1);
  assert.deepEqual(report.blockers, []);
  assert.equal(
    report.exact_next_action.code,
    "CONSUME_CANONICAL_GENERATION_IN_GUARDED_WINDOW",
  );
  assert.equal(publishRunwayNeedsSynchronousRepair(report), false);
});

test("fully executable stories beyond the immediate target become distinct canonical reserve", () => {
  const input = greenEvidence();
  const allIds = Array.from({ length: 10 }, (_, index) => `story-${index + 1}`);
  const allActions = allIds.map((id) => youtubeAction(id));
  input.candidateEvidence.candidates = allIds.map((id) => ({
    story_id: id,
    verdict: "GREEN",
    blockers: [],
    youtube_first: true,
    enabled_platforms: ["youtube_shorts"],
  }));
  delete input.candidateEvidence.reserve_stories;
  input.preflightEvidence.executable_actions = allActions;
  delete input.preflightEvidence.reserve_stories;
  input.dryRunEvidence.actions = allActions.map((action) => ({
    ...action,
    action: "would_publish",
    autonomous_green_lit_by_dry_run: true,
  }));
  input.guardedEvidence.dispatch_ready_actions = allActions;
  input.executorEvidence.handoff_ready_actions = allActions;

  const report = reconcilePublishRunway(input);

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.can_auto_publish, true);
  assert.deepEqual(
    report.executable_actions.map((action) => action.story_id),
    ["story-1", "story-2", "story-3", "story-4", "story-5"],
  );
  assert.deepEqual(
    report.reserve_stories.map((story) => story.story_id),
    ["story-6", "story-7", "story-8", "story-9", "story-10"],
  );
  assert.equal(report.summary.canonical_executable_story_count, 10);
  assert.equal(report.summary.executable_youtube_first_story_count, 5);
  assert.equal(report.summary.reserve_story_count, 5);
});

test("scalar reserve story ids are accepted only through an explicitly enabled evidence envelope", () => {
  const input = greenEvidence();
  const reserveIds = [
    "reserve-1",
    "reserve-2",
    "reserve-3",
    "reserve-4",
    "reserve-5",
  ];
  input.candidateEvidence.reserve_stories = reserveIds;
  input.preflightEvidence.reserve_stories = reserveIds;

  const report = reconcilePublishRunway(input);

  assert.equal(report.verdict, "GREEN");
  assert.deepEqual(
    report.reserve_stories.map((story) => story.story_id),
    reserveIds,
  );
});

test("disabled platform actions never inflate the canonical YouTube-first runway", () => {
  const input = greenEvidence();
  const fourYoutubeActions = Array.from(
    { length: 4 },
    (_, index) => youtubeAction(`runway-${index + 1}`),
  );
  const disabledActions = Array.from({ length: 8 }, (_, index) => ({
    action_id: `disabled-${index + 1}:tiktok`,
    story_id: `disabled-${index + 1}`,
    platform: "tiktok",
    platform_enabled: false,
    youtube_first: false,
    executable: true,
    verdict: "GREEN",
    blockers: [],
    action: "would_publish",
  }));
  input.preflightEvidence.executable_actions = [...fourYoutubeActions, ...disabledActions];
  input.dryRunEvidence.actions = [...fourYoutubeActions, ...disabledActions];
  input.guardedEvidence.dispatch_ready_actions = [...fourYoutubeActions, ...disabledActions];
  input.executorEvidence.handoff_ready_actions = [...fourYoutubeActions, ...disabledActions];

  const report = reconcilePublishRunway(input);

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.can_auto_publish, false);
  assert.equal(report.summary.executable_youtube_first_story_count, 4);
  assert.equal(report.summary.runway_shortfall, 1);
  assert.equal(report.summary.ignored_disabled_platform_action_count, 32);
  assert.ok(
    report.blockers.some((blocker) => blocker.code === "RUNWAY_TARGET_NOT_MET"),
  );
  assert.equal(
    report.exact_next_action.code,
    "SYNCHRONOUSLY_REPAIR_OR_PROMOTE_RUNWAY",
  );
  assert.equal(report.exact_next_action.required_story_count, 1);
  assert.equal(publishRunwayNeedsSynchronousRepair(report), true);
});

test("mixed or missing generation ids fail closed", () => {
  const mixed = greenEvidence();
  mixed.guardedEvidence.generation_id = "older-generation";
  const mixedReport = reconcilePublishRunway(mixed);

  assert.equal(mixedReport.verdict, "RED");
  assert.equal(mixedReport.can_auto_publish, false);
  assert.ok(
    mixedReport.blockers.some(
      (blocker) =>
        blocker.code === "EVIDENCE_GENERATION_MISMATCH" &&
        blocker.evidence === "guarded",
    ),
  );
  assert.equal(
    mixedReport.exact_next_action.code,
    "REGENERATE_CANONICAL_EVIDENCE_GENERATION",
  );

  const missing = greenEvidence();
  delete missing.executorEvidence.generation_id;
  const missingReport = reconcilePublishRunway(missing);
  assert.equal(missingReport.verdict, "RED");
  assert.ok(
    missingReport.blockers.some(
      (blocker) =>
        blocker.code === "EVIDENCE_GENERATION_ID_MISSING" &&
        blocker.evidence === "executor",
    ),
  );
});

test("stale, future or wrong-window evidence fails closed with window diagnostics", () => {
  const stale = greenEvidence();
  stale.preflightEvidence.generated_at = "2026-07-17T06:59:59.999Z";
  stale.executorEvidence.generated_at = "2026-07-17T08:31:00.000Z";
  stale.dryRunEvidence.window_id = "publish_afternoon_2026-07-17";

  const report = reconcilePublishRunway(stale);

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "EVIDENCE_STALE" &&
        blocker.evidence === "preflight",
    ),
  );
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "EVIDENCE_FROM_FUTURE" &&
        blocker.evidence === "executor",
    ),
  );
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "EVIDENCE_WINDOW_MISMATCH" &&
        blocker.evidence === "dry_run",
    ),
  );
  assert.equal(report.window.current_time, NOW);
  assert.equal(
    report.exact_next_action.code,
    "REFRESH_EVIDENCE_FOR_TARGET_WINDOW",
  );
  assert.deepEqual(
    report.exact_next_action.evidence_documents,
    ["dry_run", "executor", "preflight"],
  );
});

test("missing and path-only documents are rejected rather than loaded or trusted", () => {
  const input = greenEvidence();
  input.candidateEvidence = "C:\\proof\\candidate-evidence.json";
  input.preflightEvidence = {
    path: "C:\\proof\\preflight-evidence.json",
  };
  input.executorEvidence = null;

  const report = reconcilePublishRunway(input);

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "EVIDENCE_PATH_ONLY" &&
        blocker.evidence === "candidate",
    ),
  );
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "EVIDENCE_PATH_ONLY" &&
        blocker.evidence === "preflight",
    ),
  );
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "EVIDENCE_DOCUMENT_MISSING" &&
        blocker.evidence === "executor",
    ),
  );
  assert.equal(
    report.exact_next_action.code,
    "MATERIALISE_EVIDENCE_DOCUMENTS",
  );
});

test("an AMBER evidence document can produce at most AMBER and never authorises auto-publish", () => {
  const input = greenEvidence();
  input.dryRunEvidence.verdict = "AMBER";
  input.dryRunEvidence.advisory = ["operator_review_pending"];

  const report = reconcilePublishRunway(input);

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.can_auto_publish, false);
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "EVIDENCE_AMBER" &&
        blocker.evidence === "dry_run",
    ),
  );
  assert.equal(
    report.exact_next_action.code,
    "RESOLVE_AMBER_EVIDENCE",
  );
  assert.equal(publishRunwayNeedsSynchronousRepair(report), true);
});

test("enabled-platform RED and blocked critical inputs are RED while disabled blocked actions are excluded", () => {
  const disabledOnly = greenEvidence();
  disabledOnly.executorEvidence.blocked_actions = [
    {
      story_id: "disabled-blocked",
      platform: "tiktok",
      platform_enabled: false,
      blockers: ["tiktok_credentials_missing"],
    },
  ];
  disabledOnly.executorEvidence.blocked_action_count = 1;
  const disabledOnlyReport = reconcilePublishRunway(disabledOnly);
  assert.equal(disabledOnlyReport.verdict, "GREEN");
  assert.equal(disabledOnlyReport.can_auto_publish, true);

  const enabledBlocked = greenEvidence();
  enabledBlocked.executorEvidence.blocked_actions = [
    {
      story_id: "runway-1",
      platform: "youtube_shorts",
      platform_enabled: true,
      blockers: ["last_second_quality_gate_failed"],
    },
  ];
  enabledBlocked.executorEvidence.blocked_action_count = 1;
  enabledBlocked.guardedEvidence.critical_inputs = [
    {
      input: "kill_switch",
      verdict: "RED",
      blocked: true,
      blockers: ["kill_switch_state_unproven"],
    },
  ];

  const report = reconcilePublishRunway(enabledBlocked);

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "ENABLED_PLATFORM_ACTION_BLOCKED" &&
        blocker.evidence === "executor",
    ),
  );
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "CRITICAL_INPUT_BLOCKED" &&
        blocker.evidence === "guarded",
    ),
  );
  assert.equal(
    report.exact_next_action.code,
    "REPAIR_CRITICAL_INPUTS_AND_REGENERATE",
  );
});

test("aggregate RED or blocked critical-input counts fail closed without detailed rows", () => {
  const input = greenEvidence();
  input.preflightEvidence.critical_inputs = {
    red_count: 1,
    blocked_count: 2,
  };

  const report = reconcilePublishRunway(input);

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "CRITICAL_INPUT_COUNT_NONZERO" &&
        blocker.evidence === "preflight",
    ),
  );
});

test("duplicates and immediate-runway stories cannot be counted again as reserve", () => {
  const input = greenEvidence();
  const duplicateAction = youtubeAction("runway-1", {
    action_id: "runway-1:youtube_shorts:duplicate",
  });
  input.preflightEvidence.executable_actions = [
    ...input.preflightEvidence.executable_actions.slice(0, 4),
    duplicateAction,
  ];
  input.dryRunEvidence.actions = [
    ...input.dryRunEvidence.actions.filter(
      (action) => action.platform === "youtube_shorts",
    ).slice(0, 4),
    duplicateAction,
  ];
  input.guardedEvidence.dispatch_ready_actions = [
    ...input.guardedEvidence.dispatch_ready_actions.slice(0, 4),
    duplicateAction,
  ];
  input.executorEvidence.handoff_ready_actions = [
    ...input.executorEvidence.handoff_ready_actions.slice(0, 4),
    duplicateAction,
  ];
  input.candidateEvidence.reserve_stories = [
    reserveStory("runway-1"),
    reserveStory("reserve-1"),
    reserveStory("reserve-1"),
    reserveStory("reserve-2"),
    reserveStory("reserve-3"),
    reserveStory("reserve-4"),
  ];
  input.preflightEvidence.reserve_stories =
    input.candidateEvidence.reserve_stories;

  const report = reconcilePublishRunway(input);

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.can_auto_publish, false);
  assert.equal(report.summary.executable_youtube_first_story_count, 4);
  assert.equal(report.summary.reserve_story_count, 4);
  assert.equal(report.summary.runway_shortfall, 1);
  assert.equal(report.summary.reserve_shortfall, 1);
  assert.equal(new Set(report.reserve_stories.map((row) => row.story_id)).size, 4);
  assert.equal(
    report.reserve_stories.some((row) => row.story_id === "runway-1"),
    false,
  );
});

test("repair helper fails closed for malformed reports", () => {
  assert.equal(publishRunwayNeedsSynchronousRepair(), true);
  assert.equal(
    publishRunwayNeedsSynchronousRepair({
      verdict: "GREEN",
      can_auto_publish: true,
    }),
    true,
  );
  assert.equal(
    publishRunwayNeedsSynchronousRepair({
      verdict: "GREEN",
      can_auto_publish: true,
      summary: {
        runway_target_met: true,
        reserve_target_met: false,
      },
      blockers: [],
    }),
    true,
  );
});

test("reconciliation is deterministic and does not mutate frozen evidence", () => {
  const input = deepFreeze(greenEvidence());

  const first = reconcilePublishRunway(input);
  const second = reconcilePublishRunway(input);

  assert.deepEqual(first, second);
  assert.equal(first.verdict, "GREEN");
});

test("oversized targets and evidence collections fail closed at explicit bounds", () => {
  const input = greenEvidence({
    targetRunwayCount: 101,
  });
  input.preflightEvidence.executable_actions = Array.from(
    { length: 501 },
    (_, index) => youtubeAction(`bounded-${index + 1}`),
  );

  const report = reconcilePublishRunway(input);

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "TARGET_COUNT_INVALID" &&
        blocker.field === "target_runway_count",
    ),
  );
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "EVIDENCE_ROW_LIMIT_EXCEEDED" &&
        blocker.evidence === "preflight",
    ),
  );
});
