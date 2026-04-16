/**
 * stories repository.
 *
 * Thin wrapper around the richer legacy surface in lib/db.js. New code
 * should go through here so the hot queries all flow through prepared
 * statements and the legacy JSON fallback stays out of the non-fallback
 * path. For bulk ops and legacy-shape reads, lib/db.js remains the
 * single source of truth.
 */

function bind(db) {
  const getById = db.prepare(`SELECT * FROM stories WHERE id = ?`);
  const listApproved = db.prepare(`
    SELECT * FROM stories
    WHERE approved = 1 AND exported_path IS NOT NULL
    ORDER BY breaking_score DESC
  `);
  const listInWindow = db.prepare(`
    SELECT * FROM stories
    WHERE datetime(COALESCE(published_at, created_at)) >= datetime(?)
      AND datetime(COALESCE(published_at, created_at)) <= datetime(?)
      AND (channel_id IS NULL OR channel_id = COALESCE(?, channel_id))
    ORDER BY COALESCE(published_at, created_at) DESC
  `);
  const setApproved = db.prepare(`
    UPDATE stories
    SET approved = ?, auto_approved = ?, approved_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `);
  const setChannel = db.prepare(`
    UPDATE stories SET channel_id = ?, updated_at = datetime('now') WHERE id = ?
  `);
  const listByIds = (ids) => {
    if (!ids.length) return [];
    const placeholders = ids.map(() => "?").join(",");
    return db
      .prepare(`SELECT * FROM stories WHERE id IN (${placeholders})`)
      .all(...ids);
  };

  return {
    get(id) {
      return getById.get(id);
    },
    listApproved() {
      return listApproved.all();
    },
    /**
     * Returns stories whose published_at (or created_at fallback) falls
     * in [from, to]. Used by the roundup builder to pull a week of
     * content for scoring/slotting.
     */
    listInWindow(fromIso, toIso, { channelId = null } = {}) {
      return listInWindow.all(fromIso, toIso, channelId);
    },
    listByIds,
    setApproved(id, { auto = false } = {}) {
      setApproved.run(1, auto ? 1 : 0, id);
    },
    setChannel(id, channelId) {
      setChannel.run(channelId, id);
    },
  };
}

module.exports = { bind };
