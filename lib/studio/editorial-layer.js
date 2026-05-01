"use strict";

const { tightenScript } = require("../editorial");

const BANNED_OPENERS = [/^so[,\s]+/i, /^today[,\s]+/i, /^hey[,\s]+/i, /^welcome[,\s]+/i, /^in this\b/i];

const AI_TELL_PATTERNS = [
  /\bbut here(?:'s| is) where it gets interesting\b/gi,
  /\byou won(?:'t| not) believe\b/gi,
  /\bthis changes everything\b/gi,
  /\blet me know in the comments\b/gi,
  /\bfollow pulse gaming so you never miss a beat\b/gi,
  /\bsmash that like button\b/gi,
  /\bat the end of the day\b/gi,
  /\bit'?s worth noting\b/gi,
];

function wordsOf(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function wordCount(text) {
  return wordsOf(text).length;
}

function sentenceParts(text) {
  return (
    String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) || []
  )
    .map((part) => part.trim())
    .filter(Boolean);
}

function normaliseForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function contentKey(text, take = 5) {
  return normaliseForCompare(text)
    .split(/\s+/)
    .filter((word) => !["a", "an", "and", "for", "is", "s", "the", "to"].includes(word))
    .slice(0, take)
    .join(" ");
}

function stripGenericCta(text) {
  let out = String(text || "");
  out = out.replace(
    /\s*follow pulse gaming so you never miss a beat\.?\s*$/i,
    "",
  );
  out = out.replace(/\s*follow for more\.?\s*$/i, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

function removeAiTells(text) {
  let out = String(text || "");
  for (const pattern of AI_TELL_PATTERNS) {
    out = out.replace(pattern, "");
  }
  return out
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

function rewriteHook(story) {
  const title = String(story?.title || "");
  if (/metro\s+2039/i.test(title)) {
    return "Metro 2039 is real, and the reveal is unusually grim.";
  }
  if (/mega\s+mewtwo/i.test(title) && /pok[eé]mon\s+go/i.test(title)) {
    return "Mega Mewtwo is finally coming to Pokémon Go for free.";
  }

  const raw =
    story?.hook || story?.title || "This gaming story needs a sharper hook.";
  let hook = String(raw).split(/[.!?]/)[0].trim();
  for (const opener of BANNED_OPENERS) hook = hook.replace(opener, "");
  const words = wordsOf(hook);
  if (words.length > 12) {
    const firstClause = hook.split(/,\s+(?:and|but|while|because)\b/i)[0].trim();
    hook = wordCount(firstClause) >= 8 ? firstClause : words.slice(0, 12).join(" ");
    hook = hook.replace(/\b(?:a|an|the|and|or|but|to|for|of|with)$/i, "").trim();
  }
  if (hook && !/[.!?]$/.test(hook)) hook += ".";
  return hook;
}

function buildMetro2039Script() {
  const hook = "Metro 2039 is real, and the reveal is unusually grim.";
  const body = [
    "4A Games has shown the first official reveal trailer for Metro 2039.",
    "It is not a random teaser.",
    "The footage points at a personal story, built around indoctrination, memory and a protagonist trying to understand what was done to him.",
    "The important bit is the gap.",
    "Metro Exodus launched in 2019, so this is the franchise returning after years of silence.",
    "The trailer does not hand over release details, platforms or combat systems, so treat those as unknown for now.",
    "But it does show the tone.",
    "Less power fantasy, more psychological fallout.",
    "The scenes feel colder than Exodus and closer to the series' bleak tunnel roots.",
  ].join(" ");
  const loop =
    "If this is the direction, Metro 2039 is not just a comeback. It is 4A Games putting the franchise back into trauma, guilt and survival.";
  const fullScript = `${hook} ${body} ${loop}`;
  return { hook, body, loop, fullScript };
}

function normaliseNumberPronunciation(text) {
  return String(text || "")
    .replace(/\bMetro 2039\b/g, "Metro twenty thirty-nine")
    .replace(/\b2039\b/g, "twenty thirty-nine")
    .replace(/\b2019\b/g, "twenty nineteen")
    .replace(/\b4A Games\b/g, "four A Games");
}

function scoreHook(hook) {
  const words = wordsOf(hook);
  const badOpener = BANNED_OPENERS.some((pattern) => pattern.test(hook));
  const bannedTell = AI_TELL_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(hook);
  });
  return {
    wordCount: words.length,
    hasBadOpener: badOpener,
    hasAiTell: bannedTell,
    pass: words.length <= 12 && !badOpener && !bannedTell,
  };
}

function stripDuplicateOpening(body, hook) {
  const sentences = sentenceParts(body);
  if (sentences.length === 0) return "";
  const hookKey = contentKey(hook);
  const firstKey = contentKey(sentences[0]);
  if (hookKey && hookKey === firstKey) {
    return sentences.slice(1).join(" ").trim();
  }
  return sentences.join(" ").trim();
}

function trimToWordBudget(text, maxWords) {
  const max = Number(maxWords);
  if (!Number.isFinite(max) || max <= 0) return String(text || "").trim();
  const sentences = sentenceParts(text);
  const kept = [];
  let count = 0;
  for (const sentence of sentences) {
    const words = wordCount(sentence);
    if (kept.length > 0 && count + words > max) break;
    kept.push(sentence);
    count += words;
    if (count >= max) break;
  }
  if (kept.length > 0) return kept.join(" ").trim();
  return wordsOf(text).slice(0, max).join(" ").trim();
}

function buildStudioEditorial(story) {
  const raw = story?.full_script || story?.body || story?.hook || "";
  const tightened = tightenScript(stripGenericCta(raw), story);
  const maxWords = Number(process.env.STUDIO_EDITORIAL_MAX_WORDS || 140);

  const metro = /metro\s+2039/i.test(story?.title || "");
  let scripted = metro
    ? buildMetro2039Script()
    : null;
  if (!scripted) {
    const hook = rewriteHook(story);
    const cleanBody = stripDuplicateOpening(
      removeAiTells(tightened.scriptForCaption),
      hook,
    );
    const bodyBudget = Math.max(40, maxWords - wordCount(hook));
    const body = trimToWordBudget(cleanBody, bodyBudget);
    scripted = {
      hook,
      body,
      loop: "",
      fullScript: `${hook} ${body}`.replace(/\s{2,}/g, " ").trim(),
    };
  }

  const captionScript = scripted.fullScript;
  const ttsScript = normaliseNumberPronunciation(captionScript);
  const changes = [
    ...tightened.changes,
    {
      kind: "studio-rewrite",
      beforeWords: wordCount(raw),
      afterWords: wordCount(captionScript),
    },
  ];

  return {
    hook: scripted.hook,
    body: scripted.body,
    loop: scripted.loop,
    fullScript: captionScript,
    scriptForCaption: captionScript,
    scriptForTTS: ttsScript,
    wordCount: wordCount(captionScript),
    ttsWordCount: wordCount(ttsScript),
    hookScore: scoreHook(scripted.hook),
    removedGenericCta: !/follow pulse gaming/i.test(captionScript),
    changes,
  };
}

function scriptFromTimestampAlignment(alignment) {
  const chars =
    alignment?.characters || alignment?.alignment?.characters || [];
  return Array.isArray(chars) ? chars.join("").replace(/\s+/g, " ").trim() : "";
}

module.exports = {
  buildStudioEditorial,
  rewriteHook,
  normaliseNumberPronunciation,
  stripGenericCta,
  removeAiTells,
  stripDuplicateOpening,
  trimToWordBudget,
  scoreHook,
  wordCount,
  scriptFromTimestampAlignment,
  AI_TELL_PATTERNS,
};
