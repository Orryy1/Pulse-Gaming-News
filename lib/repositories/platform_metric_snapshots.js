/**
 * lib/repositories/platform_metric_snapshots.js — thin repo around
 * the platform_metric_snapshots table introduced in migration 015.
 *
 * Contract:
 *   - recordSnapshot(row): inserts one row, returning the generated id.
 *     Every metric field is optional — pass whatever the upstream API
 *     returned, let the rest stay NULL. Validates only the required
 *     fields (story_id, platform) and safe-guards against rogue
 *     metric types that could poison the time series.
 *   - listForStory(storyId, opts?): most-recent-first list for a
 *     single story, with optional limit.
 *   - latestForStory(storyId, platform): the newest row for a
 *     (story, platform) pair, or null.
 *
 * No UPSERT. The point of this table is an append-only history;
 * upserting would collapse the time series and defeat the feedback
 * loop.
 */

const { resolveChannelId } = require("../channel-context");

const VALID_PLATFORMS = new Set([
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "twitter",
]);

function coerceInt(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function coerceFloat(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Insert a metric snapshot for a story/platform. Accepts a plain
 * object; never mutates it. Returns the row id on success.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} row
 *   { story_id, platform, external_id?, views?, likes?, comments?,
 *     shares?, watch_time_seconds?, retention_percent?, raw_json?,
 *     channel_id?, snapshot_at? }
 * @returns {number} rowid
 */
function recordSnapshot(db, row) {
  if (!row || typeof row !== "object") {
    throw new Error("platform_metric_snapshots: row must be an object");
  }
  if (typeof row.story_id !== "string" || row.story_id.length === 0) {
    throw new Error("platform_metric_snapshots: story_id required");
  }
  if (typeof row.platform !== "string" || !VALID_PLATFORMS.has(row.platform)) {
    throw new Error(
      `platform_metric_snapshots: platform must be one of ${[...VALID_PLATFORMS].join(", ")}`,
    );
  }

  // raw_json must be persisted as a string — accept objects as a
  // convenience and stringify here so callers don't have to
  // remember. Already-string values are preserved as-is.
  let rawJson = null;
  if (row.raw_json !== undefined && row.raw_json !== null) {
    if (typeof row.raw_json === "string") rawJson = row.raw_json;
    else {
      try {
        rawJson = JSON.stringify(row.raw_json);
      } catch {
        rawJson = null;
      }
    }
  }

  const stmt = db.prepare(`
    INSERT INTO platform_metric_snapshots
      (story_id, platform, external_id, snapshot_at, channel_id,
       views, likes, comments, shares,
       watch_time_seconds, retention_percent, raw_json)
    VALUES
      (@story_id, @platform, @external_id,
       COALESCE(@snapshot_at, datetime('now')),
       @channel_id,
       @views, @likes, @comments, @shares,
       @watch_time_seconds, @retention_percent, @raw_json)
  `);
  const info = stmt.run({
    story_id: row.story_id,
    platform: row.platform,
    external_id: typeof row.external_id === "string" ? row.external_id : null,
    snapshot_at: typeof row.snapshot_at === "string" ? row.snapshot_at : null,
    channel_id: resolveChannelId(row.channel_id),
    views: coerceInt(row.views),
    likes: coerceInt(row.likes),
    comments: coerceInt(row.comments),
    shares: coerceInt(row.shares),
    watch_time_seconds: coerceFloat(row.watch_time_seconds),
    retention_percent: coerceFloat(row.retention_percent),
    raw_json: rawJson,
  });
  return Number(info.lastInsertRowid);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} storyId
 * @param {{limit?: number, platform?: string}} [opts]
 */
function listForStory(db, storyId, opts = {}) {
  const params = [storyId];
  let sql = `
    SELECT * FROM platform_metric_snapshots
    WHERE story_id = ?
  `;
  if (opts.platform && VALID_PLATFORMS.has(opts.platform)) {
    sql += ` AND platform = ?`;
    params.push(opts.platform);
  }
  sql += ` ORDER BY snapshot_at DESC, id DESC`;
  if (typeof opts.limit === "number" && opts.limit > 0) {
    sql += ` LIMIT ${Math.trunc(opts.limit)}`;
  }
  return db.prepare(sql).all(...params);
}

/**
 * Latest snapshot for a specific (story, platform). Useful for
 * delta computation in the analytics digest.
 */
function latestForStory(db, storyId, platform) {
  if (!VALID_PLATFORMS.has(platform)) return null;
  const row = db
    .prepare(
      `SELECT * FROM platform_metric_snapshots
        WHERE story_id = ? AND platform = ?
        ORDER BY snapshot_at DESC, id DESC
        LIMIT 1`,
    )
    .get(storyId, platform);
  return row || null;
}

module.exports = {
  recordSnapshot,
  listForStory,
  latestForStory,
  VALID_PLATFORMS,
};
