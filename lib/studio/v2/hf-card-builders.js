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
const { fitQuoteText } = require("./quote-fit");

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

function clampCardText(value, { maxWords = 12, maxChars = 96 } = {}) {
  return fitQuoteText(value, {
    maxWords: Math.min(Number(maxWords) || 12, 11),
    maxChars: Math.min(Number(maxChars) || 96, 84),
    maxCharsPerLine: 28,
    maxLines: 3,
    maxTokenChars: 22,
  });
}

const GENERIC_AUDIENCE_CTA_RE =
  /\b(?:follow(?![- ]?up\b)|subscribe|like\s+(?:and\s+)?subscribe|stay\s+tuned|turn\s+on\s+(?:the\s+)?notifications?|never\s+miss)\b|\bfor\s+more\b/i;

function normaliseEditorialText(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:#0?39|apos);/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericAudienceCta(value) {
  return GENERIC_AUDIENCE_CTA_RE.test(normaliseEditorialText(value));
}

function safeTakeawayHeadlineWords(words) {
  const values = (Array.isArray(words) ? words : String(words || "").split(/\s+/))
    .map((word) =>
      normaliseEditorialText(word).replace(/[^a-z0-9\u00c0-\u017f'&+-]/gi, ""),
    )
    .filter(Boolean)
    .slice(0, 5)
    .map((word) => word.toUpperCase());
  if (!values.length || isGenericAudienceCta(values.join(" "))) {
    return ["PLAYER", "IMPACT"];
  }
  return values;
}

function safeTakeawayStrap(value, fallback = "WHAT CHANGES FOR PLAYERS") {
  const strap = normaliseEditorialText(value).toUpperCase();
  const fallbackStrap = normaliseEditorialText(fallback).toUpperCase();
  if (strap && !isGenericAudienceCta(strap)) return strap;
  if (fallbackStrap && !isGenericAudienceCta(fallbackStrap)) {
    return fallbackStrap;
  }
  return "WHAT CHANGES FOR PLAYERS";
}

function scriptValueText(value) {
  if (typeof value === "string") return normaliseEditorialText(value);
  if (!value || typeof value !== "object") return "";
  return normaliseEditorialText(
    value.tightened || value.raw || value.full_script || value.body || value.text,
  );
}

function claimText(value) {
  if (typeof value === "string") return normaliseEditorialText(value);
  if (!value || typeof value !== "object") return "";
  return normaliseEditorialText(
    value.claim || value.text || value.body || value.summary || value.detail,
  );
}

function claimTexts(...values) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
    .map(claimText)
    .filter(Boolean);
}

function stripAudienceCta(value) {
  const text = normaliseEditorialText(value);
  const marker = text.search(
    /\b(?:follow(?![- ]?up\b)|subscribe|like\s+(?:and\s+)?subscribe|stay\s+tuned|turn\s+on\s+(?:the\s+)?notifications?)\b/i,
  );
  return normaliseEditorialText(marker >= 0 ? text.slice(0, marker) : text)
    .replace(/[.!?,;:]+$/, "")
    .trim();
}

function takeawayEvidence(story = {}, pkg = {}) {
  const script = [
    pkg.script,
    story.script,
    story.full_script,
    story.body,
    pkg.full_script,
    pkg.body,
  ]
    .map(scriptValueText)
    .find(Boolean) || "";
  const closing = script
    .split(/(?<=[.!?])\s+/)
    .map(stripAudienceCta)
    .filter((sentence) => sentence && !isGenericAudienceCta(sentence))
    .slice(-4);
  const claims = claimTexts(
    story.confirmed_claims,
    story.claims,
    story.claim_inventory,
    story.source_evidence?.claims,
    pkg.confirmed_claims,
    pkg.claims,
    pkg.claim_inventory,
    pkg.source_evidence?.claims,
  );
  const title = normaliseEditorialText(story.title || pkg.title);
  return {
    priority: [...closing].reverse().concat(claims, title ? [title] : []),
    corpus: normaliseEditorialText(
      [title, script, ...closing, ...claims].filter(Boolean).join(" "),
    ),
  };
}

function contrastHeadline(evidence) {
  for (const sentence of evidence) {
    const contrast = sentence.match(
      /\binto\s+(?:a|an|the)?\s*([a-z][a-z'-]*)[\s\S]*?\binstead of\s+(?:a|an|the)?\s*([a-z][a-z'-]*)/i,
    );
    if (contrast) {
      return safeTakeawayHeadlineWords([contrast[1], "NOT", contrast[2]]);
    }
  }
  return null;
}

function deriveEditorialTakeaway({ story = {}, pkg = {} } = {}) {
  const evidence = takeawayEvidence(story, pkg);
  const corpus = evidence.corpus;
  const microtransactions = /\bmicro[- ]?transactions?\b|\bin[- ]game purchases?\b/i.test(corpus);
  const dlcPacks = /\b(?:day[- ]one\s+)?DLC\s+packs?\b|\bDLC\b/i.test(corpus);
  const monetisation = microtransactions || dlcPacks || /\bmoneti[sz]ation\b|\bpaid (?:extras?|currency|content)\b/i.test(corpus);
  const trust = /\b(?:players?['\u2019]?\s+|player\s+)?trust\b|\bgoodwill\b/i.test(corpus);
  const nostalgia = /\bnostalgi(?:a|c)\b/i.test(corpus);
  const paywall = /\bpaywall\b/i.test(corpus);
  const noPaywall = /\bno\s+paywall\b|\bwithout\s+(?:a\s+)?paywall\b/i.test(corpus);
  const access = /\baccess\b|\bavailable to (?:all|every) players?\b/i.test(corpus);
  const price = /\b(?:price|pricing|costs?|paid)\b|[$\u00a3\u20ac]\s*\d/i.test(corpus);
  const releaseTiming = /\brelease date\b|\blaunch date\b|\brelease window\b|\blaunch window\b|\bdelay(?:ed|s)?\b/i.test(corpus);
  const grind = /\bgrind(?:ing)?\b/i.test(corpus);
  const playerTime = /\bplayers?['\u2019]?\s+time\b|\bsaves?\s+(?:players?\s+)?hours?\b/i.test(corpus);
  const controls = /\bcontrols?\b|\bcombat\b/i.test(corpus);
  const gameplay = controls || /\bgameplay\b/i.test(corpus);
  const performance = /\bperformance\b|\bframe rate\b|\bfps\b/i.test(corpus);
  const ownership = /\bownership\b|\bowners?\b|\bbuying twice\b/i.test(corpus);
  const value = /\bvalue\b|\bworth\b/i.test(corpus);
  const blockedSaveTransfer =
    /\b(?:save(?: data)?|progress)\b[^.!?]{0,48}\b(?:cannot|can't|won't|doesn't|does not|will not)\s+(?:be\s+)?transfer(?:red)?\b/i.test(corpus) ||
    /\bno\s+(?:save(?: data)?|progress)\s+transfer\b/i.test(corpus);
  const switch2Edition = /\bswitch\s*2\s+edition\b/i.test(corpus);
  const costsMoreThanGame = /\bcost(?:s|ing)?\s+more\s+than\s+(?:the\s+)?(?:base\s+)?game\b/i.test(corpus);
  const pricingFight = /\bpricing\s+fight\b/i.test(corpus);
  const firstWeekSales =
    /\b(?:sold|sales(?:\s+(?:reached|hit))?)\s+(?:more\s+than\s+|over\s+)?\d+(?:\.\d+)?\s+million\b[^.!?]{0,80}\b(?:one|first)\s+week\b/i.test(corpus);
  const dayOneSales = /\b\d+(?:\.\d+)?\s+million\b[^.!?]{0,50}\bday\s+one\b/i.test(corpus);
  const secondWaveSales =
    /\b(?:another\s+(?:one\s+)?million|second[- ]wave(?:\s+million|\s+sales?)?)\b|\bword of mouth\b/i.test(corpus);

  let headlineWords = contrastHeadline(evidence.priority);
  if (!headlineWords && blockedSaveTransfer) {
    headlineWords = ["SAVE", "DATA", "WON'T", "TRANSFER"];
  } else if (!headlineWords && firstWeekSales && dayOneSales && secondWaveSales) {
    headlineWords = ["SECOND", "WAVE", "BEATS", "LAUNCH", "HYPE"];
  } else if (!headlineWords && dlcPacks && price && costsMoreThanGame) {
    headlineWords = ["DLC", "COSTS", "MORE", "THAN", "GAME"];
  } else if (!headlineWords && nostalgia && trust && monetisation) {
    headlineWords = ["NOSTALGIA", "VERSUS", "TRUST"];
  } else if (!headlineWords && monetisation && trust) {
    headlineWords = ["PLAYER", "TRUST", "IS", "THE", "TEST"];
  } else if (!headlineWords && nostalgia && trust) {
    headlineWords = ["NOSTALGIA", "VERSUS", "TRUST"];
  } else if (!headlineWords && noPaywall) {
    headlineWords = ["ACCESS", "WITHOUT", "A", "PAYWALL"];
  } else if (!headlineWords && price && access) {
    headlineWords = ["PRICE", "SHAPES", "PLAYER", "ACCESS"];
  } else if (!headlineWords && releaseTiming) {
    headlineWords = ["TIMING", "CHANGES", "THE", "DECISION"];
  } else if (!headlineWords && grind && playerTime) {
    headlineWords = ["GRIND", "VERSUS", "PLAYER", "TIME"];
  } else if (!headlineWords && gameplay) {
    headlineWords = ["GAMEPLAY", "HAS", "TO", "DELIVER"];
  } else if (!headlineWords && performance) {
    headlineWords = ["PERFORMANCE", "IS", "THE", "TEST"];
  } else if (!headlineWords && ownership && value) {
    headlineWords = ["OWNERSHIP", "CHANGES", "THE", "VALUE"];
  }

  let strap = "WHAT CHANGES FOR PLAYERS";
  if (blockedSaveTransfer && switch2Edition) {
    strap = "SWITCH 2 EDITION MEANS STARTING OVER";
  } else if (blockedSaveTransfer) {
    strap = "THE NEW EDITION MEANS STARTING OVER";
  } else if (firstWeekSales && dayOneSales && secondWaveSales) {
    strap = "WORD OF MOUTH WON";
  } else if (dlcPacks && pricingFight) {
    strap = "DAY-ONE DLC STARTS A PRICING FIGHT";
  } else if (microtransactions && trust) {
    strap = "MICROTRANSACTIONS TEST PLAYER TRUST";
  } else if (monetisation && trust) {
    strap = "MONETISATION TESTS PLAYER TRUST";
  } else if (noPaywall) {
    strap = "NO PAYWALL FOR PLAYERS";
  } else if (paywall && access) {
    strap = "THE PAYWALL CHANGES ACCESS";
  } else if (price && access) {
    strap = "PRICE CHANGES PLAYER ACCESS";
  } else if (nostalgia && trust) {
    strap = "NOSTALGIA HAS TO EARN TRUST";
  } else if (releaseTiming) {
    strap = "RELEASE TIMING CHANGES THE DECISION";
  } else if (grind && playerTime) {
    strap = "THE GRIND TESTS PLAYER TIME";
  } else if (controls) {
    strap = "CONTROLS DECIDE THE PAYOFF";
  } else if (gameplay) {
    strap = "THE GAMEPLAY IS THE TEST";
  } else if (performance) {
    strap = "PERFORMANCE CHANGES THE DECISION";
  } else if (ownership && value) {
    strap = "OWNERSHIP CHANGES THE VALUE";
  }

  return {
    headlineWords: safeTakeawayHeadlineWords(headlineWords),
    strap: safeTakeawayStrap(
      story.takeaway_strap || story.card_takeaway_strap || pkg.takeaway_strap || strap,
    ),
  };
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
 *   cta - story-specific editorial strap below the arrows
 *         (default "WHAT CHANGES FOR PLAYERS")
 *   step           — small uppercase tag (default "03 / TAKEAWAY")
 *   kicker         — kicker line (default "THE BOTTOM LINE")
 */
async function buildStoryTakeawayCard({
  storyId,
  headlineWords = ["PLAYER", "IMPACT"],
  cta = "WHAT CHANGES FOR PLAYERS",
  step = "03 / TAKEAWAY",
  kicker = "THE BOTTOM LINE",
  channelId = "pulse-gaming",
}) {
  const safeHeadlineWords = safeTakeawayHeadlineWords(headlineWords);
  const editorialStrap = safeTakeawayStrap(cta);
  const { projectDir, outPath } = pathsFor("takeaway", storyId, channelId);
  await copyProjectScaffold(path.join(TEMPLATE_DIR, "hf-takeaway"), projectDir);
  await writeMeta(projectDir, path.basename(projectDir));

  const tpl = await fs.readFile(
    path.join(TEMPLATE_DIR, "hf-takeaway", "index.html"),
    "utf8",
  );

  // Auto-scale headline by total character count
  const totalChars = safeHeadlineWords.join(" ").length;
  let fontSize = 124;
  if (totalChars > 18) fontSize = 100;
  if (totalChars > 26) fontSize = 84;
  if (totalChars > 34) fontSize = 68;

  const wordsHtml = safeHeadlineWords
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
    `$1${escapeHtml(editorialStrap)}$2`,
  );

  // Apply channel theme
  html = applyThemeToHtml(html, getChannelTheme(channelId));

  await fs.writeFile(path.join(projectDir, "index.html"), html);

  lintAndRender(projectDir, outPath);
  return { outPath, projectDir, fontSize, channelId };
}

// ---------------------------------------------------------------- //
// TIMELINE / "WHAT WE KNOW" CARD (v2.1 — authored mid-slate beat)  //
// ---------------------------------------------------------------- //

/**
 * Build a per-story timeline card. The "what we know" beat — heading
 * + 3 numbered bullets, each with a bold lead phrase + comma-separated
 * detail. Designed to break up visually-similar mid-slate frame
 * scenes with a genuinely different authored register.
 *
 * Inputs:
 *   heading   — primary subject (e.g. "METRO 2039")
 *   kicker    — kicker line (default "WHAT WE KNOW")
 *   bullets   — array of { lead, detail } pairs (max 3)
 *
 * Replaces the bullet markup in the template's #bullets list with
 * the supplied content, preserving the GSAP stagger animation.
 */
async function buildStoryTimelineCard({
  storyId,
  heading,
  kicker = "WHAT WE KNOW",
  bullets = [],
  channelId = "pulse-gaming",
}) {
  const { projectDir, outPath } = pathsFor("timeline", storyId, channelId);
  await copyProjectScaffold(path.join(TEMPLATE_DIR, "hf-timeline"), projectDir);
  await writeMeta(projectDir, path.basename(projectDir));

  const tpl = await fs.readFile(
    path.join(TEMPLATE_DIR, "hf-timeline", "index.html"),
    "utf8",
  );

  // Auto-scale heading by character count
  const headingLen = String(heading || "").length;
  let fontSize = 60;
  if (headingLen > 12) fontSize = 52;
  if (headingLen > 18) fontSize = 44;

  const safeBullets = (bullets || []).slice(0, 3);
  while (safeBullets.length < 3) {
    safeBullets.push({ lead: "", detail: "" });
  }

  const bulletsHtml = safeBullets
    .map((b, i) => {
      const num = String(i + 1).padStart(2, "0");
      const lead = escapeHtml(String(b.lead || "").trim());
      const detail = escapeHtml(String(b.detail || "").trim());
      // Comma + space connective — never em dashes (editorial rule).
      const sep = lead && detail ? ", " : "";
      return `            <li>
              <span class="num">${num}</span>
              <span class="copy"><strong>${lead}</strong>${sep}${detail}</span>
            </li>`;
    })
    .join("\n");

  let html = tpl.replace(
    /(\.heading\s*\{[^}]*?font-size:\s*)\d+(px;)/,
    `$1${fontSize}$2`,
  );
  html = html.replace(
    /(<div id="kicker"[^>]*>)\s*[^<]+(<\/div>)/,
    `$1${escapeHtml(kicker)}$2`,
  );
  html = html.replace(
    /(<div id="heading"[^>]*>)\s*[^<]+(<\/div>)/,
    `$1${escapeHtml(String(heading || "").toUpperCase())}$2`,
  );
  html = html.replace(
    /(<ul id="bullets"[^>]*>)[\s\S]*?(<\/ul>)/,
    `$1\n${bulletsHtml}\n          $2`,
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
    quoteText = clampCardText(short || sentences[0] || "");
    quoteAttribution = subreddit
      ? subreddit.toUpperCase()
      : (story?.source_type || "REDDIT").toUpperCase();
  }

  // Closing narration and sourced claims outrank title copy for the payoff.
  const titleHasTrailer = /\btrailer\b/i.test(story?.title || "");
  const titleHasReveal = /\breveal\b/i.test(story?.title || "");
  const editorialTakeaway = deriveEditorialTakeaway({ story, pkg });

  // Timeline card: 3 bullets summarising the news as a "what we know"
  // beat. Heuristics:
  //   - Bullet 1: status anchor (Trailer live / Leak surfaced / etc.)
  //   - Bullet 2: a content thread mined from the script (theme,
  //     studio, gameplay focus)
  //   - Bullet 3: an evidence-gap or unknown (no date, no platforms,
  //     unverified, etc.)
  const timelineHeading = (() => {
    const t = String(story?.title || "");
    const subjectMatch =
      t.match(/\b([A-Z][A-Za-z]*\s+\d{1,4})\b/) ||
      t.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\b/);
    return (
      subjectMatch ? subjectMatch[0] : t.split(/\s+/).slice(0, 3).join(" ")
    ).toUpperCase();
  })();

  const flairLower = String(story?.flair || pkg?.flair || "").toLowerCase();
  let bullet1;
  if (titleHasTrailer || titleHasReveal) {
    bullet1 = { lead: "Trailer live", detail: "official reveal confirmed" };
  } else if (/leak/.test(flairLower)) {
    bullet1 = { lead: "Leak surfaced", detail: "uploaded ahead of schedule" };
  } else if (/rumour|rumor/.test(flairLower)) {
    bullet1 = { lead: "Rumour active", detail: "no official statement yet" };
  } else if (/release|launch|announc/.test(flairLower)) {
    bullet1 = {
      lead: "Announcement live",
      detail: "official channels confirm",
    };
  } else {
    bullet1 = { lead: "Story live", detail: "developing now" };
  }

  let bullet2 = { lead: "Theme", detail: "tone hints at deeper story" };
  if (/personal|psychological|memory|trauma|grim/i.test(tightened)) {
    bullet2 = { lead: "Personal story", detail: "indoctrination and memory" };
  } else if (/multiplayer|co-?op|server/i.test(tightened)) {
    bullet2 = { lead: "Multiplayer focus", detail: "co-op and PvP referenced" };
  } else if (/sequel|return|comeback|after .* years/i.test(tightened)) {
    bullet2 = { lead: "Franchise return", detail: "after years of silence" };
  } else if (/studio|developer|publisher/i.test(tightened)) {
    const devMatch = tightened.match(
      /\b([A-Z][A-Za-z]*\s+(?:Games|Studios?|Interactive))\b/,
    );
    if (devMatch) {
      bullet2 = { lead: devMatch[1], detail: "back in the spotlight" };
    }
  }

  let bullet3 = { lead: "No date yet", detail: "platforms unconfirmed" };
  if (/(release date|launch date|out (?:on|in))/i.test(tightened)) {
    bullet3 = { lead: "Window confirmed", detail: "see article for specifics" };
  } else if (/(unverified|reportedly|allegedly|sources)/i.test(tightened)) {
    bullet3 = { lead: "Treat as unverified", detail: "wait for confirmation" };
  } else if (/(no gameplay|no footage|teaser only)/i.test(tightened)) {
    bullet3 = { lead: "No gameplay shown", detail: "tone-piece only for now" };
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
      headlineWords: editorialTakeaway.headlineWords,
      cta: editorialTakeaway.strap,
      step: "03 / TAKEAWAY",
      kicker: "THE BOTTOM LINE",
    },
    timeline: {
      heading: timelineHeading,
      kicker: "WHAT WE KNOW",
      bullets: [bullet1, bullet2, bullet3],
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
  if (!options.skipTimeline && content.timeline) {
    manifest.cards.timeline = await buildStoryTimelineCard({
      storyId,
      ...content.timeline,
      channelId,
    });
  }

  return manifest;
}

module.exports = {
  buildStorySourceCard,
  buildStoryContextCard,
  buildStoryTakeawayCard,
  buildStoryTimelineCard,
  buildAllStoryCards,
  deriveCardContent,
  deriveEditorialTakeaway,
  safeTakeawayHeadlineWords,
  safeTakeawayStrap,
  clampCardText,
};
