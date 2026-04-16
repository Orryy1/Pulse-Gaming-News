/**
 * derivatives repository.
 *
 * One row per repurposed asset. Source is either a roundup (source_kind
 * + source_id) or a single story (source_kind='story' + source_story_id).
 * Kinds: teaser_short | community_post | blog_post | story_short.
 */

function bind(db) {
  const upsert = db.prepare(`
    INSERT INTO derivatives
      (source_kind, source_id, source_story_id, kind, channel_id,
       status, script, asset_path, external_id, external_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(source_kind, source_id, kind, channel_id) DO UPDATE SET
      script = COALESCE(excluded.script, derivatives.script),
      asset_path = COALESCE(excluded.asset_path, derivatives.asset_path),
      external_id = COALESCE(excluded.external_id, derivatives.external_id),
      external_url = COALESCE(excluded.external_url, derivatives.external_url),
      status = excluded.status,
      updated_at = datetime('now')
    RETURNING *
  `);
  const markFailed = db.prepare(`
    UPDATE derivatives
    SET status = 'failed', error_message = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  const markPublished = db.prepare(`
    UPDATE derivatives
    SET status = 'published',
        external_id = COALESCE(?, external_id),
        external_url = COALESCE(?, external_url),
        published_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `);
  const listBySource = db.prepare(`
    SELECT * FROM derivatives WHERE source_kind = ? AND source_id = ?
  `);
  const getOne = db.prepare(`SELECT * FROM derivatives WHERE id = ?`);

  return {
    upsert(derivative) {
      return upsert.get(
        derivative.source_kind,
        derivative.source_id,
        derivative.source_story_id || null,
        derivative.kind,
        derivative.channel_id,
        derivative.status || "pending",
        derivative.script || null,
        derivative.asset_path || null,
        derivative.external_id || null,
        derivative.external_url || null,
      );
    },
    markFailed(id, errorMessage) {
      markFailed.run(errorMessage || "failed", id);
    },
    markPublished(id, { externalId, externalUrl }) {
      markPublished.run(externalId || null, externalUrl || null, id);
    },
    listBySource(kind, id) {
      return listBySource.all(kind, id);
    },
    get(id) {
      return getOne.get(id);
    },
  };
}

module.exports = { bind };
