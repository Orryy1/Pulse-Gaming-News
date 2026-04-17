/**
 * lib/services/publish-dedupe.js — canonical publish-time duplicate
 * detection, built on platform_posts + URL-canonical hashing.
 *
 * Replaces the per-platform ad-hoc Jaccard title scans in publisher.js
 * that were proven unsafe by the 17 April 2026 Pragmata incident (same
 * article re-hunted with slightly different title, IG re-posted because
 * the word-overlap score dipped below 0.5 between the two headlines).
 *
 * Single decision point. Callers pass (storyId, platform, ...), receive
 * one of:
 *
 *   { decision: "publish",          reason: null,            existing: null }
 *   { decision: "already_published", reason: "<post-id>",    existing: row }
 *   { decision: "block_dupe",       reason: "<why>",         existing: row }
 *
 * Decision order:
 *   1. EXACT match: is there ALREADY a platform_posts row for this
 *      (story_id, platform) with status='published'? → already_published.
 *      This is the DB-indexed equivalent of the old
 *      `if (story.youtube_post_id) { ... }` short-circuit.
 *
 *   2. URL-HASH match: is there any OTHER story with the same
 *      canonical-URL hash that has a published platform_posts row on
 *      the target platform? → block_dupe, reason="url-hash".
 *      This is the new layer that catches the Pragmata pattern: same
 *      article re-hunted under a new story_id.
 *
 *   3. TITLE-SIMILARITY fallback: only when the incoming story has no
 *      canonical URL hash (malformed/missing URL). Uses the legacy
 *      Jaccard scan to maintain at least as much protection as we had
 *      before. → block_dupe, reason="title-jaccard".
 *
 *   4. No match → publish.
 *
 * This module is pure business logic — no DB binding, no HTTP calls.
 * Callers pass in the repos object and the incoming story's metadata.
 */

const { canonicalHash } = require("./url-canonical");

const DEFAULT_TITLE_JACCARD_THRESHOLD = 0.5;

/**
 * Compute Jaccard word-overlap between two title strings. Kept as a
 * fallback only — prefer canonicalHash dedup whenever a URL is present.
 */
function titleJaccard(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(String(a).toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(String(b).toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let inter = 0;
  for (const w of wordsA) if (wordsB.has(w)) inter += 1;
  const unionSize = wordsA.size + wordsB.size - inter;
  return unionSize === 0 ? 0 : inter / unionSize;
}

/**
 * Canonicalise a story's URL identity. Accepts the raw story record
 * and returns the canonical hash (or 'invalid-url' when URL missing /
 * unparseable). The caller uses that hash to look up cross-story dupes.
 */
function storyUrlHash(story) {
  // Most Pulse Gaming stories carry a `url` field (Reddit self-url or
  // RSS article link). Older rows may have only `source_url`.
  return canonicalHash(story.url || story.source_url || "");
}

/**
 * Core decision. Returns one of:
 *   { decision: "publish", reason: null, existing: null }
 *   { decision: "already_published", reason: externalId, existing: row }
 *   { decision: "block_dupe", reason: "url-hash" | "title-jaccard",
 *     existing: row }
 *
 * Arguments:
 *   story                  — full story record (id, title, url required)
 *   platform               — "youtube" | "instagram_reel" | ...
 *                            (see lib/repositories/platform_posts.js PLATFORMS)
 *   repos                  — bound repos from getRepos() (needs `db`,
 *                            `platformPosts`, `stories`)
 *   options                — optional:
 *       titleJaccardThreshold  override default 0.5
 *       legacyStoriesArray     array of story objects for the legacy
 *                              in-memory fallback path (lets us migrate
 *                              publisher.js one platform at a time
 *                              without dropping its current behaviour)
 */
function decidePublish(story, platform, repos, options = {}) {
  if (!story || !story.id) {
    throw new Error("[publish-dedupe] story.id required");
  }
  if (!platform) throw new Error("[publish-dedupe] platform required");
  if (!repos || !repos.platformPosts) {
    throw new Error("[publish-dedupe] repos.platformPosts required");
  }

  const {
    titleJaccardThreshold = DEFAULT_TITLE_JACCARD_THRESHOLD,
    legacyStoriesArray = null,
  } = options;

  // 1. Exact (story_id, platform) already-published check.
  const existingRow = repos.platformPosts.getByStoryPlatform(
    story.id,
    platform,
  );
  if (
    existingRow &&
    existingRow.status === "published" &&
    existingRow.external_id
  ) {
    return {
      decision: "already_published",
      reason: existingRow.external_id,
      existing: existingRow,
    };
  }

  // 2. URL-hash cross-story check. Only meaningful when we got a real
  //    URL from the hunt. A sentinel 'invalid-url' hash is not used to
  //    block anything — it just falls through to the title fallback.
  const urlHash = storyUrlHash(story);
  if (urlHash && urlHash !== "invalid-url" && repos.db) {
    // better-sqlite3 validates SQL at prepare() time, so fresh DBs that
    // haven't run migration 011 (source_url_hash column) will throw on
    // the prepare call, not on .get(). Wrap the whole block so Phase 2A
    // is safe to deploy BEFORE the migration lands. On column-missing
    // we silently fall through to title-jaccard.
    let urlMatch = null;
    try {
      const stmt = repos.db.prepare(`
        SELECT pp.*, s.id AS story_id_ref, s.title AS story_title
        FROM platform_posts pp
        JOIN stories s ON s.id = pp.story_id
        WHERE pp.platform = ?
          AND pp.status = 'published'
          AND pp.external_id IS NOT NULL
          AND s.id != ?
          AND s.source_url_hash = ?
        ORDER BY pp.published_at DESC
        LIMIT 1
      `);
      urlMatch = stmt.get(platform, story.id, urlHash);
    } catch (err) {
      if (!/no such column/i.test(err.message)) throw err;
    }
    if (urlMatch) {
      return {
        decision: "block_dupe",
        reason: "url-hash",
        existing: urlMatch,
      };
    }
  }

  // 3. Title-similarity fallback. Two legal sources:
  //    (a) legacy in-memory array for callers mid-migration, OR
  //    (b) platform_posts JOIN stories for recent same-platform rows.
  //    We use whichever is passed. Threshold 0.5 keeps legacy behaviour.
  if (Array.isArray(legacyStoriesArray) && story.title) {
    const match = legacyStoriesArray.find((s) => {
      if (!s || s.id === story.id) return false;
      if (!platformIdPresent(s, platform)) return false;
      return titleJaccard(s.title, story.title) > titleJaccardThreshold;
    });
    if (match) {
      return {
        decision: "block_dupe",
        reason: "title-jaccard",
        existing: { story_id: match.id, story_title: match.title },
      };
    }
  }

  // 4. No match.
  return { decision: "publish", reason: null, existing: null };
}

/**
 * Returns true iff the legacy story row has a real platform id for the
 * given platform. Post-migration-013 the denormalised columns on stories
 * never contain sentinel strings — blocked/skipped state is a
 * platform_posts(status='blocked') row with external_id=NULL instead —
 * so a simple truthy check is sufficient.
 */
function platformIdPresent(s, platform) {
  switch (platform) {
    case "youtube":
      return !!s.youtube_post_id;
    case "tiktok":
      return !!s.tiktok_post_id;
    case "instagram_reel":
    case "instagram":
      return !!s.instagram_media_id;
    case "facebook_reel":
    case "facebook":
      return !!s.facebook_post_id;
    case "twitter_video":
    case "twitter":
      return !!s.twitter_post_id;
    default:
      return false;
  }
}

module.exports = {
  decidePublish,
  storyUrlHash,
  titleJaccard,
  DEFAULT_TITLE_JACCARD_THRESHOLD,
};
