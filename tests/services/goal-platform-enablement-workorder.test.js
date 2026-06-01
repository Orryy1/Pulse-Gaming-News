"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoalPlatformEnablementWorkOrder,
  renderGoalPlatformEnablementWorkOrderMarkdown,
  writeGoalPlatformEnablementWorkOrder,
} = require("../../lib/goal-platform-enablement-workorder");

const ROOT = path.resolve(__dirname, "..", "..");

function dryRunPlan() {
  const actionBase = {
    mode: "DRY_RUN_PUBLISH",
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    no_network_upload: true,
    live_publish_allowed_from_dry_run: false,
  };
  return {
    schema_version: 1,
    generated_at: "2026-05-28T12:00:00.000Z",
    mode: "DRY_RUN_PUBLISH",
    overall_verdict: "AMBER",
    summary: {
      ready_story_count: 2,
      platform_enabled_dry_run_action_count: 6,
      platform_deferred_action_count: 8,
      live_publish_allowed_action_count: 0,
    },
    actions: [
      { ...actionBase, story_id: "story-a", platform: "youtube_shorts", action: "would_publish", platform_enabled: true },
      { ...actionBase, story_id: "story-a", platform: "instagram_reels", action: "would_publish", platform_enabled: true },
      {
        ...actionBase,
        story_id: "story-a",
        platform: "tiktok",
        action: "would_queue_when_enabled",
        platform_enabled: false,
        platform_operational_state: "needs_credentials",
        platform_operational_reason: "tiktok_local_token_refresh_or_sync_required",
        platform_enablement_gaps: ["tiktok_local_token_refresh_or_sync_required"],
        platform_enablement_next_action: "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
      },
      {
        ...actionBase,
        story_id: "story-b",
        platform: "tiktok",
        action: "would_queue_when_enabled",
        platform_enabled: false,
        platform_operational_state: "needs_credentials",
        platform_operational_reason: "tiktok_local_token_refresh_or_sync_required",
        platform_enablement_gaps: ["tiktok_local_token_refresh_or_sync_required"],
        platform_enablement_next_action: "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
      },
      {
        ...actionBase,
        story_id: "story-a",
        platform: "x",
        action: "would_queue_when_enabled",
        platform_enabled: false,
        platform_operational_state: "disabled",
        platform_operational_reason: "x_optional_disabled",
        platform_enablement_gaps: ["x_operator_disabled", "x_api_billing_not_declared"],
        platform_enablement_next_action: "keep_x_disabled_until_paid_api_and_credentials_are_confirmed",
      },
      {
        ...actionBase,
        story_id: "story-a",
        platform: "threads",
        action: "would_queue_when_enabled",
        platform_enabled: false,
        platform_operational_state: "disabled",
        platform_operational_reason: "threads_not_configured",
      },
      {
        ...actionBase,
        story_id: "story-a",
        platform: "pinterest",
        action: "would_queue_when_enabled",
        platform_enabled: false,
        platform_operational_state: "disabled",
        platform_operational_reason: "pinterest_not_configured",
      },
    ],
    platform_status_matrix: {
      platforms: {
        youtube_shorts: { status: "ready_now", operational_state: "enabled" },
        instagram_reels: { status: "ready_now", operational_state: "enabled" },
        tiktok: {
          status: "deferred_until_platform_enabled",
          operational_state: "needs_credentials",
          enablement_gaps: ["tiktok_local_token_refresh_or_sync_required"],
          enablement_next_action: "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
        },
        x: {
          status: "deferred_until_platform_enabled",
          operational_state: "disabled",
          enablement_gaps: ["x_operator_disabled", "x_api_billing_not_declared"],
          enablement_next_action: "keep_x_disabled_until_paid_api_and_credentials_are_confirmed",
        },
      },
    },
  };
}

test("platform enablement work order aggregates deferred platforms without marking them publishable", () => {
  const report = buildGoalPlatformEnablementWorkOrder({
    dryRunPlan: dryRunPlan(),
    platformDoctor: {
      platforms: {
        tiktok: {
          status: "needs_local_token_refresh_or_sync",
          recommendation: "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
          token: { access_token: "must-not-leak", refresh_token: "also-secret" },
        },
        x: {
          status: "operator_disabled",
          recommendation: "keep_x_disabled_until_paid_api_and_credentials_are_confirmed",
          enablement_gaps: ["x_operator_disabled", "x_api_billing_not_declared"],
        },
      },
      safety: { no_token_mutation: true, no_public_posts: true },
    },
    generatedAt: "2026-05-28T12:01:00.000Z",
  });

  assert.equal(report.mode, "PLATFORM_ENABLEMENT_WORK_ORDER");
  assert.equal(report.verdict, "AMBER");
  assert.equal(report.safe_to_publish_boolean, false);
  assert.equal(report.publish_authority, "none");
  assert.match(report.readiness_reason, /4_deferred_platforms_require_operator_enablement/);
  assert.match(report.readiness_reason, /5_deferred_actions/);
  assert.match(report.readiness_reason, /live_publish_actions_allowed=0/);
  assert.equal(report.summary.deferred_platform_count, 4);
  assert.equal(report.summary.total_deferred_actions, 5);
  assert.equal(report.summary.live_publish_actions_allowed, 0);
  assert.deepEqual(report.summary.enabled_platforms_human_review_only, [
    "youtube_shorts",
    "instagram_reels",
  ]);
  assert.deepEqual(report.summary.enabled_platform_action_counts, {
    youtube_shorts: 1,
    instagram_reels: 1,
  });
  assert.deepEqual(report.summary.deferred_platform_action_counts, {
    tiktok: 2,
    x: 1,
    threads: 1,
    pinterest: 1,
  });
  assert.equal(report.platforms.tiktok.deferred_action_count, 2);
  assert.deepEqual(report.platforms.tiktok.story_ids, ["story-a", "story-b"]);
  assert.equal(report.platforms.tiktok.safe_to_enable_without_operator, false);
  assert.equal(report.platforms.tiktok.live_publish_allowed_before_enablement, false);
  assert.ok(report.platforms.tiktok.operator_actions.includes("Refresh or sync the local TikTok token with the operator present."));
  assert.ok(report.platforms.x.operator_actions.includes("Confirm paid X API/billing access before enabling the operator switch."));
  assert.ok(report.platforms.threads.operator_actions.includes("Configure the Threads platform integration before counting this platform as ready."));
  assert.ok(report.platforms.pinterest.operator_actions.includes("Configure the Pinterest platform integration before counting this platform as ready."));
  assert.equal(report.operator_enablement_checklist.platforms.length, 4);
  assert.equal(report.operator_enablement_checklist.platforms[0].platform, "tiktok");
  assert.equal(report.operator_enablement_checklist.platforms[0].operator_actions.length >= 2, true);
  assert.deepEqual(report.operator_enablement_checklist.platforms[0].validation_commands, [
    "npm run tiktok:auth-doctor",
    "npm run ops:platform-doctor",
    "npm run ops:goal-dry-run-publish",
  ]);
  assert.equal(report.platform_guardrail_report.summary.deferred_platform_count, 4);
  assert.equal(report.platform_guardrail_report.summary.live_publish_actions_allowed, 0);
  assert.equal(report.platform_guardrail_report.verdict, "AMBER");
  assert.equal(report.platform_guardrail_report.guardrails.disabled_platforms_not_publishable, "pass");
  assert.equal(report.platform_guardrail_report.guardrails.operator_enablement_required, "pass");
  assert.deepEqual(report.safety, {
    no_publish_triggered: true,
    no_network_uploads: true,
    no_db_mutation: true,
    no_oauth_or_token_change: true,
    secrets_redacted: true,
  });

  const serialised = JSON.stringify(report);
  assert.doesNotMatch(serialised, /must-not-leak|also-secret|access_token|refresh_token|Bearer/);

  const markdown = renderGoalPlatformEnablementWorkOrderMarkdown(report);
  assert.match(markdown, /Verdict: AMBER/);
  assert.match(markdown, /Safe to publish: false/);
  assert.match(markdown, /Enabled human-review platforms: youtube_shorts, instagram_reels/);
  assert.match(markdown, /Deferred platform action counts: tiktok=2, x=1, threads=1, pinterest=1/);
  assert.match(markdown, /TikTok/);
  assert.match(markdown, /X/);
  assert.doesNotMatch(markdown, /must-not-leak|also-secret|access_token|refresh_token|Bearer/);
});

test("platform enablement work order writer and CLI emit machine-readable artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-enablement-"));
  const outDir = path.join(root, "out");
  const dryRunPath = path.join(root, "dry_run_publish_plan.json");
  const doctorPath = path.join(root, "platform_readiness_doctor.json");
  await fs.outputJson(dryRunPath, dryRunPlan());
  await fs.outputJson(doctorPath, { platforms: {}, safety: { no_token_mutation: true } });

  const report = buildGoalPlatformEnablementWorkOrder({
    dryRunPlan: dryRunPlan(),
    generatedAt: "2026-05-28T12:02:00.000Z",
  });
  const artefacts = await writeGoalPlatformEnablementWorkOrder(report, { outputDir: outDir });
  assert.equal(await fs.pathExists(artefacts.jsonPath), true);
  assert.equal(await fs.pathExists(artefacts.mdPath), true);
  assert.equal(await fs.pathExists(path.join(outDir, "operator_enablement_checklist.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "platform_guardrail_report.json")), true);
  assert.equal(path.basename(artefacts.operatorEnablementChecklistPath), "operator_enablement_checklist.json");
  assert.equal(path.basename(artefacts.platformGuardrailReportPath), "platform_guardrail_report.json");

  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "tools", "goal-platform-enablement-workorder.js"),
      "--dry-run-plan",
      dryRunPath,
      "--platform-doctor",
      doctorPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-28T12:03:00.000Z",
      "--json",
    ],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, PULSE_SKIP_DOTENV: "1" } },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.verdict, "AMBER");
  assert.equal(parsed.safe_to_publish_boolean, false);
  assert.equal(parsed.publish_authority, "none");
  assert.equal(parsed.summary.deferred_platform_count, 4);
  assert.equal(await fs.pathExists(path.join(outDir, "platform_enablement_work_order.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "platform_enablement_work_order.md")), true);
});
