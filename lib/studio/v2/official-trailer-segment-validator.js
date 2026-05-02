"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");
const fs = require("fs-extra");

const {
  inspectExtractedFrame,
  officialTrailerFrameRejectReason,
} = require("../../controlled-frame-extraction-worker");
const {
  classifyTrailerFrameTaste,
} = require("../../visual-content-prescan");

const ROOT = path.resolve(__dirname, "../../..");
const TEST_OUTPUT_ROOT = path.join(ROOT, "test", "output");
const DEFAULT_OUTPUT_ROOT = path.join(TEST_OUTPUT_ROOT, "official-trailer-segment-validation-v1", "assets");
const DEFAULT_SAMPLE_OFFSETS_S = [0.65, 2.35, 4.15];
const DEFAULT_MAX_SEGMENTS = 6;
const MIN_PASSING_SAMPLES = 2;
const MIN_GAMEPLAY_ACTION_SAMPLES = 2;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeName(value, fallback = "item") {
  const out = String(value || fallback)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return out || fallback;
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isUnder(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertLocalOutputRoot(outputRoot) {
  if (!isUnder(TEST_OUTPUT_ROOT, outputRoot)) {
    throw new Error("apply-local segment validation output must stay under test/output");
  }
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function segmentKeyForClipRef(clip) {
  const sourceUrl = String(clip?.path || clip?.source_url || clip?.sourceUrl || "").trim();
  const entity = safeName(clip?.entity || clip?.provenance?.entity || "subject").toLowerCase();
  const start = numberOr(clip?.mediaStartS ?? clip?.media_start_s, 0).toFixed(2);
  return `${sourceUrl}|${entity}|${start}`;
}

function outputPathForSample({ outputRoot, clip, segmentIndex, sampleIndex, seekSeconds }) {
  const story = safeName(clip?.storyId || clip?.story_id || clip?.provenance?.story_id || "story");
  const entity = safeName(clip?.entity || clip?.provenance?.entity || "subject");
  const seconds = String(Math.round(seekSeconds * 100)).padStart(5, "0");
  return path.join(
    outputRoot,
    story,
    `${String(segmentIndex + 1).padStart(3, "0")}_${entity}_${String(sampleIndex + 1).padStart(2, "0")}_${seconds}cs.jpg`,
  );
}

function buildSamplePlan(clip, opts = {}) {
  const durationS = Math.max(1, numberOr(clip?.durationS ?? clip?.duration_s, 5));
  const mediaStartS = Math.max(0, numberOr(clip?.mediaStartS ?? clip?.media_start_s, 0));
  const requested = asArray(opts.sampleOffsetsS).length ? asArray(opts.sampleOffsetsS) : DEFAULT_SAMPLE_OFFSETS_S;
  return requested
    .map((offset) => numberOr(offset, 0))
    .filter((offset) => offset >= 0 && offset <= durationS)
    .map((offset) => ({
      offset_s: Number(offset.toFixed(2)),
      seek_seconds: Number((mediaStartS + offset).toFixed(2)),
    }));
}

function defaultSegmentSampleExtractor({ sourceUrl, outputPath, seekSeconds, timeoutMs = 45000 }) {
  if (!sourceUrl) return Promise.reject(new Error("segment_source_missing"));
  return new Promise((resolve, reject) => {
    fs.ensureDirSync(path.dirname(outputPath));
    execFile(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(seekSeconds),
        "-i",
        sourceUrl,
        "-frames:v",
        "1",
        "-vf",
        "scale=1080:-1",
        "-q:v",
        "2",
        outputPath,
      ],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve({ outputPath, stdout, stderr });
      },
    );
  });
}

function guardSegmentSample(clip, sample, qa = {}) {
  const guarded = {
    ...(qa || {}),
    warnings: Array.isArray(qa?.warnings) ? [...qa.warnings] : [],
    failures: Array.isArray(qa?.failures) ? [...qa.failures] : [],
  };
  const prescan = guarded.prescan || {};
  guarded.visual_taste = guarded.visual_taste || classifyTrailerFrameTaste(prescan);
  if (
    guarded.failures.includes("unsafe_face_like_frame") &&
    prescan.likely_is_stock_person !== true
  ) {
    guarded.failures = guarded.failures.filter((failure) => failure !== "unsafe_face_like_frame");
    if (!guarded.warnings.includes("official_game_character_face_allowed")) {
      guarded.warnings.push("official_game_character_face_allowed");
    }
  }
  const frameLike = {
    source_type: clip?.sourceType || clip?.source_type || "steam_movie",
    target_time_seconds: sample.seek_seconds,
    qa: guarded,
  };
  const reason = officialTrailerFrameRejectReason(frameLike, guarded);
  if (reason && !guarded.failures.includes(reason)) guarded.failures.push(reason);
  if (reason) {
    guarded.thumbnail_safe = false;
    guarded.verdict = "fail";
  } else {
    guarded.thumbnail_safe = guarded.failures.length === 0;
    guarded.verdict = guarded.failures.length ? "fail" : guarded.warnings.length ? "warn" : "pass";
  }
  const action = scoreGameplayActionSample(guarded);
  guarded.gameplay_action_score = action.score;
  guarded.gameplay_action_candidate = action.candidate;
  guarded.gameplay_action_reason = action.reason;
  return guarded;
}

function scoreGameplayActionSample(qa = {}) {
  const prescan = qa.prescan || {};
  const taste = qa.visual_taste || classifyTrailerFrameTaste(prescan);
  const edge = numberOr(prescan.edge_density, 0);
  const saturation = numberOr(prescan.saturation_mean, 0);
  const text = numberOr(prescan.text_overlay_likelihood, 0);
  const whiteText = numberOr(prescan.white_text_on_dark_likelihood, 0);
  const dark = numberOr(prescan.dark_pixel_ratio, 0);
  const bright = numberOr(prescan.bright_pixel_ratio, 0);
  let score = 35;
  score += Math.min(edge, 0.38) * 115;
  score += Math.min(saturation, 0.65) * 45;
  score -= Math.min(text, 0.6) * 85;
  score -= Math.min(whiteText, 1) * 70;
  if (dark >= 0.82) score -= (dark - 0.82) * 120;
  if (bright >= 0.58) score -= (bright - 0.58) * 90;
  if (taste?.verdict === "fail") score -= 45;
  const rounded = Number(Math.max(0, Math.min(100, score)).toFixed(1));
  const candidate =
    qa.verdict !== "fail" &&
    qa.thumbnail_safe !== false &&
    taste?.verdict !== "fail" &&
    edge >= 0.14 &&
    saturation >= 0.28 &&
    text <= 0.26 &&
    whiteText <= 0.2 &&
    rounded >= 68;
  let reason = "gameplay_action_candidate";
  if (!candidate) {
    if (taste?.verdict === "fail") reason = `taste_${taste.reason || "failed"}`;
    else if (text > 0.26) reason = "text_heavy_context_frame";
    else if (edge < 0.14) reason = "not_enough_visual_detail";
    else if (saturation < 0.28) reason = "not_enough_colour_energy";
    else if (whiteText > 0.2) reason = "white_text_context_frame";
    else reason = "action_score_below_threshold";
  }
  return {
    score: rounded,
    candidate,
    reason,
  };
}

function classifySegment(samples) {
  const finished = samples.filter((sample) => sample.status !== "would_sample");
  const failed = finished.filter((sample) => sample.status !== "accepted");
  const passing = finished.filter((sample) => sample.status === "accepted");
  const failureReasons = [
    ...new Set(
      failed.flatMap((sample) =>
        asArray(sample.qa?.failures).concat(sample.status === "extract_failed" ? ["extract_failed"] : []),
      ),
    ),
  ];
  const uniqueHashes = new Set(
    passing.map((sample) => sample.qa?.content_hash).filter((hash) => typeof hash === "string" && hash),
  );
  const actionSamples = passing.filter((sample) => sample.qa?.gameplay_action_candidate === true);
  const actionScore =
    passing.length > 0
      ? Number(
          (
            passing.reduce((sum, sample) => sum + numberOr(sample.qa?.gameplay_action_score, 0), 0) /
            passing.length
          ).toFixed(1),
        )
      : 0;

  if (finished.length === 0) {
    return {
      status: "would_validate",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "dry_run_only",
      action_sample_count: 0,
      action_score: 0,
      segment_motion_class: "not_sampled",
    };
  }
  if (failureReasons.includes("extract_failed")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_sample_extract_failed",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
    };
  }
  if (failureReasons.includes("black_frame")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_contains_black_frame",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
    };
  }
  if (failureReasons.includes("title_or_rating_card_frame")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_contains_title_or_rating_card",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
    };
  }
  if (failureReasons.includes("low_detail_official_frame")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_contains_low_detail_frame",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
    };
  }
  if (failureReasons.includes("unsafe_face_like_frame")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_contains_unsafe_face_like_frame",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
    };
  }
  if (passing.length < MIN_PASSING_SAMPLES) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "too_few_clean_segment_samples",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "non_gameplay_context",
    };
  }
  if (uniqueHashes.size > 0 && uniqueHashes.size < Math.min(MIN_PASSING_SAMPLES, passing.length)) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_samples_too_repetitive",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "non_gameplay_context",
    };
  }
  if (actionSamples.length < MIN_GAMEPLAY_ACTION_SAMPLES) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_lacks_gameplay_action_samples",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "non_gameplay_context",
    };
  }
  return {
    status: "validated",
    segment_validated: true,
    allowed_for_flash_lane: true,
    reason: "segment_samples_passed",
    action_sample_count: actionSamples.length,
    action_score: actionScore,
    segment_motion_class: "gameplay_action",
  };
}

async function processClipSegment(clip, index, options) {
  const applyLocal = options.applyLocal === true;
  const sourceUrl = String(clip?.path || clip?.source_url || clip?.sourceUrl || "").trim();
  const outputRoot = path.resolve(options.outputRoot || DEFAULT_OUTPUT_ROOT);
  const samplePlan = buildSamplePlan(clip, options);
  const samples = [];

  for (const [sampleIndex, sample] of samplePlan.entries()) {
    const outputPath = outputPathForSample({
      outputRoot,
      clip,
      segmentIndex: index,
      sampleIndex,
      seekSeconds: sample.seek_seconds,
    });
    const base = {
      order: sampleIndex + 1,
      source_url: sourceUrl,
      entity: clip?.entity || null,
      offset_s: sample.offset_s,
      seek_seconds: sample.seek_seconds,
      local_path: applyLocal ? outputPath : null,
      planned_local_path: applyLocal ? null : outputPath,
    };

    if (!applyLocal) {
      samples.push({
        ...base,
        status: "would_sample",
        qa: null,
      });
      continue;
    }

    try {
      await options.extractor({
        sourceUrl,
        outputPath,
        seekSeconds: sample.seek_seconds,
        clip,
        sample,
      });
      const qa = await options.inspectFrame(outputPath, {
        frame: {
          source_url: sourceUrl,
          source_type: clip?.sourceType || clip?.source_type || "steam_movie",
          target_time_seconds: sample.seek_seconds,
        },
        sourceTypeHint: "trailer",
      });
      const guarded = guardSegmentSample(clip, sample, qa);
      samples.push({
        ...base,
        status: guarded.verdict === "fail" || guarded.thumbnail_safe === false ? "rejected_qa" : "accepted",
        qa: guarded,
      });
    } catch (err) {
      samples.push({
        ...base,
        status: "extract_failed",
        error: err.message || String(err),
        qa: {
          verdict: "fail",
          thumbnail_safe: false,
          failures: ["extract_failed"],
          warnings: [],
        },
      });
    }
  }

  const verdict = classifySegment(samples);
  return {
    order: index + 1,
    clip_key: segmentKeyForClipRef(clip),
    source_url: sourceUrl,
    source_type: clip?.sourceType || clip?.source_type || "steam_movie",
    entity: clip?.entity || null,
    media_start_s: numberOr(clip?.mediaStartS ?? clip?.media_start_s, 0),
    duration_s: Math.max(1, numberOr(clip?.durationS ?? clip?.duration_s, 5)),
    status: verdict.status,
    segment_validated: verdict.segment_validated,
    allowed_for_flash_lane: verdict.allowed_for_flash_lane,
    validation_reason: verdict.reason,
    segment_motion_class: verdict.segment_motion_class,
    action_score: verdict.action_score,
    action_sample_count: verdict.action_sample_count,
    samples,
  };
}

function summariseSegments(segments, applyLocal) {
  return {
    segments: segments.length,
    segments_would_validate: applyLocal
      ? 0
      : segments.filter((segment) => segment.status === "would_validate").length,
    segments_validated: segments.filter((segment) => segment.segment_validated === true).length,
    segments_rejected: segments.filter((segment) => segment.status === "rejected").length,
    samples_would_extract: applyLocal
      ? 0
      : segments.flatMap((segment) => segment.samples || []).filter((sample) => sample.status === "would_sample").length,
    samples_extracted: segments
      .flatMap((segment) => segment.samples || [])
      .filter((sample) => sample.status !== "would_sample").length,
    gameplay_action_segments: segments.filter((segment) => segment.segment_motion_class === "gameplay_action").length,
  };
}

async function runOfficialTrailerSegmentValidation(clipRefs = [], options = {}) {
  const applyLocal = options.applyLocal === true;
  const outputRoot = path.resolve(options.outputRoot || DEFAULT_OUTPUT_ROOT);
  if (applyLocal) assertLocalOutputRoot(outputRoot);
  const clips = asArray(clipRefs)
    .filter((clip) => String(clip?.source || "").includes("official-trailer"))
    .slice(0, Math.max(1, Number(options.maxSegments || DEFAULT_MAX_SEGMENTS)));
  const workerOptions = {
    ...options,
    outputRoot,
    extractor: options.extractor || defaultSegmentSampleExtractor,
    inspectFrame: options.inspectFrame || inspectExtractedFrame,
  };
  const segments = [];
  for (const [index, clip] of clips.entries()) {
    segments.push(await processClipSegment(clip, index, workerOptions));
  }
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode: applyLocal ? "apply_local" : "dry_run",
    dry_run: !applyLocal,
    apply_local: applyLocal,
    output_root: outputRoot,
    will_download_video: false,
    will_retain_video: false,
    will_fetch_source_for_segment_samples: applyLocal,
    summary: summariseSegments(segments, applyLocal),
    segments,
    safety: {
      local_only: true,
      output_under_test_output: isUnder(TEST_OUTPUT_ROOT, outputRoot),
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      render_default_changed: false,
      retained_video_files: false,
      yt_dlp: false,
      browser_scraping: false,
    },
  };
}

function applySegmentValidationToClipRefs(clipRefs = [], report = null) {
  const byKey = new Map(asArray(report?.segments).map((segment) => [segment.clip_key, segment]));
  return asArray(clipRefs).map((clip) => {
    const segment = byKey.get(segmentKeyForClipRef(clip));
    if (!segment) return clip;
    return {
      ...clip,
      provenance: {
        ...(clip.provenance || {}),
        requires_segment_validation: true,
        segment_validated: segment.segment_validated === true,
        allowed_for_flash_lane: segment.allowed_for_flash_lane === true,
        segment_validation_reason: segment.validation_reason,
        segment_validation_samples: asArray(segment.samples).length,
        segment_motion_class: segment.segment_motion_class || null,
        segment_action_score: numberOr(segment.action_score, null),
        segment_action_sample_count: numberOr(segment.action_sample_count, null),
        segment_validation_reported_at: report?.generated_at || null,
      },
    };
  });
}

function renderOfficialTrailerSegmentValidationMarkdown(report) {
  const lines = [];
  lines.push("# Official Trailer Segment Validator v1");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Dry run: ${report.dry_run}`);
  lines.push(`Apply local: ${report.apply_local}`);
  lines.push(`Output root: ${toPosix(report.output_root)}`);
  lines.push(`Fetch source for segment samples: ${report.will_fetch_source_for_segment_samples}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- segments: ${report.summary.segments}`);
  lines.push(`- segments would validate: ${report.summary.segments_would_validate}`);
  lines.push(`- segments validated: ${report.summary.segments_validated}`);
  lines.push(`- segments rejected: ${report.summary.segments_rejected}`);
  lines.push(`- gameplay/action segments: ${report.summary.gameplay_action_segments}`);
  lines.push(`- samples would extract: ${report.summary.samples_would_extract}`);
  lines.push(`- samples extracted: ${report.summary.samples_extracted}`);
  lines.push("");
  lines.push("| clip | entity | start | status | motion | action score | Flash Lane | reason | samples |");
  lines.push("| --- | --- | ---: | --- | --- | ---: | --- | --- | ---: |");
  for (const segment of report.segments || []) {
    lines.push(
      [
        segment.order,
        segment.entity || "unknown",
        segment.media_start_s,
        segment.status,
        segment.segment_motion_class || "unknown",
        segment.action_score ?? "n/a",
        segment.allowed_for_flash_lane ? "allowed" : "blocked",
        segment.validation_reason,
        asArray(segment.samples).length,
      ]
        .map((value) => String(value ?? "").replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Dry-run by default.");
  lines.push("- Apply-local writes only under `test/output`.");
  lines.push("- No retained trailer downloads.");
  lines.push("- No production DB, Railway, OAuth, scheduler, render-default or posting changes.");
  lines.push("- No yt-dlp or browser scraping.");
  return lines.join("\n") + "\n";
}

module.exports = {
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_SAMPLE_OFFSETS_S,
  MIN_GAMEPLAY_ACTION_SAMPLES,
  MIN_PASSING_SAMPLES,
  applySegmentValidationToClipRefs,
  buildSamplePlan,
  classifySegment,
  guardSegmentSample,
  renderOfficialTrailerSegmentValidationMarkdown,
  runOfficialTrailerSegmentValidation,
  segmentKeyForClipRef,
  scoreGameplayActionSample,
};
