/**
 * lib/studio/v2/hf-card-builders.js — content-aware HyperFrames card
 * builders for source / context / quote / takeaway.
 *
 * Each builder takes story-derived inputs, mutates a copy of the
 * template HTML, writes a per-story HF project under
 * experiments/hf-<kind>-<storyId>/, lints it, renders to MP4 at
 * test/output/hf_<kind>_card_<storyId>.mp4 and returns the output
 * path.
 *
 * The premium-card-lane-v2 module checks for `hf_<kind>_card_<id>.mp4`
 * first and falls back to the generic template render.
 *
 * Why this lives in lib/, not tools/: the orchestrator may want to
 * call buildAllStoryCards() programmatically before rendering to
 * keep the pipeline as one cohesive flow. The CLI in
 * tools/studio-v2-build-cards.js is the thin wrapper.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");
const { applyThemeToHtml, getChannelTheme } = require("./channel-themes");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TEMPLATE_DIR = path.join(ROOT, "experiments");
const TEST_OUT = path.join(ROOT, "test", "output");

/**
 * Build the disk paths for a per-story / per-channel card. When
 * channelId is the default 'pulse-gaming', paths fall back to the
 * legacy non-suffixed form so existing renders still resolve. Other
 * channels get their own suffixed namespace.
 */
function pathsFor(kind, storyId, channelId) {
  const isDefault = !channelId || channelId === "pulse-gaming";
  const suffix = isDefault ? "" : `__${channelId}`;
  return {
    projectDir: path.join(TEMPLATE_DIR, `hf-${kind}-${storyId}${suffix}`),
    outPath: path.join(TEST_OUT, `hf_${kind}_card_${storyId}${suffix}.mp4`),
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function copyProjectScaffold(srcDir, dstDir) {
  await fs.ensureDir(dstDir);
  await fs.ensureDir(path.join(dstDir, "assets"));
  await fs.copy(
    path.join(srcDir, "hyperframes.json"),
    path.join(dstDir, "hyperframes.json"),
  );
  // Copy backdrop if it exists in template
  const srcBackdrop = path.join(srcDir, "assets", "backdrop.jpg");
  if (await fs.pathExists(srcBackdrop)) {
    await fs.copy(srcBackdrop, path.join(dstDir, "assets", "backdrop.jpg"));
  }
}

async function writeMeta(dir, id) {
  await fs.writeJson(
    path.join(dir, "meta.json"),
    {
      id,
      name: id,
      createdAt: new Date().toISOString(),
    },
    { spaces: 2 },
  );
}

function lintAndRender(projectDir, outputPath) {
  console.log(`  · linting ${path.basename(projectDir)}…`);
  execSync("npx hyperframes lint", { cwd: projectDir, stdio: "inherit" });
  console.log(
    `  · rendering ${path.basename(projectDir)} → ${path.relative(ROOT, outputPath)}`,
  );
  execSync(
    `npx hyperframes render . -o "${outputPath.replace(/\\/g, "/")}" -f 30 -q standard`,
    { cwd: projectDir, stdio: "inherit" },
  );
}

// ---------------------------------------------------------------- //
// SOURCE CARD                                                      //
// ---------------------------------------------------------------- //

/**
 * Build a per-story source card.
 *
 * Inputs:
 *   storyId, sourceLabel (e.g. "r/GAMINGLEAKS"), sublabel (e.g.
 *   "VERIFIED"), kicker (e.g. "SOURCE"). Defaults preserve the
 *   template look.
 *
 * Auto-scales the label font size based on length so longer
 *   labels (e.g. "r/GAMINGLEAKSANDRUMOURS") still fit.
 */
async function buildStorySourceCard({
  storyId,
  sourceLabel = "r/GAMES",
  sublabel = "TRAILER REVEAL",
  kicker = "SOURCE",
  channelId = "pulse-gaming",
}) {
  const { projectDir, outPath } = pathsFor("source", storyId, channelId);
  await copyProjectScaffold(path.join(TEMPLATE_DIR, "hf-source"), projectDir);
  await writeMeta(projectDir, path.basename(projectDir));

  const tpl = await fs.readFile(
    path.join(TEMPLATE_DIR, "hf-source", "index.html"),
    "utf8",
  );

  // Auto-scale label
  const len = sourceLabel.length;
  let fontSize = 132;
  if (len > 16) fontSize = 96;
  if (len > 22) fontSize = 76;
  if (len > 28) fontSize = 60;

  let html = tpl.replace(
    /(\.label\s*\{[^}]*?font-size:\s*)\d+(px;)/,
    `$1${fontSize}$2`,
  );
  html = html.replace(
    /(<div id="kicker"[^>]*>)\s*[^<]+(<\/div>)/,
    `$1${escapeHtml(kicker)}$2`,
  );
  html = html.replace(
    /(<div\s+id="label"[\s\S]*?>)\s*[^<]+\s*(<\/div>)/,
    `$1\n            ${escapeHtml(sourceLabel)}\n          $2`,
  );
  html = html.replace(
    /(<div id="sublabel"[^>]*>)\s*[^<]+(<\/div>)/,
    `$1\n            ${escapeHtml(sublabel)}\n          $2`,
  );

  // Apply channel theme — replaces brand colour values throughout.
  html = applyThemeToHtml(html, getChannelTheme(channelId));

  await fs.writeFile(path.join(projectDir, "index.html"), html);

  lintAndRender(projectDir, outPath);
  return { outPath, projectDir, fontSize, channelId };
}

// ---------------------------------------------------------------- //
// CONTEXT / STAT CARD                                              //
// ---------------------------------------------------------------- //

/**
 * Build a per-story context card.
 *
 * Inputs:
 *   number   — the headline number/phrase (e.g. "7 YEARS", "12.4M")
 *   sub      — secondary uppercase label (e.g. "EXODUS LANDED IN 2019")
 *   micro    — tiny lowercase tag (e.g. "official reveal trailer")
 *   kicker   — "CONTEXT", "BACKGROUND", etc.
 */
async function buildStoryContextCard({
  storyId,
  number = "7 YEARS",
  sub = "",
  micro = "",
  kicker = "CONTEXT",
  channelId = "pulse-gaming",
}) {
  const { projectDir, outPath } = pathsFor("context", storyId, channelId);
  await copyProjectScaffold(path.join(TEMPLATE_DIR, "hf-context"), projectDir);
  await writeMeta(projectDir, path.basename(projectDir));

  const tpl = await fs.readFile(
    path.join(TEMPLATE_DIR, "hf-context", "index.html"),
    "utf8",
  );

  // Auto-scale the big number
  const numLen = String(number).length;
  let fontSize = 152;
  if (numLen > 8) fontSize = 132;
  if (numLen > 12) fontSize = 108;
  if (numLen > 18) fontSize = 84;

  let html = tpl.replace(
    /(\.number\s*\{[^}]*?font-size:\s*)\d+(px;)/,
    `$1${fontSize}$2`,
  );
  html = html.replace(
    /(<div id="kicker"[^>]*>)\s*[^<]+(<\/div>)/,
    `$1${escapeHtml(kicker)}$2`,
  );
  html = html.replace(
    /(<div\s+id="number"[\s\S]*?>)\s*[^<]+\s*(<\/div>)/,
    `$1\n            ${escapeHtml(number)}\n          $2`,
  );
  html = html.replace(
    /(<div id="sub"[^>]*>)\s*[^<]+(<\/div>)/,
    `$1${escapeHtml(sub)}$2`,
  );
  html = html.replace(
    /(<div id="micro"[^>]*>)\s*[^<]+(<\/div>)/,
    `$1\n            ${escapeHtml(micro)}\n          $2`,
  );

  // Apply channel theme
  html = applyThemeToHtml(html, getChannelTheme(channelId));

  await fs.writeFile(path.join(projectDir, "index.html"), html);

  lintAndRender(projectDir, outPath);
  return { outPath, projectDir, fontSize, channelId };
}

// ---------------------------------------------------------------- //
// TAKEAWAY CARD                                                    //
// ---------------------------------------------------------------- //

/**
 * Build a per-story takeaway card.
 *
 * Inputs:
 *   headlineWords  — array of words for the staggered reveal
 *                    (e.g. ["WATCH", "THE", "FULL", "TRAILER"])
 *   cta            — call-to-action line below the arrows
 *                    (default "FOLLOW FOR MORE")
 *   step           — small uppercase tag (default "03 / TAKEAWAY")
 *   kicker         — kicker line (default "THE BOTTOM LINE")
 */
async function buildStoryTakeawayCard({
  storyId,
  headlineWords = ["WATCH", "THE", "FULL", "TRAILER"],
  cta = "FOLLOW FOR MORE",
  step = "03 / TAKEAWAY",
  kicker = "THE BOTTOM LINE",
  channelId = "pulse-gaming",
}) {
  const { projectDir, outPath } = pathsFor("takeaway", storyId, channelId);
  await copyProjectScaffold(path.join(TEMPLATE_DIR, "hf-takeaway"), projectDir);
  await writeMeta(projectDir, path.basename(projectDir));

  const tpl = await fs.readFile(
    path.join(TEMPLATE_DIR, "hf-takeaway", "index.html"),
    "utf8",
  );

  // Auto-scale headline by total character count
  const totalChars = headlineWords.join(" ").length;
  let fontSize = 124;
  if (totalChars > 18) fontSize = 100;
  if (totalChars > 26) fontSize = 84;
  if (totalChars > 34) fontSize = 68;

  const wordsHtml = headlineWords
    .map((w) => `            <span class="word">${escapeHtml(w)}</span>`)
    .join("\n");

  let html = tpl.replace(
    /(\.headline\s*\{[^}]*?font-size:\s*)\d+(px;)/,
    `$1${fontSize}$2`,
  );
  html = html.replace(
    /(<div id="step"[^>]*>)\s*[^<]+(<\/div>)/,
    `$1${escapeHtml(step)}$2`,
  );
  html = html.replace(
    /(<div id="kicker"[^>]*>)\s*[^<]+(<\/div>)/,
    `$1${escapeHtml(kicker)}$2`,
  );
  html = html.replace(
    /(<div id="headline" class="headline">)[\s\S]*?(<\/div>)/,
    `$1\n${wordsHtml}\n          $2`,
  );
  html = html.replace(
    /(<div id="cta" class="cta">)\s*[^<]+(<\/div>)/,
    `$1${escapeHtml(cta)}$2`,
  );

  // Apply channel theme
  html = applyThemeToHtml(html, getChannelTheme(channelId));

  await fs.writeFile(path.join(projectDir, "index.html"), html);

  lintAndRender(projectDir, outPath);
  return { outPath, projectDir, fontSize, channelId };
}

// ---------------------------------------------------------------- //
// Story → card content derivation                                  //
// ---------------------------------------------------------------- //

/**
 * Given a DB story row + story package, derive content for all 4
 * cards. Returns:
 *   { source, context, quote, takeaway }
 * where each entry contains the kwargs for the corresponding
 * builder. Caller can pass through to buildStorySourceCard etc.
 */
function deriveCardContent({ story, pkg }) {
  const subreddit = story?.subreddit
    ? `r/${story.subreddit.toUpperCase()}`
    : null;
  const flair = story?.flair || pkg?.flair || "";
  const sourceLabel = subreddit || (story?.source_type || "NEWS").toUpperCase();
  const sublabel = flair ? flair.toUpperCase() : "TRAILER REVEAL";

  // Context card: try to find the most useful "context number" the
  // script offers — a year-gap, a money figure, a percentage. Fall
  // back to a generic flair-based phrase only when none is present.
  const tightened = pkg?.script?.tightened || story?.full_script || "";
  const corpus = `${story?.title || ""} ${tightened}`;
  let contextNumber = "BACKGROUND";
  let contextSub = (story?.title || "").toUpperCase().slice(0, 40);
  let contextMicro = "official reveal trailer";

  // Extract ALL plausible 4-digit years (1990-2099) — but FILTER OUT
  // future years above (currentYear + 1) because those are in-game
  // dates, far-future projections or game titles like "Metro 2039",
  // not release years. We're computing "years since the last
  // release", so we only want past-and-near-future years.
  //
  // Two cases:
  //   (a) Two or more PAST release years — pick the most distant
  //       valid pair (e.g. 1998 and 2007 → "9 YEARS / LAST ENTRY IN 1998")
  //   (b) One PAST release year — compute (currentYear − that year)
  //       (e.g. 2019 against today 2026 → "7 YEARS / LAST ENTRY IN 2019")
  const currentYear = new Date().getFullYear();
  const yearMatches = [...corpus.matchAll(/\b(19[9]\d|20\d{2})\b/g)].map((m) =>
    parseInt(m[1], 10),
  );
  const releaseYears = [...new Set(yearMatches)].filter(
    (y) => y >= 1990 && y <= currentYear + 1,
  );
  if (releaseYears.length >= 2) {
    let bestGap = 0;
    let earlier = null;
    for (let i = 0; i < releaseYears.length; i++) {
      for (let j = i + 1; j < releaseYears.length; j++) {
        const gap = Math.abs(releaseYears[i] - releaseYears[j]);
        if (gap > 1 && gap < 40 && gap > bestGap) {
          bestGap = gap;
          earlier = Math.min(releaseYears[i], releaseYears[j]);
        }
      }
    }
    if (bestGap > 0 && earlier !== null) {
      contextNumber = `${bestGap} YEARS`;
      contextSub = `LAST ENTRY IN ${earlier}`;
    }
  } else if (releaseYears.length === 1) {
    const y = releaseYears[0];
    const gap = currentYear - y;
    if (gap > 1 && gap < 40) {
      contextNumber = `${gap} YEARS`;
      contextSub = `LAST ENTRY IN ${y}`;
    }
  }

  if (contextNumber === "BACKGROUND") {
    const dollarMatch = corpus.match(/\$(\d+(?:\.\d+)?)([BMK]?)/);
    if (dollarMatch) {
      contextNumber = `$${dollarMatch[1]}${dollarMatch[2] || ""}`;
      contextSub = "REVENUE FIGURE";
    } else {
      const percentMatch = corpus.match(/(\d+(?:\.\d+)?)%/);
      if (percentMatch) {
        contextNumber = `${percentMatch[1]}%`;
        contextSub = "BY THE NUMBERS";
      }
    }
  }

  // Quote card
  const top = story?.top_comment || pkg?.quoteCandidates?.[0]?.body || "";
  // Pick a single short sentence from the comment
  let quoteText = "";
  let quoteAttribution = "READER";
  if (top) {
    const sentences = String(top).split(/(?<=[.!?])\s+/);
    const short = sentences.find((s) => s.length >= 8 && s.length <= 90);
    quoteText = (short || sentences[0] || "").trim();
    quoteAttribution = subreddit
      ? subreddit.toUpperCase()
      : (story?.source_type || "REDDIT").toUpperCase();
  }

  // Takeaway card. For "trailer reveal" stories the canonical
  // takeaway is "WATCH THE FULL TRAILER". For non-trailer, derive
  // from the title's primary subject.
  const titleHasTrailer = /\btrailer\b/i.test(story?.title || "");
  const titleHasReveal = /\breveal\b/i.test(story?.title || "");
  let headlineWords;
  if (titleHasTrailer || titleHasReveal) {
    headlineWords = ["WATCH", "THE", "FULL", "TRAILER"];
  } else if (/\b(release|launch)\b/i.test(story?.title || "")) {
    headlineWords = ["MARK", "THE", "DATE"];
  } else if (/\b(rumour|leak)\b/i.test(story?.flair || "")) {
    headlineWords = ["WAIT", "FOR", "CONFIRMATION"];
  } else {
    headlineWords = ["FOLLOW", "FOR", "MORE"];
  }

  return {
    source: {
      sourceLabel,
      sublabel,
      kicker: "SOURCE",
    },
    context: {
      number: contextNumber,
      sub: contextSub,
      micro: contextMicro,
      kicker: "CONTEXT",
    },
    quote: quoteText
      ? {
          quoteText,
          attribution: quoteAttribution,
          kind: "reddit",
        }
      : null,
    takeaway: {
      headlineWords,
      cta: "FOLLOW FOR MORE",
      step: "03 / TAKEAWAY",
      kicker: "THE BOTTOM LINE",
    },
  };
}

// ---------------------------------------------------------------- //
// All-cards convenience                                            //
// ---------------------------------------------------------------- //

/**
 * Build all 4 story-specific HF cards in one pass. Skips any card
 * type whose template is missing.
 *
 * Returns a manifest:
 *   { storyId, cards: { source: {...}, context: {...}, quote: {...},
 *                       takeaway: {...} }, generatedAt }
 */
async function buildAllStoryCards({
  story,
  pkg,
  options = {},
  channelId = "pulse-gaming",
}) {
  const storyId = story?.id;
  if (!storyId) throw new Error("buildAllStoryCards: story.id required");

  const content = deriveCardContent({ story, pkg });
  const manifest = {
    storyId,
    channelId,
    cards: {},
    generatedAt: new Date().toISOString(),
  };

  if (!options.skipSource) {
    manifest.cards.source = await buildStorySourceCard({
      storyId,
      ...content.source,
      channelId,
    });
  }
  if (!options.skipContext) {
    manifest.cards.context = await buildStoryContextCard({
      storyId,
      ...content.context,
      channelId,
    });
  }
  if (!options.skipQuote && content.quote) {
    const { buildStoryQuoteCard } = require(
      path.join(ROOT, "tools", "studio-v2-build-quote-card.js"),
    );
    manifest.cards.quote = await buildStoryQuoteCard({
      storyId,
      ...content.quote,
      channelId,
    });
  }
  if (!options.skipTakeaway) {
    manifest.cards.takeaway = await buildStoryTakeawayCard({
      storyId,
      ...content.takeaway,
      channelId,
    });
  }

  return manifest;
}

module.exports = {
  buildStorySourceCard,
  buildStoryContextCard,
  buildStoryTakeawayCard,
  buildAllStoryCards,
  deriveCardContent,
};
