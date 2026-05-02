"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveRenderEngine,
  humanReviewGateForStory,
  buildStudioV21ReviewMetadata,
} = require("../../lib/render-engine-switch");

test("resolveRenderEngine: defaults to legacy with no review hold", () => {
  const cfg = resolveRenderEngine({});
  assert.equal(cfg.engine, "legacy");
  assert.equal(cfg.useStudioV21, false);
  assert.equal(cfg.humanVisualReviewRequired, false);
  assert.deepEqual(cfg.warnings, []);
});

test("resolveRenderEngine: studio-v21 is review-only by default", () => {
  const cfg = resolveRenderEngine({ RENDER_ENGINE: "studio_v21" });
  assert.equal(cfg.engine, "studio-v21");
  assert.equal(cfg.useStudioV21, true);
  assert.equal(cfg.humanVisualReviewRequired, true);
  assert.equal(cfg.reviewStatusDefault, "pending");
});

test("resolveRenderEngine: v2.1 autopublish needs both explicit safety latches", () => {
  const stillHeld = resolveRenderEngine({
    RENDER_ENGINE: "studio-v21",
    STUDIO_V21_ALLOW_AUTOPUBLISH: "true",
  });
  assert.equal(stillHeld.humanVisualReviewRequired, true);

  const released = resolveRenderEngine({
    RENDER_ENGINE: "studio-v21",
    STUDIO_V21_ALLOW_AUTOPUBLISH: "true",
    STUDIO_V21_HUMAN_REVIEW_REQUIRED: "false",
  });
  assert.equal(released.humanVisualReviewRequired, false);
});

test("resolveRenderEngine: unknown values fall back to legacy with a warning", () => {
  const cfg = resolveRenderEngine({ RENDER_ENGINE: "experimental" });
  assert.equal(cfg.engine, "legacy");
  assert.equal(cfg.useStudioV21, false);
  assert.ok(cfg.warnings.includes("unknown_render_engine:experimental"));
});

test("humanReviewGateForStory: blocks pending Studio v2.1 stories", () => {
  const gate = humanReviewGateForStory(
    { render_engine: "studio-v21", render_review_status: "pending" },
    { RENDER_ENGINE: "studio-v21" },
  );
  assert.equal(gate.blocked, true);
  assert.equal(gate.reason, "human_visual_review_required:studio-v21");
});

test("humanReviewGateForStory: permits Studio v2.1 after explicit approval", () => {
  const gate = humanReviewGateForStory(
    { render_engine: "studio-v21", render_review_status: "approved" },
    { RENDER_ENGINE: "studio-v21" },
  );
  assert.equal(gate.blocked, false);
});

test("buildStudioV21ReviewMetadata: stamps sidecar candidate fields", () => {
  const metadata = buildStudioV21ReviewMetadata({
    candidatePath: "test/output/studio_v2_story_v21.mp4",
    reportPath: "test/output/story_studio_v2_v21_report.json",
    gatePath: "test/output/story_studio_v21_gate.json",
    gateVerdict: "pass",
  });
  assert.equal(metadata.render_engine, "studio-v21");
  assert.equal(metadata.studio_v21_candidate_path, "test/output/studio_v2_story_v21.mp4");
  assert.equal(metadata.studio_v21_gate_verdict, "pass");
  assert.equal(metadata.human_visual_review_required, true);
  assert.equal(metadata.render_review_status, "pending");
});
