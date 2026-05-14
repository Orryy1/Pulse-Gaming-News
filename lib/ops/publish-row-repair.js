"use strict";

const { hasScriptValidationFailure } = require("../services/discord-post-gate");
const { platformsForStory } = require("./publish-cadence");

function truthy(value) {
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}

function shortTitle(title, len = 96) {
  const value = String(title || "(untitled)").replace(/\s+/g, " ").trim();
  return value.length > len ? `${value.slice(0, len - 1)}...` : value;
}

function publishedAt(story = {}) {
  return (
    story.published_at ||
    story.youtube_published_at ||
    story.instagram_published_at ||
    story.facebook_published_at ||
    story.updated_at ||
    null
  );
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildInspectionSql(ids = []) {
  const safeIds = [...new Set(ids.filter(Boolean).map(String))];
  if (!safeIds.length) return null;
  return [
    "SELECT id, title, publish_status, qa_failed, publish_error,",
    "       youtube_post_id, instagram_media_id, facebook_post_id,",
    "       published_at, discord_video_drop_posted_at",
    "FROM stories",
    `WHERE id IN (${safeIds.map(sqlQuote).join(", ")});`,
  ].join("\n");
}

function classifyPublishRowIssue(story = {}) {
  const platforms = platformsForStory(story);
  const failed =
    String(story.publish_status || "").toLowerCase() === "failed" ||
    truthy(story.qa_failed);
  const publicRow = platforms.length > 0 && Boolean(publishedAt(story));
  const scriptFallback = hasScriptValidationFailure(story);

  const issues = [];
  if (failed && platforms.length > 0) issues.push("failed_row_with_platform_ids");
  if (publicRow && scriptFallback) issues.push("public_script_validation_fallback");
  if (!issues.length) return null;

  const severity = issues.includes("public_script_validation_fallback")
    ? "red"
    : "amber";
  const recommendedAction = issues.includes("public_script_validation_fallback")
    ? "manual_review_then_mark_not_clean_public_publish"
    : "manual_review_partial_platform_state";

  return {
    story_id: story.id || null,
    title: story.title || "(untitled)",
    severity,
    issues,
    platforms,
    published_at: publishedAt(story),
    publish_status: story.publish_status || null,
    qa_failed: truthy(story.qa_failed),
    publish_error: story.publish_error || null,
    script_review_reason: story.script_review_reason || null,
    recommended_action: recommendedAction,
    apply_status: "blocked_until_operator_approves_db_mutation",
    safety_note:
      "Dry-run only. Do not clear platform IDs or rewrite status until the public posts have been manually checked.",
  };
}

function buildPublishRowRepairPlan({
  stories = [],
  now = new Date().toISOString(),
  limit = 50,
} = {}) {
  const rows = (stories || [])
    .map(classifyPublishRowIssue)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "red" ? -1 : 1;
      return String(b.published_at || "").localeCompare(String(a.published_at || ""));
    })
    .slice(0, Math.max(1, Number(limit) || 50));

  const ids = rows.map((row) => row.story_id).filter(Boolean);
  const summary = {
    inspected_stories: stories.length,
    repair_candidates: rows.length,
    red_public_script_fallback: rows.filter((row) =>
      row.issues.includes("public_script_validation_fallback"),
    ).length,
    amber_failed_rows_with_platform_ids: rows.filter((row) =>
      row.issues.includes("failed_row_with_platform_ids"),
    ).length,
  };

  return {
    mode: "dry_run_no_db_mutation",
    generated_at: now,
    summary,
    rows,
    inspection_sql: buildInspectionSql(ids),
    blocked_apply_reason:
      "Repairing these rows changes production history. Take a DB backup and approve a targeted mutation before applying any update.",
    recommended_next_steps: [
      "Inspect each public platform post for the red rows.",
      "For script-validation fallback rows, decide whether to keep the public post, remake it or hide/delete it manually on-platform.",
      "Only after review, apply a targeted DB repair that marks bad rows as QA-failed or partial without losing real platform IDs.",
      "Keep the publish cadence and cooldown gates warn-only until the live scheduler policy is deliberately promoted.",
    ],
  };
}

function formatPublishRowRepairMarkdown(plan = {}) {
  const lines = [];
  lines.push("# Publish Row Repair Plan");
  lines.push("");
  lines.push(`Mode: ${plan.mode || "dry_run_no_db_mutation"}`);
  lines.push(`Generated: ${plan.generated_at || new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Inspected stories: ${plan.summary?.inspected_stories || 0}`);
  lines.push(`- Repair candidates: ${plan.summary?.repair_candidates || 0}`);
  lines.push(
    `- Public script-validation fallback rows: ${plan.summary?.red_public_script_fallback || 0}`,
  );
  lines.push(
    `- Failed rows carrying platform IDs: ${plan.summary?.amber_failed_rows_with_platform_ids || 0}`,
  );
  lines.push("");
  lines.push("## Safety");
  lines.push("- Dry-run only: this command never mutates the database.");
  lines.push("- Apply mode is blocked until a targeted production DB repair is approved.");
  lines.push(`- ${plan.blocked_apply_reason || "Dry-run only."}`);

  lines.push("");
  lines.push("## Candidate Rows");
  if (plan.rows?.length) {
    lines.push("| Severity | Story | Issues | Platforms | Action |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of plan.rows) {
      lines.push(
        `| ${row.severity.toUpperCase()} | ${row.story_id}: ${shortTitle(row.title, 72)} | ${row.issues.join(", ")} | ${row.platforms.join(", ") || "none"} | ${row.recommended_action} |`,
      );
    }
  } else {
    lines.push("- No inconsistent public/failed publish rows found.");
  }

  if (plan.inspection_sql) {
    lines.push("");
    lines.push("## Inspection SQL");
    lines.push("Read-only check before any repair:");
    lines.push("");
    lines.push("```sql");
    lines.push(plan.inspection_sql);
    lines.push("```");
  }

  if (plan.recommended_next_steps?.length) {
    lines.push("");
    lines.push("## Recommended Next Steps");
    for (const step of plan.recommended_next_steps) lines.push(`- ${step}`);
  }

  return lines.join("\n");
}

async function buildPublishRowRepairPlanFromDb(opts = {}) {
  const db = require("../db");
  const stories =
    typeof db.getStoriesSync === "function" ? db.getStoriesSync() : await db.getStories();
  return buildPublishRowRepairPlan({ ...opts, stories });
}

module.exports = {
  buildInspectionSql,
  buildPublishRowRepairPlan,
  buildPublishRowRepairPlanFromDb,
  classifyPublishRowIssue,
  formatPublishRowRepairMarkdown,
};
