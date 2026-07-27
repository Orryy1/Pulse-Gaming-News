"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveRenderEngine,
  humanReviewGateForStory,
  buildStudioV21ReviewMetadata,
} = require("../../lib/render-engine-switch");

test("resolveRenderEngine: defaults to the governed Studio v2.1 standard renderer", () => {
  const cfg = resolveRenderEngine({});
  assert.equal(cfg.engine, "studio-v21");
  assert.equal(cfg.role, "standard");
  assert.equal(cfg.useStudioV21, true);
  assert.equal(cfg.humanVisualReviewRequired, true);
  assert.equal(cfg.publishEligible, true);
  assert.equal(cfg.blocked, false);
  assert.deepEqual(cfg.warnings, []);
});

test("resolveRenderEngine: studio-v21 is review-only by default", () => {
  const cfg = resolveRenderEngine({ RENDER_ENGINE: "studio-v21" });
  assert.equal(cfg.engine, "studio-v21");
  assert.equal(cfg.useStudioV21, true);
  assert.equal(cfg.humanVisualReviewRequired, true);
  assert.equal(cfg.reviewStatusDefault, "pending");
});

test("resolveRenderEngine: legacy autopublish flags cannot bypass human review", () => {
  const stillHeld = resolveRenderEngine({
    RENDER_ENGINE: "studio-v21",
    STUDIO_V21_ALLOW_AUTOPUBLISH: "true",
  });
  assert.equal(stillHeld.humanVisualReviewRequired, true);

  const stillHeldWithBothLegacyFlags = resolveRenderEngine({
    RENDER_ENGINE: "studio-v21",
    STUDIO_V21_ALLOW_AUTOPUBLISH: "true",
    STUDIO_V21_HUMAN_REVIEW_REQUIRED: "false",
  });
  assert.equal(stillHeldWithBothLegacyFlags.humanVisualReviewRequired, true);
  assert.equal(stillHeldWithBothLegacyFlags.studioV21AutopublishAllowed, false);
});

test("resolveRenderEngine: unknown identities fail closed without a fallback", () => {
  const cfg = resolveRenderEngine({ RENDER_ENGINE: "experimental" });
  assert.equal(cfg.engine, null);
  assert.equal(cfg.role, null);
  assert.equal(cfg.useStudioV21, false);
  assert.equal(cfg.publishEligible, false);
  assert.equal(cfg.blocked, true);
  assert.equal(cfg.reason, "renderer_not_active:experimental");
  assert.equal(cfg.reviewStatusDefault, "blocked");
  assert.ok(cfg.warnings.includes("unknown_render_engine:experimental"));
});

test("resolveRenderEngine: deprecated Studio aliases cannot enter the active graph", () => {
  for (const alias of ["studio_v21", "v21", "studio-v2.1", "studio_v2.1"]) {
    const cfg = resolveRenderEngine({ RENDER_ENGINE: alias });
    assert.equal(cfg.engine, null);
    assert.equal(cfg.blocked, true);
    assert.equal(cfg.reason, `renderer_not_active:${alias}`);
  }
});

test("resolveRenderEngine: legacy is explicit migration-only state", () => {
  const cfg = resolveRenderEngine({ RENDER_ENGINE: "legacy" });
  assert.equal(cfg.engine, "legacy");
  assert.equal(cfg.role, "migration");
  assert.equal(cfg.migrationOnly, true);
  assert.equal(cfg.publishEligible, false);
  assert.equal(cfg.blocked, true);
  assert.equal(cfg.reason, "legacy_renderer_migration_only");
  assert.equal(cfg.reviewStatusDefault, "blocked");
});

test("resolveRenderEngine: HyperFrames Next remains experimental and review-held", () => {
  const cfg = resolveRenderEngine({ RENDER_ENGINE: "hyperframes-next" });
  assert.equal(cfg.engine, "hyperframes-next");
  assert.equal(cfg.role, "experimental");
  assert.equal(cfg.useExperimental, true);
  assert.equal(cfg.publishEligible, false);
  assert.equal(cfg.blocked, true);
  assert.equal(cfg.humanVisualReviewRequired, true);
  assert.equal(cfg.reason, "experimental_renderer_review_only");
});

test("humanReviewGateForStory: blocks pending Studio v2.1 stories", () => {
  const gate = humanReviewGateForStory(
    { render_engine: "studio-v21", render_review_status: "pending" },
    { RENDER_ENGINE: "studio-v21" },
  );
  assert.equal(gate.blocked, true);
  assert.equal(gate.reason, "human_visual_review_required:studio-v21");
});

test("humanReviewGateForStory: renderer review cannot be bypassed by active-engine configuration", () => {
  const gate = humanReviewGateForStory(
    { render_engine: "studio-v21", render_review_status: "pending" },
    {
      RENDER_ENGINE: "legacy",
      STUDIO_V21_ALLOW_AUTOPUBLISH: "true",
      STUDIO_V21_HUMAN_REVIEW_REQUIRED: "false",
    },
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

test("humanReviewGateForStory: never releases experimental or unknown renderers", () => {
  const experimental = humanReviewGateForStory(
    {
      render_engine: "hyperframes-next",
      render_review_status: "approved",
    },
    { RENDER_ENGINE: "studio-v21" },
  );
  assert.deepEqual(experimental, {
    blocked: true,
    reason: "experimental_renderer_not_publishable",
    status: "approved",
  });

  const unknown = humanReviewGateForStory(
    { render_engine: "invented-renderer", render_review_status: "approved" },
    { RENDER_ENGINE: "studio-v21" },
  );
  assert.deepEqual(unknown, {
    blocked: true,
    reason: "renderer_not_active:invented-renderer",
    status: "approved",
  });
});

test("buildStudioV21ReviewMetadata: stamps governed candidate review fields", () => {
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
