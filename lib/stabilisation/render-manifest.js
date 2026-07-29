"use strict";

const {
  STANDARD_RENDERER_ID,
  evaluateRendererManifest,
} = require("./renderer-governance");

function ownOrNull(object, key) {
  if (
    !object ||
    !Object.prototype.hasOwnProperty.call(object, key) ||
    object[key] === undefined
  ) {
    return null;
  }
  return object[key];
}

function aspectRatio(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  if (Math.abs(w / h - 9 / 16) <= 0.0001) return "9:16";
  return `${w}:${h}`;
}

function buildStandardRendererManifest({
  story,
  rendererVersion,
  mediaSha256,
  platformVideoQa,
  stack,
  timing,
  motion,
} = {}) {
  const technical = platformVideoQa?.technical || {};
  const safeStack = stack || {};
  const safeTiming = timing || {};
  const safeMotion = motion || {};

  return {
    schema_version: "pulse-render-manifest-v1",
    story_id: story?.id || null,
    channel_id: story?.channel_id || story?.channel || null,
    renderer: {
      id: STANDARD_RENDERER_ID,
      role: "standard",
      version: rendererVersion || null,
    },
    stack: {
      hyperframes: ownOrNull(safeStack, "hyperframes"),
      ffmpeg: ownOrNull(safeStack, "ffmpeg"),
    },
    output: {
      sha256: mediaSha256 || null,
      width: ownOrNull(technical, "width"),
      height: ownOrNull(technical, "height"),
      aspect_ratio: aspectRatio(technical.width, technical.height),
      video_codec: ownOrNull(technical, "video_codec"),
      video_profile: ownOrNull(technical, "video_profile"),
      pixel_format: ownOrNull(technical, "pixel_format"),
      audio_codec: ownOrNull(technical, "audio_codec"),
      audio_sample_rate_hz: ownOrNull(
        technical,
        "audio_sample_rate_hz",
      ),
      has_audio: ownOrNull(technical, "has_audio"),
      duration_seconds: ownOrNull(technical, "duration_seconds"),
      ffprobe_passed: ownOrNull(technical, "ffprobe_passed"),
      platform_video_qa_result: platformVideoQa?.result || null,
    },
    timing: {
      first_frame_exact_subject: ownOrNull(
        safeTiming,
        "first_frame_exact_subject",
      ),
      first_frame_text: ownOrNull(
        safeTiming,
        "first_frame_text",
      ),
      hook_visible_by_ms: ownOrNull(safeTiming, "hook_visible_by_ms"),
      consequence_by_ms: ownOrNull(safeTiming, "consequence_by_ms"),
      proof_by_ms: ownOrNull(safeTiming, "proof_by_ms"),
    },
    motion: {
      scene_count: ownOrNull(safeMotion, "scene_count"),
      motion_scene_count: ownOrNull(
        safeMotion,
        "motion_scene_count",
      ),
      exact_subject_clip_count: ownOrNull(
        safeMotion,
        "exact_subject_clip_count",
      ),
      exact_subject_still_motion_count: ownOrNull(
        safeMotion,
        "exact_subject_still_motion_count",
      ),
      unrelated_filler_count: ownOrNull(
        safeMotion,
        "unrelated_filler_count",
      ),
      every_scene_rights_accepted: ownOrNull(
        safeMotion,
        "every_scene_rights_accepted",
      ),
    },
  };
}

function createRendererEvidence({
  operatingMode = "LOCAL_PROOF",
  generatedAt = new Date().toISOString(),
  ...manifestInput
} = {}) {
  const manifest = buildStandardRendererManifest(manifestInput);
  const evaluation = evaluateRendererManifest(manifest, {
    operatingMode,
  });
  return {
    schema_version: "pulse-renderer-evidence-v1",
    generated_at: generatedAt,
    operating_mode: evaluation.operating_mode,
    authoritative: evaluation.publishable,
    manifest_sha256: evaluation.manifest_sha256,
    manifest,
    evaluation,
  };
}

module.exports = {
  buildStandardRendererManifest,
  createRendererEvidence,
};
