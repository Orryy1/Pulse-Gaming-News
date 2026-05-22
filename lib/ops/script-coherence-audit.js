"use strict";

const { runScriptCoherenceQa } = require("../script-coherence-qa");

function storyHasPublicPost(story = {}) {
  return Boolean(
    story.youtube_post_id ||
      story.youtube_url ||
      story.tiktok_post_id ||
      story.instagram_media_id ||
      story.facebook_post_id ||
      story.twitter_post_id ||
      story.published_at,
  );
}

function hasScript(story = {}) {
  return Boolean(String(story.full_script || story.tts_script || story.body || "").trim());
}

function auditScriptCoherenceStories(stories = [], options = {}) {
  const includePublished = options.includePublished === true;
  const limit = Math.max(0, Number(options.limit) || stories.length || 0);
  const storyIds = new Set(
    (Array.isArray(options.storyIds) ? options.storyIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  const rows = [];

  for (const story of stories || []) {
    if (!story || !story.id || !hasScript(story)) continue;
    if (storyIds.size && !storyIds.has(String(story.id))) continue;
    if (!includePublished && storyHasPublicPost(story)) continue;

    const qa = runScriptCoherenceQa(story, {
      requireCtaField: true,
      requireFullScriptCta: true,
    });

    if (qa.result === "fail") {
      rows.push({
        story_id: story.id,
        title: story.title || "",
        approved: story.approved === true,
        auto_approved: story.auto_approved === true,
        script_generation_status: story.script_generation_status || null,
        failures: qa.failures,
        warnings: qa.warnings,
        public_posted: storyHasPublicPost(story),
      });
      if (rows.length >= limit) break;
    }
  }

  return rows;
}

function markStoryForScriptReview(story = {}, failures = []) {
  const reason = failures[0] || "script_coherence_failed";
  return {
    ...story,
    approved: false,
    auto_approved: false,
    script_generation_status: "review_required",
    script_review_reason: reason,
    script_validation_errors: failures,
    content_pillar: "Manual Review",
    format_route: "review_or_briefing",
    runtime_route: "review_or_briefing",
    updated_at: new Date().toISOString(),
  };
}

function buildScriptCoherenceAuditReport({
  mode = "dry_run",
  rows = [],
  generatedAt = new Date().toISOString(),
  backupPath = null,
} = {}) {
  return {
    generated_at: generatedAt,
    mode,
    safety: {
      db_mutation: mode === "apply_local",
      social_posting: false,
      discord_posting: false,
      published_rows_mutated: false,
    },
    backup_path: backupPath,
    summary: {
      failing_rows: rows.length,
      approved_rows_held: rows.filter((row) => row.approved).length,
    },
    rows,
  };
}

function formatScriptCoherenceAuditMarkdown(report = {}) {
  const lines = [
    "# Script Coherence Audit",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Mode: ${report.mode || "unknown"}`,
    "",
    "## Safety",
    `- DB mutation: ${report.safety?.db_mutation === true}`,
    `- Published rows mutated: ${report.safety?.published_rows_mutated === true}`,
    "- Discord posting: false",
    "- Social posting: false",
    report.backup_path ? `- Backup: ${report.backup_path}` : "- Backup: not required",
    "",
    "## Summary",
    `- Failing rows: ${report.summary?.failing_rows || 0}`,
    `- Approved rows held: ${report.summary?.approved_rows_held || 0}`,
    "",
    "## Rows",
  ];

  if (!report.rows || report.rows.length === 0) {
    lines.push("- none");
  } else {
    for (const row of report.rows) {
      lines.push(
        `- ${row.story_id}: ${row.failures?.[0] || "script_coherence_failed"} - ${row.title}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

module.exports = {
  auditScriptCoherenceStories,
  buildScriptCoherenceAuditReport,
  formatScriptCoherenceAuditMarkdown,
  markStoryForScriptReview,
  storyHasPublicPost,
};
