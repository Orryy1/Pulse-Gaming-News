"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  parseArgs,
  usage,
} = require("../../tools/candidate-evidence-reconciliation");

test("candidate evidence reconciliation CLI exposes bounded rights, fingerprint and lineage modes", () => {
  const rights = parseArgs([
    "--artifact-dir", "output/package",
    "--story-id", "black_flag",
    "--rights-only",
    "--apply",
    "--json",
  ]);
  assert.equal(rights.repairRights, true);
  assert.equal(rights.repairBridgeFingerprints, false);
  assert.equal(rights.apply, true);
  assert.equal(rights.json, true);

  const localRights = parseArgs([
    "--artifact-dir", "output/package",
    "--story-id", "tokon",
    "--rights-only",
    "--no-bridge-sync",
  ]);
  assert.equal(localRights.bridgePath, "");
  assert.equal(localRights.repairRights, true);
  assert.equal(localRights.repairBridgeFingerprints, false);

  const fingerprints = parseArgs([
    "--artifact-dir", "output/package",
    "--story-id", "digimon",
    "--bridge", "output/goal-contract/scheduler_bridge_candidates.json",
    "--aggregate", "output/goal-contract/story-packages.json",
    "--aggregate=output/goal-contract/production-cutover-story-packages.json",
    "--platforms", "youtube_shorts,instagram_reel,facebook_reels",
    "--fingerprints-only",
  ]);
  assert.equal(fingerprints.repairRights, false);
  assert.equal(fingerprints.repairBridgeFingerprints, true);
  assert.deepEqual(fingerprints.aggregatePaths, [
    "output/goal-contract/story-packages.json",
    "output/goal-contract/production-cutover-story-packages.json",
  ]);
  assert.deepEqual(fingerprints.targetPlatforms, [
    "youtube_shorts",
    "instagram_reel",
    "facebook_reels",
  ]);
  const lineage = parseArgs([
    "--artifact-dir", "output/package",
    "--story-id", "denshattack",
    "--lineage-only",
    "--no-bridge-sync",
  ]);
  assert.equal(lineage.bridgePath, "");
  assert.equal(lineage.repairRights, false);
  assert.equal(lineage.repairBridgeFingerprints, false);
  assert.equal(lineage.repairLineageHashes, true);
  assert.match(usage(), /never publishes/i);
  assert.match(usage(), /never mutates the database/i);
  assert.match(usage(), /--aggregate/);
  assert.match(usage(), /--platforms/);
  assert.match(usage(), /--no-bridge-sync/);
  assert.match(usage(), /--lineage-only/);
  assert.throws(
    () => parseArgs(["--platforms", ""]),
    /at least one platform key/i,
  );
});

test("candidate evidence reconciliation CLI keeps a RED aggregate authoritative under apply", async () => {
  const root = path.resolve(__dirname, "../..");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-reconciliation-cli-"));
  const artifactDir = path.join(tempDir, "package");
  const bridgePath = path.join(tempDir, "scheduler_bridge_candidates.json");
  const aggregatePath = path.join(tempDir, "story-packages.json");
  const outDir = path.join(tempDir, "proof");
  const storyId = "cli_aggregate_red_candidate";
  await fs.outputJson(path.join(artifactDir, "goal_package_summary.json"), {
    story_id: storyId,
    verdict: "GREEN",
    blockers: [],
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "GREEN",
    can_auto_publish: true,
    reason_codes: [],
  });
  const originalBridge = {
    scheduler_bridge_candidates: [{
      story_id: storyId,
      governance_publish_status: "GREEN",
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
    }],
  };
  await fs.outputJson(bridgePath, originalBridge);
  await fs.outputJson(aggregatePath, {
    packages: [{
      story_id: storyId,
      acceptance_entry: {
        story_id: storyId,
        verdict: "RED",
        blockers: ["operator_hold"],
      },
    }],
  });

  const stdout = execFileSync(process.execPath, [
    path.join(root, "tools", "candidate-evidence-reconciliation.js"),
    "--artifact-dir", artifactDir,
    "--story-id", storyId,
    "--bridge", bridgePath,
    "--aggregate", aggregatePath,
    "--out-dir", outDir,
    "--fingerprints-only",
    "--apply",
    "--json",
  ], { cwd: root, encoding: "utf8", timeout: 30_000 });
  const output = JSON.parse(stdout);

  assert.equal(output.report.verdict, "FAIL");
  assert.ok(output.report.authority.blockers.includes("authoritative_aggregate_package_red"));
  assert.equal(output.report.bridge_fingerprints.applied, false);
  assert.deepEqual(await fs.readJson(bridgePath), originalBridge);
  assert.equal(await fs.pathExists(output.report_path), true);
  const markdownPath = path.join(path.dirname(output.report_path), "candidate_evidence_reconciliation_report.md");
  const markdown = await fs.readFile(markdownPath, "utf8");
  assert.match(markdown, /## Authority[\s\S]*publish readiness: RED/);
  assert.match(markdown, /## Current Evidence/);
  assert.match(markdown, /## Remaining Blockers/);
});
