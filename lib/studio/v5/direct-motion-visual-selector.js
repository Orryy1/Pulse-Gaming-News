"use strict";

const path = require("path");
const crypto = require("crypto");
const fs = require("fs-extra");
const { execFileSync } = require("child_process");

const { prescanImage } = require("../../visual-content-prescan");
const { analyseBorderRisk } = require("../../goal-human-review-visual-strip-qa");
const {
  PROFESSIONAL_MOTION_SOURCE_POLICY,
  assessProfessionalSourceDiversity,
} = require("../motion-source-identity");

const DIRECT_MOTION_VISUAL_SELECTOR_V5 = Object.freeze({
  version: "pulse_direct_motion_visual_selector_v5",
  sample_count: 20,
  elite_minimum_base_sources: 2,
  max_text_overlay_likelihood: 0.34,
  portrait_max_aspect_ratio: 0.72,
  crop_text_min_overlay_likelihood: 0.03,
  crop_text_letterbox_minimum: 0.08,
  crop_text_dark_edge_minimum: 0.5,
  crop_callout_min_overlay_likelihood: 0.12,
  crop_callout_border_risk_minimum: 0.42,
  crop_callout_bright_edge_minimum: 0.12,
  crop_glyph_white_text_minimum: 0.35,
  crop_glyph_border_risk_minimum: 0.55,
  crop_glyph_edge_touch_minimum: 0.12,
  crop_title_min_overlay_likelihood: 0.14,
  crop_title_min_central_bright_ratio: 0.05,
  crop_title_min_edge_density: 0.22,
  dark_low_info_min_dark_ratio: 0.58,
  dark_low_info_min_central_dark_ratio: 0.55,
  dark_low_info_max_bright_ratio: 0.012,
  dark_low_info_max_edge_density: 0.055,
  dark_low_info_min_consecutive_samples: 2,
  portrait_low_info_max_edge_density: 0.06,
  portrait_low_info_min_consecutive_samples: 5,
  reject_text_heavy_samples: true,
  legal_footer_crop_bottom_fraction: 0.1,
  legal_footer_crop_repair_kind: "crop_legal_footer_bottom_10_percent",
  fail_closed: true,
});

function clipPath(clip) {
  if (typeof clip === "string") return clip;
  return String(
    clip?.path ||
      clip?.clip_path ||
      clip?.local_path ||
      clip?.video_path ||
      clip?.exported_path ||
      "",
  ).trim();
}

function attachExactClipEvidence(clip, report = {}) {
  const sourceUrl = metadataValues(clip, ["source_url", "sourceUrl", "canonical_source_url"])[0];
  const sourceFamily = metadataValues(clip, ["source_family", "sourceFamily"])[0];
  const baseSourceFamily = metadataValues(clip, [
    "base_source_family",
    "baseSourceFamily",
  ])[0];
  const assetSha256 = metadataValues(clip, [
    "asset_sha256",
    "sha256",
    "materialized_sha256",
    "materialised_sha256",
  ])[0];
  const sourceMasterSha256 = metadataValues(clip, [
    "source_master_sha256",
    "sourceMasterSha256",
  ])[0];

  return {
    ...report,
    clip_id:
      cleanIdentity(clip?.id || clip?.clip_id || clip?.clipId || clip?.asset_id) ||
      cleanIdentity(report.clip_id),
    path: cleanIdentity(report.path) || clipPath(clip),
    source_url: sourceUrl || cleanIdentity(report.source_url),
    source_family: sourceFamily || cleanIdentity(report.source_family),
    base_source_family: baseSourceFamily || cleanIdentity(report.base_source_family),
    asset_sha256: assetSha256 || cleanIdentity(report.asset_sha256),
    source_master_sha256:
      sourceMasterSha256 || cleanIdentity(report.source_master_sha256),
  };
}

function isGeneratedCardClip(clip) {
  const mediaKind = String(clip?.media_kind || clip?.mediaKind || "").toLowerCase();
  const cardType = String(clip?.card_type || clip?.cardType || "").toLowerCase();
  const file = path.basename(clipPath(clip)).toLowerCase();
  return (
    mediaKind === "generated_card" ||
    Boolean(cardType) ||
    /^hf_(?:source|context|timeline|quote|takeaway|outro)_card_/.test(file)
  );
}

function cleanIdentity(value) {
  return String(value || "").trim();
}

function canonicalWindowFamily(value) {
  const text = cleanIdentity(value);
  if (!text) return "";
  return text.replace(/\\/g, "/").replace(/[?#].*$/, "").toLowerCase();
}

function metadataValues(clip, keys = []) {
  if (!clip || typeof clip !== "object") return [];
  return [clip, clip.provenance]
    .filter((owner) => owner && typeof owner === "object")
    .flatMap((owner) => keys.map((key) => cleanIdentity(owner[key])))
    .filter(Boolean);
}

function clipWindowFamilyIdentity(clip, index) {
  if (typeof clip === "string") return canonicalWindowFamily(clip);
  const explicitFamily =
    metadataValues(clip, [
      "source_family",
      "sourceFamily",
      "motion_family",
      "motionFamily",
      "visual_family",
      "visualFamily",
  ])[0] || cleanIdentity(clip?.id || clip?.clip_id);
  if (explicitFamily) return canonicalWindowFamily(explicitFamily);
  const start = Number(clip?.mediaStartS ?? clip?.media_start_s);
  const duration = Number(clip?.durationS ?? clip?.duration_s);
  const stableClipId = cleanIdentity(clip?.id || clip?.clip_id || clip?.clipId);
  if (stableClipId && (Number.isFinite(start) || Number.isFinite(duration))) {
    return `${canonicalWindowFamily(stableClipId)}|window|${Number.isFinite(start) ? start : 0}|${
      Number.isFinite(duration) ? duration : 0
    }`;
  }
  return canonicalWindowFamily(clipPath(clip)) || `unresolved_clip_${index + 1}`;
}

function sourceDiversityDiagnosticTier({ strictPass, baseSourceCount, windowFamilyCount }) {
  if (strictPass) return "elite_multi_source";
  if (baseSourceCount > 1) return "multi_base_source_below_strict_minimum";
  if (baseSourceCount === 1 && windowFamilyCount > 1) {
    return "single_base_source_multi_window";
  }
  if (baseSourceCount === 1) return "single_base_source_single_window";
  if (windowFamilyCount > 1) return "unresolved_base_source_multi_window";
  return "direct_motion_source_evidence_missing";
}

function assessDirectMotionSourceDiversity(
  clips = [],
  {
    minimumBaseSources = DIRECT_MOTION_VISUAL_SELECTOR_V5.elite_minimum_base_sources,
    enforceProfessionalConcentration = false,
  } = {},
) {
  const rows = Array.isArray(clips)
    ? clips.filter(Boolean).filter((clip) => !isGeneratedCardClip(clip))
    : [];
  const requestedBaseSources = Number(minimumBaseSources);
  const requiredBaseSources = Math.max(
    2,
    Number.isFinite(requestedBaseSources) ? Math.floor(requestedBaseSources) : 2,
  );
  const clipWindowFamilies = new Set();

  rows.forEach((clip, index) => {
    const windowFamily = clipWindowFamilyIdentity(clip, index);
    if (windowFamily) clipWindowFamilies.add(windowFamily);
  });
  const professional = assessProfessionalSourceDiversity({
    clips: rows,
    scenes: rows,
    requiredBaseSources,
    maxScenesPerSource: enforceProfessionalConcentration
      ? PROFESSIONAL_MOTION_SOURCE_POLICY.max_scenes_per_source
      : Number.MAX_SAFE_INTEGER,
    maxSourceShare: enforceProfessionalConcentration
      ? PROFESSIONAL_MOTION_SOURCE_POLICY.max_source_share
      : 1,
  });
  const genuineBaseSources = professional.identity_evidence
    .map((entry) => entry.base_source_asset_id)
    .sort();
  const strictPass = professional.status === "pass";
  const diagnosticTier = sourceDiversityDiagnosticTier({
    strictPass,
    baseSourceCount: genuineBaseSources.length,
    windowFamilyCount: clipWindowFamilies.size,
  });

  return {
    version: DIRECT_MOTION_VISUAL_SELECTOR_V5.version,
    strict_pass: strictPass,
    reasons: strictPass
      ? []
      : [...new Set([
          "direct_motion_base_source_diversity_insufficient",
          ...professional.blockers,
        ])],
    diagnostic_tier: diagnosticTier,
    metrics: {
      direct_motion_clip_count: rows.length,
      distinct_clip_window_family_count: clipWindowFamilies.size,
      distinct_genuine_base_source_count: genuineBaseSources.length,
      required_genuine_base_source_count: requiredBaseSources,
      unresolved_base_source_clip_count: professional.unresolved_clips.length,
    },
    clip_window_families: [...clipWindowFamilies].sort(),
    genuine_base_sources: genuineBaseSources,
    professional_source_diversity: professional,
  };
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function portraitCropEmbeddedTextRisk(sample = {}) {
  const width = finiteNumber(sample.width);
  const height = finiteNumber(sample.height);
  const aspectRatio = finiteNumber(
    sample.aspect_ratio,
    width > 0 && height > 0 ? width / height : 0,
  );
  const portraitCrop =
    aspectRatio > 0 && aspectRatio <= DIRECT_MOTION_VISUAL_SELECTOR_V5.portrait_max_aspect_ratio;
  if (!portraitCrop) return false;

  const riskTokens = [
    ...(Array.isArray(sample.blockers) ? sample.blockers : []),
    ...(Array.isArray(sample.risk_reasons) ? sample.risk_reasons : []),
    ...(Array.isArray(sample.risk_flags) ? sample.risk_flags : []),
  ].map((value) => String(value || "").trim().toLowerCase());
  if (
    riskTokens.some((value) =>
      [
        "frame_text_cutoff_risk",
        "possible_edge_text_cutoff",
        "text_like_pixels_near_frame_edge",
      ].includes(value),
    )
  ) {
    return true;
  }

  const border = sample.border && typeof sample.border === "object" ? sample.border : {};
  const textOverlay = finiteNumber(sample.text_overlay_likelihood);
  const letterbox = finiteNumber(sample.letterbox_bar_ratio);
  const darkEdge = finiteNumber(border.dark_edge_ratio);
  const brightEdge = finiteNumber(border.bright_edge_ratio);
  const edgeTouch = finiteNumber(border.edge_touch_ratio);
  const borderRisk = finiteNumber(border.text_cutoff_risk_score);
  const whiteTextOnDark = finiteNumber(sample.white_text_on_dark_likelihood);
  const centralBright = finiteNumber(sample.central_bright_pixel_ratio);
  const edgeDensity = finiteNumber(sample.edge_density);
  const tasteTags = Array.isArray(sample?.trailer_frame_taste?.tags)
    ? sample.trailer_frame_taste.tags.map((value) => String(value || "").trim().toLowerCase())
    : [];
  const gameplayHud = tasteTags.includes("hud_text") || tasteTags.includes("gameplay_hud");

  const croppedLetterboxText =
    textOverlay >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_text_min_overlay_likelihood &&
    letterbox >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_text_letterbox_minimum &&
    darkEdge >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_text_dark_edge_minimum;
  const croppedLargeCallout =
    textOverlay >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_callout_min_overlay_likelihood &&
    (borderRisk >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_callout_border_risk_minimum ||
      brightEdge >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_callout_bright_edge_minimum);
  const croppedOversizedEdgeGlyph =
    whiteTextOnDark >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_glyph_white_text_minimum &&
    borderRisk >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_glyph_border_risk_minimum &&
    edgeTouch >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_glyph_edge_touch_minimum;
  const croppedOversizedTitleBand =
    !gameplayHud &&
    textOverlay >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_title_min_overlay_likelihood &&
    centralBright >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_title_min_central_bright_ratio &&
    edgeDensity >= DIRECT_MOTION_VISUAL_SELECTOR_V5.crop_title_min_edge_density;

  return (
    croppedLetterboxText ||
    croppedLargeCallout ||
    croppedOversizedEdgeGlyph ||
    croppedOversizedTitleBand
  );
}

function scoreDirectMotionVisualSamples(samples = []) {
  const rows = Array.isArray(samples) ? samples.filter(Boolean) : [];
  const reasons = [];
  if (!rows.length) reasons.push("direct_motion_visual_samples_missing");
  const analysisErrorCount = rows.filter(
    (sample) =>
      cleanIdentity(sample?.error) ||
      cleanIdentity(sample?.border_error),
  ).length;

  const textHeavyCount = rows.filter((sample) =>
    Array.isArray(sample?.trailer_frame_taste?.tags) &&
    sample.trailer_frame_taste.tags.includes("text_heavy"),
  ).length;
  const failedTasteCount = rows.filter(
    (sample) => String(sample?.trailer_frame_taste?.verdict || "").toLowerCase() === "fail",
  ).length;
  const portraitCropTextRiskCount = rows.filter(portraitCropEmbeddedTextRisk).length;
  const darkLowInformationFlags = rows.map(
    (sample) =>
      finiteNumber(sample?.dark_pixel_ratio) >=
        DIRECT_MOTION_VISUAL_SELECTOR_V5.dark_low_info_min_dark_ratio &&
      finiteNumber(sample?.central_dark_pixel_ratio) >=
        DIRECT_MOTION_VISUAL_SELECTOR_V5.dark_low_info_min_central_dark_ratio &&
      finiteNumber(sample?.bright_pixel_ratio) <=
        DIRECT_MOTION_VISUAL_SELECTOR_V5.dark_low_info_max_bright_ratio &&
      finiteNumber(sample?.edge_density) <=
        DIRECT_MOTION_VISUAL_SELECTOR_V5.dark_low_info_max_edge_density,
  );
  let darkLowInformationRun = 0;
  let longestDarkLowInformationRun = 0;
  for (const flagged of darkLowInformationFlags) {
    darkLowInformationRun = flagged ? darkLowInformationRun + 1 : 0;
    longestDarkLowInformationRun = Math.max(
      longestDarkLowInformationRun,
      darkLowInformationRun,
    );
  }
  const darkLowInformationCount = darkLowInformationFlags.filter(Boolean).length;
  const portraitLowInformationFlags = rows.map((sample) => {
    const width = finiteNumber(sample?.width);
    const height = finiteNumber(sample?.height);
    const aspectRatio = finiteNumber(
      sample?.aspect_ratio,
      width > 0 && height > 0 ? width / height : 0,
    );
    const tags = Array.isArray(sample?.trailer_frame_taste?.tags)
      ? sample.trailer_frame_taste.tags.map((value) =>
          String(value || "").trim().toLowerCase(),
        )
      : [];
    const subjectDetailPresent =
      tags.includes("detail_rich") || tags.includes("gameplay_candidate");
    return (
      aspectRatio > 0 &&
      aspectRatio <= DIRECT_MOTION_VISUAL_SELECTOR_V5.portrait_max_aspect_ratio &&
      finiteNumber(sample?.edge_density) <=
        DIRECT_MOTION_VISUAL_SELECTOR_V5.portrait_low_info_max_edge_density &&
      !subjectDetailPresent
    );
  });
  let portraitLowInformationRun = 0;
  let longestPortraitLowInformationRun = 0;
  for (const flagged of portraitLowInformationFlags) {
    portraitLowInformationRun = flagged ? portraitLowInformationRun + 1 : 0;
    longestPortraitLowInformationRun = Math.max(
      longestPortraitLowInformationRun,
      portraitLowInformationRun,
    );
  }
  const portraitLowInformationCount =
    portraitLowInformationFlags.filter(Boolean).length;
  const maxTextOverlay = rows.reduce(
    (max, sample) => Math.max(max, Number(sample?.text_overlay_likelihood || 0)),
    0,
  );

  if (
    textHeavyCount > 0 ||
    maxTextOverlay >= DIRECT_MOTION_VISUAL_SELECTOR_V5.max_text_overlay_likelihood
  ) {
    reasons.push("direct_motion_baked_caption_risk");
  }
  if (analysisErrorCount > 0) {
    reasons.push("direct_motion_visual_analysis_failed");
  }
  if (failedTasteCount > 0) reasons.push("direct_motion_frame_taste_failed");
  if (portraitCropTextRiskCount > 0) {
    reasons.push("direct_motion_portrait_crop_embedded_text_truncation_risk");
  }
  if (
    longestDarkLowInformationRun >=
    DIRECT_MOTION_VISUAL_SELECTOR_V5.dark_low_info_min_consecutive_samples
  ) {
    reasons.push("direct_motion_dark_low_information_risk");
  }
  if (
    longestPortraitLowInformationRun >=
    DIRECT_MOTION_VISUAL_SELECTOR_V5.portrait_low_info_min_consecutive_samples
  ) {
    reasons.push("direct_motion_portrait_low_information_risk");
  }

  return {
    version: DIRECT_MOTION_VISUAL_SELECTOR_V5.version,
    eligible: reasons.length === 0,
    reasons,
    metrics: {
      decoded_sample_count: rows.length,
      analysed_sample_count: rows.length - analysisErrorCount,
      analysis_error_sample_count: analysisErrorCount,
      text_heavy_sample_count: textHeavyCount,
      failed_taste_sample_count: failedTasteCount,
      portrait_crop_text_risk_sample_count: portraitCropTextRiskCount,
      dark_low_information_sample_count: darkLowInformationCount,
      longest_dark_low_information_run: longestDarkLowInformationRun,
      portrait_low_information_sample_count: portraitLowInformationCount,
      longest_portrait_low_information_run: longestPortraitLowInformationRun,
      maximum_text_overlay_likelihood: Number(maxTextOverlay.toFixed(3)),
    },
  };
}

function ffprobeDuration(filePath) {
  try {
    const value = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const duration = Number(String(value).trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

function ffprobeVideoProfile(filePath) {
  try {
    const value = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "format=duration:stream=codec_name,width,height,avg_frame_rate",
        "-of",
        "json",
        filePath,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const payload = JSON.parse(String(value || "{}"));
    const video = Array.isArray(payload.streams) ? payload.streams[0] || {} : {};
    const durationS = Number(payload?.format?.duration);
    return {
      duration_s: Number.isFinite(durationS) && durationS > 0 ? durationS : 0,
      video_codec: cleanIdentity(video.codec_name),
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
      avg_frame_rate: cleanIdentity(video.avg_frame_rate),
    };
  } catch {
    return null;
  }
}

function failedTasteSamples(report = {}) {
  return (Array.isArray(report.samples) ? report.samples : []).filter(
    (sample) =>
      String(sample?.trailer_frame_taste?.verdict || "").trim().toLowerCase() ===
      "fail",
  );
}

function isFooterOnlyLowerBandFailure(report = {}) {
  const reasons = (Array.isArray(report.reasons) ? report.reasons : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const failedSamples = failedTasteSamples(report);
  return (
    reasons.length === 1 &&
    reasons[0] === "direct_motion_frame_taste_failed" &&
    failedSamples.length > 0 &&
    failedSamples.every(
      (sample) =>
        String(sample?.trailer_frame_taste?.reason || "").trim().toLowerCase() ===
        "lower_band_text_overlay",
    ) &&
    !(Array.isArray(report.errors) && report.errors.length)
  );
}

function footerRepairOutputPath(clip, outputDir) {
  const inputPath = clipPath(clip);
  const identity = cleanIdentity(
    clip?.id || clip?.clip_id || clip?.asset_id || path.basename(inputPath, path.extname(inputPath)),
  )
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72) || "motion_clip";
  const suffix = crypto
    .createHash("sha1")
    .update(`${path.resolve(inputPath)}|${DIRECT_MOTION_VISUAL_SELECTOR_V5.legal_footer_crop_repair_kind}`)
    .digest("hex")
    .slice(0, 12);
  return path.join(
    outputDir,
    "footer-crop-repairs",
    `${identity}.${suffix}.footer-crop.mp4`,
  );
}

async function materializeLegalFooterCropRepair(
  clip,
  {
    outputDir = path.resolve("test/output/direct-motion-visual-selector-v5"),
  } = {},
) {
  const inputPath = clipPath(clip);
  if (!inputPath || !(await fs.pathExists(inputPath))) {
    throw new Error("legal_footer_crop_source_missing");
  }
  const sourceProfile = ffprobeVideoProfile(inputPath);
  if (!sourceProfile?.width || !sourceProfile?.height || !sourceProfile?.duration_s) {
    throw new Error("legal_footer_crop_source_probe_failed");
  }

  const outputPath = footerRepairOutputPath(clip, outputDir);
  const temporaryPath = `${outputPath}.rendering-${process.pid}-${crypto.randomUUID()}.mp4`;
  await fs.ensureDir(path.dirname(outputPath));
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-an",
        "-vf",
        "crop=iw:trunc(ih*0.90/2)*2:0:0",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        temporaryPath,
      ],
      { stdio: "ignore", windowsHide: true },
    );
    const repairedProfile = ffprobeVideoProfile(temporaryPath);
    if (
      !repairedProfile?.width ||
      !repairedProfile?.height ||
      !repairedProfile?.duration_s ||
      repairedProfile.height >= sourceProfile.height
    ) {
      throw new Error("legal_footer_crop_output_profile_invalid");
    }
    await fs.move(temporaryPath, outputPath, { overwrite: true });
  } finally {
    await fs.remove(temporaryPath).catch(() => {});
  }

  const repairedProfile = ffprobeVideoProfile(outputPath);
  const repairedBuffer = await fs.readFile(outputPath);
  const repairedSha256 = crypto
    .createHash("sha256")
    .update(repairedBuffer)
    .digest("hex");
  const repairedStat = await fs.stat(outputPath);
  const sourceAssetSha256 = cleanIdentity(
    clip?.asset_sha256 ||
      clip?.sha256 ||
      clip?.materialized_file_evidence?.sha256,
  ).replace(/^sha256:/i, "");
  const repairEvidence = {
    status: "pass",
    kind: DIRECT_MOTION_VISUAL_SELECTOR_V5.legal_footer_crop_repair_kind,
    source_path: inputPath,
    source_asset_sha256: sourceAssetSha256 || null,
    output_path: outputPath,
    output_asset_sha256: repairedSha256,
    crop_bottom_fraction:
      DIRECT_MOTION_VISUAL_SELECTOR_V5.legal_footer_crop_bottom_fraction,
    source_height: sourceProfile.height,
    output_height: repairedProfile.height,
    removed_bottom_pixels: sourceProfile.height - repairedProfile.height,
  };
  const motionSourceIdentity =
    clip?.motion_source_identity && typeof clip.motion_source_identity === "object"
      ? {
          ...clip.motion_source_identity,
          asset_sha256: repairedSha256,
          sampled_visual_fingerprint: `sha256:${repairedSha256}`,
        }
      : undefined;

  return {
    ...clip,
    path: outputPath,
    local_path: outputPath,
    local_materialized_path: outputPath,
    original_path: inputPath,
    asset_sha256: repairedSha256,
    sha256: repairedSha256,
    sampled_visual_fingerprint: `sha256:${repairedSha256}`,
    asset_size_bytes: repairedStat.size,
    size_bytes: repairedStat.size,
    materialized_duration_s: repairedProfile.duration_s,
    duration_s: repairedProfile.duration_s,
    durationS: repairedProfile.duration_s,
    video_codec: repairedProfile.video_codec,
    width: repairedProfile.width,
    height: repairedProfile.height,
    source_crop_bottom_px: repairEvidence.removed_bottom_pixels,
    materialized_file_evidence: {
      schema_version: 1,
      captured_at: new Date().toISOString(),
      sha256: repairedSha256,
      size_bytes: repairedStat.size,
      duration_seconds: repairedProfile.duration_s,
      video_codec: repairedProfile.video_codec,
      width: repairedProfile.width,
      height: repairedProfile.height,
    },
    ...(motionSourceIdentity
      ? { motion_source_identity: motionSourceIdentity }
      : {}),
    transformation_provenance: {
      ...(clip?.transformation_provenance || {}),
      repair_kind: repairEvidence.kind,
      repair_source_path: inputPath,
      repair_source_asset_sha256: sourceAssetSha256 || null,
      crop_bottom_fraction: repairEvidence.crop_bottom_fraction,
      crop_bottom_pixels: repairEvidence.removed_bottom_pixels,
    },
    validation_provenance: {
      ...(clip?.validation_provenance || {}),
      visual_footer_crop_repair_passed: true,
      visual_footer_crop_repair_kind: repairEvidence.kind,
    },
    visual_repair: repairEvidence,
  };
}

function premiumSampleTimes(durationS) {
  const duration = Number(durationS);
  if (!Number.isFinite(duration) || duration <= 0.2) return [];
  const latest = Math.max(0.1, duration - 0.35);
  const earliest = Math.min(latest, 0.08);
  const sampleCount = DIRECT_MOTION_VISUAL_SELECTOR_V5.sample_count;
  return Array.from({ length: sampleCount }, (_, index) =>
    sampleCount === 1
      ? earliest
      : earliest + ((latest - earliest) * index) / (sampleCount - 1),
  )
    .map((value) => Number(value.toFixed(3)))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, sampleCount);
}

async function inspectDirectMotionClip(clip, { outputDir } = {}) {
  const filePath = clipPath(clip);
  const durationS = ffprobeDuration(filePath);
  const sampleTimes = premiumSampleTimes(durationS);
  const safeId = crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 12);
  const frameDir = path.join(outputDir, safeId);
  await fs.ensureDir(frameDir);
  const samples = [];
  const errors = [];

  for (let index = 0; index < sampleTimes.length; index += 1) {
    const timeS = sampleTimes[index];
    const framePath = path.join(frameDir, `frame_${String(index + 1).padStart(2, "0")}.jpg`);
    try {
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          String(timeS),
          "-i",
          filePath,
          "-frames:v",
          "1",
          "-vf",
          "scale=540:960:force_original_aspect_ratio=increase,crop=540:960",
          "-q:v",
          "2",
          framePath,
        ],
        { stdio: "ignore", windowsHide: true },
      );
      const prescan = await prescanImage(framePath, { sourceTypeHint: "trailer" });
      let border = null;
      let borderError = null;
      try {
        border = await analyseBorderRisk(framePath);
      } catch (error) {
        borderError = `border_scan:${error.code || error.message || "failed"}`;
      }
      samples.push({
        time_s: timeS,
        frame_path: framePath,
        ...prescan,
        border,
        border_error: borderError,
      });
    } catch (error) {
      errors.push(`sample_${index + 1}:${error.code || "decode_failed"}`);
    }
  }

  const score = scoreDirectMotionVisualSamples(samples);
  if (errors.length && !samples.length) {
    score.reasons = Array.from(new Set([...score.reasons, "direct_motion_decode_failed"]));
    score.eligible = false;
  }
  return {
    path: filePath,
    duration_s: durationS,
    sample_times_s: sampleTimes,
    samples,
    errors,
    ...score,
  };
}

async function filterPremiumDirectMotionClips(
  clips = [],
  {
    outputDir = path.resolve("test/output/direct-motion-visual-selector-v5"),
    inspectClip = inspectDirectMotionClip,
    repairClip = materializeLegalFooterCropRepair,
    policyTier = "normal_strict_green",
    minimumBaseSources = PROFESSIONAL_MOTION_SOURCE_POLICY.min_genuine_base_sources,
  } = {},
) {
  const selected = [];
  const accepted = [];
  const acceptedClips = [];
  const rejected = [];
  const repairs = [];

  for (const clip of Array.isArray(clips) ? clips : []) {
    if (isGeneratedCardClip(clip)) {
      selected.push(clip);
      continue;
    }
    const report = attachExactClipEvidence(
      clip,
      await inspectClip(clip, { outputDir }),
    );
    if (
      !report.eligible &&
      isFooterOnlyLowerBandFailure(report) &&
      typeof repairClip === "function"
    ) {
      const repairContext = {
        outputDir,
        repair_kind:
          DIRECT_MOTION_VISUAL_SELECTOR_V5.legal_footer_crop_repair_kind,
        inspection_report: report,
      };
      try {
        const repairedClip = await repairClip(clip, repairContext);
        const repairedPath = clipPath(repairedClip);
        if (!repairedClip || !repairedPath || repairedPath === clipPath(clip)) {
          throw new Error("legal_footer_crop_repair_output_invalid");
        }
        const repairedReport = attachExactClipEvidence(
          repairedClip,
          await inspectClip(repairedClip, {
            outputDir: path.join(outputDir, "repaired-frame-samples"),
          }),
        );
        const repairEvidence = {
          ...(repairedClip.visual_repair || {}),
          status: repairedReport.eligible ? "pass" : "failed",
          kind: repairContext.repair_kind,
          source_path: clipPath(clip),
          output_path: repairedPath,
          source_reasons: report.reasons,
          post_repair_reasons: repairedReport.reasons,
        };
        repairs.push(repairEvidence);
        if (repairedReport.eligible) {
          const acceptedReport = {
            ...repairedReport,
            visual_repair: repairEvidence,
          };
          selected.push(repairedClip);
          accepted.push(acceptedReport);
          acceptedClips.push(repairedClip);
          continue;
        }
        report.visual_repair = repairEvidence;
      } catch (error) {
        const repairEvidence = {
          status: "failed",
          kind: repairContext.repair_kind,
          source_path: clipPath(clip),
          output_path: null,
          source_reasons: report.reasons,
          post_repair_reasons: [],
          error: String(error?.message || error || "repair_failed"),
        };
        repairs.push(repairEvidence);
        report.visual_repair = repairEvidence;
      }
    }
    if (report.eligible) {
      selected.push(clip);
      accepted.push(report);
      acceptedClips.push(clip);
    } else {
      rejected.push(report);
    }
  }

  const selectedPolicyTier = String(policyTier || "normal_strict_green").trim().toLowerCase();
  const enforceProfessional = selectedPolicyTier === "ultimate_professional";
  const sourceDiversity = assessDirectMotionSourceDiversity(acceptedClips, {
    minimumBaseSources,
    enforceProfessionalConcentration: enforceProfessional,
  });
  const blockers = [];
  if (!accepted.length) blockers.push("premium_direct_motion_missing");
  else if (enforceProfessional && !sourceDiversity.strict_pass) {
    blockers.push(...sourceDiversity.professional_source_diversity.blockers);
  }

  return {
    version: DIRECT_MOTION_VISUAL_SELECTOR_V5.version,
    policy_tier: selectedPolicyTier,
    clips: selected,
    accepted,
    rejected,
    repairs,
    source_diversity: sourceDiversity,
    professional_source_diversity: sourceDiversity.professional_source_diversity,
    blockers,
  };
}

module.exports = {
  DIRECT_MOTION_VISUAL_SELECTOR_V5,
  clipPath,
  isGeneratedCardClip,
  assessDirectMotionSourceDiversity,
  scoreDirectMotionVisualSamples,
  premiumSampleTimes,
  inspectDirectMotionClip,
  isFooterOnlyLowerBandFailure,
  materializeLegalFooterCropRepair,
  filterPremiumDirectMotionClips,
};
