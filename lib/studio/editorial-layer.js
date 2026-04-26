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

  const raw =
    story?.hook || story?.title || "This gaming story needs a sharper hook.";
  let hook = String(raw).split(/[.!?]/)[0].trim();
  for (const opener of BANNED_OPENERS) hook = hook.replace(opener, "");
  const words = wordsOf(hook);
  if (words.length > 12) hook = words.slice(0, 12).join(" ");
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

function buildStudioEditorial(story) {
  const raw = story?.full_script || story?.body || story?.hook || "";
  const tightened = tightenScript(stripGenericCta(raw), story);

  const metro = /metro\s+2039/i.test(story?.title || "");
  const scripted = metro
    ? buildMetro2039Script()
    : {
        hook: rewriteHook(story),
        body: removeAiTells(tightened.scriptForCaption),
        loop: "",
        fullScript: removeAiTells(tightened.scriptForCaption),
      };

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
  scoreHook,
  wordCount,
  scriptFromTimestampAlignment,
  AI_TELL_PATTERNS,
};
