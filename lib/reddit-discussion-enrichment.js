"use strict";

const { titleTopicOverlap } = require("./services/publish-dedupe");

const DEFAULT_MAX_DISCUSSION_AGE_HOURS = 72;
const DEFAULT_MIN_COMMENT_SCORE = 10;
const UNSAFE_REACTION_RE = /\b(?:kill yourself|kys|hate speech|nazi|slur)\b/i;
const URL_RE = /(?:https?:\/\/|www\.)\S+/i;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function discussionAgeHours(discussion, now = new Date()) {
  const timestamp = Date.parse(discussion?.timestamp || discussion?.created_at || discussion?.createdAt || "");
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now.getTime() - timestamp) / 3_600_000);
}

function findRelatedRedditDiscussion(
  story = {},
  candidates = [],
  { now = new Date(), maxAgeHours = DEFAULT_MAX_DISCUSSION_AGE_HOURS } = {},
) {
  const matches = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (String(candidate?.source_type || "").toLowerCase() !== "reddit") continue;
    if (!clean(candidate.id) || !clean(candidate.subreddit)) continue;
    const ageHours = discussionAgeHours(candidate, now);
    if (ageHours == null || ageHours > maxAgeHours) continue;
    const overlap = titleTopicOverlap(story.title, candidate.title);
    if (!overlap.match) continue;
    matches.push({ candidate, overlap, ageHours });
  }
  matches.sort((left, right) =>
    right.overlap.score - left.overlap.score ||
    right.overlap.shared.length - left.overlap.shared.length ||
    left.ageHours - right.ageHours,
  );
  return matches[0]?.candidate || null;
}

function sanitiseReactionBody(value) {
  const body = clean(value)
    .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`>#]+/g, "")
    .trim();
  if (body.length < 20 || URL_RE.test(body) || UNSAFE_REACTION_RE.test(body)) return "";
  const firstSentence = body.split(/(?<=[.!?])\s+/).find((sentence) => sentence.length >= 20) || body;
  return clean(firstSentence).slice(0, 180).trim();
}

function selectTopRedditReactions(comments = [], { minScore = DEFAULT_MIN_COMMENT_SCORE, limit = 3 } = {}) {
  return (Array.isArray(comments) ? comments : [])
    .map((comment) => ({
      body: sanitiseReactionBody(comment?.body),
      author: "Redditor",
      score: Number(comment?.score) || 0,
    }))
    .filter((comment) => comment.body && comment.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function enrichStoryWithRelatedRedditDiscussion({
  story = {},
  discussion = null,
  comments = [],
  now = new Date(),
  maxAgeHours = DEFAULT_MAX_DISCUSSION_AGE_HOURS,
} = {}) {
  const enriched = { ...story };
  if (!discussion || String(discussion.source_type || "").toLowerCase() !== "reddit") return enriched;
  const ageHours = discussionAgeHours(discussion, now);
  if (ageHours == null || ageHours > maxAgeHours) return enriched;
  const overlap = titleTopicOverlap(story.title, discussion.title);
  if (!overlap.match) return enriched;
  const reactions = selectTopRedditReactions(comments);
  if (!reactions.length) return enriched;

  if (story.comment_source_type === "rss_description" && clean(story.top_comment)) {
    enriched.rss_description = clean(story.rss_description || story.top_comment);
  }
  enriched.top_comment = reactions[0].body;
  enriched.top_comment_author = "Redditor";
  enriched.top_comment_score = reactions[0].score;
  enriched.reddit_comments = reactions;
  enriched.comment_source_type = "related_reddit_discussion";
  enriched.reddit_discussion = {
    post_id: clean(discussion.id),
    title: clean(discussion.title),
    url: clean(discussion.url),
    subreddit: clean(discussion.subreddit).replace(/^r\//i, ""),
    matched_topic_words: overlap.shared,
    title_overlap_score: Number(overlap.score.toFixed(3)),
    age_hours: Number(ageHours.toFixed(2)),
    factual_source: false,
    audience_reaction_only: true,
  };
  return enriched;
}

async function enrichStoryFromRedditCandidates({
  story = {},
  redditCandidates = [],
  fetchComments,
  now = new Date(),
  maxAgeHours = DEFAULT_MAX_DISCUSSION_AGE_HOURS,
} = {}) {
  if (typeof fetchComments !== "function") return { ...story };
  const discussion = findRelatedRedditDiscussion(story, redditCandidates, { now, maxAgeHours });
  if (!discussion) return { ...story };
  const comments = await fetchComments(discussion.subreddit, discussion.id, 8);
  return enrichStoryWithRelatedRedditDiscussion({ story, discussion, comments, now, maxAgeHours });
}

function hasVerifiedRedditReaction(story = {}) {
  const sourceType = String(story.comment_source_type || "").toLowerCase();
  if (String(story.source_type || "").toLowerCase() === "reddit") {
    return Boolean(clean(story.top_comment));
  }
  const legacyFetchedComment = Array.isArray(story.reddit_comments)
    ? story.reddit_comments.find((comment) => clean(comment?.body) && Number(comment?.score) > 0)
    : null;
  if (legacyFetchedComment) return true;
  return (
    sourceType === "related_reddit_discussion" &&
    Boolean(clean(story.top_comment)) &&
    Boolean(clean(story.reddit_discussion?.post_id)) &&
    Boolean(clean(story.reddit_discussion?.subreddit)) &&
    story.reddit_discussion?.audience_reaction_only === true &&
    Array.isArray(story.reddit_comments) &&
    story.reddit_comments.length > 0
  );
}

module.exports = {
  DEFAULT_MAX_DISCUSSION_AGE_HOURS,
  DEFAULT_MIN_COMMENT_SCORE,
  enrichStoryFromRedditCandidates,
  enrichStoryWithRelatedRedditDiscussion,
  findRelatedRedditDiscussion,
  hasVerifiedRedditReaction,
  selectTopRedditReactions,
};
