/**
 * lib/channel-context.js — single source of truth for "which
 * channel is this process (or request) acting on?"
 *
 * Today Pulse Gaming is the only live channel. Every legitimate
 * caller defaults to 'pulse-gaming'. This module exists so the
 * multi-channel rollout documented in
 * docs/channel-isolation-audit.md can thread a different value
 * through without touching each call site again.
 *
 * Resolution order (first non-empty wins):
 *   1. explicit arg passed by the caller
 *   2. process.env.CHANNEL
 *   3. "pulse-gaming" (the default)
 *
 * Intentionally NOT async. All callers are already sync when they
 * resolve the channel (storyToRow defaults, dashboard request
 * headers not yet wired, etc.), and keeping this pure + sync
 * means tests don't need any setup.
 */

const DEFAULT_CHANNEL_ID = "pulse-gaming";

/**
 * Resolve the channel id for a given caller context.
 *
 * @param {string|null|undefined} [explicit]  explicit override
 * @param {{env?: Record<string,string|undefined>}} [opts]
 *                                          env override for tests
 * @returns {string}                           never empty
 */
function resolveChannelId(explicit, opts = {}) {
  const env = opts.env || process.env;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit.trim();
  }
  if (typeof env.CHANNEL === "string" && env.CHANNEL.trim().length > 0) {
    return env.CHANNEL.trim();
  }
  return DEFAULT_CHANNEL_ID;
}

/**
 * Filter an array of stories down to a channel. Works with the
 * real channel_id column AND with legacy NULL rows — NULL rows
 * are treated as belonging to DEFAULT_CHANNEL_ID so no Pulse
 * content disappears until migration 014 has run.
 *
 * A truthy `explicit` overrides env; passing `null` returns the
 * unfiltered list (back-compat for the one callsite in /api/news
 * that legitimately wants to see everything across channels for
 * the public sanitiser).
 *
 * @param {any[]} stories
 * @param {string|null} [channelId]
 */
function filterStoriesByChannel(stories, channelId) {
  if (!Array.isArray(stories)) return [];
  if (channelId === null) return stories; // explicit "no filter"
  const target = resolveChannelId(channelId);
  return stories.filter((s) => {
    if (!s || typeof s !== "object") return false;
    const sc = s.channel_id == null ? DEFAULT_CHANNEL_ID : s.channel_id;
    return sc === target;
  });
}

module.exports = {
  DEFAULT_CHANNEL_ID,
  resolveChannelId,
  filterStoriesByChannel,
};
