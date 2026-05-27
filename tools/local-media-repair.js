#!/usr/bin/env node
"use strict";

const cp = require("node:child_process");
const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const brand = require("../brand");
const mediaPaths = require("../lib/media-paths");
const {
  applyStaleAudioQaFailureReset,
  applyLocalAudioRepairs,
  buildLocalMediaRepairQueue,
  buildStaleAudioQaFailureResetPlan,
  renderLocalMediaRepairApplyMarkdown,
  renderLocalMediaRepairMarkdown,
  renderStaleAudioQaFailureResetMarkdown,
} = require("../lib/ops/local-media-repair");
const {
  applyLocalProofTtsLimits,
} = require("../lib/ops/local-proof-tts-limits");
const {
  createLocalTtsBatchRecovery,
} = require("../lib/ops/local-tts-batch-recovery");
const {
  archiveLocalTtsProofReport,
} = require("../lib/studio/local-tts-proof-report-loader");
const {
  probeLocalAudioAcoustics,
} = require("../lib/ops/local-acoustic-probe");
const {
  buildFinalVoiceAudit,
} = require("../lib/studio/v2/final-voice-audit");
const {
  loadFinalVoiceReportsByStoryId,
} = require("../lib/studio/v2/final-voice-report-loader");
const {
  DEFAULT_LOCAL_TTS_URL,
  fetchLocalTtsHealth,
} = require("../lib/studio/local-tts-readiness");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_LOCAL_MEDIA_REPAIR_TTS_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
  const args = {
    limit: null,
    applyLimit: null,
    applyLocal: false,
    applyLocalAudio: false,
    applyLocalReset: false,
    storyIds: [],
    outDir: OUT,
    ttsTimeoutMs: DEFAULT_LOCAL_MEDIA_REPAIR_TTS_TIMEOUT_MS,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--story" || arg === "--story-id") {
      args.storyIds.push(...String(argv[++i] || "").split(",").map((value) => value.trim()).filter(Boolean));
    }
    else if (arg.startsWith("--story=")) {
      args.storyIds.push(...arg.slice("--story=".length).split(",").map((value) => value.trim()).filter(Boolean));
    }
    else if (arg.startsWith("--story-id=")) {
      args.storyIds.push(...arg.slice("--story-id=".length).split(",").map((value) => value.trim()).filter(Boolean));
    }
    else if (arg === "--apply-limit") args.applyLimit = Number(argv[++i]);
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--tts-timeout-ms") args.ttsTimeoutMs = Number(argv[++i]);
    else if (arg.startsWith("--tts-timeout-ms=")) {
      args.ttsTimeoutMs = Number(arg.slice("--tts-timeout-ms=".length));
    }
    else if (arg === "--apply-local") args.applyLocal = true;
    else if (arg === "--apply-local-audio") {
      args.applyLocal = true;
      args.applyLocalAudio = true;
    }
    else if (arg === "--apply-local-reset") {
      args.applyLocal = true;
      args.applyLocalReset = true;
    }
    else if (arg === "--dry-run") args.applyLocal = false;
  }
  return args;
}

function ffprobeDuration(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const raw = cp.execFileSync(
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

function existingMediaFacts(story) {
  const audioAbs = story.audio_path
    ? mediaPaths.resolveExistingSync(story.audio_path)
    : null;
  const finalAbs = story.exported_path
    ? mediaPaths.resolveExistingSync(story.exported_path)
    : null;
  const audioExists = Boolean(audioAbs && fs.existsSync(audioAbs));
  const finalExists = Boolean(finalAbs && fs.existsSync(finalAbs));
  return {
    audioExists,
    finalExists,
    audioPath: audioAbs || story.audio_path || null,
    finalPath: finalAbs || story.exported_path || null,
    audioDurationSeconds: audioExists ? ffprobeDuration(audioAbs) : null,
    finalDurationSeconds: finalExists ? ffprobeDuration(finalAbs) : null,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const db = require("../lib/db");
  const outDir = path.resolve(args.outDir || OUT);
  await fs.ensureDir(outDir);

  const allStories = await db.getStories();
  const approvedStories = allStories.filter(
    (story) => story && (story.approved === true || story.auto_approved === true),
  );
  const storyIdFilter = new Set(args.storyIds);
  const filteredStories =
    storyIdFilter.size > 0
      ? approvedStories.filter((story) => storyIdFilter.has(story.id))
      : approvedStories;
  const stories =
    Number.isFinite(args.limit) && args.limit > 0
      ? filteredStories.slice(0, args.limit)
      : filteredStories;

  const mediaByStoryId = Object.fromEntries(
    stories.map((story) => [story.id, existingMediaFacts(story)]),
  );
  const finalFiles = stories
    .map((story) => mediaByStoryId[story.id]?.finalPath || story.exported_path)
    .filter(Boolean);
  const reportsByStoryId = await loadFinalVoiceReportsByStoryId(finalFiles, {
    outputDirs: [outDir, OUT],
  });
  const finalVoiceAudit = buildFinalVoiceAudit({
    files: finalFiles,
    reportsByStoryId,
  });
  const voiceAuditByStoryId = Object.fromEntries(
    finalVoiceAudit.rows.map((row) => [row.story_id, row]),
  );
  const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "default";
  const localTts = await fetchLocalTtsHealth({
    baseUrl: process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL,
    voiceId,
    timeoutMs: Number(process.env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
  });
  process.env.TTS_PROVIDER = "local";
  process.env.PULSE_SKIP_DOTENV = "true";
  const audio = require("../audio");

  const report = buildLocalMediaRepairQueue({
    stories,
    mediaByStoryId,
    voiceAuditByStoryId,
    localTts,
    cleanText: audio.cleanForTTS,
    dryRun: !args.applyLocal,
  });
  const jsonPath = path.join(outDir, "local_media_repair_queue.json");
  const mdPath = path.join(outDir, "local_media_repair_queue.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderLocalMediaRepairMarkdown(report), "utf8");
  const storiesById = Object.fromEntries(stories.map((story) => [story.id, story]));
  const resetPlan = buildStaleAudioQaFailureResetPlan({
    report,
    storiesById,
  });
  let resetApplyReport = null;
  if (args.applyLocalReset) {
    resetApplyReport = await applyStaleAudioQaFailureReset({
      plan: resetPlan,
      storiesById,
      persistStory: (story) => db.upsertStory(story),
    });
  }
  const resetPath = path.join(outDir, "local_media_repair_stale_qa_reset.json");
  const resetMdPath = path.join(outDir, "local_media_repair_stale_qa_reset.md");
  await fs.writeJson(
    resetPath,
    {
      plan: resetPlan,
      apply: resetApplyReport,
    },
    { spaces: 2 },
  );
  await fs.writeFile(
    resetMdPath,
    renderStaleAudioQaFailureResetMarkdown(resetPlan, resetApplyReport),
    "utf8",
  );

  if (args.applyLocalAudio) {
    if (!process.env.LOCAL_TTS_TIMEOUT_MS) {
      const configuredTimeout = Number(
        process.env.LOCAL_MEDIA_REPAIR_TTS_TIMEOUT_MS || args.ttsTimeoutMs,
      );
      process.env.LOCAL_TTS_TIMEOUT_MS = String(
        Number.isFinite(configuredTimeout) && configuredTimeout > 0
          ? Math.trunc(configuredTimeout)
          : DEFAULT_LOCAL_MEDIA_REPAIR_TTS_TIMEOUT_MS,
      );
    }
    const ttsLimits = applyLocalProofTtsLimits();
    console.log(
      `[local-media-repair] local_tts_timeout_ms=${ttsLimits.local_tts_timeout_ms} attempts=${ttsLimits.local_tts_request_attempts}`,
    );
    const applyReport = await applyLocalAudioRepairs({
      report,
      storiesById,
      outputRelDir: path.join("test", "output", "local-media-repair", "audio"),
      generateTts: audio.generateTTS,
      cleanText: audio.cleanForTTS,
      acousticProbe: probeLocalAudioAcoustics,
      recoverLocalTts: createLocalTtsBatchRecovery({
        root: ROOT,
        voiceId,
        baseUrl: process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL,
      }),
      measureDuration: async (outputRel) => {
        const outputAbs = await mediaPaths.resolveExisting(outputRel);
        return ffprobeDuration(outputAbs);
      },
      resolveOutputPath: async (outputRel) => mediaPaths.resolveExisting(outputRel),
      limit: args.applyLimit,
    });
    const applyPath = path.join(outDir, "local_media_repair_audio_apply.json");
    const applyMdPath = path.join(outDir, "local_media_repair_audio_apply.md");
    await fs.writeJson(applyPath, applyReport, { spaces: 2 });
    const historyPath = await archiveLocalTtsProofReport({
      outDir,
      source: "local_media_repair",
      report: applyReport,
    });
    await fs.writeFile(
      applyMdPath,
      renderLocalMediaRepairApplyMarkdown(applyReport),
      "utf8",
    );
    console.log(
      `[local-media-repair] audio_apply=${path.relative(ROOT, applyPath)} applied=${applyReport.applied.length} skipped=${applyReport.skipped.length}`,
    );
    console.log(`[local-media-repair] audio_apply_md=${path.relative(ROOT, applyMdPath)}`);
    console.log(`[local-media-repair] audio_apply_history=${path.relative(ROOT, historyPath)}`);
  }

  console.log(
    `[local-media-repair] total=${report.counts.total} ready=${report.counts.ready_local_repair} runtime_blocked=${report.counts.blocked_runtime} tts_blocked=${report.counts.blocked_local_tts} no_action=${report.counts.no_action}`,
  );
  console.log(
    `[local-media-repair] stale_qa_reset=${path.relative(ROOT, resetPath)} resettable=${resetPlan.resettable.length}${resetApplyReport ? ` applied=${resetApplyReport.applied.length}` : ""}`,
  );
  console.log(`[local-media-repair] stale_qa_reset_md=${path.relative(ROOT, resetMdPath)}`);
  console.log(`[local-media-repair] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[local-media-repair] md=${path.relative(ROOT, mdPath)}`);
  if (args.applyLocal && !args.applyLocalAudio && !args.applyLocalReset) {
    console.log("[local-media-repair] apply-local is reserved for media-only repair; this command did not post or mutate the DB.");
  }
  if (args.applyLocalReset) {
    console.log("[local-media-repair] apply-local-reset cleared only stale local TTS outage rows; it did not post or touch tokens.");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[local-media-repair] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_LOCAL_MEDIA_REPAIR_TTS_TIMEOUT_MS,
  parseArgs,
};
