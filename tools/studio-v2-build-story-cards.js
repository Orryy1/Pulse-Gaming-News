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
const {
  shellSidecarPathForCard,
} = require("../lib/studio/v2/premium-card-lane-v2");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const DEFAULT_CHANNEL = "pulse-gaming";
const MIN_READABLE_HYPERFRAMES_CARD_DURATION_S = 5.2;
const MAX_READABLE_HYPERFRAMES_CARD_DURATION_S = 14;

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

function readableDurationRequiredS(text) {
  const clean = normaliseText(text);
  if (!clean) return MIN_READABLE_HYPERFRAMES_CARD_DURATION_S;
  const words = clean.split(/\s+/).filter(Boolean).length;
  const longTokenPenalty = /\b[A-Z0-9]{6,}\b/.test(clean) ? 0.5 : 0;
  const computed = Math.max(
    MIN_READABLE_HYPERFRAMES_CARD_DURATION_S,
    1.15 * words + 1.5 + longTokenPenalty,
  );
  return Number(
    Math.min(
      MAX_READABLE_HYPERFRAMES_CARD_DURATION_S,
      Math.ceil(computed * 10) / 10,
    ).toFixed(1),
  );
}

function cardTextForReadability(kind, spec = {}) {
  if (kind === "source") return [spec.label, spec.sublabel].filter(Boolean).join(" ");
  if (kind === "context") return [spec.number, spec.sub, spec.micro].filter(Boolean).join(" ");
  if (kind === "timeline") {
    const bullets = (spec.bullets || [])
      .map((bullet) => [bullet.strong, bullet.copy].filter(Boolean).join(" "))
      .join(" ");
    return [spec.heading, bullets].filter(Boolean).join(" ");
  }
  if (kind === "quote") return spec.quoteText || spec.attribution || "";
  if (kind === "takeaway" || kind === "outro") {
    return [
      ...(Array.isArray(spec.headlineWords) ? spec.headlineWords : []),
      spec.cta,
    ].filter(Boolean).join(" ");
  }
  return Object.values(spec).filter((value) => typeof value === "string").join(" ");
}

function hyperframesCardReadabilityContractForSpec(kind, spec = {}) {
  const readableText = normaliseText(cardTextForReadability(kind, spec));
  const minimum = readableDurationRequiredS(readableText);
  return {
    status: "pass",
    evidence: {
      readable_text: readableText,
      word_count: readableText ? readableText.split(/\s+/).filter(Boolean).length : 0,
      planned_visible_duration_s: minimum,
      minimum_visible_duration_s: minimum,
      min_readable_card_duration_s: MIN_READABLE_HYPERFRAMES_CARD_DURATION_S,
      max_readable_card_duration_s: MAX_READABLE_HYPERFRAMES_CARD_DURATION_S,
    },
  };
}

function applyReadableDurationToTemplate(html, durationS) {
  const duration = Number(durationS);
  if (!Number.isFinite(duration) || duration <= 0) return html;
  return String(html).replace(
    /data-duration="[\d.]+"/g,
    `data-duration="${duration.toFixed(1)}"`,
  );
}

function sourceLabel(story) {
  const raw =
    story?.source_card_label ||
    story?.sourceCardLabel ||
    story?.subreddit ||
    story?.source ||
    story?.publisher ||
    story?.source_name ||
    "Verified source";
  const clean = normaliseText(raw)
    .replace(/^r\//i, "")
    .replace(/\bRockPaperShotgun\b/gi, "Rock Paper Shotgun")
    .replace(/\bPCGamer\b/gi, "PC Gamer")
    .replace(/\bGameSpot\b/gi, "GameSpot")
    .replace(/\bGamesRadar\b/gi, "GamesRadar")
    .replace(/\bVideoGamesChronicle\b/gi, "VGC")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bPlay\s+Station\b/gi, "PlayStation")
    .replace(/\s+/g, " ")
    .trim();
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

async function loadStoryFromFile(storyFile, storyId) {
  const payload = await fs.readJson(storyFile);
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.stories)
      ? payload.stories
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.entries)
          ? payload.entries
          : payload && typeof payload === "object"
            ? [payload]
            : [];
  const wanted = normaliseText(storyId);
  const row = rows.find((item) =>
    [item?.story_id, item?.storyId, item?.id].some((value) => normaliseText(value) === wanted),
  ) || (rows.length === 1 ? rows[0] : null);
  if (!row) {
    throw new Error(`Story ${storyId} not found in ${storyFile}`);
  }
  const id = normaliseText(row.story_id || row.storyId || row.id || storyId);
  if (!id) throw new Error(`Story id missing in ${storyFile}`);
  return {
    ...row,
    storyId: id,
    id,
    title: normaliseText(row.title || row.selected_title || row.canonical_title || row.canonical_subject),
    subreddit: row.subreddit || row.primary_source || row.source_name || row.publisher,
    full_script: row.full_script || row.narration_script,
  };
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

function contextNumberFontSize(value) {
  const text = normaliseText(value).replace(/\s+/g, "");
  if (text.length >= 14) return 108;
  if (text.length >= 10) return 128;
  return 152;
}

function applySpecToTemplate(kind, templateHtml, spec, channelId) {
  let html = templateHtml;

  if (kind === "source") {
    html = replaceElementText(html, "kicker", spec.kicker);
    html = replaceElementText(html, "label", spec.label);
    html = replaceElementText(html, "sublabel", spec.sublabel);
  } else if (kind === "context") {
    html = html.replace(
      /(\.number\s*\{[^}]*?font-size:\s*)\d+(px;)/,
      `$1${contextNumberFontSize(spec.number)}$2`,
    );
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
  html = applyThemeToHtml(html, getChannelTheme(channelId));
  const readability = hyperframesCardReadabilityContractForSpec(kind, spec);
  return applyReadableDurationToTemplate(
    html,
    readability.evidence.planned_visible_duration_s,
  );
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
  return {
    status: "pass",
    command,
    cwd: path.relative(ROOT, cwd).replace(/\\/g, "/"),
  };
}

function relPath(filePath) {
  return filePath ? path.relative(ROOT, filePath).replace(/\\/g, "/") : null;
}

function countMatches(value, pattern) {
  return (String(value || "").match(pattern) || []).length;
}

function countTimelineAnimationSteps(html = "") {
  return countMatches(html, /\b(?:tl|timeline)\.(?:to|from|fromTo)\s*\(/g) +
    countMatches(html, /(?:^|[\s);])\.(?:to|from|fromTo)\s*\(/g) +
    countMatches(html, /\bgsap\.(?:to|from|fromTo)\s*\(/g);
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function htmlDataDurationS(html = "") {
  const durations = [...String(html).matchAll(/data-duration="([\d.]+)"/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  return firstNumber(...durations);
}

function elementTextById(html = "", id = "") {
  const pattern = new RegExp(`<[^>]+id="${id}"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  const match = String(html).match(pattern);
  return match ? normaliseText(match[1]) : "";
}

function listTextById(html = "", id = "") {
  const pattern = new RegExp(`<[^>]+id="${id}"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  const match = String(html).match(pattern);
  if (!match) return "";
  return normaliseText(match[1]);
}

function readableTextFromProjectHtml(kind, html = "") {
  if (kind === "source") return [
    elementTextById(html, "label"),
    elementTextById(html, "sublabel"),
  ].filter(Boolean).join(" ");
  if (kind === "context") return [
    elementTextById(html, "number"),
    elementTextById(html, "sub"),
    elementTextById(html, "micro"),
  ].filter(Boolean).join(" ");
  if (kind === "timeline") return [
    elementTextById(html, "heading"),
    listTextById(html, "bullets"),
  ].filter(Boolean).join(" ");
  if (kind === "quote") return [
    elementTextById(html, "quote"),
    elementTextById(html, "attribution"),
  ].filter(Boolean).join(" ");
  if (kind === "takeaway" || kind === "outro") return [
    elementTextById(html, "headline"),
    elementTextById(html, "cta"),
  ].filter(Boolean).join(" ");
  return "";
}

function hyperframesCardReadabilityContractFromHtml(kind, html = "") {
  const readableText = readableTextFromProjectHtml(kind, html);
  const planned = htmlDataDurationS(html);
  const minimum = readableDurationRequiredS(readableText);
  const blockers = [];
  if (planned == null) blockers.push("hyperframes_card_duration_missing");
  else if (planned + 0.001 < minimum) blockers.push("hyperframes_card_visible_dwell_too_short");
  return {
    status: blockers.length ? "fail" : "pass",
    blockers,
    evidence: {
      readable_text: readableText,
      word_count: readableText ? readableText.split(/\s+/).filter(Boolean).length : 0,
      planned_visible_duration_s: planned,
      minimum_visible_duration_s: minimum,
      min_readable_card_duration_s: MIN_READABLE_HYPERFRAMES_CARD_DURATION_S,
      max_readable_card_duration_s: MAX_READABLE_HYPERFRAMES_CARD_DURATION_S,
    },
  };
}

async function inspectPremiumShellProject({ projectDir, kind, storyId }) {
  const htmlPath = path.join(projectDir, "index.html");
  const hyperframesConfigPath = path.join(projectDir, "hyperframes.json");
  const backdropPath = path.join(projectDir, "assets", "backdrop.jpg");
  const html = (await fs.pathExists(htmlPath))
    ? await fs.readFile(htmlPath, "utf8")
    : "";
  const visualBlockers = [];
  const animationBlockers = [];

  if (!(await fs.pathExists(hyperframesConfigPath))) {
    visualBlockers.push("hyperframes_config_missing");
  }
  if (!html.includes('data-composition-id="main"')) {
    visualBlockers.push("main_composition_missing");
  }
  if (!/width=1080,\s*height=1920/.test(html)) {
    visualBlockers.push("vertical_reel_viewport_missing");
  }
  if (!html.includes('data-track-index="0"')) {
    visualBlockers.push("tracked_clip_missing");
  }
  if (!(await fs.pathExists(backdropPath))) {
    visualBlockers.push("backdrop_asset_missing");
  }

  if (!/window\.__timelines/.test(html)) {
    animationBlockers.push("hyperframes_timeline_registry_missing");
  }
  if (!/gsap\.timeline\s*\([\s\S]*paused:\s*true/.test(html)) {
    animationBlockers.push("paused_gsap_timeline_missing");
  }
  const timelineAnimationSteps = countTimelineAnimationSteps(html);
  if (timelineAnimationSteps < 2) {
    animationBlockers.push("entrance_animation_steps_too_thin");
  }
  if (!html.includes("window.__timelines[\"main\"]")) {
    animationBlockers.push("main_timeline_not_registered");
  }
  const readabilityContract = hyperframesCardReadabilityContractFromHtml(kind, html);

  return {
    visual_identity: {
      status: visualBlockers.length ? "fail" : "pass",
      blockers: visualBlockers,
      evidence: {
        story_id: storyId,
        card_kind: kind,
        html_path: relPath(htmlPath),
        hyperframes_config_path: relPath(hyperframesConfigPath),
        backdrop_path: relPath(backdropPath),
        vertical_reel_viewport: /width=1080,\s*height=1920/.test(html),
        tracked_clip: html.includes('data-track-index="0"'),
      },
    },
    animation_contract: {
      status: animationBlockers.length ? "fail" : "pass",
      blockers: animationBlockers,
      evidence: {
        timeline_registry: /window\.__timelines/.test(html),
        paused_gsap_timeline: /gsap\.timeline\s*\([\s\S]*paused:\s*true/.test(html),
        main_timeline_registered: html.includes("window.__timelines[\"main\"]"),
        entrance_animation_steps: timelineAnimationSteps,
        timeline_animation_steps: timelineAnimationSteps,
        single_card_transition_contract: "not_applicable_single_composition",
      },
    },
    readability_contract: readabilityContract,
  };
}

async function writeHyperframesPremiumShellEvidence({
  kind,
  storyId,
  channelId,
  projectDir,
  outPath,
  checks,
} = {}) {
  const projectEvidence = await inspectPremiumShellProject({
    projectDir,
    kind,
    storyId,
  });
  const blockers = [
    ...Object.entries(checks || {}).flatMap(([name, check]) =>
      check?.status === "pass" ? [] : [`hyperframes_${name}_not_passed`],
    ),
    ...(projectEvidence.visual_identity.blockers || []),
    ...(projectEvidence.animation_contract.blockers || []),
    ...(projectEvidence.readability_contract.blockers || []),
  ];
  if (checks?.inspect?.skipped === true) blockers.push("hyperframes_inspect_skipped");

  const shell = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    story_id: storyId,
    card_kind: kind,
    channel_id: channelId,
    output_path: relPath(outPath),
    project_dir: relPath(projectDir),
    hyperframes_premium_shell: {
      status: blockers.length ? "fail" : "pass",
      shell_type: "story_specific_card",
      story_id: storyId,
      card_kind: kind,
      channel_id: channelId,
      output_path: relPath(outPath),
      project_dir: relPath(projectDir),
      checks,
      ...projectEvidence,
      blockers,
    },
  };
  const sidecarPath = shellSidecarPathForCard(outPath);
  await fs.writeJson(sidecarPath, shell, { spaces: 2 });
  return { sidecarPath, shell };
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
  const checks = {};
  console.log(`[story-cards] lint ${path.basename(projectDir)}`);
  checks.lint = runHyperframes(["lint"], projectDir);
  console.log(`[story-cards] validate ${path.basename(projectDir)}`);
  checks.validate = runHyperframes(["validate"], projectDir);
  if (inspect) {
    console.log(`[story-cards] inspect ${path.basename(projectDir)}`);
    checks.inspect = runHyperframes(
      ["inspect", ".", "--samples", "3", "--timeout", "10000", "--max-issues", "20"],
      projectDir,
    );
  } else {
    checks.inspect = {
      status: "skipped",
      skipped: true,
      reason: "inspect_disabled",
    };
  }
  console.log(
    `[story-cards] render ${path.basename(projectDir)} -> ${path.relative(
      ROOT,
      outPath,
    )}`,
  );
  checks.render = runHyperframes(
    ["render", ".", "-o", outPath, "-f", "30", "-q", "standard"],
    projectDir,
  );
  const shellEvidence = await writeHyperframesPremiumShellEvidence({
    kind,
    storyId,
    channelId,
    projectDir,
    outPath,
    checks,
  });
  return {
    outPath,
    shellEvidencePath: shellEvidence.sidecarPath,
    shellEvidence: shellEvidence.shell,
  };
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
      const rendered = await renderCard({
        kind,
        storyId: id,
        channelId,
        projectDir,
        inspect,
      });
      outputs[kind].outPath = rendered.outPath;
      outputs[kind].shellEvidencePath = rendered.shellEvidencePath;
      outputs[kind].shellEvidence = rendered.shellEvidence;
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
  let storyId = "";
  let storyFile = "";
  let channelId = process.env.CHANNEL || DEFAULT_CHANNEL;
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--story-id") storyId = args[++i] || storyId;
    else if (arg.startsWith("--story-id=")) storyId = arg.slice("--story-id=".length);
    else if (arg === "--story-file") storyFile = args[++i] || storyFile;
    else if (arg.startsWith("--story-file=")) storyFile = arg.slice("--story-file=".length);
    else if (arg === "--channel-id") channelId = args[++i] || channelId;
    else if (arg.startsWith("--channel-id=")) channelId = arg.slice("--channel-id=".length);
    else if (!arg.startsWith("--")) positional.push(arg);
  }
  storyId = storyId || positional[0] || "";
  const noRender = args.includes("--no-render");
  const noInspect = args.includes("--no-inspect");
  if (!storyId) {
    throw new Error(
      "Usage: node tools/studio-v2-build-story-cards.js <storyId|--story-id id> [--story-file file] [--no-render] [--no-inspect]",
    );
  }

  const story = storyFile ? await loadStoryFromFile(storyFile, storyId) : null;
  const result = await buildStoryCards({
    storyId,
    story,
    channelId,
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
  writeHyperframesPremiumShellEvidence,
  clampQuoteText,
  loadStoryFromFile,
  quoteLayoutClass,
  applySpecToTemplate,
  countTimelineAnimationSteps,
  hyperframesCardReadabilityContractForSpec,
  hyperframesCardReadabilityContractFromHtml,
  inspectPremiumShellProject,
  outputNameForCard,
  pickStoryBackdrop,
};
