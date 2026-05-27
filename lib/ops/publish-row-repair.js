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

function buildScriptFallbackRepairSql(rows = [], { now = new Date().toISOString() } = {}) {
  const redIds = [...new Set((rows || [])
    .filter((row) => row?.issues?.includes("public_script_validation_fallback"))
    .map((row) => row.story_id)
    .filter(Boolean)
    .map(String))];
  if (!redIds.length) return null;
  const idList = redIds.map(sqlQuote).join(", ");
  const ts = sqlQuote(now);
  return [
    "-- DANGER: production-history repair. Do not run without a fresh DB backup and operator approval.",
    "-- Keeps platform IDs intact; marks script-validation fallback rows as failed/QA-failed so public/reporting gates stop treating them as clean publishes.",
    "BEGIN IMMEDIATE;",
    "UPDATE stories",
    "SET publish_status = 'failed',",
    "    qa_failed = 1,",
    "    publish_error = COALESCE(NULLIF(publish_error, ''), 'script_validation_review_required_public_row_repair'),",
    `    updated_at = ${ts}`,
    `WHERE id IN (${idList})`,
    "  AND (published_at IS NOT NULL OR youtube_published_at IS NOT NULL OR instagram_published_at IS NOT NULL OR facebook_published_at IS NOT NULL)",
    "  AND (youtube_post_id IS NOT NULL OR youtube_url IS NOT NULL OR instagram_media_id IS NOT NULL OR facebook_post_id IS NOT NULL OR tiktok_post_id IS NOT NULL)",
    "  AND (",
    "    hook LIKE '%Script validation failed%'",
    "    OR body LIKE '%Script validation failed%'",
    "    OR full_script LIKE '%Script validation failed%'",
    "    OR tts_script LIKE '%Script validation failed%'",
    "  );",
    "COMMIT;",
  ].join("\n");
}

function classifyPublishRowIssue(story = {}) {
  const platforms = platformsForStory(story);
  const failed =
    String(story.publish_status || "").toLowerCase() === "failed" ||
    truthy(story.qa_failed);
  const publicRow = platforms.length > 0 && Boolean(publishedAt(story));
  const scriptFallback = hasScriptValidationFailure(story);
  const scriptFallbackRepairApplied =
    scriptFallback &&
    failed &&
    String(story.publish_error || "").includes(
      "script_validation_review_required_public_row_repair",
    );

  const issues = [];
  if (failed && platforms.length > 0) issues.push("failed_row_with_platform_ids");
  if (scriptFallbackRepairApplied) issues.push("repaired_script_validation_public_row");
  if (publicRow && scriptFallback && !scriptFallbackRepairApplied) {
    issues.push("public_script_validation_fallback");
  }
  if (!issues.length) return null;

  const severity = issues.includes("public_script_validation_fallback")
    ? "red"
    : "amber";
  const recommendedAction = issues.includes("public_script_validation_fallback")
    ? "manual_review_then_mark_not_clean_public_publish"
    : issues.includes("repaired_script_validation_public_row")
      ? "public_script_fallback_already_marked_failed_review_platform_post"
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
    apply_status: issues.includes("repaired_script_validation_public_row")
      ? "already_applied"
      : "blocked_until_operator_approves_db_mutation",
    safety_note:
      issues.includes("repaired_script_validation_public_row")
        ? "The DB row is already marked failed/QA-failed; platform IDs are retained for manual platform review."
        : "Dry-run only. Do not clear platform IDs or rewrite status until the public posts have been manually checked.",
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
    repair_sql_preview: buildScriptFallbackRepairSql(rows, { now }),
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

function buildScriptFallbackRepairUpdates({
  stories = [],
  rows = [],
  now = new Date().toISOString(),
} = {}) {
  const storiesById = new Map((stories || []).map((story) => [String(story?.id || ""), story]));
  const redIds = new Set(
    (rows || [])
      .filter((row) => row?.issues?.includes("public_script_validation_fallback"))
      .map((row) => String(row.story_id || "").trim())
      .filter(Boolean),
  );
  const applied = [];
  const skipped = [];

  for (const id of redIds) {
    const story = storiesById.get(id);
    if (!story) {
      skipped.push({ story_id: id, reason: "story_not_found" });
      continue;
    }
    const platforms = platformsForStory(story);
    if (!platforms.length || !publishedAt(story)) {
      skipped.push({ story_id: id, reason: "not_a_public_platform_row" });
      continue;
    }
    if (!hasScriptValidationFailure(story)) {
      skipped.push({ story_id: id, reason: "script_validation_failure_not_present" });
      continue;
    }

    applied.push({
      story_id: id,
      previous: {
        publish_status: story.publish_status || null,
        qa_failed: truthy(story.qa_failed),
        publish_error: story.publish_error || null,
        platforms,
      },
      next: {
        ...story,
        publish_status: "failed",
        qa_failed: true,
        publish_error:
          story.publish_error || "script_validation_review_required_public_row_repair",
        script_review_reason:
          story.script_review_reason || "script_validation_review_required",
        public_row_repair: {
          applied_at: now,
          reason: "public_script_validation_fallback",
          platform_ids_preserved: true,
        },
      },
    });
  }

  return {
    applied,
    skipped,
    counts: {
      applied: applied.length,
      skipped: skipped.length,
    },
  };
}

async function applyPublishRowRepairPlan({
  plan,
  stories = [],
  persistStory,
  now = new Date().toISOString(),
} = {}) {
  if (typeof persistStory !== "function") {
    throw new Error("applyPublishRowRepairPlan requires persistStory");
  }
  const updates = buildScriptFallbackRepairUpdates({
    stories,
    rows: plan?.rows || [],
    now,
  });
  const applied = [];
  const skipped = [...updates.skipped];
  for (const item of updates.applied) {
    try {
      await persistStory(item.next);
      applied.push({
        story_id: item.story_id,
        previous: item.previous,
        next: {
          publish_status: item.next.publish_status,
          qa_failed: item.next.qa_failed,
          publish_error: item.next.publish_error,
          platform_ids_preserved: true,
        },
      });
    } catch (err) {
      skipped.push({
        story_id: item.story_id,
        reason: "persist_failed",
        message: err.message,
      });
    }
  }
  return {
    mode: "applied_targeted_script_fallback_repair",
    generated_at: now,
    applied,
    skipped,
    counts: {
      applied: applied.length,
      skipped: skipped.length,
    },
    safety: {
      platform_ids_preserved: true,
      public_posts_not_deleted: true,
      no_social_uploads: true,
      no_oauth_or_token_mutation: true,
    },
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

  if (plan.repair_sql_preview) {
    lines.push("");
    lines.push("## Repair SQL Preview");
    lines.push("Generated for operator review only. Do not run without a fresh DB backup and explicit approval:");
    lines.push("");
    lines.push("```sql");
    lines.push(plan.repair_sql_preview);
    lines.push("```");
  }

  if (plan.recommended_next_steps?.length) {
    lines.push("");
    lines.push("## Recommended Next Steps");
    for (const step of plan.recommended_next_steps) lines.push(`- ${step}`);
  }

  if (plan.apply_result) {
    lines.push("");
    lines.push("## Apply Result");
    lines.push(`- Mode: ${plan.apply_result.mode || "unknown"}`);
    lines.push(`- Applied: ${plan.apply_result.counts?.applied || 0}`);
    lines.push(`- Skipped: ${plan.apply_result.counts?.skipped || 0}`);
    if (plan.apply_result.backup_path) {
      lines.push(`- DB backup: ${plan.apply_result.backup_path}`);
    }
    for (const row of plan.apply_result.applied || []) {
      lines.push(`- ${row.story_id}: marked QA-failed; platform IDs preserved`);
    }
    for (const row of plan.apply_result.skipped || []) {
      lines.push(`- ${row.story_id}: skipped (${row.reason || "unknown"})`);
    }
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
  applyPublishRowRepairPlan,
  buildScriptFallbackRepairUpdates,
  buildScriptFallbackRepairSql,
  buildPublishRowRepairPlan,
  buildPublishRowRepairPlanFromDb,
  classifyPublishRowIssue,
  formatPublishRowRepairMarkdown,
};
