#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const brand = require("../brand");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

const {
  applyLocalScriptExtensionAudio,
  buildLocalScriptExtensionPlan,
  renderLocalScriptExtensionMarkdown,
} = require("../lib/ops/local-script-extension");
const {
  applyLocalProofTtsLimits,
} = require("../lib/ops/local-proof-tts-limits");
const {
  probeLocalAudioAcoustics,
} = require("../lib/ops/local-acoustic-probe");
const {
  createLocalTtsBatchRecovery,
} = require("../lib/ops/local-tts-batch-recovery");
const {
  archiveLocalTtsProofReport,
} = require("../lib/studio/local-tts-proof-report-loader");
const mediaPaths = require("../lib/media-paths");
const {
  loadActiveLocalProofRepairStories,
} = require("./local-media-repair");

function parseArgs(argv) {
  const args = {
    limit: null,
    applyLimit: null,
    applyLocalAudio: false,
    outDir: OUT,
    queue: null,
    storyId: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--apply-limit") args.applyLimit = Number(argv[++i]);
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--queue") args.queue = argv[++i];
    else if (arg === "--story" || arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--apply-local-audio") args.applyLocalAudio = true;
    else if (arg === "--dry-run") {
      // Dry-run is the default mode; --apply-local-audio only writes local proof MP3s.
    }
  }
  return args;
}

function ffprobeDuration(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const raw = require("node:child_process").execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const parsed = Number(String(raw || "").trim());
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
  } catch (_) {
    return null;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return null;
  return fs.readJson(filePath);
}

function existingReadyStoryIds(report = {}) {
  return ((report && report.proof_batch?.applied) || [])
    .filter((row) => row?.verdict === "voice_ready" && row.story_id)
    .map((row) => row.story_id);
}

function existingRejectedProofsById(report = {}) {
  const out = {};
  for (const row of ((report && report.proof_batch?.applied) || [])) {
    if (!row?.story_id || row.verdict === "voice_ready" || !row.failure_code) continue;
    out[row.story_id] = row;
  }
  return out;
}

function activeProofStoryIdsFromQueue(queueReport = {}) {
  const ids = new Set();
  for (const item of queueReport?.items || []) {
    if (
      item?.repair_scope === "active_local_proof" ||
      item?.local_proof_repair === true ||
      item?.voice_audit?.readiness_scope === "active_local_proof"
    ) {
      const id = String(item.story_id || "").trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}

async function buildStoriesByIdWithActiveProof({
  stories = [],
  queueReport = {},
  localTestManifestPath,
} = {}) {
  const storiesById = Object.fromEntries((stories || []).map((story) => [story.id, story]));
  const activeStoryIds = activeProofStoryIdsFromQueue(queueReport);
  if (activeStoryIds.size === 0) return storiesById;
  const proofStories = await loadActiveLocalProofRepairStories({
    localTestManifestPath,
    existingStoryIds: new Set(),
    storyIdFilter: activeStoryIds,
  });
  for (const story of proofStories) {
    if (!story?.id) continue;
    storiesById[story.id] = {
      ...(storiesById[story.id] || {}),
      ...story,
      db_story_present: Boolean(storiesById[story.id]),
    };
  }
  return storiesById;
}

async function main() {
  const args = parseArgs(process.argv);
  const outDir = path.resolve(args.outDir || OUT);
  await fs.ensureDir(outDir);
  const queuePath = path.resolve(args.queue || path.join(outDir, "local_media_repair_queue.json"));
  if (!(await fs.pathExists(queuePath))) {
    throw new Error(`queue report not found: ${queuePath}. Run npm run ops:local-media-repair -- --dry-run first.`);
  }

  process.env.TTS_PROVIDER = "local";
  process.env.PULSE_SKIP_DOTENV = "true";
  const db = require("../lib/db");
  const audio = require("../audio");
  const stories = await db.getStories();
  const queueReport = await fs.readJson(queuePath);
  const storiesById = await buildStoriesByIdWithActiveProof({
    stories,
    queueReport,
    localTestManifestPath: path.join(outDir, "local_test_video_manifest.json"),
  });
  const overnightReport = await readJsonIfExists(
    path.join(outDir, "local_tts_overnight_report.json"),
  );
  const plan = buildLocalScriptExtensionPlan({
    queueReport,
    storiesById,
    cleanText: audio.cleanForTTS,
    limit: args.limit,
    storyId: args.storyId,
    existingReadyStoryIds: existingReadyStoryIds(overnightReport),
    existingRejectedProofsById: existingRejectedProofsById(overnightReport),
  });
  const jsonPath = path.join(outDir, "local_script_extension_plan.json");
  const mdPath = path.join(outDir, "local_script_extension_plan.md");
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeFile(mdPath, renderLocalScriptExtensionMarkdown(plan), "utf8");

  if (args.applyLocalAudio) {
    const ttsLimits = applyLocalProofTtsLimits();
    const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "default";
    console.log(
      `[local-script-extension] local_tts_timeout_ms=${ttsLimits.local_tts_timeout_ms} attempts=${ttsLimits.local_tts_request_attempts}`,
    );
    const applyReport = await applyLocalScriptExtensionAudio({
      plan,
      generateTts: audio.generateTTS,
      cleanText: audio.cleanForTTS,
      acousticProbe: probeLocalAudioAcoustics,
      recoverLocalTts: createLocalTtsBatchRecovery({
        root: ROOT,
        voiceId,
      }),
      measureDuration: async (outputRel) => {
        const outputAbs = await mediaPaths.resolveExisting(outputRel);
        return ffprobeDuration(outputAbs);
      },
      limit: args.applyLimit,
    });
    const applyPath = path.join(outDir, "local_script_extension_audio_apply.json");
    await fs.writeJson(applyPath, applyReport, { spaces: 2 });
    const historyPath = await archiveLocalTtsProofReport({
      outDir,
      source: "local_script_extension",
      report: applyReport,
    });
    console.log(
      `[local-script-extension] audio_apply=${path.relative(ROOT, applyPath)} applied=${applyReport.applied.length} skipped=${applyReport.skipped.length}`,
    );
    console.log(`[local-script-extension] audio_apply_history=${path.relative(ROOT, historyPath)}`);
  }

  console.log(
    `[local-script-extension] total=${plan.counts.total} ready=${plan.counts.ready} review=${plan.counts.review}`,
  );
  console.log(`[local-script-extension] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[local-script-extension] md=${path.relative(ROOT, mdPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[local-script-extension] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  activeProofStoryIdsFromQueue,
  buildStoriesByIdWithActiveProof,
  existingReadyStoryIds,
  existingRejectedProofsById,
  parseArgs,
};
