"use strict";

const EXACT_CTA = "Follow Pulse Gaming so you never miss a beat";

const VAGUE_FILLER_PATTERNS = [
  {
    id: "community_is_buzzing",
    re: /\bthe community is buzzing\b/i,
  },
  {
    id: "nobody_is_talking_about_this",
    re: /\bnobody(?:'s| is) talking about this\b/i,
  },
  {
    id: "raises_more_questions_than_answers",
    re: /\braises more questions than answers\b/i,
  },
  {
    id: "changes_everything",
    re: /\b(?:changes?|changed|changing) everything\b/i,
  },
  {
    id: "nobody_expected_or_noticed",
    re: /\b(?:nobody expected this|nobody saw (?:(?:it|this) )?coming|nobody noticed this|nobody is talking about this)\b/i,
  },
  {
    id: "formulaic_pivot",
    re: /\b(?:but here(?: is|'?s) where it gets interesting|here(?: is|'?s) where it gets interesting|this is the part nobody is reporting|this is bigger than you think|but hold on|but wait)\b/i,
  },
  {
    id: "implications_are_unsettling",
    re: /\bimplications are\s+(?:unsettling|huge|massive)\b/i,
  },
  {
    id: "pulse_signal_language",
    re: /\b(?:signals? for pulse|pulse signals?|signal for pulse|signal first,\s*certainty later|signal over certainty|the signal is|signal is not|that'?s the signal|this is the signal|our read is signal|the read is signal)\b/i,
  },
  {
    id: "internal_tracking_language",
    re: /\b(?:safe(?:st)? read is|safe(?:st)? takeaway is|our safe(?:st)? interpretation is|we(?:'re| are) (?:tracking|watching for|waiting for) (?:confirmation|the official follow[- ]up|whether)|(?:tracking|watching for|waiting for) (?:confirmation|the official follow[- ]up))\b/i,
  },
];

const GENERIC_UNCERTAINTY_BOILERPLATE_RE =
  /\b(?:the important point is the direction of travel|not just the headline itself|the next thing to watch is whether an official post, platform listing or patch note backs it up|safest read is signal first|tracking the official follow-up before calling it a guaranteed change)\b/i;

const INTERNAL_PULSE_FRAMING_RE =
  /\bfor (?:pulse|pulse gaming|us|the channel),?\s+that means\b/i;

const MANGLED_STOP_KILLING_GAMES_RE =
  /\bstop\s+ending\s+games\b/i;

const FALSE_BILL_OWNERSHIP_RE =
  /\b(?:ubisoft|ea|microsoft|sony|nintendo|take[- ]two|rockstar|valve|capcom|sega|square\s+enix|bandai\s+namco)(?:'s|’s)\s+(?:ab\s*1921|california\s+bill)\b/i;

const SOURCE_BACKED_NEWS_VERB_RE =
  /\b(?:announces?|announced|announcing|confirms?|confirmed|reveals?|revealed|launches?|launched|release date|trailer|update|patch|delayed|cancelled|acquired|lawsuit|statement|responds?|response|review bombed|sales|earnings|revenue|expected to rise|director says|developer says|publisher says|ceo says|ceo responds)\b/i;

const GENERAL_REDDIT_SOURCES = new Set([
  "gaming",
  "games",
  "pcmasterrace",
  "pcgaming",
  "ps5",
  "xboxseriesx",
  "nintendoswitch",
]);

function normaliseText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseForCompare(value) {
  return normaliseText(value)
    .replace(/\bhaven't\b/g, "have not")
    .replace(/\bhasn't\b/g, "has not")
    .replace(/\bisn't\b/g, "is not")
    .replace(/\baren't\b/g, "are not")
    .replace(/\bwasn't\b/g, "was not")
    .replace(/\bweren't\b/g, "were not")
    .replace(/\bcan't\b/g, "cannot")
    .replace(/\bwon't\b/g, "will not")
    .replace(/\b0\b/g, "zero")
    .replace(/\b1\b/g, "one")
    .replace(/\b2\b/g, "two")
    .replace(/\b3\b/g, "three")
    .replace(/\b4\b/g, "four")
    .replace(/\b5\b/g, "five")
    .replace(/\b6\b/g, "six")
    .replace(/\b7\b/g, "seven")
    .replace(/\b8\b/g, "eight")
    .replace(/\b9\b/g, "nine")
    .replace(/\b10\b/g, "ten")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scriptText(story = {}) {
  return [
    story.hook,
    story.body,
    story.loop,
    story.cta,
    story.full_script,
    story.tts_script,
  ]
    .filter(Boolean)
    .join("\n");
}

function narrativeScriptText(story = {}) {
  const fullScript = normaliseText(story.full_script);
  if (fullScript) return fullScript;

  const ttsScript = normaliseText(story.tts_script);
  if (ttsScript) return ttsScript;

  return [story.hook, story.body, story.loop, story.cta]
    .filter(Boolean)
    .join("\n");
}

function isGeneralRedditSource(story = {}) {
  const sourceType = String(story.source_type || "reddit").toLowerCase();
  if (sourceType !== "reddit") return false;
  const subreddit = String(story.subreddit || story.source_name || "")
    .toLowerCase()
    .replace(/^r\//, "")
    .trim();
  return GENERAL_REDDIT_SOURCES.has(subreddit);
}

function hasSourceBackedNewsSignal(story = {}) {
  return SOURCE_BACKED_NEWS_VERB_RE.test(
    [story.title, story.hook, story.body, story.full_script].filter(Boolean).join("\n"),
  );
}

function isHedgedStory(story = {}) {
  return /\b(?:sure seems|reportedly|allegedly|may|might|could|rumou?r|slipped up|appears to|seems like)\b/i.test(
    [story.title, story.flair, story.classification].filter(Boolean).join("\n"),
  );
}

function topCommentUsedAsFact(story = {}, normalisedScript = "") {
  if (String(story.source_type || "reddit").toLowerCase() !== "reddit") return false;
  const comment = normaliseForCompare(story.top_comment);
  if (!comment) return false;
  const script = normaliseForCompare(normalisedScript);
  const words = comment
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .filter((word) => !["this", "that", "with", "from", "they", "their"].includes(word));

  if (words.length < 4) return false;

  for (let i = 0; i <= words.length - 4; i++) {
    const phrase = words.slice(i, i + 4).join(" ");
    if (script.includes(phrase)) return true;
  }

  return false;
}

function repeatedSentences(text) {
  const counts = new Map();
  const repeats = [];
  const sentences = normaliseText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normaliseForCompare(sentence))
    .filter((sentence) => sentence.split(/\s+/).length >= 6)
    .filter((sentence) => sentence !== normaliseForCompare(EXACT_CTA));

  for (const sentence of sentences) {
    const next = (counts.get(sentence) || 0) + 1;
    counts.set(sentence, next);
    if (next === 2) repeats.push(sentence);
  }

  return repeats;
}

function runScriptCoherenceQa(story = {}, options = {}) {
  const failures = [];
  const warnings = [];
  const text = scriptText(story);
  const normalisedScript = normaliseText(narrativeScriptText(story));
  const allScriptText = normaliseText(text);
  const requireCtaField = options.requireCtaField !== false;
  const requireFullScriptCta = options.requireFullScriptCta === true;

  const cta = normaliseText(story.cta);
  if (requireCtaField && cta && normaliseForCompare(cta) !== normaliseForCompare(EXACT_CTA)) {
    failures.push("script_coherence:cta_not_exact");
  }

  if (
    requireFullScriptCta &&
    !normaliseForCompare(normalisedScript).includes(normaliseForCompare(EXACT_CTA))
  ) {
    failures.push("script_coherence:missing_exact_cta_in_script");
  }

  for (const item of VAGUE_FILLER_PATTERNS) {
    if (item.re.test(normalisedScript)) {
      if (item.id === "pulse_signal_language") {
        failures.push("script_coherence:abstract_signal_language");
      } else {
        failures.push(`script_coherence:vague_filler:${item.id}`);
      }
    }
  }

  if (GENERIC_UNCERTAINTY_BOILERPLATE_RE.test(normalisedScript)) {
    failures.push("script_coherence:generic_uncertainty_boilerplate");
  }

  if (INTERNAL_PULSE_FRAMING_RE.test(normalisedScript)) {
    failures.push("script_coherence:internal_pulse_framing");
  }

  if (MANGLED_STOP_KILLING_GAMES_RE.test(normalisedScript)) {
    failures.push("script_coherence:mangled_stop_killing_games_campaign");
  }

  if (
    /\b(?:ab\s*1921|california\s+bill|stop\s+killing\s+games)\b/i.test(
      `${story.title || ""}\n${normalisedScript}`,
    ) &&
    FALSE_BILL_OWNERSHIP_RE.test(normalisedScript)
  ) {
    failures.push("script_coherence:false_bill_ownership");
  }

  const repeats = repeatedSentences(normalisedScript);
  if (repeats.length > 0) {
    failures.push(`script_coherence:repeated_sentence:${repeats[0].slice(0, 80)}`);
  }

  const titleAndScript = `${story.title || ""}\n${normalisedScript}`;
  if (/subnautica\s*2/i.test(titleAndScript) && /\belectronic arts\b/i.test(normalisedScript)) {
    failures.push("script_coherence:misexpanded_ea_as_electronic_arts");
  }

  if (/\bverified insider\b/i.test(normalisedScript)) {
    failures.push("script_coherence:unsupported_verified_insider_framing");
  }

  if (/\baccording to (?:a )?verified reddit post\b/i.test(normalisedScript)) {
    failures.push("script_coherence:verified_reddit_post_as_source");
  }

  if (/\b(?:one|a)\s+redditor\s+(?:thinks|says|claims|believes|reckons)\b/i.test(normalisedScript)) {
    failures.push("script_coherence:redditor_as_source_fact");
  }

  if (
    isHedgedStory(story) &&
    /\b(?:just\s+paid\s+out|has\s+paid\s+out|paid\s+out|officially\s+confirmed|is\s+confirmed|now\s+confirmed)\b/i.test(
      normalisedScript,
    )
  ) {
    failures.push("script_coherence:hedged_story_overclaimed");
  }

  if (topCommentUsedAsFact(story, normalisedScript)) {
    failures.push("script_coherence:top_comment_used_as_fact");
  }

  if (
    /\blara(?:'s)?\b/i.test(normalisedScript) &&
    !/\b(?:lara|tomb\s+raider)\b/i.test(String(story.title || ""))
  ) {
    failures.push("script_coherence:orphan_entity_contamination:lara");
  }

  if (isGeneralRedditSource(story)) {
    if (/\bverified insider\b/i.test(normalisedScript)) {
      failures.push("script_coherence:general_reddit_verified_insider_claim");
    }
    if (/\baccording to sources\b/i.test(normalisedScript)) {
      failures.push("script_coherence:vague_sources_on_general_reddit");
    }
    if (
      /\baccording to (?:a )?(?:reddit post|reddit thread|reddit user|redditor)\b/i.test(
        normalisedScript,
      ) &&
      !hasSourceBackedNewsSignal(story)
    ) {
      failures.push("script_coherence:general_reddit_thread_as_news");
    }
  }

  return {
    result: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures,
    warnings,
  };
}

module.exports = {
  EXACT_CTA,
  runScriptCoherenceQa,
  repeatedSentences,
};
