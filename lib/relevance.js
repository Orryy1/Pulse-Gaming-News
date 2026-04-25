/**
 * lib/relevance.js — keyword-aware image ranking.
 *
 * The legacy pipeline ranked images by SOURCE priority alone:
 *   article hero (100) > Steam keyart (95) > Steam hero (90) > ...
 *   > Pexels (25) > Unsplash (15) > Bing (10)
 *
 * This means a Bing-fetched stock photo of a "flooded cottage" can
 * land in a GTA 6 video — its source priority is low, but if the
 * higher-priority sources didn't return enough images, the cottage
 * shot makes the cut anyway. The viewer sees a man in a flooded
 * cottage during a story about Take-Two's earnings call. Cringe.
 *
 * This module adds a SECOND ranking pass: keyword relevance to the
 * story. The combined score is:
 *
 *   final = sourcePriority + relevanceBoost - irrelevancePenalty
 *
 * where relevanceBoost is up to +40 for images whose
 * filename / type / source-tag contain story keywords, and
 * irrelevancePenalty is up to -30 for images whose tags hint at a
 * generic stock library miss.
 *
 * Story keywords come from:
 *   - the title (split, dropped stopwords)
 *   - the body (top 6 by frequency, dropped stopwords)
 *   - the detected `company_name` if present
 *
 * Image side comes from:
 *   - filename basename (e.g. `1smsr12_hero_steam.jpg`)
 *   - the `type` field on the downloaded_images entry
 *   - the `source` field if present
 *   - any `query` or `tags` metadata stashed during fetch
 */

"use strict";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "as",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "they",
  "their",
  "them",
  "he",
  "she",
  "his",
  "her",
  "you",
  "your",
  "we",
  "our",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "can",
  "may",
  "just",
  "only",
  "also",
  "very",
  "really",
  "more",
  "most",
  "some",
  "all",
  "any",
  "not",
  "no",
  "new",
  "says",
  "said",
  "says",
  "reportedly",
  "apparently",
  "game",
  "games",
  "gaming",
  "release",
  "released",
  "reveal",
  "revealed",
  "trailer",
  "update",
  "news",
]);

// Tokens that indicate a generic stock-library shot likely
// unrelated to the story. Penalised heavily.
const STOCK_PENALTY_TOKENS = [
  "pexels",
  "unsplash",
  "shutterstock",
  "istock",
  "stock",
  "person",
  "people",
  "businessman",
];

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function topByFrequency(tokens, n) {
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

/**
 * Build the keyword set for a story.
 */
function buildStoryKeywords(story) {
  const titleTokens = tokenize(story?.title || "");
  const bodyTokens = tokenize(
    `${story?.body || ""} ${story?.full_script || ""}`,
  );
  const companyTokens = tokenize(story?.company_name || "");

  const set = new Set([
    ...titleTokens,
    ...topByFrequency(bodyTokens, 6),
    ...companyTokens,
  ]);
  // Title tokens get explicit double-weight: caller can check
  // `titleTokens` separately.
  return { keywords: set, titleTokens: new Set(titleTokens) };
}

/**
 * Build the searchable haystack for an image.
 */
function buildImageHaystack(img) {
  const parts = [];
  if (img?.path) parts.push(String(img.path));
  if (img?.filename) parts.push(String(img.filename));
  if (img?.type) parts.push(String(img.type));
  if (img?.source) parts.push(String(img.source));
  if (img?.query) parts.push(String(img.query));
  if (Array.isArray(img?.tags)) parts.push(img.tags.join(" "));
  if (img?.alt) parts.push(String(img.alt));
  return parts.join(" ").toLowerCase();
}

/**
 * Score one image. Returns a delta (+ boost, − penalty) to apply
 * on top of the existing source-priority score.
 */
function scoreImage(img, { keywords, titleTokens }) {
  if (!img) return 0;
  const haystack = buildImageHaystack(img);
  if (!haystack) return 0;

  let score = 0;

  // Boost: each keyword hit in the haystack is +5; title tokens
  // get +10. Cap at +40 so a single keyword-matching shot doesn't
  // dominate.
  let boost = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) {
      boost += titleTokens.has(kw) ? 10 : 5;
    }
  }
  score += Math.min(boost, 40);

  // Penalty: stock-library tokens. -10 each, capped at -30.
  let penalty = 0;
  for (const tok of STOCK_PENALTY_TOKENS) {
    if (haystack.includes(tok)) penalty += 10;
  }
  score -= Math.min(penalty, 30);

  // Steam / official-source mini-boost: anything from Steam, Wiki,
  // or the article hero is structurally relevant by definition.
  if (
    haystack.includes("steam") ||
    haystack.includes("wikipedia") ||
    haystack.includes("article_hero") ||
    haystack.includes("article_inline")
  ) {
    score += 8;
  }

  return score;
}

/**
 * Rank a list of images by combined source-priority + relevance.
 *
 * @param {Array<object>} images   each image SHOULD have a numeric
 *                                  `priority` field (the legacy
 *                                  source-priority). If not, 0 is
 *                                  assumed.
 * @param {object} story
 * @returns {Array<object>}        a NEW array sorted descending by
 *                                  combined score. Each entry gets
 *                                  a `_relevance` field added so
 *                                  callers can debug.
 */
function rankImagesByRelevance(images, story) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const { keywords, titleTokens } = buildStoryKeywords(story || {});
  const scored = images.map((img) => {
    const relevance = scoreImage(img, { keywords, titleTokens });
    const base = typeof img.priority === "number" ? img.priority : 0;
    return { ...img, _relevance: relevance, _combined: base + relevance };
  });
  scored.sort((a, b) => b._combined - a._combined);
  return scored;
}

module.exports = {
  rankImagesByRelevance,
  scoreImage,
  buildStoryKeywords,
  buildImageHaystack,
  tokenize,
  STOCK_PENALTY_TOKENS,
};
