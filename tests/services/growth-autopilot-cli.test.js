"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
const {
  buildPublishedYouTubeSnapshot,
  main,
  parseArgs,
} = require("../../tools/growth-autopilot");

test("growth autopilot CLI parses a bounded snapshot run", () => {
  const args = parseArgs([
    "--snapshot",
    "snapshot.json",
    "--out-dir",
    "output/growth-autopilot",
    "--generated-at",
    "2026-07-23T20:00:00.000Z",
    "--json",
  ]);

  assert.equal(args.snapshotPath, "snapshot.json");
  assert.equal(args.outDir, "output/growth-autopilot");
  assert.equal(args.generatedAt, "2026-07-23T20:00:00.000Z");
  assert.equal(args.json, true);
});

test("growth autopilot writes correlated machine-readable control artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-growth-autopilot-"));
  const snapshotPath = path.join(root, "snapshot.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(snapshotPath, {
    generated_at: "2026-07-23T20:00:00.000Z",
    channel_id: "pulse-gaming",
    channel: { latest_post_at: "2026-07-19T10:00:00.000Z" },
    weekly_cohorts: [{ week_start: "2026-07-06", posts: 7, median_views: 587 }],
    pipeline: {
      scheduler_candidate_count: 0,
      publish_readiness: { verdict: "RED", blockers: ["runtime_commit_drift"] },
      control_tower: { verdict: "RED" },
      platforms: { youtube: { enabled: true }, x: { enabled: false } },
    },
  });

  const result = await main([
    "--snapshot",
    snapshotPath,
    "--out-dir",
    outDir,
    "--generated-at",
    "2026-07-23T20:00:00.000Z",
  ]);

  const report = await fs.readJson(path.join(outDir, "growth_autopilot_report.json"));
  const workOrders = await fs.readJson(path.join(outDir, "growth_work_orders.json"));
  const experiments = await fs.readJson(path.join(outDir, "growth_experiment_registry.json"));
  const markdown = await fs.readFile(path.join(outDir, "growth_autopilot_report.md"), "utf8");

  assert.equal(result.report.growth_phase, "cadence_recovery");
  assert.equal(workOrders.work_orders[0].work_order_id, report.work_orders[0].work_order_id);
  assert.equal(experiments.experiments[0].experiment_id, report.experiments[0].experiment_id);
  assert.match(markdown, /No uploads or external posts were triggered/i);
});

test("growth autopilot operator command is registered", () => {
  assert.equal(packageJson.scripts["ops:growth-autopilot"], "node tools/growth-autopilot.js");
});

test("live publication rows become deterministic weekly growth cohorts", () => {
  const snapshot = buildPublishedYouTubeSnapshot([
    { published_at: "2026-07-06T09:00:00.000Z", views: 100 },
    { published_at: "2026-07-07T09:00:00.000Z", views: 500 },
    { published_at: "2026-07-13T09:00:00.000Z", views: 900 },
  ], {
    now: "2026-07-23T20:00:00.000Z",
  });

  assert.equal(snapshot.latest_post_at, "2026-07-13T09:00:00.000Z");
  assert.equal(snapshot.views_28d, 1500);
  assert.deepEqual(snapshot.weekly_cohorts, [
    {
      week_start: "2026-07-06",
      posts: 2,
      views: 600,
      median_views: 300,
      subscribers_gained: null,
    },
    {
      week_start: "2026-07-13",
      posts: 1,
      views: 900,
      median_views: 900,
      subscribers_gained: null,
    },
  ]);
});

test("growth sidecar is a hidden read-only bridge until the protected runtime cutover", async () => {
  const scriptPath = path.resolve(
    __dirname,
    "..",
    "..",
    "scripts",
    "task-scheduler",
    "pulse-growth-autopilot.ps1",
  );
  const script = await fs.readFile(scriptPath, "utf8");

  assert.match(script, /tools[\\/]growth-autopilot\.js/i);
  assert.match(script, /WindowStyle\s+Hidden/i);
  assert.doesNotMatch(script, /\b(?:publish|upload|oauth|token)\b/i);
});
