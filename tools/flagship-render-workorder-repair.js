#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  repairFlagshipRenderWorkOrder,
} = require("../lib/flagship-render-workorder-repair");

function inlineValue(arg, name) {
  const prefix = `${name}=`;
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : null;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    sourceWorkOrderPath: "",
    currentEvidencePath: "",
    currentPackageDir: "",
    narrationAudioPath: "",
    narrationAudioSha256: "",
    narrationAudioSizeBytes: "",
    wordTimestampsPath: "",
    wordTimestampsSha256: "",
    wordTimestampsSizeBytes: "",
    motionManifestPath: "",
    motionManifestSha256: "",
    motionManifestSizeBytes: "",
    selectedClipIds: [],
    workspaceDir: "",
    targetArtifactDir: "",
    targetOutputPath: "",
    targetManifestPath: "",
    outputWorkOrderPath: "",
    reportPath: "",
    generatedAt: "",
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    let value;
    if (arg === "--work-order" || arg === "--source-work-order") {
      args.sourceWorkOrderPath = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--work-order")) !== null) {
      args.sourceWorkOrderPath = value;
    } else if ((value = inlineValue(arg, "--source-work-order")) !== null) {
      args.sourceWorkOrderPath = value;
    } else if (arg === "--evidence" || arg === "--current-evidence") {
      args.currentEvidencePath = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--evidence")) !== null) {
      args.currentEvidencePath = value;
    } else if ((value = inlineValue(arg, "--current-evidence")) !== null) {
      args.currentEvidencePath = value;
    } else if (arg === "--current-package" || arg === "--source-artifact-dir") {
      args.currentPackageDir = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--current-package")) !== null) {
      args.currentPackageDir = value;
    } else if ((value = inlineValue(arg, "--source-artifact-dir")) !== null) {
      args.currentPackageDir = value;
    } else if (arg === "--narration-audio") {
      args.narrationAudioPath = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--narration-audio")) !== null) {
      args.narrationAudioPath = value;
    } else if (arg === "--narration-sha256") {
      args.narrationAudioSha256 = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--narration-sha256")) !== null) {
      args.narrationAudioSha256 = value;
    } else if (arg === "--narration-size") {
      args.narrationAudioSizeBytes = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--narration-size")) !== null) {
      args.narrationAudioSizeBytes = value;
    } else if (arg === "--word-timestamps") {
      args.wordTimestampsPath = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--word-timestamps")) !== null) {
      args.wordTimestampsPath = value;
    } else if (arg === "--timestamps-sha256") {
      args.wordTimestampsSha256 = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--timestamps-sha256")) !== null) {
      args.wordTimestampsSha256 = value;
    } else if (arg === "--timestamps-size") {
      args.wordTimestampsSizeBytes = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--timestamps-size")) !== null) {
      args.wordTimestampsSizeBytes = value;
    } else if (arg === "--motion-manifest") {
      args.motionManifestPath = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--motion-manifest")) !== null) {
      args.motionManifestPath = value;
    } else if (arg === "--motion-sha256") {
      args.motionManifestSha256 = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--motion-sha256")) !== null) {
      args.motionManifestSha256 = value;
    } else if (arg === "--motion-size") {
      args.motionManifestSizeBytes = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--motion-size")) !== null) {
      args.motionManifestSizeBytes = value;
    } else if (arg === "--clip-id") {
      args.selectedClipIds.push(argv[++index] || "");
    } else if ((value = inlineValue(arg, "--clip-id")) !== null) {
      args.selectedClipIds.push(value);
    } else if (arg === "--clip-ids") {
      args.selectedClipIds.push(...String(argv[++index] || "").split(","));
    } else if ((value = inlineValue(arg, "--clip-ids")) !== null) {
      args.selectedClipIds.push(...String(value).split(","));
    } else if (arg === "--workspace" || arg === "--isolated-workspace") {
      args.workspaceDir = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--workspace")) !== null) {
      args.workspaceDir = value;
    } else if ((value = inlineValue(arg, "--isolated-workspace")) !== null) {
      args.workspaceDir = value;
    } else if (arg === "--artifact-dir" || arg === "--target-artifact-dir") {
      args.targetArtifactDir = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--artifact-dir")) !== null) {
      args.targetArtifactDir = value;
    } else if ((value = inlineValue(arg, "--target-artifact-dir")) !== null) {
      args.targetArtifactDir = value;
    } else if (arg === "--target-output") {
      args.targetOutputPath = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--target-output")) !== null) {
      args.targetOutputPath = value;
    } else if (arg === "--target-manifest") {
      args.targetManifestPath = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--target-manifest")) !== null) {
      args.targetManifestPath = value;
    } else if (arg === "--output-work-order") {
      args.outputWorkOrderPath = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--output-work-order")) !== null) {
      args.outputWorkOrderPath = value;
    } else if (arg === "--report") {
      args.reportPath = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--report")) !== null) {
      args.reportPath = value;
    } else if (arg === "--generated-at") {
      args.generatedAt = argv[++index] || "";
    } else if ((value = inlineValue(arg, "--generated-at")) !== null) {
      args.generatedAt = value;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h" || arg === "-?") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node tools/flagship-render-workorder-repair.js --work-order <file> --evidence <file> --workspace <dir> [options]",
    "  node tools/flagship-render-workorder-repair.js --work-order <file> --current-package <dir> --narration-audio <file> --narration-sha256 <hash> --narration-size <bytes> --word-timestamps <file> --timestamps-sha256 <hash> --timestamps-size <bytes> --motion-sha256 <hash> --motion-size <bytes> --workspace <dir> [options]",
    "",
    "Clones one governed ready render job into a new isolated local-proof workspace.",
    "It verifies current narration, timestamps, hashes and selected materialised clip IDs before writing.",
    "This command does not execute a render, publish, mutate a database or change OAuth/token state.",
    "",
    "Options:",
    "  --current-package <dir>  Current staging package to clone instead of the work-order artifact",
    "  --motion-manifest <file> Current motion manifest (defaults inside --current-package)",
    "  --clip-id <id>           Selected current clip ID; repeat to override manifest selection",
    "  --artifact-dir <dir>       Target artifact directory inside the workspace",
    "  --target-output <file>     Future render output inside the workspace",
    "  --target-manifest <file>   Future render manifest inside the workspace",
    "  --output-work-order <file> Repaired work order inside the workspace",
    "  --report <file>            Machine-readable repair report inside the workspace",
    "  --generated-at <iso>       Fixed evidence timestamp",
    "  --json                     Print the repair report",
    "  --help                     Show this help",
  ].join("\n");
}

function resolveIfSet(cwd, value) {
  return value ? path.resolve(cwd, value) : "";
}

function requiredValue(value, flag) {
  if (!String(value || "").trim()) throw new Error(`${flag} is required without --evidence`);
  return value;
}

function motionRows(manifest) {
  if (Array.isArray(manifest.materialised_clips) && manifest.materialised_clips.length) {
    return manifest.materialised_clips;
  }
  if (Array.isArray(manifest.materialized_clips) && manifest.materialized_clips.length) {
    return manifest.materialized_clips;
  }
  return Array.isArray(manifest.clips) ? manifest.clips : [];
}

function motionClipId(clip) {
  return String(clip?.id || clip?.clip_id || clip?.asset_id || clip?.motion_pack_clip_id || "").trim();
}

async function buildPackageEvidence(cwd, args) {
  const currentPackageDir = resolveIfSet(cwd, requiredValue(args.currentPackageDir, "--current-package"));
  const motionManifestPath = resolveIfSet(
    cwd,
    args.motionManifestPath || path.join(currentPackageDir, "materialised_motion_clips.json"),
  );
  if (!(await fs.pathExists(motionManifestPath))) throw new Error("missing_file:materialised_motion_manifest");
  let motionManifest;
  try {
    motionManifest = await fs.readJson(motionManifestPath);
  } catch (error) {
    throw new Error(`invalid_json:materialised_motion_manifest:${error.message}`);
  }
  const storyId = String(motionManifest?.story_id || "").trim();
  if (!storyId) throw new Error("current_evidence_story_id_missing");
  const manifestSelectedIds = Array.isArray(motionManifest.selected_materialised_motion_clip_ids)
    ? motionManifest.selected_materialised_motion_clip_ids
    : motionRows(motionManifest).map(motionClipId);
  const selectedClipIds = (args.selectedClipIds.length ? args.selectedClipIds : manifestSelectedIds)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!selectedClipIds.length) throw new Error("current_evidence_selected_clip_ids_missing");

  return {
    currentPackageDir,
    evidence: {
      schema_version: 1,
      story_id: storyId,
      narration_audio_path: resolveIfSet(
        cwd,
        requiredValue(args.narrationAudioPath, "--narration-audio"),
      ),
      narration_audio_sha256: requiredValue(args.narrationAudioSha256, "--narration-sha256"),
      narration_audio_size_bytes: requiredValue(args.narrationAudioSizeBytes, "--narration-size"),
      word_timestamps_path: resolveIfSet(
        cwd,
        requiredValue(args.wordTimestampsPath, "--word-timestamps"),
      ),
      word_timestamps_sha256: requiredValue(args.wordTimestampsSha256, "--timestamps-sha256"),
      word_timestamps_size_bytes: requiredValue(args.wordTimestampsSizeBytes, "--timestamps-size"),
      materialised_motion_manifest_path: motionManifestPath,
      materialised_motion_manifest_sha256: requiredValue(args.motionManifestSha256, "--motion-sha256"),
      materialised_motion_manifest_size_bytes: requiredValue(args.motionManifestSizeBytes, "--motion-size"),
      selected_materialised_motion_clip_ids: selectedClipIds,
    },
  };
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  const stdout = dependencies.stdout || ((value) => process.stdout.write(String(value)));
  if (args.help) {
    stdout(`${usage()}\n`);
    return { help: true };
  }
  if (!args.sourceWorkOrderPath) throw new Error("--work-order is required");
  if (!args.workspaceDir) throw new Error("--workspace is required");

  const cwd = path.resolve(dependencies.cwd || process.cwd());
  let currentEvidence;
  let sourceArtifactDir = resolveIfSet(cwd, args.currentPackageDir);
  if (!args.currentEvidencePath) {
    const packageEvidence = await buildPackageEvidence(cwd, args);
    currentEvidence = packageEvidence.evidence;
    sourceArtifactDir = packageEvidence.currentPackageDir;
  }
  const result = await repairFlagshipRenderWorkOrder({
    sourceWorkOrderPath: resolveIfSet(cwd, args.sourceWorkOrderPath),
    currentEvidencePath: resolveIfSet(cwd, args.currentEvidencePath),
    currentEvidence,
    currentEvidenceBaseDir: cwd,
    sourceArtifactDir,
    workspaceDir: resolveIfSet(cwd, args.workspaceDir),
    targetArtifactDir: resolveIfSet(cwd, args.targetArtifactDir),
    targetOutputPath: resolveIfSet(cwd, args.targetOutputPath),
    targetManifestPath: resolveIfSet(cwd, args.targetManifestPath),
    outputWorkOrderPath: resolveIfSet(cwd, args.outputWorkOrderPath),
    reportPath: resolveIfSet(cwd, args.reportPath),
    generatedAt: args.generatedAt || undefined,
  });
  stdout(args.json
    ? `${JSON.stringify(result.report, null, 2)}\n`
    : `[flagship-render-workorder-repair] status=${result.report.status} story=${result.report.story_id} work_order=${result.workOrderPath}\n`);
  return result;
}

async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const stderr = dependencies.stderr || ((value) => process.stderr.write(`${value}\n`));
  const exit = dependencies.exit || ((code) => { process.exitCode = code; });
  try {
    const result = await main(argv, dependencies);
    exit(0);
    return result;
  } catch (error) {
    stderr(`[flagship-render-workorder-repair] FAILED: ${error.stack || error.message}`);
    exit(1);
    return null;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  main,
  parseArgs,
  runCli,
  usage,
};
