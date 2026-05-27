"use strict";

const cp = require("node:child_process");
const util = require("node:util");
const fs = require("fs-extra");
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ override: true });
const execFileAsync = util.promisify(cp.execFile);
const mediaPaths = require("../lib/media-paths");
const { measureAudioLoudness } = require("../lib/audio-quality");
const {
  buildTikTokDispatchManifest,
  renderTikTokDispatchMarkdown,
} = require("../lib/platforms/tiktok-dispatch");
const {
  buildFinalVoiceAudit,
} = require("../lib/studio/v2/final-voice-audit");
const {
  loadFinalVoiceReportsByStoryId,
} = require("../lib/studio/v2/final-voice-report-loader");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function probeDurationSeconds(story) {
  if (!story?.exported_path) return null;
  const candidate = mediaPaths.resolveExistingSync(story.exported_path);
  if (!fs.existsSync(candidate)) return null;
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
        candidate,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const parsed = Number(String(raw || "").trim());
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
  } catch (_) {
    return null;
  }
}

function renderFreshnessForStory(story, { now = new Date() } = {}) {
  if (!story?.exported_path) return null;
  const candidate = mediaPaths.resolveExistingSync(story.exported_path);
  if (!candidate || !fs.existsSync(candidate)) return null;
  try {
    const stats = fs.statSync(candidate);
    const lastModified = stats.mtime instanceof Date ? stats.mtime : new Date(stats.mtime);
    const ageHours = Math.max(0, (now.getTime() - lastModified.getTime()) / 3_600_000);
    return {
      path: candidate,
      lastModifiedIso: lastModified.toISOString(),
      ageHours,
    };
  } catch (_) {
    return null;
  }
}

function coverPathForStory(story) {
  return (
    story?.thumbnail_candidate_path ||
    story?.hf_thumbnail_path ||
    story?.story_image_path ||
    story?.image_path ||
    null
  );
}

function mediaExists(rawPath) {
  if (!rawPath) return false;
  const candidate = mediaPaths.resolveExistingSync(rawPath);
  return Boolean(candidate && fs.existsSync(candidate));
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function enrichVoiceReportForDispatch(report, opts = {}) {
  if (!report || typeof report !== "object") return report;
  const narration =
    report.narration ||
    report.voice ||
    report.audio?.narration ||
    report.audio?.voice ||
    null;
  if (!narration || typeof narration !== "object") return report;

  narration.acoustic =
    narration.acoustic && typeof narration.acoustic === "object"
      ? { ...narration.acoustic }
      : {};

  const durationSeconds = numberOrNull(
    narration.acoustic.durationSeconds ||
      narration.durationSeconds ||
      narration.duration_seconds,
  );
  if (!numberOrNull(narration.wpm) && durationSeconds) {
    const words = countWords(narration.transcript);
    if (words > 0) {
      narration.wpm = Math.round((words / durationSeconds) * 60);
    }
  }

  const hasLoudness =
    numberOrNull(narration.acoustic.integratedLufs) !== null ||
    numberOrNull(narration.acoustic.truePeakDb) !== null;
  if (hasLoudness) return report;

  const audioPath =
    narration.audioPath ||
    narration.audio_path ||
    narration.path ||
    null;
  const resolved = audioPath ? mediaPaths.resolveExistingSync(audioPath) : null;
  if (!resolved || !fs.existsSync(resolved)) return report;

  const loudness = await measureAudioLoudness({
    inputPath: resolved,
    execFileAsync: opts.execFileAsync || execFileAsync,
    env: opts.env || process.env,
  });
  if (loudness?.ok) {
    narration.acoustic.integratedLufs = loudness.integratedLufs;
    narration.acoustic.truePeakDb = loudness.truePeakDb;
    narration.acoustic.loudnessRange = loudness.loudnessRange;
    narration.acoustic.loudnessMeasured = true;
  }
  return report;
}

async function enrichVoiceReportsForDispatch(reportsByStoryId = {}, opts = {}) {
  const entries = Object.entries(reportsByStoryId || {});
  await Promise.all(
    entries.map(async ([storyId, report]) => {
      reportsByStoryId[storyId] = await enrichVoiceReportForDispatch(report, opts);
    }),
  );
  return reportsByStoryId;
}

function parseStoryIdArg(argv = process.argv.slice(2), env = process.env) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--story" || arg === "--story-id") {
      return String(argv[index + 1] || "").trim() || null;
    }
    if (arg.startsWith("--story=")) {
      return arg.slice("--story=".length).trim() || null;
    }
    if (arg.startsWith("--story-id=")) {
      return arg.slice("--story-id=".length).trim() || null;
    }
  }
  return String(env.TIKTOK_STORY_ID || "").trim() || null;
}

async function main() {
  await fs.ensureDir(OUT);
  const storyId = parseStoryIdArg();
  let tiktokTokenStatus = null;
  try {
    const { inspectTokenStatus } = require("../upload_tiktok");
    tiktokTokenStatus = await inspectTokenStatus();
  } catch (err) {
    tiktokTokenStatus = {
      ok: false,
      reason: `token_status_failed:${err.message}`,
      refresh_available: false,
      needs_reauth: true,
    };
  }
  const allStories = await require("../lib/db").getStories();
  const stories = storyId
    ? allStories.filter((story) => String(story?.id || "") === storyId)
    : allStories;
  const durationByStoryId = Object.fromEntries(
    stories.map((story) => [story.id, probeDurationSeconds(story)]),
  );
  const now = new Date();
  const renderFreshnessByStoryId = Object.fromEntries(
    stories.map((story) => [story.id, renderFreshnessForStory(story, { now })]),
  );
  const assetExistenceByStoryId = Object.fromEntries(
    stories.map((story) => [
      story.id,
      {
        mp4Exists: mediaExists(story.exported_path),
        coverExists: mediaExists(coverPathForStory(story)),
      },
    ]),
  );
  const finalFiles = stories.filter((story) => story.exported_path).map((story) => story.exported_path);
  const reportsByStoryId = await loadFinalVoiceReportsByStoryId(finalFiles, {
    outputDirs: [OUT],
  });
  await enrichVoiceReportsForDispatch(reportsByStoryId);
  const finalVoiceAudit = buildFinalVoiceAudit({
    files: finalFiles,
    reportsByStoryId,
  });
  const voiceAuditByStoryId = Object.fromEntries(
    finalVoiceAudit.rows.map((row) => [row.story_id, row]),
  );
  const manifest = buildTikTokDispatchManifest(stories, {
    durationByStoryId,
    voiceAuditByStoryId,
    renderFreshnessByStoryId,
    assetExistenceByStoryId,
    tiktokTokenStatus,
    storyId,
    now,
  });
  const jsonPath = path.join(OUT, "tiktok_dispatch_manifest.json");
  const mdPath = path.join(OUT, "tiktok_dispatch_manifest.md");
  const queuePath = path.join(OUT, "tiktok_dispatch_queue.json");
  const discordPath = path.join(OUT, "tiktok_dispatch_discord_sample.txt");
  await fs.writeJson(jsonPath, manifest, { spaces: 2 });
  await fs.writeJson(
    queuePath,
    {
      generatedAt: manifest.generatedAt,
      routePriority: manifest.routePriority,
      items: manifest.queue,
    },
    { spaces: 2 },
  );
  await fs.writeFile(mdPath, renderTikTokDispatchMarkdown(manifest), "utf8");
  await fs.writeFile(
    discordPath,
    `${manifest.sampleDiscordNotification || "No TikTok dispatch candidate ready."}\n`,
    "utf8",
  );
  console.log(`[tiktok-dispatch] packs=${manifest.count}`);
  if (storyId) console.log(`[tiktok-dispatch] story=${storyId}`);
  console.log(`[tiktok-dispatch] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[tiktok-dispatch] queue=${path.relative(ROOT, queuePath)}`);
  console.log(`[tiktok-dispatch] md=${path.relative(ROOT, mdPath)}`);
  console.log(`[tiktok-dispatch] discord=${path.relative(ROOT, discordPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = {
  enrichVoiceReportForDispatch,
  enrichVoiceReportsForDispatch,
};
