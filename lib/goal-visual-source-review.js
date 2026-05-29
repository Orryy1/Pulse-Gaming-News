"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const REJECT_DECISION = "reject_visually_unsupported_candidate";
const DEFER_DECISION = "defer_until_rights_backed_media_available";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function visualSourceAction(action = {}) {
  const id = clean(action.action_id);
  const lane = clean(action.repair_lane);
  return (
    id === "materialise_validated_real_motion_clips" ||
    id === "repair_public_output_coherence" ||
    /real_visual_media|required_after_owned_explainer|official_direct_media|non_news_image_post|visual/i.test(lane)
  );
}

function visualSourceBlocker(blocker = "") {
  return /visual_evidence|generated_only_motion|no_real_visual|direct_video_motion|actual_motion_clip|distinct_motion_families|non_news_image_post|source_label_consistency/i.test(clean(blocker));
}

function reviewForJob(job = {}, { generatedAt = new Date().toISOString() } = {}) {
  const storyId = clean(job.story_id);
  const artifactDir = clean(job.artifact_dir);
  if (!storyId || !artifactDir) return null;
  const status = clean(job.status);
  if (status && !/blocked|operator_required|reject|defer/i.test(status)) return null;
  const actions = asArray(job.actions).filter(visualSourceAction);
  const blockers = asArray(job.blockers).map(clean).filter(Boolean);
  if (!actions.length && !blockers.some(visualSourceBlocker)) return null;
  const reject = actions.some((action) => action.dead_end_blocker === true || /reject/i.test(clean(action.repair_lane)));
  const decision = reject ? REJECT_DECISION : DEFER_DECISION;
  return {
    schema_version: 1,
    story_id: storyId,
    generated_at: generatedAt,
    decision,
    reason:
      decision === REJECT_DECISION
        ? "story lacks a usable primary source or rights-backed visual plan"
        : "rights-backed real visual media is not available yet",
    visual_source_blockers: blockers.filter(visualSourceBlocker),
    source_policy:
      "Do not publish generated-only or visually unsupported stories. Use official, licensed or owned media with rights evidence.",
    next_allowed_routes: [
      "operator_supplies_rights_backed_media",
      "official_direct_media_source_added",
      "source_backed_story_reworked_with_real_visual_plan",
    ],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildVisualSourceReviewReport({
  workOrder = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const jobs = asArray(workOrder.jobs);
  const reviews = jobs
    .map((job) => {
      const review = reviewForJob(job, { generatedAt });
      if (!review) return null;
      return {
        story_id: review.story_id,
        artifact_dir: clean(job.artifact_dir),
        review_path: path.join(clean(job.artifact_dir), "visual_source_review.json"),
        review,
      };
    })
    .filter(Boolean);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "VISUAL_SOURCE_REVIEW",
    summary: {
      work_order_job_count: jobs.length,
      visual_source_review_count: reviews.length,
      reject_count: reviews.filter((item) => item.review.decision === REJECT_DECISION).length,
      defer_count: reviews.filter((item) => item.review.decision === DEFER_DECISION).length,
    },
    reviews,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function renderVisualSourceReviewMarkdown(report = {}) {
  const lines = [];
  lines.push("# Visual Source Review");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Reviews written: ${report.summary?.visual_source_review_count || 0}`);
  lines.push(`Reject: ${report.summary?.reject_count || 0}`);
  lines.push(`Defer: ${report.summary?.defer_count || 0}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- No publish API calls are made.");
  lines.push("- No database rows are mutated.");
  lines.push("- No OAuth or token settings are changed.");
  lines.push("");
  if (asArray(report.reviews).length) {
    lines.push("## Stories");
    for (const item of asArray(report.reviews)) {
      lines.push(`- ${item.story_id}: ${item.review.decision}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function writeVisualSourceReviewReport({
  workOrder,
  outputDir = "output/goal-contract",
  generatedAt = new Date().toISOString(),
} = {}) {
  const report = buildVisualSourceReviewReport({ workOrder, generatedAt });
  for (const item of report.reviews) {
    await fs.ensureDir(path.dirname(item.review_path));
    await fs.writeJson(item.review_path, item.review, { spaces: 2 });
  }
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "visual_source_review_report.json");
  const markdownPath = path.join(outDir, "visual_source_review_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderVisualSourceReviewMarkdown(report), "utf8");
  return { report, jsonPath, markdownPath };
}

module.exports = {
  REJECT_DECISION,
  DEFER_DECISION,
  buildVisualSourceReviewReport,
  writeVisualSourceReviewReport,
};
