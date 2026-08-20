#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  buildSystemTraceYouTubeAuthorities,
} = require("../lib/services/system-trace-youtube-authority");

const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.resolve(
  "D:/pulse-evidence/system-trace-display-pipeline-buffer-20260820",
);
const EXPECTED_PUBLISH_AT_UTC = Object.freeze(
  Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(2026, 7, 22 + index, 17, 0, 0, 0)).toISOString(),
  ),
);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fixedPaths(input = {}) {
  const repoRoot = path.resolve(input.repoRoot || REPO_ROOT);
  const outputRoot = path.resolve(input.outputRoot || OUTPUT_ROOT);
  return Object.freeze({
    repoRoot,
    outputRoot,
    manifestPath: path.join(
      repoRoot,
      "videos",
      "system-trace-display-pipeline-youtube-buffer.json",
    ),
    rightsPath: path.join(
      repoRoot,
      "videos",
      "system-trace-display-pipeline-buffer-rights-ledger.json",
    ),
  });
}

async function readJsonWithHash(file, label) {
  const requested = path.resolve(file);
  const stat = await fs.lstat(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}_must_be_regular_file`);
  }
  const bytes = await fs.readFile(requested);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label}_must_be_valid_json`);
  }
  return { document, sha256: sha256(bytes) };
}

async function writeJsonExclusive(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

async function main(
  argv = process.argv.slice(2),
  { paths, generatedAt, log = console.log } = {},
) {
  if (argv.includes("--help") || argv.includes("-h")) {
    log(
      "Usage: node tools/system-trace-display-pipeline-youtube-authority.js --materialise",
    );
    return { help: true };
  }
  if (argv.length !== 1 || argv[0] !== "--materialise") {
    throw new Error("system_trace_display_authority_explicit_materialise_required");
  }

  const resolved = fixedPaths(paths);
  const outputRelative = path.relative(resolved.repoRoot, resolved.outputRoot);
  if (
    outputRelative === "" ||
    (!outputRelative.startsWith(`..${path.sep}`) && outputRelative !== "..")
  ) {
    throw new Error("authority_output_must_be_external_to_repo");
  }
  if (await fs.pathExists(resolved.outputRoot)) {
    throw new Error("system_trace_display_authority_output_already_exists");
  }

  const manifestInput = await readJsonWithHash(resolved.manifestPath, "manifest");
  const rightsInput = await readJsonWithHash(resolved.rightsPath, "rights_ledger");
  const proofs = {};
  for (const episode of manifestInput.document.episodes || []) {
    const proofPath = path.join(
      resolved.repoRoot,
      episode.project_dir,
      "governed-youtube-upload-proof.json",
    );
    proofs[episode.story_id] = (
      await readJsonWithHash(proofPath, `request_proof:${episode.story_id}`)
    ).document;
  }

  const receiptRoot = path.join(resolved.outputRoot, "receipts", "private");
  const report = buildSystemTraceYouTubeAuthorities({
    manifest: manifestInput.document,
    rightsLedger: rightsInput.document,
    proofs,
    expectedPublishAtUtc: [...EXPECTED_PUBLISH_AT_UTC],
    manifestSha256: manifestInput.sha256,
    rightsLedgerSha256: rightsInput.sha256,
    receiptRoot,
    generatedAt: generatedAt || new Date().toISOString(),
  });

  const stage = path.join(
    path.dirname(resolved.outputRoot),
    `.system-trace-display-pipeline-buffer-20260820.staging-${crypto.randomUUID()}`,
  );
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
      private_receipt: path
        .relative(resolved.outputRoot, item.private_upload.dispatch.receipt_path)
        .replaceAll(path.sep, "/"),
      schedule_receipt: `receipts/schedule/${item.story_id}-schedule-receipt.json`,
      publish_at_utc: item.release.publish_at_utc,
    });
  }

  const sealedReport = { ...report, authority_files: authorityFiles };
  await writeJsonExclusive(path.join(stage, "authority-report.json"), sealedReport);
  await writeJsonExclusive(path.join(stage, "operator-decision.json"), report.operator_decision);
  const summary = [
    "# System Trace Display Pipeline YouTube authority",
    "",
    `Verdict: ${report.verdict}`,
    `Channel: ${report.channel.title} (${report.channel.id})`,
    `Episodes: ${report.episode_count}`,
    "Scope: seven exact private-first uploads followed only by their manifest-bound native schedules.",
    "General autonomous publication authority: no.",
    "",
    ...authorityFiles.map((item) => `- ${item.story_id}: ${item.publish_at_utc}`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(stage, "authority-report.md"), summary, {
    encoding: "utf8",
    flag: "wx",
  });
  await fs.rename(stage, resolved.outputRoot);

  log(
    `[system-trace-display-pipeline-youtube-authority] GREEN: ${report.episode_count} exact authorities; root=${resolved.outputRoot}`,
  );
  return { report: sealedReport, output_root: resolved.outputRoot };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      `[system-trace-display-pipeline-youtube-authority] BLOCKED: ${error.message}`,
    );
    if (Array.isArray(error.blockers)) console.error(error.blockers.join(", "));
    process.exitCode = 2;
  });
}

module.exports = { EXPECTED_PUBLISH_AT_UTC, fixedPaths, main };
