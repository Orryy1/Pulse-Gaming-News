#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true, override: true });

const {
  buildCandidateSupplyReport,
  formatCandidateSupplyMarkdown,
} = require("../lib/ops/candidate-supply");

const nextCandidates = require("./next-publish-candidates");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "candidate-supply");

function parseArgs(argv = process.argv) {
  const args = { json: false, outDir: OUT, limit: 30, help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++i] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 30;
  return args;
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
  });
  return { report, stories };
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write("Usage: node tools/candidate-supply-engine.js [--json] [--limit N] [--out-dir DIR]\n");
    return { exitCode: 0 };
  }

  const channelConfig = require("../channels/pulse-gaming");
  const { report: candidateReport, stories } = await buildFreshCandidateReport({ limit: args.limit });
  let transcriptAudienceReport = null;
  try {
    const {
      auditGeneratedTranscripts,
      writeTranscriptAudienceAudit,
    } = require("../lib/ops/transcript-audience-audit");
    transcriptAudienceReport = await auditGeneratedTranscripts({ root: ROOT });
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
  const report = buildCandidateSupplyReport({
    stories,
    candidateReport,
    transcriptAudienceReport,
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
  process.stderr.write(`[candidate-supply] out=${path.relative(ROOT, outDir)}\n`);
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
  buildFreshCandidateReport,
  main,
  parseArgs,
};
