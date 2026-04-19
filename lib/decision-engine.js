/**
 * lib/decision-engine.js — Phase 6 editorial control plane.
 *
 * Bridges the pure rubric in lib/scoring.js to the DB-side state it
 * needs to act on. Given a list of stories (or "all unscored stories
 * in the last 48h"), this:
 *
 *   1. Builds the scoring context (recent stories, existing published
 *      platform_posts rows, channel) so the rubric has everything it
 *      needs to make a duplicate-safe, originality-aware call.
 *   2. Scores each story and persists the row into story_scores.
 *   3. Translates the decision into flips on the stories table:
 *        auto   -> approved = 1, auto_approved = 1
 *        review -> auto_approved = 0, approved unchanged (human gate)
 *        defer  -> leaves approved untouched, just records the score
 *        reject -> auto_approved = 0 (and blocks re-approval unless a
 *                  human manually flips approved back on)
 *
 * This replaces the "return true" heuristic in publisher.autoApprove()
 * when USE_SCORING_ENGINE=true. The old code path is preserved so the
 * legacy JSON-backed pipeline keeps running unchanged.
 *
 * Idempotent by design: scoring the same story twice appends two rows
 * to story_scores but only the latest one drives decisions.
 */

const {
  scoreStory,
  recordScore,
  qualifiesForTrustedRumourAutoLane,
} = require("./scoring");

const DEFAULT_RECENCY_HOURS = 7 * 24; // 7 days of "recent" context
const DEFAULT_BATCH_AGE_HOURS = 48; // scope of a single auto pass
const SCORER_VERSION = "v1.0";

/**
 * Pull the stories that should be considered for scoring in this pass.
 * We only look at stories that are (a) unapproved, (b) younger than
 * DEFAULT_BATCH_AGE_HOURS, and (c) have not been given a terminal
 * reject score in the last 24h (deferrals are allowed to re-score).
 */
function pickCandidates(repos, { ageHours = DEFAULT_BATCH_AGE_HOURS } = {}) {
  const cutoff = new Date(Date.now() - ageHours * 3_600_000).toISOString();
  // We read through the existing stories repo to keep the legacy JSON
  // path compatible for tests; SQL path uses a targeted query.
  const db = repos.db;
  const rows = db
    .prepare(
      `
        SELECT s.*
        FROM stories s
        LEFT JOIN (
          SELECT story_id, MAX(scored_at) AS last_scored, decision
          FROM story_scores
          GROUP BY story_id
        ) latest ON latest.story_id = s.id
        WHERE COALESCE(s.created_at, s.timestamp) >= ?
          AND (s.approved IS NULL OR s.approved = 0)
          AND (
            latest.last_scored IS NULL
            OR latest.decision IN ('defer','review')
            OR latest.last_scored < datetime('now', '-6 hours')
          )
        ORDER BY COALESCE(s.breaking_score, 0) DESC, s.created_at DESC
      `,
    )
    .all(cutoff);
  return rows;
}

/**
 * Recent stories used by the originality + diversity modifiers. We
 * intentionally pull approved OR exported stories so the rubric sees
 * "what the channel has actually covered", not every raw hunt hit.
 */
function fetchRecentStories(repos, { hours = DEFAULT_RECENCY_HOURS } = {}) {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  return repos.db
    .prepare(
      `
        SELECT id, title, subreddit, flair, timestamp, channel_id
        FROM stories
        WHERE (approved = 1 OR exported_path IS NOT NULL)
          AND COALESCE(timestamp, created_at) >= ?
        ORDER BY COALESCE(timestamp, created_at) DESC
      `,
    )
    .all(cutoff);
}

/**
 * Fetch the platform posts already published for a story id, scoped to
 * a channel when one is supplied. The rubric's duplicate_safety
 * dimension uses this to force a zero + hard-stop when we'd double-post.
 */
function publishedPlatformsFor(repos, storyId, channelId) {
  return repos.db
    .prepare(
      `
        SELECT platform
        FROM platform_posts
        WHERE story_id = ?
          AND status = 'published'
          AND (channel_id IS NULL OR channel_id = COALESCE(?, channel_id))
      `,
    )
    .all(storyId, channelId)
    .map((r) => r.platform);
}

/**
 * Score + persist one story. Returns the full score object + the
 * decision so callers (the auto-approve pass, jobs runner, dashboard)
 * can display the reasoning without re-reading the DB.
 */
function scoreOne(
  story,
  {
    repos,
    channelId = null,
    recentStories,
    scorerVersion = SCORER_VERSION,
  } = {},
) {
  if (!repos) throw new Error("[decision-engine] repos required");

  const ctx = {
    recentStories: recentStories || fetchRecentStories(repos),
    existingPublishedPlatforms: publishedPlatformsFor(
      repos,
      story.id,
      channelId,
    ),
    channelId,
  };

  const score = scoreStory(story, ctx);

  // Trusted-rumour auto-lane: narrow, deliberately conservative promotion
  // of `review` → `auto` for stories that cite a tier-1 named leaker or
  // primary-source evidence AND carry a concrete, dated/quantified claim
  // about a named franchise or platform. See `qualifiesForTrustedRumourAutoLane`
  // in lib/scoring.js for the full gate list. Applied AFTER scoring and
  // hard-stop checks, never bypasses either. Keeps the global 75-point
  // threshold intact for everything else.
  const laneCheck = qualifiesForTrustedRumourAutoLane(story, score);
  if (laneCheck.qualifies) {
    score.decision = "auto";
    score.auto_lane_reason = laneCheck.reason;
    // Persist the audit trail in the JSON `inputs` column so future
    // digests can explain why a sub-75 story was auto-approved.
    score.inputs = {
      ...(score.inputs || {}),
      auto_lane_reason: laneCheck.reason,
    };
  }

  score.channel_id = channelId;
  score.scorer_version = scorerVersion;
  score.decision_reason = summariseDecision(score);

  recordScore(story.id, channelId, score, { repos });
  return score;
}

function summariseDecision(score) {
  if (score.hard_stops.length) {
    return `hard_stop:${score.hard_stops.join(",")}`;
  }
  if (score.auto_lane_reason) {
    return `auto_lane total=${score.total} (${score.auto_lane_reason})`;
  }
  const top = Object.entries(score.breakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `total=${score.total} ${top}`;
}

/**
 * Flip the stories table according to the decision. We're careful to
 * never *un*-approve a story a human already manually approved — if
 * approved_by_human is set we leave it alone.
 */
function applyDecision(story, score, repos) {
  const db = repos.db;
  switch (score.decision) {
    case "auto":
      db.prepare(
        `UPDATE stories
           SET approved = 1,
               auto_approved = 1,
               approved_at = COALESCE(approved_at, datetime('now')),
               updated_at = datetime('now')
         WHERE id = ?`,
      ).run(story.id);
      return "approved";
    case "review":
      // Queue for human review — don't auto-approve, don't reject.
      db.prepare(
        `UPDATE stories
           SET auto_approved = 0,
               updated_at = datetime('now')
         WHERE id = ?`,
      ).run(story.id);
      return "queued_for_review";
    case "defer":
      // Nothing to do — the score row itself is the state. Next pass
      // in a few hours will re-score and the decision may strengthen.
      return "deferred";
    case "reject":
    default:
      db.prepare(
        `UPDATE stories
           SET auto_approved = 0,
               updated_at = datetime('now')
         WHERE id = ?`,
      ).run(story.id);
      return "rejected";
  }
}

/**
 * Main entry point — score every candidate in the current window,
 * persist the decisions, and return a summary. Safe to call on a cron.
 *
 * Options:
 *   channelId       scope auto-approval to one channel (optional)
 *   ageHours        override the "last N hours" candidate window
 *   dryRun          skip applying decisions (just record scores)
 *   log             logger (defaults to console)
 */
function runScoringPass({
  repos,
  channelId = process.env.CHANNEL || null,
  ageHours = DEFAULT_BATCH_AGE_HOURS,
  dryRun = false,
  log = console,
} = {}) {
  if (!repos) repos = require("./repositories").getRepos();

  const candidates = pickCandidates(repos, { ageHours });
  if (!candidates.length) {
    log.log("[decision-engine] no candidates to score");
    return { scored: 0, approved: 0, review: 0, defer: 0, reject: 0 };
  }

  const recentStories = fetchRecentStories(repos);
  const counters = {
    scored: 0,
    approved: 0,
    review: 0,
    defer: 0,
    reject: 0,
    hardStopped: 0,
  };

  for (const story of candidates) {
    try {
      const score = scoreOne(story, {
        repos,
        channelId,
        recentStories,
      });
      counters.scored++;
      if (score.hard_stops.length) counters.hardStopped++;

      if (!dryRun) {
        const effect = applyDecision(story, score, repos);
        if (effect === "approved") counters.approved++;
        else if (effect === "queued_for_review") counters.review++;
        else if (effect === "deferred") counters.defer++;
        else counters.reject++;
      }

      log.log(
        `[decision-engine] ${story.id.slice(0, 12)} ${score.decision.padEnd(6)} ` +
          `total=${score.total} ${score.hard_stops.length ? `stops=${score.hard_stops.join(",")}` : ""} ` +
          `"${(story.title || "").slice(0, 60)}"`,
      );
    } catch (err) {
      log.error(`[decision-engine] failed on ${story.id}: ${err.message}`);
    }
  }

  log.log(
    `[decision-engine] pass complete: scored=${counters.scored} ` +
      `auto=${counters.approved} review=${counters.review} ` +
      `defer=${counters.defer} reject=${counters.reject} ` +
      `hard_stops=${counters.hardStopped}`,
  );
  return counters;
}

module.exports = {
  runScoringPass,
  scoreOne,
  pickCandidates,
  fetchRecentStories,
  publishedPlatformsFor,
  applyDecision,
  DEFAULT_BATCH_AGE_HOURS,
  DEFAULT_RECENCY_HOURS,
  SCORER_VERSION,
};
