"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  applyPublishRowRepairPlan,
  buildInspectionSql,
  buildScriptFallbackRepairUpdates,
  buildScriptFallbackRepairSql,
  buildPublishRowRepairPlan,
  classifyPublishRowIssue,
  formatPublishRowRepairMarkdown,
} = require("../../lib/ops/publish-row-repair");

const ROOT = path.resolve(__dirname, "..", "..");

test("classifyPublishRowIssue: failed rows carrying platform IDs need manual repair", () => {
  const row = classifyPublishRowIssue({
    id: "failed_partial",
    title: "Uploaded somewhere then failed",
    publish_status: "failed",
    publish_error: "TikTok 403",
    youtube_post_id: "yt_123",
    published_at: "2026-05-14T22:00:00.000Z",
  });

  assert.equal(row.severity, "amber");
  assert.deepEqual(row.issues, ["failed_row_with_platform_ids"]);
  assert.deepEqual(row.platforms, ["youtube"]);
  assert.equal(row.apply_status, "blocked_until_operator_approves_db_mutation");
});

test("classifyPublishRowIssue: DUPE sentinels are not treated as real platform IDs", () => {
  const failed = classifyPublishRowIssue({
    id: "legacy_failed",
    title: "Legacy duplicate block",
    publish_status: "failed",
    youtube_post_id: "DUPE_YOUTUBE",
  });
  const scriptFallback = classifyPublishRowIssue({
    id: "legacy_script",
    title: "Legacy script fallback",
    published_at: "2026-05-14T22:00:00.000Z",
    instagram_media_id: "DUPE_INSTAGRAM",
    body: "Script validation failed. Manual review required before production.",
  });

  assert.equal(failed, null);
  assert.equal(scriptFallback, null);
});

test("classifyPublishRowIssue: public script-validation fallback rows are red", () => {
  const row = classifyPublishRowIssue({
    id: "bad_public",
    title: "Script failed but posted",
    published_at: "2026-05-14T02:00:00.000Z",
    instagram_media_id: "ig_123",
    body: "Script validation failed. Manual review required before production.",
  });

  assert.equal(row.severity, "red");
  assert.ok(row.issues.includes("public_script_validation_fallback"));
  assert.equal(row.recommended_action, "manual_review_then_mark_not_clean_public_publish");
});

test("classifyPublishRowIssue: repaired script-validation fallback rows are amber and not applyable", () => {
  const row = classifyPublishRowIssue({
    id: "bad_public",
    title: "Script failed but was already repaired",
    publish_status: "failed",
    qa_failed: true,
    publish_error: "script_validation_review_required_public_row_repair",
    published_at: "2026-05-14T02:00:00.000Z",
    instagram_media_id: "ig_123",
    body: "Script validation failed. Manual review required before production.",
  });

  assert.equal(row.severity, "amber");
  assert.deepEqual(row.issues, [
    "failed_row_with_platform_ids",
    "repaired_script_validation_public_row",
  ]);
  assert.equal(row.apply_status, "already_applied");
  assert.equal(
    row.recommended_action,
    "public_script_fallback_already_marked_failed_review_platform_post",
  );
});

test("classifyPublishRowIssue: public platform IDs without publish timestamps are amber metadata repairs", () => {
  const row = classifyPublishRowIssue({
    id: "missing_publish_time",
    title: "Uploaded but timestamp missing",
    youtube_post_id: "yt_123",
  });

  assert.equal(row.severity, "amber");
  assert.ok(row.issues.includes("public_row_missing_publish_timestamp"));
  assert.equal(row.recommended_action, "repair_publish_timestamp_metadata");
  assert.equal(row.apply_status, "blocked_until_operator_confirms_timestamp_source");
  assert.equal(row.timestamp_repair.required_before_cadence_trust, true);
  assert.deepEqual(row.timestamp_repair.acceptable_sources, [
    "platform_api_published_at",
    "youtube_studio_publish_time",
    "platform_posts_table",
    "operator_verified_upload_time",
  ]);
});

test("buildPublishRowRepairPlan: ignores clean public rows", () => {
  const plan = buildPublishRowRepairPlan({
    now: "2026-05-14T20:00:00.000Z",
    stories: [
      {
        id: "clean",
        title: "Good publish",
        published_at: "2026-05-14T19:00:00.000Z",
        youtube_post_id: "yt_good",
        full_script: "This is a complete clean script with no processor fallback text.",
      },
      {
        id: "bad",
        title: "Bad publish",
        published_at: "2026-05-14T19:10:00.000Z",
        youtube_post_id: "yt_bad",
        script_generation_status: "review_required",
      },
    ],
  });

  assert.equal(plan.mode, "dry_run_no_db_mutation");
  assert.equal(plan.summary.inspected_stories, 2);
  assert.equal(plan.summary.repair_candidates, 1);
  assert.equal(plan.rows[0].story_id, "bad");
  assert.match(plan.repair_sql_preview, /UPDATE stories/);
  assert.match(plan.repair_sql_preview, /'bad'/);
});

test("buildPublishRowRepairPlan: reports missing publish timestamp rows separately", () => {
  const plan = buildPublishRowRepairPlan({
    now: "2026-05-30T22:58:00.000Z",
    stories: [
      {
        id: "missing_publish_time",
        title: "Uploaded but timestamp missing",
        youtube_post_id: "yt_123",
      },
      {
        id: "clean_public",
        title: "Clean public",
        youtube_post_id: "yt_good",
        published_at: "2026-05-30T20:00:00.000Z",
      },
    ],
  });

  assert.equal(plan.summary.public_rows_missing_publish_timestamp, 1);
  assert.equal(plan.rows[0].story_id, "missing_publish_time");
  assert.match(plan.inspection_sql, /youtube_published_at/);
  assert.match(plan.rows[0].recommended_command, /ops:publish-row-repair/);
});

test("buildScriptFallbackRepairSql: only targets red public fallback rows and preserves platform ids", () => {
  const sql = buildScriptFallbackRepairSql([
    {
      story_id: "bad'id",
      issues: ["public_script_validation_fallback"],
    },
    {
      story_id: "amber",
      issues: ["failed_row_with_platform_ids"],
    },
  ], { now: "2026-05-14T21:30:00.000Z" });

  assert.match(sql, /BEGIN IMMEDIATE/);
  assert.match(sql, /publish_status = 'failed'/);
  assert.match(sql, /qa_failed = 1/);
  assert.match(sql, /bad''id/);
  assert.doesNotMatch(sql, /'amber'/);
  assert.doesNotMatch(sql, /script_generation_status|script_review_reason/);
  assert.doesNotMatch(sql, /\bDELETE\b/);
  assert.doesNotMatch(sql, /youtube_post_id\s*=\s*NULL|instagram_media_id\s*=\s*NULL/i);
});

test("buildScriptFallbackRepairUpdates marks only red public fallback rows and keeps platform ids", () => {
  const updates = buildScriptFallbackRepairUpdates({
    now: "2026-05-15T00:10:00.000Z",
    rows: [
      { story_id: "bad", issues: ["public_script_validation_fallback"] },
      { story_id: "amber", issues: ["failed_row_with_platform_ids"] },
    ],
    stories: [
      {
        id: "bad",
        published_at: "2026-05-14T22:00:00.000Z",
        youtube_post_id: "yt_bad",
        instagram_media_id: "ig_bad",
        full_script: "Script validation failed. Manual review required before production.",
      },
      {
        id: "amber",
        publish_status: "failed",
        youtube_post_id: "yt_amber",
      },
    ],
  });

  assert.equal(updates.counts.applied, 1);
  assert.equal(updates.applied[0].story_id, "bad");
  assert.equal(updates.applied[0].next.publish_status, "failed");
  assert.equal(updates.applied[0].next.qa_failed, true);
  assert.equal(updates.applied[0].next.youtube_post_id, "yt_bad");
  assert.equal(updates.applied[0].next.instagram_media_id, "ig_bad");
  assert.equal(updates.applied[0].next.public_row_repair.platform_ids_preserved, true);
});

test("applyPublishRowRepairPlan persists targeted updates and reports skipped rows", async () => {
  const persisted = [];
  const plan = buildPublishRowRepairPlan({
    now: "2026-05-15T00:12:00.000Z",
    stories: [
      {
        id: "bad",
        published_at: "2026-05-14T22:00:00.000Z",
        youtube_post_id: "yt_bad",
        body: "Script validation failed. Manual review required before production.",
      },
    ],
  });

  const result = await applyPublishRowRepairPlan({
    plan,
    stories: [
      {
        id: "bad",
        published_at: "2026-05-14T22:00:00.000Z",
        youtube_post_id: "yt_bad",
        body: "Script validation failed. Manual review required before production.",
      },
    ],
    persistStory: async (story) => persisted.push(story),
    now: "2026-05-15T00:12:00.000Z",
  });

  assert.equal(result.counts.applied, 1);
  assert.equal(result.counts.skipped, 0);
  assert.equal(persisted[0].publish_status, "failed");
  assert.equal(persisted[0].youtube_post_id, "yt_bad");
  assert.equal(result.safety.platform_ids_preserved, true);
});

test("formatPublishRowRepairMarkdown: renders safety, inspection SQL and repair preview", () => {
  const plan = buildPublishRowRepairPlan({
    stories: [
      {
        id: "bad'id",
        title: "Unsafe-looking ID stays quoted",
        published_at: "2026-05-14T19:10:00.000Z",
        youtube_post_id: "yt",
        script_generation_status: "review_required",
      },
    ],
  });
  const md = formatPublishRowRepairMarkdown(plan);

  assert.match(md, /Publish Row Repair Plan/);
  assert.match(md, /Dry-run|dry-run/i);
  assert.match(md, /blocked/i);
  assert.match(md, /Inspection SQL/);
  assert.match(md, /Repair SQL Preview/);
  assert.match(md, /bad''id/);
});

test("buildInspectionSql: creates read-only SELECT only", () => {
  const sql = buildInspectionSql(["a", "b"]);
  assert.match(sql, /^SELECT /);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
});

test("ops:publish-row-repair command is registered and dry-run named", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["ops:publish-row-repair"],
    "node tools/publish-row-repair-plan.js",
  );
  const tool = fs.readFileSync(
    path.join(ROOT, "tools", "publish-row-repair-plan.js"),
    "utf8",
  );
  assert.match(tool, /Dry-run publish row repair planner/);
  assert.match(tool, /--operator-confirmed/);
  assert.match(tool, /publish_row_repair_apply_requires_operator_confirmed_flag/);
  assert.match(tool, /publish_row_repair_plan\.json/);
  assert.match(tool, /publish_row_repair_preview\.sql/);
});
