"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildInspectionSql,
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
  });

  assert.equal(row.severity, "amber");
  assert.deepEqual(row.issues, ["failed_row_with_platform_ids"]);
  assert.deepEqual(row.platforms, ["youtube"]);
  assert.equal(row.apply_status, "blocked_until_operator_approves_db_mutation");
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
  assert.doesNotMatch(sql, /\bDELETE\b/);
  assert.doesNotMatch(sql, /youtube_post_id\s*=\s*NULL|instagram_media_id\s*=\s*NULL/i);
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
  assert.match(tool, /publish_row_repair_plan\.json/);
  assert.match(tool, /publish_row_repair_preview\.sql/);
});
