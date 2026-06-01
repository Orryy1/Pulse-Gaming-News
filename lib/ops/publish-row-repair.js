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

function explicitPublishedAt(story = {}) {
  return (
    story.published_at ||
    story.youtube_published_at ||
    story.instagram_published_at ||
    story.facebook_published_at ||
    null
  );
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function commandArg(value) {
  const text = String(value || "");
  if (/^[A-Za-z0-9_.:-]+$/.test(text)) return text;
  return `"${text.replace(/`/g, "``").replace(/"/g, '`"')}"`;
}

function normaliseStoryIds(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .flatMap((value) => String(value || "").split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function buildInspectionSql(ids = []) {
  const safeIds = [...new Set(ids.filter(Boolean).map(String))];
  if (!safeIds.length) return null;
  return [
    "SELECT id, title, publish_status, qa_failed, publish_error,",
    "       youtube_post_id, instagram_media_id, facebook_post_id,",
    "       published_at, youtube_published_at, instagram_published_at, facebook_published_at,",
    "       discord_video_drop_posted_at",
    "FROM stories",
    `WHERE id IN (${safeIds.map(sqlQuote).join(", ")});`,
  ].join("\n");
}

function blockerTypeForRow(row = {}) {
  if (row.issues?.includes("public_script_validation_fallback")) {
    return "public_script_validation_fallback";
  }
  if (row.issues?.includes("public_row_missing_publish_timestamp")) {
    return "public_row_missing_publish_timestamp";
  }
  if (row.issues?.includes("repaired_script_validation_public_row")) {
    return "repaired_script_validation_public_row";
  }
  if (row.issues?.includes("failed_row_with_platform_ids")) {
    return "failed_row_with_platform_ids";
  }
  return row.issues?.[0] || "publish_row_state_mismatch";
}

function repairLaneForRow(row = {}) {
  const blockerType = blockerTypeForRow(row);
  if (blockerType === "public_script_validation_fallback") {
    return "publish_row_public_fallback_review";
  }
  if (blockerType === "public_row_missing_publish_timestamp") {
    return "publish_timestamp_metadata_repair";
  }
  if (blockerType === "repaired_script_validation_public_row") {
    return "manual_platform_post_review";
  }
  return "partial_platform_state_review";
}

function exactMissingInputForRow(row = {}) {
  const blockerType = blockerTypeForRow(row);
  if (blockerType === "public_script_validation_fallback") {
    return "Public platform row contains script-validation fallback copy and must be reviewed before DB repair.";
  }
  if (blockerType === "public_row_missing_publish_timestamp") {
    return "Real platform publish timestamp is missing for a row with platform IDs.";
  }
  if (blockerType === "repaired_script_validation_public_row") {
    return "Platform post still needs manual review after the DB row was marked failed/QA-failed.";
  }
  return "Failed or QA-failed row still carries platform IDs and needs manual platform-state review.";
}

function expectedOutputForRow(row = {}) {
  const blockerType = blockerTypeForRow(row);
  if (blockerType === "public_script_validation_fallback") {
    return "After platform review, the story row is marked failed/QA-failed while preserving real platform IDs.";
  }
  if (blockerType === "public_row_missing_publish_timestamp") {
    return "The row has verified publish timestamp metadata without changing platform IDs.";
  }
  if (blockerType === "repaired_script_validation_public_row") {
    return "Operator records whether the live platform post should stay public, be remade or be removed.";
  }
  return "Operator records the real platform outcome and leaves IDs intact unless a separate approved cleanup says otherwise.";
}

function buildPublishRowRepairWorkOrder(row = {}) {
  const storyId = String(row.story_id || "").trim();
  const blockerType = blockerTypeForRow(row);
  const storyArg = commandArg(storyId);
  const recommendedCommand =
    `npm run ops:publish-row-repair -- --story-id ${storyArg} --json`;
  const canApply =
    blockerType === "public_script_validation_fallback";
  const applyCommand = canApply
    ? `npm run ops:publish-row-repair -- --story-id ${storyArg} --apply --operator-confirmed --json`
    : null;
  return {
    work_order_id: `publish_row_repair:${storyId || "unknown"}`,
    story_id: storyId || null,
    blocker_type: blockerType,
    repair_lane: repairLaneForRow(row),
    exact_missing_input: exactMissingInputForRow(row),
    platforms: row.platforms || [],
    severity: row.severity || "amber",
    recommended_command: recommendedCommand,
    ...(applyCommand ? { apply_command: applyCommand } : {}),
    expected_output: expectedOutputForRow(row),
    db_mutation_required:
      canApply || blockerType === "public_row_missing_publish_timestamp",
    operator_approval_required: true,
    token_or_oauth_mutation_required: false,
    external_posting_risk: false,
    platform_ids_preserved: true,
    post_repair_validation_command:
      `${recommendedCommand} && npm run ops:publish-cadence -- --hours 24`,
  };
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
  const explicitPublishTime = explicitPublishedAt(story);
  const publicRow = platforms.length > 0 && Boolean(explicitPublishTime);
  const missingPublishTimestamp = platforms.length > 0 && !explicitPublishTime;
  const scriptFallback = hasScriptValidationFailure(story);
  const scriptFallbackRepairApplied =
    scriptFallback &&
    failed &&
    String(story.publish_error || "").includes(
      "script_validation_review_required_public_row_repair",
    );

  const issues = [];
  if (failed && platforms.length > 0) issues.push("failed_row_with_platform_ids");
  if (missingPublishTimestamp) issues.push("public_row_missing_publish_timestamp");
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
    : issues.includes("public_row_missing_publish_timestamp")
      ? "repair_publish_timestamp_metadata"
    : issues.includes("repaired_script_validation_public_row")
      ? "public_script_fallback_already_marked_failed_review_platform_post"
      : "manual_review_partial_platform_state";
  const applyStatus = issues.includes("repaired_script_validation_public_row")
    ? "already_applied"
    : issues.includes("public_row_missing_publish_timestamp") &&
        !issues.includes("public_script_validation_fallback")
      ? "blocked_until_operator_confirms_timestamp_source"
      : "blocked_until_operator_approves_db_mutation";

  return {
    story_id: story.id || null,
    title: story.title || "(untitled)",
    severity,
    issues,
    platforms,
    published_at: explicitPublishTime || publishedAt(story),
    publish_status: story.publish_status || null,
    qa_failed: truthy(story.qa_failed),
    publish_error: story.publish_error || null,
    script_review_reason: story.script_review_reason || null,
    recommended_action: recommendedAction,
    apply_status: applyStatus,
    recommended_command: issues.includes("public_row_missing_publish_timestamp")
      ? "npm run ops:publish-row-repair -- --json --limit 50"
      : null,
    timestamp_repair: issues.includes("public_row_missing_publish_timestamp")
      ? {
          required_before_cadence_trust: true,
          acceptable_sources: [
            "platform_api_published_at",
            "youtube_studio_publish_time",
            "platform_posts_table",
            "operator_verified_upload_time",
          ],
          db_mutation_allowed_only_with_backup: true,
          platform_ids_preserved: true,
        }
      : null,
    safety_note:
      issues.includes("repaired_script_validation_public_row")
        ? "The DB row is already marked failed/QA-failed; platform IDs are retained for manual platform review."
        : issues.includes("public_row_missing_publish_timestamp")
          ? "Dry-run only. Confirm the real platform publish time before writing cadence metadata."
        : "Dry-run only. Do not clear platform IDs or rewrite status until the public posts have been manually checked.",
  };
}

function buildPublishRowRepairPlan({
  stories = [],
  now = new Date().toISOString(),
  limit = 50,
  storyIds = [],
} = {}) {
  const requestedStoryIds = normaliseStoryIds(storyIds);
  const requested = new Set(requestedStoryIds);
  const inputStories = requested.size
    ? (stories || []).filter((story) => requested.has(String(story?.id || "")))
    : stories || [];
  const rows = inputStories
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
    requested_story_ids: requestedStoryIds,
    included_requested_story_ids: requestedStoryIds.length
      ? rows.map((row) => row.story_id)
      : [],
    missing_requested_story_ids: requestedStoryIds.length
      ? requestedStoryIds.filter((id) => !rows.some((row) => row.story_id === id))
      : [],
    repair_candidates: rows.length,
    red_public_script_fallback: rows.filter((row) =>
      row.issues.includes("public_script_validation_fallback"),
    ).length,
    public_rows_missing_publish_timestamp: rows.filter((row) =>
      row.issues.includes("public_row_missing_publish_timestamp"),
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
    work_orders: rows.map(buildPublishRowRepairWorkOrder),
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
  if (plan.summary?.requested_story_ids?.length) {
    lines.push(
      `- Requested story IDs: ${plan.summary.requested_story_ids.join(", ")}`,
    );
    lines.push(
      `- Matched requested story IDs: ${(plan.summary.included_requested_story_ids || []).join(", ") || "none"}`,
    );
    if (plan.summary.missing_requested_story_ids?.length) {
      lines.push(
        `- Requested IDs without repair rows: ${plan.summary.missing_requested_story_ids.join(", ")}`,
      );
    }
  }
  lines.push(`- Repair candidates: ${plan.summary?.repair_candidates || 0}`);
  lines.push(
    `- Public script-validation fallback rows: ${plan.summary?.red_public_script_fallback || 0}`,
  );
  lines.push(
    `- Public rows missing publish timestamps: ${plan.summary?.public_rows_missing_publish_timestamp || 0}`,
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

  if (plan.work_orders?.length) {
    lines.push("");
    lines.push("## Repair Work Orders");
    for (const workOrder of plan.work_orders) {
      lines.push(`- Work order: ${workOrder.work_order_id}`);
      lines.push(`  - Story: ${workOrder.story_id || "unknown"}`);
      lines.push(`  - Blocker: ${workOrder.blocker_type}`);
      lines.push(`  - Lane: ${workOrder.repair_lane}`);
      lines.push(`  - Missing input: ${workOrder.exact_missing_input}`);
      lines.push(
        `  - Operator approval required: ${String(workOrder.operator_approval_required)}`,
      );
      lines.push(
        `  - DB mutation required: ${String(workOrder.db_mutation_required)}`,
      );
      lines.push(
        `  - Platform IDs preserved: ${String(workOrder.platform_ids_preserved)}`,
      );
      lines.push(`  - Command: \`${workOrder.recommended_command}\``);
      if (workOrder.apply_command) {
        lines.push(`  - Apply after approval: \`${workOrder.apply_command}\``);
      }
      lines.push(`  - Validate: \`${workOrder.post_repair_validation_command}\``);
    }
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
  buildPublishRowRepairWorkOrder,
  buildPublishRowRepairPlan,
  buildPublishRowRepairPlanFromDb,
  classifyPublishRowIssue,
  formatPublishRowRepairMarkdown,
};
