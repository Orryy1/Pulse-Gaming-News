"use strict";

const fs = require("fs-extra");
const path = require("node:path");

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normaliseWords(payload = {}) {
  const rows = Array.isArray(payload)
    ? payload
    : payload.words || payload.word_timestamps || payload.timestamps?.words;
  return asArray(rows)
    .map((word) => ({
      text: cleanText(word.word || word.text || word.token),
      start: Number(word.start ?? word.start_s ?? word.startTime ?? word.start_time),
      end: Number(word.end ?? word.end_s ?? word.endTime ?? word.end_time),
    }))
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .sort((left, right) => left.start - right.start);
}

function formatSrtTime(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)},${pad(millis, 3)}`;
}

function cueShouldBreak({ cueWords = [], nextWord = {}, maxWords = 7, maxChars = 48, maxDurationS = 2.8 } = {}) {
  if (!cueWords.length) return false;
  const currentText = cueWords.map((word) => word.text).join(" ");
  const projectedText = [currentText, nextWord.text].filter(Boolean).join(" ");
  const first = cueWords[0];
  const duration = Number(nextWord.end) - Number(first.start);
  const lastText = cleanText(cueWords[cueWords.length - 1]?.text);
  return (
    cueWords.length >= maxWords ||
    projectedText.length > maxChars ||
    duration > maxDurationS ||
    /[.!?]$/.test(lastText)
  );
}

function buildWordTimedSrt(words = [], { scale = 1, maxWords = 7, maxChars = 48, maxDurationS = 2.8 } = {}) {
  const normalised = normaliseWords(words);
  if (!normalised.length) return "";

  const cues = [];
  let cueWords = [];
  const flush = () => {
    if (!cueWords.length) return;
    cues.push(cueWords);
    cueWords = [];
  };

  for (const word of normalised) {
    if (cueShouldBreak({ cueWords, nextWord: word, maxWords, maxChars, maxDurationS })) flush();
    cueWords.push(word);
  }
  flush();

  while (cues.length > 1) {
    const last = cues[cues.length - 1];
    const previous = cues[cues.length - 2];
    const lastDuration = last[last.length - 1].end - last[0].start;
    const mergedText = [...previous, ...last].map((word) => word.text).join(" ");
    const mergedDuration = last[last.length - 1].end - previous[0].start;
    const danglingTail = last.length <= 2 || lastDuration < 0.45;
    if (!danglingTail || mergedText.length > Math.max(maxChars + 18, 66) || mergedDuration > maxDurationS + 1.8) break;
    cues.splice(cues.length - 2, 2, [...previous, ...last]);
  }

  return `${cues
    .map((cue, index) => {
      const start = cue[0].start * scale;
      const end = cue[cue.length - 1].end * scale;
      const text = cue.map((word) => word.text).join(" ");
      return [String(index + 1), `${formatSrtTime(start)} --> ${formatSrtTime(end)}`, text].join("\n");
    })
    .join("\n\n")}\n`;
}

function srtLastEndSeconds(text = "") {
  let lastEnd = null;
  for (const line of String(text || "").split(/\r?\n/g)) {
    const match = line.match(/-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/);
    if (!match) continue;
    const [, hours, minutes, seconds, millis] = match;
    lastEnd =
      Number(hours) * 3600 +
      Number(minutes) * 60 +
      Number(seconds) +
      Number(String(millis).padEnd(3, "0").slice(0, 3)) / 1000;
  }
  return lastEnd;
}

function lastWordEndSeconds(words = []) {
  const normalised = normaliseWords(words);
  if (!normalised.length) return null;
  return Math.max(...normalised.map((word) => word.end));
}

async function readJsonIfPresent(filePath, fallback = null) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

function variantCaptionsPath(artifactDir, platform, output = {}) {
  return cleanText(output.platform_variant_render?.captions_path) ||
    cleanText(output.variant_captions_path) ||
    path.join(artifactDir, "platform_variants", platform, `captions_${platform}.srt`);
}

function variantDuration(output = {}) {
  return Number(
    output.platform_variant_render?.duration_s ||
      output.platform_variant_render?.probed_duration_s ||
      output.duration_s ||
      output.video_duration_s,
  );
}

async function repairCaptionTimeline({
  artifactDir = "",
  storyId = "",
  apply = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!artifactDir) throw new Error("repairCaptionTimeline requires artifactDir");
  const resolvedArtifactDir = path.resolve(artifactDir);
  const timestampPath = path.join(resolvedArtifactDir, "audio", "word_timestamps.json");
  const timestampPayload = await readJsonIfPresent(timestampPath, null);
  const words = normaliseWords(timestampPayload || {});
  const lastWordEnd = lastWordEndSeconds(words);
  const baseCaptionsPath = path.join(resolvedArtifactDir, "captions.srt");
  const baseSrt = buildWordTimedSrt(words);
  const baseLastEnd = srtLastEndSeconds(baseSrt);
  const platformManifestPath = path.join(resolvedArtifactDir, "platform_publish_manifest.json");
  const platformManifest = await readJsonIfPresent(platformManifestPath, {});
  const outputs = platformManifest.outputs || {};

  const variantRepairs = [];
  for (const [platform, output] of Object.entries(outputs)) {
    const duration = variantDuration(output);
    const render = cleanText(output.platform_variant_render?.output_path || output.platform_variant_render?.path);
    if (!render || !Number.isFinite(duration) || duration <= 0 || !words.length || !lastWordEnd) continue;
    const scale = Math.min(1, Math.max(0.1, duration / lastWordEnd));
    const captionsPath = variantCaptionsPath(resolvedArtifactDir, platform, output);
    const srt = buildWordTimedSrt(words, { scale });
    variantRepairs.push({
      platform,
      captions_path: captionsPath,
      render_path: render,
      duration_s: duration,
      scale,
      last_caption_end_s: srtLastEndSeconds(srt),
      srt,
    });
  }

  if (apply) {
    if (!words.length) throw new Error(`word timestamps missing or unusable: ${timestampPath}`);
    await fs.outputFile(baseCaptionsPath, baseSrt, "utf8");
    for (const repair of variantRepairs) {
      await fs.outputFile(repair.captions_path, repair.srt, "utf8");
    }
    await fs.writeJson(path.join(resolvedArtifactDir, "caption_manifest.json"), {
      schema_version: 1,
      story_id: storyId || platformManifest.story_id || path.basename(resolvedArtifactDir),
      generated_at: generatedAt,
      status: "ready",
      caption_srt_path: baseCaptionsPath,
      resolved_caption_srt_path: baseCaptionsPath,
      word_timestamps_path: timestampPath,
      resolved_word_timestamps_path: timestampPath,
      captions_source: "word_timestamps",
      caption_generator: "caption_timeline_repair_word_timed_srt",
      word_count: words.length,
      base_last_caption_end_s: baseLastEnd,
      word_timestamp_last_end_s: lastWordEnd,
      variant_caption_repairs: variantRepairs.map(({ srt, ...repair }) => repair),
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
    }, { spaces: 2 });
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "CAPTION_TIMELINE_REPAIR",
    applied: Boolean(apply),
    story_id: storyId || platformManifest.story_id || path.basename(resolvedArtifactDir),
    artifact_dir: resolvedArtifactDir,
    word_timestamps_path: timestampPath,
    word_count: words.length,
    word_timestamp_last_end_s: lastWordEnd,
    base_captions_path: baseCaptionsPath,
    base_last_caption_end_s: baseLastEnd,
    variant_repairs: variantRepairs.map(({ srt, ...repair }) => repair),
    blockers: words.length ? [] : ["word_timestamps_missing_or_unusable"],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

async function writeCaptionTimelineRepairReport(report = {}, { outputDir } = {}) {
  const outDir = path.resolve(outputDir || path.join(process.cwd(), "output", "goal-contract"));
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "caption_timeline_repair_report.json");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  return { jsonPath };
}

module.exports = {
  buildWordTimedSrt,
  formatSrtTime,
  lastWordEndSeconds,
  normaliseWords,
  repairCaptionTimeline,
  srtLastEndSeconds,
  writeCaptionTimelineRepairReport,
};
