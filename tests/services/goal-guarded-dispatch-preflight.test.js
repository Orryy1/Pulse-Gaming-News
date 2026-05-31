"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
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
  assert.deepEqual(report.advisory, ["no_operator_approved_actions"]);
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
      "--out-dir",
      outDir,
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
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
