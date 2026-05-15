"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  auditScriptCoherenceStories,
  buildScriptCoherenceAuditReport,
  formatScriptCoherenceAuditMarkdown,
  markStoryForScriptReview,
} = require("../../lib/ops/script-coherence-audit");

const ROOT = path.resolve(__dirname, "..", "..");

test("script coherence audit finds unpublished bad scripts and skips published rows", () => {
  const rows = auditScriptCoherenceStories([
    {
      id: "bad",
      title: "Bad script",
      approved: true,
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "The community is buzzing because this raises more questions than answers. Follow Pulse Gaming so you never miss a beat.",
    },
    {
      id: "published",
      title: "Published bad script stays untouched",
      youtube_post_id: "yt",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "The community is buzzing because this raises more questions than answers. Follow Pulse Gaming so you never miss a beat.",
    },
  ]);

  assert.deepEqual(rows.map((row) => row.story_id), ["bad"]);
  assert.equal(rows[0].approved, true);
});

test("markStoryForScriptReview clears approval and preserves story fields", () => {
  const story = markStoryForScriptReview(
    {
      id: "bad",
      title: "Bad script",
      approved: true,
      auto_approved: true,
      full_script: "Existing text",
    },
    ["script_coherence:vague_filler:community_is_buzzing"],
  );

  assert.equal(story.id, "bad");
  assert.equal(story.approved, false);
  assert.equal(story.auto_approved, false);
  assert.equal(story.script_generation_status, "review_required");
  assert.equal(story.script_review_reason, "script_coherence:vague_filler:community_is_buzzing");
  assert.equal(story.content_pillar, "Manual Review");
});

test("script coherence audit report is operator-readable", () => {
  const report = buildScriptCoherenceAuditReport({
    mode: "dry_run",
    rows: [
      {
        story_id: "bad",
        title: "Bad script",
        approved: true,
        failures: ["script_coherence:vague_filler:community_is_buzzing"],
      },
    ],
  });
  const md = formatScriptCoherenceAuditMarkdown(report);

  assert.equal(report.summary.failing_rows, 1);
  assert.equal(report.summary.approved_rows_held, 1);
  assert.match(md, /Script Coherence Audit/);
  assert.match(md, /bad: script_coherence:vague_filler:community_is_buzzing/);
});

test("ops:script-coherence-audit command is registered and dry-run first", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["ops:script-coherence-audit"], "node tools/script-coherence-audit.js");

  const tool = fs.readFileSync(path.join(ROOT, "tools", "script-coherence-audit.js"), "utf8");
  assert.match(tool, /Default is dry-run/);
  assert.match(tool, /--apply-local/);
  assert.match(tool, /db\.getDb\(\)\.backup/);
});

test("script coherence audit refuses apply-local on published rows", () => {
  const tool = fs.readFileSync(path.join(ROOT, "tools", "script-coherence-audit.js"), "utf8");

  assert.match(tool, /applyLocal && args\.includePublished/);
  assert.match(tool, /cannot be combined with --include-published/);
});
