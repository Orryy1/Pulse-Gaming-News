#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  assessMediaRightsPackage,
} = require("../lib/media-rights-policy");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: ROOT,
    inputPath: "",
    outDir: "",
    storyPath: "",
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.root = argv[++index] || args.root;
    else if (arg.startsWith("--root=")) args.root = arg.slice("--root=".length);
    else if (arg === "--input") args.inputPath = argv[++index] || "";
    else if (arg.startsWith("--input=")) args.inputPath = arg.slice("--input=".length);
    else if (arg === "--out-dir") args.outDir = argv[++index] || "";
    else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice("--out-dir=".length);
    else if (arg === "--story-json") args.storyPath = argv[++index] || "";
    else if (arg.startsWith("--story-json=")) args.storyPath = arg.slice("--story-json=".length);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:media-rights-assess -- --input <json> --out-dir <dir> [options]",
    "",
    "Creates a compact media-rights assessment, renderer attribution manifest,",
    "description credits and hash-bound candidate rights records. It never posts,",
    "touches OAuth/tokens or mutates the production database.",
    "",
    "Options:",
    "  --input <path>       Rights assessment request JSON",
    "  --out-dir <path>     Proof output directory",
    "  --story-json <path>  Optional render story to enrich into a new output copy",
    "  --root <path>        Workspace root for relative paths",
    "  --json               Print machine-readable result",
  ].join("\n");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function fingerprint(filePath) {
  const bytes = await fs.readFile(filePath);
  return {
    sha256: sha256(bytes),
    size_bytes: bytes.length,
  };
}

function recordsFromLedger(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.records)) return value.records;
  if (Array.isArray(value?.rights_ledger)) return value.rights_ledger;
  return [];
}

function mergeRightsRecords(existing = [], incoming = []) {
  const byAsset = new Map();
  for (const record of [...existing, ...incoming]) {
    const id = String(record?.asset_id || record?.id || "").trim();
    if (!id) continue;
    byAsset.set(id.toLowerCase(), record);
  }
  return [...byAsset.values()];
}

function markdown(result = {}) {
  const report = result.report || {};
  return [
    "# Media Rights Assessment",
    "",
    `Story: ${report.story_id || "unknown"}`,
    `Policy verdict: ${report.verdict || "UNKNOWN"}`,
    `Materialisation verdict: ${result.materialisation?.verdict || "UNKNOWN"}`,
    `Live publish allowed by this rights layer: ${result.live_publish_allowed === true ? "yes" : "no"}`,
    "",
    "## Coverage",
    `- assets: ${report.summary?.asset_count ?? 0}`,
    `- GREEN: ${report.summary?.green_count ?? 0}`,
    `- AMBER: ${report.summary?.amber_count ?? 0}`,
    `- RED: ${report.summary?.red_count ?? 0}`,
    `- renderer credits: ${report.summary?.attribution_entry_count ?? 0}`,
    "",
    "## Blockers",
    ...(
      (result.blockers || []).length
        ? result.blockers.map((blocker) => `- ${blocker}`)
        : ["- none"]
    ),
    "",
    "## Operating rule",
    "A small on-screen credit is generated where required, but attribution is never treated as a licence or exception by itself.",
    "",
    "No publishing, production DB mutation or OAuth/token change occurred.",
    "",
  ].join("\n");
}

async function main(
  argv = process.argv.slice(2),
  { stdout = (value) => process.stdout.write(value) } = {},
) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout(`${usage()}\n`);
    return { help: true };
  }
  if (!args.inputPath) throw new Error("--input is required");
  if (!args.outDir) throw new Error("--out-dir is required");

  const root = path.resolve(args.root);
  const inputPath = path.resolve(root, args.inputPath);
  const outDir = path.resolve(root, args.outDir);
  const storyPath = args.storyPath ? path.resolve(root, args.storyPath) : "";
  const request = await fs.readJson(inputPath);
  const report = assessMediaRightsPackage(request);
  await fs.ensureDir(outDir);

  const assessmentPath = path.join(outDir, "media_rights_assessment.json");
  const attributionPath = path.join(outDir, "media_attribution_manifest.json");
  const rightsRecordsPath = path.join(outDir, "media_rights_records.json");
  const descriptionAttributionPath = path.join(outDir, "description_attribution.txt");
  const summaryPath = path.join(outDir, "media_rights_assessment.md");
  const renderStoryPath = storyPath
    ? path.join(outDir, "render_story_with_media_rights.json")
    : null;

  await fs.writeJson(assessmentPath, report, { spaces: 2 });
  const evidenceFingerprint = await fingerprint(assessmentPath);
  const sourceAssets = new Map(
    (Array.isArray(request.assets) ? request.assets : [])
      .map((asset) => [String(asset?.asset_id || asset?.id || "").trim().toLowerCase(), asset]),
  );
  const materialisationBlockers = [];
  const materialisedRecords = [];
  for (const record of report.rights_records) {
    const sourceAsset = sourceAssets.get(String(record.asset_id || "").toLowerCase()) || {};
    const requestedPath = String(
      sourceAsset.path ||
        sourceAsset.local_path ||
        sourceAsset.local_materialized_path ||
        record.path ||
        "",
    ).trim();
    const resolvedPath = requestedPath ? path.resolve(root, requestedPath) : "";
    if (!resolvedPath || !(await fs.pathExists(resolvedPath))) {
      materialisationBlockers.push(`${record.asset_id}:materialised_media_file_missing`);
      continue;
    }
    const assetFingerprint = await fingerprint(resolvedPath);
    materialisedRecords.push({
      ...record,
      path: resolvedPath,
      local_materialized_path: resolvedPath,
      asset_sha256: assetFingerprint.sha256,
      asset_size_bytes: assetFingerprint.size_bytes,
      evidence_reference: assessmentPath,
      evidence_file: assessmentPath,
      evidence_sha256: evidenceFingerprint.sha256,
      evidence_size_bytes: evidenceFingerprint.size_bytes,
    });
  }
  if (materialisedRecords.length !== report.rights_records.length) {
    materialisationBlockers.push("materialised_rights_coverage_incomplete");
  }
  const materialisationVerdict = materialisationBlockers.length
    ? "RED"
    : report.verdict;
  const livePublishAllowed =
    report.live_publish_allowed === true &&
    materialisationVerdict === "GREEN";
  const recordsDocument = {
    schema: "pulse_materialised_media_rights_records_v1",
    generated_at: report.generated_at,
    story_id: report.story_id,
    verdict: livePublishAllowed ? "pass" : "fail",
    records: materialisedRecords,
    metrics: {
      assessed_record_count: report.rights_records.length,
      materialised_record_count: materialisedRecords.length,
    },
    blockers: materialisationBlockers,
    evidence: {
      assessment_path: assessmentPath,
      assessment_sha256: evidenceFingerprint.sha256,
      assessment_size_bytes: evidenceFingerprint.size_bytes,
    },
  };

  await fs.writeJson(attributionPath, report.attribution_manifest, { spaces: 2 });
  await fs.writeJson(rightsRecordsPath, recordsDocument, { spaces: 2 });
  await fs.writeFile(
    descriptionAttributionPath,
    report.attribution_manifest.description_lines.length
      ? `${report.attribution_manifest.description_lines.join("\n")}\n`
      : "",
    "utf8",
  );

  if (storyPath) {
    const story = await fs.readJson(storyPath);
    const mergedRecords = mergeRightsRecords(
      recordsFromLedger(story.rights_ledger),
      materialisedRecords,
    );
    await fs.writeJson(renderStoryPath, {
      ...story,
      media_attribution_manifest: report.attribution_manifest,
      rights_ledger: {
        schema_version: 2,
        story_id: report.story_id,
        generated_at: report.generated_at,
        verdict: livePublishAllowed ? "pass" : "fail",
        records: mergedRecords,
        blockers: unique([
          ...asArray(story.rights_ledger?.blockers),
          ...report.blockers,
          ...materialisationBlockers,
        ]),
      },
    }, { spaces: 2 });
  }

  const result = {
    report,
    materialisation: {
      verdict: materialisationVerdict,
      assessed_record_count: report.rights_records.length,
      materialised_record_count: materialisedRecords.length,
      blockers: materialisationBlockers,
    },
    live_publish_allowed: livePublishAllowed,
    blockers: unique([...report.blockers, ...materialisationBlockers]),
    paths: {
      assessment: assessmentPath,
      attribution_manifest: attributionPath,
      rights_records: rightsRecordsPath,
      description_attribution: descriptionAttributionPath,
      render_story: renderStoryPath,
      summary: summaryPath,
    },
    safety: {
      no_publish_triggered: true,
      no_database_mutation: true,
      no_oauth_or_token_change: true,
      source_story_not_mutated: true,
    },
  };
  await fs.writeFile(summaryPath, markdown(result), "utf8");
  if (args.json) stdout(`${JSON.stringify(result, null, 2)}\n`);
  else stdout(`${markdown(result)}\n`);
  return result;
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[media-rights-assess] FAILED: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  markdown,
  parseArgs,
  usage,
};

