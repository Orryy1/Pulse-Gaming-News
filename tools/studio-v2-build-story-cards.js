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
const { execFileSync, execSync } = require("node:child_process");
const sharp = require("sharp");
const { prescanImage } = require("../lib/visual-content-prescan");
const {
  fitQuoteText,
  pickQuoteFontSize,
  quoteLayoutClass,
} = require("../lib/studio/v2/quote-fit");
const {
  deriveEditorialTakeaway,
  safeTakeawayHeadlineWords,
  safeTakeawayStrap,
} = require("../lib/studio/v2/hf-card-builders");
const {
  shellSidecarPathForCard,
} = require("../lib/studio/v2/premium-card-lane-v2");
const {
  PREMIUM_CARD_TIMING_V5_VERSION,
  V5_READABLE_CARD_TIMING,
  V5_SOURCE_CARD_TIMING,
  readableWordCount,
  v5CardTimingContract,
} = require("../lib/studio/v4/premium-card-timing-policy");
const {
  applyPulseVisualIdentityToHtml,
  inspectPulseVisualIdentityHtml,
  resolvePulseVisualIdentity,
} = require("../lib/studio/v5/pulse-visual-identity");
const { hasVerifiedRedditReaction } = require("../lib/reddit-discussion-enrichment");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const DEFAULT_CHANNEL = "pulse-gaming";
const MIN_READABLE_HYPERFRAMES_CARD_DURATION_S = V5_READABLE_CARD_TIMING.minimum_visible_duration_s;
const MAX_READABLE_HYPERFRAMES_CARD_DURATION_S = V5_READABLE_CARD_TIMING.maximum_visible_duration_s;

function resolveStoryCardOutputRoot(outDir = TEST_OUT) {
  const resolved = path.resolve(ROOT, outDir || TEST_OUT);
  const relative = path.relative(ROOT, resolved);
  if (!relative) {
    throw new Error("Story card output directory cannot be the repository root");
  }
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "Story card output directory must stay inside the Pulse Gaming repository",
    );
  }
  return resolved;
}

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

function clampQuoteText(value, { maxWords = 9, maxChars = 76 } = {}) {
  const compact = normaliseText(value)
    .replace(
      /^.+?\s+just\s+gave\s+(.+?)\s+a\s+real\s+before-and-after\s+test\.?$/i,
      "$1 gets a real before-and-after test.",
    )
    .replace(/\b(?:has|have)\s+to\b/gi, "must");
  return fitQuoteText(compact, {
    maxWords: Math.min(Number(maxWords) || 9, 9),
    maxChars: Math.min(Number(maxChars) || 76, 76),
    maxCharsPerLine: 28,
    maxLines: 3,
    maxTokenChars: 22,
  });
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
  if (kind === "quote") return [spec.quoteText, spec.attribution].filter(Boolean).join(" ");
  if (kind === "takeaway") {
    return [
      ...safeTakeawayHeadlineWords(spec.headlineWords),
      safeTakeawayStrap(spec.cta),
    ].filter(Boolean).join(" ");
  }
  if (kind === "outro") {
    return [
      ...(Array.isArray(spec.headlineWords) ? spec.headlineWords : []),
      spec.cta,
    ].filter(Boolean).join(" ");
  }
  return Object.values(spec).filter((value) => typeof value === "string").join(" ");
}

function hyperframesCardReadabilityContractForSpec(kind, spec = {}) {
  const readableText = normaliseText(cardTextForReadability(kind, spec));
  const timing = v5CardTimingContract(kind, readableText);
  const isSource = timing.kind === "source";
  const minimum = isSource
    ? timing.minimum_visible_duration_s
    : timing.planned_visible_duration_s;
  const planned = timing.planned_visible_duration_s;
  const maximum = timing.maximum_visible_duration_s;
  const blockers = [];
  if (!readableText) blockers.push("hyperframes_card_readable_text_missing");
  if (!isSource && timing.content_fits_maximum === false) {
    blockers.push("hyperframes_card_copy_exceeds_momentum_budget");
  }
  if (isSource && timing.content_fits_maximum === false) {
    blockers.push("hyperframes_source_card_copy_exceeds_momentum_budget");
  }
  return {
    status: blockers.length ? "fail" : "pass",
    contract_version: PREMIUM_CARD_TIMING_V5_VERSION,
    blockers,
    evidence: {
      readable_text: readableText,
      word_count: readableWordCount(readableText),
      planned_visible_duration_s: planned,
      minimum_visible_duration_s: minimum,
      maximum_visible_duration_s: maximum,
      required_visible_duration_s:
        timing.required_visible_duration_s ?? planned,
      min_readable_card_duration_s: isSource
        ? V5_SOURCE_CARD_TIMING.minimum_visible_duration_s
        : MIN_READABLE_HYPERFRAMES_CARD_DURATION_S,
      max_readable_card_duration_s: maximum,
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

function sourceValue(value) {
  if (typeof value === "string") return normaliseText(value);
  if (!value || typeof value !== "object") return "";
  return normaliseText(
    value.name ||
      value.label ||
      value.publisher ||
      value.source_name ||
      value.title,
  );
}

function sourceUrl(story) {
  return [
    story?.primary_source_url,
    story?.source_url,
    story?.article_url,
    story?.url,
    story?.primary_source?.url,
    story?.primarySource?.url,
    story?.official_source?.url,
  ]
    .map(sourceValue)
    .find(Boolean) || "";
}

function sourceIdentityFromUrl(value) {
  const raw = normaliseText(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const isSteamHost =
      host === "store.steampowered.com" ||
      host === "steamcommunity.com" ||
      host === "steamstore-a.akamaihd.net";
    if (
      isSteamHost &&
      /\b(?:news|announcement|announcements|externalpost)\b/.test(
        pathname.replace(/[/_-]+/g, " "),
      )
    ) {
      return "Steam News";
    }
  } catch {
    return "";
  }
  return "";
}

function sourceLabel(story) {
  const raw = [
    story?.source_card_label,
    story?.sourceCardLabel,
    story?.primary_source,
    story?.primarySource,
    story?.subreddit,
    story?.source,
    story?.publisher,
    story?.source_name,
  ]
    .map(sourceValue)
    .find(Boolean) || "Verified source";
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

function sourceSublabel(story, label) {
  if (sourceIdentityFromUrl(sourceUrl(story)) === "Steam News") {
    return "OFFICIAL STEAM ANNOUNCEMENT";
  }
  return story?.source_type === "reddit" ? "REDDIT THREAD" : "NEWS SOURCE";
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
  const filler = new Set(["a", "an", "the", "its", "just", "this", "that"]);
  const words = normaliseText(title)
    .replace(/[^a-zA-Z0-9\u00c0-\u017f ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !filler.has(word.toLowerCase()))
    .slice(0, 3)
    .map((word) => word.toUpperCase());
  return words.length ? words : ["STORY", "UPDATE"];
}

function contextSubFromTitle(title, leadWord) {
  const leadTokens = new Set(
    normaliseText(leadWord)
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean),
  );
  const filler = new Set([
    "actually", "could", "gets", "just", "made", "makes", "really", "should",
    "turns", "what", "when", "where", "which", "why", "work", "works", "would",
  ]);
  const words = normaliseText(title)
    .replace(/[^a-zA-Z0-9\u00c0-\u017f ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length >= 4);
  const filtered = words.filter((word) => {
    const token = word.toLowerCase();
    return !leadTokens.has(token) && !filler.has(token);
  });
  return filtered.slice(0, 3).join(" ").toUpperCase() || "PLAYER IMPACT";
}

function versusModeBalanceRisk(story, title) {
  const titleText = normaliseText(title);
  const mode = titleText.match(/\b(\d+)\s*v\s*(\d+)\b/i);
  if (!mode || !/\b(?:risk|problem|catch|trade[- ]?off)\b/i.test(titleText)) {
    return "";
  }
  if (!/\b(?:assist|balance|balancing|matchup|roster|swap|team)\b/i.test(storyScriptText(story))) {
    return "";
  }
  return `${mode[1]}V${mode[2]} BALANCE RISK`;
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Number.isInteger(number)
    ? String(number)
    : String(Number(number.toFixed(2)));
}

function salesMomentumCardSignals(story) {
  const script = storyScriptText(story);
  const confirmedClaims = [
    ...(Array.isArray(story?.confirmed_claims) ? story.confirmed_claims : []),
    ...(Array.isArray(story?.claim_inventory?.confirmed)
      ? story.claim_inventory.confirmed
      : []),
  ]
    .map((claim) => normaliseText(claim?.claim || claim?.text || claim))
    .filter(Boolean)
    .join(" ");
  const evidence = normaliseText(`${script} ${confirmedClaims}`);
  const firstWeek = evidence.match(
    /\b(?:sold|sales(?:\s+(?:reached|hit))?)\s+(?:more\s+than\s+|over\s+)?(\d+(?:\.\d+)?)\s+million\b[^.!?]{0,80}\b(?:one|first)\s+week\b/i,
  );
  const dayOne = evidence.match(
    /\b(\d+(?:\.\d+)?)\s+million\b[^.!?]{0,50}\b(?:sold\s+)?(?:on\s+)?day\s+one\b/i,
  );
  if (!firstWeek || !dayOne) return null;

  const total = Number(firstWeek[1]);
  const launch = Number(dayOne[1]);
  const secondWave = Number((total - launch).toFixed(2));
  if (
    !Number.isFinite(total) ||
    !Number.isFinite(launch) ||
    !Number.isFinite(secondWave) ||
    total <= 0 ||
    launch <= 0 ||
    secondWave <= 0
  ) {
    return null;
  }

  const nextDays = evidence.match(
    /\b(?:another\s+(?:one\s+)?million|\d+(?:\.\d+)?\s+million)\b[^.!?]{0,60}\bnext\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+days?\b/i,
  );
  const nextDayCount = nextDays ? nextDays[1].toUpperCase() : "";
  const totalLabel = compactNumber(total);
  const launchLabel = compactNumber(launch);
  const secondWaveLabel = compactNumber(secondWave);
  const secondWaveStrong = nextDayCount
    ? `${secondWaveLabel}M NEXT ${nextDayCount} DAYS`
    : `${secondWaveLabel}M AFTER DAY ONE`;

  return {
    contextNumber: `${totalLabel} MILLION`,
    contextSub: `${secondWaveLabel}M AFTER DAY ONE`,
    contextMicro: "FIRST-WEEK SALES",
    timelineBullets: [
      { strong: `${launchLabel}M DAY ONE`, copy: "" },
      { strong: secondWaveStrong, copy: "" },
    ],
    quoteText:
      secondWave === 1
        ? "The second-wave million is the real test."
        : "The second-wave sales are the real test.",
  };
}

function editorialKeyLine(story) {
  const explicit = normaliseText(
    story?.card_key_line || story?.editorial_key_line || story?.pull_quote,
  );
  if (explicit) return clampQuoteText(explicit);
  const salesMomentum = salesMomentumCardSignals(story);
  if (salesMomentum) return salesMomentum.quoteText;

  const candidates = storyScriptText(story)
    .split(/(?<=[.!?])\s+/)
    .map(normaliseText)
    .filter(Boolean)
    .map((text, index) => {
      const words = text.split(/\s+/).filter(Boolean).length;
      if (words < 6 || words > 14 || /follow pulse gaming/i.test(text)) return null;
      let score = words >= 7 && words <= 12 ? 1 : 0;
      if (/\b(?:has to|have to|must|only matters|real test|could|would|risk|problem|catch)\b/i.test(text)) {
        score += 4;
      }
      if (/\bfinish line\b/i.test(text)) score += 6;
      if (/\d/.test(text)) score += 2;
      if (/\?$/.test(text)) score -= 3;
      if (/\b(?:official|source|reports?|trailer)\b/i.test(text)) score -= 2;
      return { text, index, score };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return candidates.length ? clampQuoteText(candidates[0].text) : "The player impact is the real story.";
}

function scriptSentences(story) {
  return storyScriptText(story)
    .split(/(?<=[.!?])\s+/)
    .map(normaliseText)
    .filter((sentence) => sentence && !/follow pulse gaming/i.test(sentence));
}

function contextImpactFromScript(story) {
  const script = storyScriptText(story);
  const visualUpgrade = script.match(
    /\b(sharper detail)\b[\s\S]{0,80}?\b(steadier motion)\b/i,
  );
  if (visualUpgrade) {
    return `${visualUpgrade[1]}, ${visualUpgrade[2]}`.toUpperCase();
  }

  const candidates = scriptSentences(story)
    .map((sentence, index) => {
      const words = sentence.split(/\s+/).filter(Boolean).length;
      if (words < 5 || words > 10 || /\?$/.test(sentence)) return null;
      let score = 0;
      if (/\bfinish line\b/i.test(sentence)) score += 12;
      if (/\b(?:saves?|saved)\s+(?:you\s+)?hours?\b/i.test(sentence)) score += 8;
      if (/\b(?:respects?|wastes?)\s+(?:your|players?')?\s*time\b/i.test(sentence)) score += 7;
      if (/\b(?:no longer|finally|now|fixed?|changes?|solves?)\b/i.test(sentence)) score += 4;
      if (/\b(?:grind|payoff|quality-of-life|player impact)\b/i.test(sentence)) score += 3;
      if (/\b(?:source|reports?|official|trailer)\b/i.test(sentence)) score -= 4;
      return { sentence, index, score };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  if (!candidates.length || candidates[0].score < 7) return "";
  return normaliseText(candidates[0].sentence)
    .replace(/^A\s+blind\s+grind\s+now\s+has\b/i, "Blind grind gets")
    .replace(/[.!?]+$/, "")
    .toUpperCase();
}

function concreteFactScore(sentence) {
  let score = 0;
  if (/\b(?:adds?|introduces?|reveals?|launches?|includes?|guarantees?)\b/i.test(sentence)) score += 5;
  if (/\b(?:carry|costs?|costing|releases?|arrives?|unlocks?|supports?|removes?|doubles?|cuts?)\b/i.test(sentence)) score += 4;
  if (/\b(?:day[- ]one\s+)?DLC\s+packs?\b/i.test(sentence)) score += 2;
  if (/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.test(sentence)) score += 3;
  if (/\b(?:free|skin tracker|inventory|crossplay|release date|gameplay|missions?|maps?|modes?)\b/i.test(sentence)) score += 2;
  if (/\b(?:source|reports?|official follow-up|argument|debate)\b/i.test(sentence)) score -= 4;
  if (/\?$/.test(sentence) || /^if\b/i.test(sentence)) score -= 5;
  return score;
}

function factLabel(sentence) {
  const dlcPackMatch = sentence.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+day[- ]one\s+DLC\s+packs?\b/i,
  );
  if (dlcPackMatch) return `${dlcPackMatch[1]} DLC PACKS`.toUpperCase();

  const currencyMatches = [...sentence.matchAll(/[$\u00a3\u20ac]\s*\d+(?:\.\d{1,2})?/g)].map((match) =>
    match[0].replace(/\s+/g, ""),
  );
  if (currencyMatches.length >= 2) {
    return `${currencyMatches[0]} VS ${currencyMatches[1]}`.toUpperCase();
  }
  if (currencyMatches.length === 1 && /\bmap\s+pack\b/i.test(sentence)) {
    return `${currencyMatches[0]} MAP PACK`.toUpperCase();
  }
  if (currencyMatches.length === 1 && /\b(?:combined|total)\b/i.test(sentence)) {
    return `${currencyMatches[0]} TOTAL`.toUpperCase();
  }

  const numberMatch = sentence.match(/\b(?:up to\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([a-z][a-z'-]*)/i);
  if (numberMatch) return `${numberMatch[1]} ${numberMatch[2]}`.toUpperCase();

  const guaranteeMatch = sentence.match(/\bguarantees?\s+(?:a|an|the)?\s*([^,.!?]+)/i);
  if (guaranteeMatch) return clampWords(`GUARANTEED ${guaranteeMatch[1]}`, 3).toUpperCase();

  const additionMatch = sentence.match(/\b(?:adds?|introduces?|includes?)\s+(?:a|an|the)?\s*([^,.!?]+)/i);
  if (additionMatch) {
    return clampWords(additionMatch[1].replace(/^(?:new|free)\s+/i, ""), 3).toUpperCase();
  }

  return headlineWordsFromTitle(sentence).join(" ");
}

function compactFactCopy(sentence, strong) {
  if (/\bday[- ]one\s+DLC\s+packs?\b/i.test(sentence) && /\bcost(?:s|ing)?\s+more\s+than\b/i.test(sentence)) {
    return "at launch";
  }
  if (/\bVS\b/.test(strong) || /\bMAP PACK\b/.test(strong)) return "";
  return clampWords(sentence, 4).replace(/[.!?]+$/, "").toLowerCase();
}

function compactTimelineStrong(value) {
  const normalised = normaliseText(value).toUpperCase();
  if (/^\d+(?:\.\d+)?M NEXT (?:ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|\d+) DAYS?$/.test(normalised)) {
    return normalised;
  }
  return clampWords(value, 3)
    .toUpperCase()
    .replace(
      /(\$?\d+(?:\.\d+)?)\s+VS\s+(\$?\d+(?:\.\d+)?)/,
      "$1/$2",
    );
}

function fitTimelineBulletsToMomentumBudget(bullets, heading, maximumWords = 10) {
  const compact = bullets.map((bullet) => ({
    strong: compactTimelineStrong(bullet.strong),
    copy: normaliseText(bullet.copy),
  }));
  const fixedWordCount = (rows) => [heading, ...rows.map((bullet) => bullet.strong)]
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  while (compact.length > 2 && fixedWordCount(compact) > maximumWords) {
    compact.pop();
  }
  const fixedWords = fixedWordCount(compact);
  let remainingWords = Math.max(0, maximumWords - fixedWords);
  return compact.map((bullet) => {
    const copyWords = bullet.copy.split(/\s+/).filter(Boolean);
    if (!copyWords.length || copyWords.length > remainingWords) {
      return { ...bullet, copy: "" };
    }
    remainingWords -= copyWords.length;
    return bullet;
  });
}

function concreteTimelineBullets(story, fallbackTitle, sourceName) {
  const heading = headlineWordsFromTitle(fallbackTitle).join(" ");
  const candidates = scriptSentences(story)
    .map((sentence, index) => ({
      sentence,
      index,
      score: concreteFactScore(sentence),
      words: sentence.split(/\s+/).filter(Boolean).length,
    }))
    .filter((candidate) => candidate.words >= 5 && candidate.words <= 14 && candidate.score >= 4)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .sort((left, right) => left.index - right.index)
    .map(({ sentence }) => {
      const strong = factLabel(sentence);
      return {
        strong,
        copy: compactFactCopy(sentence, strong),
      };
    });

  if (candidates.length >= 2) {
    return fitTimelineBulletsToMomentumBudget(candidates, heading);
  }
  return fitTimelineBulletsToMomentumBudget([
    { strong: "Verified detail", copy: sourceName.toLowerCase() },
    { strong: "Player impact", copy: clampWords(fallbackTitle, 7).toLowerCase() },
  ], heading);
}

function firstUsefulQuote(story) {
  const text = storyText(story);
  if (/No premium ticket\.\s*No paywall\.\s*Every player gets access/i.test(text)) {
    return "No premium ticket. No paywall. Every player gets access.";
  }

  const topComment =
    hasVerifiedRedditReaction(story) || String(story?.source_type || "").toLowerCase() === "reddit"
      ? story?.top_comment || story?.quoteCandidates?.[0]?.body || story?.quoteCandidates?.[0]?.text
      : "";
  if (topComment) return clampQuoteText(topComment);
  return editorialKeyLine(story);
}

function quoteAttribution(story, fallbackLabel) {
  const explicitAttribution = normaliseText(story?.quote_attribution);
  if (explicitAttribution) {
    return {
      attribution: explicitAttribution.toUpperCase(),
      attributionSub: normaliseText(story?.quote_attribution_sub) || "verified quote",
    };
  }
  if (
    hasVerifiedRedditReaction(story) &&
    String(story?.comment_source_type || "").toLowerCase() === "related_reddit_discussion"
  ) {
    return {
      attribution: `r/${normaliseText(story.reddit_discussion?.subreddit || "gaming").replace(/^r\//i, "")}`,
      attributionSub: "top-rated player reaction",
    };
  }
  if (String(story?.source_type || "").toLowerCase() === "reddit" && story?.top_comment) {
    return {
      attribution: fallbackLabel,
      attributionSub: "top comment",
    };
  }
  return {
    attribution: "PULSE GAMING",
    attributionSub: "editorial take",
  };
}

function buildStoryCardSpecsBase(story) {
  const label = sourceLabel(story);
  const title = normaliseText(story?.title);
  const reactionAttribution = quoteAttribution(story, label);
  const editorialTakeaway = deriveEditorialTakeaway({ story });

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
        ...reactionAttribution,
      },
      takeaway: {
        step: "03 / TAKEAWAY",
        kicker: "THE BOTTOM LINE",
        headlineWords: ["FREE", "MEGA", "MEWTWO"],
        cta: editorialTakeaway.strap,
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
  const salesMomentum = salesMomentumCardSignals(story);
  const canonicalSubject = normaliseText(
    story?.card_context_number || story?.canonical_subject || story?.canonical_game,
  );
  const contextNumber =
    normaliseText(story?.card_context_number) ||
    salesMomentum?.contextNumber ||
    canonicalSubject ||
    headlineWords[0] ||
    "UPDATE";
  const contextSub = normaliseText(story?.card_context_sub) ||
    salesMomentum?.contextSub ||
    versusModeBalanceRisk(story, title) ||
    contextImpactFromScript(story) ||
    contextSubFromTitle(title, contextNumber);
  const timelineBullets = salesMomentum
    ? fitTimelineBulletsToMomentumBudget(
        salesMomentum.timelineBullets,
        headlineWords.join(" "),
      )
    : concreteTimelineBullets(story, title, label);
  return {
    source: {
      kicker: "SOURCE",
      label,
      sublabel: sourceSublabel(story, label),
    },
    context: {
      kicker: "WHY IT MATTERS",
      number: contextNumber.toUpperCase(),
      sub: contextSub,
      micro:
        normaliseText(story?.card_context_micro).toUpperCase() ||
        salesMomentum?.contextMicro ||
        "PLAYER IMPACT",
    },
    timeline: {
      kicker: "WHAT WE KNOW",
      heading: headlineWords.join(" "),
      bullets: timelineBullets,
    },
    quote: {
      kicker: "KEY LINE",
      quoteText: firstUsefulQuote(story),
      ...reactionAttribution,
    },
    takeaway: {
      step: "03 / TAKEAWAY",
      kicker: "THE BOTTOM LINE",
      headlineWords: editorialTakeaway.headlineWords,
      cta: editorialTakeaway.strap,
    },
    outro: {
      step: "PULSE GAMING",
      kicker: "DAILY GAMING NEWS",
      headlineWords: ["FOLLOW", "FOR", "MORE"],
      cta: "VERIFIED GAMING NEWS",
    },
  };
}

function buildStoryCardSpecs(story) {
  const creativeIdentity = resolvePulseVisualIdentity(story);
  return Object.fromEntries(
    Object.entries(buildStoryCardSpecsBase(story)).map(([kind, spec]) => [
      kind,
      {
        ...spec,
        creative_identity: creativeIdentity,
      },
    ]),
  );
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

function storyVideoClipPaths(story = {}) {
  return [
    ...(Array.isArray(story.visual_v4_bridge_video_clips)
      ? story.visual_v4_bridge_video_clips
      : []),
    ...(Array.isArray(story.video_clips) ? story.video_clips : []),
  ]
    .map((clip) => typeof clip === "string"
      ? clip
      : clip?.path || clip?.local_path || clip?.clip_path || clip?.video_path)
    .map((clipPath) => String(clipPath || "").trim())
    .filter((clipPath, index, all) => clipPath && all.indexOf(clipPath) === index)
    .filter((clipPath) => !/^hf_(?:source|context|timeline|quote|takeaway|outro)_card_/i.test(path.basename(clipPath)))
    .filter((clipPath) => fs.existsSync(clipPath));
}

function scoreStoryBackdropCandidate({ brightness, entropy, sharpness, prescan = {} } = {}) {
  const reasons = [];
  const textOverlayLikelihood = Number(prescan.text_overlay_likelihood || 0);
  const lowerBandOverlayLikelihood = Number(
    prescan.lower_band_overlay_likelihood || 0,
  );
  const tasteTags = Array.isArray(prescan.trailer_frame_taste?.tags)
    ? prescan.trailer_frame_taste.tags
    : [];
  if (Number(brightness) < 20) reasons.push("backdrop_too_dark");
  if (Number(brightness) > 238) reasons.push("backdrop_overexposed");
  if (Number(entropy) < 1.5) reasons.push("backdrop_low_detail");
  if (textOverlayLikelihood >= 0.22 || tasteTags.includes("text_heavy")) {
    reasons.push("baked_trailer_text_risk");
  }
  if (
    lowerBandOverlayLikelihood >= 0.12 ||
    tasteTags.includes("lower_band_text_overlay")
  ) {
    reasons.push("baked_lower_band_overlay_risk");
  }
  if (String(prescan.trailer_frame_taste?.verdict || "") === "fail") {
    reasons.push("backdrop_frame_taste_failed");
  }
  const exposurePenalty = Math.abs(Number(brightness) - 108) * 0.025;
  return {
    eligible: reasons.length === 0,
    reasons,
    score: Number((Number(entropy || 0) * 4 + Number(sharpness || 0) * 6 - exposurePenalty - textOverlayLikelihood * 80).toFixed(3)),
    text_overlay_likelihood: textOverlayLikelihood,
    lower_band_overlay_likelihood: lowerBandOverlayLikelihood,
  };
}

function storyBackdropFfmpegFilter({ cropLegalFooter = false } = {}) {
  const transforms = [];
  if (cropLegalFooter) {
    transforms.push("crop=iw:trunc(ih*0.90/2)*2:0:0");
  }
  transforms.push(
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920",
    "format=yuvj420p",
  );
  return transforms.join(",");
}

async function extractAndScoreStoryBackdropCandidate({
  clipPath,
  candidatePath,
  clipIndex,
  sampleS,
  cropLegalFooter = false,
} = {}) {
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(sampleS),
    "-i",
    clipPath,
    "-frames:v",
    "1",
    "-vf",
    storyBackdropFfmpegFilter({ cropLegalFooter }),
    "-threads",
    "1",
    "-q:v",
    "2",
    candidatePath,
  ]);
  const stats = await sharp(candidatePath).stats();
  const channels = stats.channels.slice(0, 3);
  const brightness =
    channels.reduce((sum, channel) => sum + Number(channel.mean || 0), 0) /
    Math.max(1, channels.length);
  const prescan = await prescanImage(candidatePath, {
    sourceTypeHint: "trailer",
  });
  const score = scoreStoryBackdropCandidate({
    brightness,
    entropy: stats.entropy,
    sharpness: stats.sharpness,
    prescan,
  });
  return {
    path: candidatePath,
    source_clip_path: clipPath,
    clip_index: clipIndex,
    sample_s: sampleS,
    repair: cropLegalFooter ? "crop_legal_footer_bottom_10_percent" : null,
    ...score,
  };
}

async function materialiseStoryBackdropsFromClips({
  story = {},
  storyId = "story",
  outputDir = path.join(TEST_OUT, "hf-backdrops"),
  count = CARD_KINDS.length,
} = {}) {
  const clips = storyVideoClipPaths(story).slice(0, 10);
  if (!clips.length) return [];
  const safeStoryId = String(storyId || "story").replace(/[^a-z0-9_-]+/gi, "_");
  const candidateDir = path.join(outputDir, safeStoryId, "candidates");
  await fs.ensureDir(candidateDir);
  const candidates = [];

  for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
    for (const sampleS of [0.45, 1.6, 3.2]) {
      const candidatePath = path.join(
        candidateDir,
        `clip_${clipIndex + 1}_${String(sampleS).replace(".", "_")}.jpg`,
      );
      try {
        const candidate = await extractAndScoreStoryBackdropCandidate({
          clipPath: clips[clipIndex],
          candidatePath,
          clipIndex,
          sampleS,
        });
        candidates.push(candidate);
        if (candidate.reasons.includes("baked_lower_band_overlay_risk")) {
          const repairedPath = candidatePath.replace(
            /\.jpg$/i,
            "_footer_crop.jpg",
          );
          const repaired = await extractAndScoreStoryBackdropCandidate({
            clipPath: clips[clipIndex],
            candidatePath: repairedPath,
            clipIndex,
            sampleS,
            cropLegalFooter: true,
          });
          candidates.push(repaired);
        }
      } catch {
        // Another approved clip/sample may still provide the governed backdrop.
      }
    }
  }

  const eligible = candidates
    .filter((candidate) => candidate.eligible)
    .sort((left, right) => right.score - left.score);
  const selected = [];
  const usedClipIndexes = new Set();
  for (const candidate of eligible) {
    if (usedClipIndexes.has(candidate.clip_index)) continue;
    selected.push(candidate);
    usedClipIndexes.add(candidate.clip_index);
    if (selected.length >= count) break;
  }
  if (selected.length < count) {
    for (const candidate of eligible) {
      if (selected.includes(candidate)) continue;
      selected.push(candidate);
      if (selected.length >= count) break;
    }
  }

  const backdropPaths = [];
  for (let index = 0; index < selected.length; index += 1) {
    const backdropPath = path.join(
      outputDir,
      safeStoryId,
      `backdrop_${String(index + 1).padStart(2, "0")}.jpg`,
    );
    await fs.copy(selected[index].path, backdropPath, { overwrite: true });
    backdropPaths.push(backdropPath);
  }
  return backdropPaths;
}

async function materialiseStoryBackdropFromClips(options = {}) {
  const backdrops = await materialiseStoryBackdropsFromClips({ ...options, count: 1 });
  return backdrops[0] || null;
}

function buildCardBackdropMap(backdropPaths = [], fallbackPath = null) {
  const backdrops = backdropPaths.filter(Boolean);
  if (!backdrops.length && fallbackPath) backdrops.push(fallbackPath);
  const map = {};
  const editorialPriority = ["source", "context", "takeaway", "timeline", "quote", "outro"];
  for (let index = 0; index < editorialPriority.length; index += 1) {
    map[editorialPriority[index]] = backdrops.length
      ? backdrops[index % backdrops.length]
      : null;
  }
  return map;
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
  const existingMotion = [
    ...(Array.isArray(row.visual_v4_bridge_video_clips)
      ? row.visual_v4_bridge_video_clips
      : []),
    ...(Array.isArray(row.video_clips) ? row.video_clips : []),
  ];
  let siblingMotion = [];
  let siblingMotionEvidenceSource = "";
  if (!existingMotion.length) {
    const siblingMotionPath = path.join(
      path.dirname(path.resolve(storyFile)),
      "materialised_motion_clips.json",
    );
    if (await fs.pathExists(siblingMotionPath)) {
      const manifest = await fs.readJson(siblingMotionPath).catch(() => null);
      const manifestStoryId = normaliseText(
        manifest?.story_id || manifest?.storyId || id,
      );
      const status = normaliseText(
        manifest?.status || manifest?.verdict,
      ).toLowerCase();
      if (
        manifest &&
        manifestStoryId === id &&
        /^(?:ready|pass|passed|green)$/.test(status)
      ) {
        siblingMotion = (Array.isArray(manifest.clips) ? manifest.clips : [])
          .filter((clip) => {
            const clipPath = normaliseText(
              typeof clip === "string"
                ? clip
                : clip?.path || clip?.local_path || clip?.clip_path || clip?.video_path,
            );
            return clipPath && fs.existsSync(clipPath);
          });
        if (siblingMotion.length) {
          siblingMotionEvidenceSource = path.basename(siblingMotionPath);
        }
      }
    }
  }
  return {
    ...row,
    storyId: id,
    id,
    title: normaliseText(row.title || row.selected_title || row.canonical_title || row.canonical_subject),
    subreddit: row.subreddit || row.primary_source || row.source_name || row.publisher,
    full_script: row.full_script || row.narration_script,
    ...(siblingMotion.length
      ? {
          visual_v4_bridge_video_clips: siblingMotion,
          card_backdrop_motion_evidence_source: siblingMotionEvidenceSource,
        }
      : {}),
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
      (bullet, index) => {
        const copy = normaliseText(bullet.copy);
        return `            <li>
              <span class="num">${String(index + 1).padStart(2, "0")}</span>
              <span class="copy"><strong>${escapeHtml(
                bullet.strong,
              )}</strong>${copy ? `, ${escapeHtml(copy)}` : ""}</span>
            </li>`;
      },
    )
    .join("\n");
}

function contextNumberFontSize(value) {
  const text = normaliseText(value).replace(/\s+/g, "");
  if (text.length >= 22) return 84;
  if (text.length >= 18) return 92;
  if (text.length >= 14) return 100;
  if (text.length >= 10) return 112;
  if (text.length >= 8) return 120;
  return 152;
}

function takeawayHeadlineFontSize(words) {
  const longestWordLength = (Array.isArray(words) ? words : [])
    .map((word) => normaliseText(word).replace(/\s+/g, "").length)
    .reduce((longest, length) => Math.max(longest, length), 0);
  if (longestWordLength >= 11) return 100;
  if (longestWordLength >= 9) return 108;
  if (longestWordLength >= 7) return 116;
  return 124;
}

function sourceLabelFontSize(value) {
  const length = normaliseText(value).length;
  if (length >= 30) return 72;
  if (length >= 22) return 88;
  if (length >= 15) return 108;
  return 132;
}

function applySpecToTemplate(kind, templateHtml, spec, channelId) {
  let html = templateHtml;

  if (kind === "source") {
    html = html.replace(
      /(\.label\s*\{[^}]*?font-size:\s*)\d+(px;)/,
      `$1${sourceLabelFontSize(spec.label)}$2`,
    );
    html = replaceElementText(html, "kicker", spec.kicker);
    html = replaceElementText(html, "label", spec.label);
    html = replaceElementText(html, "sublabel", spec.sublabel);
  } else if (kind === "context") {
    html = html.replace(
      /(\.number\s*\{)/,
      "$1\n        width: 100%;\n        max-width: 936px;\n        overflow-wrap: anywhere;",
    );
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
    const headlineWords = kind === "takeaway"
      ? safeTakeawayHeadlineWords(spec.headlineWords)
      : spec.headlineWords;
    const strap = kind === "takeaway"
      ? safeTakeawayStrap(spec.cta)
      : spec.cta;
    html = html.replace(
      /(\.headline\s*\{[^}]*?font-size:\s*)\d+(px;)/,
      `$1${takeawayHeadlineFontSize(headlineWords)}$2`,
    );
    html = replaceElementText(html, "step", spec.step);
    html = replaceElementText(html, "kicker", spec.kicker);
    html = html.replace(
      /(<div id="headline" class="headline">)[\s\S]*?(<\/div>)/,
      `$1\n${buildHeadlineSpans(headlineWords)}\n          $2`,
    );
    html = replaceElementText(html, "cta", strap);
  } else {
    throw new Error(`Unknown card kind: ${kind}`);
  }

  const {
    applyThemeToHtml,
    getChannelTheme,
  } = require("../lib/studio/v2/channel-themes");
  html = applyThemeToHtml(html, getChannelTheme(channelId));
  const readability = hyperframesCardReadabilityContractForSpec(kind, spec);
  html = applyReadableDurationToTemplate(
    html,
    readability.evidence.planned_visible_duration_s,
  );
  return applyPulseVisualIdentityToHtml(html, {
    identity: spec.creative_identity || resolvePulseVisualIdentity({}),
    kind,
    durationS: readability.evidence.planned_visible_duration_s,
  });
}

function storyScriptText(story) {
  const script = story?.script;
  return normaliseText(
    typeof script === "string"
      ? script
      : script?.tightened || script?.raw || story?.full_script || story?.body || "",
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

function elementInnerHtmlById(html = "", id = "") {
  const source = String(html);
  const escapedId = String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openingPattern = new RegExp(
    `<([a-z][\\w:-]*)\\b[^>]*\\bid=(["'])${escapedId}\\2[^>]*>`,
    "i",
  );
  const opening = openingPattern.exec(source);
  if (!opening) return "";
  const tag = opening[1];
  const contentStart = opening.index + opening[0].length;
  const tokenPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tokenPattern.lastIndex = contentStart;
  let depth = 1;
  for (let token = tokenPattern.exec(source); token; token = tokenPattern.exec(source)) {
    const closing = /^<\//.test(token[0]);
    const selfClosing = /\/\s*>$/.test(token[0]);
    if (closing) depth -= 1;
    else if (!selfClosing) depth += 1;
    if (depth === 0) return source.slice(contentStart, token.index);
  }
  return "";
}

function elementTextById(html = "", id = "") {
  return normaliseText(elementInnerHtmlById(html, id));
}

function listTextById(html = "", id = "") {
  return normaliseText(elementInnerHtmlById(html, id));
}

function timelineListTextById(html = "", id = "") {
  return normaliseText(
    elementInnerHtmlById(html, id).replace(
      /<span\b[^>]*\bclass=(["'])[^"']*\bnum\b[^"']*\1[^>]*>[\s\S]*?<\/span>/gi,
      " ",
    ),
  );
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
    timelineListTextById(html, "bullets"),
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
  const timing = v5CardTimingContract(kind, readableText);
  const isSource = timing.kind === "source";
  const minimum = isSource
    ? timing.minimum_visible_duration_s
    : timing.planned_visible_duration_s;
  const maximum = timing.maximum_visible_duration_s;
  const blockers = [];
  if (!readableText) blockers.push("hyperframes_card_readable_text_missing");
  if (planned == null) blockers.push("hyperframes_card_duration_missing");
  else if (planned + 0.001 < minimum) blockers.push("hyperframes_card_visible_dwell_too_short");
  else if (isSource && planned > maximum + 0.001) blockers.push("hyperframes_source_card_visible_dwell_too_long");
  if (!isSource && timing.content_fits_maximum === false) {
    blockers.push("hyperframes_card_copy_exceeds_momentum_budget");
  }
  if (isSource && timing.content_fits_maximum === false) {
    blockers.push("hyperframes_source_card_copy_exceeds_momentum_budget");
  }
  return {
    status: blockers.length ? "fail" : "pass",
    contract_version: PREMIUM_CARD_TIMING_V5_VERSION,
    blockers,
    evidence: {
      readable_text: readableText,
      word_count: readableWordCount(readableText),
      planned_visible_duration_s: planned,
      minimum_visible_duration_s: minimum,
      maximum_visible_duration_s: maximum,
      required_visible_duration_s:
        timing.required_visible_duration_s ?? planned,
      min_readable_card_duration_s: isSource
        ? V5_SOURCE_CARD_TIMING.minimum_visible_duration_s
        : MIN_READABLE_HYPERFRAMES_CARD_DURATION_S,
      max_readable_card_duration_s: maximum,
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
  const creativeIdentityContract = inspectPulseVisualIdentityHtml(html);

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
    creative_identity_contract: creativeIdentityContract,
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
    ...(projectEvidence.creative_identity_contract.blockers || []),
  ];
  const shell = {
    schema_version: 1,
    timing_policy_version: PREMIUM_CARD_TIMING_V5_VERSION,
    generated_at: new Date().toISOString(),
    story_id: storyId,
    card_kind: kind,
    channel_id: channelId,
    output_path: relPath(outPath),
    project_dir: relPath(projectDir),
    hyperframes_premium_shell: {
      status: blockers.length ? "fail" : "pass",
      timing_policy_version: PREMIUM_CARD_TIMING_V5_VERSION,
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

async function renderCard({
  kind,
  storyId,
  channelId,
  projectDir,
  outputRoot = TEST_OUT,
  inspect,
}) {
  await fs.ensureDir(outputRoot);
  const outPath = path.join(
    outputRoot,
    outputNameForCard(kind, storyId, channelId),
  );
  const checks = {};
  console.log(`[story-cards] check ${path.basename(projectDir)}`);
  checks.check = runHyperframes(["check", "."], projectDir);
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
  outDir = TEST_OUT,
  render = true,
  inspect = true,
} = {}) {
  if (!storyId && !story?.storyId && !story?.id) {
    throw new Error("storyId required");
  }
  const id = storyId || story.storyId || story.id;
  const outputRoot = resolveStoryCardOutputRoot(outDir);
  const loadedStory = story || (await loadStoryForCards(id));
  const specs = buildStoryCardSpecs(loadedStory);
  const fallbackBackdropPath = pickStoryBackdrop(loadedStory);
  const materialisedBackdrops = await materialiseStoryBackdropsFromClips({
    story: loadedStory,
    storyId: id,
    outputDir: path.join(outputRoot, "hf-backdrops"),
  });
  const backdropMap = buildCardBackdropMap(materialisedBackdrops, fallbackBackdropPath);
  const backdropPath = backdropMap.source || fallbackBackdropPath || null;
  const outputs = {};

  for (const kind of CARD_KINDS) {
    const projectDir = await buildProjectForCard({
      kind,
      storyId: id,
      channelId,
      spec: specs[kind],
      backdropPath: backdropMap[kind],
    });
    outputs[kind] = {
      projectDir,
      outPath: path.join(outputRoot, outputNameForCard(kind, id, channelId)),
    };
    if (render) {
      const rendered = await renderCard({
        kind,
        storyId: id,
        channelId,
        projectDir,
        outputRoot,
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
    outputRoot,
    specs,
    backdropPath,
    backdropMap,
    outputs,
  };
}

async function main() {
  const args = process.argv.slice(2);
  let storyId = "";
  let storyFile = "";
  let channelId = process.env.CHANNEL || DEFAULT_CHANNEL;
  let outDir = TEST_OUT;
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--story-id") storyId = args[++i] || storyId;
    else if (arg.startsWith("--story-id=")) storyId = arg.slice("--story-id=".length);
    else if (arg === "--story-file") storyFile = args[++i] || storyFile;
    else if (arg.startsWith("--story-file=")) storyFile = arg.slice("--story-file=".length);
    else if (arg === "--channel-id") channelId = args[++i] || channelId;
    else if (arg.startsWith("--channel-id=")) channelId = arg.slice("--channel-id=".length);
    else if (arg === "--out-dir") outDir = args[++i] || outDir;
    else if (arg.startsWith("--out-dir=")) outDir = arg.slice("--out-dir=".length);
    else if (!arg.startsWith("--")) positional.push(arg);
  }
  storyId = storyId || positional[0] || "";
  const noRender = args.includes("--no-render");
  const noInspect = args.includes("--no-inspect");
  if (!storyId) {
    throw new Error(
      "Usage: node tools/studio-v2-build-story-cards.js <storyId|--story-id id> [--story-file file] [--out-dir dir] [--no-render] [--no-inspect]",
    );
  }

  const story = storyFile ? await loadStoryFromFile(storyFile, storyId) : null;
  const result = await buildStoryCards({
    storyId,
    story,
    channelId,
    outDir,
    render: !noRender,
    inspect: !noInspect,
  });

  console.log("");
  console.log("[story-cards] DONE");
  console.log(`  story:    ${result.storyId}`);
  console.log(`  channel:  ${result.channelId}`);
  console.log(`  out dir:  ${path.relative(ROOT, result.outputRoot)}`);
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
  resolveStoryCardOutputRoot,
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
  buildCardBackdropMap,
  materialiseStoryBackdropFromClips,
  materialiseStoryBackdropsFromClips,
  scoreStoryBackdropCandidate,
};
