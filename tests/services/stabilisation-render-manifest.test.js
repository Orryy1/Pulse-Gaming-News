"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStandardRendererManifest,
  createRendererEvidence,
} = require("../../lib/stabilisation/render-manifest");
const {
  STANDARD_RENDERER_ID,
} = require("../../lib/stabilisation/renderer-governance");

function passingPlatformQa() {
  return {
    result: "pass",
    failures: [],
    warnings: [],
    technical: {
      video_codec: "h264",
      video_profile: "High",
      pixel_format: "yuv420p",
      width: 1080,
      height: 1920,
      audio_codec: "aac",
      audio_sample_rate_hz: 48000,
      has_audio: true,
      duration_seconds: 31.4,
      ffprobe_passed: true,
    },
  };
}

function evidenceInput(overrides = {}) {
  return {
    story: {
      id: "manifest-story",
      channel_id: "pulse-gaming",
    },
    rendererVersion: "2.1.0",
    mediaSha256: "b".repeat(64),
    platformVideoQa: passingPlatformQa(),
    stack: {
      hyperframes: true,
      ffmpeg: true,
    },
    timing: {
      first_frame_exact_subject: true,
      first_frame_text: "A TANK WITH TWO SHIELDS",
      hook_visible_by_ms: 200,
      consequence_by_ms: 1100,
      proof_by_ms: 2600,
    },
    motion: {
      scene_count: 7,
      motion_scene_count: 3,
      exact_subject_clip_count: 2,
      exact_subject_still_motion_count: 0,
      unrelated_filler_count: 0,
      every_scene_rights_accepted: true,
    },
    ...overrides,
  };
}

test("standard manifest bridges verified media metadata without weakening it", () => {
  const manifest = buildStandardRendererManifest(evidenceInput());
  assert.equal(manifest.renderer.id, STANDARD_RENDERER_ID);
  assert.equal(manifest.renderer.role, "standard");
  assert.equal(manifest.output.sha256, "b".repeat(64));
  assert.equal(manifest.output.width, 1080);
  assert.equal(manifest.output.height, 1920);
  assert.equal(manifest.output.aspect_ratio, "9:16");
  assert.equal(manifest.output.platform_video_qa_result, "pass");
  assert.equal(
    manifest.timing.first_frame_text,
    "A TANK WITH TWO SHIELDS",
  );
  assert.equal(manifest.motion.exact_subject_clip_count, 2);
});

test("standard manifest does not invent stack, timing, motion or rights evidence", () => {
  const manifest = buildStandardRendererManifest({
    story: { id: "thin", channel_id: "pulse-gaming" },
    rendererVersion: "2.1.0",
    mediaSha256: "c".repeat(64),
    platformVideoQa: passingPlatformQa(),
  });
  assert.equal(manifest.stack.hyperframes, null);
  assert.equal(manifest.stack.ffmpeg, null);
  assert.equal(manifest.timing.first_frame_exact_subject, null);
  assert.equal(manifest.timing.first_frame_text, null);
  assert.equal(manifest.timing.hook_visible_by_ms, null);
  assert.equal(manifest.motion.scene_count, null);
  assert.equal(manifest.motion.exact_subject_clip_count, null);
  assert.equal(manifest.motion.every_scene_rights_accepted, null);

  const evidence = createRendererEvidence({
    story: { id: "thin", channel_id: "pulse-gaming" },
    rendererVersion: "2.1.0",
    mediaSha256: "c".repeat(64),
    platformVideoQa: passingPlatformQa(),
    operatingMode: "HUMAN_REVIEW",
  });
  assert.equal(evidence.evaluation.verdict, "HOLD");
  assert.ok(
    evidence.evaluation.blockers.includes("exact_subject_motion_missing"),
  );
  assert.ok(
    evidence.evaluation.blockers.includes(
      "first_frame_exact_subject_required",
    ),
  );
});

test("renderer evidence recomputes the governed verdict and binds its hash", () => {
  const evidence = createRendererEvidence({
    ...evidenceInput(),
    operatingMode: "HUMAN_REVIEW",
    generatedAt: "2026-07-27T06:00:00.000Z",
  });
  assert.equal(evidence.generated_at, "2026-07-27T06:00:00.000Z");
  assert.equal(evidence.evaluation.verdict, "PASS");
  assert.equal(evidence.evaluation.publishable, true);
  assert.equal(
    evidence.manifest_sha256,
    evidence.evaluation.manifest_sha256,
  );
});

test("failed or unavailable platform QA cannot become renderer proof", () => {
  const failed = createRendererEvidence({
    ...evidenceInput({
      platformVideoQa: {
        ...passingPlatformQa(),
        result: "fail",
        failures: ["video_codec_not_h264"],
      },
    }),
    operatingMode: "HUMAN_REVIEW",
  });
  assert.equal(failed.evaluation.verdict, "HOLD");
  assert.ok(
    failed.evaluation.blockers.includes(
      "platform_video_qa_must_pass",
    ),
  );
});
