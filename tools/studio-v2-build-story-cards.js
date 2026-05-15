"use strict";

/**
 * Build story-specific HyperFrames cards for Studio v2.
 *
 * The premium card lane deliberately refuses generic HF cards because their
 * text is baked into pixels. This tool fills that gap by generating per-story
 * source, context, timeline, quote and takeaway card projects from the existing
 * Metro-style templates, then rendering MP4s with the filenames the v2 lane
 * already expects.
 */

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");
const {
  fitQuoteText,
  pickQuoteFontSize,
  quoteLayoutClass,
} = require("../lib/studio/v2/quote-fit");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const DEFAULT_CHANNEL = "pulse-gaming";

const CARD_KINDS = [
  "source",
  "context",
  "timeline",
  "quote",
  "takeaway",
  "outro",
];
const TEMPLATE_BY_KIND = {
  source: "hf-source",
  context: "hf-context",
  timeline: "hf-timeline",
  quote: "hf-quote",
  takeaway: "hf-takeaway",
  outro: "hf-takeaway",
};

function projectSlugForKind(kind) {
  return kind === "outro" ? "hf-outro" : TEMPLATE_BY_KIND[kind];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    eacute: "\u00e9",
    Eacute: "\u00c9",
    gt: ">",
    hellip: "...",
    ldquo: '"',
    lsquo: "'",
    lt: "<",
    mdash: "-",
    ndash: "-",
    quot: '"',
    rdquo: '"',
    rsquo: "'",
  };

  return String(value ?? "").replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (match, entity) => {
      if (entity[0] === "#") {
        const raw = entity.slice(entity[1]?.toLowerCase() === "x" ? 2 : 1);
        const code = parseInt(raw, entity[1]?.toLowerCase() === "x" ? 16 : 10);
        if (Number.isFinite(code)) return String.fromCodePoint(code);
        return match;
      }
      return Object.prototype.hasOwnProperty.call(named, entity)
        ? named[entity]
        : match;
    },
  );
}

function normaliseText(value) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function clampWords(value, maxWords) {
  const words = normaliseText(value).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function clampQuoteText(value, { maxWords = 12, maxChars = 96 } = {}) {
  return fitQuoteText(value, {
    maxWords: Math.min(Number(maxWords) || 12, 11),
    maxChars: Math.min(Number(maxChars) || 96, 84),
    maxCharsPerLine: 28,
    maxLines: 3,
    maxTokenChars: 22,
  });
}

function sourceLabel(story) {
  const raw =
    story?.subreddit ||
    story?.source ||
    story?.publisher ||
    story?.source_name ||
    "Verified source";
  const clean = normaliseText(raw).replace(/^r\//i, "");
  return clean ? clean.toUpperCase() : "VERIFIED SOURCE";
}

function storyText(story) {
  const script = story?.script;
  const scriptText =
    typeof script === "string"
      ? script
      : script?.tightened || script?.raw || story?.full_script || story?.body;
  return normaliseText(
    [
      story?.title,
      story?.hook,
      scriptText,
      story?.top_comment,
      story?.quoteCandidates?.[0]?.body,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function isPokemonMewtwoStory(story) {
  const text = storyText(story).toLowerCase();
  return (
    /mega\s+mewtwo/.test(text) &&
    (/pok[e\u00e9]mon\s+go/.test(text) || /pokemon\s+go/.test(text))
  );
}

function headlineWordsFromTitle(title) {
  const words = normaliseText(title)
    .replace(/[^a-zA-Z0-9\u00c0-\u017f ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .slice(0, 3)
    .map((word) => word.toUpperCase());
  return words.length ? words : ["STORY", "UPDATE"];
}

function firstUsefulQuote(story) {
  const text = storyText(story);
  if (/No premium ticket\.\s*No paywall\.\s*Every player gets access/i.test(text)) {
    return "No premium ticket. No paywall. Every player gets access.";
  }

  const topComment =
    story?.top_comment ||
    story?.quoteCandidates?.[0]?.body ||
    story?.quoteCandidates?.[0]?.text;
  if (topComment) return clampQuoteText(topComment);

  const title = normaliseText(story?.title);
  return title ? clampQuoteText(title) : "The important detail is changing fast.";
}

function buildStoryCardSpecs(story) {
  const label = sourceLabel(story);
  const title = normaliseText(story?.title);

  if (isPokemonMewtwoStory(story)) {
    return {
      source: {
        kicker: "SOURCE",
        label,
        sublabel: "POK\u00c9MON GO",
      },
      context: {
        kicker: "BIG DETAIL",
        number: "FREE",
        sub: "GO FEST GLOBAL",
        micro: "Mega Mewtwo X/Y debuts July 11-12",
      },
      timeline: {
        kicker: "WHAT WE KNOW",
        heading: "MEGA MEWTWO",
        bullets: [
          {
            strong: "Go Fest 2026",
            copy: "global event is free",
          },
          {
            strong: "Mewtwo X/Y",
            copy: "debut July 11-12",
          },
          {
            strong: "No ticket",
            copy: "all players included",
          },
        ],
      },
      quote: {
        kicker: "KEY LINE",
        quoteText: firstUsefulQuote(story),
        attribution: label,
        attributionSub: "reported detail",
      },
      takeaway: {
        step: "03 / TAKEAWAY",
        kicker: "THE BOTTOM LINE",
        headlineWords: ["FREE", "MEGA", "MEWTWO"],
        cta: "FOLLOW FOR MORE",
      },
      outro: {
        step: "PULSE GAMING",
        kicker: "DAILY GAMING NEWS",
        headlineWords: ["FOLLOW", "FOR", "MORE"],
        cta: "VERIFIED GAMING NEWS",
      },
    };
  }

  const headlineWords = headlineWordsFromTitle(title);
  return {
    source: {
      kicker: "SOURCE",
      label,
      sublabel: story?.source_type === "reddit" ? "REDDIT THREAD" : "NEWS SOURCE",
    },
    context: {
      kicker: "WHY IT MATTERS",
      number: headlineWords[0] || "UPDATE",
      sub: clampWords(title, 5).toUpperCase(),
      micro: "verified source, checked before publish",
    },
    timeline: {
      kicker: "WHAT WE KNOW",
      heading: headlineWords.join(" "),
      bullets: [
        { strong: "Source checked", copy: label.toLowerCase() },
        { strong: "Main detail", copy: clampWords(title, 7).toLowerCase() },
        { strong: "Next step", copy: "watch for official follow-up" },
      ],
    },
    quote: {
      kicker: "KEY LINE",
      quoteText: firstUsefulQuote(story),
      attribution: label,
      attributionSub: story?.source_type === "reddit" ? "top comment" : "reported detail",
    },
    takeaway: {
      step: "03 / TAKEAWAY",
      kicker: "THE BOTTOM LINE",
      headlineWords,
      cta: "FOLLOW FOR MORE",
    },
    outro: {
      step: "PULSE GAMING",
      kicker: "DAILY GAMING NEWS",
      headlineWords: ["FOLLOW", "FOR", "MORE"],
      cta: "VERIFIED GAMING NEWS",
    },
  };
}

function channelSuffix(channelId = DEFAULT_CHANNEL) {
  return channelId && channelId !== DEFAULT_CHANNEL ? `__${channelId}` : "";
}

function outputNameForCard(kind, storyId, channelId = DEFAULT_CHANNEL) {
  return `hf_${kind}_card_${storyId}${channelSuffix(channelId)}.mp4`;
}

function smartCropSibling(filePath) {
  if (!filePath) return null;
  const ext = path.extname(filePath);
  if (!ext) return null;
  return filePath.slice(0, -ext.length) + "_smartcrop_v2.jpg";
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function pickStoryBackdrop(story) {
  const inv = story?.mediaInventory || {};
  const candidates = [];

  for (const item of inv.trailerFrames || []) {
    candidates.push(smartCropSibling(item.path), item.path);
  }
  for (const item of inv.articleHeroes || []) {
    candidates.push(smartCropSibling(item.path), item.path);
  }
  for (const item of inv.articleInline || []) {
    candidates.push(smartCropSibling(item.path), item.path);
  }

  return firstExisting(candidates);
}

async function loadStoryForCards(storyId) {
  const pkgPath = path.join(TEST_OUT, `${storyId}_studio_v2_package.json`);
  if (await fs.pathExists(pkgPath)) {
    const pkg = await fs.readJson(pkgPath);
    return {
      ...pkg,
      storyId: pkg.storyId || storyId,
      id: pkg.storyId || storyId,
      top_comment: pkg.quoteCandidates?.[0]?.body,
    };
  }

  require("dotenv").config({ override: true });
  const Database = require("better-sqlite3");
  const { resolveStudioDbPath } = require("../lib/studio/v2/studio-db-path");
  const db = new Database(resolveStudioDbPath({ root: ROOT }), {
    readonly: true,
  });
  try {
    const row = db
      .prepare(
        `SELECT id, title, hook, body, full_script, classification,
                flair, subreddit, source_type, top_comment, article_image
         FROM stories WHERE id = ?`,
      )
      .get(storyId);
    if (!row) throw new Error(`Story not found: ${storyId}`);
    return { ...row, storyId: row.id };
  } finally {
    db.close();
  }
}

function replaceElementText(html, id, value) {
  const re = new RegExp(`(<[^>]+id="${id}"[^>]*>)[\\s\\S]*?(</[^>]+>)`);
  return html.replace(re, `$1${escapeHtml(value)}$2`);
}

function buildQuoteWordSpans(text) {
  return normaliseText(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `            <span class="word">${escapeHtml(word)}</span>`)
    .join("\n");
}

function buildHeadlineSpans(words) {
  return words
    .map((word) => `            <span class="word">${escapeHtml(word)}</span>`)
    .join("\n");
}

function renderTimelineBullets(bullets) {
  return bullets
    .slice(0, 3)
    .map(
      (bullet, index) => `            <li>
              <span class="num">${String(index + 1).padStart(2, "0")}</span>
              <span class="copy"><strong>${escapeHtml(
                bullet.strong,
              )}</strong>, ${escapeHtml(bullet.copy)}</span>
            </li>`,
    )
    .join("\n");
}

function applySpecToTemplate(kind, templateHtml, spec, channelId) {
  let html = templateHtml;

  if (kind === "source") {
    html = replaceElementText(html, "kicker", spec.kicker);
    html = replaceElementText(html, "label", spec.label);
    html = replaceElementText(html, "sublabel", spec.sublabel);
  } else if (kind === "context") {
    html = replaceElementText(html, "kicker", spec.kicker);
    html = replaceElementText(html, "number", spec.number);
    html = replaceElementText(html, "sub", spec.sub);
    html = replaceElementText(html, "micro", spec.micro);
  } else if (kind === "timeline") {
    html = replaceElementText(html, "kicker", spec.kicker);
    html = replaceElementText(html, "heading", spec.heading);
    html = html.replace(
      /(<ul id="bullets" class="bullets">)[\s\S]*?(<\/ul>)/,
      `$1\n${renderTimelineBullets(spec.bullets)}\n          $2`,
    );
  } else if (kind === "quote") {
    const quoteText = clampQuoteText(spec.quoteText);
    const fontSize = pickQuoteFontSize(quoteText);
    html = html.replace(
      /(\.quote\s*\{[^}]*?font-size:\s*)\d+(px;)/,
      `$1${fontSize}$2`,
    );
    html = html.replace(
      /<div id="quote" class="quote">/,
      `<div id="quote" class="${quoteLayoutClass(quoteText)}">`,
    );
    html = replaceElementText(html, "kicker", spec.kicker);
    html = html.replace(
      /(<div id="quote" class="quote">)[\s\S]*?(<\/div>)/,
      `$1\n${buildQuoteWordSpans(quoteText)}\n          $2`,
    );
    html = html.replace(
      /(<div id="quote" class="quote quote--(?:medium|compact)">)[\s\S]*?(<\/div>)/,
      `$1\n${buildQuoteWordSpans(quoteText)}\n          $2`,
    );
    html = replaceElementText(html, "attribution", spec.attribution);
    html = replaceElementText(html, "attribution-sub", spec.attributionSub);
  } else if (kind === "takeaway" || kind === "outro") {
    html = replaceElementText(html, "step", spec.step);
    html = replaceElementText(html, "kicker", spec.kicker);
    html = html.replace(
      /(<div id="headline" class="headline">)[\s\S]*?(<\/div>)/,
      `$1\n${buildHeadlineSpans(spec.headlineWords)}\n          $2`,
    );
    html = replaceElementText(html, "cta", spec.cta);
  } else {
    throw new Error(`Unknown card kind: ${kind}`);
  }

  const {
    applyThemeToHtml,
    getChannelTheme,
  } = require("../lib/studio/v2/channel-themes");
  return applyThemeToHtml(html, getChannelTheme(channelId));
}

function runHyperframes(args, cwd) {
  const command = ["npx", "hyperframes", ...args]
    .map((arg) => {
      const text = String(arg);
      return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
    })
    .join(" ");
  execSync(command, {
    cwd,
    stdio: "inherit",
  });
}

async function buildProjectForCard({
  kind,
  storyId,
  channelId,
  spec,
  backdropPath,
}) {
  const templateDir = path.join(ROOT, "experiments", TEMPLATE_BY_KIND[kind]);
  const suffix = channelSuffix(channelId);
  const projectSlug = projectSlugForKind(kind);
  const projectDir = path.join(
    ROOT,
    "experiments",
    `${projectSlug}-${storyId}${suffix}`,
  );
  const assetsDir = path.join(projectDir, "assets");

  await fs.ensureDir(projectDir);
  await fs.ensureDir(assetsDir);
  await fs.copy(
    path.join(templateDir, "hyperframes.json"),
    path.join(projectDir, "hyperframes.json"),
    { overwrite: true },
  );
  if (await fs.pathExists(path.join(templateDir, "assets"))) {
    await fs.copy(path.join(templateDir, "assets"), assetsDir, {
      overwrite: true,
    });
  }
  const selectedBackdrop =
    backdropPath || path.join(templateDir, "assets", "backdrop.jpg");
  if (await fs.pathExists(selectedBackdrop)) {
    await fs.copy(selectedBackdrop, path.join(assetsDir, "backdrop.jpg"), {
      overwrite: true,
    });
  }

  const templateHtml = await fs.readFile(
    path.join(templateDir, "index.html"),
    "utf8",
  );
  const html = applySpecToTemplate(kind, templateHtml, spec, channelId);
  await fs.writeFile(path.join(projectDir, "index.html"), html);
  await fs.writeJson(
    path.join(projectDir, "meta.json"),
    {
      id: path.basename(projectDir),
      name: path.basename(projectDir),
      storyId,
      kind,
      channelId,
      createdAt: new Date().toISOString(),
    },
    { spaces: 2 },
  );

  return projectDir;
}

async function renderCard({ kind, storyId, channelId, projectDir, inspect }) {
  await fs.ensureDir(TEST_OUT);
  const outPath = path.join(TEST_OUT, outputNameForCard(kind, storyId, channelId));
  console.log(`[story-cards] lint ${path.basename(projectDir)}`);
  runHyperframes(["lint"], projectDir);
  if (inspect) {
    console.log(`[story-cards] inspect ${path.basename(projectDir)}`);
    runHyperframes(
      ["inspect", ".", "--samples", "3", "--timeout", "10000", "--max-issues", "20"],
      projectDir,
    );
  }
  console.log(
    `[story-cards] render ${path.basename(projectDir)} -> ${path.relative(
      ROOT,
      outPath,
    )}`,
  );
  runHyperframes(
    ["render", ".", "-o", outPath, "-f", "30", "-q", "standard"],
    projectDir,
  );
  return outPath;
}

async function buildStoryCards({
  storyId,
  story,
  channelId = process.env.CHANNEL || DEFAULT_CHANNEL,
  render = true,
  inspect = true,
} = {}) {
  if (!storyId && !story?.storyId && !story?.id) {
    throw new Error("storyId required");
  }
  const id = storyId || story.storyId || story.id;
  const loadedStory = story || (await loadStoryForCards(id));
  const specs = buildStoryCardSpecs(loadedStory);
  const backdropPath = pickStoryBackdrop(loadedStory);
  const outputs = {};

  for (const kind of CARD_KINDS) {
    const projectDir = await buildProjectForCard({
      kind,
      storyId: id,
      channelId,
      spec: specs[kind],
      backdropPath,
    });
    outputs[kind] = {
      projectDir,
      outPath: path.join(TEST_OUT, outputNameForCard(kind, id, channelId)),
    };
    if (render) {
      outputs[kind].outPath = await renderCard({
        kind,
        storyId: id,
        channelId,
        projectDir,
        inspect,
      });
    }
  }

  return {
    storyId: id,
    channelId,
    specs,
    backdropPath,
    outputs,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const storyId = args.find((arg) => !arg.startsWith("--"));
  const noRender = args.includes("--no-render");
  const noInspect = args.includes("--no-inspect");
  if (!storyId) {
    throw new Error(
      "Usage: node tools/studio-v2-build-story-cards.js <storyId> [--no-render] [--no-inspect]",
    );
  }

  const result = await buildStoryCards({
    storyId,
    render: !noRender,
    inspect: !noInspect,
  });

  console.log("");
  console.log("[story-cards] DONE");
  console.log(`  story:    ${result.storyId}`);
  console.log(`  channel:  ${result.channelId}`);
  console.log(
    `  backdrop: ${result.backdropPath ? path.relative(ROOT, result.backdropPath) : "template default"}`,
  );
  for (const kind of CARD_KINDS) {
    console.log(`  ${kind}: ${path.relative(ROOT, result.outputs[kind].outPath)}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  buildStoryCards,
  buildStoryCardSpecs,
  clampQuoteText,
  quoteLayoutClass,
  applySpecToTemplate,
  outputNameForCard,
  pickStoryBackdrop,
};
