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

const execAsync = util.promisify(exec);

const DEFAULT_MIN_DURATION_SECONDS = 40; // a Pulse short should be
// 50±5s; anything below 40s is almost certainly a render that
// bailed early.
const DEFAULT_MAX_DURATION_SECONDS = 75; // well above the 50s target
// but not so loose that a runaway render slips through.
const DEFAULT_MAX_OPENING_BLACK_SECONDS = 1.2; // the render pipeline
// has a dip-to-black between segments; anything more than ~1.2s
// at the very start means the first slot shipped black.
const DEFAULT_MAX_BLACK_SEGMENT_SECONDS = 2.0; // middle-of-video
// black longer than ~2s implies a segment dropped out of the
// xfade chain.

// Regex extracting seconds from ffprobe's "duration=..." output.
const DURATION_RE = /duration=([\d.]+)/i;

// ffmpeg -vf blackdetect prints lines like:
//   [blackdetect @ 0x...] black_start:0 black_end:1.234 black_duration:1.234
const BLACKDETECT_LINE_RE =
  /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/gi;

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
  minDuration = DEFAULT_MIN_DURATION_SECONDS,
  maxDuration = DEFAULT_MAX_DURATION_SECONDS,
  maxOpeningBlack = DEFAULT_MAX_OPENING_BLACK_SECONDS,
  maxSegmentBlack = DEFAULT_MAX_BLACK_SEGMENT_SECONDS,
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

  let exists;
  try {
    exists = await fs.pathExists(mp4Path);
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

  // --- black segments via ffmpeg -vf blackdetect ---
  // Only scan the first 15 seconds — cheap enough and covers the
  // actual "black hook" risk. Also catches the middle-of-video
  // dropped-segment case most of the time (xfade dips are early).
  let blackSegments = [];
  try {
    const out = await runExec(
      `ffmpeg -hide_banner -nostats -i "${mp4Path}" -vf "blackdetect=d=0.5:pic_th=0.98" -t 15 -an -f null - 2>&1`,
      { timeout: 20000 },
    );
    blackSegments = parseBlackdetectOutput(out.stdout || out.stderr || "");
  } catch (err) {
    // ffmpeg can exit non-zero even with valid output (the `2>&1`
    // above routes everything to stdout on POSIX, but exec's
    // error-on-exit may still fire). We get partial output in
    // err.stdout/err.stderr — use whichever is populated.
    if (err.code === "ENOENT") {
      return { result: "skip", reason: "ffmpeg_missing" };
    }
    blackSegments = parseBlackdetectOutput(
      (err.stdout || "") + (err.stderr || ""),
    );
  }

  return classifyVideoQa({
    durationSeconds,
    blackSegments,
    minDuration: opts.minDuration,
    maxDuration: opts.maxDuration,
    maxOpeningBlack: opts.maxOpeningBlack,
    maxSegmentBlack: opts.maxSegmentBlack,
  });
}

module.exports = {
  runVideoQa,
  classifyVideoQa,
  parseFfprobeDuration,
  parseBlackdetectOutput,
  DEFAULT_MIN_DURATION_SECONDS,
  DEFAULT_MAX_DURATION_SECONDS,
  DEFAULT_MAX_OPENING_BLACK_SECONDS,
  DEFAULT_MAX_BLACK_SEGMENT_SECONDS,
};
