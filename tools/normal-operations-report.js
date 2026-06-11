#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true, override: true });

const {
  buildSchedulerWindowReadiness,
  buildNormalOperationsReport,
  formatNormalOperationsMarkdown,
  formatSchedulerWindowReadinessMarkdown,
} = require("../lib/ops/normal-operations");
const {
  buildPublishReadinessReport,
} = require("../lib/ops/publish-readiness");
const { buildQueueReport } = require("../lib/ops/queue-inspect");
const { buildPublishCadenceReportFromDb } = require("../lib/ops/publish-cadence");
const { buildLocalRestartReadiness } = require("../lib/ops/local-restart-readiness");
const { selectNextGuardedLiveAction } = require("../lib/goal-guarded-live-dispatch-executor");
const nextCandidates = require("./next-publish-candidates");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "output", "normal-operations");

function parseArgs(argv) {
  const args = { json: false, hours: 72, outDir: DEFAULT_OUT, help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--hours") {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value > 0) args.hours = value;
    } else if (arg.startsWith("--hours=")) {
      const value = Number(arg.slice("--hours=".length));
      if (Number.isFinite(value) && value > 0) args.hours = value;
    } else if (arg === "--out-dir") {
      args.outDir = path.resolve(ROOT, argv[++i] || args.outDir);
    } else if (arg.startsWith("--out-dir=")) {
      args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    }
  }
  return args;
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function buildGuardedSelection() {
  const planPath = path.join(ROOT, "output", "goal-contract", "guarded_dispatch_executor_plan.json");
  if (!(await fs.pathExists(planPath))) return null;
  try {
    const db = require("../lib/db");
    const [executorPlan, stories] = await Promise.all([
      fs.readJson(planPath),
      db.getStories(),
    ]);
    return selectNextGuardedLiveAction({ executorPlan, stories });
  } catch (err) {
    return {
      exhausted: true,
      action_id: null,
      error: err.message,
      skipped_actions: [],
    };
  }
}

async function buildFreshCandidateReport({ limit = 20 } = {}) {
  const db = require("../lib/db");
  const [
    stories,
    bridgeManifest,
    directVideoEnrichmentWorkOrder,
    sourceFamilyAcquisitionReport,
    upstreamBenchmarkReport,
    upstreamAntiSpamReport,
  ] = await Promise.all([
    db.getStories(),
    nextCandidates.readBridgeCandidateManifest(nextCandidates.DEFAULT_BRIDGE_CANDIDATES_PATH),
    nextCandidates.readOptionalJson(nextCandidates.DEFAULT_DIRECT_VIDEO_ENRICHMENT_WORK_ORDER_PATH),
    nextCandidates.readOptionalJson(nextCandidates.DEFAULT_SOURCE_FAMILY_ACQUISITION_REPORT_PATH),
    nextCandidates.readOptionalJson(nextCandidates.DEFAULT_UPSTREAM_BENCHMARK_REPORT_PATH),
    nextCandidates.readOptionalJson(nextCandidates.DEFAULT_UPSTREAM_ANTI_SPAM_REPORT_PATH),
  ]);
  const selected = nextCandidates.selectCandidateSourceStories({
    liveStories: stories,
    bridgeCandidates: bridgeManifest.candidates,
    bridgeManifest,
  });
  const report = nextCandidates.buildNextPublishCandidatesReport(selected.stories, {
    limit,
    bridgeManifest: selected.bridge_manifest,
    upstreamAntiSpamReport,
  });
  await nextCandidates.attachPreflightQa(report, selected.stories, {
    bridgeMotionGovernanceEvidence: {
      directVideoEnrichmentWorkOrder,
      sourceFamilyAcquisitionReport,
    },
    upstreamBenchmarkReport,
  });
  return report;
}

function candidateBufferReport(report) {
  return report.layers?.candidate_buffer || {};
}

function postWindowReport(report) {
  return report.layers?.post_window_verification || {};
}

function nextDayPlan(report) {
  return {
    generated_at: report.generated_at,
    posture: report.operating_posture,
    next_safe_publish_at_utc: report.layers?.post_window_verification?.next_safe_publish_at_utc || null,
    publish_readiness: report.layers?.publish_readiness?.verdict || "unknown",
    candidate_buffer: report.layers?.candidate_buffer?.verdict || "unknown",
    guarded_next_action: report.guarded_selection?.action_id || null,
    recommended_actions: report.next_actions || [],
    do_not_touch: [
      "Do not stop the primary runtime or Cloudflare tunnel during a publish window.",
      "Do not enable TikTok, X, Threads or Pinterest from this report.",
      "Do not mutate OAuth, tokens, credentials or billing.",
      "Do not bypass dry-run or guarded dispatch gates.",
    ],
  };
}

function formatCandidateBufferMarkdown(report = {}) {
  const lines = [
    "# Candidate Buffer Report",
    "",
    `Verdict: ${String(report.verdict || "unknown").toUpperCase()}`,
    `Ready: ${report.counts?.ready_candidates ?? 0}/${report.targets?.ready_candidates ?? 0}`,
    `Source-safe: ${report.counts?.source_safe_candidates ?? 0}/${report.targets?.source_safe_candidates ?? 0}`,
    `V4-ready: ${report.counts?.v4_ready_candidates ?? 0}/${report.targets?.v4_ready_candidates ?? 0}`,
    `Pending audio: ${report.counts?.pending_audio ?? 0}`,
    "",
    "## Top Candidates",
    "",
  ];
  for (const item of report.top_candidates || []) {
    lines.push(`- ${item.id}: ${item.title} (${item.score})`);
  }
  if (!report.top_candidates?.length) lines.push("- none");
  lines.push("", `Next action: ${report.next_action || "none"}`, "");
  return lines.join("\n");
}

function formatPostWindowMarkdown(report = {}) {
  const latest = report.latest_public_post || {};
  return [
    "# Post Window Verification",
    "",
    `Verdict: ${String(report.verdict || "unknown").toUpperCase()}`,
    `Latest post: ${latest.id || "none"}`,
    `Published at: ${latest.published_at || "unknown"}`,
    `Platforms: ${(latest.platforms || []).join(", ") || "none"}`,
    `Latest age hours: ${report.latest_publish_age_hours ?? "unknown"}`,
    `Publish jobs seen: ${report.publish_jobs_seen ?? 0}`,
    `Next safe publish UTC: ${report.next_safe_publish_at_utc || "unknown"}`,
    `Blockers: ${(report.blockers || []).join("; ") || "none"}`,
    `Advisory: ${(report.advisory || []).join("; ") || "none"}`,
    "",
  ].join("\n");
}

function formatNextDayPlanMarkdown(plan = {}) {
  const lines = [
    "# Next Publish Day Plan",
    "",
    `Posture: ${plan.posture || "unknown"}`,
    `Next safe publish UTC: ${plan.next_safe_publish_at_utc || "unknown"}`,
    `Readiness: ${String(plan.publish_readiness || "unknown").toUpperCase()}`,
    `Candidate buffer: ${String(plan.candidate_buffer || "unknown").toUpperCase()}`,
    `Guarded next action: ${plan.guarded_next_action || "none"}`,
    "",
    "## Recommended Actions",
    "",
  ];
  for (const action of plan.recommended_actions || []) lines.push(`- ${action}`);
  lines.push("", "## Do Not Touch", "");
  for (const item of plan.do_not_touch || []) lines.push(`- ${item}`);
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write("Usage: node tools/normal-operations-report.js [--hours N] [--out-dir DIR] [--json]\n");
    return;
  }

  const outDir = args.outDir;
  await fs.ensureDir(outDir);

  const [
    readinessReport,
    queueReport,
    cadenceReport,
    platformReport,
    candidateReport,
    guardedSelection,
  ] = await Promise.all([
    buildPublishReadinessReport(),
    buildQueueReport(),
    buildPublishCadenceReportFromDb({ windowHours: args.hours }),
    readJsonIfExists(path.join(ROOT, "test", "output", "platform_readiness_doctor.json")),
    buildFreshCandidateReport({ limit: 20 }).catch(() =>
      readJsonIfExists(path.join(ROOT, "test", "output", "next_publish_candidates.json")),
    ),
    buildGuardedSelection(),
  ]);
  const localRestartReport = await buildLocalRestartReadiness({ cwd: ROOT, cadenceReport });

  const report = buildNormalOperationsReport({
    readinessReport,
    queueReport,
    cadenceReport,
    localRestartReport,
    platformReport,
    candidateReport,
    guardedSelection,
  });
  const markdown = formatNormalOperationsMarkdown(report);
  const candidate = candidateBufferReport(report);
  const postWindow = postWindowReport(report);
  const plan = nextDayPlan(report);
  const schedulerWindow = buildSchedulerWindowReadiness(report);

  await Promise.all([
    fs.writeJson(path.join(outDir, "normal_operations_report.json"), report, { spaces: 2 }),
    fs.writeFile(path.join(outDir, "normal_operations_report.md"), markdown, "utf8"),
    fs.writeJson(path.join(outDir, "fresh_candidate_queue.json"), candidateReport, { spaces: 2 }),
    fs.writeJson(path.join(outDir, "candidate_buffer_report.json"), candidate, { spaces: 2 }),
    fs.writeFile(path.join(outDir, "candidate_buffer_report.md"), formatCandidateBufferMarkdown(candidate), "utf8"),
    fs.writeJson(path.join(outDir, "runtime_ownership_status.json"), report.layers?.runtime_ownership || {}, { spaces: 2 }),
    fs.writeJson(path.join(outDir, "post_window_verification.json"), postWindow, { spaces: 2 }),
    fs.writeFile(path.join(outDir, "post_window_verification.md"), formatPostWindowMarkdown(postWindow), "utf8"),
    fs.writeJson(path.join(outDir, "scheduler_window_readiness.json"), schedulerWindow, { spaces: 2 }),
    fs.writeFile(path.join(outDir, "scheduler_window_readiness.md"), formatSchedulerWindowReadinessMarkdown(schedulerWindow), "utf8"),
    fs.writeJson(path.join(outDir, "next_day_publish_plan.json"), plan, { spaces: 2 }),
    fs.writeFile(path.join(outDir, "next_day_publish_plan.md"), formatNextDayPlanMarkdown(plan), "utf8"),
  ]);

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`${markdown}\n`);
    process.stderr.write(`[normal-operations] out=${path.relative(ROOT, outDir)}\n`);
  }

  if (report.overall_verdict === "red") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[normal-operations] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  candidateBufferReport,
  formatCandidateBufferMarkdown,
  formatNextDayPlanMarkdown,
  formatPostWindowMarkdown,
  nextDayPlan,
  parseArgs,
  postWindowReport,
};
