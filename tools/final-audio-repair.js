#!/usr/bin/env node
"use strict";

const cp = require("node:child_process");
const util = require("node:util");
const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

const mediaPaths = require("../lib/media-paths");
const {
  measureAudioLoudness,
  repairFinalVideoAudioLoudness,
  repairTtsAudioFileLoudness,
} = require("../lib/audio-quality");

dotenv.config({ override: true });

const execFileAsync = util.promisify(cp.execFile);
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyIds: [],
    limit: 8,
    applyLocal: false,
    dryRun: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--story" || arg === "--story-id") args.storyIds.push(String(argv[++i] || "").trim());
    else if (arg.startsWith("--story=")) args.storyIds.push(arg.slice("--story=".length).trim());
    else if (arg.startsWith("--story-id=")) args.storyIds.push(arg.slice("--story-id=".length).trim());
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--apply-local") {
      args.applyLocal = true;
      args.dryRun = false;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
      args.applyLocal = false;
    }
  }
  args.storyIds = args.storyIds.filter(Boolean);
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 8;
  return args;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function needsAudioRepair(acoustic = {}) {
  if (acoustic?.ok === false) return false;
  const lufs = numberOrNull(acoustic.integratedLufs);
  const peak = numberOrNull(acoustic.truePeakDb);
  return (
    peak === null ||
    peak > -1 ||
    (lufs !== null && lufs > -13.5)
  );
}

function relForReport(filePath) {
  if (!filePath) return null;
  const absolute = path.resolve(filePath);
  const rel = path.relative(ROOT, absolute);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : absolute;
}

async function readStories(args) {
  const stories = await require("../lib/db").getStories();
  const filtered = args.storyIds.length
    ? stories.filter((story) => args.storyIds.includes(String(story?.id || "")))
    : stories.filter((story) => story?.audio_path || story?.exported_path);
  return filtered.slice(0, args.limit);
}

async function measureFile(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) {
    return {
      ok: false,
      code: "file_missing",
      integratedLufs: null,
      truePeakDb: null,
      loudnessRange: null,
    };
  }
  return measureAudioLoudness({ inputPath: filePath, execFileAsync, env: process.env });
}

async function updateTimestampSidecar({ audioPath, audioRepair, finalRepair }) {
  const timestampsPath = audioPath.replace(/\.mp3$/i, "_timestamps.json");
  if (!(await fs.pathExists(timestampsPath))) return null;
  const payload = await fs.readJson(timestampsPath);
  payload.meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  payload.meta.acoustic =
    payload.meta.acoustic && typeof payload.meta.acoustic === "object"
      ? payload.meta.acoustic
      : {};
  if (audioRepair?.acoustic) {
    payload.meta.acoustic = {
      ...payload.meta.acoustic,
      ...audioRepair.acoustic,
    };
  }
  payload.meta.voiceMastering = {
    ...(payload.meta.voiceMastering || {}),
    ok: true,
    code: "voice_mastered",
    targetLufs: audioRepair?.targetLufs ?? payload.meta.voiceMastering?.targetLufs ?? -16,
    truePeak: audioRepair?.truePeak ?? payload.meta.voiceMastering?.truePeak ?? -2.2,
    repaired_for_final_dispatch: true,
  };
  payload.meta.finalAudioRepair = {
    ok: finalRepair?.ok === true,
    code: finalRepair?.code || null,
    repairedAt: new Date().toISOString(),
    backupPath: relForReport(finalRepair?.backupPath),
    finalAcoustic: finalRepair?.after?.acoustic || null,
  };
  await fs.writeJson(timestampsPath, payload, { spaces: 2 });
  return timestampsPath;
}

async function inspectStory(story, args) {
  const audioPath = story?.audio_path ? mediaPaths.resolveExistingSync(story.audio_path) : null;
  const finalPath = story?.exported_path ? mediaPaths.resolveExistingSync(story.exported_path) : null;
  const audioBefore = await measureFile(audioPath);
  const finalBefore = await measureFile(finalPath);
  const audioNeedsRepair = needsAudioRepair(audioBefore);
  const finalNeedsRepair = needsAudioRepair(finalBefore);
  const result = {
    storyId: story?.id || null,
    title: story?.title || "",
    audioPath: relForReport(audioPath),
    finalPath: relForReport(finalPath),
    audioBefore,
    finalBefore,
    audioNeedsRepair,
    finalNeedsRepair,
    action: args.applyLocal && (audioNeedsRepair || finalNeedsRepair) ? "applied_local_repair" : "dry_run_only",
    audioRepair: null,
    finalRepair: null,
    timestampSidecarUpdated: null,
  };

  if (!args.applyLocal || (!audioNeedsRepair && !finalNeedsRepair)) return result;

  if (audioNeedsRepair && audioPath && (await fs.pathExists(audioPath))) {
    result.audioRepair = await repairTtsAudioFileLoudness({
      inputPath: audioPath,
      execFileAsync,
      env: process.env,
    });
  }
  if (finalNeedsRepair && finalPath && (await fs.pathExists(finalPath))) {
    result.finalRepair = await repairFinalVideoAudioLoudness({
      inputPath: finalPath,
      execFileAsync,
      env: process.env,
    });
  }
  if (audioPath && (result.audioRepair?.ok || result.finalRepair?.ok)) {
    result.timestampSidecarUpdated = relForReport(
      await updateTimestampSidecar({
        audioPath,
        audioRepair: result.audioRepair,
        finalRepair: result.finalRepair,
      }),
    );
  }
  result.audioAfter = await measureFile(audioPath);
  result.finalAfter = await measureFile(finalPath);
  return result;
}

function renderMarkdown(report) {
  const lines = [
    "# Final Audio Repair",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Stories inspected: ${report.rows.length}`,
    `Repairs applied: ${report.counts?.applied || 0}`,
    "",
    "## Rows",
  ];
  for (const row of report.rows) {
    const beforeAudioPeak = numberOrNull(row.audioBefore?.truePeakDb);
    const beforeFinalPeak = numberOrNull(row.finalBefore?.truePeakDb);
    const afterAudioPeak = numberOrNull(row.audioAfter?.truePeakDb);
    const afterFinalPeak = numberOrNull(row.finalAfter?.truePeakDb);
    lines.push(
      `- ${row.storyId}: ${row.action} audioPeak=${beforeAudioPeak ?? "unknown"} -> ${afterAudioPeak ?? "n/a"} finalPeak=${beforeFinalPeak ?? "unknown"} -> ${afterFinalPeak ?? "n/a"} sidecar=${row.timestampSidecarUpdated || "unchanged"}`,
    );
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- local output media only");
  lines.push("- MP3/MP4 backups are written before replacement");
  lines.push("- no DB writes, token changes, OAuth or social posting");
  return lines.join("\n") + "\n";
}

async function main() {
  const args = parseArgs();
  await fs.ensureDir(OUT);
  const stories = await readStories(args);
  const rows = [];
  for (const story of stories) {
    rows.push(await inspectStory(story, args));
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: args.applyLocal ? "apply-local" : "dry-run",
    storyFilter: args.storyIds.length ? args.storyIds : null,
    counts: {
      inspected: rows.length,
      needingRepair: rows.filter((row) => row.audioNeedsRepair || row.finalNeedsRepair).length,
      applied: rows.filter((row) => row.audioRepair?.ok || row.finalRepair?.ok).length,
    },
    rows,
    safety: {
      mutatesDb: false,
      mutatesTokens: false,
      postsToPlatforms: false,
      writesLocalMedia: args.applyLocal,
    },
  };
  const jsonPath = path.join(OUT, "final_audio_repair.json");
  const mdPath = path.join(OUT, "final_audio_repair.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderMarkdown(report), "utf8");
  console.log(`[final-audio-repair] mode=${report.mode} inspected=${report.counts.inspected} needs=${report.counts.needingRepair} applied=${report.counts.applied}`);
  console.log(`[final-audio-repair] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[final-audio-repair] md=${path.relative(ROOT, mdPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[final-audio-repair] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  inspectStory,
  needsAudioRepair,
  parseArgs,
  renderMarkdown,
};
