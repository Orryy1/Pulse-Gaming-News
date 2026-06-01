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
const GOAL_CONTRACT_OUT = path.join(ROOT, "output", "goal-contract");
const DEFAULT_FINAL_VOICE_AUDIT_PATH = path.join(GOAL_CONTRACT_OUT, "final_voice_audit.json");
const DEFAULT_LOCAL_TEST_VIDEO_MANIFEST_PATH = path.join(GOAL_CONTRACT_OUT, "local_test_video_manifest.json");
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

function localRepairAudioRelPath(storyId) {
  return path.join(
    "test",
    "output",
    "local-media-repair",
    "audio",
    `${String(storyId || "unknown").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 96)}_liam.mp3`,
  );
}

function localRepairTimestampsPath(audioPath) {
  return String(audioPath || "").replace(/\.mp3$/i, "_timestamps.json");
}

function resolveExistingLocalRepairAudio(story, opts = {}) {
  const resolveExistingSync = opts.resolveExistingSync || mediaPaths.resolveExistingSync;
  const existsSync = opts.existsSync || fs.existsSync;
  const storyId = story?.id;
  if (!storyId) return null;
  const audioRel = localRepairAudioRelPath(storyId);
  const audioAbs = resolveExistingSync(audioRel);
  const timestampAbs = localRepairTimestampsPath(audioAbs);
  if (!audioAbs || !existsSync(audioAbs) || !existsSync(timestampAbs)) return null;
  return {
    audioRel,
    audioAbs,
    timestampAbs,
  };
}

function normalizeFileKey(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  return path.normalize(path.resolve(filePath)).toLowerCase();
}

function activeLocalProofVideoPathSet(manifest = {}) {
  const paths = new Set();
  const videos = Array.isArray(manifest.videos) ? manifest.videos : [];
  for (const video of videos) {
    const key = normalizeFileKey(video?.video_path || video?.videoPath);
    if (key) paths.add(key);
  }
  return paths;
}

function voiceAuditSeverity(row = {}) {
  const verdict = String(row.verdict || "").toLowerCase();
  if (verdict === "reject") return 30;
  if (verdict === "review") return 20;
  if (verdict === "pass") return 10;
  return 0;
}

function preferVoiceAuditRow(a, b) {
  if (!a) return b;
  if (!b) return a;
  const score = (row) =>
    voiceAuditSeverity(row) +
    (Array.isArray(row.blockers) && row.blockers.length ? 4 : 0) +
    (Array.isArray(row.warnings) && row.warnings.length ? 1 : 0);
  return score(b) > score(a) ? b : a;
}

function voiceAuditByStoryIdFromRows(rows = {}) {
  const byStoryId = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.story_id) continue;
    byStoryId[row.story_id] = preferVoiceAuditRow(byStoryId[row.story_id], row);
  }
  return byStoryId;
}

async function loadJsonIfExists(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) return null;
  return fs.readJson(resolved);
}

async function readProofSidecars(videoPath) {
  const dir = path.dirname(path.resolve(videoPath));
  const [canonical, narration] = await Promise.all([
    loadJsonIfExists(path.join(dir, "canonical_story_manifest.json")),
    loadJsonIfExists(path.join(dir, "narration_manifest.json")),
  ]);
  return { dir, canonical: canonical || {}, narration: narration || {} };
}

function textFromProofSidecars({ canonical = {}, narration = {} } = {}) {
  return (
    canonical.tts_script ||
    canonical.full_script ||
    canonical.narration_script ||
    narration.final_transcript ||
    narration.transcript ||
    ""
  );
}

async function loadActiveLocalProofRepairStories({
  localTestManifestPath = DEFAULT_LOCAL_TEST_VIDEO_MANIFEST_PATH,
  existingStoryIds = new Set(),
  storyIdFilter = new Set(),
} = {}) {
  const manifest = await loadJsonIfExists(localTestManifestPath);
  const videos = Array.isArray(manifest?.videos) ? manifest.videos : [];
  const existing = existingStoryIds instanceof Set ? existingStoryIds : new Set(existingStoryIds || []);
  const filter = storyIdFilter instanceof Set ? storyIdFilter : new Set(storyIdFilter || []);
  const stories = [];
  for (const video of videos) {
    const storyId = String(video?.story_id || "").trim();
    const videoPath = video?.video_path || video?.videoPath;
    if (!storyId || !videoPath) continue;
    if (existing.has(storyId)) continue;
    if (filter.size > 0 && !filter.has(storyId)) continue;
    const sidecars = await readProofSidecars(videoPath);
    const script = textFromProofSidecars(sidecars);
    stories.push({
      id: storyId,
      title:
        video.title ||
        sidecars.canonical.selected_title ||
        sidecars.canonical.short_title ||
        sidecars.canonical.canonical_title ||
        storyId,
      approved: true,
      auto_approved: false,
      local_proof_repair: true,
      repair_scope: "active_local_proof",
      publish_status: video.publish_status || "not_publishable_local_proof",
      full_script: script,
      tts_script: script,
      body: [
        sidecars.canonical.canonical_subject,
        sidecars.canonical.canonical_game,
        sidecars.canonical.canonical_company,
      ].filter(Boolean).join(" "),
      subreddit:
        sidecars.canonical.vertical === "gaming" || sidecars.canonical.canonical_game
          ? "gaming"
          : undefined,
      content_pillar:
        sidecars.canonical.vertical === "gaming" || sidecars.canonical.canonical_game
          ? "gaming"
          : sidecars.canonical.canonical_angle,
      word_count: Number(sidecars.canonical.word_count || 0) || undefined,
      source_confidence_score: sidecars.canonical.source_confidence_score ?? null,
      audio_path:
        sidecars.narration.resolved_audio_path ||
        sidecars.narration.audio_path ||
        null,
      exported_path: path.resolve(videoPath),
      breaking_score: 0,
    });
  }
  return stories;
}

async function loadActiveFinalVoiceAuditByStoryId({
  auditPath = DEFAULT_FINAL_VOICE_AUDIT_PATH,
  localTestManifestPath = DEFAULT_LOCAL_TEST_VIDEO_MANIFEST_PATH,
} = {}) {
  const [audit, manifest] = await Promise.all([
    loadJsonIfExists(auditPath),
    loadJsonIfExists(localTestManifestPath),
  ]);
  if (!audit || !manifest) return {};
  const activePaths = activeLocalProofVideoPathSet(manifest);
  if (activePaths.size === 0) return {};
  const activeRows = (Array.isArray(audit.rows) ? audit.rows : [])
    .filter((row) => activePaths.has(normalizeFileKey(row?.mp4_path)))
    .map((row) => ({
      ...row,
      readiness_scope: "active_local_proof",
      source_report_path: path.resolve(auditPath),
      local_test_manifest_path: path.resolve(localTestManifestPath),
    }));
  return voiceAuditByStoryIdFromRows(activeRows);
}

function existingMediaFacts(story, opts = {}) {
  const resolveExistingSync = opts.resolveExistingSync || mediaPaths.resolveExistingSync;
  const existsSync = opts.existsSync || fs.existsSync;
  const measureDuration = opts.measureDuration || ffprobeDuration;
  const audioAbs = story.audio_path
    ? resolveExistingSync(story.audio_path)
    : null;
  const finalAbs = story.exported_path
    ? resolveExistingSync(story.exported_path)
    : null;
  const recoveredLocalRepairAudio =
    audioAbs && existsSync(audioAbs)
      ? null
      : resolveExistingLocalRepairAudio(story, {
          resolveExistingSync,
          existsSync,
        });
  const selectedAudioAbs = audioAbs && existsSync(audioAbs)
    ? audioAbs
    : recoveredLocalRepairAudio?.audioAbs || audioAbs;
  const audioExists = Boolean(selectedAudioAbs && existsSync(selectedAudioAbs));
  const finalExists = Boolean(finalAbs && existsSync(finalAbs));
  return {
    audioExists,
    finalExists,
    audioPath: selectedAudioAbs || story.audio_path || null,
    finalPath: finalAbs || story.exported_path || null,
    audioDurationSeconds: audioExists ? measureDuration(selectedAudioAbs) : null,
    finalDurationSeconds: finalExists ? measureDuration(finalAbs) : null,
    recoveredLocalRepairAudio: Boolean(recoveredLocalRepairAudio),
    localRepairAudioPath: recoveredLocalRepairAudio?.audioAbs || null,
    localRepairTimestampsPath: recoveredLocalRepairAudio?.timestampAbs || null,
    localRepairTimestampsExist: Boolean(recoveredLocalRepairAudio?.timestampAbs),
  };
}

function applyActiveProofMediaFacts({
  mediaByStoryId = {},
  activeProofVoiceAuditByStoryId = {},
  existsSync = fs.existsSync,
  measureDuration = ffprobeDuration,
} = {}) {
  for (const [storyId, audit] of Object.entries(activeProofVoiceAuditByStoryId || {})) {
    if (audit?.readiness_scope !== "active_local_proof") continue;
    const media = mediaByStoryId[storyId] || {};
    const mp4Path = audit.mp4_path ? path.resolve(audit.mp4_path) : null;
    const audioPath = audit.voice_path?.audio_path
      ? path.resolve(audit.voice_path.audio_path)
      : null;
    if (mp4Path && existsSync(mp4Path) && !media.finalExists) {
      media.finalExists = true;
      media.finalPath = mp4Path;
      media.finalDurationSeconds = measureDuration(mp4Path);
      media.activeProofFinalPath = mp4Path;
      media.activeProofMediaEvidence = true;
    }
    if (audioPath && existsSync(audioPath) && !media.audioExists) {
      media.audioExists = true;
      media.audioPath = audioPath;
      media.audioDurationSeconds = measureDuration(audioPath);
      media.activeProofAudioPath = audioPath;
      media.activeProofMediaEvidence = true;
    }
    mediaByStoryId[storyId] = media;
  }
  return mediaByStoryId;
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
  const activeProofStories = await loadActiveLocalProofRepairStories({
    existingStoryIds: new Set(stories.map((story) => story.id)),
    storyIdFilter,
  });
  const repairStories = [...stories, ...activeProofStories];

  const mediaByStoryId = Object.fromEntries(
    repairStories.map((story) => [story.id, existingMediaFacts(story)]),
  );
  const finalFiles = repairStories
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
  const activeProofVoiceAuditByStoryId = await loadActiveFinalVoiceAuditByStoryId();
  Object.assign(voiceAuditByStoryId, activeProofVoiceAuditByStoryId);
  applyActiveProofMediaFacts({
    mediaByStoryId,
    activeProofVoiceAuditByStoryId,
  });
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
    stories: repairStories,
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
  const storiesById = Object.fromEntries(repairStories.map((story) => [story.id, story]));
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
  applyActiveProofMediaFacts,
  existingMediaFacts,
  loadActiveFinalVoiceAuditByStoryId,
  loadActiveLocalProofRepairStories,
  parseArgs,
};
