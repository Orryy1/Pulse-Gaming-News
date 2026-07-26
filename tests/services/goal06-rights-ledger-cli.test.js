"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  parseArgs,
} = require("../../tools/goal06-rights-ledger");

test("Goal 06 rights ledger CLI parses package, output and platform arguments", () => {
  const args = parseArgs([
    "--story-packages",
    "packages.json",
    "--out-dir",
    "out",
    "--workspace",
    ".",
    "--platforms",
    "youtube,tiktok,x",
    "--generated-at",
    "2026-05-25T21:04:00.000Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "packages.json");
  assert.equal(args.outDir, "out");
  assert.deepEqual(args.platforms, ["youtube", "tiktok", "x"]);
  assert.equal(args.generatedAt, "2026-05-25T21:04:00.000Z");
  assert.equal(args.json, true);
});

test("Goal 06 rights ledger CLI writes proof reports from a story package manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal06-cli-"));
  const artifactDir = path.join(root, "package", "story-cli");
  const assetSha256 = "c".repeat(64);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-cli",
    selected_title: "Switch 2 Upgrade Path Gets Clearer",
    originality_disclosure_manifest: {
      originality_and_transformation_verdict: "STRONG",
      transformation_evidence: {
        distinct_editorial_claim:
          "Pulse explains what the upgrade path changes for Switch 2 owners.",
        player_facing_conclusion:
          "Players can compare the verified routes before choosing an upgrade.",
        original_analysis_or_comparison:
          "The edit compares the official options and their practical trade-offs.",
        source_footage_meaningfully_restructured: true,
        pulse_context_visible: true,
        visibly_different_from_source: true,
        narrated_source_reading_only: false,
      },
      synthetic_disclosure_required: false,
      reason:
        "The reviewed editorial narration does not depict a realistic synthetic event.",
      operator_decision: "DO_NOT_DISCLOSE",
      youtube_field_value: false,
      reviewed_at: "2026-05-25T20:59:00.000Z",
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    schema_version: 2,
    verdict: "pass",
    used_assets: [
      {
        asset_id: "story-cli-audio",
        kind: "audio",
        path: "output/audio/story-cli.mp3",
        source_type: "local_tts_voice",
        asset_sha256: assetSha256,
      },
    ],
    records: [
      {
        asset_id: "story-cli-audio",
        kind: "audio",
        path: "output/audio/story-cli.mp3",
        source_type: "local_tts_voice",
        licence_basis: "owned_local_voice_model",
        allowed_platforms: ["youtube", "tiktok", "x"],
        commercial_use_allowed: true,
        risk_score: 0.05,
        evidence_file: "rights/local-tts.json",
        asset_sha256: assetSha256,
      },
    ],
  });
  const packagesPath = path.join(root, "packages.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(packagesPath, [{ story_id: "story-cli", artifact_dir: artifactDir }], { spaces: 2 });

  const { report, written } = await main([
    "--story-packages",
    packagesPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--platforms",
    "youtube_shorts,tiktok,x",
    "--generated-at",
    "2026-05-25T21:05:00.000Z",
    "--json",
  ]);

  assert.equal(report.verdict, "PASS");
  assert.deepEqual(report.target_platforms, ["youtube", "tiktok", "x"]);
  assert.equal(report.stories[0].matched_asset_count, 1);
  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(path.join(outDir, "rights_risk_report.json")), true);
  assert.equal((await fs.readJson(path.join(outDir, "rights_ledger.json"))).ready_story_count, 1);
});
