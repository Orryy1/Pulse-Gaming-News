/**
 * tools/studio-v2-build-quote-card.js — story-specific HF quote card.
 *
 * Takes a story (id, quote text, attribution) and generates a
 * dedicated HyperFrames project under experiments/hf-quote-<id>/
 * with the quote, kicker and attribution swapped into the index.html.
 * Auto-scales font size by word count so long quotes don't overflow.
 * Wraps each word in <span class="word"> so the GSAP stagger
 * animation still works on the new content.
 *
 * Renders to test/output/hf_quote_card_<id>.mp4.
 *
 * The premium-card-lane-v2 module checks for the story-specific
 * card first, then falls back to the generic one.
 *
 * Usage:
 *   node tools/studio-v2-build-quote-card.js <storyId> "<quote text>" "<attribution>"
 *   node tools/studio-v2-build-quote-card.js 1sn9xhe "Don't step on the flowers." "METRO 2039"
 *
 * If invoked without args, defaults to a Metro 2039 quote so the
 * tool is self-testable.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TEMPLATE_DIR = path.join(ROOT, "experiments", "hf-quote");
const TEST_OUT = path.join(ROOT, "test", "output");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Build the per-word <span class="word"> markup so the GSAP timeline
 * (which animates ".word" stagger) still has valid targets.
 */
function buildQuoteWordSpans(text) {
  // Tokenise on whitespace; keep punctuation attached to its word.
  const tokens = String(text)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .split(/\s+/)
    .filter(Boolean);
  return tokens
    .map((t) => `            <span class="word">${escapeHtml(t)}</span>`)
    .join("\n");
}

/**
 * Pick a font size that keeps the quote on roughly 2-3 lines at
 * 1080px wide. Empirical thresholds; conservative.
 */
function pickFontSize(text) {
  const words = String(text).trim().split(/\s+/).length;
  const chars = String(text).length;
  if (words <= 5 && chars <= 40) return 76;
  if (words <= 8 && chars <= 70) return 64;
  if (words <= 12 && chars <= 110) return 54;
  return 46;
}

/**
 * Pick the attribution-sub line based on the source.
 *   reddit comment  → "reddit comment"
 *   trailer line    → "official reveal trailer"
 *   developer quote → "developer quote"
 */
function pickAttributionSub(kind) {
  if (kind === "reddit") return "reddit comment";
  if (kind === "developer") return "developer statement";
  if (kind === "press") return "press release";
  return "official reveal trailer";
}

async function buildStoryQuoteCard({
  storyId,
  quoteText,
  attribution,
  kind = "trailer",
  channelId = "pulse-gaming",
}) {
  if (!storyId) throw new Error("storyId required");
  if (!quoteText) throw new Error("quoteText required");
  if (!attribution) throw new Error("attribution required");

  const isDefaultChannel = channelId === "pulse-gaming";
  const channelSuffix = isDefaultChannel ? "" : `__${channelId}`;
  const projectDir = path.join(
    ROOT,
    "experiments",
    `hf-quote-${storyId}${channelSuffix}`,
  );
  await fs.ensureDir(projectDir);
  await fs.ensureDir(path.join(projectDir, "assets"));

  // Copy meta + hyperframes config + backdrop. Don't symlink — HF
  // looks up assets relative to its project root.
  await fs.copy(
    path.join(TEMPLATE_DIR, "hyperframes.json"),
    path.join(projectDir, "hyperframes.json"),
  );
  await fs.copy(
    path.join(TEMPLATE_DIR, "assets", "backdrop.jpg"),
    path.join(projectDir, "assets", "backdrop.jpg"),
  );
  await fs.writeJson(
    path.join(projectDir, "meta.json"),
    {
      id: path.basename(projectDir),
      name: path.basename(projectDir),
      createdAt: new Date().toISOString(),
    },
    { spaces: 2 },
  );

  // Read the template, swap content
  const tplHtml = await fs.readFile(
    path.join(TEMPLATE_DIR, "index.html"),
    "utf8",
  );

  const fontSize = pickFontSize(quoteText);
  const wordsMarkup = buildQuoteWordSpans(quoteText);
  const attributionSub = pickAttributionSub(kind);
  const kicker = kind === "reddit" ? "TOP COMMENT" : "FROM THE TRAILER";

  // Replace the static font-size in the .quote class.
  let html = tplHtml.replace(
    /(\.quote\s*\{[^}]*?font-size:\s*)\d+(px;)/,
    `$1${fontSize}$2`,
  );

  // Replace the kicker text
  html = html.replace(
    /(<div id="kicker"[^>]*>)\s*[^<]+(<\/div>)/,
    `$1${escapeHtml(kicker)}$2`,
  );

  // Replace the quote block. The template has:
  //   <div id="quote" class="quote">
  //     <span class="word">Don&rsquo;t</span>
  //     ...
  //   </div>
  html = html.replace(
    /(<div id="quote" class="quote">)[\s\S]*?(<\/div>)/,
    `$1\n${wordsMarkup}\n          $2`,
  );

  // Replace attribution
  html = html.replace(
    /(<div id="attribution" class="attribution">)\s*[^<]+(<\/div>)/,
    `$1${escapeHtml(attribution.toUpperCase())}$2`,
  );

  // Replace attribution-sub
  html = html.replace(
    /(<div id="attribution-sub" class="attribution-sub">)\s*[^<]+(<\/div>)/,
    `$1${escapeHtml(attributionSub)}$2`,
  );

  // Apply channel theme — replaces the brand colour throughout.
  const {
    applyThemeToHtml,
    getChannelTheme,
  } = require("../lib/studio/v2/channel-themes");
  html = applyThemeToHtml(html, getChannelTheme(channelId));

  await fs.writeFile(path.join(projectDir, "index.html"), html);

  // Lint
  const projectName = path.basename(projectDir);
  console.log(`[quote-card] linting ${projectName}…`);
  execSync("npx hyperframes lint", { cwd: projectDir, stdio: "inherit" });

  // Render — output namespaced by channel
  const outPath = path.join(
    TEST_OUT,
    `hf_quote_card_${storyId}${channelSuffix}.mp4`,
  );
  console.log(
    `[quote-card] rendering ${projectName} → ${path.relative(ROOT, outPath)}…`,
  );
  execSync(
    `npx hyperframes render . -o "${outPath.replace(/\\/g, "/")}" -f 30 -q standard`,
    { cwd: projectDir, stdio: "inherit" },
  );

  return { outPath, projectDir, fontSize, channelId };
}

async function main() {
  const storyId = process.argv[2] || "1sn9xhe";
  const quoteText = process.argv[3] || "Don't step on the flowers.";
  const attribution = process.argv[4] || "METRO 2039";
  const kind = process.argv[5] || "trailer";

  const result = await buildStoryQuoteCard({
    storyId,
    quoteText,
    attribution,
    kind,
  });
  console.log("");
  console.log("[quote-card] DONE");
  console.log(`  output:  ${path.relative(ROOT, result.outPath)}`);
  console.log(`  project: ${path.relative(ROOT, result.projectDir)}`);
  console.log(`  font:    ${result.fontSize}px`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { buildStoryQuoteCard };
