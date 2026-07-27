"use strict";

function text(value) {
  return String(value || "").trim();
}

function youtubeExternalIdFromUrl(value) {
  const source = text(value);
  if (!source) return null;
  try {
    const parsed = new URL(source);
    const hostname = parsed.hostname.toLowerCase();
    const segments = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (hostname === "youtu.be") return segments[0] || null;
    if (
      hostname !== "youtube.com" &&
      !hostname.endsWith(".youtube.com")
    ) {
      return null;
    }
    const queryId = text(parsed.searchParams.get("v"));
    if (queryId) return queryId;
    if (
      ["shorts", "embed", "live"].includes(
        String(segments[0] || "").toLowerCase(),
      )
    ) {
      return segments[1] || null;
    }
    return null;
  } catch {
    return null;
  }
}

function youtubeStoryProjectionBlockers(story, externalId) {
  if (!story) return ["reconciliation_story_not_found"];
  const projectedExternalId = text(story.youtube_post_id);
  const expectedExternalId = text(externalId);
  if (
    projectedExternalId &&
    expectedExternalId &&
    projectedExternalId !== expectedExternalId
  ) {
    return ["story_youtube_identity_conflict"];
  }
  const urlExternalId = youtubeExternalIdFromUrl(story.youtube_url);
  if (
    urlExternalId &&
    expectedExternalId &&
    urlExternalId !== expectedExternalId
  ) {
    return ["story_youtube_url_identity_conflict"];
  }
  return [];
}

function getYoutubeStoryProjection(db, storyId) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("youtube_story_projection_database_required");
  }
  const normalisedStoryId = text(storyId);
  if (!normalisedStoryId) {
    throw new Error("youtube_story_projection_story_required");
  }
  return (
    db
      .prepare(
        `SELECT id, youtube_post_id, youtube_url, youtube_published_at,
                published_at, publish_status
         FROM stories
         WHERE id = ?`,
      )
      .get(normalisedStoryId) || null
  );
}

function inspectYoutubeStoryProjection({ db, storyId, externalId } = {}) {
  const story = getYoutubeStoryProjection(db, storyId);
  return {
    story,
    blockers: youtubeStoryProjectionBlockers(story, externalId),
  };
}

function projectYoutubeStoryPublication({
  db,
  storyId,
  externalId,
  externalUrl = null,
  publishedAt,
} = {}) {
  const normalisedStoryId = text(storyId);
  const normalisedExternalId = text(externalId);
  if (!normalisedExternalId) {
    throw new Error("youtube_story_projection_external_id_required");
  }
  const publishedDate = new Date(publishedAt);
  if (!publishedAt || Number.isNaN(publishedDate.getTime())) {
    throw new Error("youtube_story_projection_published_time_required");
  }
  const normalisedExternalUrl = text(externalUrl) || null;
  const suppliedUrlExternalId = youtubeExternalIdFromUrl(
    normalisedExternalUrl,
  );
  if (
    suppliedUrlExternalId &&
    suppliedUrlExternalId !== normalisedExternalId
  ) {
    throw new Error("youtube_story_projection_url_identity_mismatch");
  }
  const current = getYoutubeStoryProjection(db, normalisedStoryId);
  const blockers = youtubeStoryProjectionBlockers(
    current,
    normalisedExternalId,
  );
  if (blockers.length) {
    const error = new Error(blockers[0]);
    error.code = blockers[0];
    error.blockers = blockers;
    throw error;
  }
  const result = db
    .prepare(
      `UPDATE stories
       SET youtube_post_id = @externalId,
           youtube_url = COALESCE(@externalUrl, youtube_url),
           youtube_published_at = COALESCE(
             youtube_published_at,
             @publishedAt
           ),
           published_at = COALESCE(published_at, @publishedAt),
           publish_status = 'published',
           publish_error = NULL,
           updated_at = datetime('now')
       WHERE id = @storyId
         AND COALESCE(youtube_post_id, '') = @priorExternalId
         AND COALESCE(youtube_url, '') = @priorExternalUrl`,
    )
    .run({
      storyId: normalisedStoryId,
      externalId: normalisedExternalId,
      externalUrl: normalisedExternalUrl,
      publishedAt: publishedDate.toISOString(),
      priorExternalId: String(current.youtube_post_id || ""),
      priorExternalUrl: String(current.youtube_url || ""),
    });
  if (result.changes !== 1) {
    throw new Error("story_youtube_projection_conflict");
  }
  return getYoutubeStoryProjection(db, normalisedStoryId);
}

module.exports = {
  getYoutubeStoryProjection,
  inspectYoutubeStoryProjection,
  projectYoutubeStoryPublication,
  youtubeExternalIdFromUrl,
  youtubeStoryProjectionBlockers,
};
