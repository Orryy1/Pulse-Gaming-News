"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIVE_RENDERERS,
  EXPERIMENTAL_RENDERER_ID,
  STANDARD_RENDERER_ID,
  evaluateRendererManifest,
  fingerprintRendererManifest,
} = require("../../lib/stabilisation/renderer-governance");

function standardManifest(overrides = {}) {
  const base = {
    schema_version: "pulse-render-manifest-v1",
    story_id: "story-render-1",
    channel_id: "pulse-gaming",
    renderer: {
      id: STANDARD_RENDERER_ID,
      role: "standard",
      version: "2.1.0",
    },
    stack: {
      hyperframes: true,
      ffmpeg: true,
    },
    output: {
      sha256: "a".repeat(64),
      width: 1080,
      height: 1920,
      aspect_ratio: "9:16",
      video_codec: "h264",
      audio_codec: "aac",
      audio_sample_rate_hz: 48000,
      has_audio: true,
      duration_seconds: 37.2,
      ffprobe_passed: true,
      platform_video_qa_result: "pass",
    },
    timing: {
      first_frame_exact_subject: true,
      hook_visible_by_ms: 250,
      consequence_by_ms: 1200,
      proof_by_ms: 2800,
    },
    motion: {
      scene_count: 8,
      motion_scene_count: 4,
      exact_subject_clip_count: 2,
      exact_subject_still_motion_count: 1,
      unrelated_filler_count: 0,
      every_scene_rights_accepted: true,
    },
  };
  return {
    ...base,
    ...overrides,
    renderer: { ...base.renderer, ...(overrides.renderer || {}) },
    stack: { ...base.stack, ...(overrides.stack || {}) },
    output: { ...base.output, ...(overrides.output || {}) },
    timing: { ...base.timing, ...(overrides.timing || {}) },
    motion: { ...base.motion, ...(overrides.motion || {}) },
  };
}

test("renderer registry exposes exactly one standard and one experimental renderer", () => {
  assert.deepEqual(
    ACTIVE_RENDERERS.map(({ id, role }) => ({ id, role })),
    [
      { id: STANDARD_RENDERER_ID, role: "standard" },
      { id: EXPERIMENTAL_RENDERER_ID, role: "experimental" },
    ],
  );
});

test("a governed standard render passes in HUMAN_REVIEW", () => {
  const result = evaluateRendererManifest(standardManifest(), {
    operatingMode: "HUMAN_REVIEW",
  });
  assert.equal(result.verdict, "PASS");
  assert.equal(result.publishable, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.evidence.exact_subject_motion_count, 3);
  assert.equal(result.evidence.motion_ratio, 0.5);
  assert.match(result.manifest_sha256, /^[a-f0-9]{64}$/);
});

test("LOCAL_PROOF can prove the renderer contract but cannot authorise publishing", () => {
  const result = evaluateRendererManifest(standardManifest(), {
    operatingMode: "LOCAL_PROOF",
  });
  assert.equal(result.verdict, "PASS");
  assert.equal(result.publishable, false);
  assert.ok(result.warnings.includes("local_proof_not_publish_authority"));
});

test("the experimental renderer is always held out of publication", () => {
  const result = evaluateRendererManifest(
    standardManifest({
      renderer: {
        id: EXPERIMENTAL_RENDERER_ID,
        role: "experimental",
        version: "0.1.0",
      },
    }),
    { operatingMode: "HUMAN_REVIEW" },
  );
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.publishable, false);
  assert.ok(result.blockers.includes("experimental_renderer_not_publishable"));
});

test("legacy and unknown renderers are outside the active dependency graph", () => {
  for (const id of ["legacy", "studio-v2", "studio-v3", "studio-v4"]) {
    const result = evaluateRendererManifest(
      standardManifest({ renderer: { id, role: "standard" } }),
      { operatingMode: "HUMAN_REVIEW" },
    );
    assert.equal(result.verdict, "REJECT");
    assert.ok(result.blockers.includes("renderer_not_active"));
  }
});

test("exact-subject motion is mandatory and unrelated filler is forbidden", () => {
  const noExactMotion = evaluateRendererManifest(
    standardManifest({
      motion: {
        exact_subject_clip_count: 0,
        exact_subject_still_motion_count: 0,
      },
    }),
    { operatingMode: "HUMAN_REVIEW" },
  );
  assert.ok(noExactMotion.blockers.includes("exact_subject_motion_missing"));

  const filler = evaluateRendererManifest(
    standardManifest({ motion: { unrelated_filler_count: 1 } }),
    { operatingMode: "HUMAN_REVIEW" },
  );
  assert.ok(filler.blockers.includes("unrelated_visual_filler_present"));
});

test("meaningfully animated exact-subject stills may satisfy the motion floor", () => {
  const result = evaluateRendererManifest(
    standardManifest({
      motion: {
        exact_subject_clip_count: 0,
        exact_subject_still_motion_count: 2,
      },
    }),
    { operatingMode: "HUMAN_REVIEW" },
  );
  assert.equal(result.verdict, "PASS");
});

test("first-frame and first-three-second timing are hard renderer gates", () => {
  const result = evaluateRendererManifest(
    standardManifest({
      timing: {
        first_frame_exact_subject: false,
        hook_visible_by_ms: 600,
        consequence_by_ms: 1800,
        proof_by_ms: 3400,
      },
    }),
    { operatingMode: "HUMAN_REVIEW" },
  );
  assert.ok(result.blockers.includes("first_frame_exact_subject_required"));
  assert.ok(result.blockers.includes("hook_later_than_500ms"));
  assert.ok(result.blockers.includes("consequence_later_than_1500ms"));
  assert.ok(result.blockers.includes("proof_later_than_3000ms"));
});

test("the flagship technical profile and approved stack fail closed", () => {
  const result = evaluateRendererManifest(
    standardManifest({
      stack: { hyperframes: false },
      output: {
        width: 720,
        video_codec: "vp9",
        audio_sample_rate_hz: 44100,
        ffprobe_passed: false,
      },
      motion: { every_scene_rights_accepted: false },
    }),
    { operatingMode: "HUMAN_REVIEW" },
  );
  assert.ok(result.blockers.includes("hyperframes_required"));
  assert.ok(result.blockers.includes("output_dimensions_must_be_1080x1920"));
  assert.ok(result.blockers.includes("video_codec_must_be_h264"));
  assert.ok(result.blockers.includes("audio_sample_rate_must_be_48000"));
  assert.ok(result.blockers.includes("ffprobe_verification_required"));
  assert.ok(result.blockers.includes("scene_rights_evidence_incomplete"));
});

test("renderer identity cannot spoof another role", () => {
  const result = evaluateRendererManifest(
    standardManifest({ renderer: { role: "experimental" } }),
    { operatingMode: "HUMAN_REVIEW" },
  );
  assert.equal(result.verdict, "REJECT");
  assert.ok(result.blockers.includes("renderer_role_mismatch"));
});

test("manifest fingerprints are canonical and content-sensitive", () => {
  const original = standardManifest();
  const reordered = {
    motion: original.motion,
    timing: original.timing,
    output: original.output,
    stack: original.stack,
    renderer: original.renderer,
    channel_id: original.channel_id,
    story_id: original.story_id,
    schema_version: original.schema_version,
  };
  assert.equal(
    fingerprintRendererManifest(original),
    fingerprintRendererManifest(reordered),
  );
  assert.notEqual(
    fingerprintRendererManifest(original),
    fingerprintRendererManifest(
      standardManifest({ motion: { motion_scene_count: 5 } }),
    ),
  );
});
