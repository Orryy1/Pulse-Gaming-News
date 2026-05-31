#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildOperatorDecisionRecorder,
  renderOperatorDecisionRecorderMarkdown,
  splitList,
  writeOperatorDecisionRecorder,
} = require("../lib/goal-operator-decision-recorder");
const {
  parseFingerprintList,
} = require("../lib/human-review-artefact-fingerprints");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    reviewPacketManifestPath: null,
    operatorDecisionLogPath: null,
    storyId: null,
    operator: null,
    decision: null,
    approvedPlatforms: [],
    rejectedPlatforms: [],
    reviewedArtefacts: [],
    reviewedArtefactFingerprints: {},
    repairRequested: "",
    riskNotes: "",
    decidedAt: null,
    apply: false,
    replaceExisting: false,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--review-packet-manifest") args.reviewPacketManifestPath = argv[++i] || "";
    else if (arg === "--operator-decision-log") args.operatorDecisionLogPath = argv[++i] || "";
    else if (arg === "--story" || arg === "--story-id") args.storyId = argv[++i] || "";
    else if (arg === "--operator") args.operator = argv[++i] || "";
    else if (arg === "--decision") args.decision = argv[++i] || "";
    else if (arg === "--approved-platforms") args.approvedPlatforms.push(...splitList(argv[++i] || ""));
    else if (arg === "--approved-platform") args.approvedPlatforms.push(argv[++i] || "");
    else if (arg === "--rejected-platforms") args.rejectedPlatforms.push(...splitList(argv[++i] || ""));
    else if (arg === "--rejected-platform") args.rejectedPlatforms.push(argv[++i] || "");
    else if (arg === "--reviewed-artefacts" || arg === "--reviewed-artifacts") {
      args.reviewedArtefacts.push(...splitList(argv[++i] || ""));
    } else if (arg === "--reviewed-artefact" || arg === "--reviewed-artifact") {
      args.reviewedArtefacts.push(argv[++i] || "");
    } else if (
      arg === "--reviewed-artefact-fingerprints" ||
      arg === "--reviewed-artifact-fingerprints"
    ) {
      args.reviewedArtefactFingerprints = {
        ...args.reviewedArtefactFingerprints,
        ...parseFingerprintList(argv[++i] || ""),
      };
    } else if (arg === "--repair-requested") args.repairRequested = argv[++i] || "";
    else if (arg === "--risk-notes") args.riskNotes = argv[++i] || "";
    else if (arg === "--decided-at") args.decidedAt = argv[++i] || "";
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--replace-existing") args.replaceExisting = true;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-record-operator-decision -- [options]",
    "",
    "Options:",
    "  --review-packet-manifest <path>    review_packet_manifest.json",
    "  --operator-decision-log <path>     operator_decision_log.json",
    "  --story <id>                       Story id",
    "  --operator <name>                  Operator name",
    "  --decision <value>                 approve_enabled_platforms | reject | request_repairs",
    "  --approved-platforms <csv>         Enabled platforms approved after review",
    "  --reviewed-artefacts <csv>         Reviewed artefact keys or paths",
    "  --reviewed-artefact-fingerprints <csv>",
    "                                    key=sha256:<hash> entries from the review index",
    "  --risk-notes <text>                Short review note for approvals",
    "  --apply                            Write operator_decision_log.json after validation",
    "  --replace-existing                 Replace an existing decision for the story",
    "  --json                             Print JSON",
    "",
    "Dry-run is the default. This command never publishes, mutates DB rows or touches OAuth/token settings.",
  ].join("\n");
}

async function readJson(filePath, label) {
  if (!await fs.pathExists(filePath)) throw new Error(`${label} not found: ${filePath}`);
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const reviewPacketManifestPath = args.reviewPacketManifestPath
    ? path.resolve(root, args.reviewPacketManifestPath)
    : path.join(root, "output", "goal-contract", "review_packet_manifest.json");
  const operatorDecisionLogPath = args.operatorDecisionLogPath
    ? path.resolve(root, args.operatorDecisionLogPath)
    : path.join(root, "output", "goal-contract", "operator_decision_log.json");
  const generatedAt = args.generatedAt || new Date().toISOString();
  const report = buildOperatorDecisionRecorder({
    reviewPacketManifest: await readJson(reviewPacketManifestPath, "review packet manifest"),
    operatorDecisionLog: await readJson(operatorDecisionLogPath, "operator decision log"),
    operatorDecisionLogPath,
    decisionInput: {
      story_id: args.storyId,
      operator: args.operator,
      decision: args.decision,
      approved_platforms: args.approvedPlatforms,
      rejected_platforms: args.rejectedPlatforms,
      repair_requested: args.repairRequested,
      reviewed_artefacts: args.reviewedArtefacts,
      reviewed_artefact_fingerprints: args.reviewedArtefactFingerprints,
      risk_acceptance_notes: args.riskNotes,
      decided_at: args.decidedAt || generatedAt,
    },
    apply: args.apply,
    replaceExisting: args.replaceExisting,
    generatedAt,
  });
  const artefacts = await writeOperatorDecisionRecorder(report, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderOperatorDecisionRecorderMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-operator-decision-recorder] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};
