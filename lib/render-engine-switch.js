"use strict";

const {
  EXPERIMENTAL_RENDERER_ID,
  STANDARD_RENDERER_ID,
} = require("./stabilisation/renderer-governance");

const ENGINE_LEGACY = "legacy";
const ENGINE_STUDIO_V21 = STANDARD_RENDERER_ID;
const ENGINE_HYPERFRAMES_NEXT = EXPERIMENTAL_RENDERER_ID;

function truthy(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function normaliseEngine(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === ENGINE_STUDIO_V21) return ENGINE_STUDIO_V21;
  if (raw === ENGINE_HYPERFRAMES_NEXT) return ENGINE_HYPERFRAMES_NEXT;
  if (raw === ENGINE_LEGACY) return ENGINE_LEGACY;
  return null;
}

function isStudioV21Engine(value) {
  return normaliseEngine(value) === ENGINE_STUDIO_V21;
}

function resolveRenderEngine(env = process.env) {
  const requested = String(
    env.RENDER_ENGINE || env.PULSE_STANDARD_RENDERER || ENGINE_STUDIO_V21,
  ).trim();
  const normalised = normaliseEngine(requested);
  const warnings = [];
  const engine = normalised;
  if (!normalised) warnings.push(`unknown_render_engine:${requested}`);

  const useStudioV21 = engine === ENGINE_STUDIO_V21;
  const useExperimental = engine === ENGINE_HYPERFRAMES_NEXT;
  const migrationOnly = engine === ENGINE_LEGACY;
  const studioV21AutopublishAllowed = false;
  const humanVisualReviewRequired = useStudioV21 || useExperimental;
  const blocked = !useStudioV21;
  const reason = useExperimental
    ? "experimental_renderer_review_only"
    : migrationOnly
      ? "legacy_renderer_migration_only"
      : !normalised
        ? `renderer_not_active:${requested}`
        : null;

  return {
    requested: requested || ENGINE_STUDIO_V21,
    engine,
    role: useStudioV21
      ? "standard"
      : useExperimental
        ? "experimental"
        : migrationOnly
          ? "migration"
          : null,
    useStudioV21,
    useExperimental,
    migrationOnly,
    publishEligible: useStudioV21,
    blocked,
    reason,
    studioV21AutopublishAllowed,
    humanVisualReviewRequired,
    reviewStatusDefault: humanVisualReviewRequired
      ? "pending"
      : blocked
        ? "blocked"
        : "approved",
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
  const status = reviewStatus(story);
  const requestedStoryEngine = String(story.render_engine || "").trim();
  const storyEngine = normaliseEngine(requestedStoryEngine);

  if (requestedStoryEngine) {
    if (storyEngine === ENGINE_HYPERFRAMES_NEXT) {
      return {
        blocked: true,
        reason: "experimental_renderer_not_publishable",
        status: status || "pending",
      };
    }
    if (storyEngine === ENGINE_LEGACY) {
      return {
        blocked: true,
        reason: "legacy_renderer_migration_only",
        status: status || "pending",
      };
    }
    if (!storyEngine) {
      return {
        blocked: true,
        reason: `renderer_not_active:${requestedStoryEngine}`,
        status: status || "pending",
      };
    }
  }

  if (status === "approved") return { blocked: false };

  const explicitHold =
    story.human_visual_review_required === true ||
    truthy(story.human_visual_review_required);
  const studioV21Story = isStudioV21Engine(story.render_engine);
  const engineRequiresReview = studioV21Story;

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
  ENGINE_HYPERFRAMES_NEXT,
  ENGINE_LEGACY,
  ENGINE_STUDIO_V21,
  resolveRenderEngine,
  isStudioV21Engine,
  humanReviewGateForStory,
  buildStudioV21ReviewMetadata,
};
