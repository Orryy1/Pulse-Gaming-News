"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildArtefactIndex, main, parseArgs } = require("../../tools/run-goal");

test("run-goal artefact scan handles generated subtrees larger than the V8 spread limit", async () => {
  const root = path.resolve("C:/virtual-pulse-workspace");
  const outputRoot = path.join(root, "output");
  const hugeRoot = path.join(outputRoot, "candidate-supply");
  const testOutputRoot = path.join(root, "test", "output");
  const hugeEntries = Array.from({ length: 140_000 }, (_, index) => {
    const name = index === 139_999 ? "canonical_story_manifest.json" : `candidate-${index}.json`;
    return {
      name,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    };
  });
  const directory = (name) => ({
    name,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  });
  const filesystem = {
    pathExists: async (target) => [outputRoot, hugeRoot, testOutputRoot].includes(path.resolve(target)),
    readdir: async (target) => {
      const resolved = path.resolve(target);
      if (resolved === outputRoot) return [directory("candidate-supply")];
      if (resolved === hugeRoot) return hugeEntries;
      if (resolved === testOutputRoot) return [];
      throw new Error(`unexpected_scan_path:${resolved}`);
    },
  };

  const index = await buildArtefactIndex(root, { filesystem });

  assert.equal(index["canonical_story_manifest.json"], true);
});

test("run-goal CLI parses workspace and output arguments", () => {
  const args = parseArgs([
    "--root",
    "C:/repo",
    "--out-dir",
    "C:/repo/out",
    "--flagship-media-portfolio",
    "C:/repo/flagship-portfolio.json",
    "--json",
  ]);

  assert.equal(args.root, "C:/repo");
  assert.equal(args.outDir, "C:/repo/out");
  assert.equal(args.flagshipMediaPortfolioPath, "C:/repo/flagship-portfolio.json");
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
        "final_av_review.json",
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
  const matrix = await fs.readJson(path.join(outDir, "goal_acceptance_matrix.json"));

  assert.equal(result.report.goal_id, "pulse_gaming_enterprise_media_os");
  assert.equal(result.report.safety.no_publish_triggered, true);
  assert.equal(result.report.acceptance_30_story_gate.package_complete_story_count, 1);
  assert.equal(result.report.acceptance_30_story_gate.complete_story_count, 0);
  assert.equal(result.report.flagship_media_portfolio_gate.status, "blocked");
  assert.equal(result.report.flagship_media_portfolio_gate.portfolio_status, "MISSING");
  assert.deepEqual(
    matrix.flagship_media_portfolio_gate,
    result.report.flagship_media_portfolio_gate,
  );
  assert.equal(await fs.pathExists(path.join(outDir, "goal_contract_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "goal_acceptance_matrix.json")), true);
});

test("run-goal CLI evaluates a supplied raw flagship portfolio manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-root-"));
  const outDir = path.join(root, "goal-out");
  const portfolioPath = path.join(root, "raw-flagship-portfolio.json");
  await fs.outputJson(portfolioPath, {});

  const result = await main([
    "--root",
    root,
    "--out-dir",
    outDir,
    "--flagship-media-portfolio",
    portfolioPath,
    "--generated-at",
    "2026-07-15T14:00:00.000Z",
  ]);

  assert.equal(result.report.flagship_media_portfolio_gate.status, "blocked");
  assert.equal(result.report.flagship_media_portfolio_gate.portfolio_status, "RED");
  assert.ok(
    result.report.flagship_media_portfolio_gate.blocker_codes.includes("required_slot_missing"),
  );
  assert.equal(
    result.report.flagship_media_portfolio_gate.evidence.report_type,
    "flagship_media_portfolio_contract_evaluation",
  );
  assert.equal(
    result.report.flagship_media_portfolio_gate.evidence.generated_at,
    "2026-07-15T14:00:00.000Z",
  );
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
