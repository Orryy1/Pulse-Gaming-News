const axios = require("axios");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const { addBreadcrumb, captureException } = require("./lib/sentry");
const db = require("./lib/db");
const { createLlmClient } = require("./lib/llm-client");
const {
  classifyShortScriptRuntime,
  countSpokenWords,
  secondsPerWordForTtsProvider,
  DEFAULT_MIN_WORDS,
  DEFAULT_MAX_WORDS,
} = require("./lib/services/short-runtime-planner");
const {
  lintScript,
  buildRetryFeedback,
} = require("./lib/services/script-lint");
const { runScriptCoherenceQa } = require("./lib/script-coherence-qa");
const {
  buildSourceBoundFallbackScript,
} = require("./lib/source-bound-script-writer");

const { getChannel } = require("./channels");
const { getAnalyticsContext } = require("./analytics");

const BANNED_STARTS = [
  "so",
  "today",
  "hey",
  "welcome",
  "in this",
  "finally",
  "actually",
];
const BANNED_LOOP_PHRASES = ["let me know in the comments"];

const DEMONETIZATION_WORDS = [
  "killed",
  "murder",
  "suicide",
  "rape",
  "terrorist",
  "massacre",
  "genocide",
  "slaughter",
];

const ADVERTISER_SAFE_REPLACEMENTS = [
  [/\bkilled\b/gi, "ended"],
  [/\bkilling\b/gi, "ending"],
  [/\bmurder(?:ed|ing)?\b/gi, "removed"],
  [/\bsuicide\b/gi, "self-harm"],
  [/\brape\b/gi, "assault"],
  [/\bterrorist(?:s)?\b/gi, "hostile faction"],
  [/\bmassacre(?:d|s)?\b/gi, "wipeout"],
  [/\bgenocide\b/gi, "atrocity"],
  [/\bslaughter(?:ed|ing|s)?\b/gi, "wipeout"],
];

// Finance-specific red flags (Stacked channel) - reject scripts with hype language
const FINANCE_RED_FLAGS = [
  "moon",
  "rocket",
  "guaranteed",
  "get rich",
  "100x",
  "huge gains",
  "don't miss out",
  "to the moon",
  "diamond hands",
  "ape in",
  "free money",
  "can't lose",
];

const PULSE_EXACT_CTA = "Follow Pulse Gaming so you never miss a beat.";
const PULSE_CTA_ENDING_RE =
  /(?:[\s,.!?:;]*(?:don[’']?t miss out on (?:the )?latest gaming news[^.!?]*[.!?]\s*)?(?:follow(?:ing)?\s+pulse\s+gaming\s+so\s+you\s+never\s+miss(?:es)?\s+a\s+beat\.?))+$/i;
const PULSE_PRE_CTA_PROMO_ENDING_RE =
  /[\s,.!?:;]*don[’']?t miss out on (?:the )?latest gaming news[^.!?]*[.!?]?$/i;

// British English enforcement map - common Americanisms Claude defaults to
const BRITISH_SPELLING = {
  summarize: "summarise",
  summarized: "summarised",
  summarizing: "summarising",
  customize: "customise",
  customized: "customised",
  optimize: "optimise",
  optimized: "optimised",
  optimization: "optimisation",
  recognize: "recognise",
  recognized: "recognised",
  analyze: "analyse",
  analyzed: "analysed",
  analyzing: "analysing",
  color: "colour",
  colors: "colours",
  favor: "favour",
  favored: "favoured",
  favorite: "favourite",
  honor: "honour",
  honored: "honoured",
  defense: "defence",
  offense: "offence",
  license: "licence",
  program: "programme",
  catalog: "catalogue",
  center: "centre",
  centers: "centres",
  theater: "theatre",
  theaters: "theatres",
  fiber: "fibre",
  liter: "litre",
  meter: "metre",
  modeling: "modelling",
  traveling: "travelling",
  canceled: "cancelled",
  canceling: "cancelling",
  fulfill: "fulfil",
  jewelry: "jewellery",
  skeptic: "sceptic",
  skeptical: "sceptical",
};

function checkAdvertiserSafety(script) {
  const text = (script.full_script || "").toLowerCase();
  const found = DEMONETIZATION_WORDS.filter((w) => text.includes(w));
  return found;
}

function replaceAdvertiserRiskWords(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const [pattern, replacement] of ADVERTISER_SAFE_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function normaliseScriptPunctuation(text) {
  if (typeof text !== "string" || !text) return text;
  return text
    .replace(/\.{2,}/g, ".")
    .replace(/([.!?])\s+\1/g, "$1")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanHookDisplayText(text) {
  if (typeof text !== "string" || !text) return text;
  return normaliseScriptPunctuation(
    text.replace(/\[PAUSE\]/gi, ". ").replace(/\[VISUAL:[^\]]*\]/gi, " "),
  );
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function trimToWordLimit(text, limit = 18) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= limit) return String(text || "").trim();
  return `${words.slice(0, limit).join(" ").replace(/[,:;]+$/, "")}.`;
}

function derivePunchHook(hook) {
  const raw = cleanHookDisplayText(String(hook || "").replace(/\s+/g, " "));
  if (!raw) return raw;

  const firstSentence = raw.split(/(?<=[.!?])\s+/)[0]?.trim();
  if (
    firstSentence &&
    firstSentence !== raw &&
    countWords(firstSentence) >= 4 &&
    countWords(firstSentence) <= 24
  ) {
    return firstSentence;
  }
  if (countWords(raw) <= 24) return raw;

  const firstClause = raw.split(/\s[,;:]\s|,\s|;\s|:\s/)[0]?.trim();
  if (firstClause && countWords(firstClause) >= 4 && countWords(firstClause) <= 24) {
    return /[.!?]$/.test(firstClause) ? firstClause : `${firstClause}.`;
  }

  return trimToWordLimit(raw, 18);
}

function stripJsonCodeFence(rawText) {
  let text = String(rawText || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return text.trim();
}

function extractJsonObjectText(rawText) {
  const text = stripJsonCodeFence(rawText);
  if (text.startsWith("{") && text.endsWith("}")) return text;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text;
}

function escapeControlCharsInsideJsonStrings(rawText) {
  const text = String(rawText || "");
  let out = "";
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      out += char;
      escaped = inString;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }

    if (inString && char.charCodeAt(0) < 0x20) {
      out += char === "\n" || char === "\r" ? "\\n" : " ";
      continue;
    }

    out += char;
  }

  return out;
}

function parseLlmJsonObject(rawText) {
  const text = extractJsonObjectText(rawText);
  try {
    return JSON.parse(text);
  } catch (firstErr) {
    const repaired = escapeControlCharsInsideJsonStrings(text);
    try {
      return JSON.parse(repaired);
    } catch {
      throw firstErr;
    }
  }
}

// --- Fetch source material for fact-checking ---
async function fetchSourceMaterial(story) {
  const parts = [];

  if (story.url && story.url.includes("reddit.com")) {
    try {
      const jsonUrl = story.url.replace(/\/$/, "") + ".json";
      const response = await axios.get(jsonUrl, {
        timeout: 8000,
        headers: { "User-Agent": "pulse-gaming-bot/1.0" },
      });
      const listing = response.data;
      if (Array.isArray(listing) && listing[0]?.data?.children?.[0]?.data) {
        const post = listing[0].data.children[0].data;
        if (post.selftext) {
          parts.push(`REDDIT POST BODY:\n${post.selftext.substring(0, 1500)}`);
        }
        if (post.url && !post.url.includes("reddit.com")) {
          const articleText = await fetchPageText(post.url);
          if (articleText) {
            parts.push(`LINKED ARTICLE (${post.url}):\n${articleText}`);
          }
        }
        if (listing[1]?.data?.children) {
          const topComments = listing[1].data.children
            .filter((c) => c.data?.body)
            .slice(0, 3)
            .map((c) => c.data.body.substring(0, 300))
            .join("\n---\n");
          if (topComments) {
            parts.push(
              `TOP REDDIT COMMENTS (audience reaction only, not factual source):\n${topComments}`,
            );
          }
        }
      }
    } catch (err) {
      console.log(`[processor] Reddit JSON fetch failed: ${err.message}`);
    }
  }

  if (story.article_url && !story.article_url.includes("reddit.com")) {
    const articleText = await fetchPageText(story.article_url);
    if (articleText) {
      parts.push(`SOURCE ARTICLE (${story.article_url}):\n${articleText}`);
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

async function fetchPageText(url) {
  if (!url) return null;
  // SSRF guard — the story.article_url / linked_url we're fed here
  // comes from RSS/Reddit and is attacker-controllable. See
  // lib/safe-url.js + docs/url-fetch-safety-audit.md for the full
  // rationale. Reject non-http(s), localhost, RFC1918, cloud
  // metadata addresses before hitting axios.
  const { classifyOutboundUrl, safeRedirectConfig } = require("./lib/safe-url");
  const safe = classifyOutboundUrl(url);
  if (!safe.ok) {
    console.log(`[processor] skipping unsafe page URL: ${safe.reason}`);
    return null;
  }
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PulseGaming/1.0)" },
      ...safeRedirectConfig(3),
      maxContentLength: 5 * 1024 * 1024, // 5MB cap on article HTML
    });
    const html = response.data;
    if (typeof html !== "string") return null;
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#\d+;/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 2000) text = text.substring(0, 2000) + "...";
    return text.length > 50 ? text : null;
  } catch (err) {
    return null;
  }
}

async function searchCurrentFacts(query) {
  try {
    const searchQuery = encodeURIComponent(query + " 2026");
    const response = await axios.get(
      `https://api.duckduckgo.com/?q=${searchQuery}&format=json&no_html=1&skip_disambig=1`,
      { timeout: 5000 },
    );
    const data = response.data;
    const facts = [];
    if (data.Abstract) facts.push(data.Abstract);
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text) facts.push(topic.Text);
      }
    }
    return facts.length > 0 ? facts.join("\n").substring(0, 1500) : null;
  } catch (err) {
    return null;
  }
}

function getTodayString() {
  const d = new Date();
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Channel-specific valid classifications
const CHANNEL_CLASSIFICATIONS = {
  "pulse-gaming": ["[LEAK]", "[RUMOR]", "[CONFIRMED]", "[BREAKING]"],
  stacked: [
    "[INSIDER]",
    "[RUMOR]",
    "[CONFIRMED]",
    "[BREAKING]",
    "[EARNINGS]",
    "[MARKET]",
  ],
  "the-signal": [
    "[LEAK]",
    "[RUMOR]",
    "[CONFIRMED]",
    "[BREAKING]",
    "[LAUNCH]",
    "[TECH]",
  ],
};

const RELEASE_DATE_MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function dateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseLongDate(monthName, dayValue, yearValue) {
  const month = RELEASE_DATE_MONTHS[String(monthName || "").toLowerCase()];
  const day = Number(dayValue);
  const year = Number(yearValue);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) {
    return null;
  }
  const parsed = new Date(year, month, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function formatLongDate(date) {
  const month = Object.keys(RELEASE_DATE_MONTHS).find(
    (name) => RELEASE_DATE_MONTHS[name] === date.getMonth(),
  );
  const day = date.getDate();
  const suffix =
    day >= 11 && day <= 13
      ? "th"
      : day % 10 === 1
        ? "st"
        : day % 10 === 2
          ? "nd"
          : day % 10 === 3
            ? "rd"
            : "th";
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${day}${suffix}, ${date.getFullYear()}`;
}

function releaseClaimImpliesAlreadyOut(sentence) {
  return /\b(launched|released|arrived|dropped|landed|went live|is live|is out|out now|available now|available today|launches today|releases today|hits today|unlocks today|opens today)\b/i.test(
    sentence,
  );
}

function validateFutureReleaseClaims(script, { now = new Date() } = {}) {
  const today = dateOnly(now);
  const text = [
    script.hook,
    script.body,
    script.loop,
    script.cta,
    script.full_script,
    script.tts_script,
  ]
    .filter(Boolean)
    .join(". ");
  const sentenceChunks = text.split(/(?<=[.!?])\s+|\n+/);
  const errors = [];
  const dateRe =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/gi;

  for (const sentence of sentenceChunks) {
    dateRe.lastIndex = 0;
    let match;
    while ((match = dateRe.exec(sentence))) {
      const claimedDate = parseLongDate(match[1], match[2], match[3]);
      if (!claimedDate || dateOnly(claimedDate) <= today) continue;

      const impliesToday = /\btoday\b/i.test(sentence);
      const impliesAlreadyOut = releaseClaimImpliesAlreadyOut(sentence);
      if (!impliesToday && !impliesAlreadyOut) continue;

      errors.push(
        `unsupported_future_release_claim:${formatLongDate(claimedDate)} is after today (${formatLongDate(today)})`,
      );
    }
  }

  return [...new Set(errors)];
}

function resolveTtsProviderForRuntime(options = {}) {
  return String(
    options.ttsProvider ||
      options.provider ||
      process.env.TTS_PROVIDER ||
      "elevenlabs",
  )
    .trim()
    .toLowerCase();
}

function resolvePulseRuntimeProfile(options = {}) {
  const provider = resolveTtsProviderForRuntime(options);
  const secondsPerWord =
    Number.isFinite(Number(options.secondsPerWord)) && Number(options.secondsPerWord) > 0
      ? Number(options.secondsPerWord)
      : secondsPerWordForTtsProvider(provider, options.env || process.env);
  const probe = classifyShortScriptRuntime({
    wordCount: 1,
    secondsPerWord,
  });
  const minWords = probe.minWords || DEFAULT_MIN_WORDS;
  const maxWords = probe.maxWords || DEFAULT_MAX_WORDS;
  const reviewMaxWords = probe.reviewMaxWords || Math.max(maxWords, DEFAULT_MAX_WORDS);
  const span = Math.max(0, maxWords - minWords);
  let aimMin = Math.ceil(minWords + span * 0.25);
  let aimMax = Math.floor(maxWords - span * 0.25);
  if (aimMin > aimMax) {
    const mid = Math.round((minWords + maxWords) / 2);
    aimMin = mid;
    aimMax = mid;
  }
  return {
    provider,
    secondsPerWord,
    minWords,
    maxWords,
    reviewMaxWords,
    aimMin,
    aimMax,
  };
}

function runtimeWordRange(profile = resolvePulseRuntimeProfile()) {
  return `${profile.minWords}-${profile.maxWords}`;
}

function runtimeAimRange(profile = resolvePulseRuntimeProfile()) {
  return profile.aimMin === profile.aimMax
    ? String(profile.aimMin)
    : `${profile.aimMin}-${profile.aimMax}`;
}

function buildPulseRuntimePromptInstruction(channel = {}, options = {}) {
  if (channel?.id !== "pulse-gaming") return "";
  const profile = resolvePulseRuntimeProfile(options);
  const legacyNote =
    profile.provider === "local"
      ? "This overrides any older 90-110 word guidance, which only applied to the slower ElevenLabs path."
      : "This is the active ElevenLabs pacing contract.";
  return [
    "",
    "ACTIVE PULSE RUNTIME CONTRACT:",
    `- TTS provider: ${profile.provider}.`,
    `- full_script must be ${runtimeWordRange(profile)} cleaned spoken words for a 61-75 second Short.`,
    `- Aim for ${runtimeAimRange(profile)} words so the voice does not land too short or scrape the ceiling.`,
    "- Do not pad with vague channel strategy, repeated claims or internal Pulse language.",
    `- ${legacyNote}`,
  ].join("\n");
}

function validate(script, channelId, options = {}) {
  const errors = [];
  const actualWords = countSpokenWords(cleanForTTS(script.full_script || ""));
  const requiresPulseCta = channelId === "pulse-gaming";
  errors.push(...validateFutureReleaseClaims(script, options));
  const coherenceQa = runScriptCoherenceQa(
    { ...(options.story || {}), ...script },
    {
      requireCtaField: requiresPulseCta,
      requireFullScriptCta: requiresPulseCta,
    },
  );
  errors.push(...coherenceQa.failures);
  if (channelId === "pulse-gaming") {
    const runtimeProfile = resolvePulseRuntimeProfile(options);
    const runtime = classifyShortScriptRuntime({
      text: cleanForTTS(script.full_script || ""),
      secondsPerWord: runtimeProfile.secondsPerWord,
    });
    if (runtime.result === "fail") {
      const reason =
        runtime.failures[0] || runtime.warnings[0] || "script_runtime_invalid";
      errors.push(
        `${reason}; actual spoken words ${actualWords} outside ${runtime.minWords}-${runtime.reviewMaxWords} Short review range`,
      );
    }
    const maxAllowedWords =
      runtime.result === "review" && runtime.route === "extended_or_briefing"
        ? runtime.reviewMaxWords
        : runtime.maxWords;
    const wordRangeLabel =
      maxAllowedWords > runtime.maxWords ? "Flash/Extended Short" : "Flash Lane";
    if (actualWords < runtime.minWords || actualWords > maxAllowedWords) {
      errors.push(
        `Actual spoken word count ${actualWords} outside ${runtime.minWords}-${maxAllowedWords} ${wordRangeLabel} range`,
      );
    }
  } else if (script.word_count < 155 || script.word_count > 185) {
    errors.push(`Word count ${script.word_count} outside 155-185 range`);
  }
  const hookLower = (script.hook || "").toLowerCase().trim();
  for (const banned of BANNED_STARTS) {
    if (hookLower.startsWith(banned)) {
      errors.push(`Hook starts with banned word: "${banned}"`);
    }
  }
  // Curiosity gap validation - hook must not be vague or give away the answer
  const hookWords = (script.hook || "").split(/\s+/).length;
  if (hookWords > 25) {
    errors.push(
      `Hook too long (${hookWords} words) - must be under 25 words for punch`,
    );
  }
  const weakPatterns = [
    /^big news/i,
    /^breaking news/i,
    /^some news/i,
    /^here's what/i,
    /^let's talk/i,
    /^did you know/i,
    /^you won't believe/i,
    /^check this out/i,
    /^guess what/i,
  ];
  for (const pat of weakPatterns) {
    if (pat.test(script.hook || "")) {
      errors.push(
        `Hook uses weak/generic opener pattern - needs curiosity gap`,
      );
      break;
    }
  }
  // Validate classification exists (channel-aware)
  const validClassifications =
    CHANNEL_CLASSIFICATIONS[channelId] ||
    CHANNEL_CLASSIFICATIONS["pulse-gaming"];
  if (
    !script.classification ||
    !validClassifications.includes(script.classification)
  ) {
    errors.push("Missing or invalid classification tag");
  }
  // Advertiser-safety check (warnings, not hard failures - gaming news may reference violence)
  const unsafeWords = checkAdvertiserSafety(script);
  if (unsafeWords.length > 0) {
    errors.push(
      `Advertiser-safety warning: contains "${unsafeWords.join('", "')}"`,
    );
  }
  // Finance channel: reject hype language that could trigger "financial advice" flags
  if (channelId === "stacked") {
    const bodyLower = (script.full_script || "").toLowerCase();
    const hypeFound = FINANCE_RED_FLAGS.filter((w) => bodyLower.includes(w));
    if (hypeFound.length > 0) {
      errors.push(
        `Finance hype language detected: "${hypeFound.join('", "')}". Rewrite without hype.`,
      );
    }
  }
  return errors;
}

// --- Post-generation sanitisation: fix banned openers and enforce British English ---
function sanitiseScript(script) {
  // Strip banned openers that slip through despite system prompt
  const forbidden = /^(so|today|hey|welcome|finally|actually)\b\s*/i;
  for (const key of ["hook", "full_script"]) {
    if (script[key] && forbidden.test(script[key].trim())) {
      script[key] = script[key].trim().replace(forbidden, "");
      script[key] = script[key].charAt(0).toUpperCase() + script[key].slice(1);
    }
  }

  // Enforce British English spelling across all text fields
  for (const key of [
    "hook",
    "body",
    "cta",
    "full_script",
    "suggested_title",
    "suggested_thumbnail_text",
  ]) {
    if (!script[key]) continue;
    script[key] = replaceAdvertiserRiskWords(script[key]);
    script[key] = normaliseScriptPunctuation(script[key]);
    for (const [american, british] of Object.entries(BRITISH_SPELLING)) {
      const regex = new RegExp(`\\b${american}\\b`, "gi");
      script[key] = script[key].replace(regex, (match) => {
        // Preserve capitalisation of the original word
        if (match[0] === match[0].toUpperCase()) {
          return british.charAt(0).toUpperCase() + british.slice(1);
        }
        return british;
      });
    }
  }

  if (script.hook) {
    script.hook = derivePunchHook(script.hook);
  }

  return script;
}

function ensurePulseExactCta(script = {}, channelId = "pulse-gaming") {
  if (channelId !== "pulse-gaming" || !script || typeof script !== "object") {
    return script;
  }

  script.cta = PULSE_EXACT_CTA;
  const fullScript = normaliseScriptPunctuation(String(script.full_script || "")).trim();
  if (!fullScript) return script;

  const base =
    fullScript
      .replace(PULSE_CTA_ENDING_RE, "")
      .replace(PULSE_PRE_CTA_PROMO_ENDING_RE, "")
      .trim() || fullScript;
  const separator = /[.!?]$/.test(base) ? " " : ". ";
  script.full_script = `${base}${separator}${PULSE_EXACT_CTA}`
    .replace(/\s+/g, " ")
    .trim();
  return script;
}

// --- Quality gate: score script 1-10 via second LLM call ---
async function scoreScript(client, script, story, channel) {
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: `You score YouTube Shorts scripts for a ${channel.niche} news channel called ${channel.name} (1-10). Criteria (in priority order):
- HOOK STRENGTH (40% of score): Does it use a CURIOSITY GAP? Does it open a knowledge gap that compels the viewer to keep watching? A hook that reveals the answer or is vague scores 1-3. A hook that creates genuine "wait, WHAT?" tension scores 8-10.
- MID-ROLL RE-HOOK (10%): Does the body contain a fresh, story-specific pivot sentence around the midpoint that resets attention? Reward concrete pivots built around a named person, number, source contradiction, timing detail or platform consequence. Penalise canned pivots such as "But here is where it gets interesting", "This is the part nobody is reporting" or "This changes everything".
- Information density (15%): facts per sentence, no filler
- Source credibility (15%): does it cite sources?
- Pacing (10%): punchy, no dead air, urgent tone
- CTA presence (10%)
A script with a weak hook can NEVER score above 5, regardless of how good the body is.
Reply with ONLY a JSON object: { "score": N, "reason": "one sentence" }`,
      messages: [
        {
          role: "user",
          content: `Score this script:\n${script.full_script}\n\nClassification: ${script.classification}\nStory: ${story.title}`,
        },
      ],
    });

    const result = parseLlmJsonObject(response.content[0].text);
    return { score: result.score || 5, reason: result.reason || "" };
  } catch (err) {
    console.log(`[processor] Quality gate error: ${err.message}`);
    return {
      score: 0,
      reason: `scoring failed - review required: ${String(err.message || "unknown").slice(0, 160)}`,
    };
  }
}

/**
 * Sonnet "Smart Editor" pass: uses a stronger model to polish the script
 * for compliance, authority and natural language flow.
 * Only runs on scripts that passed the quality gate (score >= 7).
 */
function editorWordCountInstruction(channel, options = {}) {
  if (channel?.id === "pulse-gaming") {
    const runtimeProfile = resolvePulseRuntimeProfile(options);
    return (
      `7) Keep the exact same classification tag and keep full_script within ` +
      `${runtimeWordRange(runtimeProfile)} cleaned spoken words. Do not expand it beyond that active provider budget.`
    );
  }
  return "7) Keep the exact same classification tag and word count range (155-185).";
}

async function sonnetEditorPass(client, script, channel, story = {}, options = {}) {
  try {
    const isFinance = channel.id === "stacked";
    const complianceRules = isFinance
      ? '1) Remove any language that sounds like financial advice or a guarantee of returns. 2) Ensure the tone is cynical and professional. 3) Verify "This is not financial advice" appears in the script.'
      : "1) Ensure the tone matches the channel persona. 2) Remove any filler words or generic phrasing.";

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: `You are an editor-in-chief reviewing a YouTube Shorts script for ${channel.name} (${channel.niche}). Your job is to tighten the writing WITHOUT changing the facts or structure.

Rules:
${complianceRules}
3) Verify no serial commas are present. British English only.
4) If the hook is weak, rewrite it using the Curiosity Gap technique.
5) Ensure sentence lengths vary (mix short 3-8 word punches with 15-25 word details).
6) Remove em dashes. Replace with commas or full stops.
${editorWordCountInstruction(channel, options)}

Reply with ONLY the edited JSON object in the same format as the input. No explanation.`,
      messages: [
        {
          role: "user",
          content: JSON.stringify(script),
        },
      ],
    });

    const edited = parseLlmJsonObject(response.content[0].text);

    // Preserve original classification if editor changed it
    if (
      script.classification &&
      edited.classification !== script.classification
    ) {
      edited.classification = script.classification;
    }

    edited.word_count = countSpokenWords(cleanForTTS(edited.full_script || ""));
    const runtimeProfile = resolvePulseRuntimeProfile(options);
    const errors = validate(edited, channel.id, {
      story,
      ttsProvider: runtimeProfile.provider,
      secondsPerWord: runtimeProfile.secondsPerWord,
    });
    if (errors.length > 0) {
      throw new Error(`editor_validation_failed:${errors.join("; ")}`);
    }
    const lint = lintScript(edited.full_script || "", {
      minWords: runtimeProfile.minWords,
      maxWords: runtimeProfile.maxWords,
    });
    if (lint.result === "fail") {
      throw new Error(`editor_lint_failed:${lint.failures.join("; ")}`);
    }

    console.log(`[processor] Sonnet editor polished script`);
    return edited;
  } catch (err) {
    console.log(
      `[processor] Sonnet editor pass failed (non-fatal): ${err.message}`,
    );
    return script; // Return original on failure
  }
}

function getContentPillar(classification) {
  const c = (classification || "").toLowerCase();
  if (c.includes("confirmed")) return "Confirmed Drop";
  if (c.includes("leak") || c.includes("breaking")) return "Source Breakdown";
  if (c.includes("rumor")) return "Rumour Watch";
  return "Confirmed Drop";
}

function buildScriptValidationReview(story = {}, channel = {}, errors = []) {
  const title = String(story.title || "Manual review required");
  const safeErrors = (Array.isArray(errors) ? errors : [errors])
    .filter(Boolean)
    .map((error) => String(error).slice(0, 240))
    .slice(0, 10);
  const route = safeErrors.some((error) =>
    /^script_runtime_extended_review_required/.test(error),
  )
    ? "extended_or_briefing"
    : safeErrors.some((error) => /^script_runtime_too_long/.test(error))
      ? "briefing_or_longform"
      : "review_or_briefing";

  return {
    classification: "[REVIEW]",
    hook: "",
    body: "",
    cta: "",
    full_script: "",
    tts_script: "",
    word_count: 0,
    suggested_thumbnail_text: title.substring(0, 40),
    suggested_title: title.substring(0, 60),
    content_pillar: "Manual Review",
    quality_score: 0,
    approved: false,
    auto_approved: false,
    format_route: route,
    runtime_route: route,
    script_generation_status: "review_required",
    script_review_reason: safeErrors[0] || "script_validation_failed",
    script_validation_errors: safeErrors,
    channel_id: channel.id || story.channel_id,
  };
}

function buildValidationRetryFeedback(errors = [], options = {}) {
  const safeErrors = (Array.isArray(errors) ? errors : [errors])
    .filter(Boolean)
    .map((error) => String(error))
    .slice(0, 8);
  if (safeErrors.length === 0) return "";
  const runtimeProfile = resolvePulseRuntimeProfile(options);

  const lines = [
    "VALIDATION REWRITE BRIEF:",
    `- Rewrite full_script as ${runtimeWordRange(runtimeProfile)} cleaned spoken words. Aim for ${runtimeAimRange(runtimeProfile)} words, not the edge of the range.`,
    "- Use an angle-first story arc: scroll-stopping hook, named source, what happened, concrete player consequence, hot take, payoff, exact CTA.",
    "- The hot take must be useful and source-safe: explain why the fact matters, who benefits, what changes for players or what risk/catch the headline hides.",
    "- Do not repeat the same claim in different wording.",
    "- Do not mention Pulse except the exact final CTA.",
    "- Do not write internal strategy language such as signal, safe read, safe takeaway, direction of travel or tracking confirmation.",
    "- Do not use generic hype such as community is buzzing, changes everything, nobody saw this coming or here is where it gets interesting.",
    "- If the source is thin, write a smaller, honest script instead of padding.",
    "Validation failures to fix:",
  ];

  for (const error of safeErrors) {
    lines.push(`  - ${error}`);
    if (/Actual spoken word count \d+ outside/i.test(error)) {
      lines.push(
        "    Fix: adjust length with source-backed facts only. Add or remove concrete details, not filler.",
      );
    }
    if (/missing_exact_cta_in_script|cta_not_exact/i.test(error)) {
      lines.push(
        "    Fix: end full_script with exactly: Follow Pulse Gaming so you never miss a beat.",
      );
    }
    if (/vague_filler|internal_pulse|abstract_signal|community_is_buzzing/i.test(
      error,
    )) {
      lines.push(
        "    Fix: replace vague channel-strategy phrasing with the named source, number, platform, price, release window or player impact.",
      );
    }
    if (/repeated_sentence|repeated_phrase/i.test(error)) {
      lines.push(
        "    Fix: each sentence must add a new fact or consequence. Do not restate the hook.",
      );
    }
  }

  return lines.join("\n");
}

function trySourceBoundFallbackScript(story = {}, channel = {}, options = {}) {
  if (channel?.id !== "pulse-gaming") return null;
  const runtimeProfile = resolvePulseRuntimeProfile(options);
  const fallback = buildSourceBoundFallbackScript(story, {
    runtimeProfile,
    sourceMaterial: options.sourceMaterial,
    env: options.env || process.env,
  });
  if (!fallback) return null;

  sanitiseScript(fallback);
  ensurePulseExactCta(fallback, channel.id);
  fallback.word_count = countSpokenWords(cleanForTTS(fallback.full_script || ""));

  const validationErrors = validate(fallback, channel.id, {
    story,
    ttsProvider: runtimeProfile.provider,
    secondsPerWord: runtimeProfile.secondsPerWord,
  });
  if (validationErrors.length > 0) {
    console.log(
      `[processor] Source-bound fallback rejected: ${validationErrors.join(", ")}`,
    );
    return null;
  }

  const lint = lintScript(fallback.full_script || "", {
    minWords: runtimeProfile.minWords,
    maxWords: runtimeProfile.maxWords,
  });
  if (lint.result === "fail") {
    console.log(
      `[processor] Source-bound fallback lint rejected: ${lint.failures.join(", ")}`,
    );
    return null;
  }

  console.log(
    `[processor] Source-bound fallback accepted (${fallback.word_count} words)`,
  );
  return fallback;
}

// --- Clean script text for TTS (strip markers) ---
function cleanForTTS(text) {
  if (!text) return "";
  return (
    text
      .replace(/\[PAUSE\]/gi, ", ")
      .replace(/\[VISUAL:[^\]]*\]/gi, "")
      .replace(/\.{2,}/g, ".") // collapse ellipses to single period
      // Ensure space after sentence-ending periods (LLM sometimes omits: "2026.The")
      .replace(/\.([A-Z])/g, ". $1")
      // Strip Reddit subreddit paths - TTS mangles "r/PS5" into gibberish
      .replace(/\br\/(\w+)/g, (_, sub) => `the ${sub} subreddit`)
      .replace(/\bGTA\s*VI\b/gi, "G T A six")
      .replace(/\bGTA\s*6\b/gi, "G T A six")
      .replace(/\bGTA\b/g, "G T A")
      .replace(/\bAAA\b/g, "Triple-A")
      .replace(/\bDLC\b/g, "D L C")
      .replace(/\bFPS\b/g, "F P S")
      .replace(/\bRPG\b/g, "R P G")
      .replace(/\bNPC\b/g, "N P C")
      .replace(/\bUI\b/g, "U I")
      .replace(/\bIP\b/g, "I P")
      .replace(/\bPS6\b/g, "P S 6")
      .replace(/\bPS5\b/g, "P S 5")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// --- Title similarity check (Jaccard) for cross-cycle dedup ---
function titleSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.length / union.size;
}

async function process_stories(options = {}) {
  const {
    storiesOverride = null,
    skipDedupIds = [],
    postDiscord = true,
    persist = true,
    maxScriptAttempts = 3,
    skipEditorPass = false,
  } = options || {};
  console.log("[processor] Loading pending_news.json...");

  let stories;
  if (Array.isArray(storiesOverride)) {
    stories = storiesOverride;
  } else {
    if (!(await fs.pathExists("pending_news.json"))) {
      console.log(
        "[processor] ERROR: pending_news.json not found. Run hunter first.",
      );
      return [];
    }

    const data = await fs.readJson("pending_news.json");
    stories = data.stories || [];
  }
  console.log(`[processor] Processing ${stories.length} stories...`);

  // Cross-cycle dedup: check pending stories against existing daily_news.json
  const skipDedupSet = new Set((skipDedupIds || []).filter(Boolean));
  const existingStories = await db.getStories();
  if (existingStories.length > 0) {
    const before = stories.length;
    stories = stories.filter((pending) => {
      if (skipDedupSet.has(pending.id)) {
        console.log(`[processor] Reprocess allowed (ID match): ${pending.title}`);
        return true;
      }
      // Check by ID
      if (existingStories.some((e) => e.id === pending.id)) {
        console.log(`[processor] Dedup (ID match): ${pending.title}`);
        return false;
      }
      // Check by title similarity (catches same story from different sources/IDs)
      const similar = existingStories.find(
        (e) => titleSimilarity(e.title, pending.title) > 0.5,
      );
      if (similar) {
        console.log(
          `[processor] Dedup (title match): "${pending.title}" ~ "${similar.title}"`,
        );
        return false;
      }
      return true;
    });
    if (before !== stories.length) {
      console.log(
        `[processor] Dedup: filtered ${before - stories.length} duplicates, ${stories.length} remaining`,
      );
    }
  }

  const channel = getChannel();
  console.log(`[processor] Active channel: ${channel.name} (${channel.niche})`);
  const runtimeProfile = resolvePulseRuntimeProfile();
  if (channel.id === "pulse-gaming") {
    console.log(
      `[processor] Active Pulse runtime: ${runtimeProfile.provider} ${runtimeWordRange(runtimeProfile)} words (aim ${runtimeAimRange(runtimeProfile)})`,
    );
  }

  // Use channel's system prompt, fall back to file for backwards compatibility
  const baseSystemPrompt =
    channel.systemPrompt || (await fs.readFile("system_prompt.txt", "utf-8"));
  const today = getTodayString();

  const client = createLlmClient();

  const enriched = [];

  for (const story of stories) {
    addBreadcrumb(`Processing story: ${story.title}`, "processor");
    console.log(`[processor] Scripting: ${story.title}`);

    // --- Fact-checking: fetch source material ---
    let sourceMaterial = null;
    let searchFacts = null;

    try {
      const [sources, facts] = await Promise.all([
        fetchSourceMaterial(story),
        searchCurrentFacts(story.title),
      ]);
      sourceMaterial = sources;
      searchFacts = facts;
    } catch (err) {
      console.log(`[processor] Fact-check fetch error: ${err.message}`);
    }

    if (sourceMaterial) {
      console.log(
        `[processor] Fetched source material (${sourceMaterial.length} chars)`,
      );
    }

    const factContext = [];
    if (sourceMaterial) factContext.push(sourceMaterial);
    if (searchFacts)
      factContext.push(`ADDITIONAL SEARCH CONTEXT:\n${searchFacts}`);

    // Inject analytics performance insights if available
    const analyticsContext = getAnalyticsContext();
    const analyticsSection = analyticsContext
      ? `\n\n${analyticsContext}\n`
      : "";

    const systemPrompt =
      baseSystemPrompt +
      analyticsSection +
      buildPulseRuntimePromptInstruction(channel, runtimeProfile) +
      `\n\nCRITICAL: DATE AND FACT-CHECKING RULES:
Today's date is ${today}. You MUST follow these rules:
1. NEVER reference dates in the past as if they are in the future.
2. Cross-reference the Reddit title against the SOURCE ARTICLE TEXT provided below. If the article contradicts the Reddit title, trust the article.
3. If a claim cannot be verified from the provided sources, use hedging language.
4. NEVER invent specific dates, prices or statistics that are not in the source material.
5. If the story references an old event or outdated information, update it to reflect the current situation as of ${today}.
6. For game release dates: check if the date has already passed. If so, note the game has either released or been delayed.
7. Do not use Reddit comments as factual evidence. Treat top comments only as audience colour, never as a source claim.`;

    const userMessage = [
      `Story title: ${story.title}`,
      `Flair: ${story.flair}`,
      `Subreddit: r/${story.subreddit}`,
      `Score: ${story.score}`,
      `Top comment (audience colour only, not source evidence): ${story.top_comment}`,
      `Story URL: ${story.url || story.article_url || "N/A"}`,
      `Date found: ${story.timestamp || today}`,
      factContext.length > 0
        ? `\n--- VERIFICATION DATA ---\n${factContext.join("\n\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    let script = null;
    let qualityScore = null;
    let attempts = 0;
    let lintRetryFeedback = "";
    let validationRetryFeedback = "";

    const scriptAttemptLimit =
      Number.isFinite(Number(maxScriptAttempts)) && Number(maxScriptAttempts) > 0
        ? Math.max(1, Math.min(3, Math.floor(Number(maxScriptAttempts))))
        : 3;

    while (attempts < scriptAttemptLimit) {
      attempts++;
      try {
        let extra = "";
        if (attempts === 2) {
          extra =
            `\n\nIMPORTANT: Your previous script failed validation. Ensure the actual full_script is ${runtimeWordRange(runtimeProfile)} spoken words for a 61-75 second Short using the active ${runtimeProfile.provider} voice path. Aim for ${runtimeAimRange(runtimeProfile)} words. Keep hook under 18 words. Include a classification tag. Do not start the hook with So, Today, Hey, Welcome or In this. Avoid advertiser-risk terms such as killed, murder, suicide, terrorist, massacre, genocide or slaughter.`;
        } else if (attempts === 3) {
          extra =
            `\n\nFINAL ATTEMPT: Produce a ${Math.round((runtimeProfile.aimMin + runtimeProfile.aimMax) / 2)}-word script. Hook must be one concrete sentence under 18 words. Use named people/companies and concrete outcomes. Include a classification tag and CTA. This is your last chance.`;
        }
        if (lintRetryFeedback) {
          extra += `\n\n${lintRetryFeedback}`;
        }
        if (validationRetryFeedback) {
          extra += `\n\n${validationRetryFeedback}`;
        }

        const response = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1200,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage + extra }],
        });

        script = parseLlmJsonObject(response.content[0].text);

        // Strip em dashes from all generated content (obvious AI tell)
        for (const key of [
          "hook",
          "body",
          "cta",
          "full_script",
          "suggested_title",
          "suggested_thumbnail_text",
        ]) {
          if (script[key])
            script[key] = script[key]
              .replace(/\u2014/g, ",")
              .replace(/\u2013/g, ",");
        }

        // Post-generation sanitisation: fix banned openers + British English
        sanitiseScript(script);
        ensurePulseExactCta(script, channel.id);
        script.word_count = countSpokenWords(cleanForTTS(script.full_script || ""));

        const errors = validate(script, channel.id, {
          story,
          ttsProvider: runtimeProfile.provider,
          secondsPerWord: runtimeProfile.secondsPerWord,
        });
        if (errors.length > 0) {
          console.log(
            `[processor] Validation failed (attempt ${attempts}): ${errors.join(", ")}`,
          );
          if (attempts >= scriptAttemptLimit) {
            const fallback = trySourceBoundFallbackScript(story, channel, {
              ...runtimeProfile,
              sourceMaterial,
            });
            if (fallback) {
              script = fallback;
              qualityScore = 7;
              break;
            }
            console.log(
              "[processor] Final validation failed; routing story to review",
            );
            script = buildScriptValidationReview(story, channel, errors);
            qualityScore = 0;
            break;
          } else {
            validationRetryFeedback = buildValidationRetryFeedback(
              errors,
              runtimeProfile,
            );
            script = null;
            continue;
          }
        } else {
          console.log(
            `[processor] Script validated (${script.word_count} words)`,
          );
        }

        const lint = lintScript(script.full_script || "", {
          minWords: runtimeProfile.minWords,
          maxWords: runtimeProfile.maxWords,
        });
        if (lint.result === "fail") {
          console.log(
            `[processor] Script lint failed (attempt ${attempts}): ${lint.failures.join(", ")}`,
          );
          lintRetryFeedback = buildRetryFeedback(lint);
          if (attempts >= scriptAttemptLimit) {
            const fallback = trySourceBoundFallbackScript(story, channel, {
              ...runtimeProfile,
              sourceMaterial,
            });
            if (fallback) {
              script = fallback;
              qualityScore = 7;
              break;
            }
            script = buildScriptValidationReview(story, channel, lint.failures);
            qualityScore = 0;
            break;
          }
          script = null;
          continue;
        }
        if (lint.warnings.length > 0) {
          console.log(
            `[processor] Script lint warnings: ${lint.warnings.join(", ")}`,
          );
        }

        // Quality gate - score the script. This must fail closed:
        // accepting an unscored draft is how vague or nonsensical
        // local-LLM output reaches TTS and public video.
        if (script) {
          const gate = await scoreScript(client, script, story, channel);
          qualityScore = gate.score;
          console.log(
            `[processor] Quality gate: ${gate.score}/10 - ${gate.reason}`,
          );
          if (gate.score < 7) {
            const reason = `quality_gate_below_threshold:${gate.score}/10:${gate.reason}`;
            if (attempts >= scriptAttemptLimit) {
              const fallback = trySourceBoundFallbackScript(story, channel, {
                ...runtimeProfile,
                sourceMaterial,
              });
              if (fallback) {
                script = fallback;
                qualityScore = 7;
                break;
              }
              console.log(
                `[processor] Final quality gate failed; routing story to review`,
              );
              script = buildScriptValidationReview(story, channel, [reason]);
              qualityScore = 0;
              break;
            }
            console.log(
              `[processor] Script below quality threshold (${gate.score}/10), regenerating...`,
            );
            script = null;
            continue;
          }
        }

        // Sonnet editor pass - polish high-scoring scripts with a stronger model
        if (script && qualityScore >= 7 && !skipEditorPass) {
          script = await sonnetEditorPass(
            client,
            script,
            channel,
            story,
            runtimeProfile,
          );
          // Re-strip em dashes after editor pass
          for (const key of [
            "hook",
            "body",
            "cta",
            "full_script",
            "suggested_title",
            "suggested_thumbnail_text",
          ]) {
            if (script[key])
              script[key] = script[key]
                .replace(/\u2014/g, ",")
                .replace(/\u2013/g, ",");
          }
          sanitiseScript(script);
        }
        break;
      } catch (err) {
        console.log(`[processor] ERROR on attempt ${attempts}: ${err.message}`);
        captureException(err, {
          step: "scriptGeneration",
          storyId: story.id,
          attempt: attempts,
        });
        if (attempts >= scriptAttemptLimit) {
          const fallback = trySourceBoundFallbackScript(story, channel, {
            ...runtimeProfile,
            sourceMaterial,
          });
          if (fallback) {
            script = fallback;
            qualityScore = 7;
            break;
          }
          script = buildScriptValidationReview(story, channel, [
            `script_generation_error:${err.message}`,
          ]);
          qualityScore = 0;
        }
      }
    }

    // Clean script for TTS (remove [PAUSE] and [VISUAL] markers)
    const ttsScript = cleanForTTS(script.full_script);

    const gameTitle = story.title.replace(/[^a-zA-Z0-9\s]/g, "").trim();
    const affiliateTag = process.env.AMAZON_AFFILIATE_TAG || "placeholder";
    const affiliateUrl = `https://www.amazon.co.uk/s?k=${encodeURIComponent(gameTitle)}&tag=${affiliateTag}`;
    const pinnedComment = `What do you think, legit or fake? Drop your take below 👇 | Check it out: ${affiliateUrl}`;

    const requiresScriptReview =
      script.script_generation_status === "review_required";

    const enrichedStory = {
      ...story,
      ...script,
      tts_script: ttsScript,
      quality_score: requiresScriptReview ? 0 : qualityScore,
      content_pillar: script.content_pillar || getContentPillar(script.classification),
      affiliate_url: affiliateUrl,
      pinned_comment: pinnedComment,
      approved: requiresScriptReview ? false : story.approved || false,
      auto_approved: requiresScriptReview ? false : story.auto_approved || false,
      script_generation_status: requiresScriptReview
        ? "review_required"
        : "script_ready",
      script_review_reason: requiresScriptReview
        ? script.script_review_reason
        : null,
      script_validation_errors: requiresScriptReview
        ? script.script_validation_errors || []
        : [],
    };

    // Generate A/B title variants only for scripts that are actually usable.
    // Review rows intentionally carry no public narration, so spending another
    // LLM call on titles just slows repair/reporting tools down.
    if (!requiresScriptReview) {
      try {
        const { generateTitleVariants } = require("./ab_titles");
        await generateTitleVariants(enrichedStory);
      } catch (err) {
        console.log(
          `[processor] A/B title variant generation skipped: ${err.message}`,
        );
      }
    }

    enriched.push(enrichedStory);
  }

  // Upsert each story individually to avoid wiping previously published stories.
  // saveStories() deletes anything not in the array, which destroys youtube_post_id
  // and other platform IDs from earlier cycles, causing duplicate uploads.
  if (persist) {
    for (const story of enriched) {
      await db.upsertStory(story);
    }
    console.log(`[processor] Saved ${enriched.length} enriched stories (upsert)`);
  } else {
    console.log(`[processor] Dry-run: generated ${enriched.length} enriched stories`);
  }

  // Post new stories to Discord news channels
  if (postDiscord && persist) {
    try {
      const { postNewStory } = require("./discord/auto_post");
      let postedCount = 0;
      for (const story of enriched) {
        const msg = await postNewStory(story);
        if (msg) postedCount++;
      }
      console.log(
        `[processor] Discord: posted ${postedCount}/${enriched.length} stories to news channels`,
      );
    } catch (err) {
      console.log(`[processor] Discord news posting skipped: ${err.message}`);
    }
  } else {
    console.log("[processor] Discord news posting skipped by options");
  }

  return enriched;
}

module.exports = process_stories;
module.exports.validate = validate;
module.exports.editorWordCountInstruction = editorWordCountInstruction;
module.exports.buildScriptValidationReview = buildScriptValidationReview;
module.exports.buildValidationRetryFeedback = buildValidationRetryFeedback;
module.exports.cleanForTTS = cleanForTTS;
module.exports.parseLlmJsonObject = parseLlmJsonObject;
module.exports.sanitiseScript = sanitiseScript;
module.exports.ensurePulseExactCta = ensurePulseExactCta;

if (require.main === module) {
  process_stories().catch((err) => {
    console.log(`[processor] ERROR: ${err.message}`);
    process.exit(1);
  });
}
