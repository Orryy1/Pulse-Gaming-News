/**
 * lib/studio/v2/story-package.js — story package builder.
 *
 * For a chosen story, produces a structured JSON package with:
 *   - strongest story angle
 *   - 5–10 hook variants (LLM-generated)
 *   - chosen final hook
 *   - editorially tightened spoken script
 *   - pronunciation/number map
 *   - media inventory + diversity score
 *   - candidate scene types
 *   - quote/comment + stat candidates
 *   - risk flags
 *   - premium-lane viability score
 *
 * The package is a real artifact written to test/output/<id>_studio_v2_package.json.
 * It's also returned as an object so the v2 renderer can consume it directly.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_OUT = path.join(ROOT, "test", "output");

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
  "reportedly",
  "apparently",
  "game",
  "games",
  "gaming",
  "just",
  "right",
]);

function tokenise(s) {
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
    .map(([t, c]) => ({ word: t, count: c }));
}

function loadStory(storyId) {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(ROOT, "data", "pulse.db"), {
    readonly: true,
  });
  // Some columns are optional — pull only what's guaranteed by the schema.
  const row = db
    .prepare(
      `SELECT id, title, hook, body, full_script, classification,
              flair, subreddit, source_type, top_comment, article_image
       FROM stories WHERE id = ?`,
    )
    .get(storyId);
  db.close();
  return row;
}

/**
 * Detect digit-bearing tokens in the script and emit a
 * pronunciation/number map. The TTS preprocessor uses this to
 * substitute spoken-form into the audio while captions keep the
 * digit form.
 */
function buildPronunciationMap(text) {
  const map = [];
  // 4-digit years 1900-2099
  const yearRe = /\b(19|20)(\d{2})\b/g;
  let m;
  while ((m = yearRe.exec(text)) !== null) {
    const decadeStr = m[1] === "19" ? "nineteen" : "twenty";
    const last2 = parseInt(m[2], 10);
    const lastWords = numberToWords(last2);
    map.push({
      written: m[0],
      spoken: `${decadeStr} ${lastWords}`,
      kind: "year",
      offset: m.index,
    });
  }
  // Single digits in phrases like "GTA 6", "Metro 2039"
  const singleDigitRe = /\b([A-Z]{2,})\s+(\d{1,2})\b/g;
  while ((m = singleDigitRe.exec(text)) !== null) {
    map.push({
      written: m[0],
      spoken: `${m[1].split("").join(" ")} ${numberToWords(parseInt(m[2], 10))}`,
      kind: "acronym-number",
      offset: m.index,
    });
  }
  // Money: $5B, $1.2M
  const moneyRe = /\$([\d.]+)([BMK]?)/g;
  while ((m = moneyRe.exec(text)) !== null) {
    const num = parseFloat(m[1]);
    const suffix = m[2];
    let spoken = `${num}`;
    if (suffix === "B") spoken = `${num} billion`;
    else if (suffix === "M") spoken = `${num} million`;
    else if (suffix === "K") spoken = `${num} thousand`;
    map.push({
      written: m[0],
      spoken,
      kind: "money",
      offset: m.index,
    });
  }
  return map;
}

function numberToWords(n) {
  const ones = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];
  if (n < 20) return ones[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o === 0 ? tens[t] : `${tens[t]}-${ones[o]}`;
  }
  return String(n);
}

/**
 * Discover the local media inventory for a story. Reads from
 * output/image_cache + output/video_cache + DB downloaded_images.
 */
async function buildMediaInventory(storyId) {
  const cache = path.join(ROOT, "output", "image_cache");
  const vc = path.join(ROOT, "output", "video_cache");

  const trailerClips = [];
  if (await fs.pathExists(vc)) {
    const files = await fs.readdir(vc);
    for (const f of files) {
      if (
        f.startsWith(`${storyId}_clip_`) &&
        (f.endsWith(".mp4") || f.endsWith(".webm"))
      ) {
        const p = path.join(vc, f);
        try {
          const d = parseFloat(
            execSync(
              `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${p.replace(/\\/g, "/")}"`,
              { encoding: "utf8" },
            ).trim(),
          );
          trailerClips.push({ path: p, durationS: d, source: "trailer" });
        } catch {}
      }
    }
  }

  const trailerFrames = [];
  const articleHeroes = [];
  const articleInline = [];
  const stockFiller = [];
  if (await fs.pathExists(cache)) {
    const files = await fs.readdir(cache);
    for (const f of files) {
      if (!f.startsWith(`${storyId}_`)) continue;
      if (f.includes("_smartcrop")) continue; // skip cropped variants
      if (!/\.(jpg|jpeg|png)$/i.test(f)) continue;
      const p = path.join(cache, f);
      if (f.includes("_trailerframe_")) {
        trailerFrames.push({ path: p, source: "trailer-frame" });
      } else if (f.includes("_article_inline")) {
        articleInline.push({ path: p, source: "article-inline" });
      } else if (f.includes("_article")) {
        articleHeroes.push({ path: p, source: "article-hero" });
      } else if (
        f.includes("_pexels") ||
        f.includes("_unsplash") ||
        f.includes("_bing")
      ) {
        stockFiller.push({ path: p, source: "stock" });
      } else if (f.includes("_steam")) {
        articleHeroes.push({ path: p, source: "steam" });
      }
    }
  }

  return {
    trailerClips,
    trailerFrames,
    articleHeroes,
    articleInline,
    publisherAssets: [],
    stockFiller,
  };
}

function scoreSourceDiversity(inventory) {
  const topical =
    inventory.trailerClips.length +
    inventory.trailerFrames.length +
    inventory.articleHeroes.length +
    inventory.articleInline.length +
    inventory.publisherAssets.length;
  const stock = inventory.stockFiller.length;
  const total = topical + stock;
  if (total === 0) return { score: 0, topicalRatio: 0 };
  const topicalRatio = topical / total;
  // Score also rewards CLIP presence — clips count double
  const weighted =
    inventory.trailerClips.length * 2 +
    inventory.trailerFrames.length +
    inventory.articleHeroes.length +
    inventory.articleInline.length;
  return {
    score: Math.min(100, Math.round((weighted / Math.max(8, total)) * 100)),
    topicalRatio: Number(topicalRatio.toFixed(2)),
    topicalCount: topical,
    stockCount: stock,
  };
}

/**
 * Without an LLM call, generate hook variants by template-mining
 * the story's hook + title + body. This is the "always works
 * offline" fallback. The Anthropic call (when available) replaces
 * this with higher-quality variants.
 */
function generateOfflineHookVariants(story) {
  const title = story?.title || "";
  const hook = story?.hook || "";
  const body = story?.body || "";
  const corpus = `${title} ${hook} ${body}`;

  // Extract the strongest noun phrase: capitalised title + first
  // numeric (year/version) + the most-frequent body keyword.
  const tokens = tokenise(corpus);
  const top = topByFrequency(tokens, 3);
  const game =
    title.match(/\b([A-Z][A-Za-z]*\s+\d{1,4})\b/)?.[0] ||
    title.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\b/)?.[0] ||
    top[0]?.word ||
    "this";

  // Hand-built templates — TikTok-style cold-opens.
  const templates = [
    `${game} is real, and the reveal is unusually grim.`,
    `${game} just dropped, and nobody saw this coming.`,
    `Nothing about ${game} is what fans expected.`,
    `${game} broke its silence, and the answer is dark.`,
    `${game} was supposed to be loud — it came back quiet.`,
    `${game} is back, and it is not the game you remember.`,
    `${game} returned with one detail nobody flagged.`,
    `${game} is here, and one frame says everything.`,
    `${game} just confirmed the timeline you didn't think possible.`,
    `${game} broke cover — the trailer says more than the press release.`,
  ];

  return templates.map((text, idx) => ({
    text,
    rank: idx + 1,
    wordCount: text.split(/\s+/).length,
    hasAiTell:
      /you won't believe|this changes everything|but here'?s where|let that sink in/i.test(
        text,
      ),
    source: "offline-template",
  }));
}

/**
 * Optionally call the Anthropic API for higher-quality hook variants.
 * Returns null if no API key. The package step is non-blocking on
 * this — falls back to the offline templates.
 */
async function generateLlmHookVariants(story, options = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (options.skipLlm) return null;
  try {
    const Anthropic =
      require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = [
      "You are a TikTok/Shorts editor for Pulse Gaming, writing 1–2 second cold-open hooks for gaming news shorts.",
      "Your hooks must:",
      "- Be one sentence, 8–12 words.",
      "- Land one specific concrete claim, not generic suspense.",
      "- Use British English. No 'you won't believe', no 'this changes everything', no 'but here is where it gets interesting'.",
      "- Sound like a real human editor, not an AI.",
      "- End with a period, not a question or ellipsis.",
      "",
      "Story title: " + (story.title || ""),
      "",
      "Story script:",
      story.full_script || story.body || "",
      "",
      'Generate exactly 8 distinct hook variants. Return a JSON array of strings, no prose, no markdown, no commentary. Just: ["hook 1", "hook 2", ..., "hook 8"]',
    ].join("\n");
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.content?.[0]?.text || "";
    const parsed = JSON.parse(text.trim());
    if (!Array.isArray(parsed)) return null;
    return parsed.slice(0, 10).map((h, i) => ({
      text: String(h).trim(),
      rank: i + 1,
      wordCount: String(h).trim().split(/\s+/).length,
      hasAiTell:
        /you won't believe|this changes everything|but here'?s where|let that sink in/i.test(
          String(h),
        ),
      source: "claude-haiku-4-5",
    }));
  } catch (err) {
    console.log(`[story-package] LLM hook generation failed: ${err.message}`);
    return null;
  }
}

/**
 * Build a comprehensive story package. Writes to disk + returns the
 * object.
 */
async function buildStoryPackage(storyId, opts = {}) {
  const story = loadStory(storyId);
  if (!story) throw new Error(`no DB row for ${storyId}`);

  // Hook variants — try LLM first, fall back to template
  const llmHooks = await generateLlmHookVariants(story, opts);
  const offlineHooks = generateOfflineHookVariants(story);
  const hookVariants = llmHooks || offlineHooks;

  // Pick the chosen hook: first variant that passes the rubric
  // (8–12 words, no AI tell). Fall back to first.
  const chosen =
    hookVariants.find(
      (h) => h.wordCount >= 8 && h.wordCount <= 12 && !h.hasAiTell,
    ) || hookVariants[0];

  // Editorial-tightened script — strip filler phrases, normalise
  // sentence-end spacing
  const rawScript =
    story.full_script || `${story.hook || ""} ${story.body || ""}`.trim();
  const tightenedScript = rawScript
    .replace(
      /\bbut\s+here(?:'s|\s+is)\s+where\s+it\s+gets\s+interesting\b[.,]?/gi,
      "",
    )
    .replace(/\byou\s+won(?:'t|\s+not)\s+believe\s+what\b/gi, "")
    .replace(/\bthis\s+changes\s+everything\b[.,]?/gi, "")
    .replace(/\band\s+that(?:'s|\s+is)\s+not\s+all\b[.,]?/gi, "")
    .replace(/\blet\s+that\s+sink\s+in\b[.,]?/gi, "")
    .replace(/\bobviously,?\s+/gi, "")
    .replace(/\bbasically,?\s+/gi, "")
    .replace(/\bessentially,?\s+/gi, "")
    .replace(/^so[,\s]+/i, "")
    .replace(/^right[,\s]+/i, "")
    .replace(/^look[,\s]+/i, "")
    .replace(/([.!?])([A-Z])/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Pronunciation map for digits / acronyms
  const pronunciationMap = buildPronunciationMap(tightenedScript);

  // Media inventory + diversity score
  const inventory = await buildMediaInventory(storyId);
  const diversityScore = scoreSourceDiversity(inventory);

  // Candidate scene types based on what data is available
  const candidateScenes = [];
  candidateScenes.push({ type: "opener", available: true });
  if (inventory.trailerClips.length > 0) {
    candidateScenes.push({
      type: "clip",
      available: true,
      count: inventory.trailerClips.length,
    });
    candidateScenes.push({
      type: "punch",
      available: true,
      note: "1.5–2s micro-cuts from trailer clips",
    });
    candidateScenes.push({
      type: "speed-ramp",
      available: true,
      note: "speed change for emphasis",
    });
    candidateScenes.push({
      type: "freeze-frame",
      available: true,
      note: "frozen frame with caption beat",
    });
  }
  if (inventory.trailerFrames.length > 0) {
    candidateScenes.push({
      type: "clip-frame",
      available: true,
      count: inventory.trailerFrames.length,
    });
  }
  if (
    inventory.articleHeroes.length > 0 ||
    inventory.articleInline.length > 0
  ) {
    candidateScenes.push({
      type: "still",
      available: true,
      count: inventory.articleHeroes.length + inventory.articleInline.length,
    });
  }
  candidateScenes.push({
    type: "card.source",
    available: !!(story.subreddit || story.source_type),
  });
  candidateScenes.push({
    type: "card.quote",
    available: !!story.top_comment,
  });
  candidateScenes.push({
    type: "card.release",
    available: true,
    note: "uses 'KNOWN UNKNOWN' framing if no date metadata",
  });
  candidateScenes.push({
    type: "card.stat",
    available: !!(story.steam_review_score || story.steam_player_count),
  });
  candidateScenes.push({ type: "card.takeaway", available: true });

  // Quote / stat candidates
  const quoteCandidates = [];
  if (story.top_comment) {
    quoteCandidates.push({
      kind: "reddit-top-comment",
      author: "Redditor",
      body: story.top_comment,
      score: null,
    });
  }
  const statCandidates = [];
  if (story.steam_review_score) {
    statCandidates.push({
      kind: "steam-review",
      label: `${story.steam_review_score}% Positive`,
    });
  }
  if (story.steam_player_count) {
    statCandidates.push({
      kind: "steam-players",
      label: `${Number(story.steam_player_count).toLocaleString()} Playing`,
    });
  }

  // Risk flags
  const riskFlags = [];
  if (inventory.trailerClips.length === 0) {
    riskFlags.push({
      severity: "high",
      flag: "no-trailer-clips",
      note: "Premium lane requires real video footage. Will reject without clips.",
    });
  }
  if (inventory.trailerFrames.length + inventory.articleHeroes.length < 3) {
    riskFlags.push({
      severity: "high",
      flag: "thin-still-set",
      note: "Less than 3 unique stills — anti-repetition gate will trigger.",
    });
  }
  if (
    inventory.stockFiller.length > 0 &&
    inventory.trailerClips.length + inventory.trailerFrames.length === 0
  ) {
    riskFlags.push({
      severity: "high",
      flag: "stock-only",
      note: "Only stock photos available — would feel like generic AI slideshow.",
    });
  }
  if (chosen.wordCount < 8 || chosen.wordCount > 12) {
    riskFlags.push({
      severity: "medium",
      flag: "hook-word-count",
      note: `Chosen hook is ${chosen.wordCount} words (target 8–12).`,
    });
  }
  if (chosen.hasAiTell) {
    riskFlags.push({
      severity: "high",
      flag: "ai-tell-in-hook",
      note: "Chosen hook contains an AI-tell phrase.",
    });
  }
  if (pronunciationMap.length === 0 && /\b\d{4}\b/.test(rawScript)) {
    riskFlags.push({
      severity: "low",
      flag: "no-pronunciation-map",
      note: "Script has years but pronunciation map is empty.",
    });
  }

  // Premium-lane viability score. Only counts AVAILABLE premium
  // assets (clips, frames, article media). Stock filler in the
  // cache is ignored — the composer rejects it in premium lane,
  // so its presence shouldn't drag down the score.
  let viability = 100;
  if (inventory.trailerClips.length === 0) viability -= 50;
  else if (inventory.trailerClips.length === 1) viability -= 15;
  const topicalStills =
    inventory.trailerFrames.length +
    inventory.articleHeroes.length +
    inventory.articleInline.length;
  if (topicalStills < 3) viability -= 25;
  else if (topicalStills < 5) viability -= 10;
  if (chosen.hasAiTell) viability -= 25;
  if (chosen.wordCount < 8 || chosen.wordCount > 12) viability -= 10;
  if (riskFlags.filter((r) => r.severity === "high").length > 0)
    viability -= 15;
  viability = Math.max(0, viability);

  const pkg = {
    storyId,
    generatedAt: new Date().toISOString(),
    title: story.title,
    flair: story.flair || story.classification,
    subreddit: story.subreddit,
    angle:
      story.hook?.split(/[.!?]/)[0]?.trim() ||
      story.title?.split(/[—\-:]/)[0]?.trim() ||
      "",
    hook: {
      chosen,
      variants: hookVariants,
      source: llmHooks ? "claude-haiku-4-5" : "offline-template",
    },
    script: {
      raw: rawScript,
      tightened: tightenedScript,
      wordCountRaw: rawScript.split(/\s+/).filter(Boolean).length,
      wordCountTightened: tightenedScript.split(/\s+/).filter(Boolean).length,
    },
    pronunciationMap,
    mediaInventory: inventory,
    sourceMix: diversityScore,
    candidateScenes,
    quoteCandidates,
    statCandidates,
    riskFlags,
    viability: {
      score: viability,
      verdict:
        viability >= 70
          ? "premium-eligible"
          : viability >= 40
            ? "downgrade"
            : "reject",
    },
  };

  // Write to disk
  await fs.ensureDir(TEST_OUT);
  const outPath = path.join(TEST_OUT, `${storyId}_studio_v2_package.json`);
  await fs.writeJson(outPath, pkg, { spaces: 2 });
  return { pkg, outPath };
}

module.exports = {
  buildStoryPackage,
  buildMediaInventory,
  scoreSourceDiversity,
  buildPronunciationMap,
  generateOfflineHookVariants,
  generateLlmHookVariants,
};
