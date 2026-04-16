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

const ADVERTISER_UNFRIENDLY_TERMS = [
  "kill",
  "killed",
  "murder",
  "suicide",
  "self-harm",
  "terrorist",
  "rape",
  "massacre",
  "shooter",
  "shooting",
  "bomb",
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
    for (const term of ADVERTISER_UNFRIENDLY_TERMS) {
      if (hay.includes(term)) return 0;
    }
    return 5;
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

  return {
    total: clamp(Math.round(adjusted), 0, 120),
    raw_total: clamp(Math.round(total), 0, 100),
    decision,
    breakdown,
    hook_bonus,
    diversity_bonus,
    repetition_penalty,
    hard_stops,
    inputs: {
      flair: story.flair || null,
      subreddit: story.subreddit || null,
      score: story.score || null,
      num_comments: story.num_comments || null,
      source_type: story.source_type || null,
      timestamp: story.timestamp || null,
    },
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
  });
}

module.exports = {
  DIM_WEIGHTS,
  SOURCE_TIERS,
  ADVERTISER_UNFRIENDLY_TERMS,
  scoreStory,
  recordScore,
};
