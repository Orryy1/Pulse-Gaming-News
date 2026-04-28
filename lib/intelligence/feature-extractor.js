"use strict";

/**
 * lib/intelligence/feature-extractor.js — Session 3 (intelligence pass).
 *
 * Per-video feature row builder. Combines:
 *   - story-level fields (id, title, publish time, runtime, etc.)
 *   - Session 2 media-inventory class (`scoreStoryMediaInventory`)
 *   - Session 2 visual-QA class (`evaluateStoryVisualQa`)
 *   - format-catalogue selection (`selectFormatForStory`)
 *   - simple title-pattern + hook-type heuristics (no LLM)
 *
 * Output is a plain object that matches the `video_features` table
 * schema added by migration 017. The caller persists it.
 */

const {
  scoreStoryMediaInventory,
} = require("../creative/media-inventory-scorer");
const { evaluateStoryVisualQa } = require("../creative/visual-qa-gate");
const {
  selectFormatForStory,
  confidenceFromFlair,
} = require("../creative/format-catalogue");

const TITLE_PATTERNS = [
  { id: "question", re: /\?\s*$/ },
  { id: "is_real_reveal", re: /\bis\s+real\b/i },
  { id: "confirmed_reveal", re: /\b(confirmed|official|revealed?)\b/i },
  { id: "leak_rumour", re: /\b(leak|rumou?r|reportedly)\b/i },
  { id: "year_led", re: /\b(20\d\d|next\s+year|this\s+year)\b/i },
  {
    id: "list_format",
    re: /\b(top|every|all|\d+\s+(games|things|reasons))\b/i,
  },
];

const HOOK_PATTERNS = [
  { id: "hard_reveal", re: /\bis\s+real\b|\bbreaking\b/i },
  { id: "question", re: /\?/ },
  { id: "fact_stack", re: /\b(here'?s|today|right\s+now)\b/i },
  { id: "callback", re: /\b(remember|earlier|recently)\b/i },
];

function detectTitlePattern(title = "") {
  const t = String(title || "").trim();
  if (!t) return "unknown";
  for (const p of TITLE_PATTERNS) {
    if (p.re.test(t)) return p.id;
  }
  return "statement";
}

function detectHookType(text = "") {
  const t = String(text || "").trim();
  if (!t) return "unknown";
  for (const p of HOOK_PATTERNS) {
    if (p.re.test(t)) return p.id;
  }
  return "general";
}

function detectTopic(story) {
  const text =
    `${story?.title || ""} ${story?.full_script || ""}`.toLowerCase();
  if (/\b(playstation|ps5|sony)\b/.test(text)) return "playstation";
  if (/\b(xbox|microsoft\s+gaming)\b/.test(text)) return "xbox";
  if (/\b(nintendo|switch)\b/.test(text)) return "nintendo";
  if (/\b(steam|valve)\b/.test(text)) return "pc_steam";
  if (/\b(rumou?r|leak|insider)\b/.test(text)) return "rumour";
  return "general";
}

function detectFranchise(story) {
  const text = `${story?.title || ""} ${story?.suggested_thumbnail_text || ""}`;
  const m = text.match(
    /\b(GTA\s*\d*|Final Fantasy\s*\w*|Zelda|Mario|Call of Duty|Halo|Fortnite|Minecraft|Elden Ring|Cyberpunk|Starfield|Hogwarts|Diablo|Overwatch|Valorant|Apex|Pokemon|Pok[eé]mon|Fallout|Witcher|Mass Effect)/i,
  );
  return m ? m[1] : "unknown";
}

function clipStillCardRatios(inventory) {
  if (!inventory?.ratios) {
    return { clip_ratio: 0, still_ratio: 0, card_ratio: 0 };
  }
  return {
    clip_ratio: inventory.ratios.clipRatio || 0,
    still_ratio: inventory.ratios.stillRatio || 0,
    card_ratio: inventory.ratios.cardRatio || 0,
  };
}

function thumbnailSafetyStatus(visualQa) {
  if (!visualQa) return "unknown";
  if (visualQa.failures?.includes("unsafe_face_risk")) return "unsafe_face";
  if (visualQa.warnings?.includes("unsafe_face_risk"))
    return "unsafe_face_warn";
  if (visualQa.failures?.includes("title_text_present")) return "no_title";
  if (visualQa.result === "fail") return "fail";
  if (visualQa.result === "warn") return "warn";
  return "ok";
}

/**
 * Build a single feature row for a story.
 * Returns null if story.id is missing.
 */
function extractVideoFeatures(story) {
  if (!story?.id) return null;
  const inventory = scoreStoryMediaInventory(story);
  const visualQa = evaluateStoryVisualQa(story);
  const format = selectFormatForStory(story, inventory);
  const ratios = clipStillCardRatios(inventory);
  return {
    story_id: story.id,
    video_id: story.youtube_post_id || null,
    channel_id: story.channel_id || "pulse-gaming",
    title: story.title || null,
    publish_time:
      story.youtube_published_at ||
      story.published_at ||
      story.timestamp ||
      null,
    franchise: detectFranchise(story),
    topic: detectTopic(story),
    story_type: story.flair || story.classification || "unknown",
    format_type: format?.format?.id || "unknown",
    hook_type: detectHookType(
      story.hook || story.full_script || story.title || "",
    ),
    title_pattern: detectTitlePattern(
      story.title || story.suggested_title || "",
    ),
    runtime_seconds: Number(
      story.duration_seconds || story.runtime_seconds || 0,
    ),
    render_version: story.render_version || "canonical_v2",
    source_mix_json: JSON.stringify(inventory.sources || []),
    clip_ratio: ratios.clip_ratio,
    still_ratio: ratios.still_ratio,
    card_ratio: ratios.card_ratio,
    hero_moment_count: Number(story.hero_moment_count || 0),
    media_inventory_class: inventory.classification,
    source_diversity: inventory.counts?.distinct_sources || 0,
    thumbnail_safety_status: thumbnailSafetyStatus(visualQa),
    visual_qa_class: visualQa?.result || "unknown",
    flair_confidence: confidenceFromFlair(
      story.flair || story.classification || "",
    ),
  };
}

function extractMany(stories = []) {
  return (Array.isArray(stories) ? stories : [])
    .map(extractVideoFeatures)
    .filter(Boolean);
}

module.exports = {
  extractVideoFeatures,
  extractMany,
  detectTitlePattern,
  detectHookType,
  detectTopic,
  detectFranchise,
  thumbnailSafetyStatus,
};
