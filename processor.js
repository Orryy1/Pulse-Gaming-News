"use strict";

const dotenv = require("dotenv");
const {
  assertValidRuntimeConfig,
  loadDotenvOnce,
} = require("./lib/stabilisation/runtime-config");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  loadDotenvOnce({ dotenv, env: process.env });
}
assertValidRuntimeConfig(process.env);

const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios");
const fs = require("fs-extra");
const { addBreadcrumb, captureException } = require("./lib/sentry");
const db = require("./lib/db");
const { countSpokenWords } = require("./lib/services/short-runtime-planner");
const {
  buildPulseGenerationPrompt,
  resolvePulseScriptContract,
  selectCtaDecision,
  validatePulseCta,
  validatePulseHook,
  validatePulseScriptRuntime,
} = require("./lib/services/pulse-editorial-contract");

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
            parts.push(`TOP REDDIT COMMENTS:\n${topComments}`);
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

function validate(script, channelId, options = {}) {
  const errors = [];
  const actualWords = countSpokenWords(cleanForTTS(script.full_script || ""));
  if (channelId === "pulse-gaming") {
    const contract =
      options.contract ||
      resolvePulseScriptContract({
        story: script,
      });
    const runtime = validatePulseScriptRuntime({
      text: cleanForTTS(script.full_script || ""),
      wordCount: actualWords,
      contract,
    });
    if (runtime.result === "fail") {
      errors.push(
        `${runtime.failures[0]}; actual spoken words ${actualWords} outside ${runtime.min_words}-${runtime.max_words} selected ${runtime.duration_band_id} range`,
      );
    }
    errors.push(
      ...validatePulseHook({
        script,
        contract,
      }).failures,
    );
    const ctaDecision =
      options.ctaDecision ||
      script.cta_policy ||
      selectCtaDecision({
        storyId: script.id,
        formatFamily: contract.format_family,
      });
    errors.push(
      ...validatePulseCta({
        script,
        decision: ctaDecision,
      }).failures,
    );
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
  return [...new Set(errors)];
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

  return script;
}

// --- Quality gate: score script 1-10 via second LLM call ---
async function scoreScript(
  client,
  script,
  story,
  channel,
  { contract = null, ctaDecision = null } = {},
) {
  try {
    const formatLabel =
      contract?.format_family === "recap"
        ? "governed YouTube recap"
        : "YouTube Short";
    const ctaCriterion =
      channel.id === "pulse-gaming"
        ? `- Selective CTA compliance (10%): the governed decision for this story is ${
            ctaDecision?.include_cta
              ? "INCLUDE one concise, story-specific contextual CTA"
              : "OMIT every CTA"
          }. Score compliance with that decision, never CTA presence by itself.`
        : "- CTA presence (10%)";
    const structureCriterion =
      contract?.duration_variant === "short"
        ? "- Structural fit (10%): Does the script deliver the lane promise without padding or forcing a mid-roll pivot into a short single-fact update?"
        : "- Midpoint retention (10%): For a standard-runtime or recap story, does a fresh, fact-specific pivot reset attention without using a stock phrase?";
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: `You score ${formatLabel} scripts for a ${channel.niche} news channel called ${channel.name} (1-10). Criteria (in priority order):
- HOOK STRENGTH (40% of score): Does it use a CURIOSITY GAP? Does it open a knowledge gap that compels the viewer to keep watching? A hook that reveals the answer or is vague scores 1-3. A hook that creates genuine "wait, WHAT?" tension scores 8-10.
${structureCriterion}
- Information density (15%): facts per sentence, no filler
- Source credibility (15%): does it cite sources?
- Pacing (10%): punchy, no dead air, urgent tone
${ctaCriterion}
A script with a weak hook can NEVER score above 5, regardless of how good the body is.
Reply with ONLY a JSON object: { "score": N, "reason": "one sentence" }`,
      messages: [
        {
          role: "user",
          content: `Score this script:\n${script.full_script}\n\nClassification: ${script.classification}\nStory: ${story.title}`,
        },
      ],
    });

    let text = response.content[0].text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    const result = JSON.parse(text);
    return { score: result.score || 5, reason: result.reason || "" };
  } catch (err) {
    console.log(`[processor] Quality gate error: ${err.message}`);
    return { score: 7, reason: "scoring failed - accepting by default" };
  }
}

/**
 * Sonnet "Smart Editor" pass: uses a stronger model to polish the script
 * for compliance, authority and natural language flow.
 * Only runs on scripts that passed the quality gate (score >= 7).
 */
function editorWordCountInstruction(channel, options = {}) {
  if (channel?.id === "pulse-gaming") {
    const contract =
      options.contract || resolvePulseScriptContract({ story: {} });
    const ctaInstruction = options.ctaDecision?.include_cta
      ? "Keep exactly one concise, story-specific contextual CTA and preserve it as the final sentence"
      : "Omit a CTA entirely from both cta and full_script";
    return (
      `7) Keep the exact same classification, editorial lane, hook_type and duration band. Keep full_script within ` +
      `${contract.min_words}-${contract.max_words} cleaned spoken words for ` +
      `${contract.duration_band_id}. Do not expand it. 8) ${ctaInstruction}.`
    );
  }
  return "7) Keep the exact same classification tag and word count range (155-185).";
}

function maxGenerationTokens(channel, contract) {
  if (channel?.id !== "pulse-gaming" || !contract) return 1200;
  if (contract.format_family !== "recap") return 1200;
  return Math.min(4096, Math.max(1800, Math.ceil(contract.max_words * 2.25)));
}

function applyPulseEditorialMetadata(script, contract, ctaDecision) {
  if (!script || !contract || !ctaDecision) return script;
  return Object.assign(script, {
    brand_name: contract.brand.name,
    brand_tagline: contract.brand.tagline,
    editorial_contract_version: contract.contract_version,
    editorial_lane_id: contract.editorial_lane_id,
    editorial_lane_label: contract.editorial_lane_label,
    format_family: contract.format_family,
    hook_type: contract.hook_type,
    hook_type_label: contract.hook_type_label,
    hook_instruction: contract.hook_instruction,
    hook_selection: contract.hook_selection,
    experiment_id: contract.experiment_id,
    experiment_matrix_version: contract.experiment_matrix_version,
    experiment_cell_id: contract.experiment_cell_id,
    duration_band_id: contract.duration_band_id,
    duration_band_label: contract.duration_band_label,
    target_duration_seconds: {
      min: contract.min_seconds,
      max: contract.max_seconds,
    },
    script_word_range: {
      min: contract.min_words,
      max: contract.max_words,
      seconds_per_word: contract.seconds_per_word,
    },
    duration_selection: contract.duration_selection,
    cta_policy: ctaDecision,
  });
}

async function sonnetEditorPass(
  client,
  script,
  channel,
  { contract = null, ctaDecision = null } = {},
) {
  try {
    const isFinance = channel.id === "stacked";
    const complianceRules = isFinance
      ? '1) Remove any language that sounds like financial advice or a guarantee of returns. 2) Ensure the tone is cynical and professional. 3) Verify "This is not financial advice" appears in the script.'
      : "1) Ensure the tone matches the channel persona. 2) Remove any filler words or generic phrasing.";

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: maxGenerationTokens(channel, contract),
      system: `You are an editor-in-chief reviewing a ${
        contract?.format_family === "recap"
          ? "governed YouTube recap"
          : "YouTube Short"
      } script for ${channel.name} (${channel.niche}). Your job is to tighten the writing WITHOUT changing the facts or structure.

Rules:
${complianceRules}
3) Verify no serial commas are present. British English only.
4) If the hook is weak, rewrite it using the Curiosity Gap technique.
5) Ensure sentence lengths vary (mix short 3-8 word punches with 15-25 word details).
6) Remove em dashes. Replace with commas or full stops.
${editorWordCountInstruction(channel, { contract, ctaDecision })}

Reply with ONLY the edited JSON object in the same format as the input. No explanation.`,
      messages: [
        {
          role: "user",
          content: JSON.stringify(script),
        },
      ],
    });

    let text = response.content[0].text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const edited = JSON.parse(text);

    // Preserve original classification if editor changed it
    if (
      script.classification &&
      edited.classification !== script.classification
    ) {
      edited.classification = script.classification;
    }

    edited.word_count = countSpokenWords(cleanForTTS(edited.full_script || ""));
    const errors = validate(edited, channel.id, {
      contract,
      ctaDecision,
    });
    if (errors.length > 0) {
      throw new Error(`editor_validation_failed:${errors.join("; ")}`);
    }
    applyPulseEditorialMetadata(edited, contract, ctaDecision);

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

async function process_stories() {
  console.log("[processor] Loading pending_news.json...");

  if (!(await fs.pathExists("pending_news.json"))) {
    console.log(
      "[processor] ERROR: pending_news.json not found. Run hunter first.",
    );
    return [];
  }

  const data = await fs.readJson("pending_news.json");
  let stories = data.stories || [];
  console.log(`[processor] Processing ${stories.length} stories...`);

  // Cross-cycle dedup: check pending stories against existing daily_news.json
  const existingStories = await db.getStories();
  if (existingStories.length > 0) {
    const before = stories.length;
    stories = stories.filter((pending) => {
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

  // Use channel's system prompt, fall back to file for backwards compatibility
  const baseSystemPrompt =
    channel.systemPrompt || (await fs.readFile("system_prompt.txt", "utf-8"));
  const today = getTodayString();

  const client = new Anthropic.default({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const enriched = [];

  for (const story of stories) {
    addBreadcrumb(`Processing story: ${story.title}`, "processor");
    console.log(`[processor] Scripting: ${story.title}`);

    const scriptContract =
      channel.id === "pulse-gaming"
        ? resolvePulseScriptContract({ story })
        : null;
    const ctaDecision = scriptContract
      ? selectCtaDecision({
          storyId: story.id,
          formatFamily: scriptContract.format_family,
        })
      : null;
    const editorialPrompt = scriptContract
      ? buildPulseGenerationPrompt({
          contract: scriptContract,
          ctaDecision,
        })
      : "";

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
      `\n\nCRITICAL: DATE AND FACT-CHECKING RULES:
Today's date is ${today}. You MUST follow these rules:
1. NEVER reference dates in the past as if they are in the future.
2. Cross-reference the Reddit title against the SOURCE ARTICLE TEXT provided below. If the article contradicts the Reddit title, trust the article.
3. If a claim cannot be verified from the provided sources, use hedging language.
4. NEVER invent specific dates, prices or statistics that are not in the source material.
5. If the story references an old event or outdated information, update it to reflect the current situation as of ${today}.
6. For game release dates: check if the date has already passed. If so, note the game has either released or been delayed.` +
      (editorialPrompt ? `\n\n${editorialPrompt}` : "");

    const userMessage = [
      `Story title: ${story.title}`,
      `Flair: ${story.flair}`,
      `Subreddit: r/${story.subreddit}`,
      `Score: ${story.score}`,
      `Top comment: ${story.top_comment}`,
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

    while (attempts < 3) {
      attempts++;
      try {
        let extra = "";
        if (attempts === 2) {
          extra = scriptContract
            ? `\n\nIMPORTANT: Your previous script failed validation. Return hook_type exactly "${scriptContract.hook_type}" and follow this hook instruction: ${scriptContract.hook_instruction}. Keep full_script within ${scriptContract.min_words}-${scriptContract.max_words} cleaned spoken words for ${scriptContract.duration_band_id} (${scriptContract.min_seconds}-${scriptContract.max_seconds} seconds). ${
                ctaDecision.include_cta
                  ? "Use one concise CTA tied directly to this story, and no generic follow, subscribe, like or comments request."
                  : "Omit every CTA from cta and full_script."
              } Include a classification tag. Do not start the hook with So, Today, Hey, Welcome or In this.`
            : "\n\nIMPORTANT: Your previous script failed validation. Keep full_script within 155-185 words. Include a classification tag. Do not start the hook with So, Today, Hey, Welcome or In this.";
        } else if (attempts === 3) {
          extra = scriptContract
            ? `\n\nFINAL ATTEMPT: Return hook_type "${scriptContract.hook_type}" and obey "${scriptContract.hook_instruction}". Produce approximately ${Math.round(
                (scriptContract.min_words + scriptContract.max_words) / 2,
              )} cleaned spoken words, remain inside the selected ${scriptContract.min_words}-${scriptContract.max_words} range, use a strong hook and classification tag and ${
                ctaDecision.include_cta
                  ? "finish with one concise, story-specific contextual CTA"
                  : "include no CTA"
              }.`
            : "\n\nFINAL ATTEMPT: Produce approximately 170 words with a strong hook, classification tag and CTA.";
        }

        const response = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: maxGenerationTokens(channel, scriptContract),
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage + extra }],
        });

        let text = response.content[0].text.trim();
        if (text.startsWith("```")) {
          text = text
            .replace(/^```(?:json)?\s*\n?/, "")
            .replace(/\n?```\s*$/, "");
        }
        script = JSON.parse(text);

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
        script.word_count = countSpokenWords(
          cleanForTTS(script.full_script || ""),
        );

        const errors = validate(script, channel.id, {
          contract: scriptContract,
          ctaDecision,
        });
        if (errors.length > 0) {
          console.log(
            `[processor] Validation failed (attempt ${attempts}): ${errors.join(", ")}`,
          );
          if (attempts >= 3) {
            throw new Error(
              `script_contract_validation_exhausted:${errors.join("; ")}`,
            );
          } else {
            script = null;
            continue;
          }
        } else {
          console.log(
            `[processor] Script validated (${script.word_count} words)`,
          );
        }
        applyPulseEditorialMetadata(script, scriptContract, ctaDecision);

        // Quality gate - score the script
        if (script && attempts < 3) {
          const gate = await scoreScript(client, script, story, channel, {
            contract: scriptContract,
            ctaDecision,
          });
          qualityScore = gate.score;
          console.log(
            `[processor] Quality gate: ${gate.score}/10 - ${gate.reason}`,
          );
          if (gate.score < 7) {
            console.log(
              `[processor] Script below quality threshold (${gate.score}/10), regenerating...`,
            );
            script = null;
            continue;
          }
        }

        // Sonnet editor pass - polish high-scoring scripts with a stronger model
        if (script && qualityScore >= 7) {
          script = await sonnetEditorPass(client, script, channel, {
            contract: scriptContract,
            ctaDecision,
          });
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
          applyPulseEditorialMetadata(script, scriptContract, ctaDecision);
          script.word_count = countSpokenWords(
            cleanForTTS(script.full_script || ""),
          );
        }
        break;
      } catch (err) {
        console.log(`[processor] ERROR on attempt ${attempts}: ${err.message}`);
        captureException(err, {
          step: "scriptGeneration",
          storyId: story.id,
          attempt: attempts,
        });
        if (attempts >= 3) {
          script = {
            classification: "[BREAKING]",
            hook: story.title,
            body: "Script generation failed. Manual edit required.",
            cta: "",
            full_script: story.title,
            word_count: 0,
            suggested_thumbnail_text: story.title.substring(0, 40),
            suggested_title: story.title.substring(0, 60),
            contract_status: "human_review_required",
            contract_failures: ["script_generation_exhausted"],
          };
          applyPulseEditorialMetadata(script, scriptContract, ctaDecision);
        }
      }
    }

    // Clean script for TTS (remove [PAUSE] and [VISUAL] markers)
    const ttsScript = cleanForTTS(script.full_script);

    const enrichedStory = {
      ...story,
      ...script,
      tts_script: ttsScript,
      quality_score: qualityScore,
      content_pillar: getContentPillar(script.classification),
      approved:
        script.contract_status === "human_review_required"
          ? false
          : story.approved || false,
      auto_approved:
        script.contract_status === "human_review_required"
          ? false
          : story.auto_approved || false,
    };

    // Generate A/B title variants (non-blocking - if it fails, continue with single title)
    try {
      const { generateTitleVariants } = require("./ab_titles");
      await generateTitleVariants(enrichedStory);
    } catch (err) {
      console.log(
        `[processor] A/B title variant generation skipped: ${err.message}`,
      );
    }

    enriched.push(enrichedStory);
  }

  // Upsert each story individually to avoid wiping previously published stories.
  // saveStories() deletes anything not in the array, which destroys youtube_post_id
  // and other platform IDs from earlier cycles, causing duplicate uploads.
  for (const story of enriched) {
    await db.upsertStory(story);
  }
  console.log(`[processor] Saved ${enriched.length} enriched stories (upsert)`);

  // Post new stories to Discord news channels
  try {
    const { postNewStory } = require("./discord/auto_post");
    for (const story of enriched) {
      await postNewStory(story);
    }
    console.log(
      `[processor] Discord: posted ${enriched.length} stories to news channels`,
    );
  } catch (err) {
    console.log(`[processor] Discord news posting skipped: ${err.message}`);
  }

  return enriched;
}

module.exports = process_stories;
module.exports.applyPulseEditorialMetadata = applyPulseEditorialMetadata;
module.exports.validate = validate;
module.exports.editorWordCountInstruction = editorWordCountInstruction;
module.exports.cleanForTTS = cleanForTTS;

if (require.main === module) {
  process_stories().catch((err) => {
    console.log(`[processor] ERROR: ${err.message}`);
    process.exit(1);
  });
}
