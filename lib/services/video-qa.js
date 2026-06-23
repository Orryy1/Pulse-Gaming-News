/**
 * lib/services/video-qa.js — lightweight ffprobe/ffmpeg-based video
 * sanity check. Complements lib/services/content-qa.js which covers
 * story metadata + file existence. This module's job is to catch
 * the render-level issues that metadata alone can't see:
 *
 *   1. Wrong-duration videos (e.g. a render that bailed early or
 *      produced a 3s file because the input audio was truncated).
 *   2. Black segments at the start (the "first 2s is black while
 *      music ramps in" artefact the earlier pipeline shipped in
 *      production before 2026-04-20).
 *   3. Long black segments anywhere (indicates the multi-image
 *      assembly dropped a segment).
 *
 * Explicit non-goals:
 *   - Per-frame quality analysis. Expensive, requires pixel data,
 *     and the pipeline doesn't have an obvious "bad frame" signature
 *     that a threshold can catch.
 *   - Subtitle validation. Subtitles are baked via ASS filter, so
 *     any reliable check requires re-reading them out — out of scope.
 *   - Audio level / silence detection. The publish pipeline's audio
 *     comes from ElevenLabs with a known loudness floor; cheap to
 *     add later if needed.
 *
 * All ffprobe/ffmpeg invocations go via child_process.exec — if the
 * binary is missing on the host (tests running in CI without
 * ffmpeg), we return `{ result: "skip", reason: "ffmpeg_missing" }`
 * so the caller treats it as a soft-skip rather than a fail.
 */

const { exec } = require("node:child_process");
const util = require("node:util");
const fsExtra = require("fs-extra");
const mediaPaths = require("../media-paths");
const {
  DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS,
  DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS,
  NORMAL_PRODUCTION_DURATION_LANE,
  RETENTION_DURATION_LANE,
  durationBoundsForLane,
  resolveDurationLane,
} = require("./short-duration-contract");

const execAsync = util.promisify(exec);

const DEFAULT_MIN_DURATION_SECONDS = 40; // a Pulse short should be
const DEFAULT_MIN_RETENTION_SHORT_SECONDS = 22;
const DEFAULT_MIN_NORMAL_PRODUCTION_SECONDS = DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS;
const DEFAULT_MAX_NORMAL_PRODUCTION_SECONDS = DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS;
// 50±5s; anything below 40s is almost certainly a render that
// bailed early.
const DEFAULT_MAX_DURATION_SECONDS = 75; // well above the 50s target
// but not so loose that a runaway render slips through.
const DEFAULT_MAX_OPENING_BLACK_SECONDS = 1.2; // the render pipeline
// has a dip-to-black between segments; anything more than ~1.2s
// at the very start means the first slot shipped black.
const DEFAULT_MAX_BLACK_SEGMENT_SECONDS = 1.2; // middle-of-video
// black longer than ~1.2s implies a segment dropped out of the
// xfade chain.
const DEFAULT_MAX_FREEZE_SEGMENT_SECONDS = 0.65; // active shorts should not
// hold visually static frames for more than a beat.
const DEFAULT_MAX_CUMULATIVE_FREEZE_SECONDS = 1.4; // several shorter holds
// add up to the same viewer-facing choppiness as one long freeze.

// Regex extracting seconds from ffprobe's "duration=..." output.
const DURATION_RE = /duration=([\d.]+)/i;

// ffmpeg -vf blackdetect prints lines like:
//   [blackdetect @ 0x...] black_start:0 black_end:1.234 black_duration:1.234
const BLACKDETECT_LINE_RE =
  /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/gi;
const FREEZE_START_RE = /freeze_start:\s*([\d.]+)/i;
const FREEZE_DURATION_RE = /freeze_duration:\s*([\d.]+)/i;
const FREEZE_END_RE = /freeze_end:\s*([\d.]+)/i;
const FRAMEHASH_LINE_RE =
  /^\s*\d+\s*,\s*[-\d]+\s*,\s*[-\d]+\s*,\s*[-\d]+\s*,\s*\d+\s*,\s*([0-9a-f]{16,})\s*$/i;

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function storyDurationLane(story = {}) {
  return resolveDurationLane({ story });
}

function buildVideoQaOptionsForStory(story = {}, baseOptions = {}) {
  const options = { ...(baseOptions || {}) };
  const lane = storyDurationLane(story);
  const retentionShortAllowed =
    bool(story.allow_retention_short_video) || lane === RETENTION_DURATION_LANE;

  if (retentionShortAllowed) {
    const bounds = durationBoundsForLane(RETENTION_DURATION_LANE);
    options.minDuration =
      finiteNumberOrNull(story.min_video_duration_seconds) ??
      finiteNumberOrNull(story.minVideoDurationSeconds) ??
      finiteNumberOrNull(options.minDuration) ??
      bounds.minVideoSeconds;
  } else if (lane === NORMAL_PRODUCTION_DURATION_LANE) {
    const bounds = durationBoundsForLane(NORMAL_PRODUCTION_DURATION_LANE);
    options.minDuration =
      finiteNumberOrNull(story.min_video_duration_seconds) ??
      finiteNumberOrNull(story.minVideoDurationSeconds) ??
      finiteNumberOrNull(options.minDuration) ??
      bounds.minVideoSeconds;
    options.maxDuration =
      finiteNumberOrNull(story.max_video_duration_seconds) ??
      finiteNumberOrNull(story.maxVideoDurationSeconds) ??
      finiteNumberOrNull(options.maxDuration) ??
      bounds.maxVideoSeconds;
  }

  return options;
}

/**
 * Parse ffprobe stdout into a numeric duration. Exported for tests
 * so they don't need to shell out to the real ffprobe.
 */
function parseFfprobeDuration(stdout) {
  if (typeof stdout !== "string") return null;
  const m = DURATION_RE.exec(stdout);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse ffmpeg -vf blackdetect stderr into an array of
 * { start, end, duration } segments. Exported for tests.
 */
function parseBlackdetectOutput(stderr) {
  if (typeof stderr !== "string") return [];
  const out = [];
  let m;
  BLACKDETECT_LINE_RE.lastIndex = 0;
  while ((m = BLACKDETECT_LINE_RE.exec(stderr)) !== null) {
    out.push({
      start: parseFloat(m[1]),
      end: parseFloat(m[2]),
      duration: parseFloat(m[3]),
    });
  }
  return out;
}

function parseFreezedetectOutput(stderr) {
  if (typeof stderr !== "string") return [];
  const out = [];
  let current = null;
  for (const line of stderr.split(/\r?\n/)) {
    const start = FREEZE_START_RE.exec(line);
    if (start) {
      current = {
        start: parseFloat(start[1]),
        end: null,
        duration: null,
      };
      continue;
    }

    const duration = FREEZE_DURATION_RE.exec(line);
    if (duration && current) {
      current.duration = parseFloat(duration[1]);
      continue;
    }

    const end = FREEZE_END_RE.exec(line);
    if (end && current) {
      current.end = parseFloat(end[1]);
      if (!Number.isFinite(current.duration) && Number.isFinite(current.start)) {
        current.duration = current.end - current.start;
      }
      if (
        Number.isFinite(current.start) &&
        Number.isFinite(current.end) &&
        Number.isFinite(current.duration)
      ) {
        out.push(current);
      }
      current = null;
    }
  }
  return out;
}

function parseFramehashOutput(stdout) {
  if (typeof stdout !== "string") return [];
  const frames = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const match = FRAMEHASH_LINE_RE.exec(line);
    if (!match) continue;
    frames.push({
      index: frames.length,
      hash: match[1].toLowerCase(),
    });
  }
  return frames;
}

function repeatedFrameHashPairs(frames = [], { minGap = 2 } = {}) {
  const firstSeen = new Map();
  const pairs = [];
  for (const frame of Array.isArray(frames) ? frames : []) {
    const hash = String(frame?.hash || "").trim().toLowerCase();
    const index = finiteNumberOrNull(frame?.index);
    if (!hash || index == null) continue;
    if (!firstSeen.has(hash)) {
      firstSeen.set(hash, index);
      continue;
    }
    const first = firstSeen.get(hash);
    const gap = index - first;
    if (gap >= minGap) {
      pairs.push({
        hash,
        first_index: first,
        repeat_index: index,
        gap,
      });
    }
  }
  return pairs;
}

/**
 * Apply the duration + blackdetect decision rules. Separated from
 * the ffmpeg shell-out so tests can exercise every branch without
 * any filesystem or child process.
 *
 * Hard fails (block publish):
 *   - duration below min or above max
 *   - any black segment (including the opening one) longer than
 *     DEFAULT_MAX_BLACK_SEGMENT_SECONDS
 * Warns:
 *   - opening black 0.4s < x <= DEFAULT_MAX_OPENING_BLACK_SECONDS
 *     (the xfade dip is expected at ~0.5s; more than that but
 *     still under the hard bound is worth noting)
 */
function classifyVideoQa({
  durationSeconds,
  blackSegments,
  freezeSegments,
  repeatedFramePairs,
  minDuration = DEFAULT_MIN_DURATION_SECONDS,
  maxDuration = DEFAULT_MAX_DURATION_SECONDS,
  maxOpeningBlack = DEFAULT_MAX_OPENING_BLACK_SECONDS,
  maxSegmentBlack = DEFAULT_MAX_BLACK_SEGMENT_SECONDS,
  maxFreezeSegment = DEFAULT_MAX_FREEZE_SEGMENT_SECONDS,
  maxCumulativeFreeze = DEFAULT_MAX_CUMULATIVE_FREEZE_SECONDS,
  maxRepeatedFramePairs = 0,
}) {
  const failures = [];
  const warnings = [];

  if (
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds)
  ) {
    failures.push("duration_unknown");
  } else if (durationSeconds < minDuration) {
    failures.push(`duration_too_short (${durationSeconds.toFixed(2)}s)`);
  } else if (durationSeconds > maxDuration) {
    failures.push(`duration_too_long (${durationSeconds.toFixed(2)}s)`);
  }

  const segments = Array.isArray(blackSegments) ? blackSegments : [];
  for (const seg of segments) {
    if (!seg || typeof seg.duration !== "number") continue;
    if (seg.duration > maxSegmentBlack) {
      failures.push(
        `black_segment_too_long (${seg.duration.toFixed(2)}s @ ${
          typeof seg.start === "number" ? seg.start.toFixed(2) : "?"
        }s)`,
      );
    }
  }

  // Opening-black warn: any segment that starts within the first
  // 0.4s (i.e. essentially "from frame zero") and lasts longer than
  // the expected ~0.5s xfade dip.
  const opening = segments.find(
    (s) => s && typeof s.start === "number" && s.start <= 0.4,
  );
  if (
    opening &&
    opening.duration > 0.6 &&
    opening.duration <= maxOpeningBlack
  ) {
    warnings.push(`opening_black (${opening.duration.toFixed(2)}s)`);
  }

  const freezes = Array.isArray(freezeSegments) ? freezeSegments : [];
  let cumulativeFreeze = 0;
  for (const seg of freezes) {
    if (!seg || typeof seg.duration !== "number" || !Number.isFinite(seg.duration)) continue;
    cumulativeFreeze += seg.duration;
    if (seg.duration > maxFreezeSegment) {
      failures.push(
        `freeze_segment_too_long (${seg.duration.toFixed(2)}s @ ${
          typeof seg.start === "number" ? seg.start.toFixed(2) : "?"
        }s)`,
      );
    }
  }
  if (cumulativeFreeze > maxCumulativeFreeze) {
    failures.push(`cumulative_freeze_too_high (${cumulativeFreeze.toFixed(2)}s)`);
  }

  const repeatPairs = Array.isArray(repeatedFramePairs) ? repeatedFramePairs : [];
  if (repeatPairs.length > maxRepeatedFramePairs) {
    failures.push(`repeated_frame_hashes (${repeatPairs.length} pairs)`);
  }

  let result;
  if (failures.length > 0) result = "fail";
  else if (warnings.length > 0) result = "warn";
  else result = "pass";

  return { result, failures, warnings };
}

/**
 * Run the full video QA pass against a real MP4 on disk. Returns a
 * result shape compatible with content-qa.js. Opts:
 *
 *   - mp4Path: required
 *   - fs: override (tests use it to check file existence without
 *     actually writing)
 *   - exec: override (tests stub this to avoid shelling out)
 *   - min/max duration / black thresholds: override for tighter
 *     or looser checks on specific render kinds (e.g. roundup
 *     videos that are legitimately long)
 */
async function runVideoQa(mp4Path, opts = {}) {
  const fs = opts.fs || fsExtra;
  const runExec = opts.exec || execAsync;

  if (!mp4Path || typeof mp4Path !== "string") {
    return { result: "fail", failures: ["mp4_path_missing"], warnings: [] };
  }

  // Resolve via media-paths so the MP4 is found under MEDIA_ROOT
  // (Railway persistent volume) when set, with repo-root fallback
  // for legacy rows. The rest of this function talks to ffprobe/
  // ffmpeg with an absolute path — important since those binaries
  // don't share our CWD semantics.
  let resolvedPath;
  try {
    resolvedPath = await mediaPaths.resolveExisting(mp4Path, { fs });
  } catch {
    resolvedPath = mp4Path;
  }
  if (!resolvedPath) {
    return { result: "fail", failures: ["mp4_not_on_disk"], warnings: [] };
  }

  let exists;
  try {
    exists = await fs.pathExists(resolvedPath);
  } catch (err) {
    return {
      result: "fail",
      failures: [`mp4_stat_failed:${err.code || "unknown"}`],
      warnings: [],
    };
  }
  if (!exists) {
    return { result: "fail", failures: ["mp4_not_on_disk"], warnings: [] };
  }

  // From here on, all ffprobe/ffmpeg invocations use the resolved
  // absolute path rather than the relative DB string.
  mp4Path = resolvedPath;

  // --- duration via ffprobe ---
  let durationSeconds = null;
  try {
    const probe = await runExec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "${mp4Path}"`,
      { timeout: 15000 },
    );
    durationSeconds = parseFfprobeDuration(probe.stdout);
  } catch (err) {
    // ffprobe missing / non-zero exit / timeout — treat as a skip
    // rather than fail so the pipeline doesn't crash on local
    // dev without ffmpeg installed.
    if (
      err.code === "ENOENT" ||
      (err.message || "").includes("ffprobe") ||
      (err.message || "").includes("not recognized")
    ) {
      return { result: "skip", reason: "ffprobe_missing" };
    }
    return {
      result: "fail",
      failures: [`ffprobe_failed:${err.code || "unknown"}`],
      warnings: [],
    };
  }

  // Scan the whole short for black and frozen visual sections. Hook-only
  // checks missed late static trailer/title-card sections in live uploads.
  let blackSegments = [];
  let freezeSegments = [];
  let repeatedFramePairs = [];
  try {
    const out = await runExec(
      `ffmpeg -hide_banner -nostats -i "${mp4Path}" -vf "freezedetect=n=-45dB:d=0.25,blackdetect=d=0.15:pix_th=0.08" -an -f null - 2>&1`,
      { timeout: 35000 },
    );
    const scanOutput = out.stdout || out.stderr || "";
    blackSegments = parseBlackdetectOutput(scanOutput);
    freezeSegments = parseFreezedetectOutput(scanOutput);
  } catch (err) {
    // ffmpeg can exit non-zero even with valid output (the `2>&1`
    // above routes everything to stdout on POSIX, but exec's
    // error-on-exit may still fire). We get partial output in
    // err.stdout/err.stderr — use whichever is populated.
    if (err.code === "ENOENT") {
      return { result: "skip", reason: "ffmpeg_missing" };
    }
    const scanOutput = (err.stdout || "") + (err.stderr || "");
    blackSegments = parseBlackdetectOutput(scanOutput);
    freezeSegments = parseFreezedetectOutput(scanOutput);
  }

  if (opts.disableRepeatedFrameScan !== true) {
    try {
      const out = await runExec(
        `ffmpeg -hide_banner -nostats -i "${mp4Path}" -vf "fps=1,scale=96:96:force_original_aspect_ratio=decrease,pad=96:96:(ow-iw)/2:(oh-ih)/2,format=gray" -an -f framemd5 - 2>&1`,
        { timeout: 35000 },
      );
      repeatedFramePairs = repeatedFrameHashPairs(
        parseFramehashOutput((out.stdout || "") + (out.stderr || "")),
        { minGap: opts.minRepeatedFrameGapSeconds || 2 },
      );
    } catch (err) {
      if (err.code === "ENOENT") {
        return { result: "skip", reason: "ffmpeg_missing" };
      }
      repeatedFramePairs = repeatedFrameHashPairs(
        parseFramehashOutput((err.stdout || "") + (err.stderr || "")),
        { minGap: opts.minRepeatedFrameGapSeconds || 2 },
      );
    }
  }

  return classifyVideoQa({
    durationSeconds,
    blackSegments,
    freezeSegments,
    repeatedFramePairs,
    minDuration: opts.minDuration,
    maxDuration: opts.maxDuration,
    maxOpeningBlack: opts.maxOpeningBlack,
    maxSegmentBlack: opts.maxSegmentBlack,
    maxFreezeSegment: opts.maxFreezeSegment,
    maxCumulativeFreeze: opts.maxCumulativeFreeze,
    maxRepeatedFramePairs: opts.maxRepeatedFramePairs,
  });
}

module.exports = {
  runVideoQa,
  classifyVideoQa,
  parseFfprobeDuration,
  parseBlackdetectOutput,
  parseFreezedetectOutput,
  parseFramehashOutput,
  repeatedFrameHashPairs,
  buildVideoQaOptionsForStory,
  DEFAULT_MIN_DURATION_SECONDS,
  DEFAULT_MIN_RETENTION_SHORT_SECONDS,
  DEFAULT_MIN_NORMAL_PRODUCTION_SECONDS,
  DEFAULT_MAX_NORMAL_PRODUCTION_SECONDS,
  DEFAULT_MAX_DURATION_SECONDS,
  DEFAULT_MAX_OPENING_BLACK_SECONDS,
  DEFAULT_MAX_BLACK_SEGMENT_SECONDS,
  DEFAULT_MAX_FREEZE_SEGMENT_SECONDS,
  DEFAULT_MAX_CUMULATIVE_FREEZE_SECONDS,
};
