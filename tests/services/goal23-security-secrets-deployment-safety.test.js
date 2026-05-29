"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_SECURITY_CONTROLS,
  buildGoal23SecuritySecretsDeploymentSafety,
  scanSourceRootsForSecrets,
  writeGoal23SecuritySecretsDeploymentSafety,
} = require("../../lib/goal23-security-secrets-deployment-safety");

function completeSecuritySnapshot(overrides = {}) {
  return {
    scoped_oauth: true,
    token_rotation_plan: { present: true, rotation_days: 90 },
    environment_separation: true,
    least_privilege: true,
    local_dev_prod_modes: true,
    dry_run_publishing: true,
    queue_approval: true,
    emergency_kill_switch: true,
    retry_logging: true,
    audit_trail: true,
    rollback_path: true,
    safe_api_handling: true,
    ...overrides,
  };
}

function readyGoal22(...storyIds) {
  return {
    verdict: "PASS",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "ready",
      blockers: [],
    })),
  };
}

function blockedGoal22(...storyIds) {
  return {
    verdict: "BLOCKED",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "blocked",
      blockers: ["versioning:audio_model_missing"],
    })),
  };
}

function mixedGoal22({ ready = [], skipped = [] } = {}) {
  return {
    verdict: "PASS",
    stories: [
      ...ready.map((storyId) => ({ story_id: storyId, status: "ready", blockers: [] })),
      ...skipped.map((storyId) => ({ story_id: storyId, status: "skipped", skipped_reason: "upstream_duplicate" })),
    ],
  };
}

test("Goal 23 preserves Goal 22 blockers while direct deployment safety passes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal23-upstream-"));
  const report = await buildGoal23SecuritySecretsDeploymentSafety({
    storyPackages: [{ story_id: "story-a", artifact_dir: path.join(root, "story-a") }],
    upstreamRegistryReport: blockedGoal22("story-a"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:07:56.332Z",
    securitySnapshot: completeSecuritySnapshot(),
    sourceScan: { findings: [], scanned_file_count: 0 },
    dryRunPlan: { mode: "DRY_RUN_PUBLISH", actions: [] },
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_safety_verdict, "PASS");
  assert.equal(report.summary.security_ready_story_count, 0);
  assert.equal(report.summary.direct_safety_pass_story_count, 1);
  assert.deepEqual(report.security_report.required_controls, REQUIRED_SECURITY_CONTROLS);
  assert.ok(report.stories[0].blockers.includes("upstream:goal22_versioned_prompt_model_registry_blocked"));
  assert.ok(report.stories[0].blockers.includes("versioning:audio_model_missing"));
  assert.equal(report.deployment_safety_report.publish_allowed_by_goal23, false);
  assert.equal(report.secrets_scan_report.secret_values_exposed, false);
});

test("Goal 23 preserves Goal 22 skipped stories instead of turning them into blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal23-skipped-"));
  const report = await buildGoal23SecuritySecretsDeploymentSafety({
    storyPackages: [
      { story_id: "ready-story", artifact_dir: path.join(root, "ready-story") },
      { story_id: "skipped-story", artifact_dir: path.join(root, "skipped-story") },
    ],
    upstreamRegistryReport: mixedGoal22({ ready: ["ready-story"], skipped: ["skipped-story"] }),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:07:56.332Z",
    securitySnapshot: completeSecuritySnapshot(),
    sourceScan: { findings: [], scanned_file_count: 0 },
    dryRunPlan: { mode: "DRY_RUN_PUBLISH", actions: [] },
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.security_ready_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
  const skipped = report.stories.find((story) => story.story_id === "skipped-story");
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.upstream_status, "skipped");
  assert.deepEqual(skipped.blockers, []);
});

test("Goal 23 blocks high-confidence hard-coded tokens and redacts scan output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal23-secret-"));
  const sourceRoot = path.join(root, "src");
  const fakeToken = "unit_test_high_entropy_value_123456789";
  await fs.outputFile(
    path.join(sourceRoot, "unsafe.js"),
    `const token = "${fakeToken}";\nconsole.log("ready");\n`,
  );

  const report = await buildGoal23SecuritySecretsDeploymentSafety({
    storyPackages: [{ story_id: "story-b", artifact_dir: path.join(root, "story-b") }],
    upstreamRegistryReport: readyGoal22("story-b"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:07:56.332Z",
    securitySnapshot: completeSecuritySnapshot(),
    sourceRoots: [sourceRoot],
    dryRunPlan: { mode: "DRY_RUN_PUBLISH", actions: [] },
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_safety_verdict, "BLOCKED");
  assert.ok(report.direct_risk_counts["security:hardcoded_token_findings"] >= 1);
  assert.ok(report.stories[0].direct_safety_blockers.includes("security:hardcoded_token_findings"));
  assert.equal(report.secrets_scan_report.findings.length, 1);
  assert.equal(JSON.stringify(report.secrets_scan_report).includes(fakeToken), false);
  assert.equal(report.secrets_scan_report.findings[0].redacted_snippet.includes("[REDACTED]"), true);
  assert.equal(report.secrets_scan_report.secret_values_exposed, false);
});

test("Goal 23 secret scan flags possible secret values in logs without blocking static OAuth help text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal23-log-scan-"));
  const sourceRoot = path.join(root, "src");
  await fs.outputFile(
    path.join(sourceRoot, "logs.js"),
    [
      'console.log("[youtube] Token saved successfully");',
      'console.log("Then run: node upload_youtube.js token YOUR_CODE_HERE");',
      "console.log(`[unsafe] token=${token}`);",
      "console.error(`[unsafe] secret failure: ${process.env.API_TOKEN}`);",
      "",
    ].join("\n"),
  );

  const scan = await scanSourceRootsForSecrets({
    workspaceRoot: root,
    sourceRoots: [sourceRoot],
  });

  assert.equal(scan.findings.length, 2);
  assert.equal(scan.findings.every((finding) => finding.kind === "secret_log_risk"), true);
  assert.equal(scan.findings.some((finding) => finding.redacted_snippet.includes("Token saved successfully")), false);
  assert.equal(scan.findings.some((finding) => finding.redacted_snippet.includes("YOUR_CODE_HERE")), false);
});

test("Goal 23 blocks missing deployment safety controls instead of faking readiness", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal23-controls-"));
  const report = await buildGoal23SecuritySecretsDeploymentSafety({
    storyPackages: [{ story_id: "story-c", artifact_dir: path.join(root, "story-c") }],
    upstreamRegistryReport: readyGoal22("story-c"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:07:56.332Z",
    securitySnapshot: {
      scoped_oauth: false,
      token_rotation_plan: null,
      environment_separation: false,
      queue_approval: false,
      emergency_kill_switch: false,
      audit_trail: false,
      rollback_path: false,
    },
    sourceScan: { findings: [], scanned_file_count: 0 },
    dryRunPlan: { mode: "DRY_RUN_PUBLISH", actions: [] },
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_safety_verdict, "BLOCKED");
  for (const blocker of [
    "security:scoped_oauth_evidence_missing",
    "security:token_rotation_plan_missing",
    "deployment:environment_separation_missing",
    "deployment:queue_approval_missing",
    "deployment:emergency_kill_switch_missing",
    "security:audit_trail_missing",
    "deployment:rollback_path_missing",
  ]) {
    assert.ok(report.stories[0].direct_safety_blockers.includes(blocker), blocker);
  }
});

test("Goal 23 writes the required security and deployment artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal23-write-"));
  const report = await buildGoal23SecuritySecretsDeploymentSafety({
    storyPackages: [{ story_id: "story-write", artifact_dir: path.join(root, "story-write") }],
    upstreamRegistryReport: readyGoal22("story-write"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:07:56.332Z",
    securitySnapshot: completeSecuritySnapshot(),
    sourceScan: { findings: [], scanned_file_count: 0 },
    dryRunPlan: { mode: "DRY_RUN_PUBLISH", actions: [] },
  });
  const written = await writeGoal23SecuritySecretsDeploymentSafety(report, { outputDir: path.join(root, "out") });

  assert.equal(report.verdict, "PASS");
  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.securityReport), true);
  assert.equal(await fs.pathExists(written.secretsScanReport), true);
  assert.equal(await fs.pathExists(written.deploymentSafetyReport), true);
});
