"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");
const fs = require("fs-extra");
const sharp = require("sharp");
const {
  classifyTrailerFrameTaste,
  computeContentHash,
  isLetterboxedCinematicCandidate,
  prescanImage,
} = require("./visual-content-prescan");
const {
  officialMediaReferenceRejectReason,
} = require("./official-media-reference-preflight");
const {
  mediaSourceUrlKindFields,
} = require("./media-source-url-kind");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUTPUT_ROOT = path.join(ROOT, "test", "output");
const DEFAULT_OUTPUT_ROOT = path.join(TEST_OUTPUT_ROOT, "frame-extraction-v1", "assets");
const MIN_OFFICIAL_FRAME_SAMPLE_S = 24;

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
    throw new Error("apply-local output must stay under test/output");
  }
}

function seekSecondsForFrame(frame, assumedDurationSeconds = 60) {
  const explicit = Number(frame?.target_time_seconds || frame?.targetTimeSeconds);
  if (Number.isFinite(explicit) && explicit >= 0) return Number(explicit.toFixed(2));
  const pct = Number(frame?.target_time_percent);
  if (Number.isFinite(pct) && pct >= 0) {
    return Number(Math.max(1, pct * assumedDurationSeconds).toFixed(2));
  }
  return 6;
}

function isOfficialTrailerFrameSource(sourceType) {
  return /\b(movie|trailer|video|steam_movie|igdb_video|official_trailer)\b/i.test(
    String(sourceType || ""),
  );
}

function trailerTasteFailureReason(taste = {}) {
  const verdict = String(taste?.verdict || "").toLowerCase();
  if (verdict !== "fail" && verdict !== "reject") return null;
  const reason = String(taste?.reason || "");
  if (
    [
      "white_text_on_dark_card",
      "logo_or_rating_card",
      "text_card_frame",
      "high_contrast_card_frame",
    ].includes(reason)
  ) {
    return "title_or_rating_card_frame";
  }
  return "low_detail_official_frame";
}

function officialTrailerFrameRejectReason(frame, qa = frame?.qa || {}) {
  if (!isOfficialTrailerFrameSource(frame?.source_type || frame?.sourceType)) return null;
  const metadataRejectReason = officialMediaReferenceRejectReason(frame);
  if (metadataRejectReason === "rating_board_reference") return "rating_board_reference_frame";
  if (metadataRejectReason === "logo_or_title_only_reference") return "logo_or_title_only_reference_frame";
  if (metadataRejectReason === "localised_non_english_reference") {
    return "localised_non_english_trailer_frame";
  }
  if (metadataRejectReason === "embedded_subtitle_reference") {
    return "embedded_subtitle_trailer_frame";
  }
  const prescan = qa?.prescan || {};
  const warnings = Array.isArray(qa?.warnings) ? qa.warnings : [];
  const targetSeconds = Number(frame?.target_time_seconds ?? frame?.targetTimeSeconds);
  const textOverlay = Number(prescan.text_overlay_likelihood);
  const whiteTextOnDark = Number(prescan.white_text_on_dark_likelihood);
  const edgeDensity = Number(prescan.edge_density);
  const saturation = Number(prescan.saturation_mean);
  const darkRatio = Number(prescan.dark_pixel_ratio);
  const brightRatio = Number(prescan.bright_pixel_ratio);
  const centralDarkRatio = Number(prescan.central_dark_pixel_ratio);
  const centralBrightRatio = Number(prescan.central_bright_pixel_ratio);
  const letterboxedCinematic = isLetterboxedCinematicCandidate(prescan);

  if (Number.isFinite(targetSeconds) && targetSeconds < MIN_OFFICIAL_FRAME_SAMPLE_S) {
    return "early_trailer_intro_frame";
  }
  const explicitTasteReason = trailerTasteFailureReason(
    qa?.visual_taste ||
      qa?.trailer_frame_taste ||
      frame?.visual_taste ||
      frame?.trailer_frame_taste,
  );
  if (explicitTasteReason) return explicitTasteReason;
  const taste = classifyTrailerFrameTaste(prescan);
  if (taste.verdict === "fail") {
    if (
      [
        "white_text_on_dark_card",
        "logo_or_rating_card",
        "text_card_frame",
        "high_contrast_card_frame",
      ].includes(taste.reason)
    ) {
      return "title_or_rating_card_frame";
    }
    return "low_detail_official_frame";
  }
  if (prescan.likely_is_logo === true && Number.isFinite(textOverlay) && textOverlay >= 0.22) {
    return "title_or_rating_card_frame";
  }
  if (
    Number.isFinite(textOverlay) &&
    textOverlay >= 0.45 &&
    (!Number.isFinite(saturation) || saturation < 0.24)
  ) {
    return "title_or_rating_card_frame";
  }
  if (
    Number.isFinite(whiteTextOnDark) &&
    whiteTextOnDark >= 0.55 &&
    !letterboxedCinematic
  ) {
    return "title_or_rating_card_frame";
  }
  if (
    qa?.blur_verdict === "fail" ||
    qa?.blur_verdict === "warn" ||
    warnings.includes("low_detail_or_blur_risk")
  ) {
    return "low_detail_official_frame";
  }
  if (
    Number.isFinite(edgeDensity) &&
    edgeDensity < 0.085 &&
    (!Number.isFinite(saturation) || saturation < 0.3)
  ) {
    return "low_detail_official_frame";
  }
  if (
    Number.isFinite(edgeDensity) &&
    edgeDensity < 0.05 &&
    (!Number.isFinite(saturation) || saturation < 0.24)
  ) {
    return "low_detail_official_frame";
  }
  if (
    !letterboxedCinematic &&
    (!Number.isFinite(textOverlay) || textOverlay <= 0.08) &&
    Number.isFinite(edgeDensity) &&
    edgeDensity < 0.13 &&
    Number.isFinite(saturation) &&
    saturation < 0.32 &&
    Number.isFinite(darkRatio) &&
    darkRatio >= 0.58 &&
    Number.isFinite(brightRatio) &&
    brightRatio <= 0.08 &&
    Number.isFinite(centralDarkRatio) &&
    centralDarkRatio >= Math.max(0.68, darkRatio + 0.035) &&
    (!Number.isFinite(centralBrightRatio) || centralBrightRatio <= 0.09)
  ) {
    return "poor_subject_framing_frame";
  }
  return null;
}

function applyOfficialTrailerFrameGuards(frame, qa) {
  const guarded = {
    ...(qa || {}),
    warnings: Array.isArray(qa?.warnings) ? [...qa.warnings] : [],
    failures: Array.isArray(qa?.failures) ? [...qa.failures] : [],
  };
  const prescan = guarded.prescan || {};
  guarded.visual_taste = guarded.visual_taste || classifyTrailerFrameTaste(prescan);
  if (
    isOfficialTrailerFrameSource(frame?.source_type || frame?.sourceType) &&
    guarded.failures.includes("unsafe_face_like_frame") &&
    prescan.likely_is_stock_person !== true
  ) {
    guarded.failures = guarded.failures.filter((failure) => failure !== "unsafe_face_like_frame");
    if (!guarded.warnings.includes("official_game_character_face_allowed")) {
      guarded.warnings.push("official_game_character_face_allowed");
    }
  }
  const reason = officialTrailerFrameRejectReason(frame, guarded);
  if (reason && !guarded.failures.includes(reason)) {
    guarded.failures.push(reason);
  }
  if (reason) {
    guarded.thumbnail_safe = false;
    guarded.verdict = "fail";
  } else {
    guarded.thumbnail_safe = guarded.failures.length === 0;
    guarded.verdict = guarded.failures.length ? "fail" : guarded.warnings.length ? "warn" : "pass";
  }
  return guarded;
}

function plannedOutputPath({ outputRoot, plan, frame, index }) {
  const storyDir = safeName(plan.story_id || "story");
  const entity = safeName(frame.entity || "subject");
  const pct = Number.isFinite(Number(frame.target_time_percent))
    ? `${Math.round(Number(frame.target_time_percent) * 100)}pct`
    : "time";
  return path.join(outputRoot, storyDir, `${String(index + 1).padStart(3, "0")}_${entity}_${pct}.jpg`);
}

function defaultExtractor({ sourceUrl, localPath, outputPath, seekSeconds, timeoutMs = 45000 }) {
  const source = sourceUrl || localPath;
  if (!source) return Promise.reject(new Error("frame_source_missing"));
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
        source,
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

async function inspectExtractedFrame(outputPath, options = {}) {
  const result = {
    local_path: outputPath,
    file_size: 0,
    content_hash: null,
    width: null,
    height: null,
    thumbnail_safe: false,
    likely_has_face: false,
    black_frame: false,
    blur_verdict: "unknown",
    verdict: "fail",
    warnings: [],
    failures: [],
  };

  if (!(await fs.pathExists(outputPath))) {
    result.failures.push("frame_not_on_disk");
    return result;
  }

  const stat = await fs.stat(outputPath);
  result.file_size = stat.size;
  result.content_hash = await computeContentHash(outputPath);
  if (!result.content_hash) result.failures.push("hash_missing");

  let metadata;
  let stats;
  try {
    const image = sharp(outputPath);
    metadata = await image.metadata();
    stats = await image.stats();
  } catch (err) {
    result.failures.push(`sharp_decode_failed:${err.message.slice(0, 80)}`);
  }

  if (metadata) {
    result.width = metadata.width || null;
    result.height = metadata.height || null;
    if ((metadata.width || 0) < 480 || (metadata.height || 0) < 270) {
      result.warnings.push("frame_resolution_low");
    }
  }

  if (stats?.channels?.length >= 3) {
    const means = stats.channels.slice(0, 3).map((channel) => channel.mean || 0);
    const luma = 0.299 * means[0] + 0.587 * means[1] + 0.114 * means[2];
    result.black_frame = luma < 8;
    if (result.black_frame) result.failures.push("black_frame");
  }

  const prescan = await prescanImage(outputPath, {
    sourceTypeHint: options.sourceTypeHint || "trailer",
  });
  result.prescan = prescan;
  result.visual_taste = prescan.trailer_frame_taste || classifyTrailerFrameTaste(prescan);
  result.likely_has_face = prescan.likely_has_face || prescan.likely_is_stock_person;
  if (prescan.error) result.warnings.push(`prescan:${prescan.error}`);
  if (result.likely_has_face) result.failures.push("unsafe_face_like_frame");
  if (Number.isFinite(prescan.edge_density) && prescan.edge_density < 0.01) {
    result.blur_verdict = "warn";
    result.warnings.push("low_detail_or_blur_risk");
  } else {
    result.blur_verdict = "pass";
  }

  result.thumbnail_safe = result.failures.length === 0;
  result.verdict = result.failures.length ? "fail" : result.warnings.length ? "warn" : "pass";
  return result;
}

function framePlanIsReady(plan) {
  return plan?.frame_plan_readiness === "frame_plan_ready";
}

function frameRecordBase({ plan, frame, outputPath, index, seekSeconds }) {
  const urlKind = mediaSourceUrlKindFields(frame.source_url || frame.local_path || "");
  return {
    order: index + 1,
    story_id: plan.story_id,
    source_url: frame.source_url || null,
    local_source_path: frame.local_path || null,
    source_url_kind: frame.source_url_kind || urlKind.source_url_kind,
    segment_validation_eligible:
      frame.segment_validation_eligible === false ? false : urlKind.segment_validation_eligible,
    segment_validation_ineligible_reason:
      frame.segment_validation_ineligible_reason || urlKind.segment_validation_ineligible_reason,
    source_type: frame.source_type || "unknown",
    entity: frame.entity || null,
    provider: frame.provider || null,
    movie_id: frame.movie_id || frame.movieId || null,
    movie_name: frame.movie_name || frame.movieName || frame.name || frame.title || null,
    reference_title:
      frame.reference_title || frame.movie_name || frame.movieName || frame.name || frame.title || null,
    store_app_id: frame.store_app_id || frame.storeAppId || null,
    store_app_title: frame.store_app_title || frame.storeAppTitle || null,
    target_time_percent: frame.target_time_percent ?? null,
    target_time_seconds: seekSeconds,
    local_path: outputPath,
    downloads_allowed: false,
    extraction_mode: "apply_local_only",
  };
}

function frameSourceRejectReason(frame) {
  if (!isOfficialTrailerFrameSource(frame?.source_type || frame?.sourceType)) return null;
  const urlKind = mediaSourceUrlKindFields(frame?.source_url || frame?.local_path || "");
  if (frame?.segment_validation_eligible === false) {
    return frame.segment_validation_ineligible_reason || "segment_source_marked_ineligible";
  }
  if (urlKind.segment_validation_eligible !== true) {
    return urlKind.segment_validation_ineligible_reason || "segment_source_url_not_direct_media";
  }
  return null;
}

async function processPlan(plan, options, seenHashes) {
  const applyLocal = options.applyLocal === true;
  const outputRoot = path.resolve(options.outputRoot || DEFAULT_OUTPUT_ROOT);
  const targetFrames = framePlanIsReady(plan)
    ? asArray(plan.target_frames).slice(0, options.maxFramesPerStory || 8)
    : [];
  const frames = [];
  const provenance = [];

  if (!framePlanIsReady(plan)) {
    return {
      story_id: plan?.story_id || "unknown",
      title: plan?.title || "Untitled",
      mode: applyLocal ? "apply_local" : "dry_run",
      frame_plan_readiness: plan?.frame_plan_readiness || "unknown",
      frames,
      provenance,
      blockers: ["frame_plan_not_ready"],
    };
  }

  const extractor = options.extractor || defaultExtractor;
  const inspectFrame = options.inspectFrame || inspectExtractedFrame;
  for (const [index, frame] of targetFrames.entries()) {
    const outputPath = plannedOutputPath({ outputRoot, plan, frame, index });
    const seekSeconds = seekSecondsForFrame(frame, options.assumedReferenceDurationSeconds || 60);
    const base = frameRecordBase({ plan, frame, outputPath, index, seekSeconds });
    const sourceRejectReason = frameSourceRejectReason(frame);

    if (sourceRejectReason) {
      const record = {
        ...base,
        status: "rejected_source_url",
        local_path: null,
        planned_local_path: outputPath,
        qa: {
          verdict: "fail",
          thumbnail_safe: false,
          warnings: [],
          failures: [sourceRejectReason],
        },
      };
      frames.push(record);
      provenance.push({
        ...record,
        reason: sourceRejectReason,
      });
      continue;
    }

    if (!applyLocal) {
      const record = {
        ...base,
        status: "would_extract",
        local_path: null,
        planned_local_path: outputPath,
        qa: null,
      };
      frames.push(record);
      provenance.push({
        ...record,
        local_path: null,
        reason: "dry_run_only",
      });
      continue;
    }

    try {
      await extractor({
        sourceUrl: frame.source_url || null,
        localPath: frame.local_path || null,
        outputPath,
        seekSeconds,
        frame,
        storyId: plan.story_id,
      });
      const qa = await inspectFrame(outputPath, {
        frame,
        sourceTypeHint: frame.source_type || "trailer",
      });
      const guardedQa = applyOfficialTrailerFrameGuards(frame, qa);
      const duplicate = guardedQa.content_hash && seenHashes.has(guardedQa.content_hash);
      let status = "accepted";
      if (duplicate) {
        status = "rejected_duplicate";
      } else if (guardedQa.verdict === "fail" || guardedQa.thumbnail_safe === false) {
        status = "rejected_qa";
      } else if (guardedQa.content_hash) {
        seenHashes.add(guardedQa.content_hash);
      }
      const record = {
        ...base,
        status,
        qa: guardedQa,
      };
      frames.push(record);
      provenance.push({
        source_url: record.source_url,
        source_type: record.source_type,
        entity: record.entity,
        provider: record.provider,
        movie_id: record.movie_id,
        movie_name: record.movie_name,
        reference_title: record.reference_title,
        source_url_kind: record.source_url_kind,
        segment_validation_eligible: record.segment_validation_eligible,
        segment_validation_ineligible_reason: record.segment_validation_ineligible_reason,
        store_app_id: record.store_app_id,
        store_app_title: record.store_app_title,
        target_time_seconds: record.target_time_seconds,
        local_path: record.local_path,
        content_hash: guardedQa.content_hash,
        file_size: guardedQa.file_size,
        thumbnail_safe: guardedQa.thumbnail_safe,
        status,
        reason: status,
      });
    } catch (err) {
      const record = {
        ...base,
        status: "extract_failed",
        error: err.message,
      };
      frames.push(record);
      provenance.push({
        source_url: record.source_url,
        source_type: record.source_type,
        entity: record.entity,
        target_time_seconds: record.target_time_seconds,
        local_path: record.local_path,
        status: "extract_failed",
        reason: err.message,
      });
    }
  }

  return {
    story_id: plan.story_id,
    title: plan.title || "Untitled",
    mode: applyLocal ? "apply_local" : "dry_run",
    frame_plan_readiness: plan.frame_plan_readiness,
    frames,
    provenance,
    blockers: frames.some((frame) => frame.status === "accepted") || !applyLocal ? [] : ["no_accepted_frames"],
  };
}

function summarisePlans(plans, applyLocal) {
  const allFrames = plans.flatMap((plan) => plan.frames || []);
  return {
    stories: plans.length,
    frame_plan_ready: plans.filter((plan) => plan.frame_plan_readiness === "frame_plan_ready").length,
    frames_would_extract: applyLocal
      ? 0
      : allFrames.filter((frame) => frame.status === "would_extract").length,
    frames_extracted: allFrames.filter((frame) =>
      ["accepted", "rejected_duplicate", "rejected_qa"].includes(frame.status),
    ).length,
    frames_accepted: allFrames.filter((frame) => frame.status === "accepted").length,
    frames_rejected: allFrames.filter((frame) =>
      ["rejected_duplicate", "rejected_qa", "extract_failed", "rejected_source_url"].includes(
        frame.status,
      ),
    ).length,
    extract_failed: allFrames.filter((frame) => frame.status === "extract_failed").length,
  };
}

function mergeControlledFrameExtractionReports(previousReport = {}, currentReport = {}) {
  const byStory = new Map();
  for (const plan of asArray(previousReport.plans)) {
    if (plan?.story_id) byStory.set(plan.story_id, plan);
  }
  for (const plan of asArray(currentReport.plans)) {
    if (plan?.story_id) byStory.set(plan.story_id, plan);
  }
  const plans = [...byStory.values()];
  const applyLocal = currentReport.apply_local === true;
  return {
    ...currentReport,
    merged_previous_report: true,
    previous_generated_at: previousReport.generated_at || null,
    plans,
    provenance: plans.flatMap((plan) => plan.provenance || []),
    summary: summarisePlans(plans, applyLocal),
  };
}

async function runControlledFrameExtraction(framePlans = [], options = {}) {
  const applyLocal = options.applyLocal === true;
  const mode = applyLocal ? "apply_local" : "dry_run";
  const outputRoot = path.resolve(options.outputRoot || DEFAULT_OUTPUT_ROOT);
  if (applyLocal) assertLocalOutputRoot(outputRoot);

  const seenHashes = new Set();
  const plans = [];
  for (const plan of asArray(framePlans)) {
    plans.push(await processPlan(plan, { ...options, outputRoot }, seenHashes));
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode,
    dry_run: !applyLocal,
    apply_local: applyLocal,
    output_root: outputRoot,
    will_download: false,
    will_download_video: false,
    will_retain_video: false,
    will_fetch_source_for_frame: applyLocal,
    will_extract_frames: applyLocal,
    summary: summarisePlans(plans, applyLocal),
    plans,
    provenance: plans.flatMap((plan) => plan.provenance || []),
    safety: {
      local_only: true,
      output_under_test_output: isUnder(TEST_OUTPUT_ROOT, outputRoot),
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      render_default_changed: false,
      video_downloads: false,
      retained_video_files: false,
      source_fetch_for_still_frame: applyLocal,
      yt_dlp: false,
      browser_scraping: false,
    },
  };
}

function renderControlledFrameExtractionWorkerMarkdown(report) {
  const lines = [];
  lines.push("# Controlled Local Frame Extraction Worker v1");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Dry run: ${report.dry_run}`);
  lines.push(`Apply local: ${report.apply_local}`);
  lines.push(`Output root: ${toPosix(report.output_root)}`);
  lines.push(`Download video files: ${report.will_download_video}`);
  lines.push(`Retain video files: ${report.will_retain_video}`);
  lines.push(`Fetch source only for still frame: ${report.will_fetch_source_for_frame}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- stories: ${report.summary.stories}`);
  lines.push(`- frame-plan ready: ${report.summary.frame_plan_ready}`);
  lines.push(`- frames would extract: ${report.summary.frames_would_extract}`);
  lines.push(`- frames extracted: ${report.summary.frames_extracted}`);
  lines.push(`- frames accepted: ${report.summary.frames_accepted}`);
  lines.push(`- frames rejected: ${report.summary.frames_rejected}`);
  lines.push("");
  lines.push("| story | mode | readiness | frames | accepted | rejected | blockers |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | --- |");
  for (const plan of report.plans || []) {
    lines.push(
      [
        plan.story_id,
        plan.mode,
        plan.frame_plan_readiness,
        plan.frames.length,
        plan.frames.filter((frame) => frame.status === "accepted").length,
        plan.frames.filter((frame) => frame.status !== "accepted" && frame.status !== "would_extract").length,
        plan.blockers.join(", ") || "clear",
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
  lines.push("- No production DB, Railway, OAuth, scheduler, render-default or posting changes.");
  lines.push("- No yt-dlp or browser scraping.");
  return lines.join("\n") + "\n";
}

module.exports = {
  DEFAULT_OUTPUT_ROOT,
  MIN_OFFICIAL_FRAME_SAMPLE_S,
  inspectExtractedFrame,
  mergeControlledFrameExtractionReports,
  officialTrailerFrameRejectReason,
  runControlledFrameExtraction,
  renderControlledFrameExtractionWorkerMarkdown,
};
