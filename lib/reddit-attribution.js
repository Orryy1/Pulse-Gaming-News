"use strict";

/**
 * lib/reddit-attribution.js
 *
 * How a quoted Reddit comment is credited on screen.
 *
 * A Reddit username is personal data, and drawing it onto a published
 * video spreads it to every platform the video goes to. Nothing in the
 * docs needs the username on screen (STUDIO_V2_ARCHITECTURE.md attributes
 * quotes to the subreddit), so by default the overlay says "Reddit comment"
 * instead of `u/<username>`.
 *
 * REDDIT_USERNAMES_ON_VIDEO=true restores the old `u/<username>` handle.
 * Default: off. If you switch it on, update the privacy notice first
 * (factory/src/web/privacy.ts and lib/privacy-notice.js say videos do not
 * show Reddit usernames).
 */

const GENERIC_REDDIT_LABEL = "Reddit comment";

function redditUsernamesOnVideo(env = process.env) {
  return (
    String((env && env.REDDIT_USERNAMES_ON_VIDEO) || "")
      .trim()
      .toLowerCase() === "true"
  );
}

/**
 * The on-screen credit for a Reddit comment. `author` should already be
 * clipped/sanitised by the caller for its renderer; it is only used when
 * REDDIT_USERNAMES_ON_VIDEO=true.
 */
function redditCommentHandle(author, env = process.env) {
  if (!redditUsernamesOnVideo(env)) return GENERIC_REDDIT_LABEL;
  const name = String(author || "").trim() || "Redditor";
  return `u/${name}`;
}

module.exports = {
  GENERIC_REDDIT_LABEL,
  redditUsernamesOnVideo,
  redditCommentHandle,
};
