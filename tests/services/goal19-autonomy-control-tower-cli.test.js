"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal19-autonomy-control-tower");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Horizon 6 Shows Real Footage",
    narration_script: "Xbox showed source-backed footage.",
  });
  await fs.outputJson(path.join(artifactDir, "script_scorecard.json"), { verdict: "pass", failures: [], blockers: [] });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    verdict: "pass",
    failures: [],
    blockers: [],
    motion_asset_count: 6,
    distinct_motion_family_count: 4,
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { verdict: "pass", failures: [] });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    readiness: { status: "ready", blockers: [] },
    shot_plan: [{ id: "hook", kind: "motion_clip" }],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    final_publish_render: true,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    quality_gate_status: "pass",
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), { verdict: "pass", failures: [] });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), { result: "pass", failures: [] });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), { verdict: "pass", publish_blockers: [] });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    disclosure_required: true,
    disclosure_copy: { short: "Affiliate links may earn us a commission." },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "GREEN",
    can_auto_publish: true,
    outputs: { youtube_shorts: { title: "Forza Horizon 6 Shows Real Footage" } },
    governance_gates: {
      anti_spam_uniqueness_gate: { verdict: "pass", failures: [] },
    },
  });
  await fs.outputJson(path.join(artifactDir, "analytics_ingest_plan.json"), {
    dry_run_only: true,
    required_metrics: ["views", "average_view_duration"],
  });
  await fs.outputJson(path.join(artifactDir, "uniqueness_report.json"), { verdict: "pass", failures: [], matches: [] });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), { verdict: "GREEN", can_auto_publish: true, reason_codes: [] });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 19 CLI parses control tower inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-firewall-report",
    "output/goal-18/goal18_readiness_report.json",
    "--out-dir",
    "output/goal-19",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T04:07:13.497Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamFirewallReportPath, "output/goal-18/goal18_readiness_report.json");
  assert.equal(args.outDir, "output/goal-19");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T04:07:13.497Z");
  assert.equal(args.json, true);
});

test("Goal 19 CLI writes control tower artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal18.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["upstream:goal17_platform_policy_engine_blocked"] }],
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-firewall-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T04:07:13.497Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal19_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "publish_verdict.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "risk_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "rejection_reasons.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "approval_requirements.json")), true);
});

test("Goal 19 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal19-autonomy-control-tower"],
    "node tools/goal19-autonomy-control-tower.js",
  );
});
