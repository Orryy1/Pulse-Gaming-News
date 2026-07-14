"use strict";

const path = require("path");
const crypto = require("crypto");
const fs = require("fs-extra");
const { execFileSync } = require("child_process");

const { prescanImage } = require("../../visual-content-prescan");

const DIRECT_MOTION_VISUAL_SELECTOR_V5 = Object.freeze({
  version: "pulse_direct_motion_visual_selector_v5",
  sample_count: 4,
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
  return [
    Math.min(latest, Math.max(0.1, duration * 0.08)),
    Math.min(latest, Math.max(0.1, duration * 0.34)),
    Math.min(latest, Math.max(0.1, duration * 0.64)),
    latest,
  ]
    .map((value) => Number(value.toFixed(3)))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, DIRECT_MOTION_VISUAL_SELECTOR_V5.sample_count);
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
  { outputDir = path.resolve("test/output/direct-motion-visual-selector-v5") } = {},
) {
  const selected = [];
  const accepted = [];
  const rejected = [];

  for (const clip of Array.isArray(clips) ? clips : []) {
    if (isGeneratedCardClip(clip)) {
      selected.push(clip);
      continue;
    }
    const report = await inspectDirectMotionClip(clip, { outputDir });
    if (report.eligible) {
      selected.push(clip);
      accepted.push(report);
    } else {
      rejected.push(report);
    }
  }

  return {
    version: DIRECT_MOTION_VISUAL_SELECTOR_V5.version,
    clips: selected,
    accepted,
    rejected,
    blockers: accepted.length ? [] : ["premium_direct_motion_missing"],
  };
}

module.exports = {
  DIRECT_MOTION_VISUAL_SELECTOR_V5,
  clipPath,
  isGeneratedCardClip,
  scoreDirectMotionVisualSamples,
  premiumSampleTimes,
  inspectDirectMotionClip,
  filterPremiumDirectMotionClips,
};
