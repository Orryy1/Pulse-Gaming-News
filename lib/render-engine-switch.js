"use strict";

const ENGINE_LEGACY = "legacy";
const ENGINE_STUDIO_V21 = "studio-v21";

const STUDIO_V21_ALIASES = new Set([
  "studio-v21",
  "studio_v21",
  "v21",
  "studio-v2.1",
  "studio_v2.1",
]);

function truthy(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function falsey(value) {
  return value === false || /^(false|0|no|off)$/i.test(String(value || ""));
}

function normaliseEngine(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === ENGINE_LEGACY) return ENGINE_LEGACY;
  if (STUDIO_V21_ALIASES.has(raw)) return ENGINE_STUDIO_V21;
  return null;
}

function isStudioV21Engine(value) {
  return normaliseEngine(value) === ENGINE_STUDIO_V21;
}

function resolveRenderEngine(env = process.env) {
  const requested = String(env.RENDER_ENGINE || ENGINE_LEGACY).trim();
  const normalised = normaliseEngine(requested);
  const warnings = [];
  const engine = normalised || ENGINE_LEGACY;
  if (!normalised) warnings.push(`unknown_render_engine:${requested}`);

  const useStudioV21 = engine === ENGINE_STUDIO_V21;
  const allowAutopublish = truthy(env.STUDIO_V21_ALLOW_AUTOPUBLISH);
  const reviewDisabled = falsey(env.STUDIO_V21_HUMAN_REVIEW_REQUIRED);
  const studioV21AutopublishAllowed =
    useStudioV21 && allowAutopublish && reviewDisabled;
  const humanVisualReviewRequired =
    useStudioV21 && !studioV21AutopublishAllowed;

  return {
    requested: requested || ENGINE_LEGACY,
    engine,
    useStudioV21,
    studioV21AutopublishAllowed,
    humanVisualReviewRequired,
    reviewStatusDefault: humanVisualReviewRequired ? "pending" : "approved",
    warnings,
  };
}

function reviewStatus(story) {
  return String(
    (story && (story.render_review_status || story.studio_v21_review_status)) ||
      "",
  )
    .trim()
    .toLowerCase();
}

function humanReviewGateForStory(story, env = process.env) {
  if (!story || typeof story !== "object") return { blocked: false };
  const cfg = resolveRenderEngine(env);
  const status = reviewStatus(story);
  if (status === "approved") return { blocked: false };

  const explicitHold =
    story.human_visual_review_required === true ||
    truthy(story.human_visual_review_required);
  const studioV21Story = isStudioV21Engine(story.render_engine);
  const engineRequiresReview = studioV21Story && cfg.humanVisualReviewRequired;

  if (explicitHold || engineRequiresReview) {
    return {
      blocked: true,
      reason: "human_visual_review_required:studio-v21",
      status: status || "pending",
    };
  }
  return { blocked: false };
}

function buildStudioV21ReviewMetadata({
  candidatePath,
  reportPath,
  gatePath,
  gateVerdict,
  generatedAt,
} = {}) {
  return {
    render_engine: ENGINE_STUDIO_V21,
    studio_v21_candidate_path: candidatePath || null,
    studio_v21_report_path: reportPath || null,
    studio_v21_gate_path: gatePath || null,
    studio_v21_gate_verdict: gateVerdict || null,
    human_visual_review_required: true,
    render_review_status: "pending",
    render_review_created_at: generatedAt || new Date().toISOString(),
    publish_hold_reason: "studio_v21_human_visual_review_required",
  };
}

module.exports = {
  ENGINE_LEGACY,
  ENGINE_STUDIO_V21,
  resolveRenderEngine,
  isStudioV21Engine,
  humanReviewGateForStory,
  buildStudioV21ReviewMetadata,
};
