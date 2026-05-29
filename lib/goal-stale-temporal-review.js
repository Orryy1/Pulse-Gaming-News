"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const DEFAULT_DECISION = "reject_stale_current_news_candidate";
const ALLOWED_DECISIONS = new Set([
  "reject_stale_current_news_candidate",
  "defer_until_new_source_updates_story",
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasStaleTemporalBlocker(story = {}) {
  const blockers = asArray(story.blockers).map(clean);
  return blockers.some((blocker) =>
    blocker === "incident:stale_temporal_claim" ||
    blocker === "incident:current_wording_on_old_event" ||
    blocker.includes("incident_guard:incident:stale_temporal_claim") ||
    blocker.includes("incident_guard:incident:current_wording_on_old_event"),
  );
}

function reviewForHeldStory(story = {}, { decision = DEFAULT_DECISION, generatedAt = new Date().toISOString() } = {}) {
  const storyId = clean(story.story_id);
  const artifactDir = clean(story.artifact_dir);
  if (!storyId || !artifactDir) return null;
  if (!hasStaleTemporalBlocker(story)) return null;
  if (!ALLOWED_DECISIONS.has(decision)) {
    throw new Error(`unsupported_stale_temporal_decision:${decision}`);
  }
  const blockers = asArray(story.blockers).map(clean).filter(Boolean);
  return {
    schema_version: 1,
    story_id: storyId,
    generated_at: generatedAt,
    decision,
    reason:
      decision === "reject_stale_current_news_candidate"
        ? "current-news wording relies on an old dated event"
        : "story needs a fresh source update before it can return to production",
    incident_blockers: blockers.filter((blocker) =>
      /stale_temporal|current_wording_on_old_event/i.test(blocker),
    ),
    source_policy:
      "Do not publish stale dated claims as current news. Use a new source update or a source-backed evergreen reframe.",
    next_allowed_routes: [
      "new_source_updates_story",
      "source_backed_evergreen_reframe",
      "human_editor_revives_with_fresh_context",
    ],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildStaleTemporalReviewReport({
  dryRunPlan = {},
  decision = DEFAULT_DECISION,
  generatedAt = new Date().toISOString(),
} = {}) {
  const heldStories = asArray(dryRunPlan.held_stories);
  const reviews = heldStories
    .map((story) => {
      const review = reviewForHeldStory(story, { decision, generatedAt });
      if (!review) return null;
      return {
        story_id: review.story_id,
        artifact_dir: clean(story.artifact_dir),
        review_path: path.join(clean(story.artifact_dir), "stale_temporal_review.json"),
        review,
      };
    })
    .filter(Boolean);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "STALE_TEMPORAL_REVIEW",
    decision,
    summary: {
      held_story_count: heldStories.length,
      stale_temporal_review_count: reviews.length,
      skipped_non_stale_held_count: Math.max(0, heldStories.length - reviews.length),
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

function renderStaleTemporalReviewMarkdown(report = {}) {
  const lines = [];
  lines.push("# Stale Temporal Review");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Decision: ${report.decision || DEFAULT_DECISION}`);
  lines.push(`Reviews written: ${report.summary?.stale_temporal_review_count || 0}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- No publish API calls are made.");
  lines.push("- No database rows are mutated.");
  lines.push("- No OAuth or token settings are changed.");
  lines.push("");
  if (asArray(report.reviews).length) {
    lines.push("## Stories");
    for (const item of asArray(report.reviews)) {
      lines.push(`- ${item.story_id}: ${item.review_path}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function writeStaleTemporalReviewReport({
  dryRunPlan,
  outputDir = "output/goal-contract",
  decision = DEFAULT_DECISION,
  generatedAt = new Date().toISOString(),
} = {}) {
  const report = buildStaleTemporalReviewReport({ dryRunPlan, decision, generatedAt });
  for (const item of report.reviews) {
    await fs.ensureDir(path.dirname(item.review_path));
    await fs.writeJson(item.review_path, item.review, { spaces: 2 });
  }
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "stale_temporal_review_report.json");
  const markdownPath = path.join(outDir, "stale_temporal_review_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderStaleTemporalReviewMarkdown(report), "utf8");
  return { report, jsonPath, markdownPath };
}

module.exports = {
  DEFAULT_DECISION,
  buildStaleTemporalReviewReport,
  writeStaleTemporalReviewReport,
  hasStaleTemporalBlocker,
};
