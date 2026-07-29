"use strict";

const crypto = require("node:crypto");

const STANDARD_RENDERER_ID = "studio-v21";
const EXPERIMENTAL_RENDERER_ID = "hyperframes-next";

const ACTIVE_RENDERERS = Object.freeze([
  Object.freeze({
    id: STANDARD_RENDERER_ID,
    role: "standard",
    publishEligible: true,
  }),
  Object.freeze({
    id: EXPERIMENTAL_RENDERER_ID,
    role: "experimental",
    publishEligible: false,
  }),
]);

const ACTIVE_RENDERER_BY_ID = new Map(
  ACTIVE_RENDERERS.map((renderer) => [renderer.id, renderer]),
);

const PUBLISH_AUTHORITY_MODES = new Set(["HUMAN_REVIEW", "LIVE_GUARDED"]);
const KNOWN_OPERATING_MODES = new Set([
  "LOCAL_PROOF",
  "HUMAN_REVIEW",
  "LIVE_GUARDED",
]);

function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = canonicalise(value[key]);
    }
    return result;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function fingerprintRendererManifest(manifest) {
  const canonical = JSON.stringify(canonicalise(manifest));
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function normaliseMode(value) {
  return String(value || "LOCAL_PROOF")
    .trim()
    .toUpperCase();
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerAtLeastZero(value) {
  const number = finiteNumber(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function addIf(blockers, condition, reason) {
  if (condition) blockers.push(reason);
}

function evaluateRendererManifest(manifest, options = {}) {
  const blockers = [];
  const warnings = [];
  const mode = normaliseMode(options.operatingMode);
  const input = manifest && typeof manifest === "object" ? manifest : {};
  const renderer = input.renderer || {};
  const registered = ACTIVE_RENDERER_BY_ID.get(renderer.id);
  const output = input.output || {};
  const timing = input.timing || {};
  const motion = input.motion || {};
  const stack = input.stack || {};

  const sceneCount = integerAtLeastZero(motion.scene_count);
  const motionSceneCount = integerAtLeastZero(motion.motion_scene_count);
  const exactClipCount = integerAtLeastZero(
    motion.exact_subject_clip_count,
  );
  const exactStillMotionCount = integerAtLeastZero(
    motion.exact_subject_still_motion_count,
  );
  const exactSubjectMotionCount = exactClipCount + exactStillMotionCount;
  const unrelatedFillerCount = integerAtLeastZero(
    motion.unrelated_filler_count,
  );
  const motionRatio =
    sceneCount > 0
      ? Number((motionSceneCount / sceneCount).toFixed(4))
      : 0;

  if (!KNOWN_OPERATING_MODES.has(mode)) {
    blockers.push("operating_mode_invalid");
  }
  if (!registered) {
    blockers.push("renderer_not_active");
  } else if (renderer.role !== registered.role) {
    blockers.push("renderer_role_mismatch");
  }
  addIf(
    blockers,
    !String(renderer.version || "").trim(),
    "renderer_version_required",
  );
  addIf(
    blockers,
    !String(input.story_id || "").trim(),
    "story_id_required",
  );
  addIf(
    blockers,
    !String(input.channel_id || "").trim(),
    "channel_id_required",
  );

  if (registered?.role === "experimental") {
    blockers.push("experimental_renderer_not_publishable");
  }

  if (registered?.role === "standard") {
    addIf(blockers, stack.hyperframes !== true, "hyperframes_required");
    addIf(blockers, stack.ffmpeg !== true, "ffmpeg_required");
    addIf(
      blockers,
      !/^[a-f0-9]{64}$/i.test(String(output.sha256 || "")),
      "output_sha256_required",
    );
    addIf(
      blockers,
      Number(output.width) !== 1080 || Number(output.height) !== 1920,
      "output_dimensions_must_be_1080x1920",
    );
    addIf(
      blockers,
      String(output.aspect_ratio || "") !== "9:16",
      "output_aspect_ratio_must_be_9x16",
    );
    addIf(
      blockers,
      String(output.video_codec || "").toLowerCase() !== "h264",
      "video_codec_must_be_h264",
    );
    addIf(
      blockers,
      String(output.audio_codec || "").toLowerCase() !== "aac",
      "audio_codec_must_be_aac",
    );
    addIf(
      blockers,
      Number(output.audio_sample_rate_hz) !== 48000,
      "audio_sample_rate_must_be_48000",
    );
    addIf(blockers, output.has_audio !== true, "audio_stream_required");
    addIf(
      blockers,
      !(finiteNumber(output.duration_seconds) > 0),
      "output_duration_required",
    );
    addIf(
      blockers,
      output.ffprobe_passed !== true,
      "ffprobe_verification_required",
    );
    addIf(
      blockers,
      output.platform_video_qa_result !== "pass",
      "platform_video_qa_must_pass",
    );

    addIf(
      blockers,
      timing.first_frame_exact_subject !== true,
      "first_frame_exact_subject_required",
    );
    addIf(
      blockers,
      finiteNumber(timing.hook_visible_by_ms) === null ||
        Number(timing.hook_visible_by_ms) > 500,
      "hook_later_than_500ms",
    );
    addIf(
      blockers,
      finiteNumber(timing.consequence_by_ms) === null ||
        Number(timing.consequence_by_ms) > 1500,
      "consequence_later_than_1500ms",
    );
    addIf(
      blockers,
      finiteNumber(timing.proof_by_ms) === null ||
        Number(timing.proof_by_ms) > 3000,
      "proof_later_than_3000ms",
    );

    addIf(blockers, sceneCount < 1, "render_scene_inventory_required");
    addIf(
      blockers,
      motionSceneCount < 1 || motionRatio < 0.25,
      "meaningful_motion_ratio_below_0_25",
    );
    addIf(
      blockers,
      exactSubjectMotionCount < 1,
      "exact_subject_motion_missing",
    );
    addIf(
      blockers,
      unrelatedFillerCount > 0,
      "unrelated_visual_filler_present",
    );
    addIf(
      blockers,
      motion.every_scene_rights_accepted !== true,
      "scene_rights_evidence_incomplete",
    );
  }

  const identityReject =
    blockers.includes("renderer_not_active") ||
    blockers.includes("renderer_role_mismatch") ||
    blockers.includes("operating_mode_invalid");
  const experimentalHold = blockers.includes(
    "experimental_renderer_not_publishable",
  );
  let verdict = "PASS";
  if (identityReject) verdict = "REJECT";
  else if (experimentalHold || blockers.length > 0) verdict = "HOLD";

  if (mode === "LOCAL_PROOF" && verdict === "PASS") {
    warnings.push("local_proof_not_publish_authority");
  }

  const publishable =
    verdict === "PASS" &&
    registered?.publishEligible === true &&
    PUBLISH_AUTHORITY_MODES.has(mode);

  return {
    schema_version: "pulse-renderer-governance-v1",
    operating_mode: mode,
    verdict,
    publishable,
    renderer: {
      id: renderer.id || null,
      role: renderer.role || null,
      version: renderer.version || null,
    },
    blockers: [...new Set(blockers)],
    warnings,
    evidence: {
      exact_subject_clip_count: exactClipCount,
      exact_subject_still_motion_count: exactStillMotionCount,
      exact_subject_motion_count: exactSubjectMotionCount,
      scene_count: sceneCount,
      motion_scene_count: motionSceneCount,
      motion_ratio: motionRatio,
      unrelated_filler_count: unrelatedFillerCount,
      first_frame_exact_subject:
        timing.first_frame_exact_subject === true,
      hook_visible_by_ms: finiteNumber(timing.hook_visible_by_ms),
      consequence_by_ms: finiteNumber(timing.consequence_by_ms),
      proof_by_ms: finiteNumber(timing.proof_by_ms),
      hyperframes_used: stack.hyperframes === true,
      ffmpeg_used: stack.ffmpeg === true,
      ffprobe_passed: output.ffprobe_passed === true,
    },
    manifest_sha256: fingerprintRendererManifest(input),
  };
}

module.exports = {
  ACTIVE_RENDERERS,
  EXPERIMENTAL_RENDERER_ID,
  STANDARD_RENDERER_ID,
  evaluateRendererManifest,
  fingerprintRendererManifest,
};
