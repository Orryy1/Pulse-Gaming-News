#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true });

const db = require("../lib/db");
const { buildQueueReport } = require("../lib/ops/queue-inspect");
const { buildPublishCadenceReportFromDb } = require("../lib/ops/publish-cadence");
const { buildPublishReadinessReport } = require("../lib/ops/publish-readiness");
const {
  buildRuntimeOwnershipSentinelFromEnvironment,
} = require("../lib/ops/runtime-ownership-sentinel");
const {
  selectNextGuardedLiveAction,
} = require("../lib/goal-guarded-live-dispatch-executor");
const {
  buildGuardedDispatchEvidenceReconciliationReport,
  formatGuardedDispatchEvidenceReconciliationMarkdown,
} = require("../lib/ops/guarded-dispatch-evidence-reconciliation");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "output", "guarded-dispatch-evidence-reconciliation");

function parseArgs(argv) {
  const args = {
    json: false,
    outDir: DEFAULT_OUT,
    storyId: "1s4j81q",
    actionId: "1s4j81q:youtube_shorts",
    expectedYoutubeId: "U4XB3MEaCg0",
    poisonStoryId: "1s49ty7",
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++i] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    else if (arg === "--story-id") args.storyId = argv[++i] || args.storyId;
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length);
    else if (arg === "--action-id") args.actionId = argv[++i] || args.actionId;
    else if (arg.startsWith("--action-id=")) args.actionId = arg.slice("--action-id=".length);
    else if (arg === "--youtube-id") args.expectedYoutubeId = argv[++i] || args.expectedYoutubeId;
    else if (arg.startsWith("--youtube-id=")) args.expectedYoutubeId = arg.slice("--youtube-id=".length);
    else if (arg === "--poison-story-id") args.poisonStoryId = argv[++i] || args.poisonStoryId;
    else if (arg.startsWith("--poison-story-id=")) args.poisonStoryId = arg.slice("--poison-story-id=".length);
  }
  return args;
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

function listPlatformPosts(sqlite) {
  try {
    return sqlite.prepare("SELECT * FROM platform_posts ORDER BY updated_at DESC, id DESC").all();
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const sqlite = db.getDb();
  const stories = await db.getStories();
  const story = stories.find((item) => item.id === args.storyId) || null;
  const platformRows = listPlatformPosts(sqlite);
  const executorPlanPath = path.join(ROOT, "output", "goal-contract", "guarded_dispatch_executor_plan.json");
  const executorPlan = await readJsonIfExists(executorPlanPath);
  const selector = await selectNextGuardedLiveAction({
    executorPlan,
    stories,
    allowedPlatforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
  });

  const [runtimeSentinel, queueInspect, publishCadence, publishReadiness] = await Promise.all([
    buildRuntimeOwnershipSentinelFromEnvironment(),
    buildQueueReport(),
    buildPublishCadenceReportFromDb({ db: sqlite, windowHours: 24 }),
    buildPublishReadinessReport({ root: ROOT }),
  ]);

  const report = buildGuardedDispatchEvidenceReconciliationReport({
    story,
    stories,
    platformRows,
    selector,
    runtimeSentinel,
    queueInspect,
    publishCadence,
    publishReadiness,
    storyId: args.storyId,
    actionId: args.actionId,
    expectedYoutubeId: args.expectedYoutubeId,
    poisonStoryId: args.poisonStoryId,
  });

  await fs.ensureDir(args.outDir);
  await fs.writeJson(
    path.join(args.outDir, "guarded_dispatch_evidence_reconciliation.json"),
    report,
    { spaces: 2 },
  );
  await fs.writeFile(
    path.join(args.outDir, "guarded_dispatch_evidence_reconciliation.md"),
    formatGuardedDispatchEvidenceReconciliationMarkdown(report),
  );
  await fs.writeJson(
    path.join(args.outDir, "partial_youtube_evidence_report.json"),
    report.partial_youtube_evidence,
    { spaces: 2 },
  );
  await fs.writeJson(
    path.join(args.outDir, "poison_action_terminal_state_report.json"),
    report.poison_action_terminal_state,
    { spaces: 2 },
  );
  await fs.writeJson(
    path.join(args.outDir, "next_window_scheduler_verification.json"),
    report.next_window_scheduler_verification,
    { spaces: 2 },
  );
  await fs.writeJson(
    path.join(args.outDir, "platform_posts_integrity_report.json"),
    report.platform_posts_integrity,
    { spaces: 2 },
  );

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[guarded-dispatch-reconcile] verdict=${report.verdict}`);
    console.log(`[guarded-dispatch-reconcile] out=${args.outDir}`);
  }
}

main().catch((err) => {
  console.error(`[guarded-dispatch-reconcile] FAILED: ${err.stack || err.message}`);
  process.exit(1);
});
