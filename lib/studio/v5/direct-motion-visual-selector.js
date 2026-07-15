"use strict";

const path = require("path");
const crypto = require("crypto");
const fs = require("fs-extra");
const { execFileSync } = require("child_process");

const { prescanImage } = require("../../visual-content-prescan");
const {
  PROFESSIONAL_MOTION_SOURCE_POLICY,
  assessProfessionalSourceDiversity,
} = require("../motion-source-identity");

const DIRECT_MOTION_VISUAL_SELECTOR_V5 = Object.freeze({
  version: "pulse_direct_motion_visual_selector_v5",
  sample_count: 8,
  elite_minimum_base_sources: 2,
  max_text_overlay_likelihood: 0.34,
  reject_text_heavy_samples: true,
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
  { minimumBaseSources = DIRECT_MOTION_VISUAL_SELECTOR_V5.elite_minimum_base_sources } = {},
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
    maxScenesPerSource: Number.MAX_SAFE_INTEGER,
    maxSourceShare: 1,
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

function scoreDirectMotionVisualSamples(samples = []) {
  const rows = Array.isArray(samples) ? samples.filter(Boolean) : [];
  const reasons = [];
  if (!rows.length) reasons.push("direct_motion_visual_samples_missing");

  const textHeavyCount = rows.filter((sample) =>
    Array.isArray(sample?.trailer_frame_taste?.tags) &&
    sample.trailer_frame_taste.tags.includes("text_heavy"),
  ).length;
  const failedTasteCount = rows.filter(
    (sample) => String(sample?.trailer_frame_taste?.verdict || "").toLowerCase() === "fail",
  ).length;
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
  if (failedTasteCount > 0) reasons.push("direct_motion_frame_taste_failed");

  return {
    version: DIRECT_MOTION_VISUAL_SELECTOR_V5.version,
    eligible: reasons.length === 0,
    reasons,
    metrics: {
      decoded_sample_count: rows.length,
      text_heavy_sample_count: textHeavyCount,
      failed_taste_sample_count: failedTasteCount,
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

function premiumSampleTimes(durationS) {
  const duration = Number(durationS);
  if (!Number.isFinite(duration) || duration <= 0.2) return [];
  const latest = Math.max(0.1, duration - 0.35);
  const earliest = Math.min(latest, Math.max(0.1, duration * 0.08));
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
      samples.push({ time_s: timeS, frame_path: framePath, ...prescan });
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
    policyTier = "normal_strict_green",
    minimumBaseSources = PROFESSIONAL_MOTION_SOURCE_POLICY.min_genuine_base_sources,
  } = {},
) {
  const selected = [];
  const accepted = [];
  const acceptedClips = [];
  const rejected = [];

  for (const clip of Array.isArray(clips) ? clips : []) {
    if (isGeneratedCardClip(clip)) {
      selected.push(clip);
      continue;
    }
    const report = await inspectClip(clip, { outputDir });
    if (report.eligible) {
      selected.push(clip);
      accepted.push(report);
      acceptedClips.push(clip);
    } else {
      rejected.push(report);
    }
  }

  const sourceDiversity = assessDirectMotionSourceDiversity(acceptedClips, {
    minimumBaseSources,
  });
  const selectedPolicyTier = String(policyTier || "normal_strict_green").trim().toLowerCase();
  const enforceProfessional = selectedPolicyTier === "ultimate_professional";
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
  filterPremiumDirectMotionClips,
};
