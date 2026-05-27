"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
const {
  deriveSecuritySnapshot,
  main,
  parseArgs,
} = require("../../tools/goal23-security-secrets-deployment-safety");

test("Goal 23 CLI parses security proof inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-registry-report",
    "output/goal-22/goal22_readiness_report.json",
    "--dry-run-plan",
    "output/goal-contract/dry_run_publish_plan.json",
    "--out-dir",
    "output/goal-23",
    "--workspace",
    ".",
    "--source-root",
    "lib",
    "--source-root",
    "tools",
    "--generated-at",
    "2026-05-26T06:07:56.332Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamRegistryReportPath, "output/goal-22/goal22_readiness_report.json");
  assert.equal(args.dryRunPlanPath, "output/goal-contract/dry_run_publish_plan.json");
  assert.equal(args.outDir, "output/goal-23");
  assert.equal(args.workspaceRoot, ".");
  assert.deepEqual(args.sourceRoots, ["lib", "tools"]);
  assert.equal(args.generatedAt, "2026-05-26T06:07:56.332Z");
  assert.equal(args.json, true);
});

test("Goal 23 CLI writes security, secrets scan and deployment artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal23-cli-"));
  const sourceRoot = path.join(root, "lib");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal22.json");
  const dryRunPath = path.join(root, "dry-run.json");
  const outDir = path.join(root, "out");
  await fs.outputFile(path.join(sourceRoot, "safe.js"), "module.exports = { mode: 'LOCAL_PROOF' };\n");
  await fs.outputJson(storyPackagesPath, [{ story_id: "story-cli", artifact_dir: path.join(root, "story-cli") }]);
  await fs.outputJson(upstreamPath, {
    verdict: "BLOCKED",
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["versioning:audio_model_missing"] }],
  });
  await fs.outputJson(dryRunPath, { mode: "DRY_RUN_PUBLISH", actions: [] });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-registry-report",
    upstreamPath,
    "--dry-run-plan",
    dryRunPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--source-root",
    sourceRoot,
    "--generated-at",
    "2026-05-26T06:07:56.332Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(result.report.summary.publish_now_count, 0);
  assert.equal(await fs.pathExists(path.join(outDir, "goal23_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal23_readiness_report.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "security_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "secrets_scan_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "deployment_safety_report.json")), true);
});

test("Goal 23 CLI derives token rotation, least privilege and retry logging evidence from security runbook", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal23-security-doc-"));
  await fs.outputJson(path.join(root, "package.json"), {
    scripts: {
      dev: "node server.js",
      start: "node server.js",
    },
  });
  await fs.outputFile(
    path.join(root, "AGENTS.md"),
    [
      "LOCAL_PROOF and DRY_RUN_PUBLISH are the only default modes.",
      "HUMAN_REVIEW queue approval is required before live action.",
      "No live publishing by default. Kill switch must be healthy.",
      "OAuth scopes must be least privilege.",
      "",
    ].join("\n"),
  );
  await fs.outputFile(
    path.join(root, "docs", "security-deployment-safety.md"),
    [
      "# Security Deployment Safety",
      "",
      "Token rotation: rotate platform credentials every 90 days or sooner after any incident.",
      "Least privilege: keep OAuth scopes to upload, analytics read-only and page publishing scopes only.",
      "Retry logging: every platform retry records attempt count, reason code, platform and story id without credential material.",
      "Safe API handling: no live publishing outside GREEN control tower and explicit operator enablement.",
      "",
    ].join("\n"),
  );
  await fs.outputFile(path.join(root, "upload_youtube.js"), "const scope = ['youtube.upload'];\n");
  await fs.outputFile(path.join(root, "upload_tiktok.js"), "const scope = 'video.upload,video.publish';\n");
  await fs.outputFile(path.join(root, "upload_instagram.js"), "const scope = 'instagram_content_publish';\n");
  await fs.outputFile(path.join(root, "upload_facebook.js"), "const scope = 'pages_manage_posts';\n");
  await fs.outputFile(path.join(root, "upload_twitter.js"), "const scope = 'tweet.write';\n");
  await fs.outputJson(path.join(root, "output", "goal-22", "production_audit_log.json"), []);

  const snapshot = await deriveSecuritySnapshot(root, { mode: "DRY_RUN_PUBLISH" });

  assert.equal(snapshot.token_rotation_plan.present, true);
  assert.equal(snapshot.token_rotation_plan.rotation_days, 90);
  assert.equal(snapshot.least_privilege, true);
  assert.equal(snapshot.retry_logging, true);
  assert.equal(snapshot.safe_api_handling, true);
});

test("Goal 23 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal23-security-secrets-deployment-safety"],
    "node tools/goal23-security-secrets-deployment-safety.js",
  );
});
