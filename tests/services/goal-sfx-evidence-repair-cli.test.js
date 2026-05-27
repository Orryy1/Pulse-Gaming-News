"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArgs } = require("../../tools/goal-sfx-evidence-repair");

test("goal SFX evidence repair CLI writes a local-only report", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-repair-cli-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-one");
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "story-one", artifact_dir: artifactDir },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_source_plan.json"), {
    readiness: { status: "pass", blockers: [] },
    selected_assets: [
      {
        asset_id: "sonniss-impact-01",
        role: "impact",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/impact.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
      },
    ],
  });
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"), {
    records: [{ asset_id: "sonniss-impact-01", asset_type: "sfx" }],
  });
  await fs.ensureDir(artifactDir);

  const { report, outputs } = await main([
    "--root",
    root,
    "--out-dir",
    path.join(root, "out"),
    "--generated-at",
    "2026-05-23T19:50:00.000Z",
  ]);

  assert.equal(report.summary.repaired_count, 1);
  assert.equal(report.safety.no_network_uploads, true);
  assert.equal(await fs.pathExists(outputs.jsonPath), true);
  assert.equal(await fs.pathExists(path.join(artifactDir, "sfx_manifest.json")), true);
});

test("goal SFX evidence repair CLI parses safe controls", () => {
  const args = parseArgs([
    "--root",
    "C:/repo",
    "--story-packages",
    "out/story-packages.json",
    "--sfx-source-plan",
    "out/sfx_source_plan.json",
    "--sfx-rights-ledger",
    "out/sfx_rights_ledger.json",
    "--dry-run",
    "--json",
  ]);

  assert.equal(args.root, "C:/repo");
  assert.equal(args.storyPackagesPath, "out/story-packages.json");
  assert.equal(args.sfxSourcePlanPath, "out/sfx_source_plan.json");
  assert.equal(args.sfxRightsLedgerPath, "out/sfx_rights_ledger.json");
  assert.equal(args.dryRun, true);
  assert.equal(args.json, true);
});
