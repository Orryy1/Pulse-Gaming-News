#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  ENABLED_PLATFORMS,
  reconcileCandidateEvidence,
} = require("../lib/candidate-evidence-reconciliation");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    artifactDir: "",
    storyId: "",
    bridgePath: path.join(ROOT, "output", "goal-contract", "scheduler_bridge_candidates.json"),
    aggregatePaths: [],
    outDir: path.join(ROOT, "output", "candidate-evidence-reconciliation"),
    targetPlatforms: [...ENABLED_PLATFORMS],
    repairRights: true,
    repairBridgeFingerprints: true,
    repairLineageHashes: false,
    apply: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifact-dir") args.artifactDir = argv[++index] || "";
    else if (arg.startsWith("--artifact-dir=")) args.artifactDir = arg.slice("--artifact-dir=".length);
    else if (arg === "--story-id") args.storyId = argv[++index] || "";
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length);
    else if (arg === "--bridge") args.bridgePath = argv[++index] || args.bridgePath;
    else if (arg.startsWith("--bridge=")) args.bridgePath = arg.slice("--bridge=".length);
    else if (arg === "--aggregate") args.aggregatePaths.push(argv[++index] || "");
    else if (arg.startsWith("--aggregate=")) args.aggregatePaths.push(arg.slice("--aggregate=".length));
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice("--out-dir=".length);
    else if (arg === "--platforms") {
      args.targetPlatforms = String(argv[++index] || "").split(",").map((value) => value.trim()).filter(Boolean);
    } else if (arg.startsWith("--platforms=")) {
      args.targetPlatforms = arg.slice("--platforms=".length).split(",").map((value) => value.trim()).filter(Boolean);
    } else if (arg === "--rights-only") {
      args.repairRights = true;
      args.repairBridgeFingerprints = false;
      args.repairLineageHashes = false;
    } else if (arg === "--no-bridge-sync") {
      args.bridgePath = "";
    } else if (arg === "--fingerprints-only") {
      args.repairRights = false;
      args.repairBridgeFingerprints = true;
      args.repairLineageHashes = false;
    } else if (arg === "--lineage-only") {
      args.repairRights = false;
      args.repairBridgeFingerprints = false;
      args.repairLineageHashes = true;
    } else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.help && !args.targetPlatforms.length) {
    throw new Error("--platforms requires at least one platform key");
  }
  if (!args.help && !args.bridgePath && args.repairBridgeFingerprints) {
    throw new Error("--no-bridge-sync requires --rights-only");
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/candidate-evidence-reconciliation.js --artifact-dir <dir> --story-id <id> [options]",
    "",
    "Validates and optionally repairs local used-asset rights evidence and bridge audio/timestamp fingerprints.",
    "It never publishes, never mutates the database and never changes OAuth, tokens or platform settings.",
    "Authoritative RED/AMBER publish fields are preserved.",
    "",
    "Options:",
    "  --bridge <path>          Scheduler bridge candidate JSON",
    "  --aggregate <path>       Authoritative story-package aggregate JSON (repeatable)",
    "  --platforms <keys>       Comma-separated rights platform keys",
    "  --out-dir <path>         Proof output directory",
    "  --rights-only            Reconcile used-asset rights only",
    "  --lineage-only           Bind current audio, timestamps and captions to the render fingerprint",
    "  --no-bridge-sync         Keep a rights-only repair local when no bridge candidate exists",
    "  --fingerprints-only      Reconcile bridge fingerprints only",
    "  --apply                  Write backed-up local artefact repairs",
    "  --json                   Print the machine-readable report",
  ].join("\n");
}

function markdown(report = {}) {
  const lines = [
    "# Candidate Evidence Reconciliation",
    "",
    `Story: ${report.story_id || "unknown"}`,
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "UNKNOWN"}`,
    `Publish readiness: ${report.publish_readiness || "UNCHANGED"}`,
    `Mode: ${report.mode || "LOCAL_PROOF"}`,
    "",
    "## Authority",
    `- verdict: ${report.authority?.verdict || "UNKNOWN"}`,
    `- publish readiness: ${report.authority?.publish_readiness || "UNCHANGED"}`,
    `- blockers: ${(report.authority?.blockers || []).join(", ") || "none"}`,
    "",
    "## Rights",
    `- verdict: ${report.rights?.verdict || "SKIPPED"}`,
    `- used assets: ${report.rights?.used_asset_count ?? 0}`,
    `- reconciled records: ${report.rights?.reconciled_record_count ?? 0}`,
    `- duplicates before: ${report.rights?.duplicate_record_count_before ?? 0}`,
    `- duplicates after: ${report.rights?.duplicate_record_count_after ?? 0}`,
    `- blockers: ${(report.rights?.blockers || []).join(", ") || "none"}`,
    "",
    "## Bridge Fingerprints",
    `- verdict: ${report.bridge_fingerprints?.verdict || "SKIPPED"}`,
    `- same-run verified: ${report.bridge_fingerprints?.same_run_verified === true ? "yes" : "no"}`,
    `- changed: ${report.bridge_fingerprints?.changed === true ? "yes" : "no"}`,
    `- blockers: ${(report.bridge_fingerprints?.blockers || []).join(", ") || "none"}`,
    "",
    "## Lineage Hashes",
    `- verdict: ${report.lineage_hashes?.verdict || "SKIPPED"}`,
    `- same-run verified: ${report.lineage_hashes?.same_run_verified === true ? "yes" : "no"}`,
    `- changed: ${report.lineage_hashes?.changed === true ? "yes" : "no"}`,
    `- blockers: ${(report.lineage_hashes?.blockers || []).join(", ") || "none"}`,
    "",
    "## Current Evidence",
    `- verdict: ${report.current_evidence?.verdict || "UNKNOWN"}`,
    `- reconciled: ${report.current_evidence?.reconciled === true ? "yes" : "no"}`,
    `- same-run verified: ${report.current_evidence?.same_run_verified === true ? "yes" : "no"}`,
    `- final render decodable: ${report.current_evidence?.final_render_decodable === true ? "yes" : "no"}`,
    `- rights complete: ${report.current_evidence?.rights_complete === true ? "yes" : "no"}`,
    `- publish readiness: ${report.current_evidence?.publish_readiness || "RED"}`,
    `- GREEN eligible: ${report.current_evidence?.green_eligible === true ? "yes" : "no"}`,
    `- evidence blockers: ${(report.current_evidence?.blockers || []).join(", ") || "none"}`,
    `- publish blockers: ${(report.current_evidence?.publish_blockers || []).join(", ") || "none"}`,
    "",
    "## Remaining Blockers",
    ...(
      (report.remaining_blockers || []).length
        ? report.remaining_blockers.map((blocker) => `- ${blocker}`)
        : ["- none"]
    ),
    "",
    "## Safety",
    "No publishing, DB mutation, OAuth/token changes or authoritative verdict promotion occurred.",
  ];
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  if (!args.artifactDir) throw new Error("--artifact-dir is required");
  if (!args.storyId) throw new Error("--story-id is required");
  const report = await reconcileCandidateEvidence({
    artifactDir: path.resolve(ROOT, args.artifactDir),
    bridgePath: args.bridgePath ? path.resolve(ROOT, args.bridgePath) : "",
    aggregatePaths: args.aggregatePaths.filter(Boolean).map((filePath) => path.resolve(ROOT, filePath)),
    storyId: args.storyId,
    repairRights: args.repairRights,
    repairBridgeFingerprints: args.repairBridgeFingerprints,
    repairLineageHashes: args.repairLineageHashes,
    apply: args.apply,
    targetPlatforms: args.targetPlatforms,
  });
  const outDir = path.resolve(ROOT, args.outDir, args.storyId);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, "candidate_evidence_reconciliation_report.json");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeFile(
    path.join(outDir, "candidate_evidence_reconciliation_report.md"),
    markdown(report),
    "utf8",
  );
  if (args.json) console.log(JSON.stringify({ report, report_path: reportPath }, null, 2));
  else console.log(markdown(report).trimEnd());
  return { report, reportPath };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[candidate-evidence-reconciliation] FAILED: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  markdown,
  parseArgs,
  usage,
};
