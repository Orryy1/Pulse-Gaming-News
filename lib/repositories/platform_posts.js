/**
 * platform_posts repository.
 *
 * New code should write publications through here instead of the
 * denormalised `<platform>_post_id` columns on stories. The unique
 * index on (story_id, platform) WHERE status='published' is the
 * DB-level guard against the IG duplicate bug we just fixed in publisher.js.
 *
 * Backwards compatibility: `getLegacyShape(storyId)` returns the platform
 * rows collapsed back into the old story-column layout so callers reading
 * through stories.* don't regress.
 */

const PLATFORMS = [
  "youtube",
  "tiktok",
  "instagram_reel",
  "instagram_story",
  "facebook_reel",
  "facebook_story",
  "twitter_video",
  "twitter_image",
];

function bind(db) {
  const insert = db.prepare(`
    INSERT INTO platform_posts
      (story_id, channel_id, platform, external_id, external_url,
       status, block_reason, error_message, idempotency_key,
       views, likes, comments, shares,
       stats_fetched_at, published_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const getByStoryPlatform = db.prepare(`
    SELECT * FROM platform_posts
    WHERE story_id = ? AND platform = ?
    ORDER BY id DESC LIMIT 1
  `);
  const getById = db.prepare(`
    SELECT * FROM platform_posts WHERE id = ?
  `);
  const listByStory = db.prepare(`
    SELECT * FROM platform_posts WHERE story_id = ? ORDER BY platform, id
  `);
  const updateStatus = db.prepare(`
    UPDATE platform_posts
    SET status = @status,
        external_id = COALESCE(@externalId, external_id),
        external_url = COALESCE(@externalUrl, external_url),
        block_reason = COALESCE(@blockReason, block_reason),
        error_message = COALESCE(@errorMessage, error_message),
        published_at = CASE WHEN @status = 'published' AND published_at IS NULL
                            THEN datetime('now') ELSE published_at END,
        updated_at = datetime('now')
    WHERE id = @id
      AND status <> 'published'
  `);
  const publish = db.prepare(`
    UPDATE platform_posts
    SET status = 'published',
        external_id = COALESCE(external_id, @externalId),
        external_url = COALESCE(external_url, @externalUrl),
        block_reason = NULL,
        error_message = NULL,
        published_at = COALESCE(published_at, datetime('now')),
        updated_at = datetime('now')
    WHERE id = @id
      AND (external_id IS NULL OR external_id = @externalId)
  `);
  const anchorObject = db.prepare(`
    UPDATE platform_posts
    SET status = 'uploading',
        external_id = COALESCE(external_id, @externalId),
        external_url = COALESCE(external_url, @externalUrl),
        block_reason = NULL,
        error_message = NULL,
        updated_at = datetime('now')
    WHERE id = @id
      AND status <> 'published'
      AND (external_id IS NULL OR external_id = @externalId)
  `);
  const updateStats = db.prepare(`
    UPDATE platform_posts
    SET views = @views,
        likes = @likes,
        comments = @comments,
        shares = @shares,
        stats_fetched_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = @id
  `);
  const findByIdempotency = db.prepare(`
    SELECT * FROM platform_posts WHERE idempotency_key = ?
  `);

  /**
   * Ensure a platform_posts row exists for (storyId, platform). Returns
   * the row. Exact retries return the existing row unchanged. A new keyed
   * attempt is allowed only after a failed row with no remote identity.
   * Used by uploaders before they attempt an upload — the row becomes
   * their transactional anchor.
   */
  function ensurePending(
    storyId,
    platform,
    { channelId = null, idempotencyKey = null } = {},
  ) {
    const normalisedStoryId = String(storyId || "").trim();
    const normalisedPlatform = String(platform || "").trim();
    const normalisedChannelId = channelId
      ? String(channelId).trim()
      : null;
    const normalisedKey = idempotencyKey
      ? String(idempotencyKey).trim()
      : null;
    if (!normalisedStoryId || !normalisedPlatform) {
      throw new Error("platform_post_story_and_platform_required");
    }
    const assertIdentity = (row) => {
      const conflict =
        row.story_id !== normalisedStoryId ||
        row.platform !== normalisedPlatform ||
        (normalisedChannelId !== null &&
          row.channel_id !== normalisedChannelId) ||
        (normalisedKey !== null &&
          row.idempotency_key !== normalisedKey);
      if (conflict) throw new Error("platform_post_idempotency_conflict");
      return row;
    };
    const transaction = db.transaction(() => {
      const existing = getByStoryPlatform.get(
        normalisedStoryId,
        normalisedPlatform,
      );
      if (existing) {
        const sameKey =
          normalisedKey === null ||
          existing.idempotency_key === normalisedKey;
        if (sameKey) return assertIdentity(existing);
        const canStartNewAttempt =
          normalisedKey !== null &&
          existing.status === "failed" &&
          !String(existing.external_id || "").trim() &&
          !String(existing.external_url || "").trim() &&
          existing.channel_id === normalisedChannelId;
        if (!canStartNewAttempt) return assertIdentity(existing);
      }

      if (normalisedKey) {
        const duplicate = findByIdempotency.get(normalisedKey);
        if (duplicate) return assertIdentity(duplicate);
      }

      const info = insert.run(
        normalisedStoryId,
        normalisedChannelId,
        normalisedPlatform,
        null,
        null,
        "pending",
        null,
        null,
        normalisedKey,
        0,
        0,
        0,
        0,
        null,
        null,
      );
      return getById.get(info.lastInsertRowid);
    });
    return transaction.immediate();
  }

  function markPublished(id, { externalId, externalUrl }) {
    const normalisedExternalId = String(externalId || "").trim() || null;
    const normalisedExternalUrl =
      String(externalUrl || "").trim() || null;
    const transaction = db.transaction(() => {
      const current = getById.get(id);
      if (!current) return null;
      const finalExternalId =
        normalisedExternalId || String(current.external_id || "").trim();
      if (!finalExternalId) {
        throw new Error("published_platform_external_id_required");
      }
      if (
        current.external_id &&
        normalisedExternalId &&
        current.external_id !== normalisedExternalId
      ) {
        throw new Error("published_platform_identity_conflict");
      }
      const result = publish.run({
        id,
        externalId: finalExternalId,
        externalUrl: current.external_url ? null : normalisedExternalUrl,
      });
      if (result.changes === 0) {
        const latest = getById.get(id);
        if (
          latest &&
          String(latest.external_id || "").trim() !== finalExternalId
        ) {
          throw new Error("published_platform_identity_conflict");
        }
        return latest || null;
      }
      return getById.get(id) || null;
    });
    return transaction.immediate();
  }

  function anchorExternalObject(id, { externalId, externalUrl = null } = {}) {
    const normalisedExternalId = String(externalId || "").trim();
    const normalisedExternalUrl =
      String(externalUrl || "").trim() || null;
    if (!normalisedExternalId) {
      throw new Error("platform_object_external_id_required");
    }
    const transaction = db.transaction(() => {
      const current = getById.get(id);
      if (!current) return null;
      if (
        current.external_id &&
        current.external_id !== normalisedExternalId
      ) {
        throw new Error("platform_object_identity_conflict");
      }
      if (current.status === "published") return current;
      const result = anchorObject.run({
        id,
        externalId: normalisedExternalId,
        externalUrl: normalisedExternalUrl,
      });
      if (result.changes === 0) {
        const latest = getById.get(id);
        if (
          latest?.external_id &&
          latest.external_id !== normalisedExternalId
        ) {
          throw new Error("platform_object_identity_conflict");
        }
        return latest || null;
      }
      return getById.get(id) || null;
    });
    return transaction.immediate();
  }

  function markBlocked(id, reason) {
    const transaction = db.transaction(() => {
      const current = getById.get(id);
      if (!current) return null;
      if (current.status === "published") return current;
      updateStatus.run({
        id,
        status: "blocked",
        externalId: null,
        externalUrl: null,
        blockReason: reason || "blocked",
        errorMessage: null,
      });
      return getById.get(id) || null;
    });
    return transaction.immediate();
  }

  function markFailed(
    id,
    error,
    { externalId = null, externalUrl = null } = {},
  ) {
    const normalisedExternalId =
      String(externalId || "").trim() || null;
    const normalisedExternalUrl =
      String(externalUrl || "").trim() || null;
    const transaction = db.transaction(() => {
      const current = getById.get(id);
      if (!current) return null;
      if (
        current.external_id &&
        normalisedExternalId &&
        current.external_id !== normalisedExternalId
      ) {
        throw new Error("platform_object_identity_conflict");
      }
      if (current.status === "published") return current;
      updateStatus.run({
        id,
        status: "failed",
        externalId: current.external_id || normalisedExternalId,
        externalUrl: current.external_url || normalisedExternalUrl,
        blockReason: null,
        errorMessage:
          (error && error.message) ||
          (typeof error === "string" ? error : "failed"),
      });
      return getById.get(id) || null;
    });
    return transaction.immediate();
  }

  /**
   * Record that a platform upload was deliberately skipped rather
   * than attempted-and-failed. Used for optional platforms that
   * declined to run — e.g. Twitter/X when TWITTER_ENABLED !== 'true'.
   *
   * Distinct from `failed` (the upload was tried and errored) and
   * `blocked` (a dedupe / policy guard refused the attempt). Lets
   * the analytics digest and Discord summary render these as
   * "⏸ skipped" instead of either "❌ failed" or silently missing.
   *
   * @param {number} id
   * @param {string} [reason]   enum-style tag, never user input
   */
  function markSkipped(id, reason) {
    updateStatus.run({
      id,
      status: "skipped",
      externalId: null,
      externalUrl: null,
      blockReason: reason || "skipped",
      errorMessage: null,
    });
  }

  function recordStats(id, { views = 0, likes = 0, comments = 0, shares = 0 }) {
    updateStats.run({ id, views, likes, comments, shares });
  }

  /**
   * Collapse platform_posts rows back into the old story-column shape
   * for consumers that still read through stories.*. Returns an object
   * like { youtube_post_id, instagram_media_id, ... }.
   */
  function getLegacyShape(storyId) {
    const rows = listByStory.all(storyId);
    const shape = {};
    for (const r of rows) {
      // Skipped / blocked / failed rows must not leak into the
      // legacy story-column shape — only published (and the
      // historical DUPE_* sentinel IDs) count as "this platform
      // actually has a post".
      if (r.status === "skipped") continue;
      if (
        r.status !== "published" &&
        !(r.external_id || "").startsWith("DUPE_")
      )
        continue;
      switch (r.platform) {
        case "youtube":
          shape.youtube_post_id = r.external_id;
          shape.youtube_url = r.external_url;
          break;
        case "tiktok":
          shape.tiktok_post_id = r.external_id;
          break;
        case "instagram_reel":
          shape.instagram_media_id = r.external_id;
          break;
        case "instagram_story":
          shape.instagram_story_id = r.external_id;
          break;
        case "facebook_reel":
          shape.facebook_post_id = r.external_id;
          break;
        case "facebook_story":
          shape.facebook_story_id = r.external_id;
          break;
        case "twitter_video":
          shape.twitter_post_id = r.external_id;
          break;
        case "twitter_image":
          shape.twitter_image_tweet_id = r.external_id;
          break;
      }
    }
    return shape;
  }

  return {
    PLATFORMS,
    ensurePending,
    anchorExternalObject,
    markPublished,
    markBlocked,
    markFailed,
    markSkipped,
    recordStats,
    getByStoryPlatform(storyId, platform) {
      return getByStoryPlatform.get(storyId, platform);
    },
    getById(id) {
      return getById.get(id) || null;
    },
    listByStory(storyId) {
      return listByStory.all(storyId);
    },
    getLegacyShape,
  };
}

module.exports = { bind, PLATFORMS };
