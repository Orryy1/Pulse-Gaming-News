"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync } = require("node:child_process");
const sharp = require("sharp");
const {
  classifyTrailerFrameTaste,
  prescanImage,
} = require("../../visual-content-prescan");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_OUT = path.join(ROOT, "test", "output");

function toPosix(p) {
  return String(p || "").replace(/\\/g, "/");
}

function relativeToRoot(p) {
  return toPosix(path.relative(ROOT, p));
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function median(values) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function assTimeToSeconds(value) {
  const parts = String(value || "").trim().split(":").map(Number.parseFloat);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function srtTimeToSeconds(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?$/);
  if (!match) return 0;
  const [, hh, mm, ss, frac = "0"] = match;
  const ms = Number(frac.padEnd(3, "0").slice(0, 3));
  return (
    Number(hh) * 3600 +
    Number(mm) * 60 +
    Number(ss) +
    (Number.isFinite(ms) ? ms / 1000 : 0)
  );
}

function sortCuesByStart(cues) {
  return cues
    .slice()
    .sort(
      (a, b) =>
        a.startS - b.startS ||
        a.endS - b.endS ||
        safeNumber(a.sourceIndex, 0) - safeNumber(b.sourceIndex, 0),
    );
}

function parseAssDialogues(assPath, { sort = true } = {}) {
  if (!assPath || !fs.existsSync(assPath)) return [];
  const txt = fs.readFileSync(assPath, "utf8");
  let sourceIndex = 0;
  const cues = txt
    .split(/\r?\n/)
    .map((line, idx) => {
      if (!line.startsWith("Dialogue:")) return null;
      const match = line.match(/^Dialogue:\s*\d+,([^,]+),([^,]+),([^,]*),[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)$/);
      if (!match) return null;
      const rawText = match[4];
      return {
        format: "ass",
        sourceIndex: sourceIndex++,
        lineNumber: idx + 1,
        startS: assTimeToSeconds(match[1]),
        endS: assTimeToSeconds(match[2]),
        style: match[3],
        rawText,
        text: cleanCaptionText(rawText).replace(/\s+/g, " ").trim(),
        visualLineCount: Math.max(1, rawText.split(/\\[Nn]/g).length),
      };
    })
    .filter(Boolean);
  return sort ? sortCuesByStart(cues) : cues;
}

function parseSrtCues(srtPath, { sort = true } = {}) {
  if (!srtPath || !fs.existsSync(srtPath)) return [];
  const txt = fs.readFileSync(srtPath, "utf8").replace(/\r\n/g, "\n");
  const cues = [];
  const blocks = txt.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex < 0) continue;
    const match = lines[timeLineIndex].match(
      /(\d+:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d+:\d{2}:\d{2}[,.]\d{1,3})/,
    );
    if (!match) continue;
    const rawText = lines.slice(timeLineIndex + 1).join("\n").trim();
    cues.push({
      format: "srt",
      sourceIndex: cues.length,
      lineNumber: txt.slice(0, txt.indexOf(block)).split("\n").length,
      startS: srtTimeToSeconds(match[1]),
      endS: srtTimeToSeconds(match[2]),
      style: "",
      rawText,
      text: cleanCaptionText(rawText).replace(/\s+/g, " ").trim(),
      visualLineCount: Math.max(1, rawText.split(/\n/g).filter(Boolean).length),
    });
  }
  return sort ? sortCuesByStart(cues) : cues;
}

function parseSubtitleCues({
  assPath = null,
  srtPath = null,
  subtitlePath = null,
  sort = true,
} = {}) {
  const selectedPath = subtitlePath || srtPath || assPath;
  if (!selectedPath) return [];
  if (path.extname(selectedPath).toLowerCase() === ".srt" || (srtPath && !subtitlePath)) {
    return parseSrtCues(selectedPath, { sort });
  }
  return parseAssDialogues(selectedPath, { sort });
}

function cleanCaptionText(value) {
  return String(value || "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\h/g, " ")
    .replace(/\\[Nn]/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function captionWordCount(value) {
  const clean = cleanCaptionText(value);
  if (!clean) return 0;
  return clean.split(/[^\p{L}\p{N}'-]+/u).filter(Boolean).length;
}

const TRANSCRIPT_COVERAGE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "you",
  "your",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "but",
  "not",
  "now",
  "today",
]);

function captionCompareText(value) {
  return cleanCaptionText(value)
    .toLocaleLowerCase("en-GB")
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coverageTokens(value) {
  return (
    captionCompareText(value)
      .match(/[\p{L}\p{N}'-]+/gu)
      ?.filter((token) => token.length >= 3 && !TRANSCRIPT_COVERAGE_STOPWORDS.has(token)) ||
    []
  );
}

function analyseCaptionTranscriptCoverage({
  cues = [],
  transcriptText = "",
  warnCoverageRatio = 0.65,
  failCoverageRatio = 0.35,
} = {}) {
  const transcriptTokens = coverageTokens(transcriptText);
  const captionTokens = coverageTokens(cues.map((cue) => cue.text || cue.rawText || "").join(" "));
  if (transcriptTokens.length < 8) {
    return {
      verdict: "pass",
      ratio: null,
      transcriptTokenCount: transcriptTokens.length,
      captionTokenCount: captionTokens.length,
      reason: "transcript_unavailable_or_too_short",
    };
  }

  const captionSet = new Set(captionTokens);
  const matchedTokenCount = transcriptTokens.filter((token) => captionSet.has(token)).length;
  const ratio = transcriptTokens.length
    ? matchedTokenCount / transcriptTokens.length
    : 1;
  const verdict =
    ratio < failCoverageRatio ? "fail" : ratio < warnCoverageRatio ? "warn" : "pass";

  return {
    verdict,
    ratio: round(ratio, 3),
    transcriptTokenCount: transcriptTokens.length,
    captionTokenCount: captionTokens.length,
    matchedTokenCount,
    failCoverageRatio,
    warnCoverageRatio,
  };
}

function analyseSubtitleTimeline({
  assPath = null,
  srtPath = null,
  subtitlePath = null,
  durationS,
  transcriptText = "",
  nearZeroDurationS = 0.05,
  warnCoverageRatio = 0.65,
  failCoverageRatio = 0.35,
} = {}) {
  const dialogues = parseSubtitleCues({
    assPath,
    srtPath,
    subtitlePath,
    sort: false,
  });
  const chronologicalDialogues = sortCuesByStart(dialogues);
  const gaps = [];
  const overlappingCues = [];
  const nonMonotonicCues = [];
  const repeatedTextCues = [];
  const nearZeroDurationCues = dialogues
    .map((cue) => ({
      sourceIndex: cue.sourceIndex,
      lineNumber: cue.lineNumber,
      startS: round(cue.startS, 3),
      endS: round(cue.endS, 3),
      durationS: round(cue.endS - cue.startS, 3),
      text: cue.text,
    }))
    .filter((cue) => safeNumber(cue.durationS, 0) <= nearZeroDurationS);

  for (let i = 1; i < chronologicalDialogues.length; i++) {
    const current = chronologicalDialogues[i];
    const previous = chronologicalDialogues[i - 1];
    const gapS = current.startS - previous.endS;
    if (gapS > 2) {
      gaps.push({
        fromS: round(previous.endS, 2),
        toS: round(current.startS, 2),
        gapS: round(gapS, 2),
      });
    }
    if (current.startS < previous.endS - 0.005) {
      overlappingCues.push({
        previousSourceIndex: previous.sourceIndex,
        sourceIndex: current.sourceIndex,
        previousEndS: round(previous.endS, 3),
        startS: round(current.startS, 3),
        overlapS: round(previous.endS - current.startS, 3),
        text: current.text,
      });
    }
    const previousText = captionCompareText(previous.text || previous.rawText);
    const currentText = captionCompareText(current.text || current.rawText);
    if (previousText && currentText && previousText === currentText) {
      repeatedTextCues.push({
        previousSourceIndex: previous.sourceIndex,
        sourceIndex: current.sourceIndex,
        startS: round(current.startS, 3),
        text: current.text,
      });
    }
  }

  for (let i = 1; i < dialogues.length; i++) {
    const current = dialogues[i];
    const previous = dialogues[i - 1];
    if (current.startS < previous.startS - 0.005) {
      nonMonotonicCues.push({
        previousSourceIndex: previous.sourceIndex,
        sourceIndex: current.sourceIndex,
        previousStartS: round(previous.startS, 3),
        startS: round(current.startS, 3),
        text: current.text,
      });
    }
  }

  const transcriptCoverage = analyseCaptionTranscriptCoverage({
    cues: chronologicalDialogues,
    transcriptText,
    warnCoverageRatio,
    failCoverageRatio,
  });
  const lastCueEndS = chronologicalDialogues.reduce(
    (max, cue) => Math.max(max, cue.endS),
    0,
  );
  const overrunS = lastCueEndS - safeNumber(durationS, 0);
  const hardTimelineFailure =
    nearZeroDurationCues.length ||
    overlappingCues.length ||
    nonMonotonicCues.length ||
    transcriptCoverage.verdict === "fail";
  const warningTimelineIssue =
    overrunS > 0.1 ||
    gaps.length ||
    repeatedTextCues.length ||
    transcriptCoverage.verdict === "warn";
  return {
    cueCount: dialogues.length,
    firstCueStartS: chronologicalDialogues[0]
      ? round(chronologicalDialogues[0].startS, 2)
      : null,
    lastCueEndS: round(lastCueEndS, 2),
    overrunS: overrunS > 0.1 ? round(overrunS, 2) : 0,
    gapsOver2s: gaps,
    nearZeroDurationS,
    nearZeroDurationCues,
    overlappingCues,
    nonMonotonicCues,
    repeatedTextCues,
    transcriptCoverage,
    verdict: hardTimelineFailure ? "fail" : warningTimelineIssue ? "warn" : "pass",
  };
}

function ffprobeJson(mp4Path) {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      mp4Path,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

function extractAudioSamples(mp4Path, sampleRate = 16000) {
  const buffer = execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      mp4Path,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "f32le",
      "pipe:1",
    ],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  const count = Math.floor(buffer.byteLength / 4);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = buffer.readFloatLE(i * 4);
  }
  return { samples, sampleRate, durationS: count / sampleRate };
}

function analyseAudioPresence({
  samples,
  sampleRate,
  silenceThreshold = 0.003,
  minRms = 0.004,
  minPeak = 0.02,
  minNonSilentRatio = 0.05,
} = {}) {
  if (!samples || !samples.length || !Number.isFinite(Number(sampleRate))) {
    return {
      verdict: "fail",
      reason: "audio_missing_or_silent",
      durationS: 0,
      rms: 0,
      peak: 0,
      nonSilentRatio: 0,
    };
  }

  let sumSq = 0;
  let peak = 0;
  let nonSilent = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = Number(samples[i]) || 0;
    const abs = Math.abs(sample);
    sumSq += sample * sample;
    if (abs > peak) peak = abs;
    if (abs >= silenceThreshold) nonSilent++;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  const nonSilentRatio = nonSilent / samples.length;
  const durationS = samples.length / Number(sampleRate);

  if (rms < minRms && peak < minPeak) {
    return {
      verdict: "fail",
      reason: "audio_missing_or_silent",
      durationS: round(durationS, 3),
      rms: round(rms, 6),
      peak: round(peak, 6),
      nonSilentRatio: round(nonSilentRatio, 4),
    };
  }
  if (nonSilentRatio < minNonSilentRatio) {
    return {
      verdict: "warn",
      reason: "audio_mostly_silent",
      durationS: round(durationS, 3),
      rms: round(rms, 6),
      peak: round(peak, 6),
      nonSilentRatio: round(nonSilentRatio, 4),
    };
  }

  return {
    verdict: "pass",
    reason: "audible_audio_present",
    durationS: round(durationS, 3),
    rms: round(rms, 6),
    peak: round(peak, 6),
    nonSilentRatio: round(nonSilentRatio, 4),
  };
}

function makeAudioWindows(samples, sampleRate, windowMs = 100, hopMs = 50) {
  const windowSize = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const hopSize = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const windows = [];
  for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
    let sumSq = 0;
    let peak = 0;
    for (let i = start; i < start + windowSize; i++) {
      const abs = Math.abs(samples[i]);
      sumSq += samples[i] * samples[i];
      if (abs > peak) peak = abs;
    }
    const rms = Math.sqrt(sumSq / windowSize);
    windows.push({
      startS: start / sampleRate,
      endS: (start + windowSize) / sampleRate,
      rms,
      peak,
      crest: rms > 0 ? peak / rms : 0,
    });
  }
  return windows;
}

function audioSignature(samples, sampleRate, startS, durationS = 0.45, bins = 18) {
  const start = Math.max(0, Math.round(startS * sampleRate));
  const total = Math.max(1, Math.round(durationS * sampleRate));
  const binSize = Math.max(1, Math.floor(total / bins));
  const values = [];
  for (let b = 0; b < bins; b++) {
    const binStart = start + b * binSize;
    const binEnd = Math.min(samples.length, binStart + binSize);
    let sumSq = 0;
    let count = 0;
    for (let i = binStart; i < binEnd; i++) {
      sumSq += samples[i] * samples[i];
      count++;
    }
    values.push(count ? Math.sqrt(sumSq / count) : 0);
  }
  const max = Math.max(...values, 1e-8);
  return values.map((v) => v / max);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (!aa || !bb) return 0;
  return dot / Math.sqrt(aa * bb);
}

function pickTransientCandidates(windows, maxCandidates = 36) {
  const rmsValues = windows.map((w) => w.rms);
  const med = median(rmsValues);
  const deviations = rmsValues.map((v) => Math.abs(v - med));
  const mad = median(deviations) || 0.0001;
  const threshold = Math.max(med + mad * 7, med * 2.8, 0.012);
  const raw = windows
    .filter((w) => w.rms >= threshold && w.crest >= 2.4)
    .sort((a, b) => b.rms - a.rms);

  const selected = [];
  for (const candidate of raw) {
    if (selected.some((s) => Math.abs(s.startS - candidate.startS) < 0.35)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= maxCandidates) break;
  }
  return selected.sort((a, b) => a.startS - b.startS);
}

function findRecurringAudioClusters({
  samples,
  sampleRate,
  candidates,
  minSimilarity = 0.965,
}) {
  const items = candidates.map((c) => ({
    ...c,
    signature: audioSignature(samples, sampleRate, c.startS),
  }));
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const group = [items[i]];
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(items[j].startS - items[i].startS) < 1.2) continue;
      const sim = cosineSimilarity(items[i].signature, items[j].signature);
      if (sim >= minSimilarity) {
        group.push({ ...items[j], similarityToFirst: sim });
        used.add(j);
      }
    }
    if (group.length >= 3) {
      clusters.push({
        count: group.length,
        timesS: group.map((g) => round(g.startS, 2)),
        peakRms: round(Math.max(...group.map((g) => g.rms)), 4),
        averageSimilarity: round(
          group
            .slice(1)
            .reduce((sum, g) => sum + (g.similarityToFirst || 1), 0) /
            Math.max(1, group.length - 1),
          3,
        ),
      });
    }
  }
  return clusters.sort((a, b) => b.count - a.count || b.peakRms - a.peakRms);
}

function findRecurringScheduledAudioClusters({
  samples,
  sampleRate,
  timesS = [],
  minSimilarity = 0.925,
}) {
  const items = timesS
    .filter((timeS) => Number.isFinite(Number(timeS)) && Number(timeS) >= 0)
    .map((timeS) => ({
      startS: Number(timeS),
      signature: audioSignature(samples, sampleRate, Math.max(0, Number(timeS))),
    }));
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const group = [items[i]];
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(items[j].startS - items[i].startS) < 0.8) continue;
      const sim = cosineSimilarity(items[i].signature, items[j].signature);
      if (sim >= minSimilarity) {
        group.push({ ...items[j], similarityToFirst: sim });
        used.add(j);
      }
    }
    if (group.length >= 4) {
      clusters.push({
        count: group.length,
        timesS: group.map((g) => round(g.startS, 2)),
        averageSimilarity: round(
          group
            .slice(1)
            .reduce((sum, g) => sum + (g.similarityToFirst || 1), 0) /
            Math.max(1, group.length - 1),
          3,
        ),
      });
    }
  }
  return clusters.sort((a, b) => b.count - a.count);
}

function analyseAudioRecurrence({
  samples,
  sampleRate,
  declaredSfxCueCount = 0,
  scheduledTimesS = [],
}) {
  const windows = makeAudioWindows(samples, sampleRate);
  const candidates = pickTransientCandidates(windows);
  const clusters = findRecurringAudioClusters({ samples, sampleRate, candidates });
  const scheduledClusters = findRecurringScheduledAudioClusters({
    samples,
    sampleRate,
    timesS: scheduledTimesS,
  });
  const worstCluster = clusters[0] || null;
  const worstScheduledCluster = scheduledClusters[0] || null;
  const repeatedTransientCount = worstCluster ? worstCluster.count : 0;
  const scheduledRepeatCount = worstScheduledCluster
    ? worstScheduledCluster.count
    : 0;
  const scheduledRepeatLooksLikeSfx =
    candidates.length > 0 || declaredSfxCueCount > 2;
  let verdict = "pass";
  const reasons = [];

  if (declaredSfxCueCount > 5) {
    verdict = "fail";
    reasons.push(`declared SFX cue count is ${declaredSfxCueCount}`);
  } else if (declaredSfxCueCount > 2) {
    verdict = "warn";
    reasons.push(`declared SFX cue count is ${declaredSfxCueCount}`);
  }

  if (repeatedTransientCount >= 5) {
    verdict = "fail";
    reasons.push(`detected ${repeatedTransientCount} matching transient hits`);
  } else if (repeatedTransientCount >= 3 && verdict !== "fail") {
    verdict = "warn";
    reasons.push(`detected ${repeatedTransientCount} matching transient hits`);
  }

  if (scheduledRepeatLooksLikeSfx && scheduledRepeatCount >= 8) {
    verdict = "fail";
    reasons.push(
      `detected ${scheduledRepeatCount} matching cut-synchronous audio signatures`,
    );
  } else if (
    scheduledRepeatLooksLikeSfx &&
    scheduledRepeatCount >= 4 &&
    verdict !== "fail"
  ) {
    verdict = "warn";
    reasons.push(
      `detected ${scheduledRepeatCount} matching cut-synchronous audio signatures`,
    );
  }

  return {
    verdict,
    declaredSfxCueCount,
    transientCandidateCount: candidates.length,
    repeatedTransientClusterCount: clusters.length,
    worstCluster,
    scheduledCutCount: scheduledTimesS.length,
    repeatedScheduledClusterCount: scheduledClusters.length,
    worstScheduledCluster,
    reasons,
    candidates: candidates.slice(0, 12).map((c) => ({
      startS: round(c.startS, 2),
      rms: round(c.rms, 4),
      peak: round(c.peak, 4),
      crest: round(c.crest, 2),
    })),
  };
}

async function generateWaveform({ mp4Path, outPath }) {
  await fs.ensureDir(path.dirname(outPath));
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      mp4Path,
      "-filter_complex",
      "aformat=channel_layouts=mono,showwavespic=s=1600x260:colors=0xFF6B1A",
      "-frames:v",
      "1",
      outPath,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return outPath;
}

async function extractFrames({ mp4Path, frameDir, intervalS = 1.5 }) {
  await fs.ensureDir(frameDir);
  await fs.emptyDir(frameDir);
  const pattern = path.join(frameDir, "frame_%03d.jpg");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      mp4Path,
      "-vf",
      `fps=1/${intervalS},scale=270:480:force_original_aspect_ratio=decrease,pad=270:480:(ow-iw)/2:(oh-ih)/2:0x0D0D0F`,
      "-q:v",
      "3",
      pattern,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return (await fs.readdir(frameDir))
    .filter((name) => /^frame_\d+\.jpg$/i.test(name))
    .sort()
    .map((name, idx) => ({
      path: path.join(frameDir, name),
      index: idx,
      timeS: round(idx * intervalS, 2),
    }));
}

async function frameHash(framePath) {
  const width = 9;
  const height = 8;
  const data = await sharp(framePath)
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  let bits = "";
  let sum = 0;
  for (const value of data) sum += value;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width - 1; col++) {
      const left = data[row * width + col];
      const right = data[row * width + col + 1];
      bits += left > right ? "1" : "0";
    }
  }
  return {
    hash: bits,
    luminance: sum / data.length,
  };
}

function hammingDistance(a, b) {
  const len = Math.min(String(a).length, String(b).length);
  let dist = Math.abs(String(a).length - String(b).length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}

function timeInRange(timeS, range, toleranceS = 0.75) {
  return (
    Number(timeS) >= Number(range?.startS) - toleranceS &&
    Number(timeS) <= Number(range?.endS) + toleranceS
  );
}

function filterRepeatPairsByIgnoreRanges(pairs = [], ignoreRangesS = []) {
  const ranges = Array.isArray(ignoreRangesS) ? ignoreRangesS : [];
  return pairs.filter(
    (pair) =>
      !ranges.some(
        (range) => timeInRange(pair.aTimeS, range) || timeInRange(pair.bTimeS, range),
      ),
  );
}

function buildVisualRepeatIgnoreRanges(report = {}) {
  const ranges = [];
  let cursor = 0;
  for (const scene of report?.sceneList || []) {
    const duration = safeNumber(scene?.duration, 0);
    const startS = cursor;
    const endS = cursor + duration;
    const type = String(scene?.type || scene?.sceneType || "");
    if (type === "card.takeaway" || type === "outro") {
      ranges.push({
        startS: round(startS, 3),
        endS: round(endS, 3),
        reason: "takeaway_hold",
      });
    } else if (type === "card.quote") {
      ranges.push({
        startS: round(startS, 3),
        endS: round(endS, 3),
        reason: "quote_card_hold",
      });
    }
    cursor = endS;
  }
  return ranges;
}

const FLASH_LANE_SUBTITLE_DENSITY_OPTIONS = Object.freeze({
  maxWordsPerCue: 4,
  failWordsPerCue: 8,
  maxCharsPerCue: 22,
  failCharsPerCue: 32,
  maxVisualLines: 1,
  failVisualLines: 1,
  profile: "flash_lane_strict",
});

function analyseSubtitleDensity({
  assPath = null,
  dialogues = null,
  maxWordsPerCue = 6,
  failWordsPerCue = 16,
  maxCharsPerCue = 60,
  failCharsPerCue = 120,
  maxVisualLines = 1,
  failVisualLines = 2,
  profile = "standard",
} = {}) {
  const cues = Array.isArray(dialogues) ? dialogues : parseAssDialogues(assPath);
  const samples = cues.map((cue) => {
    const rawText = cue.rawText || cue.text || "";
    const text = cleanCaptionText(rawText);
    const wordCount = captionWordCount(rawText);
    const visualLineCount = Math.max(
      1,
      safeNumber(cue.visualLineCount, String(rawText).split(/\\[Nn]/g).length),
    );
    return {
      startS: round(cue.startS, 2),
      endS: round(cue.endS, 2),
      text,
      wordCount,
      charCount: text.length,
      visualLineCount,
    };
  });
  const denseCues = samples.filter((cue) => cue.wordCount > maxWordsPerCue);
  const failingDenseCues = samples.filter(
    (cue) => cue.wordCount > failWordsPerCue,
  );
  const longCues = samples.filter((cue) => cue.charCount > maxCharsPerCue);
  const failingLongCues = samples.filter(
    (cue) => cue.charCount > failCharsPerCue,
  );
  const multiLineCues = samples.filter((cue) => cue.visualLineCount > maxVisualLines);
  const failingLineCues = samples.filter(
    (cue) => cue.visualLineCount > failVisualLines,
  );
  const maxWords = Math.max(0, ...samples.map((cue) => cue.wordCount));
  const maxChars = Math.max(0, ...samples.map((cue) => cue.charCount));
  const maxLines = Math.max(0, ...samples.map((cue) => cue.visualLineCount));
  let verdict = "pass";
  const reasons = [];

  if (failingDenseCues.length || failingLongCues.length || failingLineCues.length) {
    verdict = "fail";
    if (failingDenseCues.length) {
      reasons.push(
        `${failingDenseCues.length} caption cue(s) exceed ${failWordsPerCue} words`,
      );
    }
    if (failingLongCues.length) {
      reasons.push(
        `${failingLongCues.length} caption cue(s) exceed ${failCharsPerCue} characters`,
      );
    }
    if (failingLineCues.length) {
      reasons.push(
        `${failingLineCues.length} caption cue(s) exceed ${failVisualLines} visual lines`,
      );
    }
  } else if (denseCues.length || longCues.length || multiLineCues.length) {
    verdict = "warn";
    if (denseCues.length) {
      reasons.push(`${denseCues.length} dense caption cue(s) detected`);
    }
    if (longCues.length) {
      reasons.push(`${longCues.length} long caption cue(s) detected`);
    }
    if (multiLineCues.length) {
      reasons.push(`${multiLineCues.length} multi-line caption cue(s) detected`);
    }
  }

  return {
    profile,
    verdict,
    cueCount: samples.length,
    maxWordsPerCue: maxWords,
    denseCueCount: denseCues.length,
    maxCharsPerCue: maxChars,
    longCueCount: longCues.length,
    multiLineCueCount: multiLineCues.length,
    maxVisualLineCount: maxLines,
    worstCues: samples
      .slice()
      .sort(
        (a, b) =>
          b.wordCount - a.wordCount ||
          b.charCount - a.charCount ||
          b.visualLineCount - a.visualLineCount ||
          a.startS - b.startS,
      )
      .slice(0, 5),
    reasons,
  };
}

const RENDERED_FRAME_TITLE_OR_RATING_REASONS = new Set([
  "white_text_on_dark_card",
  "logo_or_rating_card",
  "text_card_frame",
  "high_contrast_card_frame",
]);

const RENDERED_FRAME_LOW_INFORMATION_REASONS = new Set([
  "black_frame",
  "blurred_frame",
  "dead_dark_frame",
  "washed_low_detail_frame",
  "low_visual_information_frame",
]);

function renderedFrameTasteReasonGroup(reason) {
  if (RENDERED_FRAME_TITLE_OR_RATING_REASONS.has(reason)) {
    return "title_or_rating_slate";
  }
  if (RENDERED_FRAME_LOW_INFORMATION_REASONS.has(reason)) {
    return "low_information_frame";
  }
  return "other_bad_frame";
}

async function analyseRenderedFrameTaste({
  frames = [],
  prescanFrame = null,
  maxWarnBadFrames = 1,
  maxFailBadFrames = 2,
} = {}) {
  const rawBadFrames = [];
  const samples = [];

  for (const frame of frames || []) {
    let prescan = frame.prescan || frame.visual_prescan || null;
    if (!prescan && typeof prescanFrame === "function") {
      prescan = await prescanFrame(frame);
    }
    if (!prescan) {
      prescan = await prescanImage(frame.path, {
        sourceTypeHint: "studio-v2-rendered-frame",
      });
    }

    let taste =
      frame.visual_taste ||
      frame.taste ||
      prescan?.trailer_frame_taste ||
      classifyTrailerFrameTaste(prescan || {});
    if (frame.black_frame === true || prescan?.black_frame === true) {
      taste = {
        verdict: "fail",
        reason: "black_frame",
        score: 0,
        tags: ["black_frame"],
      };
    } else if (
      frame.blur_verdict === "fail" ||
      frame.blur_verdict === "warn" ||
      prescan?.blur_verdict === "fail" ||
      prescan?.blur_verdict === "warn"
    ) {
      taste = {
        verdict: "fail",
        reason: "blurred_frame",
        score: taste?.score ?? null,
        tags: [...new Set([...(Array.isArray(taste?.tags) ? taste.tags : []), "blurred"])],
      };
    }
    const reason = taste?.reason || "unknown";
    const sample = {
      frame: path.basename(String(frame.path || frame.name || "frame")),
      timeS: frame.timeS,
      path: frame.path ? relativeToRoot(frame.path) : null,
      contentHash: frame.content_hash || frame.contentHash || prescan?.content_hash || null,
      verdict: taste?.verdict || "unknown",
      reason,
      score: taste?.score ?? null,
      tags: Array.isArray(taste?.tags) ? taste.tags : [],
    };
    samples.push(sample);

    if (taste?.verdict === "fail") {
      rawBadFrames.push({
        ...sample,
        group: renderedFrameTasteReasonGroup(reason),
      });
    }
  }

  const badFrameGroups = new Map();
  for (const frame of rawBadFrames) {
    const key = frame.contentHash
      ? `${frame.group}:${frame.reason}:hash:${frame.contentHash}`
      : `${frame.group}:${frame.reason}:frame:${frame.frame}`;
    const existing = badFrameGroups.get(key);
    if (existing) {
      existing.duplicateCount += 1;
      existing.duplicateTimesS.push(frame.timeS);
      existing.frames.push(frame.frame);
      continue;
    }
    badFrameGroups.set(key, {
      ...frame,
      duplicateCount: 1,
      duplicateTimesS: [frame.timeS],
      frames: [frame.frame],
    });
  }
  const badFrames = [...badFrameGroups.values()].map((frame) => ({
    ...frame,
    duplicateTimesS: frame.duplicateTimesS.filter((timeS) =>
      Number.isFinite(Number(timeS)),
    ),
  }));
  const ratingOrTitleFrameCount = rawBadFrames.filter(
    (frame) => frame.group === "title_or_rating_slate",
  ).length;
  const lowInformationFrameCount = rawBadFrames.filter(
    (frame) => frame.group === "low_information_frame",
  ).length;
  const blackFrameCount = rawBadFrames.filter(
    (frame) => frame.reason === "black_frame",
  ).length;
  const blurredFrameCount = rawBadFrames.filter(
    (frame) => frame.reason === "blurred_frame",
  ).length;
  const badFrameCount = rawBadFrames.length;
  const uniqueBadFrameCount = badFrames.length;
  const duplicateBadFrameCount = Math.max(0, badFrameCount - uniqueBadFrameCount);
  let verdict = "pass";
  const reasons = [];

  if (ratingOrTitleFrameCount > 0) {
    verdict = "fail";
    reasons.push(
      `rendered frame sample contains ${ratingOrTitleFrameCount} title/rating slate frame(s)`,
    );
  } else if (badFrameCount > maxFailBadFrames) {
    verdict = "fail";
    reasons.push(`rendered frame sample contains ${badFrameCount} bad frame(s)`);
  } else if (blackFrameCount > 0 || blurredFrameCount > 0) {
    verdict = "fail";
    reasons.push("rendered frame sample contains black or blurred frame(s)");
  } else if (lowInformationFrameCount > 0) {
    verdict = "fail";
    reasons.push(
      `rendered frame sample contains ${lowInformationFrameCount} low-detail frame(s)`,
    );
  } else if (badFrameCount >= maxWarnBadFrames) {
    verdict = "warn";
    reasons.push(`rendered frame sample contains ${badFrameCount} weak frame(s)`);
  }

  return {
    verdict,
    frameCount: samples.length,
    badFrameCount,
    uniqueBadFrameCount,
    duplicateBadFrameCount,
    ratingOrTitleFrameCount,
    lowInformationFrameCount,
    blackFrameCount,
    blurredFrameCount,
    badFrames: badFrames.slice(0, 16),
    duplicateBadFrameGroups: badFrames
      .filter((frame) => frame.duplicateCount > 1)
      .slice(0, 16),
    samples: samples.slice(0, 32),
    reasons,
  };
}

async function analyseVisualRepetition({ frames, minGapS = 3, maxHamming = 6, ignoreRangesS = [] }) {
  const hashed = [];
  for (const frame of frames) {
    const hash = await frameHash(frame.path);
    hashed.push({ ...frame, ...hash });
  }
  const allRepeatPairs = [];
  for (let i = 0; i < hashed.length; i++) {
    for (let j = i + 1; j < hashed.length; j++) {
      if (hashed[j].timeS - hashed[i].timeS < minGapS) continue;
      const distance = hammingDistance(hashed[i].hash, hashed[j].hash);
      if (distance <= maxHamming) {
        allRepeatPairs.push({
          a: path.basename(hashed[i].path),
          b: path.basename(hashed[j].path),
          aTimeS: hashed[i].timeS,
          bTimeS: hashed[j].timeS,
          hamming: distance,
        });
      }
    }
  }
  const repeatPairs = filterRepeatPairsByIgnoreRanges(allRepeatPairs, ignoreRangesS);
  const blackFrames = hashed
    .filter((f) => f.luminance < 8)
    .map((f) => ({ frame: path.basename(f.path), timeS: f.timeS }));
  let verdict = "pass";
  if (blackFrames.length || repeatPairs.length > 4) verdict = "warn";
  if (repeatPairs.length > 10) verdict = "fail";
  return {
    verdict,
    frameCount: hashed.length,
    sampledEveryS: frames.length > 1 ? round(frames[1].timeS - frames[0].timeS, 2) : null,
    repeatPairCount: repeatPairs.length,
    ignoredRepeatPairCount: allRepeatPairs.length - repeatPairs.length,
    ignoredRanges: ignoreRangesS,
    repeatPairs: repeatPairs.slice(0, 20),
    blackFrames,
    averageLuminance: round(
      hashed.reduce((sum, f) => sum + f.luminance, 0) /
        Math.max(1, hashed.length),
      2,
    ),
  };
}

function sceneSourceReuseKey(scene) {
  const type = String(scene?.type || "");
  const source = String(scene?.source || "unknown");
  const isClipBeat =
    type === "clip" ||
    type === "punch" ||
    type === "speed-ramp" ||
    type === "freeze-frame" ||
    (type === "opener" && scene?.isClipBacked === true);
  const start = Number(scene?.mediaStartS ?? scene?.media_start_s);
  if (isClipBeat && Number.isFinite(start)) {
    return `${source} @${start.toFixed(1)}s`;
  }
  return source;
}

function sceneBreakdown(report) {
  const scenes = report?.sceneList || [];
  const typeCounts = {};
  const sourceCounts = {};
  for (const scene of scenes) {
    const type = scene.type || "unknown";
    const source = sceneSourceReuseKey(scene);
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }
  const repeatedSources = Object.entries(sourceCounts)
    .filter(([, count]) => count > 1)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  return {
    sceneCount: scenes.length,
    typeCounts,
    uniqueSourceCount: Object.keys(sourceCounts).length,
    repeatedSources,
    declaredSourceDiversity: report?.auto?.sourceDiversity || null,
    declaredStillRepeat: report?.auto?.maxStillRepeat || null,
    declaredStockFiller: report?.auto?.stockFillerCount || null,
  };
}

function buildIssues({ runtime = {}, subtitles = {}, audio = {}, visual = {}, scene = {} }) {
  const issues = [];
  if (safeNumber(runtime.durationDeltaS, 0) > 0.25) {
    issues.push({
      severity: "fail",
      code: "duration_mismatch",
      message: "Rendered MP4 duration does not match the report/audio duration.",
      evidence: runtime,
    });
  }
  if (subtitles.verdict !== "pass") {
    issues.push({
      severity: subtitles.verdict === "fail" || subtitles.overrunS ? "fail" : "warn",
      code: "subtitle_timeline",
      message:
        "Subtitle timeline has gaps, corrupt cue timings, repeated text or low transcript coverage.",
      evidence: subtitles,
    });
  }
  if (
    subtitles.density &&
    subtitles.density.verdict &&
    subtitles.density.verdict !== "pass"
  ) {
    issues.push({
      severity: subtitles.density.verdict === "fail" ? "fail" : "warn",
      code: "subtitle_density",
      message:
        "Caption cues are too dense or multi-line for a high-retention short.",
      evidence: {
        maxWordsPerCue: subtitles.density.maxWordsPerCue,
        denseCueCount: subtitles.density.denseCueCount,
        multiLineCueCount: subtitles.density.multiLineCueCount,
        worstCues: subtitles.density.worstCues,
      },
    });
  }
  if (
    audio.presence &&
    audio.presence.verdict &&
    audio.presence.verdict !== "pass"
  ) {
    issues.push({
      severity: audio.presence.verdict === "fail" ? "fail" : "warn",
      code: "audio_presence",
      message: "Rendered MP4 has missing, silent or mostly silent audio.",
      evidence: audio.presence,
    });
  }
  if (audio.verdict !== "pass") {
    issues.push({
      severity: audio.verdict,
      code: "audio_recurrence",
      message: "Audio contains repeated transient patterns or too many declared SFX cues.",
      evidence: audio.reasons,
    });
  }
  if (visual.verdict !== "pass") {
    issues.push({
      severity: visual.verdict,
      code: "visual_repetition",
      message: "Frame sampling found possible repeated visuals or black frames.",
      evidence: {
        repeatPairCount: visual.repeatPairCount,
        blackFrames: visual.blackFrames,
      },
    });
  }
  const renderedFrameTaste = visual.taste || visual.renderedFrameTaste || null;
  if (
    renderedFrameTaste &&
    renderedFrameTaste.verdict &&
    renderedFrameTaste.verdict !== "pass" &&
    renderedFrameTaste.verdict !== "unknown"
  ) {
    issues.push({
      severity: renderedFrameTaste.verdict === "fail" ? "fail" : "warn",
      code: "rendered_frame_taste",
      message:
        "Rendered frame sampling found title/rating slates or low-information frames.",
      evidence: {
        badFrameCount: renderedFrameTaste.badFrameCount,
        uniqueBadFrameCount: renderedFrameTaste.uniqueBadFrameCount,
        duplicateBadFrameCount: renderedFrameTaste.duplicateBadFrameCount,
        ratingOrTitleFrameCount: renderedFrameTaste.ratingOrTitleFrameCount,
        lowInformationFrameCount: renderedFrameTaste.lowInformationFrameCount,
        blackFrameCount: renderedFrameTaste.blackFrameCount,
        blurredFrameCount: renderedFrameTaste.blurredFrameCount,
        badFrames: renderedFrameTaste.badFrames,
        duplicateBadFrameGroups: renderedFrameTaste.duplicateBadFrameGroups,
      },
    });
  }
  const maxRepeatedSourceCount = Math.max(
    0,
    ...(scene.repeatedSources || []).map((source) => source.count),
  );
  const sourceDiversityGrade = scene.declaredSourceDiversity?.grade || "unknown";
  if (
    maxRepeatedSourceCount >= 3 ||
    ((scene.repeatedSources || []).length > 6 && sourceDiversityGrade !== "green")
  ) {
    issues.push({
      severity: "warn",
      code: "scene_source_reuse",
      message: "Scene report shows repeated source reuse.",
      evidence: (scene.repeatedSources || []).slice(0, 8),
    });
  }
  return issues;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function badge(verdict) {
  const colors = {
    pass: "#1a8f3c",
    warn: "#d29c1a",
    fail: "#c8332b",
  };
  return `<span class="badge" style="background:${colors[verdict] || "#666"}">${htmlEscape(verdict).toUpperCase()}</span>`;
}

function buildHtmlReport(report) {
  const frameLinks = (report.visual?.sampleFrames || [])
    .slice(0, 12)
    .map(
      (frame) =>
        `<a href="${htmlEscape(frame.relPath)}"><img src="${htmlEscape(frame.relPath)}" alt="${htmlEscape(frame.name)}"></a>`,
    )
    .join("");
  const issues = report.issues.length
    ? report.issues
        .map(
          (issue) =>
            `<li><b>${htmlEscape(issue.severity.toUpperCase())}: ${htmlEscape(issue.code)}</b><br>${htmlEscape(issue.message)}</li>`,
        )
        .join("")
    : "<li>No automated hard defects found.</li>";
  const repeats = (report.visual.repeatPairs || [])
    .slice(0, 8)
    .map(
      (pair) =>
        `<tr><td>${htmlEscape(pair.a)} @ ${pair.aTimeS}s</td><td>${htmlEscape(pair.b)} @ ${pair.bTimeS}s</td><td>${pair.hamming}</td></tr>`,
    )
    .join("");
  const clusters = report.audio.worstCluster
    ? `<pre>${htmlEscape(JSON.stringify(report.audio.worstCluster, null, 2))}</pre>`
    : "<p>No repeated transient cluster above threshold.</p>";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Studio V2 Forensic QA - ${htmlEscape(report.storyId)}</title>
<style>
body{margin:0;background:#0d0d0f;color:#e8dcc8;font-family:Arial,system-ui,sans-serif;line-height:1.5}
.wrap{max-width:1200px;margin:0 auto;padding:34px 28px 80px}
h1{margin:0 0 8px;font-size:32px}h2{margin:34px 0 12px;border-left:4px solid #ff6b1a;padding-left:12px}
.meta{display:flex;gap:16px;flex-wrap:wrap;color:rgba(232,220,200,.65);font-size:13px}
.badge{display:inline-block;color:white;font-weight:800;font-size:11px;letter-spacing:.12em;padding:5px 9px;border-radius:3px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.stat{background:#16161a;padding:14px;border-left:3px solid #ff6b1a}.stat b{display:block;font-size:24px;margin-top:4px}
video{width:100%;max-height:72vh;background:#000}.wave{width:100%;background:#16161a;border-radius:4px}.frames{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.frames img{width:100%;border:1px solid rgba(255,255,255,.08)}
table{width:100%;border-collapse:collapse;background:#16161a}td,th{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.05);text-align:left}th{color:#ff6b1a}
pre{background:#16161a;padding:12px;overflow:auto}
</style>
</head>
<body><div class="wrap">
<h1>Studio V2 Forensic QA ${badge(report.summary.verdict)}</h1>
<div class="meta">
<span>Story: <b>${htmlEscape(report.storyId)}</b></span>
<span>Generated: ${htmlEscape(report.generatedAt)}</span>
<span>MP4: ${htmlEscape(report.inputs.mp4Path)}</span>
</div>
<div class="grid">
<div class="stat">Runtime <b>${report.runtime.mp4DurationS}s</b></div>
<div class="stat">SFX cues <b>${report.audio.declaredSfxCueCount}</b></div>
<div class="stat">Frames sampled <b>${report.visual.frameCount}</b></div>
<div class="stat">Frame taste <b>${htmlEscape(report.visual.taste?.verdict || "unknown")}</b></div>
<div class="stat">Issues <b>${report.issues.length}</b></div>
</div>
<h2>Render</h2>
<video controls preload="metadata" src="${htmlEscape(path.basename(report.inputs.mp4Path))}"></video>
<h2>Issues</h2><ul>${issues}</ul>
<h2>Waveform</h2>
<img class="wave" src="${htmlEscape(report.audio.waveformRelPath)}" alt="audio waveform">
<h2>Audio recurrence</h2>
${clusters}
<h2>Visual samples</h2>
<div class="frames">${frameLinks}</div>
<h2>Rendered frame taste</h2>
<pre>${htmlEscape(JSON.stringify(report.visual.taste || {}, null, 2))}</pre>
<h2>Possible visual repeats</h2>
<table><thead><tr><th>A</th><th>B</th><th>Hamming</th></tr></thead><tbody>${repeats}</tbody></table>
<h2>Subtitle timeline</h2>
<pre>${htmlEscape(JSON.stringify(report.subtitles, null, 2))}</pre>
<h2>Scene breakdown</h2>
<pre>${htmlEscape(JSON.stringify(report.scene, null, 2))}</pre>
</div></body></html>`;
}

function buildMarkdownReport(report) {
  const lines = [
    `# Studio V2 Forensic QA - ${report.storyId}`,
    "",
    `Verdict: ${report.summary.verdict}`,
    `Generated: ${report.generatedAt}`,
    `MP4: ${report.inputs.mp4Path}`,
    "",
    "## Key Signals",
    "",
    `- Runtime: ${report.runtime.mp4DurationS}s`,
    `- Declared SFX cues: ${report.audio.declaredSfxCueCount}`,
    `- Audio presence verdict: ${report.audio.presence?.verdict || "unknown"}`,
    `- Audio recurrence verdict: ${report.audio.verdict}`,
    `- Subtitle verdict: ${report.subtitles.verdict}`,
    `- Subtitle density verdict: ${report.subtitles.density?.verdict || "unknown"}`,
    `- Visual repetition verdict: ${report.visual.verdict}`,
    `- Rendered frame taste verdict: ${report.visual.taste?.verdict || "unknown"}`,
    `- Frame repeat pairs: ${report.visual.repeatPairCount}`,
    "",
    "## Issues",
    "",
  ];
  if (!report.issues.length) {
    lines.push("- No automated hard defects found.");
  } else {
    for (const issue of report.issues) {
      lines.push(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
    }
  }
  lines.push(
    "",
    "## Artefacts",
    "",
    `- JSON: ${report.outputs.jsonPath}`,
    `- HTML: ${report.outputs.htmlPath}`,
    `- Waveform: ${report.audio.waveformRelPath}`,
    `- Frame directory: ${report.visual.frameDir}`,
    "",
  );
  return lines.join("\n");
}

function summariseForComparison(report) {
  return {
    storyId: report.storyId,
    verdict: report.summary?.verdict || "unknown",
    issueCount: safeNumber(report.summary?.issueCount, 0),
    failCount: safeNumber(report.summary?.failCount, 0),
    warnCount: safeNumber(report.summary?.warnCount, 0),
    durationS: safeNumber(report.runtime?.mp4DurationS, 0),
    declaredSfxCueCount: safeNumber(report.audio?.declaredSfxCueCount, 0),
    audioRecurrence: report.audio?.verdict || "unknown",
    repeatedTransientClusterCount: safeNumber(
      report.audio?.repeatedTransientClusterCount,
      0,
    ),
    repeatedScheduledClusterCount: safeNumber(
      report.audio?.repeatedScheduledClusterCount,
      0,
    ),
    subtitleVerdict: report.subtitles?.verdict || "unknown",
    subtitleOverrunS: safeNumber(report.subtitles?.overrunS, 0),
    visualVerdict: report.visual?.verdict || "unknown",
    visualRepeatPairs: safeNumber(report.visual?.repeatPairCount, 0),
    renderedFrameTaste: report.visual?.taste?.verdict || "unknown",
    renderedBadFrameCount: safeNumber(report.visual?.taste?.badFrameCount, 0),
  };
}

function compareForensicReports(before, after) {
  const b = summariseForComparison(before);
  const a = summariseForComparison(after);
  const deltas = {
    issueCount: a.issueCount - b.issueCount,
    failCount: a.failCount - b.failCount,
    warnCount: a.warnCount - b.warnCount,
    durationS: round(a.durationS - b.durationS, 3),
    declaredSfxCueCount: a.declaredSfxCueCount - b.declaredSfxCueCount,
    repeatedTransientClusterCount:
      a.repeatedTransientClusterCount - b.repeatedTransientClusterCount,
    repeatedScheduledClusterCount:
      a.repeatedScheduledClusterCount - b.repeatedScheduledClusterCount,
    subtitleOverrunS: round(a.subtitleOverrunS - b.subtitleOverrunS, 3),
    visualRepeatPairs: a.visualRepeatPairs - b.visualRepeatPairs,
    renderedBadFrameCount: a.renderedBadFrameCount - b.renderedBadFrameCount,
  };
  const materiallyImproved =
    deltas.failCount < 0 ||
    deltas.issueCount < 0 ||
    (b.audioRecurrence !== "pass" && a.audioRecurrence === "pass") ||
    (b.subtitleVerdict !== "pass" && a.subtitleVerdict === "pass") ||
    (b.renderedFrameTaste !== "pass" && a.renderedFrameTaste === "pass");
  return {
    generatedAt: new Date().toISOString(),
    before: b,
    after: a,
    deltas,
    verdict: materiallyImproved ? "improved" : "no-material-improvement",
  };
}

function buildComparisonMarkdown(comparison) {
  const rows = [
    ["Verdict", comparison.before.verdict, comparison.after.verdict, ""],
    [
      "Issues",
      comparison.before.issueCount,
      comparison.after.issueCount,
      comparison.deltas.issueCount,
    ],
    [
      "Fails",
      comparison.before.failCount,
      comparison.after.failCount,
      comparison.deltas.failCount,
    ],
    [
      "Runtime",
      `${comparison.before.durationS}s`,
      `${comparison.after.durationS}s`,
      `${comparison.deltas.durationS}s`,
    ],
    [
      "SFX cues",
      comparison.before.declaredSfxCueCount,
      comparison.after.declaredSfxCueCount,
      comparison.deltas.declaredSfxCueCount,
    ],
    [
      "Audio recurrence",
      comparison.before.audioRecurrence,
      comparison.after.audioRecurrence,
      "",
    ],
    [
      "Cut-sync audio clusters",
      comparison.before.repeatedScheduledClusterCount,
      comparison.after.repeatedScheduledClusterCount,
      comparison.deltas.repeatedScheduledClusterCount,
    ],
    [
      "Subtitle verdict",
      comparison.before.subtitleVerdict,
      comparison.after.subtitleVerdict,
      "",
    ],
    [
      "Subtitle overrun",
      `${comparison.before.subtitleOverrunS}s`,
      `${comparison.after.subtitleOverrunS}s`,
      `${comparison.deltas.subtitleOverrunS}s`,
    ],
    [
      "Visual repeat pairs",
      comparison.before.visualRepeatPairs,
      comparison.after.visualRepeatPairs,
      comparison.deltas.visualRepeatPairs,
    ],
    [
      "Rendered frame taste",
      comparison.before.renderedFrameTaste,
      comparison.after.renderedFrameTaste,
      "",
    ],
    [
      "Rendered bad frames",
      comparison.before.renderedBadFrameCount,
      comparison.after.renderedBadFrameCount,
      comparison.deltas.renderedBadFrameCount,
    ],
  ];
  return [
    "# Studio V2 Forensic QA Comparison",
    "",
    `Verdict: ${comparison.verdict}`,
    `Generated: ${comparison.generatedAt}`,
    "",
    "| Metric | Before | After | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...rows.map(
      ([metric, before, after, delta]) =>
        `| ${metric} | ${before} | ${after} | ${delta} |`,
    ),
    "",
  ].join("\n");
}

function transcriptTextFromReport(report = {}, options = {}) {
  const candidates = [
    options.transcriptText,
    report?.narration?.transcript,
    report?.voice?.transcript,
    report?.voice?.displayText,
    report?.audioMeta?.transcript,
    report?.audioMeta?.displayText,
    report?.transcript,
    report?.meta?.transcript,
    report?.alignment?.meta?.transcript,
    report?.script?.script_for_caption,
    report?.script?.script_for_tts,
    report?.story?.scriptForCaption,
    report?.story?.full_script,
    report?.story?.body,
  ];
  return String(candidates.find((value) => typeof value === "string" && value.trim()) || "");
}

async function runForensicQa(options = {}) {
  const storyId = options.storyId || "1sn9xhe";
  const outputDir = options.outputDir || TEST_OUT;
  const mp4Path =
    options.mp4Path || path.join(outputDir, `studio_v2_${storyId}.mp4`);
  const reportPath =
    options.reportPath || path.join(outputDir, `${storyId}_studio_v2_report.json`);
  const assPath =
    options.assPath || path.join(outputDir, `${storyId}_studio_v2.ass`);
  if (!(await fs.pathExists(mp4Path))) {
    throw new Error(`MP4 not found: ${mp4Path}`);
  }
  if (!(await fs.pathExists(reportPath))) {
    throw new Error(`V2 report not found: ${reportPath}`);
  }

  const renderReport = await fs.readJson(reportPath);
  const probe = ffprobeJson(mp4Path);
  const mp4DurationS = safeNumber(probe.format?.duration, 0);
  const reportDurationS = safeNumber(renderReport.runtime?.durationS, 0);
  const runtime = {
    mp4DurationS: round(mp4DurationS, 3),
    reportDurationS: round(reportDurationS, 3),
    durationDeltaS: round(Math.abs(mp4DurationS - reportDurationS), 3),
    sizeBytes: safeNumber(probe.format?.size, 0),
    video: probe.streams?.find((s) => s.codec_type === "video") || null,
    audio: probe.streams?.find((s) => s.codec_type === "audio") || null,
  };

  const subtitleDialogues = parseAssDialogues(assPath);
  const subtitles = analyseSubtitleTimeline({
    assPath,
    srtPath: options.srtPath,
    durationS: mp4DurationS,
    transcriptText: transcriptTextFromReport(renderReport, options),
  });
  const subtitleDensityOptions =
    options.flashLane === true || options.strictFlashLaneSubtitles === true
      ? FLASH_LANE_SUBTITLE_DENSITY_OPTIONS
      : options.subtitleDensityOptions || {};
  subtitles.density = analyseSubtitleDensity({
    dialogues: subtitleDialogues,
    ...subtitleDensityOptions,
  });
  const { samples, sampleRate } = extractAudioSamples(mp4Path);
  const audio = analyseAudioRecurrence({
    samples,
    sampleRate,
    declaredSfxCueCount: safeNumber(renderReport.auto?.sfxEventCount?.value, 0),
    scheduledTimesS: (renderReport.transitions || []).map((t) => Number(t.offset)),
  });
  audio.presence = analyseAudioPresence({ samples, sampleRate });

  const qaPrefix = `qa_forensic_${storyId}`;
  const waveformPath = path.join(outputDir, `${qaPrefix}_waveform.png`);
  await generateWaveform({ mp4Path, outPath: waveformPath });
  audio.waveformPath = relativeToRoot(waveformPath);
  audio.waveformRelPath = toPosix(path.relative(outputDir, waveformPath));

  const frameDir = path.join(outputDir, `${qaPrefix}_frames`);
  const frames = await extractFrames({ mp4Path, frameDir });
  const visualIgnoreRanges = buildVisualRepeatIgnoreRanges(renderReport);
  const visual = await analyseVisualRepetition({
    frames,
    ignoreRangesS: visualIgnoreRanges,
  });
  visual.taste = await analyseRenderedFrameTaste({ frames });
  visual.frameDir = relativeToRoot(frameDir);
  visual.sampleFrames = frames.slice(0, 24).map((frame) => ({
    name: path.basename(frame.path),
    timeS: frame.timeS,
    path: relativeToRoot(frame.path),
    relPath: toPosix(path.relative(outputDir, frame.path)),
  }));

  const scene = sceneBreakdown(renderReport);
  const issues = buildIssues({ runtime, subtitles, audio, visual, scene });
  const summary = {
    verdict: issues.some((i) => i.severity === "fail")
      ? "fail"
      : issues.length
        ? "warn"
        : "pass",
    issueCount: issues.length,
    failCount: issues.filter((i) => i.severity === "fail").length,
    warnCount: issues.filter((i) => i.severity === "warn").length,
  };

  const outJson = path.join(outputDir, `${qaPrefix}_report.json`);
  const outHtml = path.join(outputDir, `${qaPrefix}.html`);
  const outMd = path.join(outputDir, `${qaPrefix}.md`);
  const report = {
    schemaVersion: 1,
    storyId,
    generatedAt: new Date().toISOString(),
    inputs: {
      mp4Path: relativeToRoot(mp4Path),
      reportPath: relativeToRoot(reportPath),
      assPath: relativeToRoot(assPath),
    },
    outputs: {
      jsonPath: relativeToRoot(outJson),
      htmlPath: relativeToRoot(outHtml),
      markdownPath: relativeToRoot(outMd),
    },
    summary,
    runtime,
    subtitles,
    audio,
    visual,
    scene,
    issues,
  };

  await fs.writeJson(outJson, report, { spaces: 2 });
  await fs.writeFile(outHtml, buildHtmlReport(report));
  await fs.writeFile(outMd, buildMarkdownReport(report));
  return report;
}

module.exports = {
  TEST_OUT,
  assTimeToSeconds,
  srtTimeToSeconds,
  parseAssDialogues,
  parseSrtCues,
  parseSubtitleCues,
  analyseSubtitleTimeline,
  analyseCaptionTranscriptCoverage,
  analyseSubtitleDensity,
  analyseAudioPresence,
  makeAudioWindows,
  audioSignature,
  cosineSimilarity,
  pickTransientCandidates,
  findRecurringAudioClusters,
  findRecurringScheduledAudioClusters,
  analyseAudioRecurrence,
  hammingDistance,
  filterRepeatPairsByIgnoreRanges,
  buildVisualRepeatIgnoreRanges,
  analyseRenderedFrameTaste,
  FLASH_LANE_SUBTITLE_DENSITY_OPTIONS,
  sceneBreakdown,
  buildIssues,
  buildHtmlReport,
  buildMarkdownReport,
  summariseForComparison,
  compareForensicReports,
  buildComparisonMarkdown,
  transcriptTextFromReport,
  runForensicQa,
};
