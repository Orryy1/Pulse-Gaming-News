"use strict";

const { lintScript, countWords } = require("./services/script-lint");
const { runScriptCoherenceQa, EXACT_CTA } = require("./script-coherence-qa");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseForCompare(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9$,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentences(text) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function firstSentence(text) {
  return sentences(text)[0] || cleanText(text);
}

function numericClaims(text) {
  return [
    ...new Set(
      cleanText(text).match(/(?:\b\d{1,3}(?:,\d{3})+\b|\$\d+(?:\.\d+)?\b)/g) || [],
    ),
  ];
}

function badNumericSpellouts(text) {
  return [
    ...new Set(
      cleanText(text)
        .toUpperCase()
        .match(/\b\d+(?:\.\d+)?\s+DOLLARS\b/g) || [],
    ),
  ];
}

function ctaCount(text) {
  const normalised = normaliseForCompare(text);
  const cta = normaliseForCompare(EXACT_CTA);
  if (!normalised || !cta) return 0;
  let count = 0;
  let index = normalised.indexOf(cta);
  while (index !== -1) {
    count += 1;
    index = normalised.indexOf(cta, index + cta.length);
  }
  return count;
}

function repeatsHeadlineHook(story = {}, script = "") {
  const title = normaliseForCompare(story.title);
  const hook = normaliseForCompare(firstSentence(script));
  return Boolean(title && hook && (hook === title || hook.startsWith(title)));
}

function genericOpening(script = "") {
  return /^(?:so|today|hey|hi|welcome|in this)\b/i.test(cleanText(script));
}

function boringRecap(script = "") {
  return /\b(?:source-backed update|so the clean read is this|clean read|broader launch data|the useful detail is the review-score framing|final verdict needs broader launch data)\b/i.test(
    script,
  );
}

function instructionLikeBuyerAdvice(script = "") {
  return /\b(?:the player angle is simple|check the price,\s*access or platform details|before you decide what to play next|before you spend,\s*check the live price|buy,\s*download,\s*wait or skip)\b/i.test(
    script,
  );
}

function formulaicNotJustHook(script = "") {
  return /\b(?:is|was|are|were)\s+not\s+just\b/i.test(firstSentence(script));
}

function scoreHook({ story, script }) {
  let score = 100;
  const hook = firstSentence(script);
  const words = countWords(hook);
  if (repeatsHeadlineHook(story, script)) score -= 58;
  if (genericOpening(script)) score -= 35;
  if (formulaicNotJustHook(script)) score -= 45;
  if (words > 16) score -= 15;
  if (!/\b(?:needed|warning|catch|paid|headline|problem|mistake|win|panic|risk|wild|signal|verdict|argument|free access|real story)\b/i.test(hook)) {
    score -= 18;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreCuriosity(script = "") {
  let score = 35;
  const text = cleanText(script);
  if (/\b(?:catch|twist|kicker|but|however|except|paid-access|paid access)\b/i.test(text)) {
    score += 30;
  }
  if (/\b(?:not full demand|before the standard launch|why|what matters|what this changes|if the wider launch)\b/i.test(text)) {
    score += 22;
  }
  if (/\b(?:only the opening beat|one high score can hide|steady spread|uncomfortable bit|where .* wins might not be|hype (?:either )?turns into trust|paywall confusion|final verdict|launch story)\b/i.test(text)) {
    score += 28;
  }
  if (/\b(?:if steam is where|if microsoft leans|different launch story|distribution story|game pass messaging)\b/i.test(text)) {
    score += 12;
  }
  if (/\b(?:free access|free go fest|raid timing|who gets access|paywall flex|comeback test|fair shot|paywall confusion)\b/i.test(text)) {
    score += 24;
  }
  if (boringRecap(text)) score -= 40;
  if (instructionLikeBuyerAdvice(text)) score -= 35;
  if (genericOpening(text)) score -= 12;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreInsight({ story, script }) {
  let score = 30;
  const claims = numericClaims(script);
  if (claims.length >= 2) score += 25;
  if (claims.length >= 3) score += 10;
  if (/\b(?:means|because|if|so|that makes|that gives|useful|takeaway)\b/i.test(script)) {
    score += 16;
  }
  if (/\b(?:early access|Premium Edition|standard launch|paid-access|paid access)\b/i.test(script)) {
    score += 16;
  }
  if (/\b(?:real gameplay|gameplay|combat|world|hands-on|trailer footage|shown|showed|revealed)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:players can|players now|judge|feels?|worth playing|player impact|what players can actually)\b/i.test(script)) {
    score += 10;
  }
  if (/\b(?:review score|reviews?|outlets?|one high score|steady spread|fence-sitters|final verdict|launch conversation|chart noise)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:steam launch|xbox-on-steam|different launch story|game pass messaging|distribution story|store where .* wins)\b/i.test(script)) {
    score += 16;
  }
  if (/\b(?:go fest|free access|raid timing|niantic|paywall|free players|lapsed players|fair shot)\b/i.test(script)) {
    score += 18;
  }
  const sourceName = cleanText(story.source_name);
  if (sourceName && normaliseForCompare(script).includes(normaliseForCompare(sourceName))) {
    score += 8;
  }
  if (boringRecap(script)) score -= 25;
  if (instructionLikeBuyerAdvice(script)) score -= 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreSourceSafety({ story, script, coherence }) {
  let score = 86;
  const sourceName = cleanText(story.source_name);
  if (sourceName && !normaliseForCompare(script).includes(normaliseForCompare(sourceName))) score -= 18;
  if (/\baccording to sources\b|\bverified insider\b|\bredditor says\b/i.test(script)) {
    score -= 38;
  }
  if (asArray(coherence.failures).length) score -= 35;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreRetentionPacing(script = "") {
  const allSentences = sentences(script);
  let score = 75;
  const hookWords = countWords(allSentences[0] || "");
  const firstTwo = allSentences.slice(0, 2).join(" ");
  if (hookWords > 16) score -= 16;
  if (/\b\d{1,3}(?:,\d{3})+|\$\d+/.test(firstTwo)) score += 11;
  if (allSentences.length >= 5) score += 7;
  if (ctaCount(script) !== 1) score -= 16;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function weightedScore(scores) {
  return Math.round(
    scores.hook_strength * 0.24 +
      scores.curiosity_gap * 0.19 +
      scores.insight_density * 0.22 +
      scores.source_safety * 0.18 +
      scores.retention_pacing * 0.17,
  );
}

function buildBlockers({ story, script, lint, coherence }) {
  const blockers = [];
  if (repeatsHeadlineHook(story, script)) blockers.push("weak_hook_repeats_headline");
  if (genericOpening(script)) blockers.push("generic_opener");
  if (ctaCount(script) !== 1) blockers.push("duplicated_cta");
  if (boringRecap(script)) blockers.push("boring_recap_language");
  if (instructionLikeBuyerAdvice(script)) blockers.push("instruction_like_buyer_advice");
  if (formulaicNotJustHook(script)) blockers.push("formulaic_not_just_hook");
  if (badNumericSpellouts(script).length) blockers.push("bad_numeric_spellout");
  for (const failure of asArray(lint.failures)) {
    if (/boring_source_bound_recap/.test(failure) && !blockers.includes("boring_recap_language")) {
      blockers.push("boring_recap_language");
    }
    if (/generic_opener/.test(failure) && !blockers.includes("generic_opener")) {
      blockers.push("generic_opener");
    }
    if (/repeated_phrase/.test(failure) && !blockers.includes("repeated_phrase")) {
      blockers.push("repeated_phrase");
    }
    if (/generic_reveal_catch_template/.test(failure) && !blockers.includes("generic_reveal_catch_template")) {
      blockers.push("generic_reveal_catch_template");
    }
  }
  for (const failure of asArray(coherence.failures)) {
    if (/repeated_sentence/.test(failure) && !blockers.includes("repeated_sentence")) {
      blockers.push("repeated_sentence");
    }
    if (/repeated_numeric_claim/.test(failure) && !blockers.includes("repeated_numeric_claim")) {
      blockers.push("repeated_numeric_claim");
    }
  }
  return blockers;
}

function storyLooksLikeForzaSteam(story = {}, script = "") {
  return /\bforza horizon 6\b/i.test(`${story.title || ""} ${script}`) &&
    /\b(?:steam|steamdb|concurrent)\b/i.test(`${story.title || ""} ${script}`);
}

function buildRecommendations({ story, script, blockers }) {
  const recommendations = [];
  const directives = [];
  const forzaSteam = storyLooksLikeForzaSteam(story, script);

  if (blockers.includes("weak_hook_repeats_headline") || blockers.includes("generic_opener")) {
    recommendations.push(
      "Open on the paid-access contradiction, not the headline repeat.",
    );
    directives.push(
      "Open on a sharp contradiction: critics loved it, but the Steam spike came from people paying early.",
    );
  }

  if (forzaSteam) {
    recommendations.push(
      "Make the Steam number useful: frame it as paid early demand, not proof of total launch demand.",
    );
    directives.push(
      "Keep 178,009 as digits and make it the first concrete number the viewer sees.",
    );
    directives.push(
      "If the source supports it, keep $120 as '$120', not '120 dollars'.",
    );
  }

  if (blockers.includes("boring_recap_language")) {
    recommendations.push(
      "Replace recap phrasing with a take: why the number matters and what could make it misleading.",
    );
    directives.push(
      "Remove recap lines like 'source-backed update', 'clean read' and 'broader launch data'.",
    );
  }

  if (blockers.includes("instruction_like_buyer_advice")) {
    recommendations.push(
      "Replace buyer checklist narration with the story consequence, the proof beat and why players should care now.",
    );
    directives.push(
      "Do not say 'the player angle is simple' or tell viewers to check price/access/platform details as the main payoff.",
    );
  }

  if (blockers.includes("formulaic_not_just_hook")) {
    recommendations.push(
      "Open with the specific consequence, leak, date, price, score or playable change instead of a 'not just' setup.",
    );
    directives.push(
      "Replace the first line with a named-subject consequence hook that can stand alone in the first second.",
    );
  }

  if (blockers.includes("duplicated_cta") || ctaCount(script) !== 1) {
    recommendations.push("Use the Pulse CTA once, only at the end.");
    directives.push("CTA once: 'Follow Pulse Gaming so you never miss a beat.'");
  }

  if (!recommendations.length) {
    recommendations.push(
      "Keep the current angle: source first, number early, caveat before the payoff.",
    );
  }

  return {
    rewrite_recommendations: [...new Set(recommendations)],
    prompt_directives: [...new Set(directives)],
  };
}

function buildViralScriptIntelligence({ story = {}, script = "" } = {}) {
  const cleanScript = cleanText(script);
  const lint = lintScript(cleanScript, { minWords: 35, maxWords: 240 });
  const coherence = runScriptCoherenceQa(
    {
      ...story,
      hook: firstSentence(cleanScript),
      full_script: cleanScript,
      cta: EXACT_CTA,
    },
    { requireCtaField: true, requireFullScriptCta: false },
  );
  const scores = {
    hook_strength: scoreHook({ story, script: cleanScript }),
    curiosity_gap: scoreCuriosity(cleanScript),
    insight_density: scoreInsight({ story, script: cleanScript }),
    source_safety: scoreSourceSafety({ story, script: cleanScript, coherence }),
    retention_pacing: scoreRetentionPacing(cleanScript),
  };
  const blockers = buildBlockers({ story, script: cleanScript, lint, coherence });
  const viralScore = weightedScore(scores);
  const recommendationPack = buildRecommendations({
    story,
    script: cleanScript,
    blockers,
  });

  return {
    schema_version: 1,
    execution_mode: "viral_script_intelligence_v1",
    story_id: story.id || null,
    verdict:
      blockers.length || viralScore < 75
        ? "rewrite_required"
        : viralScore >= 85
          ? "viral_ready"
          : "tighten_before_tts",
    viral_score: viralScore,
    scores,
    blockers,
    warnings: [...asArray(lint.warnings), ...asArray(coherence.warnings)],
    fact_lock: {
      numeric_claims: numericClaims(cleanScript),
      bad_numeric_spellouts: badNumericSpellouts(cleanScript),
      source_name: story.source_name || null,
    },
    cta: {
      exact: EXACT_CTA,
      count: ctaCount(cleanScript),
    },
    ...recommendationPack,
    safety: {
      local_only: true,
      analysis_only: true,
      no_publishing_side_effects: true,
      oauth_triggered: false,
      production_db_mutated: false,
    },
  };
}

module.exports = {
  buildViralScriptIntelligence,
};
