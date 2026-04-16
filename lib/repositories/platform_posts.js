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
   * the row. If it already exists, returns the existing row unchanged.
   * Used by uploaders before they attempt an upload — the row becomes
   * their transactional anchor.
   */
  function ensurePending(
    storyId,
    platform,
    { channelId = null, idempotencyKey = null } = {},
  ) {
    const existing = getByStoryPlatform.get(storyId, platform);
    if (existing) return existing;

    if (idempotencyKey) {
      const dup = findByIdempotency.get(idempotencyKey);
      if (dup) return dup;
    }

    const info = insert.run(
      storyId,
      channelId,
      platform,
      null,
      null,
      "pending",
      null,
      null,
      idempotencyKey,
      0,
      0,
      0,
      0,
      null,
      null,
    );
    return db
      .prepare(`SELECT * FROM platform_posts WHERE id = ?`)
      .get(info.lastInsertRowid);
  }

  function markPublished(id, { externalId, externalUrl }) {
    updateStatus.run({
      id,
      status: "published",
      externalId,
      externalUrl: externalUrl || null,
      blockReason: null,
      errorMessage: null,
    });
  }

  function markBlocked(id, reason) {
    updateStatus.run({
      id,
      status: "blocked",
      externalId: null,
      externalUrl: null,
      blockReason: reason || "blocked",
      errorMessage: null,
    });
  }

  function markFailed(id, error) {
    updateStatus.run({
      id,
      status: "failed",
      externalId: null,
      externalUrl: null,
      blockReason: null,
      errorMessage:
        (error && error.message) ||
        (typeof error === "string" ? error : "failed"),
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
    markPublished,
    markBlocked,
    markFailed,
    recordStats,
    getByStoryPlatform(storyId, platform) {
      return getByStoryPlatform.get(storyId, platform);
    },
    listByStory(storyId) {
      return listByStory.all(storyId);
    },
    getLegacyShape,
  };
}

module.exports = { bind, PLATFORMS };
