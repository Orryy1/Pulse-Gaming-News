"use strict";

const {
  PRIMARY_PULSE_CTA,
  hasApprovedPulseCta,
  isApprovedPulseCta,
} = require("./pulse-cta");

const EXACT_CTA = PRIMARY_PULSE_CTA;

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
    id: "generic_hype_closer",
    re: /\b(?:the future of .{0,80}? looks brighter than ever|this impressive figure underscores the success|tremendous demand|broad appeal|proving to be a massive success|sets? a new benchmark|resonated with players worldwide|further cementing|strong numbers underscore|phenomenal (?:Metacritic score|player numbers|Steam numbers)|driving phenomenal Steam numbers)\b/i,
  },
  {
    id: "pre_cta_channel_promo",
    re: /\bdon[’']?t miss out on (?:the )?latest gaming news\b/i,
  },
  {
    id: "pulse_signal_language",
    re: /\b(?:signals? for pulse|pulse signals?|signal for pulse|signal first,\s*certainty later|signal over certainty|the signal is|signal is not|that'?s the signal|this is the signal|our read is signal|the read is signal)\b/i,
  },
  {
    id: "internal_tracking_language",
    re: /\b(?:safe(?:st)? read is|safe(?:st)? takeaway is|our safe(?:st)? interpretation is|we(?:'re| are) (?:tracking|watching for|waiting for) (?:confirmation|the official follow[- ]up|whether)|(?:tracking|watching for|waiting for) (?:confirmation|the official follow[- ]up))\b/i,
  },
  {
    id: "internal_audience_scaffold",
    re: /\b(?:the clean angle|watching this short|not a hard sell|price story|audience watching|viewer value|public version|source-backed update|not a blank check|not a blank cheque|named source confirms|the useful caveat|the safest public version|what this changes\b.{0,80}\bafter the headline fades)\b/i,
  },
  {
    id: "public_narration_meta_language",
    re: /\b(?:the hook here is|the hook is|the angle here is|the angle is|the signal here is|gives? (?:fans|players|viewers|people) (?:something )?(?:concrete|specific|real)?\s*(?:to|they can)\s+argue about|(?:concrete|specific|real) detail (?:fans|players|viewers|people) can argue about|(?:fans|players|viewers|people) can argue about instead of|for (?:fans|players|viewers|people) to argue about)\b/i,
  },
  {
    id: "producer_scaffold_language",
    re: /\b(?:here(?: is|'?s) what matters(?: now)?|the catch is what matters|the catch is simple|the debate is simple|the useful part is simple|the player-facing part is|the player impact is|for players,\s*the takeaway is simple|for players,\s*the point is simple|the payoff is knowing)\b/i,
  },
  {
    id: "abstract_industry_bridge",
    re: /\b(?:that number lands because|talent squeeze sits behind|sits behind sequels,\s*remakes and new studios|games job market has gone brutally quiet)\b/i,
  },
  {
    id: "review_score_abstraction",
    re: /\b(?:verdict territory|opening beat|one high score can hide split opinions|steady spread says the reception|strong signal,\s*not a final verdict|becoming chart noise|changes the launch conversation)\b/i,
  },
  {
    id: "generic_source_bound_padding",
    re: /\b(?:new detail players should clock|player-facing detail still worth separating from the noise|another update exists|reason to exist beyond repeating the feed|stays a tight update instead of a hype cycle|next thing to watch is whether the official follow-up|small update either becomes useful or fades into the feed|stronger short keeps the subject named|consequence visible from the first line)\b/i,
  },
  {
    id: "generated_player_consequence_placeholder",
    re: /\b(?:became a value test|not just a catalogue listing|familiar game another place to sit|gap to watch|hype is easy|player consequence has to show up on screen)\b/i,
  },
];

const GENERIC_UNCERTAINTY_BOILERPLATE_RE =
  /\b(?:the important point is the direction of travel|not just the headline itself|the next thing to watch is whether an official post, platform listing or patch note backs it up|safest read is signal first|tracking the official follow-up before calling it a guaranteed change)\b/i;

const HYBRID_SPOKEN_YEAR_RE = /\btwenty\s+\d{2}\b/i;

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

const HUMAN_ROLE_RE =
  /\b(?:composer|director|developer|producer|creator|writer|artist|actor|designer|lead|veteran|founder|ceo|boss|composer says|developer says|director says)\b/i;

const NON_PERSON_NAME_RE =
  /\b(?:PC Gamer|Game Pass|PlayStation|PlayStation Store|Xbox|Xbox Wire|Nintendo|Nintendo Direct|Steam|Steam Deck|Deus Ex|Unreal|Final Fantasy|Gears Of War|The Expanse|Pulse Gaming|Game Boy|Gaming News|Video Game|Game Studio|Games Industry)\b/i;

const HIGH_RISK_STORY_SUBJECTS = [
  { id: "forza_horizon_6", re: /\bforza(?:\s+horizon\s+6)?\b/i },
  { id: "gta_5", re: /\b(?:gta\s*5|grand\s+theft\s+auto\s+v)\b/i },
  { id: "gta_6", re: /\b(?:gta\s*6|gta\s*vi|grand\s+theft\s+auto\s+vi)\b/i },
  { id: "subnautica_2", re: /\bsubnautica\s*2\b/i },
  { id: "dragonwilds", re: /\b(?:runescape\s+)?dragonwilds\b/i },
  { id: "dragons_dogma_2", re: /\bdragon['’`]?s\s+dogma\s*2\b/i },
  { id: "elder_scrolls_6", re: /\belder\s+scrolls\s*(?:6|vi)\b/i },
  { id: "gears_of_war_e_day", re: /\bgears\s+of\s+war\s*:?\s*e[-\s]?day\b/i },
  { id: "halo_campaign_evolved", re: /\bhalo\s*:?\s*campaign\s+evolved\b/i },
  { id: "quake_champions", re: /\bquake\s+champions\b/i },
];

const SOURCE_URL_SUBJECTS = [
  { id: "dragons_dogma_2", re: /\bdragons?-dogma-2\b/i },
  { id: "dragonwilds", re: /\b(?:runescape-)?dragonwilds\b/i },
  { id: "elder_scrolls_6", re: /\belder-scrolls-6\b/i },
  { id: "gears_of_war_e_day", re: /\bgears-of-war-e-day\b/i },
  { id: "halo_campaign_evolved", re: /\bhalo(?:-1)?-remake|halo-campaign-evolved\b/i },
  { id: "fable", re: /\bfable-reboot|fable\b/i },
  { id: "gta_5", re: /\bgta-5|grand-theft-auto-v\b/i },
  { id: "gta_6", re: /\bgta-6|grand-theft-auto-vi\b/i },
  { id: "best_deals", re: /\bbest-deals|top-deals|preorder|pre-order\b/i },
];

const NUMBERED_SEQUEL_TITLE_RE =
  /\b([A-Z][A-Za-z0-9'â€™:-]*(?:\s+[A-Z][A-Za-z0-9'â€™:-]+){0,3})\s+(2|3|4|5|6|II|III|IV|V|VI)\b/g;

const SEQUEL_CONTEXT_RE =
  /\b(?:sequel|follow[- ]?up|next\s+(?:game|entry|instalment|installment)|successor)\b/i;

const NUMBERED_TITLE_FALSE_POSITIVE_RE =
  /\b(?:playstation|ps|xbox|xbox series|series x|series s|nintendo switch|switch|steam deck|game pass|directx|unreal engine)\b/i;

const NUMBERED_TITLE_ALIAS_PAIRS = [
  {
    claim: /\bgrand\s+theft\s+auto\s+6\b/i,
    context: /\b(?:gta\s*6|gta\s*vi|grand\s+theft\s+auto\s+(?:6|vi))\b/i,
  },
  {
    claim: /\bgrand\s+theft\s+auto\s+5\b/i,
    context: /\b(?:gta\s*5|gta\s*v|grand\s+theft\s+auto\s+(?:5|v))\b/i,
  },
];

function normaliseText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
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

function storyContextText(story = {}) {
  return normaliseText(
    [
      story.title,
      story.selected_title,
      story.canonical_title,
      story.original_title,
      story.source_title,
      story.article_title,
      story.suggested_title,
      story.source_name,
      story.subreddit,
      ...asArray(story.confirmed_claims),
      story.url,
      story.article_url,
      story.source_url,
      story.primary_source_url,
    ].filter(Boolean).join(" "),
  );
}

function subjectIdsIn(text = "", subjects = HIGH_RISK_STORY_SUBJECTS) {
  const value = normaliseText(text);
  return subjects
    .filter((subject) => subject.re.test(value))
    .map((subject) => subject.id);
}

function contextualTemplateLeakFailures(story = {}, script = "") {
  const failures = [];
  if (!normaliseText(script)) return failures;
  const context = storyContextText(story);
  const scriptSubjects = subjectIdsIn(script);
  const contextSubjects = subjectIdsIn(context);
  const urlText = normaliseText([story.url, story.article_url, story.source_url].filter(Boolean).join(" "));
  const urlSubjects = subjectIdsIn(urlText, SOURCE_URL_SUBJECTS);
  const hasSpecificSourceContext =
    contextSubjects.length > 0 || urlSubjects.some((id) => id !== "best_deals");
  const missingContextSubjects = scriptSubjects.filter((id) => !contextSubjects.includes(id));

  if (hasSpecificSourceContext) {
    for (const id of missingContextSubjects) {
      failures.push(`script_coherence:cross_story_template_leak:${id}`);
    }
  }

  for (const id of urlSubjects) {
    if (id === "best_deals") {
      if (/\b(?:became easier to try|joined a subscription service|subscription libraries move|worth the download)\b/i.test(script)) {
        failures.push("script_coherence:source_url_subject_conflict:best_deals");
      }
      continue;
    }
    if (scriptSubjects.length > 0 && !scriptSubjects.includes(id)) {
      failures.push(`script_coherence:source_url_subject_conflict:${id}`);
    }
  }

  if (
    /\b(?:paid crowd just sent a loud warning|posted (?:a )?major steam player spike|cheap wave lands)\b/i.test(script) &&
    !/\b(?:steam|steamdb|concurrent players|premium edition|early[-\s]?access|\$\d+|£\d+)\b/i.test(context)
  ) {
    failures.push("script_coherence:contextless_editorial_template:paid_crowd");
  }

  if (
    /\b(?:became easier to try|joined a subscription service|subscription libraries move|worth the download)\b/i.test(script) &&
    !/\b(?:subscription|game pass|playstation plus|ps plus|gta\+|netflix|prime gaming)\b/i.test(context)
  ) {
    failures.push("script_coherence:contextless_editorial_template:subscription_access");
  }

  if (
    /\b(?:score its publisher can market hard|current review conversation|review momentum|one high score)\b/i.test(script) &&
    !/\b(?:review|score|metacritic|opencritic|rated|rating)\b/i.test(context)
  ) {
    failures.push("script_coherence:contextless_editorial_template:review_score");
  }

  return [...new Set(failures)];
}

function looksLikePersonName(value) {
  const text = normaliseText(value);
  if (!text || NON_PERSON_NAME_RE.test(text)) return false;
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return false;
  return parts.every((part) => /^[A-Z][a-zA-Z'’-]{2,}$/.test(part));
}

function extractPersonNamesFromText(text = "") {
  const out = [];
  const re = /\b([A-Z][a-zA-Z'’-]{2,}\s+[A-Z][a-zA-Z'’-]{2,}(?:\s+[A-Z][a-zA-Z'’-]{2,})?)\b/g;
  let match;
  while ((match = re.exec(String(text || ""))) !== null) {
    const name = normaliseText(match[1]);
    if (looksLikePersonName(name)) out.push(name);
  }
  return out;
}

function namedPeopleFromStory(story = {}) {
  const explicit = [
    story.named_person,
    story.person_name,
    story.source_person,
    ...asArray(story.seo_tags),
    ...asArray(story.named_entities).map((entity) =>
      typeof entity === "string" ? entity : entity?.name || entity?.text,
    ),
  ].filter(looksLikePersonName);

  const sourceText = [
    story.source_body,
    story.original_body,
    story.body,
    story.source_excerpt,
    story.article_excerpt,
    story.description,
    story.summary,
  ].filter(Boolean).join(" ");

  return [...new Set([...explicit, ...extractPersonNamesFromText(sourceText)])];
}

function personNamePresentInScript(name, script = "") {
  const normalisedScript = normaliseForCompare(script);
  const normalisedName = normaliseForCompare(name);
  if (!normalisedName) return true;
  if (normalisedScript.includes(normalisedName)) return true;
  const surname = normalisedName.split(/\s+/).filter(Boolean).pop();
  return Boolean(surname && surname.length >= 4 && new RegExp(`\\b${surname}\\b`, "i").test(normalisedScript));
}

function missingNamedSourceSubjects(story = {}, script = "") {
  const context = [
    story.title,
    story.original_title,
    story.source_title,
    story.article_title,
    story.source_body,
    story.original_body,
    story.body,
  ].filter(Boolean).join(" ");
  if (!HUMAN_ROLE_RE.test(context)) return [];
  if (!HUMAN_ROLE_RE.test(script)) return [];
  return namedPeopleFromStory(story).filter((name) => !personNamePresentInScript(name, script));
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
    [
      story.title,
      story.original_title,
      story.source_title,
      story.article_title,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function isHedgedStory(story = {}) {
  return /\b(?:sure seems|reportedly|allegedly|may|might|could|rumou?r|slipped up|appears to|seems like)\b/i.test(
    [story.title, story.flair, story.classification].filter(Boolean).join("\n"),
  );
}

function unsupportedNumberedSequelClaims(story = {}, script = "") {
  const context = storyContextText(story);
  if (!SEQUEL_CONTEXT_RE.test(`${context}\n${script}`)) return [];

  const contextCompare = normaliseForCompare(context);
  const failures = [];
  const seen = new Set();

  for (const match of script.matchAll(NUMBERED_SEQUEL_TITLE_RE)) {
    const claim = normaliseText(`${match[1]} ${match[2]}`);
    const claimKey = claim.toLowerCase();
    if (!claim || seen.has(claimKey)) continue;
    seen.add(claimKey);

    if (NUMBERED_TITLE_FALSE_POSITIVE_RE.test(claim)) continue;
    if (contextCompare.includes(normaliseForCompare(claim))) continue;
    if (NUMBERED_TITLE_ALIAS_PAIRS.some((pair) => pair.claim.test(claim) && pair.context.test(context))) continue;

    failures.push(`script_coherence:unsupported_numbered_sequel_claim:${claim}`);
  }

  return failures;
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
    .filter((sentence) => !isApprovedPulseCta(sentence));

  for (const sentence of sentences) {
    const next = (counts.get(sentence) || 0) + 1;
    counts.set(sentence, next);
    if (next === 2) repeats.push(sentence);
  }

  return repeats;
}

const NEAR_REPEAT_STOP_WORDS = new Set([
  "the",
  "and",
  "but",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "onto",
  "over",
  "under",
  "after",
  "before",
  "because",
  "players",
  "fans",
  "viewers",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "million",
  "billion",
]);

function meaningfulRepeatedPhrase(words = []) {
  return words.filter((word) => word.length > 3 && !NEAR_REPEAT_STOP_WORDS.has(word)).length >= 2;
}

function repeatedNearPhrases(text) {
  const repeats = [];
  const sentences = normaliseText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normaliseForCompare(sentence))
    .filter((sentence) => sentence.split(/\s+/).length >= 6)
    .filter((sentence) => !isApprovedPulseCta(sentence));

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    for (let length = 5; length >= 2; length -= 1) {
      for (let index = 0; index <= words.length - length * 2; index += 1) {
        const phrase = words.slice(index, index + length);
        if (!meaningfulRepeatedPhrase(phrase)) continue;
        const maxNext = Math.min(words.length - length, index + length + 5);
        for (let next = index + length; next <= maxNext; next += 1) {
          const other = words.slice(next, next + length);
          if (phrase.join(" ") === other.join(" ")) {
            repeats.push(phrase.join(" "));
            break;
          }
        }
        if (repeats.length) return repeats;
      }
    }
  }

  return repeats;
}

function repeatedNumericClaims(text) {
  const counts = new Map();
  const matches = normaliseText(text).match(/\b(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s?(?:million|billion)|\$\d+(?:\.\d+)?(?:\s?(?:million|billion))?)\b/gi) || [];
  for (const match of matches) {
    const key = match.toLowerCase().replace(/\s+/g, " ");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([claim, count]) => ({ claim, count }));
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
  if (requireCtaField && cta && !isApprovedPulseCta(cta)) {
    failures.push("script_coherence:cta_not_exact");
  }

  if (
    requireFullScriptCta &&
    !hasApprovedPulseCta(normalisedScript)
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

  failures.push(...contextualTemplateLeakFailures(story, normalisedScript));

  for (const name of missingNamedSourceSubjects(story, normalisedScript)) {
    failures.push(`script_coherence:named_source_subject_missing:${name}`);
  }

  if (GENERIC_UNCERTAINTY_BOILERPLATE_RE.test(normalisedScript)) {
    failures.push("script_coherence:generic_uncertainty_boilerplate");
  }

  if (HYBRID_SPOKEN_YEAR_RE.test(normalisedScript)) {
    failures.push("script_coherence:hybrid_spoken_year");
  }

  if (/\bexceeding projections by a substantial margin\b/i.test(normalisedScript)) {
    failures.push("script_coherence:unsupported_projection_claim");
  }

  if (
    /\binitial reports suggest\b/i.test(normalisedScript) &&
    /\b(?:server load|performance issues|deploying fixes|actively monitoring)\b/i.test(normalisedScript) &&
    !/\b(?:server|performance|fix|patch|hotfix|outage)\b/i.test(String(story.title || ""))
  ) {
    failures.push("script_coherence:unsupported_live_ops_claim");
  }

  const repeatedNumbers = repeatedNumericClaims(normalisedScript);
  if (repeatedNumbers.length > 0) {
    failures.push(`script_coherence:repeated_numeric_claim:${repeatedNumbers[0].claim}`);
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

  const nearRepeats = repeatedNearPhrases(normalisedScript);
  if (nearRepeats.length > 0) {
    failures.push(`script_coherence:repeated_near_phrase:${nearRepeats[0].slice(0, 80)}`);
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

  failures.push(...unsupportedNumberedSequelClaims(story, normalisedScript));

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
  repeatedNumericClaims,
  repeatedNearPhrases,
  runScriptCoherenceQa,
  repeatedSentences,
};
