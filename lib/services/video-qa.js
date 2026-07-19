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
 *   4. Full audio-video stream decode failures.
 *   5. Reused motion sequences, sustained low-cadence/stutter and
 *      isolated local stalls, measured from a low-resolution
 *      perceptual sample across the entire duration.
 *
 * Subtitle timing and loudness remain separate authoritative gates.
 *
 * All ffprobe/ffmpeg invocations go via child_process.exec. Missing
 * production tooling fails closed; tests and explicit developer
 * diagnostics can request a soft skip.
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
const DEFAULT_MIN_CUMULATIVE_FREEZE_SEGMENT_SECONDS = 0.4; // sub-0.4s
// editorial beats are tracked but do not accumulate into false freeze debt.
const DEFAULT_TEMPORAL_SAMPLE_FPS = 6;
const DEFAULT_TEMPORAL_FRAME_WIDTH = 9;
const DEFAULT_TEMPORAL_FRAME_HEIGHT = 8;
const DEFAULT_TEMPORAL_MIN_COVERAGE_RATIO = 0.9;
const DEFAULT_MIN_REPEATED_SEQUENCE_SECONDS = 1.5;
const DEFAULT_MIN_REPEATED_SEQUENCE_GAP_SECONDS = 3;
const DEFAULT_TEMPORAL_MAX_HASH_DISTANCE = 4;
const DEFAULT_CADENCE_WINDOW_SECONDS = 3;
const DEFAULT_CADENCE_NEAR_STATIC_HASH_DISTANCE = 1;
const DEFAULT_MAX_OVERALL_NEAR_STATIC_RATIO = 0.55;
const DEFAULT_MAX_WINDOW_NEAR_STATIC_RATIO = 0.7;

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
  options.requireDecodeScan = true;
  options.requireTemporalScan = true;
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

function perceptualHashForGrayFrame(frame, width, height) {
  if (!Buffer.isBuffer(frame) || width < 2 || height < 1) return "";
  let hash = 0n;
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width - 1; x += 1) {
      hash <<= 1n;
      if (frame[rowOffset + x] > frame[rowOffset + x + 1]) hash |= 1n;
    }
  }
  const bitCount = height * (width - 1);
  return hash.toString(16).padStart(Math.ceil(bitCount / 4), "0");
}

function parseTemporalFrameBuffer(
  input,
  {
    width = DEFAULT_TEMPORAL_FRAME_WIDTH,
    height = DEFAULT_TEMPORAL_FRAME_HEIGHT,
    sampleFps = DEFAULT_TEMPORAL_SAMPLE_FPS,
  } = {},
) {
  const buffer = Buffer.isBuffer(input)
    ? input
    : typeof input === "string"
      ? Buffer.from(input, "binary")
      : Buffer.alloc(0);
  const frameSize = width * height;
  if (!frameSize || !Number.isFinite(sampleFps) || sampleFps <= 0) return [];

  const frameCount = Math.floor(buffer.length / frameSize);
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const start = index * frameSize;
    const frame = buffer.subarray(start, start + frameSize);
    frames.push({
      index,
      time_seconds: index / sampleFps,
      hash: perceptualHashForGrayFrame(frame, width, height),
    });
  }
  return frames;
}

function hammingDistanceHex(left, right) {
  if (!/^[0-9a-f]+$/i.test(String(left || "")) || !/^[0-9a-f]+$/i.test(String(right || ""))) {
    return Number.POSITIVE_INFINITY;
  }
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (value > 0n) {
    value &= value - 1n;
    count += 1;
  }
  return count;
}

function rangeOverlapRatio(leftStart, leftLength, rightStart, rightLength) {
  const overlap = Math.max(
    0,
    Math.min(leftStart + leftLength, rightStart + rightLength) -
      Math.max(leftStart, rightStart),
  );
  return overlap / Math.max(1, Math.min(leftLength, rightLength));
}

function analyzeTemporalFrames(
  inputFrames,
  {
    sampleFps = DEFAULT_TEMPORAL_SAMPLE_FPS,
    expectedDurationSeconds = null,
    minCoverageRatio = DEFAULT_TEMPORAL_MIN_COVERAGE_RATIO,
    minRepeatedSequenceSeconds = DEFAULT_MIN_REPEATED_SEQUENCE_SECONDS,
    minRepeatedSequenceGapSeconds = DEFAULT_MIN_REPEATED_SEQUENCE_GAP_SECONDS,
    maxHashDistance = DEFAULT_TEMPORAL_MAX_HASH_DISTANCE,
    cadenceWindowSeconds = DEFAULT_CADENCE_WINDOW_SECONDS,
    nearStaticHashDistance = DEFAULT_CADENCE_NEAR_STATIC_HASH_DISTANCE,
    maxOverallNearStaticRatio = DEFAULT_MAX_OVERALL_NEAR_STATIC_RATIO,
    maxWindowNearStaticRatio: maxAllowedWindowNearStaticRatio =
      DEFAULT_MAX_WINDOW_NEAR_STATIC_RATIO,
  } = {},
) {
  const frames = (Array.isArray(inputFrames) ? inputFrames : [])
    .map((frame, fallbackIndex) => ({
      index: finiteNumberOrNull(frame?.index) ?? fallbackIndex,
      time_seconds:
        finiteNumberOrNull(frame?.time_seconds) ?? fallbackIndex / sampleFps,
      hash: String(frame?.hash || "").trim().toLowerCase(),
    }))
    .filter((frame) => /^[0-9a-f]{16}$/i.test(frame.hash));
  const analyzedDurationSeconds = frames.length / sampleFps;
  const expectedSamples =
    Number.isFinite(expectedDurationSeconds) && expectedDurationSeconds > 0
      ? expectedDurationSeconds * sampleFps
      : null;
  const coverageRatio =
    expectedSamples == null
      ? frames.length > 0
        ? 1
        : 0
      : Math.min(1, frames.length / expectedSamples);

  const adjacentDistances = [];
  let consecutiveNearStatic = 0;
  let maxConsecutiveNearStatic = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const distance = hammingDistanceHex(frames[index - 1].hash, frames[index].hash);
    adjacentDistances.push(distance);
    if (distance <= nearStaticHashDistance) {
      consecutiveNearStatic += 1;
      maxConsecutiveNearStatic = Math.max(maxConsecutiveNearStatic, consecutiveNearStatic);
    } else {
      consecutiveNearStatic = 0;
    }
  }

  const nearStaticPairs = adjacentDistances.filter(
    (distance) => distance <= nearStaticHashDistance,
  ).length;
  const overallNearStaticRatio = adjacentDistances.length
    ? nearStaticPairs / adjacentDistances.length
    : 0;
  const cadenceWindowFrames = Math.min(
    frames.length,
    Math.max(2, Math.ceil(cadenceWindowSeconds * sampleFps)),
  );
  let maxWindowNearStaticRatio = 0;
  let maxWindowStartIndex = null;
  for (
    let start = 0;
    cadenceWindowFrames >= 2 && start + cadenceWindowFrames <= frames.length;
    start += 1
  ) {
    let nearStatic = 0;
    const pairCount = cadenceWindowFrames - 1;
    for (let offset = 1; offset < cadenceWindowFrames; offset += 1) {
      if (
        hammingDistanceHex(
          frames[start + offset - 1].hash,
          frames[start + offset].hash,
        ) <= nearStaticHashDistance
      ) {
        nearStatic += 1;
      }
    }
    const windowNearStaticRatio = nearStatic / pairCount;
    if (windowNearStaticRatio > maxWindowNearStaticRatio) {
      maxWindowNearStaticRatio = windowNearStaticRatio;
      maxWindowStartIndex = start;
    }
  }

  const localStallDetected =
    maxWindowStartIndex != null &&
    maxWindowNearStaticRatio >= maxAllowedWindowNearStaticRatio;
  const localStallStartSeconds = localStallDetected
    ? Number(
        (
          finiteNumberOrNull(frames[maxWindowStartIndex]?.time_seconds) ??
          maxWindowStartIndex / sampleFps
        ).toFixed(3),
      )
    : null;
  const localStallEndFrame = localStallDetected
    ? frames[
        Math.min(
          frames.length - 1,
          maxWindowStartIndex + cadenceWindowFrames - 1,
        )
      ]
    : null;
  const localStallEndSeconds = localStallDetected
    ? Number(
        (
          (finiteNumberOrNull(localStallEndFrame?.time_seconds) ??
            (maxWindowStartIndex + cadenceWindowFrames - 1) / sampleFps) +
          1 / sampleFps
        ).toFixed(3),
      )
    : null;

  const minimumSequenceFrames = Math.max(
    2,
    Math.ceil(minRepeatedSequenceSeconds * sampleFps),
  );
  const minimumGapFrames = Math.max(
    minimumSequenceFrames,
    Math.ceil(minRepeatedSequenceGapSeconds * sampleFps),
  );
  const sequenceCandidates = [];

  for (let first = 0; first + minimumSequenceFrames <= frames.length; first += 1) {
    for (
      let repeat = first + minimumGapFrames;
      repeat + minimumSequenceFrames <= frames.length;
      repeat += 1
    ) {
      let matchingFrames = 0;
      while (
        first + matchingFrames < repeat &&
        repeat + matchingFrames < frames.length &&
        hammingDistanceHex(
          frames[first + matchingFrames].hash,
          frames[repeat + matchingFrames].hash,
        ) <= maxHashDistance
      ) {
        matchingFrames += 1;
      }
      if (matchingFrames < minimumSequenceFrames) continue;

      const firstWindow = frames.slice(first, first + matchingFrames);
      const distinctHashes = new Set(firstWindow.map((frame) => frame.hash)).size;
      if (distinctHashes / matchingFrames < 0.5) continue;

      let totalDistance = 0;
      for (let offset = 0; offset < matchingFrames; offset += 1) {
        totalDistance += hammingDistanceHex(
          frames[first + offset].hash,
          frames[repeat + offset].hash,
        );
      }
      sequenceCandidates.push({
        first_index: first,
        repeat_index: repeat,
        frame_count: matchingFrames,
        first_start_seconds: Number((first / sampleFps).toFixed(3)),
        repeat_start_seconds: Number((repeat / sampleFps).toFixed(3)),
        duration_seconds: Number((matchingFrames / sampleFps).toFixed(3)),
        mean_hash_distance: Number((totalDistance / matchingFrames).toFixed(3)),
      });
    }
  }

  sequenceCandidates.sort(
    (left, right) =>
      right.frame_count - left.frame_count ||
      left.first_index - right.first_index ||
      left.repeat_index - right.repeat_index,
  );
  const repeatedMotionSequences = [];
  for (const candidate of sequenceCandidates) {
    const duplicatesExisting = repeatedMotionSequences.some(
      (existing) =>
        rangeOverlapRatio(
          candidate.first_index,
          candidate.frame_count,
          existing.first_index,
          existing.frame_count,
        ) >= 0.5 &&
        rangeOverlapRatio(
          candidate.repeat_index,
          candidate.frame_count,
          existing.repeat_index,
          existing.frame_count,
        ) >= 0.5,
    );
    if (!duplicatesExisting) repeatedMotionSequences.push(candidate);
    if (repeatedMotionSequences.length >= 20) break;
  }

  const repeatedMotionSeconds = repeatedMotionSequences.reduce(
    (sum, row) => sum + row.duration_seconds,
    0,
  );
  const choppy =
    overallNearStaticRatio >= maxOverallNearStaticRatio &&
    maxWindowNearStaticRatio >= maxAllowedWindowNearStaticRatio;

  return {
    schema_version: 1,
    scan_complete: frames.length > 0 && coverageRatio >= minCoverageRatio,
    sample_fps: sampleFps,
    sampled_frame_count: frames.length,
    expected_sample_count:
      expectedSamples == null ? null : Math.ceil(expectedSamples),
    analyzed_duration_seconds: Number(analyzedDurationSeconds.toFixed(3)),
    expected_duration_seconds:
      Number.isFinite(expectedDurationSeconds) && expectedDurationSeconds > 0
        ? Number(expectedDurationSeconds.toFixed(3))
        : null,
    coverage_ratio: Number(coverageRatio.toFixed(4)),
    repeated_motion_sequences: repeatedMotionSequences,
    repeated_motion_seconds: Number(repeatedMotionSeconds.toFixed(3)),
    cadence: {
      adjacent_pair_count: adjacentDistances.length,
      near_static_pair_count: nearStaticPairs,
      overall_near_static_ratio: Number(overallNearStaticRatio.toFixed(4)),
      max_window_near_static_ratio: Number(maxWindowNearStaticRatio.toFixed(4)),
      max_consecutive_near_static_seconds: Number(
        (maxConsecutiveNearStatic / sampleFps).toFixed(3),
      ),
      window_seconds: cadenceWindowSeconds,
      local_stall_detected: localStallDetected,
      local_stall_start_seconds: localStallStartSeconds,
      local_stall_end_seconds: localStallEndSeconds,
      local_stall_threshold_ratio: maxAllowedWindowNearStaticRatio,
      choppy,
    },
  };
}

function reconcileTemporalRepeatScopes(
  temporal,
  { maxRepeatedMotionSequences = 0 } = {},
) {
  const fullFrame =
    temporal && typeof temporal === "object" ? temporal : {};
  const centerCrop =
    fullFrame.supplemental_center_crop &&
    typeof fullFrame.supplemental_center_crop === "object"
      ? fullFrame.supplemental_center_crop
      : null;
  const fullFrameSequences = Array.isArray(
    fullFrame.repeated_motion_sequences,
  )
    ? fullFrame.repeated_motion_sequences
    : null;
  const centerCropSequences = Array.isArray(
    centerCrop?.repeated_motion_sequences,
  )
    ? centerCrop.repeated_motion_sequences
    : null;
  const fullFrameRepeatDetected =
    (fullFrameSequences?.length || 0) > maxRepeatedMotionSequences ||
    Number(fullFrame.repeated_motion_seconds || 0) > 0;
  const centerCropRepeatDetected =
    (centerCropSequences?.length || 0) > maxRepeatedMotionSequences ||
    Number(centerCrop?.repeated_motion_seconds || 0) > 0;
  const centerCropComplete =
    centerCrop?.analysis_scope === "center_crop" &&
    centerCrop?.scan_complete === true &&
    centerCropSequences !== null;
  const cleanCadence =
    fullFrame.cadence?.choppy === false &&
    centerCrop?.cadence?.choppy === false &&
    fullFrame.cadence?.local_stall_detected !== true &&
    centerCrop?.cadence?.local_stall_detected !== true;
  const fullFrameOnlyDisambiguated =
    fullFrameRepeatDetected &&
    centerCropComplete &&
    !centerCropRepeatDetected &&
    cleanCadence;

  return {
    full_frame_repeat_detected: fullFrameRepeatDetected,
    center_crop_repeat_detected: centerCropRepeatDetected,
    center_crop_complete: centerCropComplete,
    clean_cadence: cleanCadence,
    full_frame_only_disambiguated_by_center_crop:
      fullFrameOnlyDisambiguated,
    blocking_full_frame_repeat: fullFrameRepeatDetected,
    blocking_repeat_detected:
      fullFrameRepeatDetected || centerCropRepeatDetected,
  };
}

function normaliseSha256(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");
}

function validateTemporalVideoQaReport(
  report,
  {
    storyId = "",
    renderSha256 = "",
    renderSizeBytes = null,
    minCoverageRatio = DEFAULT_TEMPORAL_MIN_COVERAGE_RATIO,
  } = {},
) {
  const blockers = [];
  const warnings = [];
  const document =
    report &&
    typeof report === "object" &&
    !Array.isArray(report) &&
    Object.keys(report).length > 0
      ? report
      : null;
  if (!document) {
    return {
      valid: false,
      verdict: "RED",
      blockers: ["temporal_video_qa_report_missing"],
      warnings,
      evidence: { present: false },
    };
  }

  const reportStoryId = String(document.story_id || "").trim();
  if (!reportStoryId) blockers.push("temporal_video_qa_story_id_missing");
  else if (storyId && reportStoryId !== String(storyId).trim()) {
    blockers.push("temporal_video_qa_story_id_mismatch");
  }

  const verdict = String(document.verdict || "").trim().toUpperCase();
  if (verdict !== "GREEN") blockers.push("temporal_video_qa_not_green");
  if (document.can_publish !== true) blockers.push("temporal_video_qa_not_publishable");
  blockers.push(
    ...(Array.isArray(document.blockers) ? document.blockers : []).map(
      (blocker) => `temporal_video_qa:${blocker}`,
    ),
  );
  warnings.push(
    ...(Array.isArray(document.warnings) ? document.warnings : []).map(
      (warning) => `temporal_video_qa:${warning}`,
    ),
  );

  const declaredHash = normaliseSha256(document.final_media?.sha256);
  const actualHash = normaliseSha256(renderSha256);
  if (!declaredHash) blockers.push("temporal_video_qa_render_hash_missing");
  else if (!actualHash || declaredHash !== actualHash) {
    blockers.push("temporal_video_qa_render_hash_mismatch");
  }
  const declaredSize = Number(document.final_media?.size_bytes);
  const actualSize = Number(renderSizeBytes);
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    blockers.push("temporal_video_qa_render_size_missing");
  } else if (!Number.isFinite(actualSize) || declaredSize !== actualSize) {
    blockers.push("temporal_video_qa_render_size_mismatch");
  }

  const decode = document.evidence?.decode || {};
  if (decode.complete !== true) blockers.push("temporal_video_qa_decode_incomplete");
  if (decode.video_stream !== true) blockers.push("temporal_video_qa_video_stream_unproven");
  if (decode.audio_stream !== true) blockers.push("temporal_video_qa_audio_stream_unproven");

  const temporal = document.evidence?.temporal || {};
  if (temporal.analysis_scope !== "full_frame") {
    blockers.push("temporal_video_qa_full_frame_scope_missing");
  }
  if (temporal.scan_complete !== true) blockers.push("temporal_video_qa_scan_incomplete");
  if (
    !Number.isFinite(Number(temporal.coverage_ratio)) ||
    Number(temporal.coverage_ratio) < minCoverageRatio
  ) {
    blockers.push("temporal_video_qa_coverage_below_floor");
  }
  if (
    !Number.isFinite(Number(temporal.sampled_frame_count)) ||
    Number(temporal.sampled_frame_count) <= 0
  ) {
    blockers.push("temporal_video_qa_sampled_frames_missing");
  }
  const repeatReconciliation = reconcileTemporalRepeatScopes(temporal);
  if (!Array.isArray(temporal.repeated_motion_sequences)) {
    blockers.push("temporal_video_qa_repeated_motion_evidence_missing");
  } else if (repeatReconciliation.blocking_full_frame_repeat) {
    blockers.push("temporal_video_qa_repeated_motion_detected");
  }
  if (
    Number(temporal.repeated_motion_seconds || 0) > 0 &&
    repeatReconciliation.blocking_full_frame_repeat
  ) {
    blockers.push("temporal_video_qa_repeated_motion_seconds_nonzero");
  }
  if (temporal.cadence?.choppy !== false) {
    blockers.push("temporal_video_qa_choppy_cadence");
  }
  if (temporal.cadence?.local_stall_detected === true) {
    blockers.push("temporal_video_qa_local_stall_detected");
  }

  const centerCrop = temporal.supplemental_center_crop;
  if (!centerCrop || typeof centerCrop !== "object") {
    blockers.push("temporal_video_qa_center_crop_scope_missing");
  } else {
    if (centerCrop.analysis_scope !== "center_crop") {
      blockers.push("temporal_video_qa_center_crop_scope_invalid");
    }
    if (centerCrop.scan_complete !== true) {
      blockers.push("temporal_video_qa_center_crop_scan_incomplete");
    }
    if (
      !Number.isFinite(Number(centerCrop.coverage_ratio)) ||
      Number(centerCrop.coverage_ratio) < minCoverageRatio
    ) {
      blockers.push("temporal_video_qa_center_crop_coverage_below_floor");
    }
    if (
      !Number.isFinite(Number(centerCrop.sampled_frame_count)) ||
      Number(centerCrop.sampled_frame_count) <= 0
    ) {
      blockers.push("temporal_video_qa_center_crop_sampled_frames_missing");
    }
    if (!Array.isArray(centerCrop.repeated_motion_sequences)) {
      blockers.push("temporal_video_qa_center_crop_repeated_motion_evidence_missing");
    } else if (centerCrop.repeated_motion_sequences.length > 0) {
      blockers.push("temporal_video_qa_center_crop_repeated_motion_detected");
    }
    if (Number(centerCrop.repeated_motion_seconds || 0) > 0) {
      blockers.push("temporal_video_qa_center_crop_repeated_motion_seconds_nonzero");
    }
    if (centerCrop.cadence?.choppy !== false) {
      blockers.push("temporal_video_qa_center_crop_choppy_cadence");
    }
    if (centerCrop.cadence?.local_stall_detected === true) {
      blockers.push("temporal_video_qa_center_crop_local_stall_detected");
    }
  }

  const sourceResult = String(document.source_result?.result || "")
    .trim()
    .toLowerCase();
  if (sourceResult !== "pass") blockers.push("temporal_video_qa_source_result_not_pass");
  blockers.push(
    ...(Array.isArray(document.source_result?.failures)
      ? document.source_result.failures
      : []
    ).map((failure) => `temporal_video_qa_source:${failure}`),
  );
  warnings.push(
    ...(Array.isArray(document.source_result?.warnings)
      ? document.source_result.warnings
      : []
    ).map((warning) => `temporal_video_qa_source:${warning}`),
  );

  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  const uniqueWarnings = [...new Set(warnings.filter(Boolean))];
  const finalVerdict = uniqueBlockers.length
    ? "RED"
    : uniqueWarnings.length
      ? "AMBER"
      : "GREEN";
  return {
    valid: finalVerdict === "GREEN",
    verdict: finalVerdict,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    evidence: {
      present: true,
      story_id: reportStoryId || null,
      declared_verdict: verdict || null,
      render_hash_matches:
        Boolean(declaredHash && actualHash) && declaredHash === actualHash,
      render_size_matches:
        Number.isFinite(declaredSize) &&
        Number.isFinite(actualSize) &&
        declaredSize === actualSize,
      decode_complete: decode.complete === true,
      video_stream_decoded: decode.video_stream === true,
      audio_stream_decoded: decode.audio_stream === true,
      temporal_scan_complete: temporal.scan_complete === true,
      temporal_analysis_scope: temporal.analysis_scope || null,
      temporal_coverage_ratio: Number(temporal.coverage_ratio || 0),
      sampled_frame_count: Number(temporal.sampled_frame_count || 0),
      repeated_motion_sequence_count: Array.isArray(
        temporal.repeated_motion_sequences,
      )
        ? temporal.repeated_motion_sequences.length
        : null,
      choppy_cadence: temporal.cadence?.choppy ?? null,
      local_stall_detected:
        temporal.cadence?.local_stall_detected ?? null,
      local_stall_start_seconds:
        temporal.cadence?.local_stall_start_seconds ?? null,
      local_stall_end_seconds:
        temporal.cadence?.local_stall_end_seconds ?? null,
      center_crop_scope:
        centerCrop && typeof centerCrop === "object"
          ? centerCrop.analysis_scope || null
          : null,
      center_crop_scan_complete: centerCrop?.scan_complete === true,
      center_crop_coverage_ratio: Number(centerCrop?.coverage_ratio || 0),
      center_crop_repeated_motion_sequence_count: Array.isArray(
        centerCrop?.repeated_motion_sequences,
      )
        ? centerCrop.repeated_motion_sequences.length
        : null,
      center_crop_choppy_cadence: centerCrop?.cadence?.choppy ?? null,
      center_crop_local_stall_detected:
        centerCrop?.cadence?.local_stall_detected ?? null,
      center_crop_local_stall_start_seconds:
        centerCrop?.cadence?.local_stall_start_seconds ?? null,
      center_crop_local_stall_end_seconds:
        centerCrop?.cadence?.local_stall_end_seconds ?? null,
      repeat_reconciliation: repeatReconciliation,
    },
  };
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
  decodeEvidence,
  requireDecodeScan = false,
  temporalAnalysis,
  requireTemporalScan = false,
  minDuration = DEFAULT_MIN_DURATION_SECONDS,
  maxDuration = DEFAULT_MAX_DURATION_SECONDS,
  maxOpeningBlack = DEFAULT_MAX_OPENING_BLACK_SECONDS,
  maxSegmentBlack = DEFAULT_MAX_BLACK_SEGMENT_SECONDS,
  maxFreezeSegment = DEFAULT_MAX_FREEZE_SEGMENT_SECONDS,
  maxCumulativeFreeze = DEFAULT_MAX_CUMULATIVE_FREEZE_SECONDS,
  minCumulativeFreezeSegment = DEFAULT_MIN_CUMULATIVE_FREEZE_SEGMENT_SECONDS,
  maxRepeatedFramePairs = 0,
  maxRepeatedMotionSequences = 0,
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

  const decode =
    decodeEvidence && typeof decodeEvidence === "object"
      ? decodeEvidence
      : null;
  if (requireDecodeScan && decode?.complete !== true) {
    failures.push(
      `media_decode_failed:${String(decode?.error || "full_audio_video_decode_required")}`,
    );
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
    if (seg.duration >= minCumulativeFreezeSegment) cumulativeFreeze += seg.duration;
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

  const temporal =
    temporalAnalysis && typeof temporalAnalysis === "object"
      ? temporalAnalysis
      : null;
  if (requireTemporalScan && !temporal) {
    failures.push("temporal_scan_missing");
  } else if (temporal) {
    if (requireTemporalScan && temporal.analysis_scope !== "full_frame") {
      failures.push("temporal_full_frame_scope_missing");
    }
    if (temporal.scan_complete !== true) {
      failures.push(
        `temporal_scan_incomplete (${Number(temporal.coverage_ratio || 0).toFixed(3)} coverage)`,
      );
    }
    const repeatedMotion = Array.isArray(temporal.repeated_motion_sequences)
      ? temporal.repeated_motion_sequences
      : [];
    const repeatReconciliation = reconcileTemporalRepeatScopes(temporal, {
      maxRepeatedMotionSequences,
    });
    if (repeatReconciliation.blocking_full_frame_repeat) {
      failures.push(
        `repeated_motion_sequence (${repeatedMotion.length} sequences, ${Number(
          temporal.repeated_motion_seconds || 0,
        ).toFixed(2)}s)`,
      );
    }
    if (temporal.cadence?.choppy === true) {
      failures.push(
        `choppy_temporal_cadence (${Number(
          temporal.cadence.overall_near_static_ratio || 0,
        ).toFixed(3)} overall, ${Number(
          temporal.cadence.max_window_near_static_ratio || 0,
        ).toFixed(3)} peak)`,
      );
    }
    if (temporal.cadence?.local_stall_detected === true) {
      failures.push(
        `stalled_visual_window (${Number(
          temporal.cadence.max_window_near_static_ratio || 0,
        ).toFixed(3)} near-static @ ${Number(
          temporal.cadence.local_stall_start_seconds || 0,
        ).toFixed(2)}-${Number(
          temporal.cadence.local_stall_end_seconds || 0,
        ).toFixed(2)}s)`,
      );
    }
    const centerCrop = temporal.supplemental_center_crop;
    if (requireTemporalScan && (!centerCrop || typeof centerCrop !== "object")) {
      failures.push("temporal_center_crop_scope_missing");
    } else if (centerCrop && typeof centerCrop === "object") {
      if (requireTemporalScan && centerCrop.analysis_scope !== "center_crop") {
        failures.push("temporal_center_crop_scope_invalid");
      }
      if (centerCrop.scan_complete !== true) {
        failures.push(
          `temporal_scan_incomplete_center_crop (${Number(
            centerCrop.coverage_ratio || 0,
          ).toFixed(3)} coverage)`,
        );
      }
      const centerCropRepeatedMotion = Array.isArray(
        centerCrop.repeated_motion_sequences,
      )
        ? centerCrop.repeated_motion_sequences
        : [];
      if (centerCropRepeatedMotion.length > maxRepeatedMotionSequences) {
        failures.push(
          `repeated_motion_sequence_center_crop (${centerCropRepeatedMotion.length} sequences, ${Number(
            centerCrop.repeated_motion_seconds || 0,
          ).toFixed(2)}s)`,
        );
      }
      if (centerCrop.cadence?.choppy === true) {
        failures.push(
          `choppy_temporal_cadence_center_crop (${Number(
            centerCrop.cadence.overall_near_static_ratio || 0,
          ).toFixed(3)} overall, ${Number(
            centerCrop.cadence.max_window_near_static_ratio || 0,
          ).toFixed(3)} peak)`,
        );
      }
      if (centerCrop.cadence?.local_stall_detected === true) {
        failures.push(
          `stalled_visual_window_center_crop (${Number(
            centerCrop.cadence.max_window_near_static_ratio || 0,
          ).toFixed(3)} near-static @ ${Number(
            centerCrop.cadence.local_stall_start_seconds || 0,
          ).toFixed(2)}-${Number(
            centerCrop.cadence.local_stall_end_seconds || 0,
          ).toFixed(2)}s)`,
        );
      }
    }
  }

  let result;
  if (failures.length > 0) result = "fail";
  else if (warnings.length > 0) result = "warn";
  else result = "pass";

  return {
    result,
    failures,
    warnings,
    evidence: {
      duration_seconds: durationSeconds,
      decode,
      black_segments: segments,
      freeze_segments: freezes,
      repeated_frame_pairs: repeatPairs,
      temporal,
      temporal_repeat_reconciliation: temporal
        ? reconcileTemporalRepeatScopes(temporal, {
            maxRepeatedMotionSequences,
          })
        : null,
    },
  };
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
  const allowToolMissingSkip = opts.allowToolMissingSkip === true;

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
      return allowToolMissingSkip
        ? { result: "skip", reason: "ffprobe_missing" }
        : { result: "fail", failures: ["ffprobe_missing"], warnings: [] };
    }
    return {
      result: "fail",
      failures: [`ffprobe_failed:${err.code || "unknown"}`],
      warnings: [],
    };
  }

  const requireDecodeScan =
    opts.disableDecodeScan !== true && opts.requireDecodeScan !== false;
  let decodeEvidence = null;
  if (opts.disableDecodeScan !== true) {
    try {
      await runExec(
        `ffmpeg -hide_banner -v error -i "${mp4Path}" -map 0:v:0 -map 0:a:0 -f null -`,
        { timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
      );
      decodeEvidence = {
        complete: true,
        video_stream: true,
        audio_stream: true,
        error: null,
      };
    } catch (err) {
      if (err.code === "ENOENT") {
        return allowToolMissingSkip
          ? { result: "skip", reason: "ffmpeg_missing" }
          : { result: "fail", failures: ["ffmpeg_missing"], warnings: [] };
      }
      decodeEvidence = {
        complete: false,
        video_stream: true,
        audio_stream: !/(?:audio|stream #0:1|0:a:0|matches no streams)/i.test(
          `${err.message || ""}\n${err.stderr || ""}`,
        ),
        error: "full_audio_video_decode_failed",
      };
    }
  }

  // Scan the whole short for black and frozen visual sections. Hook-only
  // checks missed late static trailer/title-card sections in live uploads.
  let blackSegments = [];
  let freezeSegments = [];
  let repeatedFramePairs = [];
  let temporalAnalysis = null;
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
      return allowToolMissingSkip
        ? { result: "skip", reason: "ffmpeg_missing" }
        : { result: "fail", failures: ["ffmpeg_missing"], warnings: [] };
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
        return allowToolMissingSkip
          ? { result: "skip", reason: "ffmpeg_missing" }
          : { result: "fail", failures: ["ffmpeg_missing"], warnings: [] };
      }
      repeatedFramePairs = repeatedFrameHashPairs(
        parseFramehashOutput((err.stdout || "") + (err.stderr || "")),
        { minGap: opts.minRepeatedFrameGapSeconds || 2 },
      );
    }
  }

  const requireTemporalScan =
    opts.disableTemporalScan !== true && opts.requireTemporalScan !== false;
  if (opts.disableTemporalScan !== true) {
    const sampleFps =
      finiteNumberOrNull(opts.temporalSampleFps) ?? DEFAULT_TEMPORAL_SAMPLE_FPS;
    const analyzeScope = async ({ scope, filter }) => {
      try {
        const out = await runExec(
          `ffmpeg -hide_banner -loglevel error -i "${mp4Path}" -vf "${filter}" -an -f rawvideo -pix_fmt gray -`,
          {
            timeout: 45000,
            encoding: "buffer",
            maxBuffer: 8 * 1024 * 1024,
          },
        );
        const frames = parseTemporalFrameBuffer(out.stdout, { sampleFps });
        return {
          ...analyzeTemporalFrames(frames, {
            sampleFps,
            expectedDurationSeconds: durationSeconds,
            minCoverageRatio:
              finiteNumberOrNull(opts.minTemporalCoverageRatio) ??
              DEFAULT_TEMPORAL_MIN_COVERAGE_RATIO,
            minRepeatedSequenceSeconds:
              finiteNumberOrNull(opts.minRepeatedSequenceSeconds) ??
              DEFAULT_MIN_REPEATED_SEQUENCE_SECONDS,
            minRepeatedSequenceGapSeconds:
              finiteNumberOrNull(opts.minRepeatedSequenceGapSeconds) ??
              DEFAULT_MIN_REPEATED_SEQUENCE_GAP_SECONDS,
            maxHashDistance:
              finiteNumberOrNull(opts.maxTemporalHashDistance) ??
              DEFAULT_TEMPORAL_MAX_HASH_DISTANCE,
            maxOverallNearStaticRatio:
              finiteNumberOrNull(opts.maxOverallNearStaticRatio) ??
              DEFAULT_MAX_OVERALL_NEAR_STATIC_RATIO,
            maxWindowNearStaticRatio:
              finiteNumberOrNull(opts.maxWindowNearStaticRatio) ??
              DEFAULT_MAX_WINDOW_NEAR_STATIC_RATIO,
          }),
          analysis_scope: scope,
        };
      } catch (err) {
        if (err.code === "ENOENT") throw err;
        return {
          schema_version: 1,
          analysis_scope: scope,
          scan_complete: false,
          sample_fps: sampleFps,
          sampled_frame_count: 0,
          expected_sample_count: Math.ceil(durationSeconds * sampleFps),
          analyzed_duration_seconds: 0,
          expected_duration_seconds: durationSeconds,
          coverage_ratio: 0,
          repeated_motion_sequences: [],
          repeated_motion_seconds: 0,
          cadence: {
            adjacent_pair_count: 0,
            near_static_pair_count: 0,
            overall_near_static_ratio: 0,
            max_window_near_static_ratio: 0,
            max_consecutive_near_static_seconds: 0,
            window_seconds: DEFAULT_CADENCE_WINDOW_SECONDS,
            local_stall_detected: null,
            local_stall_start_seconds: null,
            local_stall_end_seconds: null,
            choppy: false,
          },
          error: `temporal_scan_failed:${err.code || "unknown"}`,
        };
      }
    };
    try {
      const fullFrame = await analyzeScope({
        scope: "full_frame",
        filter:
          `fps=${sampleFps},scale=${DEFAULT_TEMPORAL_FRAME_WIDTH}:${DEFAULT_TEMPORAL_FRAME_HEIGHT}:` +
          "force_original_aspect_ratio=decrease:flags=area," +
          `pad=${DEFAULT_TEMPORAL_FRAME_WIDTH}:${DEFAULT_TEMPORAL_FRAME_HEIGHT}:` +
          "(ow-iw)/2:(oh-ih)/2:color=black,format=gray",
      });
      const centerCrop = await analyzeScope({
        scope: "center_crop",
        filter:
          `fps=${sampleFps},crop=trunc(iw*0.72/2)*2:trunc(ih*0.58/2)*2:` +
          "trunc(iw*0.14/2)*2:trunc(ih*0.10/2)*2," +
          `scale=${DEFAULT_TEMPORAL_FRAME_WIDTH}:${DEFAULT_TEMPORAL_FRAME_HEIGHT}:` +
          "flags=area,format=gray",
      });
      temporalAnalysis = {
        ...fullFrame,
        dual_scope_complete:
          fullFrame.scan_complete === true && centerCrop.scan_complete === true,
        supplemental_center_crop: centerCrop,
      };
    } catch (err) {
      if (err.code === "ENOENT") {
        return allowToolMissingSkip
          ? { result: "skip", reason: "ffmpeg_missing" }
          : { result: "fail", failures: ["ffmpeg_missing"], warnings: [] };
      }
      temporalAnalysis = {
        schema_version: 1,
        analysis_scope: "full_frame",
        scan_complete: false,
        sample_fps: sampleFps,
        sampled_frame_count: 0,
        expected_sample_count: Math.ceil(durationSeconds * sampleFps),
        analyzed_duration_seconds: 0,
        expected_duration_seconds: durationSeconds,
        coverage_ratio: 0,
        repeated_motion_sequences: [],
        repeated_motion_seconds: 0,
        cadence: {
          adjacent_pair_count: 0,
          near_static_pair_count: 0,
          overall_near_static_ratio: 0,
          max_window_near_static_ratio: 0,
          max_consecutive_near_static_seconds: 0,
          window_seconds: DEFAULT_CADENCE_WINDOW_SECONDS,
          local_stall_detected: null,
          local_stall_start_seconds: null,
          local_stall_end_seconds: null,
          choppy: false,
        },
        supplemental_center_crop: {
          schema_version: 1,
          analysis_scope: "center_crop",
          scan_complete: false,
          sample_fps: sampleFps,
          sampled_frame_count: 0,
          expected_sample_count: Math.ceil(durationSeconds * sampleFps),
          analyzed_duration_seconds: 0,
          expected_duration_seconds: durationSeconds,
          coverage_ratio: 0,
          repeated_motion_sequences: [],
          repeated_motion_seconds: 0,
          cadence: {
            adjacent_pair_count: 0,
            near_static_pair_count: 0,
            overall_near_static_ratio: 0,
            max_window_near_static_ratio: 0,
            max_consecutive_near_static_seconds: 0,
            window_seconds: DEFAULT_CADENCE_WINDOW_SECONDS,
            local_stall_detected: null,
            local_stall_start_seconds: null,
            local_stall_end_seconds: null,
            choppy: false,
          },
          error: `temporal_scan_failed:${err.code || "unknown"}`,
        },
        error: `temporal_scan_failed:${err.code || "unknown"}`,
      };
    }
  }

  return classifyVideoQa({
    durationSeconds,
    decodeEvidence,
    requireDecodeScan,
    blackSegments,
    freezeSegments,
    repeatedFramePairs,
    temporalAnalysis,
    requireTemporalScan,
    minDuration: opts.minDuration,
    maxDuration: opts.maxDuration,
    maxOpeningBlack: opts.maxOpeningBlack,
    maxSegmentBlack: opts.maxSegmentBlack,
    maxFreezeSegment: opts.maxFreezeSegment,
    maxCumulativeFreeze: opts.maxCumulativeFreeze,
    minCumulativeFreezeSegment: opts.minCumulativeFreezeSegment,
    maxRepeatedFramePairs: opts.maxRepeatedFramePairs,
    maxRepeatedMotionSequences: opts.maxRepeatedMotionSequences,
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
  parseTemporalFrameBuffer,
  analyzeTemporalFrames,
  reconcileTemporalRepeatScopes,
  validateTemporalVideoQaReport,
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
  DEFAULT_MIN_CUMULATIVE_FREEZE_SEGMENT_SECONDS,
  DEFAULT_TEMPORAL_SAMPLE_FPS,
  DEFAULT_TEMPORAL_MIN_COVERAGE_RATIO,
  DEFAULT_MIN_REPEATED_SEQUENCE_SECONDS,
  DEFAULT_MIN_REPEATED_SEQUENCE_GAP_SECONDS,
  DEFAULT_TEMPORAL_MAX_HASH_DISTANCE,
  DEFAULT_MAX_OVERALL_NEAR_STATIC_RATIO,
  DEFAULT_MAX_WINDOW_NEAR_STATIC_RATIO,
};
