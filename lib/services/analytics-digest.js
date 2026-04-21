/**
 * lib/services/analytics-digest.js — builds the operator-facing
 * digest payload for GET /api/analytics/digest.
 *
 * Returns a list of the N most recently published stories, each
 * with the latest per-platform metrics and (when two snapshots
 * exist) a delta between the newest and the previous snapshot.
 * Nothing here is a feedback loop — it's a passive read surface
 * the operator uses to answer "how did yesterday's video do?"
 * without fishing through SQLite directly.
 *
 * No secret-bearing fields are emitted. raw_json from the snapshot
 * row is deliberately NOT included — it can contain platform-side
 * metadata (pagination cursors, internal ids) that has no place in
 * a public dashboard surface.
 */

const DEFAULT_LIMIT = 10;
const PLATFORMS = ["youtube", "tiktok", "instagram", "facebook"];

function pickPublishedStories(stories, limit) {
  const eligible = [];
  for (const s of stories) {
    if (!s || typeof s !== "object") continue;
    const anyPlatformId =
      s.youtube_post_id ||
      s.tiktok_post_id ||
      s.instagram_media_id ||
      s.facebook_post_id;
    if (!anyPlatformId) continue;
    eligible.push(s);
  }
  eligible.sort((a, b) => {
    const ap = a.published_at || a.youtube_published_at || a.timestamp || "";
    const bp = b.published_at || b.youtube_published_at || b.timestamp || "";
    return bp.localeCompare(ap);
  });
  return eligible.slice(0, limit);
}

function computeDelta(latest, previous) {
  if (!latest || !previous) return null;
  const delta = {};
  for (const k of ["views", "likes", "comments", "shares"]) {
    if (typeof latest[k] === "number" && typeof previous[k] === "number") {
      delta[k] = latest[k] - previous[k];
    }
  }
  if (Object.keys(delta).length === 0) return null;
  // Spread the time window too so the operator can read "+500
  // views in the last 6h" rather than just the raw number.
  delta.window_from = previous.snapshot_at || null;
  delta.window_to = latest.snapshot_at || null;
  return delta;
}

function sanitiseMetricRow(row) {
  if (!row) return null;
  return {
    snapshot_at: row.snapshot_at,
    external_id: row.external_id || null,
    views: row.views == null ? null : row.views,
    likes: row.likes == null ? null : row.likes,
    comments: row.comments == null ? null : row.comments,
    shares: row.shares == null ? null : row.shares,
    watch_time_seconds:
      row.watch_time_seconds == null ? null : row.watch_time_seconds,
    retention_percent:
      row.retention_percent == null ? null : row.retention_percent,
  };
}

/**
 * Build the digest payload.
 *
 * @param {object} opts
 * @param {any[]} opts.stories       — list from db.getStories()
 * @param {object} opts.pmsRepo      — repo module with
 *                                     listForStory(db, storyId, {platform, limit})
 * @param {import('better-sqlite3').Database} opts.dbHandle
 * @param {number} [opts.limit]
 */
function buildAnalyticsDigest({ stories, pmsRepo, dbHandle, limit }) {
  const n = typeof limit === "number" && limit > 0 ? limit : DEFAULT_LIMIT;
  const published = pickPublishedStories(stories || [], n);

  const items = published.map((story) => {
    /** @type {Record<string, unknown>} */
    const entry = {
      id: story.id,
      title: story.title,
      flair: story.flair || null,
      classification: story.classification || null,
      content_pillar: story.content_pillar || null,
      published_at: story.published_at || story.youtube_published_at || null,
      youtube_url: story.youtube_url || null,
      channel_id: story.channel_id || "pulse-gaming",
      platforms: {},
    };
    if (dbHandle && pmsRepo && typeof pmsRepo.listForStory === "function") {
      for (const platform of PLATFORMS) {
        let latest = null;
        let previous = null;
        try {
          const rows = pmsRepo.listForStory(dbHandle, story.id, {
            platform,
            limit: 2,
          });
          latest = rows[0] || null;
          previous = rows[1] || null;
        } catch {
          /* repo error — leave latest/previous null */
        }
        if (!latest) continue;
        entry.platforms[platform] = {
          latest: sanitiseMetricRow(latest),
          delta: computeDelta(latest, previous),
        };
      }
    }
    return entry;
  });

  return {
    generated_at: new Date().toISOString(),
    limit: n,
    count: items.length,
    items,
  };
}

module.exports = {
  buildAnalyticsDigest,
  computeDelta,
  sanitiseMetricRow,
  pickPublishedStories,
  DEFAULT_LIMIT,
};
