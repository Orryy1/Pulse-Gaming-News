#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true });

const {
  applyRightsLedgerRepair,
  buildFootageEmpireV2Report,
  buildRightsLedgerRepair,
  formatFootageEmpireV2Markdown,
} = require("../lib/ops/footage-empire-v2");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const DEFAULT_OUT = path.join(ROOT, "output", "footage-empire-v2");
const DEFAULT_CANDIDATE_REPORT = path.join(
  ROOT,
  "output",
  "normal-operations",
  "fresh_candidate_queue.json",
);
const FALLBACK_CANDIDATE_REPORT = path.join(
  ROOT,
  "output",
  "candidate-supply",
  "fresh_candidate_queue.json",
);
const DEFAULT_SEGMENT_REPORTS = [
  path.join(TEST_OUT, "official_trailer_segment_validation_apply_local.json"),
  path.join(TEST_OUT, "official_trailer_segment_validation_v1.json"),
  path.join(TEST_OUT, "official_trailer_segment_validation_dry_run.json"),
];
const DEFAULT_TRUSTED_REPORTS = [
  path.join(ROOT, "output", "trusted_footage_registry_report.json"),
  path.join(TEST_OUT, "trusted_footage_registry_report.json"),
];

function resolveFromRoot(value, fallback) {
  if (!value) return fallback;
  return path.resolve(ROOT, value);
}

function parseArgs(argv = process.argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    outDir: DEFAULT_OUT,
    candidateReportPath: DEFAULT_CANDIDATE_REPORT,
    segmentReportPath: null,
    trustedFootageReportPath: null,
    applyRightsRepair: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--apply-rights-repair") args.applyRightsRepair = true;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length) || null;
    else if (arg === "--candidate-report") args.candidateReportPath = resolveFromRoot(argv[++i], args.candidateReportPath);
    else if (arg.startsWith("--candidate-report=")) {
      args.candidateReportPath = resolveFromRoot(arg.slice("--candidate-report=".length), args.candidateReportPath);
    } else if (arg === "--segment-report" || arg === "--segment-validation-report") {
      args.segmentReportPath = resolveFromRoot(argv[++i], args.segmentReportPath);
    } else if (arg.startsWith("--segment-report=")) {
      args.segmentReportPath = resolveFromRoot(arg.slice("--segment-report=".length), args.segmentReportPath);
    } else if (arg.startsWith("--segment-validation-report=")) {
      args.segmentReportPath = resolveFromRoot(arg.slice("--segment-validation-report=".length), args.segmentReportPath);
    } else if (arg === "--trusted-footage-report") {
      args.trustedFootageReportPath = resolveFromRoot(argv[++i], args.trustedFootageReportPath);
    } else if (arg.startsWith("--trusted-footage-report=")) {
      args.trustedFootageReportPath = resolveFromRoot(arg.slice("--trusted-footage-report=".length), args.trustedFootageReportPath);
    } else if (arg === "--out-dir") {
      args.outDir = resolveFromRoot(argv[++i], args.outDir);
    } else if (arg.startsWith("--out-dir=")) {
      args.outDir = resolveFromRoot(arg.slice("--out-dir=".length), args.outDir);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/footage-empire-v2.js [options]",
      "",
      "Options:",
      "  --story-id <id>                     Score one candidate",
      "  --candidate-report <path>           Candidate queue JSON",
      "  --segment-report <path>             Official trailer segment validation report",
      "  --trusted-footage-report <path>     Trusted footage registry report",
      "  --apply-rights-repair               File-only repair for missing direct-video rights records",
      "  --out-dir <path>                    Output directory",
      "  --json                              Print JSON report",
      "",
      "Default mode is read-only. With --apply-rights-repair it only updates local proof rights_ledger.json files. It never downloads footage, extracts frames, mutates the DB, changes OAuth or posts externally.",
    ].join("\n") + "\n",
  );
}

async function readJsonIfExists(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

async function readFirstExisting(paths, fallback = {}) {
  for (const filePath of paths) {
    if (await fs.pathExists(filePath)) return fs.readJson(filePath);
  }
  return fallback;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function mergeReports(reports) {
  const merged = {};
  for (const report of reports.filter(Boolean)) {
    for (const [key, value] of Object.entries(report)) {
      if (Array.isArray(value)) merged[key] = [...asArray(merged[key]), ...value];
      else if (value && typeof value === "object" && !merged[key]) merged[key] = value;
      else if (merged[key] === undefined) merged[key] = value;
    }
  }
  return merged;
}

async function loadSegmentReport(args) {
  if (args.segmentReportPath) return readJsonIfExists(args.segmentReportPath, {});
  const reports = [];
  for (const filePath of DEFAULT_SEGMENT_REPORTS) {
    const report = await readJsonIfExists(filePath, null);
    if (report) reports.push(report);
  }
  return mergeReports(reports);
}

async function loadTrustedFootageReport(args) {
  if (args.trustedFootageReportPath) return readJsonIfExists(args.trustedFootageReportPath, {});
  return readFirstExisting(DEFAULT_TRUSTED_REPORTS, {});
}

function candidateRows(payload = {}) {
  if (Array.isArray(payload)) return payload;
  return [
    ...asArray(payload.candidates),
    ...asArray(payload.ready_candidates),
    ...asArray(payload.stories),
    ...asArray(payload.rows),
    ...asArray(payload.items),
  ];
}

function storyId(row = {}) {
  return String(row.id || row.story_id || row.storyId || "").trim();
}

function artifactDirForCandidate(candidate = {}) {
  const explicit = candidate.artifact_dir || candidate.artifactDir || candidate.proof_dir || candidate.proofDir;
  if (explicit) return path.resolve(ROOT, explicit);
  const exported = candidate.exported_path || candidate.source?.exported_path || candidate.video_path;
  if (exported) return path.dirname(path.resolve(ROOT, exported));
  const id = storyId(candidate);
  return id ? path.join(ROOT, "output", "goal-proof", "batch", id) : null;
}

function materialisedRows(payload = {}) {
  return [
    ...asArray(payload),
    ...asArray(payload.clips),
    ...asArray(payload.motion_clips),
    ...asArray(payload.materialised_motion_clips),
    ...asArray(payload.accepted_local_clips),
    ...asArray(payload.ready_clips),
  ].filter((row) => row && typeof row === "object");
}

function mergeFootageInventory(footageInventory = {}, materialisedMotion = {}) {
  const rows = materialisedRows(materialisedMotion);
  if (!rows.length) return footageInventory;
  return {
    ...footageInventory,
    materialised_motion_clips: [
      ...asArray(footageInventory.materialised_motion_clips),
      ...rows,
    ],
  };
}

async function loadCandidateReport(args) {
  if (await fs.pathExists(args.candidateReportPath)) return fs.readJson(args.candidateReportPath);
  return readJsonIfExists(FALLBACK_CANDIDATE_REPORT, {});
}

async function loadStoryProof(candidates) {
  const canonicalManifests = {};
  const footageInventories = {};
  const rightsLedgers = {};
  const artifactDirs = {};

  for (const candidate of candidates) {
    const id = storyId(candidate);
    const artifactDir = artifactDirForCandidate(candidate);
    if (!id || !artifactDir) continue;
    artifactDirs[id] = artifactDir;
    const [canonical, footageInventory, materialisedMotion, rightsLedger] = await Promise.all([
      readJsonIfExists(path.join(artifactDir, "canonical_story_manifest.json"), {}),
      readJsonIfExists(path.join(artifactDir, "footage_inventory.json"), {}),
      readJsonIfExists(path.join(artifactDir, "materialised_motion_clips.json"), {}),
      readJsonIfExists(path.join(artifactDir, "rights_ledger.json"), {}),
    ]);
    canonicalManifests[id] = canonical;
    footageInventories[id] = mergeFootageInventory(footageInventory, materialisedMotion);
    rightsLedgers[id] = rightsLedger;
  }

  return { artifactDirs, canonicalManifests, footageInventories, rightsLedgers };
}

async function loadInputs(args) {
  const candidateReport = await loadCandidateReport(args);
  const candidates = candidateRows(candidateReport).filter((candidate) => {
    const id = storyId(candidate);
    if (!id) return false;
    return !args.storyId || id === args.storyId;
  });
  const [storyProof, trustedFootageReport, segmentValidationReport] = await Promise.all([
    loadStoryProof(candidates),
    loadTrustedFootageReport(args),
    loadSegmentReport(args),
  ]);

  return {
    candidates,
    trustedFootageReport,
    segmentValidationReport,
    ...storyProof,
  };
}

function segmentValidationSummary(report = {}) {
  const rows = [
    ...asArray(report.accepted_segments),
    ...asArray(report.validated_segments),
    ...asArray(report.segments),
    ...asArray(report.rows),
  ];
  const accepted = rows.filter((row) =>
    ["pass", "accepted", "candidate", ""].includes(String(row.verdict || row.validation_result || "").trim()),
  );
  const families = new Set(
    accepted
      .map((row) => row.source_family || row.motion_family || row.family || row.provenance?.source_family)
      .filter(Boolean),
  );
  return {
    row_count: rows.length,
    accepted_or_candidate_count: accepted.length,
    distinct_source_family_count: families.size,
    distinct_source_families: [...families].sort(),
  };
}

function backupSuffix() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function applyRightsRepairs(inputs, args) {
  const repairs = [];
  for (const candidate of inputs.candidates) {
    const id = storyId(candidate);
    const artifactDir = inputs.artifactDirs?.[id];
    if (!id || !artifactDir) continue;
    const rightsPath = path.join(artifactDir, "rights_ledger.json");
    const current = inputs.rightsLedgers[id] || {};
    const repair = buildRightsLedgerRepair({
      storyId: id,
      footageInventory: inputs.footageInventories[id] || {},
      rightsLedger: current,
    });
    if (!repair.records_to_add.length) {
      repairs.push({
        story_id: id,
        rights_path: rightsPath,
        applied: false,
        records_added: 0,
        reason: "no_source_safe_missing_direct_motion_rights_records",
      });
      continue;
    }
    const repaired = applyRightsLedgerRepair(current, repair);
    const backupPath = `${rightsPath}.pre_footage_empire_v2_rights_repair.${backupSuffix()}`;
    await fs.copy(rightsPath, backupPath, { overwrite: false, errorOnExist: false });
    await fs.writeJson(rightsPath, repaired, { spaces: 2 });
    inputs.rightsLedgers[id] = repaired;
    repairs.push({
      story_id: id,
      rights_path: rightsPath,
      backup_path: backupPath,
      applied: true,
      records_added: repair.records_to_add.length,
      source_families_added: repair.records_to_add.map((record) => record.source_family),
      safety: repair.safety,
    });
  }
  const report = {
    generated_at: new Date().toISOString(),
    mode: "footage_empire_v2_file_only_rights_repair",
    applied_count: repairs.filter((repair) => repair.applied).length,
    records_added: repairs.reduce((sum, repair) => sum + Number(repair.records_added || 0), 0),
    repairs,
    safety: {
      proof_file_repair_only: true,
      no_db_mutation: true,
      no_upload_or_posting_action: true,
      no_oauth_or_token_mutation: true,
    },
  };
  await fs.ensureDir(args.outDir);
  await fs.writeJson(path.join(args.outDir, "rights_ledger_repair_report.json"), report, { spaces: 2 });
  return report;
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { exitCode: 0 };
  }

  const inputs = await loadInputs(args);
  const rightsRepairReport = args.applyRightsRepair ? await applyRightsRepairs(inputs, args) : null;
  const report = buildFootageEmpireV2Report(inputs);
  const markdown = formatFootageEmpireV2Markdown(report);
  const segmentSummary = segmentValidationSummary(inputs.segmentValidationReport);

  await fs.ensureDir(args.outDir);
  await Promise.all([
    fs.writeJson(path.join(args.outDir, "footage_empire_v2_report.json"), report, { spaces: 2 }),
    fs.writeFile(path.join(args.outDir, "footage_empire_v2_report.md"), markdown, "utf8"),
    fs.writeJson(path.join(args.outDir, "source_family_scorecard.json"), report.source_family_scorecard, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "footage_repair_backlog.json"), report.repair_backlog, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "segment_validation_summary.json"), segmentSummary, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "rights_ledger_repair_report.json"), rightsRepairReport || {
      generated_at: report.generated_at,
      mode: "not_applied",
      applied_count: 0,
      records_added: 0,
      repairs: [],
    }, { spaces: 2 }),
  ]);

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(markdown);
    process.stderr.write(`[footage-empire-v2] out=${path.relative(ROOT, args.outDir)}\n`);
  }

  if (report.verdict === "red") process.exitCode = 2;
  return { exitCode: process.exitCode || 0, report };
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[footage-empire-v2] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  applyRightsRepairs,
  loadInputs,
  main,
  parseArgs,
  segmentValidationSummary,
};
