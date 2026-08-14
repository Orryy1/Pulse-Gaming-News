#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  buildSystemTraceYouTubeAuthorities,
} = require("../lib/services/system-trace-youtube-authority");

const REPO_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "videos", "system-trace-youtube-buffer.json");
const RIGHTS_PATH = path.join(REPO_ROOT, "videos", "system-trace-buffer-rights-ledger.json");
const OUTPUT_ROOT = path.resolve("D:/pulse-evidence/system-trace-youtube-buffer-20260814");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function readJsonWithHash(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("authority_input_must_be_regular_file");
  const bytes = await fs.readFile(file);
  return { document: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes) };
}

async function writeJsonExclusive(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    log("Usage: node tools/system-trace-youtube-authority.js --materialise");
    return { help: true };
  }
  if (argv.length !== 1 || argv[0] !== "--materialise") {
    throw new Error("system_trace_authority_explicit_materialise_required");
  }
  if (await fs.pathExists(OUTPUT_ROOT)) throw new Error("system_trace_authority_output_already_exists");

  const manifestInput = await readJsonWithHash(MANIFEST_PATH);
  const rightsInput = await readJsonWithHash(RIGHTS_PATH);
  const proofs = {};
  for (const episode of manifestInput.document.episodes || []) {
    const proofPath = path.join(REPO_ROOT, episode.project_dir, "governed-youtube-upload-proof.json");
    proofs[episode.story_id] = (await readJsonWithHash(proofPath)).document;
  }

  const generatedAt = new Date().toISOString();
  const receiptRoot = path.join(OUTPUT_ROOT, "receipts", "private");
  const report = buildSystemTraceYouTubeAuthorities({
    manifest: manifestInput.document,
    rightsLedger: rightsInput.document,
    proofs,
    manifestSha256: manifestInput.sha256,
    rightsLedgerSha256: rightsInput.sha256,
    receiptRoot,
    generatedAt,
  });

  const parent = path.dirname(OUTPUT_ROOT);
  const stage = path.join(parent, `.system-trace-youtube-buffer-20260814.staging-${crypto.randomUUID()}`);
  const authorityDir = path.join(stage, "authorities", "private");
  await fs.ensureDir(authorityDir);
  await fs.ensureDir(path.join(stage, "receipts", "private"));
  await fs.ensureDir(path.join(stage, "receipts", "schedule"));

  const authorityFiles = [];
  for (const item of report.authorities) {
    const authority = {
      ...item.private_upload,
      release: item.release,
      buffer_authority: {
        schema: report.schema,
        generated_at: report.generated_at,
        episode_count: report.episode_count,
        manifest_sha256: report.evidence_binding.manifest_sha256,
        rights_ledger_sha256: report.evidence_binding.rights_ledger_sha256,
      },
    };
    const file = path.join(authorityDir, `${item.story_id}-authority.json`);
    await writeJsonExclusive(file, authority);
    authorityFiles.push({
      story_id: item.story_id,
      authority_file: path.relative(stage, file).replaceAll(path.sep, "/"),
      private_receipt: path.relative(OUTPUT_ROOT, item.private_upload.dispatch.receipt_path).replaceAll(path.sep, "/"),
      schedule_receipt: `receipts/schedule/${item.story_id}-schedule-receipt.json`,
      publish_at_utc: item.release.publish_at_utc,
    });
  }

  const sealedReport = { ...report, authority_files: authorityFiles };
  await writeJsonExclusive(path.join(stage, "authority-report.json"), sealedReport);
  await writeJsonExclusive(path.join(stage, "operator-decision.json"), report.operator_decision);
  const summary = [
    "# System Trace YouTube buffer authority",
    "",
    `Verdict: ${report.verdict}`,
    `Channel: ${report.channel.title} (${report.channel.id})`,
    `Episodes: ${report.episode_count}`,
    "Scope: seven exact private-first uploads followed only by their manifest-bound YouTube native schedules.",
    "General autonomous publication authority: no.",
    "",
    ...authorityFiles.map((item) => `- ${item.story_id}: ${item.publish_at_utc}`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(stage, "authority-report.md"), summary, { encoding: "utf8", flag: "wx" });
  await fs.rename(stage, OUTPUT_ROOT);

  log(`[system-trace-youtube-authority] GREEN: ${report.episode_count} exact authorities; root=${OUTPUT_ROOT}`);
  return { report: sealedReport, output_root: OUTPUT_ROOT };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[system-trace-youtube-authority] BLOCKED: ${error.message}`);
    if (Array.isArray(error.blockers)) console.error(error.blockers.join(", "));
    process.exitCode = 2;
  });
}

module.exports = { main };
