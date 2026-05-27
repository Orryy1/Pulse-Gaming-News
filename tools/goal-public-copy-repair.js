#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  repairGoalPublicCopyPackages,
  buildAudioRegenerationWorkbench,
  buildProductionRerenderWorkOrder,
  buildSourceAttributionRepairWorkOrder,
} = require("../lib/goal-public-copy-repair");
const {
  summariseElevenLabsTts,
  summariseLocalTtsDoctor,
} = require("../lib/goal-audio-timestamp-workbench");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    storyPackagesPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    existingAudioWorkbenchPath: path.join(process.cwd(), "output", "goal-contract", "audio_timestamp_workbench.json"),
    localTtsDoctorPath: path.join(process.cwd(), "test", "output", "local_tts_doctor.json"),
    sourceAttributionEntriesPath: null,
    providerPreference: null,
    storyIds: [],
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--audio-workbench") args.existingAudioWorkbenchPath = argv[++i] || args.existingAudioWorkbenchPath;
    else if (arg === "--local-tts-doctor") args.localTtsDoctorPath = argv[++i] || args.localTtsDoctorPath;
    else if (arg === "--source-attribution-entries") args.sourceAttributionEntriesPath = argv[++i] || null;
    else if (arg === "--provider-preference") args.providerPreference = argv[++i] || null;
    else if (arg === "--story-id" || arg === "--story") args.storyIds.push(argv[++i] || "");
    else if (arg === "--story-ids" || arg === "--stories") {
      args.storyIds.push(...String(argv[++i] || "").split(","));
    } else if (arg.startsWith("--story-id=")) {
      args.storyIds.push(arg.slice("--story-id=".length));
    } else if (arg.startsWith("--story-ids=")) {
      args.storyIds.push(...arg.slice("--story-ids=".length).split(","));
    }
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.storyIds = args.storyIds.map((value) => String(value || "").trim()).filter(Boolean);
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-public-copy-repair -- [options]",
    "",
    "Options:",
    "  --root <dir>              Workspace root",
    "  --story-packages <path>   Story package manifest",
    "  --out-dir <dir>           Output directory",
    "  --audio-workbench <path>  Existing local TTS status source",
    "  --local-tts-doctor <path> Fresh local TTS doctor report",
    "  --source-attribution-entries <path> JSON entries for non-Reddit source repair",
    "  --provider-preference <p> local | elevenlabs | auto",
    "  --story-id <id>          Repair one story id; repeatable",
    "  --story-ids <ids>        Comma-separated story ids",
    "  --generated-at <iso>      Fixed timestamp",
    "  --json                    Print JSON",
    "",
    "Repairs public metadata and writes regeneration work orders. It does not publish or call TTS itself.",
  ].join("\n");
}

async function readStoryPackages(root, explicitPath = null) {
  const filePath = explicitPath
    ? path.resolve(root, explicitPath)
    : path.join(root, "output", "goal-contract", "story-packages.json");
  const value = await fs.readJson(filePath);
  if (!Array.isArray(value)) throw new Error(`story package file is not an array: ${filePath}`);
  return value;
}

function storyPackageId(storyPackage = {}) {
  return String(storyPackage.story_id || storyPackage.id || storyPackage.story?.story_id || storyPackage.story?.id || "").trim();
}

function filterStoryPackages(storyPackages = [], storyIds = []) {
  const allowed = new Set(storyIds.map((value) => String(value || "").trim()).filter(Boolean));
  if (!allowed.size) return storyPackages;
  return storyPackages.filter((storyPackage) => allowed.has(storyPackageId(storyPackage)));
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath).catch(() => fallback);
}

async function readSourceAttributionEntries(root, explicitPath = null) {
  if (!explicitPath) return [];
  const filePath = path.resolve(root, explicitPath);
  const payload = await fs.readJson(filePath);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.sources)) return payload.sources;
  return [payload];
}

async function writeReports({ report, audioWorkbench, renderWorkOrder, sourceAttributionWorkOrder, outDir }) {
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "public_copy_repair_report.json");
  const audioWorkbenchPath = path.join(outDir, "public_copy_audio_regeneration_workbench.json");
  const renderWorkOrderPath = path.join(outDir, "public_copy_rerender_work_order.json");
  const sourceAttributionWorkOrderPath = path.join(outDir, "source_attribution_repair_work_order.json");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeJson(audioWorkbenchPath, audioWorkbench, { spaces: 2 });
  await fs.writeJson(renderWorkOrderPath, renderWorkOrder, { spaces: 2 });
  await fs.writeJson(sourceAttributionWorkOrderPath, sourceAttributionWorkOrder, { spaces: 2 });
  return { jsonPath, audioWorkbenchPath, renderWorkOrderPath, sourceAttributionWorkOrderPath };
}

function chooseLocalTtsStatus({ existingWorkbench = {}, localTtsDoctorReport = {}, generatedAt } = {}) {
  const doctorSummary = summariseLocalTtsDoctor(localTtsDoctorReport, { generatedAt });
  if (doctorSummary.ready === true) return doctorSummary;
  return existingWorkbench.local_tts || doctorSummary;
}

function chooseProviderPreference({ explicitPreference = null, localTts = {}, existingWorkbench = {} } = {}) {
  if (explicitPreference) return explicitPreference;
  if (localTts.ready === true) return "local";
  return existingWorkbench.provider_preference || "auto";
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const storyPackages = filterStoryPackages(
    await readStoryPackages(root, args.storyPackagesPath),
    args.storyIds,
  );
  const sourceAttributionEntries = await readSourceAttributionEntries(root, args.sourceAttributionEntriesPath);
  const generatedAt = args.generatedAt || new Date().toISOString();
  const existingWorkbench = await readJsonIfPresent(path.resolve(root, args.existingAudioWorkbenchPath));
  const report = await repairGoalPublicCopyPackages({
    storyPackages,
    generatedAt,
    sourceAttributionEntries,
    audioWorkbench: existingWorkbench,
  });
  const localTtsDoctor = await readJsonIfPresent(path.resolve(root, args.localTtsDoctorPath));
  const localTts = chooseLocalTtsStatus({
    existingWorkbench,
    localTtsDoctorReport: localTtsDoctor,
    generatedAt,
  });
  const providerPreference = chooseProviderPreference({
    explicitPreference: args.providerPreference,
    localTts,
    existingWorkbench,
  });
  const audioWorkbench = buildAudioRegenerationWorkbench(report, {
    localTts,
    elevenlabsTts: existingWorkbench.elevenlabs_tts || summariseElevenLabsTts(process.env, { providerPreference }),
    providerPreference,
  });
  const renderWorkOrder = await buildProductionRerenderWorkOrder(report);
  const sourceAttributionWorkOrder = buildSourceAttributionRepairWorkOrder(report);
  const artefacts = await writeReports({
    report,
    audioWorkbench,
    renderWorkOrder,
    sourceAttributionWorkOrder,
    outDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      [
        "# Goal Public Copy Repair",
        "",
        `Changed: ${report.summary.changed_count}`,
        `Blocked: ${report.summary.blocked_count}`,
        `Source attribution repair jobs: ${sourceAttributionWorkOrder.summary.story_count}`,
        "",
        "Audio and final renders must be regenerated before publishing.",
      ].join("\n"),
    );
  }
  return { report, audioWorkbench, renderWorkOrder, sourceAttributionWorkOrder, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-public-copy-repair] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  readStoryPackages,
  filterStoryPackages,
  chooseLocalTtsStatus,
  chooseProviderPreference,
  readSourceAttributionEntries,
  main,
};
