"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_CONTROL_INPUTS,
  buildGoal19AutonomyControlTower,
  writeGoal19AutonomyControlTower,
} = require("../../lib/goal19-autonomy-control-tower");

function passGate(extra = {}) {
  return { verdict: "pass", failures: [], warnings: [], ...extra };
}

async function makeControlStory(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Horizon 6 Shows Real Footage",
    narration_script: "Forza Horizon 6 showed real footage from Xbox. The copy stays source backed.",
    commercial_intelligence: { disclosure_required: true },
    ...(overrides.canonical || {}),
  });
  await fs.outputJson(path.join(artifactDir, "script_scorecard.json"), overrides.scriptScorecard || passGate({ viral_score: 88 }));
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), overrides.footageInventory || {
    verdict: "pass",
    failures: [],
    blockers: [],
    motion_asset_count: 6,
    distinct_motion_family_count: 4,
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), overrides.rightsLedger || passGate());
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), overrides.directorPlan || {
    readiness: { status: "ready", blockers: [] },
    shot_plan: [{ id: "hook", kind: "motion_clip" }],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), overrides.renderManifest || {
    final_publish_render: true,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    quality_gate_status: "pass",
    safety: { no_publish_triggered: true },
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), overrides.visualQuality || passGate());
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), overrides.benchmark || passGate({ result: "pass" }));
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), overrides.policyReport || {
    verdict: "pass",
    publish_blockers: [],
    youtube_reused_content_risk: passGate(),
    affiliate_disclosure: passGate(),
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), overrides.affiliate || {
    disclosure_required: true,
    disclosure_copy: { short: "Affiliate links may earn us a commission." },
    failures: [],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), overrides.platformManifest || {
    publish_status: "GREEN",
    can_auto_publish: true,
    outputs: {
      youtube_shorts: { title: "Forza Horizon 6 Shows Real Footage" },
      tiktok: { caption: "Source: Xbox." },
    },
    governance_gates: {
      public_output_coherence_gate: passGate(),
      rights_ledger: passGate(),
      platform_policy_gate: passGate(),
      affiliate_disclosure_gate: passGate(),
      reused_content_risk_gate: passGate(),
      anti_spam_uniqueness_gate: passGate(),
      finance_crypto_firewall: passGate(),
    },
  });
  await fs.outputJson(path.join(artifactDir, "analytics_ingest_plan.json"), overrides.analyticsRisk || {
    dry_run_only: true,
    risk_status: "clear",
    required_metrics: ["views", "average_view_duration", "swipe_away"],
  });
  await fs.outputJson(path.join(artifactDir, "uniqueness_report.json"), overrides.uniquenessReport || passGate({ matches: [] }));
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), overrides.publishVerdict || {
    verdict: "GREEN",
    can_auto_publish: true,
    reason_codes: [],
  });
  return { story_id: storyId, artifact_dir: artifactDir, title: "Forza Horizon 6 Shows Real Footage" };
}

function readyGoal18(storyId) {
  return { stories: [{ story_id: storyId, status: "ready", blockers: [] }] };
}

function blockedGoal18(storyId) {
  return {
    stories: [{
      story_id: storyId,
      status: "blocked",
      blockers: ["upstream:goal17_platform_policy_engine_blocked"],
    }],
  };
}

test("Goal 19 emits RED final verdicts when Goal 18 is blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-upstream-"));
  const story = await makeControlStory(root, "story-upstream");

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: blockedGoal18("story-upstream"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:07:13.497Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_control_tower_verdict, "PASS");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.green_story_count, 0);
  assert.equal(report.summary.red_story_count, 1);
  assert.equal(report.summary.publish_now_count, 0);
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].direct_control_tower_status, "pass");
  assert.ok(report.stories[0].blockers.includes("upstream:goal18_finance_crypto_firewall_blocked"));
  for (const input of REQUIRED_CONTROL_INPUTS) {
    assert.equal(report.stories[0].control_inputs[input].status, "pass", input);
  }
  assert.equal(report.publish_verdict.publish_now_count, 0);
  assert.equal(report.publish_verdict.stories[0].can_auto_publish, false);
  assert.equal(report.rejection_reasons.stories[0].upstream_reasons.length, 2);
});

test("Goal 19 hard-blocks incomplete direct control inputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-direct-"));
  const story = await makeControlStory(root, "story-direct", {
    scriptScorecard: { verdict: "rewrite_required", blockers: [] },
    footageInventory: { verdict: "blocked", blockers: ["no_motion_assets"] },
    rightsLedger: { verdict: "fail", failures: ["asset_missing_rights"] },
    directorPlan: { readiness: { status: "director_blocked", blockers: ["actual_motion_clip_minimum_not_met"] } },
    renderManifest: { final_publish_render: false, output_path: "", quality_gate_status: "pending_post_render_forensics" },
    visualQuality: { verdict: "fail", failures: ["unclear_first_frame"] },
    benchmark: { result: "fail", failures: ["motion_density_below_reference"] },
    policyReport: { verdict: "fail", publish_blockers: ["policy:reused_content"] },
    affiliate: { disclosure_required: true, disclosure_copy: {}, failures: [] },
    platformManifest: {
      publish_status: "RED",
      can_auto_publish: false,
      outputs: {},
      governance_gates: {
        anti_spam_uniqueness_gate: { verdict: "fail", failures: ["duplicate_title_structure"] },
      },
    },
    analyticsRisk: {},
    uniquenessReport: { verdict: "fail", failures: ["duplicate_title_structure"], matches: ["story-a"] },
    publishVerdict: { verdict: "RED", can_auto_publish: false, reason_codes: ["governance:red"] },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-direct"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:07:13.497Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_control_tower_verdict, "BLOCKED");
  assert.equal(report.stories[0].final_verdict, "RED");
  for (const blocker of [
    "control:script_scorecard_not_pass",
    "control:footage_inventory_not_pass",
    "control:rights_ledger_not_pass",
    "control:director_plan_not_pass",
    "control:render_qa_not_pass",
    "control:benchmark_report_not_pass",
    "control:policy_report_not_pass",
    "control:affiliate_disclosure_not_pass",
    "control:platform_pack_not_green",
    "control:analytics_risk_missing",
    "control:anti_spam_not_pass",
  ]) {
    assert.ok(report.blocker_counts[blocker] >= 1, blocker);
    assert.ok(report.direct_risk_counts[blocker] >= 1, blocker);
  }
  assert.equal(report.approval_requirements.stories[0].status, "blocked_until_repairs");
  assert.equal(report.publish_verdict.stories[0].publish_action, "none_blocked");
});

test("Goal 19 returns AMBER when safe output still needs human approval", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-amber-"));
  const story = await makeControlStory(root, "story-amber", {
    canonical: { human_review_required: true, human_review_reason: "Operator wants manual source check before publish." },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-amber"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:07:13.497Z",
  });

  assert.equal(report.verdict, "PARTIAL");
  assert.equal(report.direct_control_tower_verdict, "PASS");
  assert.equal(report.stories[0].final_verdict, "AMBER");
  assert.equal(report.stories[0].approval_required, true);
  assert.equal(report.stories[0].can_auto_publish, false);
  assert.equal(report.approval_requirements.stories[0].status, "human_review_required");
  assert.ok(report.approval_requirements.stories[0].requirements.includes("human_approval_required"));
});

test("Goal 19 writes required control tower artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-write-"));
  const story = await makeControlStory(root, "story-write");
  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-write"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:07:13.497Z",
  });
  const written = await writeGoal19AutonomyControlTower(report, { outputDir: path.join(root, "out") });

  assert.equal(report.verdict, "PASS");
  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.publishVerdict), true);
  assert.equal(await fs.pathExists(written.riskReport), true);
  assert.equal(await fs.pathExists(written.rejectionReasons), true);
  assert.equal(await fs.pathExists(written.approvalRequirements), true);
});
