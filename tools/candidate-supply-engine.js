#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true, override: false });

const {
  buildCandidateSupplyReport,
  formatCandidateSupplyMarkdown,
} = require("../lib/ops/candidate-supply");

const nextCandidates = require("./next-publish-candidates");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "candidate-supply");
const MOTION_CAPACITY_REPORT_NAMES = new Set([
  "studio_v4_source_family_acquisition.json",
  "visual_v4_motion_packs.json",
  "story-packages-motion-repair-eligible.json",
  "real_motion_source_acquisition_work_order.json",
  "fresh_production_refill_repair_report.json",
]);
const DEFAULT_MAX_SUPPLEMENTAL_RUNS_PER_ROOT = 6;

function parseArgs(argv = process.argv) {
  const args = {
    json: false,
    outDir: OUT,
    limit: 30,
    help: false,
    motionCapacityReports: [],
    guardedLiveDispatchExecutorReportPath: path.join(ROOT, "output", "goal-contract", "guarded_live_dispatch_executor_report.json"),
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++i] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (
      arg === "--motion-capacity-report" ||
      arg === "--source-family-acquisition-report" ||
      arg === "--motion-pack-report" ||
      arg === "--source-deficit-report"
    ) {
      const reportPath = argv[++i] || "";
      if (reportPath) args.motionCapacityReports.push(path.resolve(ROOT, reportPath));
    } else if (arg.startsWith("--motion-capacity-report=")) {
      args.motionCapacityReports.push(path.resolve(ROOT, arg.slice("--motion-capacity-report=".length)));
    } else if (arg.startsWith("--source-family-acquisition-report=")) {
      args.motionCapacityReports.push(path.resolve(ROOT, arg.slice("--source-family-acquisition-report=".length)));
    } else if (arg.startsWith("--motion-pack-report=")) {
      args.motionCapacityReports.push(path.resolve(ROOT, arg.slice("--motion-pack-report=".length)));
    } else if (arg.startsWith("--source-deficit-report=")) {
      args.motionCapacityReports.push(path.resolve(ROOT, arg.slice("--source-deficit-report=".length)));
    } else if (arg === "--guarded-live-dispatch-report" || arg === "--executor-report") {
      args.guardedLiveDispatchExecutorReportPath = path.resolve(ROOT, argv[++i] || "");
    } else if (arg.startsWith("--guarded-live-dispatch-report=")) {
      args.guardedLiveDispatchExecutorReportPath = path.resolve(ROOT, arg.slice("--guarded-live-dispatch-report=".length));
    } else if (arg.startsWith("--executor-report=")) {
      args.guardedLiveDispatchExecutorReportPath = path.resolve(ROOT, arg.slice("--executor-report=".length));
    } else if (arg === "--no-guarded-live-dispatch-report" || arg === "--no-executor-report") {
      args.guardedLiveDispatchExecutorReportPath = "";
    }
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 30;
  return args;
}

async function readMotionCapacityReports(reportPaths = []) {
  const reports = [];
  for (const reportPath of reportPaths) {
    if (!reportPath) continue;
    if (!(await fs.pathExists(reportPath))) {
      reports.push({
        rows: [],
        read_error: "motion_capacity_report_not_found",
        path: reportPath,
      });
      continue;
    }
    try {
      const report = await fs.readJson(reportPath);
      reports.push({ ...report, path: report.path || reportPath });
    } catch (err) {
      reports.push({
        rows: [],
        read_error: err.message || "motion_capacity_report_read_failed",
        path: reportPath,
      });
    }
  }
  return reports;
}

function isMotionCapacityReportName(filePath = "") {
  const basename = path.basename(String(filePath || ""));
  return MOTION_CAPACITY_REPORT_NAMES.has(basename) || /_motion_pack_manifest\.json$/i.test(basename);
}

function isCanonicalMotionPackPath(filePath = "") {
  const normalised = path.normalize(String(filePath || "")).toLowerCase();
  return (
    /_motion_pack_manifest\.json$/i.test(path.basename(normalised)) &&
    normalised.includes(`${path.sep}output${path.sep}studio-v4${path.sep}motion-packs${path.sep}`.toLowerCase())
  );
}

function isCanonicalMotionPackSearchRoot(dir = "") {
  const normalised = path.normalize(String(dir || "")).toLowerCase();
  return normalised.endsWith(
    `${path.sep}output${path.sep}studio-v4${path.sep}motion-packs`.toLowerCase(),
  );
}

async function walkMotionCapacityReports(dir, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 8;
  const depth = Number.isFinite(options.depth) ? options.depth : 0;
  if (!dir || depth > maxDepth || !(await fs.pathExists(dir))) return [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkMotionCapacityReports(fullPath, { maxDepth, depth: depth + 1 })));
    } else if (entry.isFile() && isMotionCapacityReportName(fullPath)) {
      try {
        const stat = await fs.stat(fullPath);
        found.push({ path: fullPath, mtimeMs: stat.mtimeMs || 0 });
      } catch {
        found.push({ path: fullPath, mtimeMs: 0 });
      }
    }
  }
  return found;
}

async function discoverRecentSupplementalContractRoots(searchRoot, options = {}) {
  const maxRuns = Math.max(
    1,
    Math.min(
      24,
      Number(
        options.maxSupplementalRunsPerRoot ||
          DEFAULT_MAX_SUPPLEMENTAL_RUNS_PER_ROOT,
      ) || DEFAULT_MAX_SUPPLEMENTAL_RUNS_PER_ROOT,
    ),
  );
  if (!searchRoot || !(await fs.pathExists(searchRoot))) return [];
  if (path.basename(path.normalize(searchRoot)).toLowerCase() === "goal-contract") {
    return [path.normalize(searchRoot)];
  }

  let entries = [];
  try {
    entries = await fs.readdir(searchRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const runRoot = path.join(searchRoot, entry.name);
        const contractRoot =
          entry.name.toLowerCase() === "goal-contract"
            ? runRoot
            : path.join(runRoot, "goal-contract");
        if (!(await fs.pathExists(contractRoot))) return null;
        try {
          const stat = await fs.stat(runRoot);
          return {
            path: path.normalize(contractRoot),
            mtimeMs: stat.mtimeMs || 0,
          };
        } catch {
          return {
            path: path.normalize(contractRoot),
            mtimeMs: 0,
          };
        }
      }),
  );

  return candidates
    .filter(Boolean)
    .sort((a, b) => (b.mtimeMs - a.mtimeMs) || b.path.localeCompare(a.path))
    .slice(0, maxRuns)
    .map((item) => item.path);
}

async function discoverMotionCapacityReportPaths(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const limit = Math.max(1, Math.min(30, Number(options.limit || 12) || 12));
  const searchRoots = Array.isArray(options.searchRoots) && options.searchRoots.length
    ? options.searchRoots.map((item) => path.resolve(root, item))
    : [
        path.join(root, "output", "fresh-green-refill"),
        path.join(root, "output", "candidate-supply", "fresh-production-refill"),
        path.join(root, "output", "studio-v4", "motion-packs"),
      ];

  const canonicalSearchRoots = searchRoots.filter(isCanonicalMotionPackSearchRoot);
  const supplementalSearchRoots = searchRoots.filter(
    (searchRoot) => !isCanonicalMotionPackSearchRoot(searchRoot),
  );
  const found = [];
  for (const searchRoot of canonicalSearchRoots) {
    found.push(...(await walkMotionCapacityReports(searchRoot, { maxDepth: options.maxDepth })));
  }

  const uniqueReports = (items) => {
    const unique = new Map();
    for (const item of items) {
      const normalised = path.normalize(item.path);
      const previous = unique.get(normalised);
      if (!previous || item.mtimeMs > previous.mtimeMs) {
        unique.set(normalised, { ...item, path: normalised });
      }
    }
    return Array.from(unique.values());
  };
  const canonicalFirstPass = uniqueReports(found)
    .filter((item) => isCanonicalMotionPackPath(item.path))
    .sort((a, b) => (b.mtimeMs - a.mtimeMs) || a.path.localeCompare(b.path));
  if (canonicalFirstPass.length >= limit) {
    return canonicalFirstPass.slice(0, limit).map((item) => item.path);
  }

  for (const searchRoot of supplementalSearchRoots) {
    const contractRoots = await discoverRecentSupplementalContractRoots(
      searchRoot,
      options,
    );
    for (const contractRoot of contractRoots) {
      found.push(
        ...(await walkMotionCapacityReports(contractRoot, {
          maxDepth: options.maxDepth,
        })),
      );
    }
  }

  const unique = new Map();
  for (const item of uniqueReports(found)) {
    const normalised = path.normalize(item.path);
    const previous = unique.get(normalised);
    if (!previous || item.mtimeMs > previous.mtimeMs) unique.set(normalised, { ...item, path: normalised });
  }

  const allReports = Array.from(unique.values());
  const canonical = allReports
    .filter((item) => isCanonicalMotionPackPath(item.path))
    .sort((a, b) => (b.mtimeMs - a.mtimeMs) || a.path.localeCompare(b.path));
  const supplemental = allReports
    .filter((item) => !isCanonicalMotionPackPath(item.path))
    .sort((a, b) => (b.mtimeMs - a.mtimeMs) || a.path.localeCompare(b.path));

  return [...canonical, ...supplemental]
    .slice(0, limit)
    .map((item) => item.path);
}

function currentCandidateTranscriptAuditBase(candidateCount, artifactDirCount) {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    execution_mode: "current_scheduler_candidate_transcript_audit",
    summary: {
      total: 0,
      pass: 0,
      rewrite_required: 0,
      viral_verdict_counts: {},
    },
    stories: [],
    scope: {
      candidate_count: candidateCount,
      artifact_dir_count: artifactDirCount,
      historical_backlog_omitted: true,
    },
    safety: {
      local_only: true,
      analysis_only: true,
      no_live_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function resolveCandidateArtifactDir(candidate = {}, root = ROOT) {
  const explicit = [
    candidate.artifact_dir,
    candidate.source?.artifact_dir,
    candidate.current_proof_package?.artifact_dir,
    candidate.scheduler_bridge_artifact_dir,
    candidate.package_dir,
  ].find((value) => typeof value === "string" && value.trim());
  if (explicit) {
    return path.normalize(
      path.isAbsolute(explicit) ? explicit : path.resolve(root, explicit),
    );
  }

  const exportedPath = [
    candidate.exported_path,
    candidate.final_mp4_path,
    candidate.final_render_path,
    candidate.source?.exported_path,
    candidate.source?.final_mp4_path,
    candidate.source?.final_render_path,
  ].find((value) => typeof value === "string" && value.trim());
  if (!exportedPath) return "";
  const resolved = path.isAbsolute(exportedPath)
    ? exportedPath
    : path.resolve(root, exportedPath);
  return path.dirname(path.normalize(resolved));
}

async function buildCurrentCandidateTranscriptAudienceReport({
  candidateReport = {},
  root = ROOT,
  auditGeneratedTranscripts = null,
} = {}) {
  const candidates = Array.isArray(candidateReport?.candidates)
    ? candidateReport.candidates
    : [];
  const artifactDirs = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const artifactDir = resolveCandidateArtifactDir(candidate, root);
    const key = process.platform === "win32"
      ? artifactDir.toLowerCase()
      : artifactDir;
    if (!artifactDir || seen.has(key) || !(await fs.pathExists(artifactDir))) continue;
    seen.add(key);
    artifactDirs.push(artifactDir);
  }
  const base = currentCandidateTranscriptAuditBase(
    candidates.length,
    artifactDirs.length,
  );
  if (!artifactDirs.length) return base;

  const audit = auditGeneratedTranscripts ||
    require("../lib/ops/transcript-audience-audit").auditGeneratedTranscripts;
  const report = await audit({ root, artifactDirs });
  return {
    ...base,
    ...(report || {}),
    execution_mode: base.execution_mode,
    scope: base.scope,
    safety: {
      ...base.safety,
      ...(report?.safety || {}),
    },
  };
}

async function buildFreshCandidateReport({ limit = 30 } = {}) {
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
    mediaHouseQaEnabled: true,
  });
  return { report, stories };
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write([
      "Usage: node tools/candidate-supply-engine.js [--json] [--limit N] [--out-dir DIR]",
      "       [--motion-capacity-report PATH]",
      "       [--source-family-acquisition-report PATH]",
      "       [--motion-pack-report PATH]",
      "       [--source-deficit-report PATH]",
      "       [--guarded-live-dispatch-report PATH]",
      "       [--no-guarded-live-dispatch-report]",
      "",
    ].join("\n"));
    return { exitCode: 0 };
  }

  const channelConfig = require("../channels/pulse-gaming");
  const { report: candidateReport, stories } = await buildFreshCandidateReport({ limit: args.limit });
  let transcriptAudienceReport = null;
  try {
    const { writeTranscriptAudienceAudit } = require("../lib/ops/transcript-audience-audit");
    transcriptAudienceReport = await buildCurrentCandidateTranscriptAudienceReport({
      candidateReport,
      root: ROOT,
    });
    await writeTranscriptAudienceAudit(transcriptAudienceReport, {
      outputDir: path.join(ROOT, "output", "transcript-audience-audit"),
    });
  } catch (err) {
    transcriptAudienceReport = {
      generated_at: new Date().toISOString(),
      summary: { total: 0, pass: 0, rewrite_required: 0 },
      stories: [],
      error: err.message || "transcript_audience_audit_failed",
    };
  }
  const motionCapacityReportPaths = args.motionCapacityReports.length
    ? args.motionCapacityReports
    : await discoverMotionCapacityReportPaths({ root: ROOT });
  const motionCapacityReports = await readMotionCapacityReports(motionCapacityReportPaths);
  const guardedLiveDispatchExecutorReport = await nextCandidates.readOptionalJson(
    args.guardedLiveDispatchExecutorReportPath,
  );
  const report = buildCandidateSupplyReport({
    stories,
    candidateReport,
    transcriptAudienceReport,
    motionCapacityReports,
    guardedLiveDispatchExecutorReport,
    channelConfig,
    now: new Date(),
  });
  const markdown = formatCandidateSupplyMarkdown(report);
  const outDir = args.outDir;
  await fs.ensureDir(outDir);

  await Promise.all([
    fs.writeJson(path.join(outDir, "candidate_supply_report.json"), report, { spaces: 2 }),
    fs.writeFile(path.join(outDir, "candidate_supply_report.md"), markdown, "utf8"),
    fs.writeJson(path.join(outDir, "official_source_watchlist.json"), report.official_source_watchlist, { spaces: 2 }),
    fs.writeJson(path.join(outDir, "fresh_candidate_queue.json"), candidateReport, { spaces: 2 }),
    fs.writeJson(path.join(outDir, "story_priority_scorecard.json"), { generated_at: report.generated_at, scorecards: report.priority_scorecards }, { spaces: 2 }),
    fs.writeJson(path.join(outDir, "dedupe_report.json"), { generated_at: report.generated_at, ...report.dedupe }, { spaces: 2 }),
  ]);

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(markdown);
  if (!args.json || report.verdict === "red") {
    process.stderr.write(`[candidate-supply] out=${path.relative(ROOT, outDir)}\n`);
  }
  if (report.verdict === "red") process.exitCode = 2;
  return { exitCode: process.exitCode || 0, report };
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[candidate-supply] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildCurrentCandidateTranscriptAudienceReport,
  buildFreshCandidateReport,
  discoverMotionCapacityReportPaths,
  main,
  parseArgs,
  readMotionCapacityReports,
};
