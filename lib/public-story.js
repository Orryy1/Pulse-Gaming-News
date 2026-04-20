/**
 * lib/public-story.js — shape the public `/api/news` response so the
 * unauthenticated endpoint can't leak internal editorial state.
 *
 * The full story object is the authoritative internal record — it
 * includes `full_script`, `tts_script`, `hook`, `body`, `pinned_comment`,
 * scoring internals (`breaking_score`, `classification`,
 * `content_pillar`), candidate image prompts, on-disk file paths
 * (`audio_path`, `image_path`, `exported_path`, `downloaded_images[].path`),
 * Reddit comments (usernames = PII), internal post IDs per platform,
 * view counters, and approval/error bookkeeping. None of that belongs
 * on a public endpoint before the video is actually live.
 *
 * This module is the single source of truth for what IS safe to
 * expose. Anything not explicitly listed in `PUBLIC_FIELDS` is
 * dropped. Adding a new public field is a deliberate, reviewable
 * edit here — whitelisting is the point.
 *
 * A second invariant: only stories that are actually LIVE (the video
 * has published) are emitted. Draft/queue/failure state is internal
 * workflow and must not leak via the public endpoint at all.
 */

// Every field we're willing to expose unauthenticated. Keep this
// list tiny. New additions must be either:
//   (a) already public via the source article / YouTube URL, or
//   (b) non-editorial, non-PII metadata.
const PUBLIC_FIELDS = [
  "id",
  "title",
  "timestamp", // when the source story was posted
  "published_at", // when our video went live
  "flair", // editorial classification LABEL (Verified / Breaking) only
  "source_type", // "reddit" | "rss"
  "subreddit", // public Reddit info
  "url", // original source article URL (already public)
  "youtube_url", // our published Shorts URL
  "article_image", // source article's og:image (already public)
  "company_name",
  "num_comments", // Reddit comment count (already public)
  "score", // Reddit upvotes (already public)
];

/**
 * Decide whether a story is "live enough" to appear on the public
 * endpoint. We err on the side of hiding — a story shows publicly
 * only once a YouTube URL exists (the primary public surface) AND
 * the publish_status is either "published" or explicitly set.
 *
 * Stories that are:
 *   - approved but not yet exported
 *   - produced but not yet uploaded
 *   - partially published (e.g. YT up, TikTok pending)
 * are all hidden. Once YT is live, the surrounding metadata (title,
 * source URL, og:image) is already public elsewhere, so exposing
 * that subset is not new information.
 *
 * @param {any} story
 */
function isPubliclyVisible(story) {
  if (!story || typeof story !== "object") return false;
  // A YouTube post id is the strongest "this went live" signal we
  // have. Without it, treat the story as internal workflow regardless
  // of any other field.
  if (!story.youtube_post_id && !story.youtube_url) return false;
  // Belt and braces: respect the publish_status bookkeeping.
  const status = story.publish_status;
  if (status && status !== "published" && status !== "partial") return false;
  return true;
}

/**
 * Whitelist-copy a story into the shape the public endpoint returns.
 * Never modifies the input. Unknown/unexpected fields are always
 * dropped — there is no spread, no pass-through escape hatch.
 *
 * @param {any} story
 * @returns {Record<string, unknown>}
 */
function sanitizeStoryForPublic(story) {
  if (!story || typeof story !== "object") return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of PUBLIC_FIELDS) {
    const v = story[key];
    if (v === undefined || v === null) continue;
    // Defensive: never copy a function, symbol, or nested object in
    // for these fields. They're all flat primitives (string / number).
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Map an array of internal stories into the public shape. Filters
 * out anything that isn't publicly visible. Returns a new array;
 * never mutates the input.
 *
 * @param {any[]} stories
 */
function sanitizeStoriesForPublic(stories) {
  if (!Array.isArray(stories)) return [];
  const out = [];
  for (const s of stories) {
    if (!isPubliclyVisible(s)) continue;
    const safe = sanitizeStoryForPublic(s);
    if (safe) out.push(safe);
  }
  return out;
}

module.exports = {
  PUBLIC_FIELDS,
  isPubliclyVisible,
  sanitizeStoryForPublic,
  sanitizeStoriesForPublic,
};
