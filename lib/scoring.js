/**
 * lib/scoring.js — the 100-point editorial rubric.
 *
 * V4 brief spec:
 *   source_confidence     25  (verified vs rumoured vs Twitter rando)
 *   story_importance      15  (platform-level vs minor patch)
 *   freshness             10  (hours since published)
 *   search_demand         10  (how much people actually search this)
 *   visual_viability      10  (can we generate a compelling Short?)
 *   originality           10  (is anyone else covering this already?)
 *   duplicate_safety      10  (would shipping this double-post?)
 *   advertiser_safety      5
 *   roundup_suitability    5
 *   ─────────────────────────
 *   TOTAL                100
 *
 *   Adjustments (applied after the base score):
 *     + hook_bonus (up to +5)        — great first-line hook
 *     + diversity_bonus (up to +3)   — topic different from recent uploads
 *     - repetition_penalty (0..-10)  — too similar to last 7 days of output
 *
 *   Hard stops (any triggers them -> force REJECT regardless of score):
 *     - advertiser-unfriendly language in hook/body/title
 *     - unverified rumour pretending to be fact
 *     - duplicate platform_posts row with status='published'
 *
 *   Decision thresholds (after adjustments):
 *     total >= 75   AUTO      — ship without review
 *     55 <= total   REVIEW    — queue for human signoff
 *     35 <= total   DEFER     — re-score in 24h, maybe the signal strengthens
 *     total <  35   REJECT    — drop, do not re-score
 *
 * Every score is written to story_scores (append-only) for auditability.
 * The dashboard plots decision distributions off this table.
 */

const DIM_WEIGHTS = {
  source_confidence: 25,
  story_importance: 15,
  freshness: 10,
  search_demand: 10,
  visual_viability: 10,
  originality: 10,
  duplicate_safety: 10,
  advertiser_safety: 5,
  roundup_suitability: 5,
};

const { evaluatePulseGamingTopicality } = require("./topicality-gate");

// Absolute, unambiguous real-world harm terms. These never have a
// legitimate gaming context — if they appear at all, the story is unsafe
// for advertiser-friendly publishing. Keep this list tight on purpose.
const ABSOLUTE_UNSAFE_TERMS = [
  "suicide",
  "self-harm",
  "selfharm",
  "rape",
  "pedophile",
  "pedophilia",
  "child abuse",
  "child porn",
  "genocide",
  "lynching",
  "terrorism",
  "terrorist attack",
];

// Gaming-ambiguous terms. These words legitimately appear in normal
// coverage of shooter/action/crime franchises (Call of Duty, Battlefield,
// Doom, Medal of Honor, Hotline Miami, Mafia, GTA, Counter-Strike, etc.)
// — a flat block on "shooter"/"shooting"/"kill" would reject half of
// normal gaming news. Instead these only hard-stop when paired with a
// real-world-harm context phrase (see REAL_WORLD_HARM_CONTEXT).
const GAMING_AMBIGUOUS_TERMS = [
  "kill",
  "killed",
  "murder",
  "murdered",
  "massacre",
  "shooter",
  "shooting",
  "shootout",
  "bomb",
  "bombing",
  "gun",
  "guns",
  "war",
  "terrorist", // e.g. Rainbow Six, Counter-Strike use this term in-game
];

// Phrases that clearly indicate real-world violence, tragedy, or news-
// coverage context rather than a game's fictional world. If ANY of these
// appear in the same text as a gaming-ambiguous term, treat it as unsafe.
const REAL_WORLD_HARM_CONTEXT = [
  "mass shooting",
  "school shooting",
  "school shooter",
  "mass shooter",
  "active shooter",
  "gun violence",
  "real life",
  "real-life",
  "irl",
  "in real life",
  "tragedy",
  "tragic",
  "victim",
  "victims",
  "police said",
  "officers said",
  "arrested",
  "hospital",
  "died in",
  "killed in a",
  "killed in an",
  "was killed by",
  "was shot",
  "was stabbed",
  "was murdered",
  "passed away",
  "deceased",
];

// Strong gaming-context markers. If present, an ambiguous term is almost
// certainly being used in a game-coverage context, not a real-world one.
// Used to distinguish "the shooter genre is evolving" (safe) from
// "the shooter opened fire on the crowd" (unsafe).
const GAMING_CONTEXT_MARKERS = [
  "game",
  "games",
  "gaming",
  "gameplay",
  "trailer",
  "reveal",
  "remake",
  "remaster",
  "reboot",
  "sequel",
  "prequel",
  "dlc",
  "expansion",
  "franchise",
  "update",
  "patch",
  "developer",
  "publisher",
  "studio",
  "release",
  "launch",
  "steam",
  "playstation",
  "ps5",
  "ps4",
  "ps3",
  "xbox",
  "nintendo",
  "switch",
  "console",
  "indie",
  "multiplayer",
  "single-player",
  "singleplayer",
  "speedrun",
  "mod",
  "modding",
  "easter egg",
  "cutscene",
  "campaign", // e.g. "the campaign killed me three times"
  "boss fight",
  "npc",
  "fps",
  "rpg",
  "mmo",
];

// Back-compat export: previous consumers imported ADVERTISER_UNFRIENDLY_TERMS.
// The old flat list was a superset of ABSOLUTE + AMBIGUOUS, minus the newer
// additions. Keep the name exported but compose it from the new lists so
// any external reader sees a consistent shape.
const ADVERTISER_UNFRIENDLY_TERMS = [
  ...ABSOLUTE_UNSAFE_TERMS,
  ...GAMING_AMBIGUOUS_TERMS,
];

// Trusted leakers — named industry insiders with a multi-year track record
// of accurate reporting. A rumour that cites ONE of these leakers by name
// is materially different from an anonymous /r/GamingLeaksAndRumours post:
// we know who's making the claim and we can hold them accountable. Keep
// this list tight — adding a new name should require a deliberate review.
const TRUSTED_LEAKERS = [
  "billbil-kun",
  "billbilkun",
  "billbil kun",
  "tom henderson",
  "jason schreier",
  "jeff grubb",
  "nate the hate",
  "nibellion",
];

// First-party / primary-source evidence phrases. A rumour grounded in
// something publicly verifiable (a Steam listing, a developer portal
// entry, a company-site page) is closer to "reporting" than "gossip"
// and survives the auto-lane when paired with a named platform/franchise.
const PUBLISHER_EVIDENCE_PHRASES = [
  "developer portal",
  "dev portal",
  "listed on their site",
  "on their site",
  "on their website",
  "spotted on",
  "appeared on",
  "appeared in",
  "steam page",
  "steam store listing",
  "steam store page",
  "steam listing",
  "press release",
  "official announcement",
  "official listing",
  "company site",
  "company website",
  "datamined",
  "dataminer",
  "data-mined",
  "data mine",
];

// Concrete-claim patterns. The trusted-rumour auto-lane only fires when
// the story has something falsifiable: a specific date, a specific time
// window, or a quantified public-site listing ("7 unannounced games").
// Vague "something might happen" rumours must go through human review.
const CONCRETE_DATE_RE =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}(?:st|nd|rd|th)?\b/i;
// Month-name paired with a subscription service is an implicit concrete
// date for this domain — "April's PS Plus" means the first-Tuesday drop,
// "May's Game Pass" means the monthly lineup. Narrow rule, deliberately
// requires the service keyword to avoid false positives from "in April".
const IMPLICIT_WINDOW_RE =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:'s)?\s+(?:ps\s*plus|ps\+|playstation\s*plus|game\s*pass|xbox\s*game\s*pass)\b/i;
const CONCRETE_TIME_RE =
  /\b\d{1,2}:\d{2}\s*(?:am|pm)?\s*(?:et|pt|ct|mt|utc|gmt|bst|edt|pdt|cest|cet)\b/i;
const NUMERIC_CLAIM_RE =
  /\b\d+\s+(?:unannounced|upcoming|unrevealed|incoming)\b/i;

// Mainstream franchises. A rumour about one of these has an audience;
// a rumour about an obscure indie DLC roster does not. Used by the
// auto-lane's "named franchise or platform/service" gate. Not exhaustive
// — add additions by PR, not dynamically.
const FRANCHISE_KEYWORDS = [
  "call of duty",
  "cod",
  "battlefield",
  "doom",
  "assassin's creed",
  "assassins creed",
  "far cry",
  "splinter cell",
  "ghost recon",
  "rainbow six",
  "watch dogs",
  "prince of persia",
  "halo",
  "gears of war",
  "forza",
  "god of war",
  "horizon",
  "horizon zero dawn",
  "horizon forbidden west",
  "last of us",
  "uncharted",
  "gran turismo",
  "zelda",
  "mario",
  "metroid",
  "pokemon",
  "pokémon",
  "final fantasy",
  "kingdom hearts",
  "dragon quest",
  "resident evil",
  "monster hunter",
  "street fighter",
  "devil may cry",
  "silent hill",
  "metal gear",
  "gta",
  "grand theft auto",
  "red dead",
  "elder scrolls",
  "skyrim",
  "fallout",
  "starfield",
  "mass effect",
  "dragon age",
  "fifa",
  "madden",
  "nba 2k",
  "hitman",
  "tomb raider",
  "deus ex",
  "mafia",
  "black flag",
  "cyberpunk",
  "witcher",
  "borderlands",
  "dark souls",
  "elden ring",
  "bloodborne",
  "sekiro",
  "sonic",
  "minecraft",
  "diablo",
  "overwatch",
  "warcraft",
  "league of legends",
  "valorant",
  "fortnite",
  "apex legends",
  "destiny",
  "death stranding",
  "persona",
];

// Platforms / subscription services. A "PS Plus" or "Switch 2" hook has
// intrinsic search demand even when no specific franchise is named.
const PLATFORM_SERVICE_KEYWORDS = [
  "ps5",
  "ps4",
  "playstation 5",
  "playstation 4",
  "ps plus",
  "playstation plus",
  "ps+",
  "xbox",
  "xbox series x",
  "xbox series s",
  "game pass",
  "xbox game pass",
  "switch 2",
  "nintendo switch 2",
  "steam deck",
  "epic games store",
];

// Hard blockers for the auto-lane — these phrases indicate the story is
// off-brand (film/celebrity/industry-drama) or too speculative for an
// automated approval path. The rubric may still let them through at 75,
// but the auto-lane specifically refuses to promote them from review.
const AUTO_LANE_OFF_BRAND_BLOCKERS = [
  "hollywood",
  "cinemacon",
  "box office",
  "academy awards",
  "theatrical release",
  "film industry",
];

// Vague hedge phrases. A rumour hedged with "may have slipped up" or
// "possibly teased" is not a concrete claim even if it names a franchise.
// The auto-lane only lets these through when paired with a specific
// date or time (see qualifiesForTrustedRumourAutoLane).
const AUTO_LANE_VAGUE_HEDGES = [
  "may have slipped",
  "might have slipped",
  "may have leaked",
  "slipped up",
  "accidentally revealed",
  "possibly teased",
  "appears to tease",
  "seems to hint",
];

// Source tiers — higher = more trusted. Maps from subreddit or RSS label.
const SOURCE_TIERS = {
  // Verified leaks: GamingLeaksAndRumours/Verified flair is gold standard.
  "verified:gamingleaksandrumours": 24,
  "highly likely:gamingleaksandrumours": 20,
  "rumour:gamingleaksandrumours": 12,
  // Major outlets (RSS)
  "rss:ign": 22,
  "rss:gamespot": 21,
  "rss:eurogamer": 22,
  "rss:polygon": 20,
  "rss:kotaku": 18,
  "rss:rockpapershotgun": 20,
  "rss:pcgamer": 20,
  "rss:videogameschronicle": 21,
  // General reddit — depends heavily on the flair
  verified: 22,
  "highly likely": 18,
  news: 14,
  rumour: 9,
};

/**
 * Escape special regex characters so a term like "self-harm" can be used
 * inside a word-boundary pattern without matching as `self` + `harm`.
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Score a single dimension. All scorers return a number in [0, max].
 */
const DIMENSION_SCORERS = {
  source_confidence(story) {
    // Combine subreddit trust + flair trust + community engagement.
    const flair = (story.flair || "").toLowerCase();
    const subreddit = (story.subreddit || "").toLowerCase();
    const sourceType = (story.source_type || "reddit").toLowerCase();

    let base = 12;
    const key = `${flair}:${subreddit}`;
    if (SOURCE_TIERS[key]) base = SOURCE_TIERS[key];
    else if (sourceType === "rss" && SOURCE_TIERS[`rss:${subreddit}`])
      base = SOURCE_TIERS[`rss:${subreddit}`];
    else if (SOURCE_TIERS[flair]) base = SOURCE_TIERS[flair];

    // Reddit votes boost confidence up to +3
    const score = Number(story.score || 0);
    const voteBoost = Math.min(3, Math.floor(score / 300));
    return clamp(base + voteBoost, 0, DIM_WEIGHTS.source_confidence);
  },

  story_importance(story) {
    // Heuristic: first-party platform announcements > studio announcements >
    // minor patches. Fall back to score/num_comments proxy.
    const hay = [story.title || "", story.body || ""].join(" ").toLowerCase();
    let pts = 6;
    const platformSignals = [
      "reveal",
      "announcement",
      "release date",
      "showcase",
      "direct",
      "state of play",
      "xbox showcase",
      "the game awards",
      "launch",
      "acquisition",
      "sequel",
      "remake",
      "remaster",
    ];
    for (const sig of platformSignals) if (hay.includes(sig)) pts += 2;
    // Cap at 13 before community boost so community can only take it to max.
    pts = Math.min(13, pts);
    const score = Number(story.score || 0);
    pts += Math.min(2, Math.floor(score / 1500));
    return clamp(pts, 0, DIM_WEIGHTS.story_importance);
  },

  freshness(story) {
    const ts = story.timestamp
      ? new Date(story.timestamp).getTime()
      : Date.now();
    const hoursOld = (Date.now() - ts) / 3_600_000;
    if (hoursOld <= 2) return 10;
    if (hoursOld <= 6) return 9;
    if (hoursOld <= 12) return 7;
    if (hoursOld <= 24) return 5;
    if (hoursOld <= 48) return 3;
    return 1;
  },

  search_demand(story) {
    // No live Trends pull in this build — proxy off num_comments +
    // upvotes (which correlate with the organic search interest that
    // arrives 24-48h later). Tunable once we add a Trends poller.
    const comments = Number(story.num_comments || 0);
    const votes = Number(story.score || 0);
    const proxy = comments * 0.6 + votes * 0.01;
    if (proxy >= 250) return 10;
    if (proxy >= 120) return 8;
    if (proxy >= 50) return 6;
    if (proxy >= 15) return 4;
    return 2;
  },

  visual_viability(story) {
    // Heuristic: do we already have rich visuals cached (game key art,
    // article og:image, company logo)?
    let pts = 2;
    if (story.article_image) pts += 2;
    if (Array.isArray(story.game_images) && story.game_images.length) pts += 3;
    if (story.company_logo_url) pts += 1;
    if (
      Array.isArray(story.downloaded_images) &&
      story.downloaded_images.length >= 2
    )
      pts += 2;
    return clamp(pts, 0, DIM_WEIGHTS.visual_viability);
  },

  originality(story, ctx) {
    // Penalise if we've already covered the same game/studio in the last 7 days.
    if (!ctx || !ctx.recentStories) return 6;
    const recent = ctx.recentStories.filter((s) => s.id !== story.id);
    const title = (story.title || "").toLowerCase();
    const titleTokens = new Set(
      title.split(/[^a-z0-9]+/).filter((t) => t.length >= 4),
    );
    let overlaps = 0;
    for (const r of recent) {
      const rTitle = (r.title || "").toLowerCase();
      let hits = 0;
      for (const tok of titleTokens) if (rTitle.includes(tok)) hits++;
      if (hits >= 3) overlaps++;
    }
    if (overlaps === 0) return 10;
    if (overlaps === 1) return 7;
    if (overlaps === 2) return 4;
    return 2;
  },

  duplicate_safety(story, ctx) {
    // 10 if we've never published anything for this story id; drop to
    // 0 if a platform_posts row already exists with status='published'.
    if (!ctx || !ctx.existingPublishedPlatforms) return 8;
    return ctx.existingPublishedPlatforms.length > 0 ? 0 : 10;
  },

  advertiser_safety(story) {
    const hay = [story.title, story.body, story.full_script]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // Tier 1: absolute, unambiguous real-world harm. No gaming context
    // rescues these — if present at all, the story is unsafe.
    for (const term of ABSOLUTE_UNSAFE_TERMS) {
      if (hay.includes(term)) return 0;
    }

    // Tier 2: gaming-ambiguous terms. Check whether any appear via
    // word-boundary match (so "kill" matches "kill" but not "killer app").
    let hasAmbiguous = false;
    for (const term of GAMING_AMBIGUOUS_TERMS) {
      const re = new RegExp(`\\b${escapeRegExp(term)}\\b`);
      if (re.test(hay)) {
        hasAmbiguous = true;
        break;
      }
    }
    if (!hasAmbiguous) return 5;

    // Ambiguous term present. If it's paired with a real-world-harm
    // context phrase, hard-stop — this is the school-shooting / news-
    // story case, not a Medal of Honor fan remake.
    for (const phrase of REAL_WORLD_HARM_CONTEXT) {
      if (hay.includes(phrase)) return 0;
    }

    // Ambiguous term present without real-world context. If clear
    // gaming-context markers appear too (game / trailer / DLC / Steam /
    // etc.), treat as safe — this is the dominant case for normal
    // shooter/action gaming news.
    for (const marker of GAMING_CONTEXT_MARKERS) {
      const re = new RegExp(`\\b${escapeRegExp(marker)}\\b`);
      if (re.test(hay)) return 5;
    }

    // Neither real-world harm phrasing nor clear gaming context. The
    // term is floating in ambiguous prose. Partial credit (not zero,
    // so no hard-stop; not full, so total score drops slightly to nudge
    // the story toward review instead of auto).
    return 2;
  },

  roundup_suitability(story) {
    // Prefer evergreen stories (deep dives, lore, tech explainers) over
    // time-sensitive rumours for weekly compilation inclusion.
    const flair = (story.flair || "").toLowerCase();
    if (flair === "rumour") return 1;
    if (flair === "verified") return 5;
    if (flair === "news") return 4;
    const hay = (story.title || "").toLowerCase();
    const evergreen = [
      "history",
      "lore",
      "behind the scenes",
      "explained",
      "tier list",
    ];
    for (const sig of evergreen) if (hay.includes(sig)) return 5;
    return 3;
  },
};

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Compute the full score for a story.
 *
 * ctx (all optional):
 *   recentStories: [{id, title, timestamp}]  — past ~7d uploads for
 *                                                originality + repetition
 *   existingPublishedPlatforms: ['youtube', ...]
 *                                             — output of
 *                                                platformPosts.listByStory(id)
 *                                                filtered to status='published'
 */
function scoreStory(story, ctx = {}) {
  const breakdown = {};
  let total = 0;
  for (const [dim, weight] of Object.entries(DIM_WEIGHTS)) {
    const scorer = DIMENSION_SCORERS[dim];
    const raw = clamp(scorer(story, ctx) || 0, 0, weight);
    breakdown[dim] = raw;
    total += raw;
  }

  // Bonuses
  const hook = (story.hook || "").trim();
  const hookWords = hook.split(/\s+/).filter(Boolean).length;
  const hookStartsStrong =
    !!hook && !/^(so|today|hey|welcome|in this)\b/i.test(hook);
  const hook_bonus =
    hookStartsStrong && hookWords >= 5 && hookWords <= 14 ? 5 : 0;

  let diversity_bonus = 0;
  if (ctx.recentStories) {
    const uniqueSources = new Set(
      ctx.recentStories.map((s) => (s.subreddit || "").toLowerCase()),
    );
    if (uniqueSources.size >= 5) diversity_bonus = 3;
  }

  let repetition_penalty = 0;
  if (ctx.recentStories && ctx.recentStories.length) {
    const overlapScore = 10 - breakdown.originality;
    if (overlapScore >= 8) repetition_penalty = 10;
    else if (overlapScore >= 6) repetition_penalty = 6;
    else if (overlapScore >= 4) repetition_penalty = 3;
  }

  const adjusted = total + hook_bonus + diversity_bonus - repetition_penalty;

  // Hard stops
  const hard_stops = [];
  const topicality = evaluatePulseGamingTopicality(story, {
    channelId: ctx.channelId || "pulse-gaming",
  });
  if (topicality.decision === "reject")
    hard_stops.push("pulse_gaming_off_topic_entertainment");
  if (breakdown.advertiser_safety === 0)
    hard_stops.push("advertiser_unfriendly_language");
  if (
    (story.flair || "").toLowerCase() === "rumour" &&
    /is\s+confirmed|has\s+been\s+confirmed/i.test(story.full_script || "")
  )
    hard_stops.push("rumour_presented_as_fact");
  if (
    ctx.existingPublishedPlatforms &&
    ctx.existingPublishedPlatforms.length > 0
  )
    hard_stops.push("already_published");

  // Decision
  let decision;
  if (hard_stops.length) decision = "reject";
  else if (adjusted >= 75) decision = "auto";
  else if (adjusted >= 55) decision = "review";
  else if (adjusted >= 35) decision = "defer";
  else decision = "reject";

  if (decision === "auto" && topicality.decision === "review") {
    decision = "review";
  }

  return {
    total: clamp(Math.round(adjusted), 0, 120),
    raw_total: clamp(Math.round(total), 0, 100),
    decision,
    breakdown,
    hook_bonus,
    diversity_bonus,
    repetition_penalty,
    hard_stops,
    topicality,
    inputs: {
      flair: story.flair || null,
      subreddit: story.subreddit || null,
      score: story.score || null,
      num_comments: story.num_comments || null,
      source_type: story.source_type || null,
      timestamp: story.timestamp || null,
      topicality_decision: topicality.decision,
      topicality_reason: topicality.reason,
      topicality_category: topicality.category,
    },
  };
}

/**
 * Trusted-rumour auto-approval lane.
 *
 * A narrow, deliberately conservative mechanism that lifts SOME stories
 * from `review` → `auto` WITHOUT lowering the global 75-point threshold.
 *
 * Background (2026-04-18): the rubric caps source_confidence at 12/25 for
 * rumour-flair GamingLeaksAndRumours posts. This is correct for anonymous
 * rumours — but it also catches tier-1 named leakers (Billbil-kun, Tom
 * Henderson) whose track record is effectively "verified"-grade. Those
 * stories land in the 55-74 review band even when they have a specific
 * date, a named franchise, and a named platform. Waiting on a human to
 * approve them burns the freshness window.
 *
 * This lane ONLY promotes a `review` decision to `auto` when every one of
 * the following holds:
 *
 *   1. The rubric already decided `review` (55 ≤ total < 75).
 *   2. There are zero hard stops.
 *   3. advertiser_safety is a clean 5/5 (no ambiguous terms at all).
 *   4. duplicate_safety is clean (no prior published platform_posts row).
 *   5. AT LEAST ONE credible-source signal is present:
 *        - a named tier-1 leaker in the title/body (TRUSTED_LEAKERS), OR
 *        - subreddit=gamingleaksandrumours AND flair in {verified, highly
 *          likely}, OR
 *        - a primary-source evidence phrase (PUBLISHER_EVIDENCE_PHRASES).
 *   7. AT LEAST ONE concrete-claim signal is present:
 *        - a specific date (CONCRETE_DATE_RE), OR
 *        - a specific time window (CONCRETE_TIME_RE), OR
 *        - a quantified numeric claim (NUMERIC_CLAIM_RE), OR
 *        - a primary-source evidence phrase (self-certifying).
 *   8. A named franchise or platform/service is mentioned.
 *   9. NO off-brand blockers (film/celebrity industry drama) are present.
 *  10. NO more than 2 distinct franchises are referenced (compilations
 *      are multi-beat and unfocused — they stay in review).
 *  11. If a vague hedge phrase is present ("may have slipped up",
 *      "possibly teased"), it must be accompanied by a specific date
 *      or time window to qualify.
 *
 * Returns { qualifies: boolean, reason: string | null }. `reason` is a
 * short audit string that gets persisted into story_scores.inputs so
 * future digests can explain WHY a story was auto-promoted without
 * clearing the normal 75-point bar.
 */
function qualifiesForTrustedRumourAutoLane(story, score) {
  if (!story || !score) return { qualifies: false, reason: null };
  if (score.decision !== "review") return { qualifies: false, reason: null };
  if (Array.isArray(score.hard_stops) && score.hard_stops.length > 0)
    return { qualifies: false, reason: null };

  const b = score.breakdown || {};
  if (b.advertiser_safety !== 5) return { qualifies: false, reason: null };
  // duplicate_safety returns 10 when no platform has published, 8 when
  // ctx is missing, 0 when already published (which would also hard-stop).
  // Accept 8+ so unit-test style usage (no ctx supplied) still works.
  if ((b.duplicate_safety || 0) < 8) return { qualifies: false, reason: null };
  // No explicit freshness gate. The rubric already weighs freshness (up to
  // 10 points) into the total, so a very stale story generally cannot
  // reach the 55-point review band in the first place — and when it
  // does, the other signals have compensated. Tier-1 leaker claims about
  // a current-month service window (e.g. "April's PS Plus") are still
  // shippable at 3+ days old because the content's timeliness tracks the
  // month, not the post age.

  // Normalise curly apostrophes (U+2019) to ASCII so "April's PS Plus"
  // (curly, as Reddit's Markdown renderer emits) and "April's PS Plus"
  // (ASCII) both survive the regex gates below.
  const hay = [
    story.title || "",
    story.body || "",
    story.full_script || "",
    story.hook || "",
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'");

  // Off-brand blockers first — cheapest rejection.
  for (const phrase of AUTO_LANE_OFF_BRAND_BLOCKERS) {
    if (hay.includes(phrase)) return { qualifies: false, reason: null };
  }

  // Credible source: named tier-1 leaker, high-trust GLaR, or primary
  // publisher evidence. At least one must hold.
  const subreddit = (story.subreddit || "").toLowerCase();
  const flair = (story.flair || "").toLowerCase();
  const matchedLeaker = TRUSTED_LEAKERS.find((n) => hay.includes(n)) || null;
  const isHighTrustGLaR =
    subreddit === "gamingleaksandrumours" &&
    (flair === "verified" || flair === "highly likely");
  const matchedEvidence =
    PUBLISHER_EVIDENCE_PHRASES.find((p) => hay.includes(p)) || null;

  if (!matchedLeaker && !isHighTrustGLaR && !matchedEvidence)
    return { qualifies: false, reason: null };

  // Concrete claim: at least one of date / time / numeric / evidence.
  // Implicit windows like "April's PS Plus" also count — the drop cadence
  // is public knowledge and anchors the claim in time.
  const hasDate = CONCRETE_DATE_RE.test(hay) || IMPLICIT_WINDOW_RE.test(hay);
  const hasTime = CONCRETE_TIME_RE.test(hay);
  const hasNumeric = NUMERIC_CLAIM_RE.test(hay);
  if (!hasDate && !hasTime && !hasNumeric && !matchedEvidence)
    return { qualifies: false, reason: null };

  // Named franchise OR platform/service. Word-boundary match so "cod"
  // does not falsely match "codenames" and "gta" does not match "regatta".
  const wordBoundaryMatch = (kw) =>
    new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i").test(hay);
  const matchedFranchises = FRANCHISE_KEYWORDS.filter(wordBoundaryMatch);
  const matchedPlatform =
    PLATFORM_SERVICE_KEYWORDS.find(wordBoundaryMatch) || null;
  if (matchedFranchises.length === 0 && !matchedPlatform)
    return { qualifies: false, reason: null };

  // Compilation blocker — three or more distinct franchises means the
  // story is a Ubisoft/EA/Xbox round-up, not a focused claim. Keep it
  // in review so a human can pick which beat to lead with.
  // The FRANCHISE_KEYWORDS list contains aliases ("gta" + "grand theft auto",
  // "horizon" + "horizon zero dawn"), so collapse aliases before counting.
  const franchiseAliasGroups = [
    ["gta", "grand theft auto"],
    ["horizon", "horizon zero dawn", "horizon forbidden west"],
    ["call of duty", "cod"],
    ["assassin's creed", "assassins creed"],
    ["pokemon", "pokémon"],
  ];
  const canonical = new Set(matchedFranchises);
  for (const group of franchiseAliasGroups) {
    const hits = group.filter((k) => canonical.has(k));
    if (hits.length > 1) {
      for (let i = 1; i < hits.length; i++) canonical.delete(hits[i]);
    }
  }
  if (canonical.size > 2) return { qualifies: false, reason: null };

  // Vague hedge blocker. If the story hedges ("may have slipped up"),
  // only promote it when the claim is anchored to a specific date/time.
  const matchedHedge =
    AUTO_LANE_VAGUE_HEDGES.find((p) => hay.includes(p)) || null;
  if (matchedHedge && !(hasDate || hasTime))
    return { qualifies: false, reason: null };

  // Build a compact audit string.
  const parts = [];
  if (matchedLeaker) parts.push(`leaker=${matchedLeaker}`);
  if (isHighTrustGLaR) parts.push(`glar:${flair}`);
  if (matchedEvidence) parts.push(`evidence="${matchedEvidence}"`);
  if (hasDate) parts.push("specific_date");
  if (hasTime) parts.push("specific_time");
  if (hasNumeric) parts.push("numeric_claim");
  if (matchedFranchises.length)
    parts.push(`franchise=${[...canonical][0] || matchedFranchises[0]}`);
  if (matchedPlatform) parts.push(`platform=${matchedPlatform}`);

  return {
    qualifies: true,
    reason: `trusted_rumour_auto_lane: ${parts.join(", ")}`,
  };
}

/**
 * Trusted-publisher auto-approval lane (2026-04-23).
 *
 * Motivation (from the forensic audit):
 *   Last 48h scored 10 auto / 10 defer / 38 review. Within that 38:
 *     - 4 stories at score 70-74 from first-party gaming publishers
 *       (Eurogamer, Polygon, RockPaperShotgun) on mainstream gaming
 *       news (Black Flag DLC, Overwatch on Switch 2, new Xbox boss
 *       hinting at Discord integration, Bloodlines 2 protagonist
 *       details)
 *     - All have zero hard_stops, advertiser_safety 5/5, and clean
 *       duplicate_safety 10/10
 *     - None qualify for the existing trusted-rumour lane because
 *       that lane demands a tier-1 LEAKER name or GLaR high-trust
 *       flair — neither applies to a Polygon news post
 *
 *   These are exactly the stories a fully-unattended channel should
 *   ship. Keeping them in review burns the freshness window and
 *   requires operator involvement we don't have.
 *
 * This lane ONLY promotes a `review` decision to `auto` when every
 * one of these holds:
 *
 *   1. The rubric already decided `review` (55 ≤ total < 75).
 *   2. There are zero hard stops.
 *   3. advertiser_safety is a clean 5/5.
 *   4. duplicate_safety is clean (>= 8).
 *   5. source_type is "rss" AND the subreddit field matches one
 *      of the allow-listed trusted publishers (tier 20+ in
 *      SOURCE_TIERS — see TRUSTED_PUBLISHER_SUBS below).
 *   6. story.total >= TRUSTED_PUBLISHER_MIN_SCORE (70). This is
 *      one tier below the global auto floor (75) — stories that
 *      the rubric ALREADY thought were nearly auto-worthy. Below
 *      70 the story is weaker than we want to ship unsupervised.
 *   7. The title or body contains a recognised gaming franchise
 *      OR a platform/service keyword (prevents misidentified
 *      non-gaming coverage on these outlets from slipping in).
 *   8. No off-brand blockers (film/celebrity drama / industry
 *      HR drama) — reuses the existing AUTO_LANE_OFF_BRAND_BLOCKERS
 *      list for parity with the rumour lane.
 *   9. No vague hedge phrases (same reuse).
 *
 * Existing TRUSTED-RUMOUR lane remains unchanged. A story may
 * qualify for BOTH lanes; the caller promotes on whichever
 * fires first.
 */
const TRUSTED_PUBLISHER_MIN_SCORE = 70;

const TRUSTED_PUBLISHER_SUBS = new Set([
  // First-party gaming press where editorial staff have named
  // bylines and a track record. All have SOURCE_TIERS >= 20.
  "eurogamer",
  "polygon",
  "rockpapershotgun",
  "ign",
  "gamespot",
  "pcgamer",
  "videogameschronicle",
  "vgc",
]);

function qualifiesForTrustedPublisherAutoLane(story, score) {
  if (!story || !score) return { qualifies: false, reason: null };
  if (score.decision !== "review") return { qualifies: false, reason: null };
  if (Array.isArray(score.hard_stops) && score.hard_stops.length > 0)
    return { qualifies: false, reason: null };

  const b = score.breakdown || {};
  if (b.advertiser_safety !== 5) return { qualifies: false, reason: null };
  if ((b.duplicate_safety || 0) < 8) return { qualifies: false, reason: null };

  // Trusted-publisher source gate.
  const sourceType = (story.source_type || "").toLowerCase();
  if (sourceType !== "rss") return { qualifies: false, reason: null };
  const subreddit = (story.subreddit || "").toLowerCase().trim();
  // Subreddit field on RSS stories carries the outlet short name
  // (e.g. "Eurogamer" → "eurogamer"). Normalise spaces/punctuation.
  const subKey = subreddit.replace(/\s+/g, "");
  if (
    !TRUSTED_PUBLISHER_SUBS.has(subreddit) &&
    !TRUSTED_PUBLISHER_SUBS.has(subKey)
  ) {
    return { qualifies: false, reason: null };
  }

  // Score floor — one tier below global auto.
  if ((score.total || 0) < TRUSTED_PUBLISHER_MIN_SCORE)
    return { qualifies: false, reason: null };

  // Gaming-specificity gate: must mention a named franchise OR a
  // platform/service. Prevents movie-industry / HR-drama pieces
  // on these outlets from slipping through.
  const hay = [
    story.title || "",
    story.body || "",
    story.full_script || "",
    story.hook || "",
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'");

  // Off-brand blockers first (parity with rumour lane).
  for (const phrase of AUTO_LANE_OFF_BRAND_BLOCKERS) {
    if (hay.includes(phrase)) return { qualifies: false, reason: null };
  }

  // Vague hedge blocker (parity with rumour lane). A trusted
  // publisher running a hedge-heavy rumour story still goes to
  // review; only confident claims auto.
  const matchedHedge =
    AUTO_LANE_VAGUE_HEDGES.find((p) => hay.includes(p)) || null;
  if (matchedHedge) return { qualifies: false, reason: null };

  const wordBoundaryMatch = (kw) =>
    new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i").test(hay);
  const matchedFranchises = FRANCHISE_KEYWORDS.filter(wordBoundaryMatch);
  const matchedPlatform =
    PLATFORM_SERVICE_KEYWORDS.find(wordBoundaryMatch) || null;
  if (matchedFranchises.length === 0 && !matchedPlatform)
    return { qualifies: false, reason: null };

  const parts = [`publisher=${subreddit}`, `score=${score.total}`];
  if (matchedFranchises.length) parts.push(`franchise=${matchedFranchises[0]}`);
  if (matchedPlatform) parts.push(`platform=${matchedPlatform}`);

  return {
    qualifies: true,
    reason: `trusted_publisher_auto_lane: ${parts.join(", ")}`,
  };
}

/**
 * Persist the score to story_scores via the repository layer. Idempotent
 * per call (rows are append-only, so repeated scoring of the same story
 * creates a history you can plot against recency).
 */
function recordScore(storyId, channelId, score, { repos } = {}) {
  const r = repos || require("./repositories").getRepos();
  r.scoring.record({
    story_id: storyId,
    channel_id: channelId || null,
    total: score.total,
    decision: score.decision,
    decision_reason: score.decision_reason,
    source_confidence: score.breakdown.source_confidence,
    story_importance: score.breakdown.story_importance,
    freshness: score.breakdown.freshness,
    search_demand: score.breakdown.search_demand,
    visual_viability: score.breakdown.visual_viability,
    originality: score.breakdown.originality,
    duplicate_safety: score.breakdown.duplicate_safety,
    advertiser_safety: score.breakdown.advertiser_safety,
    roundup_suitability: score.breakdown.roundup_suitability,
    hook_bonus: score.hook_bonus,
    diversity_bonus: score.diversity_bonus,
    repetition_penalty: score.repetition_penalty,
    hard_stops: score.hard_stops,
    inputs: score.inputs,
    scorer_version: score.scorer_version,
  });
}

module.exports = {
  DIM_WEIGHTS,
  SOURCE_TIERS,
  ADVERTISER_UNFRIENDLY_TERMS,
  TRUSTED_LEAKERS,
  PUBLISHER_EVIDENCE_PHRASES,
  FRANCHISE_KEYWORDS,
  PLATFORM_SERVICE_KEYWORDS,
  TRUSTED_PUBLISHER_SUBS,
  TRUSTED_PUBLISHER_MIN_SCORE,
  scoreStory,
  recordScore,
  qualifiesForTrustedRumourAutoLane,
  qualifiesForTrustedPublisherAutoLane,
};
