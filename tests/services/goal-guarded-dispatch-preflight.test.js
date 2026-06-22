"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGuardedDispatchPreflight,
  renderGuardedDispatchPreflightMarkdown,
  writeGuardedDispatchPreflight,
} = require("../../lib/goal-guarded-dispatch-preflight");

const ROOT = path.resolve(__dirname, "..", "..");

async function makeMedia(root, storyId = "story-one") {
  const dir = path.join(root, storyId);
  await fs.ensureDir(dir);
  const videoPath = path.join(dir, "visual_v4_render.mp4");
  const captionsPath = path.join(dir, "captions.srt");
  await fs.writeFile(videoPath, Buffer.alloc(4096, 1));
  await fs.writeFile(captionsPath, "1\n00:00:00,000 --> 00:00:01,000\nForza.\n");
  await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
  });
  await fs.writeJson(path.join(dir, "platform_publish_manifest.json"), {
    story_id: storyId,
  });
  return {
    dir,
    videoPath,
    captionsPath,
    canonicalPath: path.join(dir, "canonical_story_manifest.json"),
    platformManifestPath: path.join(dir, "platform_publish_manifest.json"),
  };
}

function approvedAction(media, overrides = {}) {
  return {
    story_id: "story-one",
    platform: "youtube_shorts",
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    operator: "MORR",
    operator_decided_at: "2026-05-31T18:05:00.000Z",
    decision: "approve_enabled_platforms",
    video_path: media.videoPath,
    captions_path: media.captionsPath,
    first_frame_source: media.videoPath,
    canonical_manifest_path: media.canonicalPath,
    platform_publish_manifest_path: media.platformManifestPath,
    live_publish_allowed_from_gate: false,
    requires_guarded_dispatch_command: true,
    requires_enabled_platform_recheck: true,
    ...overrides,
  };
}

function approvalGateReport(media, actions = [approvedAction(media)]) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T18:10:00.000Z",
    mode: "HUMAN_REVIEW_APPROVAL_GATE",
    verdict: actions.length ? "GREEN" : "AMBER",
    safe_to_publish_boolean: false,
    summary: {
      approved_action_count: actions.length,
      invalid_decision_count: 0,
      pending_review_packet_count: actions.length ? 0 : 1,
    },
    approved_actions: actions,
    safe_publish_plan: {
      guarded_dispatch_eligible: actions.length > 0,
      live_publish_allowed_from_this_tool: false,
      approved_actions: actions,
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
    },
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function strictDryRunPlan(media, actions = [approvedAction(media)]) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T18:00:00.000Z",
    mode: "DRY_RUN_PUBLISH",
    overall_verdict: "AMBER",
    ready_for_unattended_publish: false,
    actions: actions.map((action) => ({
      story_id: action.story_id,
      platform: action.platform,
      action: "would_publish",
      title: action.title,
      video_path: action.video_path,
      captions_path: action.captions_path,
      cover_frame_source: action.first_frame_source,
      platform_enabled: true,
      live_publish_allowed_from_dry_run: false,
      requires_human_review_before_live_publish: true,
    })),
    blocked_actions: [],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      dry_run_only: true,
    },
  };
}

function platformStatusMatrix() {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T18:00:00.000Z",
    overall_verdict: "AMBER",
    summary: {
      live_publish_allowed_action_count: 0,
    },
    platforms: {
      youtube_shorts: {
        platform: "youtube_shorts",
        status: "ready_now",
        operational_state: "enabled",
        publish_now_action_count: 1,
        blocked_action_count: 0,
        deferred_action_count: 0,
        planned_story_ids: ["story-one"],
      },
      tiktok: {
        platform: "tiktok",
        status: "deferred_until_platform_enabled",
        operational_state: "needs_credentials",
        operational_reason: "tiktok_local_token_refresh_or_sync_required",
        publish_now_action_count: 0,
        blocked_action_count: 0,
        deferred_action_count: 1,
        planned_story_ids: ["story-one"],
        enablement_gaps: ["tiktok_local_token_refresh_or_sync_required"],
      },
    },
    safety: {
      dry_run_only: true,
      no_network_uploads: true,
      no_public_posts: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function transcriptAudienceReport(verdict = "pass", blockers = []) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T18:00:00.000Z",
    summary: { total: 1, pass: verdict === "pass" ? 1 : 0, rewrite_required: verdict === "pass" ? 0 : 1 },
    stories: [
      {
        story_id: "story-one",
        title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
        verdict,
        blockers,
      },
    ],
  };
}

function transcriptAudienceRows(rows = []) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T18:00:00.000Z",
    summary: {
      total: rows.length,
      pass: rows.filter((row) => row.verdict === "pass").length,
      rewrite_required: rows.filter((row) => row.verdict !== "pass").length,
    },
    stories: rows,
  };
}

test("guarded dispatch preflight stays AMBER when no operator-approved actions exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-empty-"));
  const media = await makeMedia(root);
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media, []),
    strictDryRunPlan: strictDryRunPlan(media, []),
    platformStatusMatrix: platformStatusMatrix(),
    generatedAt: "2026-05-31T18:15:00.000Z",
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.approved_action_count, 0);
  assert.equal(report.summary.dispatch_ready_action_count, 0);
  assert.ok(report.advisory.includes("no_operator_approved_actions"));
  assert.equal(report.guarded_dispatch_plan.ready_for_guarded_dispatch, false);
  assert.equal(report.guarded_dispatch_plan.live_publish_allowed_from_this_tool, false);
});

test("guarded dispatch preflight passes only enabled-platform actions still present in strict dry-run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-pass-"));
  const media = await makeMedia(root);
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media),
    strictDryRunPlan: strictDryRunPlan(media),
    platformStatusMatrix: platformStatusMatrix(),
    generatedAt: "2026-05-31T18:15:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.dispatch_ready_action_count, 1);
  assert.equal(report.dispatch_ready_actions[0].platform, "youtube_shorts");
  assert.equal(report.dispatch_ready_actions[0].live_publish_allowed_from_preflight, false);
  assert.equal(report.dispatch_ready_actions[0].requires_guarded_live_dispatch_executor, true);
  assert.equal(report.guarded_dispatch_plan.ready_for_guarded_dispatch, true);
  assert.equal(report.guarded_dispatch_plan.live_publish_allowed_from_this_tool, false);
  assert.equal(report.safety.no_network_uploads, true);
});

test("guarded dispatch preflight accepts autonomous GREEN dry-run actions without operator decisions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-auto-green-"));
  const media = await makeMedia(root);
  const dryRunAction = {
    story_id: "story-one",
    platform: "youtube_shorts",
    action: "would_publish",
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    video_path: media.videoPath,
    captions_path: media.captionsPath,
    cover_frame_source: media.videoPath,
    canonical_manifest_path: media.canonicalPath,
    platform_publish_manifest_path: media.platformManifestPath,
    platform_enabled: true,
    live_publish_allowed_from_dry_run: false,
    requires_human_review_before_live_publish: false,
    live_execution_gate: "guarded_dispatch_ready",
    autonomous_green_lit_by_dry_run: true,
    requires_guarded_dispatch_command: true,
    requires_enabled_platform_recheck: true,
  };

  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media, []),
    strictDryRunPlan: {
      ...strictDryRunPlan(media, []),
      overall_verdict: "AMBER",
      actions: [dryRunAction],
    },
    platformStatusMatrix: platformStatusMatrix(),
    transcriptAudienceReport: transcriptAudienceReport(),
    generatedAt: "2026-06-21T17:58:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.approved_action_count, 0);
  assert.equal(report.summary.autonomous_dry_run_action_count, 1);
  assert.equal(report.summary.dispatch_ready_action_count, 1);
  assert.equal(report.dispatch_ready_actions[0].story_id, "story-one");
  assert.equal(report.dispatch_ready_actions[0].platform, "youtube_shorts");
  assert.equal(report.dispatch_ready_actions[0].operator, "autonomous_green_dry_run");
  assert.equal(report.guarded_dispatch_plan.ready_for_guarded_dispatch, true);
  assert.equal(report.guarded_dispatch_plan.live_publish_allowed_from_this_tool, false);
});

test("guarded dispatch preflight holds rewrite-required transcript audience rows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-transcript-"));
  const media = await makeMedia(root);
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media),
    strictDryRunPlan: strictDryRunPlan(media),
    platformStatusMatrix: platformStatusMatrix(),
    transcriptAudienceReport: transcriptAudienceReport("rewrite_required", ["mass_audience:figurative_payoff"]),
    generatedAt: "2026-05-31T18:15:00.000Z",
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.dispatch_ready_action_count, 0);
  assert.equal(report.summary.held_action_count, 1);
  assert.equal(report.summary.transcript_held_action_count, 1);
  assert.equal(report.summary.blocked_action_count, 0);
  assert.ok(report.held_actions[0].blockers.includes("transcript_audience:mass_audience:figurative_payoff"));
});

test("guarded dispatch preflight keeps clean actions ready while holding weak transcripts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-transcript-mixed-"));
  const weakMedia = await makeMedia(root, "story-one");
  const cleanMedia = await makeMedia(root, "story-two");
  const weakAction = approvedAction(weakMedia);
  const cleanAction = approvedAction(cleanMedia, {
    story_id: "story-two",
    title: "Gears E-Day Has A 130GB Problem",
  });
  const platformMatrix = platformStatusMatrix();
  platformMatrix.platforms.youtube_shorts.planned_story_ids = ["story-one", "story-two"];
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(weakMedia, [weakAction, cleanAction]),
    strictDryRunPlan: strictDryRunPlan(weakMedia, [weakAction, cleanAction]),
    platformStatusMatrix: platformMatrix,
    transcriptAudienceReport: transcriptAudienceRows([
      {
        story_id: "story-one",
        title: "Stranger Than Heaven Has RGG Combat Risk",
        verdict: "rewrite_required",
        blockers: ["mass_audience:figurative_payoff"],
      },
      {
        story_id: "story-two",
        title: "Gears E-Day Has A 130GB Problem",
        verdict: "pass",
        blockers: [],
      },
    ]),
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.dispatch_ready_action_count, 1);
  assert.equal(report.summary.held_action_count, 1);
  assert.equal(report.dispatch_ready_actions[0].story_id, "story-two");
  assert.equal(report.held_actions[0].story_id, "story-one");
});

test("guarded dispatch preflight uses transcript row for current artifact when duplicate story ids exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-transcript-duplicates-"));
  const media = await makeMedia(root, "story-one");
  const staleDir = path.join(root, "old-story-one");
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media),
    strictDryRunPlan: strictDryRunPlan(media),
    platformStatusMatrix: platformStatusMatrix(),
    transcriptAudienceReport: transcriptAudienceRows([
      {
        story_id: "story-one",
        title: "Sea of Thieves Custom Seas Could Split Crews",
        artifact_dir: media.dir,
        verdict: "pass",
        blockers: [],
      },
      {
        story_id: "story-one",
        title: "Sea of Thieves Has A Stale Transcript",
        artifact_dir: staleDir,
        verdict: "rewrite_required",
        blockers: ["mass_audience:low_concrete_detail"],
      },
    ]),
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.dispatch_ready_action_count, 1);
  assert.equal(report.summary.held_action_count, 0);
  assert.equal(report.dispatch_ready_actions[0].story_id, "story-one");
});

test("guarded dispatch preflight rejects approved actions for disabled or deferred platforms", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-disabled-"));
  const media = await makeMedia(root);
  const action = approvedAction(media, { platform: "tiktok" });
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media, [action]),
    strictDryRunPlan: strictDryRunPlan(media, [action]),
    platformStatusMatrix: platformStatusMatrix(),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_action_count, 1);
  assert.equal(report.summary.dispatch_ready_action_count, 0);
  assert.ok(report.blocked_actions[0].blockers.includes("platform_not_ready_now:tiktok"));
  assert.ok(report.blocked_actions[0].blockers.includes("platform_not_enabled:tiktok"));
});

test("guarded dispatch preflight rejects stale approvals missing from current strict dry-run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-stale-"));
  const media = await makeMedia(root);
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media),
    strictDryRunPlan: strictDryRunPlan(media, []),
    platformStatusMatrix: platformStatusMatrix(),
  });

  assert.equal(report.verdict, "RED");
  assert.ok(report.blocked_actions[0].blockers.includes("approved_action_missing_from_current_strict_dry_run"));
  assert.equal(report.guarded_dispatch_plan.ready_for_guarded_dispatch, false);
});

test("guarded dispatch preflight holds stale approvals when current strict dry-run has ready actions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-stale-held-"));
  const staleMedia = await makeMedia(root, "stale-story");
  const readyMedia = await makeMedia(root, "ready-story");
  const staleAction = approvedAction(staleMedia, {
    story_id: "stale-story",
    title: "Steam Next Fest Turns Demos Into A Trust Fight",
  });
  const readyAction = approvedAction(readyMedia, {
    story_id: "ready-story",
    title: "Gears E-Day Has A 130GB Problem",
  });
  const platformMatrix = platformStatusMatrix();
  platformMatrix.platforms.youtube_shorts.planned_story_ids = ["ready-story"];

  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(readyMedia, [staleAction, readyAction]),
    strictDryRunPlan: strictDryRunPlan(readyMedia, [readyAction]),
    platformStatusMatrix: platformMatrix,
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.dispatch_ready_action_count, 1);
  assert.equal(report.summary.blocked_action_count, 0);
  assert.equal(report.summary.held_action_count, 1);
  assert.equal(report.held_actions[0].story_id, "stale-story");
  assert.equal(report.held_actions[0].reason, "stale_approval_not_in_current_strict_dry_run");
  assert.ok(report.held_actions[0].blockers.includes("approved_action_missing_from_current_strict_dry_run"));
  assert.ok(report.advisory.includes("stale_operator_approved_actions_held_outside_current_dispatch_scope"));
  assert.equal(report.guarded_dispatch_plan.ready_for_guarded_dispatch, true);
});

test("guarded dispatch preflight ignores approvals for already-published platforms", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-already-published-"));
  const media = await makeMedia(root);
  const strictPlan = {
    ...strictDryRunPlan(media, []),
    ready_stories: [
      {
        story_id: "story-one",
        already_published_platforms: ["youtube_shorts"],
        missing_enabled_platforms: ["instagram_reels", "facebook_reels"],
      },
    ],
  };
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media),
    strictDryRunPlan: strictPlan,
    platformStatusMatrix: platformStatusMatrix(),
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.blocked_action_count, 0);
  assert.equal(report.summary.dispatch_ready_action_count, 0);
  assert.equal(report.summary.ignored_already_published_action_count, 1);
  assert.equal(report.ignored_already_published_actions[0].reason, "already_published_platform_action");
  assert.ok(report.advisory.includes("approved_already_published_actions_ignored"));
  assert.equal(report.guarded_dispatch_plan.ready_for_guarded_dispatch, false);
  assert.equal(report.guarded_dispatch_plan.required_next_step, "refresh_candidate_supply_and_strict_dry_run_after_published_actions");
});

test("guarded dispatch preflight ignores already-published platforms even if strict dry-run still includes them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-published-strict-drift-"));
  const media = await makeMedia(root);
  const strictPlan = {
    ...strictDryRunPlan(media),
    ready_stories: [
      {
        story_id: "story-one",
        already_published_platforms: ["youtube_shorts"],
        missing_enabled_platforms: ["instagram_reels", "facebook_reels"],
      },
    ],
  };
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media),
    strictDryRunPlan: strictPlan,
    platformStatusMatrix: platformStatusMatrix(),
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.blocked_action_count, 0);
  assert.equal(report.summary.dispatch_ready_action_count, 0);
  assert.equal(report.summary.ignored_already_published_action_count, 1);
  assert.equal(report.ignored_already_published_actions[0].story_id, "story-one");
  assert.equal(report.ignored_already_published_actions[0].platform, "youtube_shorts");
  assert.equal(report.ignored_already_published_actions[0].reason, "already_published_platform_action");
  assert.equal(report.guarded_dispatch_plan.required_next_step, "refresh_candidate_supply_and_strict_dry_run_after_published_actions");
});

test("guarded dispatch preflight ignores live DB published evidence when strict dry-run is stale", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-live-published-"));
  const media = await makeMedia(root);
  const dryRunAction = {
    story_id: "story-one",
    platform: "youtube_shorts",
    action: "would_publish",
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    video_path: media.videoPath,
    captions_path: media.captionsPath,
    cover_frame_source: media.videoPath,
    canonical_manifest_path: media.canonicalPath,
    platform_publish_manifest_path: media.platformManifestPath,
    platform_enabled: true,
    live_publish_allowed_from_dry_run: false,
    requires_human_review_before_live_publish: false,
    live_execution_gate: "guarded_dispatch_ready",
    autonomous_green_lit_by_dry_run: true,
    requires_guarded_dispatch_command: true,
    requires_enabled_platform_recheck: true,
    blockers: [],
    warnings: [],
  };

  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media, []),
    strictDryRunPlan: {
      ...strictDryRunPlan(media, []),
      actions: [dryRunAction],
    },
    platformStatusMatrix: platformStatusMatrix(),
    transcriptAudienceReport: transcriptAudienceReport(),
    publishedPlatformEvidence: [
      {
        story_id: "story-one",
        platform: "youtube",
        status: "published",
        external_id: "yt_structured",
      },
    ],
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.dispatch_ready_action_count, 0);
  assert.equal(report.summary.ignored_already_published_action_count, 1);
  assert.equal(report.ignored_already_published_actions[0].story_id, "story-one");
  assert.equal(report.ignored_already_published_actions[0].platform, "youtube_shorts");
  assert.equal(report.ignored_already_published_actions[0].reason, "already_published_platform_action");
  assert.ok(report.advisory.includes("already_published_actions_ignored"));
  assert.equal(report.guarded_dispatch_plan.required_next_step, "refresh_candidate_supply_and_strict_dry_run_after_published_actions");
});

test("guarded dispatch preflight ignores prior terminal duplicate actions instead of poisoning fresh dispatch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-terminal-dupe-"));
  const media = await makeMedia(root);
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media),
    strictDryRunPlan: strictDryRunPlan(media),
    platformStatusMatrix: platformStatusMatrix(),
    guardedLiveDispatchExecutorReport: {
      mode: "GUARDED_LIVE_DISPATCH_EXECUTOR",
      apply: true,
      blocked_actions: [
        {
          action_id: "story-one:youtube_shorts",
          story_id: "story-one",
          platform: "youtube_shorts",
          outcome: "duplicate_blocked",
          blockers: ["duplicate_blocked"],
        },
      ],
    },
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.dispatch_ready_action_count, 0);
  assert.equal(report.summary.blocked_action_count, 0);
  assert.equal(report.summary.ignored_terminal_duplicate_action_count, 1);
  assert.equal(report.ignored_terminal_duplicate_actions[0].story_id, "story-one");
  assert.equal(report.guarded_dispatch_plan.ready_for_guarded_dispatch, false);
  assert.equal(report.guarded_dispatch_plan.required_next_step, "refresh_candidate_supply_and_strict_dry_run_after_published_actions");
});

test("guarded dispatch preflight rejects media path drift and missing media", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-media-"));
  const media = await makeMedia(root);
  const driftAction = approvedAction(media, {
    video_path: path.join(root, "missing.mp4"),
  });
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media, [driftAction]),
    strictDryRunPlan: strictDryRunPlan(media, [approvedAction(media)]),
    platformStatusMatrix: platformStatusMatrix(),
  });

  assert.equal(report.verdict, "RED");
  assert.ok(report.blocked_actions[0].blockers.includes("video_path_mismatch_with_strict_dry_run"));
  assert.ok(report.blocked_actions[0].blockers.includes("video_path_missing_or_too_small"));
});

test("guarded dispatch preflight writes machine-readable reports and operator markdown", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-write-"));
  const media = await makeMedia(root);
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(media),
    strictDryRunPlan: strictDryRunPlan(media),
    platformStatusMatrix: platformStatusMatrix(),
  });
  const written = await writeGuardedDispatchPreflight(report, { outputDir: root });

  assert.equal(await fs.pathExists(path.join(root, "guarded_dispatch_preflight_report.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "guarded_dispatch_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "guarded_dispatch_preflight.md")), true);
  assert.equal(path.basename(written.guardedDispatchPlanPath), "guarded_dispatch_plan.json");

  const markdown = renderGuardedDispatchPreflightMarkdown(report);
  assert.match(markdown, /# Guarded Dispatch Preflight/);
  assert.match(markdown, /Verdict: GREEN/);
  assert.match(markdown, /No uploads are triggered/);
});

test("guarded dispatch preflight CLI is registered and emits clean JSON", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-cli-"));
  const media = await makeMedia(root);
  const approvalPath = path.join(root, "human_review_approval_gate_report.json");
  const strictPath = path.join(root, "dry_run_publish_plan.json");
  const platformPath = path.join(root, "platform_status_matrix.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(approvalPath, approvalGateReport(media), { spaces: 2 });
  await fs.writeJson(strictPath, strictDryRunPlan(media), { spaces: 2 });
  await fs.writeJson(platformPath, platformStatusMatrix(), { spaces: 2 });
  const transcriptPath = path.join(root, "transcript_audience_audit.json");
  await fs.writeJson(transcriptPath, transcriptAudienceReport(), { spaces: 2 });

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-guarded-dispatch-preflight.js",
      "--approval-gate-report",
      approvalPath,
      "--strict-dry-run-plan",
      strictPath,
      "--platform-status-matrix",
      platformPath,
      "--transcript-audience-report",
      transcriptPath,
      "--out-dir",
      outDir,
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PULSE_SKIP_DOTENV: "true",
        USE_SQLITE: "false",
        SQLITE_DB_PATH: "",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trimStart().startsWith("{"), result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.dispatch_ready_action_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_dispatch_preflight_report.json")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(pkg.scripts["ops:goal-guarded-dispatch-preflight"], "node tools/goal-guarded-dispatch-preflight.js");
});

test("guarded dispatch preflight CLI prefers current goal-contract transcript audit by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-default-transcript-"));
  const media = await makeMedia(root);
  const goalDir = path.join(root, "output", "goal-contract");
  const staleDir = path.join(root, "output", "transcript-audience-audit");
  const outDir = path.join(root, "out");
  await fs.ensureDir(goalDir);
  await fs.ensureDir(staleDir);
  await fs.writeJson(path.join(goalDir, "human_review_approval_gate_report.json"), approvalGateReport(media), { spaces: 2 });
  await fs.writeJson(path.join(goalDir, "dry_run_publish_plan.json"), strictDryRunPlan(media), { spaces: 2 });
  await fs.writeJson(path.join(goalDir, "platform_status_matrix.json"), platformStatusMatrix(), { spaces: 2 });
  await fs.writeJson(path.join(goalDir, "transcript_audience_audit.json"), transcriptAudienceReport(), { spaces: 2 });
  await fs.writeJson(
    path.join(staleDir, "transcript_audience_audit.json"),
    transcriptAudienceReport("rewrite_required", ["mass_audience:low_concrete_detail"]),
    { spaces: 2 },
  );

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-guarded-dispatch-preflight.js",
      "--root",
      root,
      "--out-dir",
      outDir,
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PULSE_SKIP_DOTENV: "true",
        USE_SQLITE: "false",
        SQLITE_DB_PATH: "",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.verdict, "GREEN");
  assert.equal(parsed.summary.dispatch_ready_action_count, 1);
  assert.equal(parsed.summary.transcript_held_action_count, 0);
});

test("guarded dispatch preflight CLI skips stale transcript audit missing current dry-run stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-stale-transcript-"));
  const media = await makeMedia(root);
  const goalDir = path.join(root, "output", "goal-contract");
  const fallbackDir = path.join(root, "output", "transcript-audience-audit");
  const outDir = path.join(root, "out");
  await fs.ensureDir(goalDir);
  await fs.ensureDir(fallbackDir);
  await fs.writeJson(path.join(goalDir, "human_review_approval_gate_report.json"), approvalGateReport(media), { spaces: 2 });
  await fs.writeJson(path.join(goalDir, "dry_run_publish_plan.json"), strictDryRunPlan(media), { spaces: 2 });
  await fs.writeJson(path.join(goalDir, "platform_status_matrix.json"), platformStatusMatrix(), { spaces: 2 });
  await fs.writeJson(
    path.join(goalDir, "transcript_audience_audit.json"),
    transcriptAudienceRows([
      {
        story_id: "stale-story",
        title: "Old Story No Longer In Strict Dry Run",
        verdict: "pass",
        blockers: [],
      },
    ]),
    { spaces: 2 },
  );
  await fs.writeJson(path.join(fallbackDir, "transcript_audience_audit.json"), transcriptAudienceReport(), { spaces: 2 });

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-guarded-dispatch-preflight.js",
      "--root",
      root,
      "--out-dir",
      outDir,
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PULSE_SKIP_DOTENV: "true",
        USE_SQLITE: "false",
        SQLITE_DB_PATH: "",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.verdict, "GREEN");
  assert.equal(parsed.summary.dispatch_ready_action_count, 1);
  assert.equal(parsed.summary.transcript_held_action_count, 0);
  assert.deepEqual(parsed.held_actions, []);
});

test("guarded dispatch preflight ignores stale terminal duplicate approvals outside current strict dry-run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-stale-duplicate-"));
  const oldMedia = await makeMedia(root, "old-duplicate");
  const currentMedia = await makeMedia(root, "current-ready");
  const oldAction = approvedAction(oldMedia, {
    story_id: "old-duplicate",
    title: "Cyberpunk 2077's Trust Debt",
  });
  const currentAction = approvedAction(currentMedia, {
    story_id: "current-ready",
    title: "GTA 6 Preorders Have A Price Risk",
  });
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: approvalGateReport(currentMedia, [oldAction, currentAction]),
    strictDryRunPlan: strictDryRunPlan(currentMedia, [currentAction]),
    platformStatusMatrix: {
      ...platformStatusMatrix(),
      platforms: {
        youtube_shorts: {
          ...platformStatusMatrix().platforms.youtube_shorts,
          planned_story_ids: ["current-ready"],
        },
      },
    },
    transcriptAudienceReport: {
      schema_version: 1,
      generated_at: "2026-06-22T18:20:00.000Z",
      stories: [
        {
          story_id: "current-ready",
          artifact_dir: currentMedia.dir,
          verdict: "pass",
          blockers: [],
        },
      ],
    },
    guardedLiveDispatchExecutorReport: {
      blocked_actions: [
        {
          story_id: "old-duplicate",
          platform: "youtube_shorts",
          title: "Cyberpunk 2077's Trust Debt",
          outcome: "duplicate_blocked",
          blockers: ["duplicate_blocked"],
        },
      ],
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.dispatch_ready_action_count, 1);
  assert.equal(report.summary.blocked_action_count, 0);
  assert.equal(report.summary.ignored_terminal_duplicate_action_count, 1);
  assert.equal(report.ignored_terminal_duplicate_actions[0].story_id, "old-duplicate");
  assert.deepEqual(
    report.guarded_dispatch_plan.dispatch_ready_actions.map((action) => action.story_id),
    ["current-ready"],
  );
});

test("guarded dispatch preflight CLI reads platform_posts as read-only duplicate evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-dispatch-db-published-"));
  const media = await makeMedia(root);
  const goalDir = path.join(root, "output", "goal-contract");
  const outDir = path.join(root, "out");
  const dbPath = path.join(root, "pulse.db");
  await fs.ensureDir(goalDir);
  await fs.writeJson(path.join(goalDir, "human_review_approval_gate_report.json"), approvalGateReport(media, []), { spaces: 2 });
  await fs.writeJson(
    path.join(goalDir, "dry_run_publish_plan.json"),
    {
      ...strictDryRunPlan(media, []),
      actions: [
        {
          story_id: "story-one",
          platform: "youtube_shorts",
          action: "would_publish",
          title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
          video_path: media.videoPath,
          captions_path: media.captionsPath,
          cover_frame_source: media.videoPath,
          canonical_manifest_path: media.canonicalPath,
          platform_publish_manifest_path: media.platformManifestPath,
          platform_enabled: true,
          live_publish_allowed_from_dry_run: false,
          requires_human_review_before_live_publish: false,
          live_execution_gate: "guarded_dispatch_ready",
          autonomous_green_lit_by_dry_run: true,
          requires_guarded_dispatch_command: true,
          requires_enabled_platform_recheck: true,
          blockers: [],
          warnings: [],
        },
      ],
    },
    { spaces: 2 },
  );
  await fs.writeJson(path.join(goalDir, "platform_status_matrix.json"), platformStatusMatrix(), { spaces: 2 });
  await fs.writeJson(path.join(goalDir, "transcript_audience_audit.json"), transcriptAudienceReport(), { spaces: 2 });

  const sqlite = new Database(dbPath);
  sqlite.exec(`
    CREATE TABLE platform_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT,
      platform TEXT,
      external_id TEXT,
      external_url TEXT,
      status TEXT,
      published_at TEXT,
      updated_at TEXT
    );
    INSERT INTO platform_posts (story_id, platform, external_id, status, published_at)
    VALUES ('story-one', 'youtube', 'yt_structured', 'published', '2026-06-21T22:31:36.624Z');
  `);
  sqlite.close();

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-guarded-dispatch-preflight.js",
      "--root",
      root,
      "--out-dir",
      outDir,
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PULSE_SKIP_DOTENV: "true",
        USE_SQLITE: "true",
        SQLITE_DB_PATH: dbPath,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.verdict, "AMBER");
  assert.equal(parsed.summary.dispatch_ready_action_count, 0);
  assert.equal(parsed.summary.ignored_already_published_action_count, 1);
  assert.equal(parsed.ignored_already_published_actions[0].platform, "youtube_shorts");
});
