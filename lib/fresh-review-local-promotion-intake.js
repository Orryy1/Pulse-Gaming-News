"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { sourceNameFromUrl } = require("./source-bound-script-writer");
const {
  buildFreshReviewScriptRepairPlan,
  fetchFreshReviewScriptRepairRows,
} = require("./ops/fresh-review-script-repair");
const {
  parseArgs: parseReprocessArgs,
  reprocessCandidate,
} = require("../tools/reprocess-script-failures");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function storyId(value = {}) {
  return cleanText(value.story_id || value.id);
}

function sourceUrl(value = {}) {
  return cleanText(
    value.primary_source_url ||
      value.article_url ||
      value.source_url ||
      value.url ||
      value.primary_source?.url,
  );
}

function sourceName(value = {}) {
  const url = sourceUrl(value);
  return cleanText(
    value.primary_source?.name ||
      value.primary_source ||
      value.source_name ||
      value.source ||
      value.feed ||
      sourceNameFromUrl(url),
  );
}

function sourceType(value = {}) {
  return cleanText(value.primary_source?.type || value.source_type || "major_media_source");
}

function sourcePublishedAt(value = {}) {
  return cleanText(
    value.source_published_at ||
      value.published_at ||
      value.created_at ||
      value.timestamp ||
      value.scored_at,
  );
}

function firstSentence(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return cleanText(match ? match[1] : text);
}

function thumbnailHeadline(value = {}) {
  return cleanText(
    value.suggested_thumbnail_text ||
      value.thumbnail_headline ||
      value.thumbnail_text ||
      value.short_title ||
      value.suggested_title ||
      value.title,
  )
    .replace(/[^\w\s:'-]/g, "")
    .split(/\s+/)
    .slice(0, 5)
    .join(" ")
    .toUpperCase();
}

function confirmedClaims(value = {}) {
  const claims = [
    ...asArray(value.confirmed_claims),
    value.source_title,
    value.article_title,
    value.description,
    value.summary,
  ]
    .map(cleanText)
    .filter(Boolean);
  if (claims.length) return Array.from(new Set(claims)).slice(0, 4);

  const source = sourceName(value);
  const title = cleanText(value.title || value.suggested_title);
  return title ? [`${source || "The source"} reports ${title}.`] : [];
}

function qualityFailuresForDraft(draft = {}) {
  const title = cleanText(draft.selected_title || draft.title);
  const script = cleanText(draft.full_script || draft.tts_script || draft.narration_script);
  const subject = cleanText(draft.canonical_subject || draft.canonical_game);
  const failures = [];
  if (!title || !script) failures.push("local_intake:title_or_script_missing");
  if (/\bplayer impact\b/i.test(title)) failures.push("local_intake:generic_player_impact_title");
  if (/\bnow has one concrete player question\b/i.test(script)) failures.push("local_intake:generic_player_question_script");
  if (/\bfresh .{0,80} update with a detail that could change timing, access or expectations\b/i.test(script)) {
    failures.push("local_intake:generic_update_scaffold_script");
  }
  if (/\b(?:best deals today|today'?s top deals|airpods|gift cards?)\b/i.test(`${title} ${script}`)) {
    failures.push("local_intake:commerce_deals_roundup_not_editorial_story");
  }
  if (subject.split(/\s+/).length > 8 && !/\b(?:Ocarina of Time|Cyberpunk 2077|Black Ops|Hellraiser|Xbox)\b/i.test(subject)) {
    failures.push("local_intake:canonical_subject_too_broad");
  }
  return failures;
}

function storyDraftFromReprocessedRow(row = {}, original = {}) {
  const id = storyId(row) || storyId(original);
  const url = sourceUrl(row) || sourceUrl(original);
  const source = sourceName(row) || sourceName(original);
  const script = cleanText(row.full_script || row.tts_script || row.narration_script);
  const title = cleanText(row.suggested_title || row.public_title || row.title || original.title);
  return {
    id,
    title,
    selected_title: cleanText(row.suggested_title || row.selected_title || title),
    canonical_subject: cleanText(row.canonical_subject || row.canonical_game || row.short_title || title),
    canonical_game: cleanText(row.canonical_game || row.canonical_subject || row.short_title || title),
    primary_source: {
      name: source,
      url,
      type: sourceType(row) || sourceType(original),
    },
    primary_source_url: url,
    source_url: url,
    article_url: url,
    url,
    source_name: source,
    source_type: sourceType(row) || sourceType(original),
    source_published_at: sourcePublishedAt(row) || sourcePublishedAt(original),
    source_confidence_score: Number(row.source_confidence_score || original.source_confidence_score || 90),
    confirmed_claims: confirmedClaims(row).length ? confirmedClaims(row) : confirmedClaims(original),
    unconfirmed_claims: asArray(row.unconfirmed_claims || original.unconfirmed_claims),
    prohibited_claims: asArray(row.prohibited_claims || original.prohibited_claims),
    thumbnail_headline: thumbnailHeadline(row),
    suggested_thumbnail_text: thumbnailHeadline(row),
    narration_script: script,
    full_script: script,
    tts_script: script,
    hook: firstSentence(script),
    body: script,
    description: cleanText(row.description || original.description || firstSentence(script)),
    pinned_comment: source ? `Source: ${source}.` : "",
    script_generation_status: cleanText(row.script_generation_status),
    local_promotion_intake_only: true,
  };
}

function selectedRowsFromPlan(rows = [], plan = {}) {
  const selectedIds = new Set(
    asArray(plan.source_bound_rewrite_work_orders).map((item) => cleanText(item.story_id)).filter(Boolean),
  );
  return asArray(rows).filter((row) => selectedIds.has(storyId(row)));
}

async function buildFreshReviewLocalPromotionIntake({
  rows = null,
  plan = null,
  limit = 6,
  maxAgeHours = 7 * 24,
  minScore = 65,
  now = new Date(),
} = {}) {
  const selectedAt = now instanceof Date ? now : new Date(now);
  const sourceRows = rows || fetchFreshReviewScriptRepairRows({
    now: selectedAt,
    maxAgeHours,
    limit: Math.max(40, Number(limit || 6) * 10),
  });
  const repairPlan = plan || buildFreshReviewScriptRepairPlan({
    rows: sourceRows,
    now: selectedAt,
    maxAgeHours,
    minScore,
    limit,
  });
  const selected = selectedRowsFromPlan(sourceRows, repairPlan);
  const reprocessArgs = parseReprocessArgs(["--source-bound-only", "--dry-run"]);
  const drafts = [];
  const repairResults = [];
  for (const row of selected) {
    const results = await reprocessCandidate(row, reprocessArgs);
    const first = asArray(results)[0] || {};
    repairResults.push({
      story_id: storyId(row),
      title: cleanText(row.title),
      script_generation_status: cleanText(first.script_generation_status),
      output_story_ready: cleanText(first.script_generation_status) === "script_ready",
      script_review_reason: cleanText(first.script_review_reason),
    });
    if (cleanText(first.script_generation_status) !== "script_ready") continue;
    const draft = storyDraftFromReprocessedRow(first, row);
    const qualityFailures = qualityFailuresForDraft(draft);
    if (qualityFailures.length > 0) {
      repairResults[repairResults.length - 1].output_story_ready = false;
      repairResults[repairResults.length - 1].quality_failures = qualityFailures;
      continue;
    }
    drafts.push(draft);
  }
  return {
    schema_version: 1,
    mode: "FRESH_REVIEW_LOCAL_PROMOTION_INTAKE",
    generated_at: selectedAt.toISOString(),
    summary: {
      rows_seen: asArray(sourceRows).length,
      repair_plan_selected_count: repairPlan.summary?.selected_count || 0,
      local_promotion_story_count: drafts.length,
      production_db_mutation_required: false,
    },
    fresh_source_intake_stories: drafts,
    repair_results: repairResults,
    next_action:
      drafts.length > 0
        ? "run_fresh_green_buffer_local_promotion_then_render_audio_and_preflight"
        : "refresh_source_backed_story_supply_before_local_promotion",
    safety: {
      no_publish_triggered: true,
      no_network_uploads_started: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_platform_setting_change: true,
      disabled_platforms_enabled: false,
      gates_weakened: false,
    },
  };
}

async function writeFreshReviewLocalPromotionIntake(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeFreshReviewLocalPromotionIntake requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, "fresh_review_local_promotion_intake_report.json");
  const storiesPath = path.join(outDir, "fresh_source_intake_stories.json");
  await Promise.all([
    fs.writeJson(reportPath, report, { spaces: 2 }),
    fs.writeJson(storiesPath, report.fresh_source_intake_stories || [], { spaces: 2 }),
  ]);
  return { reportPath, storiesPath };
}

module.exports = {
  buildFreshReviewLocalPromotionIntake,
  storyDraftFromReprocessedRow,
  writeFreshReviewLocalPromotionIntake,
};
