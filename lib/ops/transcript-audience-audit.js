"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const { buildViralScriptIntelligence } = require("../viral-script-intelligence");
const { runScriptCoherenceQa } = require("../script-coherence-qa");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readJsonSync(filePath);
}

function primarySourceName(manifest = {}, sourceManifest = {}) {
  const source = sourceManifest.primary_source || manifest.primary_source || manifest.official_source;
  if (typeof source === "string") return clean(source);
  return clean(source?.name || source?.source_name || source?.label || source?.title);
}

function transcriptFrom(manifest = {}, narration = {}) {
  return clean(
    manifest.narration_script ||
      manifest.full_script ||
      manifest.tts_script ||
      narration.final_transcript ||
      narration.transcript,
  );
}

function auditOneTranscript({ storyId, artifactDir } = {}) {
  const canonical = readJsonIfExists(path.join(artifactDir, "canonical_story_manifest.json")) || {};
  const source = readJsonIfExists(path.join(artifactDir, "source_manifest.json")) || {};
  const narration = readJsonIfExists(path.join(artifactDir, "narration_manifest.json")) || {};
  const script = transcriptFrom(canonical, narration);
  const title = clean(canonical.selected_title || canonical.title || storyId);
  const sourceName = primarySourceName(canonical, source);
  const story = {
    id: storyId,
    title,
    source_name: sourceName,
    source_type: clean(canonical.discovery_source?.type || canonical.source_type || "rss"),
    subreddit: clean(canonical.discovery_source?.name || canonical.subreddit),
  };
  const viral = buildViralScriptIntelligence({ story, script });
  const coherence = runScriptCoherenceQa(
    { ...story, full_script: script, cta: "Follow Pulse Gaming so you never miss a beat" },
    { requireCtaField: true, requireFullScriptCta: false },
  );
  const blockers = [...new Set([...(viral.blockers || []), ...(coherence.failures || [])])];
  const verdict = viral.verdict === "viral_ready" && blockers.length === 0 ? "pass" : "rewrite_required";
  return {
    story_id: storyId,
    title,
    source_name: sourceName,
    artifact_dir: artifactDir,
    verdict,
    viral_verdict: viral.verdict,
    viral_score: viral.viral_score,
    scores: viral.scores,
    blockers,
    rewrite_recommendations: viral.rewrite_recommendations || [],
    prompt_directives: viral.prompt_directives || [],
    first_line: clean(script.split(/(?<=[.!?])\s+/)[0] || script),
    transcript: script,
  };
}

async function auditGeneratedTranscripts({ root = process.cwd(), batchDir = path.join(root, "output", "goal-proof", "batch") } = {}) {
  const storyDirs = fs.existsSync(batchDir)
    ? fs.readdirSync(batchDir)
      .map((name) => path.join(batchDir, name))
      .filter((dir) => fs.statSync(dir).isDirectory())
      .filter((dir) => fs.existsSync(path.join(dir, "canonical_story_manifest.json")))
    : [];

  const stories = storyDirs
    .map((dir) => auditOneTranscript({ storyId: path.basename(dir), artifactDir: dir }))
    .sort((a, b) => {
      if (a.verdict !== b.verdict) return a.verdict.localeCompare(b.verdict);
      return a.viral_score - b.viral_score;
    });

  const summary = stories.reduce(
    (acc, story) => {
      acc.total += 1;
      acc[story.verdict] = (acc[story.verdict] || 0) + 1;
      acc.viral_verdict_counts[story.viral_verdict] = (acc.viral_verdict_counts[story.viral_verdict] || 0) + 1;
      return acc;
    },
    { total: 0, pass: 0, rewrite_required: 0, viral_verdict_counts: {} },
  );

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    execution_mode: "local_transcript_audience_audit",
    summary,
    stories,
    safety: {
      local_only: true,
      analysis_only: true,
      no_live_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function renderTranscriptAudienceAuditMarkdown(report = {}) {
  const lines = [
    "# Transcript Audience Audit",
    "",
    `Generated: ${report.generated_at || ""}`,
    "",
    `Total transcripts: ${report.summary?.total || 0}`,
    `Pass: ${report.summary?.pass || 0}`,
    `Rewrite required: ${report.summary?.rewrite_required || 0}`,
    "",
    "## Rewrite Required",
    "",
  ];
  for (const story of (report.stories || []).filter((item) => item.verdict !== "pass")) {
    lines.push(`- ${story.story_id} - ${story.title}`);
    lines.push(`  - score: ${story.viral_score}`);
    lines.push(`  - blockers: ${story.blockers.join(", ") || "none"}`);
    lines.push(`  - first line: ${story.first_line}`);
  }
  lines.push("", "## Passed", "");
  for (const story of (report.stories || []).filter((item) => item.verdict === "pass")) {
    lines.push(`- ${story.story_id} - ${story.title} (${story.viral_score})`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function writeTranscriptAudienceAudit(report, { outputDir = path.join(process.cwd(), "output", "transcript-audience-audit") } = {}) {
  await fs.ensureDir(outputDir);
  const jsonPath = path.join(outputDir, "transcript_audience_audit.json");
  const mdPath = path.join(outputDir, "transcript_audience_audit.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderTranscriptAudienceAuditMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

module.exports = {
  auditGeneratedTranscripts,
  auditOneTranscript,
  renderTranscriptAudienceAuditMarkdown,
  writeTranscriptAudienceAudit,
};
