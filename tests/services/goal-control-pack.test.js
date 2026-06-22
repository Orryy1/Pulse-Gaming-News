"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoalControlPack,
  buildLiveDispatchCommand,
  splitPlatformStatus,
  writeGoalControlPack,
} = require("../../lib/goal-control-pack");
const { parseArgs } = require("../../tools/goal-control-pack");

async function writeFixture(dir) {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, "dry_run_publish_plan.json"), {
    generated_at: "2026-06-21T21:55:51.068Z",
    overall_verdict: "AMBER",
    summary: {
      ready_story_count: 1,
      blocked_story_count: 0,
      skipped_story_count: 1,
    },
    safe_publish_plan: {
      guarded_dispatch_ready_action_count: 3,
    },
  });
  await fs.writeJson(path.join(dir, "human_review_queue.json"), {
    summary: { review_item_count: 1 },
  });
  await fs.writeJson(path.join(dir, "human_review_approval_gate_report.json"), {
    verdict: "AMBER",
    summary: { pending_review_packet_count: 1 },
  });
  await fs.writeJson(path.join(dir, "guarded_dispatch_plan.json"), {
    ready_for_guarded_dispatch: true,
    dispatch_ready_action_count: 3,
    held_action_count: 0,
    blocked_action_count: 0,
    required_next_step: "run_guarded_live_dispatch_executor_with_kill_switch_and_final_platform_recheck",
  });
  await fs.writeJson(path.join(dir, "guarded_dispatch_executor_preflight_report.json"), {
    executor_state: {
      guarded_live_dispatch_enabled: true,
      emergency_kill_switch_state: "clear",
    },
  });
  await fs.writeJson(path.join(dir, "guarded_dispatch_executor_plan.json"), {
    ready_for_live_executor_handoff: true,
    handoff_ready_action_count: 3,
    blocked_selected_action_count: 0,
    required_next_step: "run_guarded_live_dispatch_executor",
    handoff_ready_actions: [
      {
        action_id: "story-1:youtube_shorts",
        story_id: "story-1",
        platform: "youtube_shorts",
        title: "Sea of Thieves Custom Seas Could Split Crews",
        video_path: "C:/repo/out/video.mp4",
        captions_path: "C:/repo/out/captions.srt",
        first_frame_source: "C:/repo/out/video.mp4",
        canonical_manifest_path: "C:/repo/out/canonical_story_manifest.json",
        platform_publish_manifest_path: "C:/repo/out/platform_publish_manifest.json",
        requires_live_executor_command: true,
        requires_last_second_kill_switch_check: true,
        requires_last_second_platform_recheck: true,
      },
      {
        action_id: "story-1:instagram_reels",
        story_id: "story-1",
        platform: "instagram_reels",
        title: "Sea of Thieves Custom Seas Could Split Crews",
        video_path: "C:/repo/out/video.mp4",
        captions_path: "C:/repo/out/captions.srt",
        first_frame_source: "C:/repo/out/video.mp4",
        canonical_manifest_path: "C:/repo/out/canonical_story_manifest.json",
        platform_publish_manifest_path: "C:/repo/out/platform_publish_manifest.json",
        requires_live_executor_command: true,
        requires_last_second_kill_switch_check: true,
        requires_last_second_platform_recheck: true,
      },
      {
        action_id: "story-1:facebook_reels",
        story_id: "story-1",
        platform: "facebook_reels",
        title: "Sea of Thieves Custom Seas Could Split Crews",
        video_path: "C:/repo/out/video.mp4",
        captions_path: "C:/repo/out/captions.srt",
        first_frame_source: "C:/repo/out/video.mp4",
        canonical_manifest_path: "C:/repo/out/canonical_story_manifest.json",
        platform_publish_manifest_path: "C:/repo/out/platform_publish_manifest.json",
        requires_live_executor_command: true,
        requires_last_second_kill_switch_check: true,
        requires_last_second_platform_recheck: true,
      },
    ],
  });
  await fs.writeJson(path.join(dir, "publish_readiness_report.json"), {
    generated_at: "2026-06-21T22:06:12.657Z",
    overall_verdict: "amber",
    blockers: [],
    readiness_scope: {
      name: "enabled_platform_guarded_handoff",
      guard_ready: true,
    },
    next_action: "Guarded enabled-platform dispatch is ready.",
  });
  await fs.writeJson(path.join(dir, "platform_status_matrix.json"), {
    safety: {
      dry_run_only: true,
      no_network_uploads: true,
      no_public_posts: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
    platforms: {
      youtube_shorts: {
        status: "ready_now",
        operational_state: "enabled",
        operational_reason: "core_upload_path",
      },
      instagram_reels: {
        status: "ready_now",
        operational_state: "enabled",
        operational_reason: "enabled_monitor_next_publish",
      },
      facebook_reels: {
        status: "ready_now",
        operational_state: "enabled",
        operational_reason: "facebook_reels_enabled",
      },
      tiktok: {
        status: "deferred_until_platform_enabled",
        operational_state: "needs_credentials",
        operational_reason: "tiktok_local_token_refresh_or_sync_required",
        deferred_action_count: 1,
      },
      x: {
        status: "deferred_until_platform_enabled",
        operational_state: "disabled",
        operational_reason: "x_optional_disabled",
        deferred_action_count: 1,
      },
    },
  });
}

test("splitPlatformStatus separates enabled and deferred platforms", () => {
  const split = splitPlatformStatus({
    platforms: {
      youtube_shorts: { status: "ready_now", operational_state: "enabled" },
      instagram_reels: { status: "no_ready_actions", operational_state: "enabled" },
      tiktok: { status: "deferred_until_platform_enabled", operational_state: "needs_credentials" },
    },
  });
  assert.deepEqual(split.enabled.map((row) => row.platform), ["youtube_shorts", "instagram_reels"]);
  assert.deepEqual(split.deferred.map((row) => row.platform), ["tiktok"]);
});

test("buildLiveDispatchCommand targets the guarded executor with explicit action ids", () => {
  const command = buildLiveDispatchCommand({
    root: "C:\\repo",
    executorPlanPath: "C:\\repo\\output\\goal-contract\\guarded_dispatch_executor_plan.json",
    handoffReadyActions: [
      { action_id: "one:youtube_shorts" },
      { action_id: "one:instagram_reels" },
    ],
  });
  assert.match(command, /^cd "C:\\repo"; /);
  assert.match(command, /PULSE_GUARDED_LIVE_DISPATCH_ENABLED='true'/);
  assert.match(command, /PULSE_EMERGENCY_KILL_SWITCH='clear'/);
  assert.match(command, /ops:goal-guarded-live-dispatch/);
  assert.match(command, /--action-ids "one:youtube_shorts,one:instagram_reels"/);
  assert.match(command, /--max-actions 2/);
  assert.match(command, /--apply --json/);
});

test("goal control pack writes named readiness, arm and approval artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-pack-"));
  try {
    const outDir = path.join(root, "output", "goal-contract");
    await writeFixture(outDir);
    const pack = await buildGoalControlPack({
      root,
      outDir,
      generatedAt: "2026-06-21T22:15:00.000Z",
    });
    const files = await writeGoalControlPack(pack, { outDir });

    assert.equal(pack.current_readiness_report.ready_story_count, 1);
    assert.equal(pack.current_readiness_report.executor_handoff_ready_action_count, 3);
    assert.equal(pack.executor_arm_status.verdict, "GREEN");
    assert.equal(pack.operator_approval_pack.controlled_batch.ready_action_count, 3);
    assert.deepEqual(
      pack.operator_approval_pack.controlled_batch.enabled_platforms,
      ["youtube_shorts", "instagram_reels", "facebook_reels"],
    );
    assert.deepEqual(
      pack.operator_approval_pack.controlled_batch.deferred_platforms.map((row) => row.platform),
      ["tiktok", "x"],
    );
    assert.equal(pack.operator_approval_pack.live_publish_allowed_from_pack, false);
    assert.match(pack.operator_approval_pack.exact_next_command, /--max-actions 3/);

    for (const filePath of Object.values(files)) {
      assert.equal(await fs.pathExists(filePath), true, `${filePath} should exist`);
    }
    const approvalMd = await fs.readFile(files.operatorApprovalMd, "utf8");
    assert.match(approvalMd, /Operator Approval Pack/);
    assert.match(approvalMd, /story-1:youtube_shorts/);
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("goal control pack reports executor arm blockers without inventing readiness", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-pack-red-"));
  try {
    const outDir = path.join(root, "output", "goal-contract");
    await writeFixture(outDir);
    const executorPlanPath = path.join(outDir, "guarded_dispatch_executor_plan.json");
    const executorPlan = await fs.readJson(executorPlanPath);
    executorPlan.ready_for_live_executor_handoff = false;
    executorPlan.handoff_ready_action_count = 0;
    executorPlan.handoff_ready_actions = [];
    executorPlan.blocked_selected_action_count = 1;
    executorPlan.blocked_selected_actions = [
      {
        action_id: "story-1:youtube_shorts",
        story_id: "story-1",
        platform: "youtube_shorts",
        blockers: ["guarded_live_dispatch_not_armed"],
      },
    ];
    await fs.writeJson(executorPlanPath, executorPlan);

    const pack = await buildGoalControlPack({
      root,
      outDir,
      generatedAt: "2026-06-21T22:16:00.000Z",
    });

    assert.equal(pack.executor_arm_status.verdict, "RED");
    assert.equal(pack.executor_arm_status.ready_for_live_executor_handoff, false);
    assert.equal(pack.operator_approval_pack.controlled_batch.ready_action_count, 0);
    assert.equal(pack.operator_approval_pack.exact_next_command, null);
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("goal control pack preserves guarded-plan zero after stale dry-run actions were published", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-pack-published-"));
  try {
    const outDir = path.join(root, "output", "goal-contract");
    await writeFixture(outDir);
    await fs.writeJson(path.join(outDir, "guarded_dispatch_plan.json"), {
      ready_for_guarded_dispatch: false,
      dispatch_ready_action_count: 0,
      held_action_count: 0,
      blocked_action_count: 0,
      ignored_already_published_action_count: 3,
      dispatch_ready_actions: [],
      ignored_already_published_actions: [
        { story_id: "story-1", platform: "youtube_shorts", reason: "already_published_platform_action" },
        { story_id: "story-1", platform: "instagram_reels", reason: "already_published_platform_action" },
        { story_id: "story-1", platform: "facebook_reels", reason: "already_published_platform_action" },
      ],
      required_next_step: "refresh_candidate_supply_and_strict_dry_run_after_published_actions",
    });
    await fs.writeJson(path.join(outDir, "guarded_dispatch_executor_plan.json"), {
      ready_for_live_executor_handoff: false,
      handoff_ready_action_count: 0,
      blocked_selected_action_count: 0,
      handoff_ready_actions: [],
      blocked_selected_actions: [],
      required_next_step: "refresh_candidate_supply_and_strict_dry_run_after_published_actions",
    });

    const pack = await buildGoalControlPack({
      root,
      outDir,
      generatedAt: "2026-06-21T22:40:00.000Z",
    });

    assert.equal(pack.current_readiness_report.ready_story_count, 0);
    assert.equal(pack.current_readiness_report.guarded_dispatch_ready_action_count, 0);
    assert.equal(pack.operator_approval_pack.current_state.ready_story_count, 0);
    assert.equal(pack.operator_approval_pack.controlled_batch.ready_action_count, 0);
    assert.equal(pack.operator_approval_pack.exact_next_command, null);
    assert.match(
      pack.markdown.next_actions,
      /refresh_candidate_supply_and_strict_dry_run_after_published_actions/,
    );
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("goal control pack CLI parses defaults and output override", () => {
  const args = parseArgs(["--root", "C:/repo", "--out-dir", "out", "--generated-at", "now", "--json"]);
  assert.equal(args.root, "C:/repo");
  assert.equal(args.outDir, "out");
  assert.equal(args.generatedAt, "now");
  assert.equal(args.json, true);
});
