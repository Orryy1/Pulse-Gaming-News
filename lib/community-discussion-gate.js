const COMMUNITY_DISCUSSION_SUBREDDITS = new Set([
  "gaming",
  "games",
  "pcmasterrace",
  "pcgaming",
  "ps5",
  "xboxseriesx",
  "nintendoswitch",
]);

const COMMUNITY_DISCUSSION_TITLE_RE =
  /\b(?:what(?:'s| is| are)|which|who|how to|anyone else|do you|did we|have we|recommend|recommendations?|best|favou?rite|obscure|ever played|made me reali[sz]e|feel like|lost the magic|lose the magic|came across|in chat|we need another|this moment|your game|my setup|rate my)\b/i;

const SOURCE_BACKED_NEWS_VERB_RE =
  /\b(?:announces?|announced|announcing|confirms?|confirmed|reveals?|revealed|launches?|launched|release date|trailer|update|patch|delayed|cancelled|acquired|lawsuit|statement|responds?|response|review bombed|sales|earnings|revenue|expected to rise|director says|developer says|publisher says|ceo says|ceo responds)\b/i;

const LOW_VALUE_COMMUNITY_TITLE_RE =
  /\b(?:safe rooms look like this|f in chat|car blew up|fried my|boot looping|capturing .* in the office|this is exactly|perfect result i wanted|photo mode|screenshot|my playthrough|my first|look what i found|look what happened|finally beat|finally finished|rate my|my setup|my build|my rig|battlestation|just bought|just got|just upgraded)\b/i;

const DIRECT_REDDIT_MEDIA_RE =
  /^https?:\/\/(?:i\.redd\.it|v\.redd\.it|preview\.redd\.it)\//i;
const DIRECT_IMAGE_OR_VIDEO_RE =
  /\.(?:jpe?g|png|webp|gif|avif|mp4|mov|webm)(?:[?#].*)?$/i;

function normaliseSubreddit(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^r\//, "")
    .trim();
}

function isCommunityDiscussionSubreddit(value) {
  return COMMUNITY_DISCUSSION_SUBREDDITS.has(normaliseSubreddit(value));
}

function isCommunityDiscussionPrompt(story = {}) {
  if (String(story.source_type || "reddit").toLowerCase() !== "reddit") {
    return false;
  }
  if (!isCommunityDiscussionSubreddit(story.subreddit)) return false;

  const title = String(story.title || "");
  if (!COMMUNITY_DISCUSSION_TITLE_RE.test(title)) return false;

  const text = `${title}\n${story.full_script || ""}\n${story.hook || ""}`;
  const hasNewsVerb = SOURCE_BACKED_NEWS_VERB_RE.test(text);
  const isQuestion = /\?/.test(title);
  return isQuestion || !hasNewsVerb;
}

function hasSourceBackedNewsSignal(story = {}) {
  const text = `${story.title || ""}\n${story.full_script || ""}\n${story.hook || ""}`;
  return SOURCE_BACKED_NEWS_VERB_RE.test(text);
}

function isDirectMediaOnlyRedditPost(story = {}) {
  if (String(story.source_type || "reddit").toLowerCase() !== "reddit") {
    return false;
  }
  if (!isCommunityDiscussionSubreddit(story.subreddit)) return false;
  const url = String(story.article_url || story.url || "");
  if (!DIRECT_REDDIT_MEDIA_RE.test(url) && !DIRECT_IMAGE_OR_VIDEO_RE.test(url)) {
    return false;
  }
  return !hasSourceBackedNewsSignal(story);
}

function isLowValueCommunityMediaPost(story = {}) {
  if (String(story.source_type || "reddit").toLowerCase() !== "reddit") {
    return false;
  }
  if (!isCommunityDiscussionSubreddit(story.subreddit)) return false;

  const title = String(story.title || "");
  if (!LOW_VALUE_COMMUNITY_TITLE_RE.test(title)) return false;
  return !hasSourceBackedNewsSignal(story);
}

function shouldRejectGeneralRedditForNews(story = {}) {
  return (
    isCommunityDiscussionPrompt(story) ||
    isLowValueCommunityMediaPost(story) ||
    isDirectMediaOnlyRedditPost(story)
  );
}

module.exports = {
  COMMUNITY_DISCUSSION_SUBREDDITS,
  COMMUNITY_DISCUSSION_TITLE_RE,
  LOW_VALUE_COMMUNITY_TITLE_RE,
  SOURCE_BACKED_NEWS_VERB_RE,
  hasSourceBackedNewsSignal,
  isCommunityDiscussionPrompt,
  isCommunityDiscussionSubreddit,
  isDirectMediaOnlyRedditPost,
  isLowValueCommunityMediaPost,
  normaliseSubreddit,
  shouldRejectGeneralRedditForNews,
};
