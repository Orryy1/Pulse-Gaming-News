/**
 * lib/services/publish-block.js
 *
 * Structured replacement for the "DUPE_BLOCKED" / "DUPE_SKIPPED" sentinel
 * IDs that publisher.js historically wrote into the denormalised
 * story.<platform>_post_id columns. Those sentinels polluted the columns
 * (migration 010's comment explicitly forbids them) and forced every
 * reader to carry an `!== 'DUPE_BLOCKED'` filter.
 *
 * Under USE_SQLITE=true the canonical structured surface is platform_posts:
 *   (story_id, platform, status='blocked', block_reason) is the auditable
 *   record of "attempted and refused", and external_id stays NULL.
 *
 * This helper is deliberately tiny so it can be adopted one callsite at a
 * time without redesigning the whole publication flow. Non-SQLite dev is
 * not a production environment; when repos aren't available we return
 * persisted=false so the caller can decide whether to fall back to the
 * legacy sentinel write for local dev only.
 */

"use strict";

/**
 * Record a blocked platform publish. Writes a platform_posts row with
 * status='blocked' and block_reason=<reason>. Returns:
 *   { persisted: true,  id, platform }  on success
 *   { persisted: false, reason: string } when repos unavailable / SQLite off
 *
 * The operation is idempotent: calling twice for the same (storyId,
 * platform) updates the existing row instead of creating a duplicate.
 * ensurePending() plus markBlocked() on the platform_posts repo does
 * exactly that.
 *
 * Never throws on persistence failure — logs via the supplied logger
 * (defaults to console.log) and returns persisted=false. Callers that
 * must block on success should check the return value.
 */
function recordPlatformBlock({
  repos,
  storyId,
  platform,
  reason,
  channelId = null,
  log = console.log,
} = {}) {
  if (!storyId) throw new Error("[publish-block] storyId required");
  if (!platform) throw new Error("[publish-block] platform required");
  if (!repos || !repos.platformPosts) {
    return {
      persisted: false,
      reason: "repos_unavailable",
    };
  }
  try {
    const row = repos.platformPosts.ensurePending(storyId, platform, {
      channelId,
    });
    repos.platformPosts.markBlocked(row.id, reason || "blocked");
    return { persisted: true, id: row.id, platform };
  } catch (err) {
    log(
      `[publish-block] failed to record ${platform} block for ${storyId}: ${err.message}`,
    );
    return { persisted: false, reason: `error: ${err.message}` };
  }
}

/**
 * Fast check used by publisher's pre-upload guard: did this story already
 * hit a blocked/published state for this platform? Returns the row or
 * null. Callers should prefer this over grepping story.<platform>_post_id
 * for sentinel strings.
 */
function getPlatformStatus({ repos, storyId, platform } = {}) {
  if (!repos || !repos.platformPosts) return null;
  try {
    return repos.platformPosts.getByStoryPlatform(storyId, platform) || null;
  } catch {
    return null;
  }
}

module.exports = {
  recordPlatformBlock,
  getPlatformStatus,
};
