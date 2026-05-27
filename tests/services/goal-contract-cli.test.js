"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildArtefactIndex, main, parseArgs } = require("../../tools/run-goal");

test("run-goal CLI parses workspace and output arguments", () => {
  const args = parseArgs([
    "--root",
    "C:/repo",
    "--out-dir",
    "C:/repo/out",
    "--json",
  ]);

  assert.equal(args.root, "C:/repo");
  assert.equal(args.outDir, "C:/repo/out");
  assert.equal(args.json, true);
});

test("run-goal CLI writes read-only goal contract artefacts from a workspace scan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-root-"));
  const outDir = path.join(root, "goal-out");

  await fs.outputFile(path.join(root, "lib", "public-output-manifest.js"), "");
  await fs.outputFile(path.join(root, "lib", "studio-governance-engine.js"), "");
  await fs.outputFile(
    path.join(root, "tests", "services", "goal-contract-fixture.test.js"),
    [
      "// goal-test:generic_title_rejection",
      "// goal-test:this_gaming_story_rejection",
      "// goal-test:missing_rights_record_rejection",
    ].join("\n"),
  );
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    {
      story_id: "fixture-story",
      verdict: "GREEN",
      artefacts: [
        "canonical_story_manifest.json",
        "script_scorecard.json",
        "footage_inventory.json",
        "rights_ledger.json",
        "director_beat_map.json",
        "render_manifest.json",
        "visual_v4_render.mp4",
        "audio_manifest.json",
        "sfx_manifest.json",
        "captions.srt",
        "platform_publish_manifest.json",
        "x_publish_pack.json",
        "instagram_publish_pack.json",
        "affiliate_link_manifest.json",
        "landing_page_manifest.json",
        "platform_policy_report.json",
        "benchmark_report.json",
        "coherence_report.json",
        "publish_verdict.json",
        "analytics_ingest_plan.json",
      ],
    },
  ]);

  const result = await main([
    "--root",
    root,
    "--out-dir",
    outDir,
    "--generated-at",
    "2026-05-21T19:20:00.000Z",
  ]);

  assert.equal(result.report.goal_id, "pulse_gaming_enterprise_media_os");
  assert.equal(result.report.safety.no_publish_triggered, true);
  assert.equal(result.report.acceptance_30_story_gate.complete_story_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "goal_contract_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal_acceptance_matrix.json")), true);
});

test("run-goal CLI does not count fixture strings as completed goal tests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-root-"));
  const outDir = path.join(root, "goal-out");
  await fs.outputFile(
    path.join(root, "tests", "services", "fixture-only.test.js"),
    "const ids = ['generic_title_rejection', 'dry_run_publishing_mode'];\n",
  );

  const result = await main([
    "--root",
    root,
    "--out-dir",
    outDir,
    "--generated-at",
    "2026-05-21T19:25:00.000Z",
  ]);

  assert.equal(result.report.required_tests_summary.present, 0);
  assert.equal(result.report.required_tests_summary.missing, 24);
});

test("run-goal artefact scanner includes system-only output names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-root-"));
  await fs.outputJson(path.join(root, "output", "proof", "retention_report.json"), {
    ok: true,
  });

  const index = await buildArtefactIndex(root);

  assert.equal(index.retention_report_json || index["retention_report.json"], true);
  assert.equal(index["retention_report.json"], true);
});
