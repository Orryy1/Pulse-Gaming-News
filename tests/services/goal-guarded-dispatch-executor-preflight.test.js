"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGuardedDispatchExecutorPreflight,
  renderGuardedDispatchExecutorPreflightMarkdown,
  writeGuardedDispatchExecutorPreflight,
} = require("../../lib/goal-guarded-dispatch-executor-preflight");

const ROOT = path.resolve(__dirname, "..", "..");

async function evidenceFiles(root) {
  const dir = path.join(root, "proof", "story-one");
  await fs.ensureDir(dir);
  const video = path.join(dir, "visual_v4_render.mp4");
  const captions = path.join(dir, "captions.srt");
  const canonical = path.join(dir, "canonical_story_manifest.json");
  const platform = path.join(dir, "platform_publish_manifest.json");
  await fs.writeFile(video, Buffer.alloc(2048, 1));
  await fs.writeFile(captions, "1\n00:00:00,000 --> 00:00:01,000\nForza.\n");
  await fs.writeJson(canonical, { story_id: "story-one", selected_title: "Forza Horizon 6 Exposes Xbox's Steam Bet" });
  await fs.writeJson(platform, { outputs: { youtube_shorts: {} } });
  return { video, captions, canonical, platform };
}

function guardedDispatchPlan(files = {}) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T19:00:00.000Z",
    mode: "GUARDED_DISPATCH_PREFLIGHT",
    ready_for_guarded_dispatch: true,
    live_publish_allowed_from_this_tool: false,
    dispatch_ready_action_count: 1,
    blocked_action_count: 0,
    dispatch_ready_actions: [
      {
        story_id: "story-one",
        platform: "youtube_shorts",
        title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
        operator: "MORR",
        operator_decided_at: "2026-05-31T18:50:00.000Z",
        video_path: files.video || "C:\\proof\\story-one\\visual_v4_render.mp4",
        captions_path: files.captions || "C:\\proof\\story-one\\captions.srt",
        first_frame_source: files.video || "C:\\proof\\story-one\\visual_v4_render.mp4",
        canonical_manifest_path: files.canonical || "C:\\proof\\story-one\\canonical_story_manifest.json",
        platform_publish_manifest_path: files.platform || "C:\\proof\\story-one\\platform_publish_manifest.json",
        live_publish_allowed_from_preflight: false,
        requires_guarded_live_dispatch_executor: true,
        requires_last_second_kill_switch_check: true,
        requires_last_second_platform_recheck: true,
      },
    ],
    required_next_step: "run_guarded_live_dispatch_executor_with_kill_switch_and_final_platform_recheck",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function emptyGuardedDispatchPlan() {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T19:00:00.000Z",
    mode: "GUARDED_DISPATCH_PREFLIGHT",
    ready_for_guarded_dispatch: false,
    live_publish_allowed_from_this_tool: false,
    dispatch_ready_action_count: 0,
    blocked_action_count: 0,
    dispatch_ready_actions: [],
    required_next_step: "record_operator_approved_actions_before_guarded_dispatch",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function platformStatusMatrix(overrides = {}) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T19:00:00.000Z",
    overall_verdict: "AMBER",
    platforms: {
      youtube_shorts: {
        platform: "youtube_shorts",
        status: "ready_now",
        operational_state: "enabled",
        blocked_action_count: 0,
        deferred_action_count: 0,
        planned_story_ids: ["story-one"],
        ...overrides.youtube_shorts,
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

test("executor preflight stays AMBER when no dispatch-ready actions exist", () => {
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: emptyGuardedDispatchPlan(),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: [],
    env: {},
    generatedAt: "2026-05-31T19:05:00.000Z",
  });

  assert.equal(report.mode, "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT");
  assert.equal(report.verdict, "AMBER");
  assert.equal(report.safe_to_publish_boolean, false);
  assert.equal(report.summary.dispatch_ready_action_count, 0);
  assert.equal(report.summary.handoff_ready_action_count, 0);
  assert.ok(report.advisory.includes("no_dispatch_ready_actions"));
  assert.equal(report.executor_plan.live_publish_allowed_from_this_tool, false);
  assert.equal(report.safety.no_network_uploads, true);
});

test("executor preflight requires explicit action ids before any handoff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-no-selection-"));
  const files = await evidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: [],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.handoff_ready_action_count, 0);
  assert.ok(report.advisory.includes("explicit_action_ids_required"));
  assert.equal(report.executor_plan.required_next_step, "select_explicit_dispatch_action_ids");
});

test("executor preflight rejects selected actions when executor is not armed or kill switch is not clear", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-unarmed-"));
  const files = await evidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
      PULSE_EMERGENCY_KILL_SWITCH: "engaged",
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_selected_action_count, 1);
  assert.equal(report.summary.handoff_ready_action_count, 0);
  assert.ok(report.blocked_selected_actions[0].blockers.includes("guarded_live_dispatch_not_armed"));
  assert.ok(report.blocked_selected_actions[0].blockers.includes("emergency_kill_switch_not_clear"));
});

test("executor preflight rejects selected actions if platform readiness drifts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-platform-drift-"));
  const files = await evidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix({
      youtube_shorts: {
        status: "deferred_until_platform_enabled",
        operational_state: "disabled",
        deferred_action_count: 1,
      },
    }),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "RED");
  assert.ok(report.blocked_selected_actions[0].blockers.includes("platform_not_ready_now:youtube_shorts"));
  assert.ok(report.blocked_selected_actions[0].blockers.includes("platform_not_enabled:youtube_shorts"));
  assert.ok(report.blocked_selected_actions[0].blockers.includes("platform_has_deferred_actions:youtube_shorts"));
});

test("executor preflight produces a non-posting handoff plan only after action ids, platform recheck and kill switch pass", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-green-"));
  const files = await evidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    generatedAt: "2026-05-31T19:05:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.selected_action_count, 1);
  assert.equal(report.summary.handoff_ready_action_count, 1);
  assert.equal(report.executor_state.guarded_live_dispatch_enabled, true);
  assert.equal(report.executor_state.emergency_kill_switch_state, "clear");
  assert.equal(report.handoff_ready_actions[0].action_id, "story-one:youtube_shorts");
  assert.equal(report.handoff_ready_actions[0].live_publish_allowed_from_preflight_only, false);
  assert.equal(report.handoff_ready_actions[0].requires_live_executor_command, true);
  assert.equal(report.executor_plan.ready_for_live_executor_handoff, true);
  assert.equal(report.executor_plan.live_publish_allowed_from_this_tool, false);
  assert.equal(report.safe_to_publish_boolean, false);

  const markdown = renderGuardedDispatchExecutorPreflightMarkdown(report);
  assert.match(markdown, /Guarded Dispatch Executor Preflight/);
  assert.match(markdown, /story-one -> youtube_shorts/);
  assert.match(markdown, /No uploads are triggered/);
});

test("executor preflight writes machine-readable reports and CLI emits JSON", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-cli-"));
  const files = await evidenceFiles(root);
  const planPath = path.join(root, "guarded_dispatch_plan.json");
  const platformPath = path.join(root, "platform_status_matrix.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(planPath, guardedDispatchPlan(files), { spaces: 2 });
  await fs.writeJson(platformPath, platformStatusMatrix(), { spaces: 2 });

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });
  const written = await writeGuardedDispatchExecutorPreflight(report, { outputDir: outDir });
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_dispatch_executor_preflight_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_dispatch_executor_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_dispatch_executor_preflight.md")), true);
  assert.equal(path.basename(written.executorPlanPath), "guarded_dispatch_executor_plan.json");

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-guarded-dispatch-executor-preflight.js",
      "--guarded-dispatch-plan",
      planPath,
      "--platform-status-matrix",
      platformPath,
      "--action-id",
      "story-one:youtube_shorts",
      "--out-dir",
      outDir,
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PULSE_SKIP_DOTENV: "1",
        PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
        PULSE_EMERGENCY_KILL_SWITCH: "clear",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.handoff_ready_action_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_dispatch_executor_preflight_report.json")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(
    pkg.scripts["ops:goal-guarded-dispatch-executor-preflight"],
    "node tools/goal-guarded-dispatch-executor-preflight.js",
  );
});
