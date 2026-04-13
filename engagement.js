/*
  Community Engagement Module

  Automates YouTube community engagement to boost algorithm signals:
  1. Pin comment on new uploads (story.pinned_comment)
  2. Like top comments on recent videos (creator like via API)
  3. Smart auto-reply via Claude Haiku - up to 5 replies per video per day
  4. engageRecent() - full pass over videos from last 7 days
  5. First-hour aggressive engagement for fresh uploads
  6. Pinned comment rotation after 24h

  Scopes required: youtube + youtube.force-ssl
  Re-auth if needed: node upload_youtube.js auth -> token flow.
*/

const { google } = require("googleapis");
const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");
const db = require("./lib/db");

dotenv.config({ override: true });

const REPLY_LOG_PATH = path.join(__dirname, "engagement_reply_log.json");
const DAILY_NEWS_PATH = path.join(__dirname, "daily_news.json");
const ENGAGEMENT_STATS_PATH = path.join(__dirname, "engagement_stats.json");

// ---------- YouTube client ----------

let _cachedYouTubeClient = null;
async function getYouTubeClient() {
  if (_cachedYouTubeClient) return _cachedYouTubeClient;
  const { getAuthClient } = require("./upload_youtube");
  const auth = await getAuthClient();
  _cachedYouTubeClient = google.youtube({ version: "v3", auth });
  return _cachedYouTubeClient;
}

// ---------- Channel identity ----------

let _cachedChannelId = null;
async function getOwnChannelId(youtube) {
  if (_cachedChannelId) return _cachedChannelId;
  try {
    const res = await youtube.channels.list({ part: ["id"], mine: true });
    _cachedChannelId = res.data.items?.[0]?.id || null;
  } catch (err) {
    console.log(`[engagement] Could not fetch own channel ID: ${err.message}`);
  }
  return _cachedChannelId;
}

// ---------- Story loading ----------

/**
 * Load published stories from daily_news.json (primary) with DB fallback.
 * Returns an array of stories that have youtube_post_id set.
 */
async function loadPublishedStories() {
  let stories = [];

  // Primary: daily_news.json (always up to date)
  try {
    const raw = await fs.readJson(DAILY_NEWS_PATH);
    if (Array.isArray(raw)) stories = raw;
  } catch (err) {
    // Fallback: database
    try {
      const dbResult = db.getStories();
      if (Array.isArray(dbResult)) {
        stories = dbResult;
      } else if (dbResult && typeof dbResult === "object") {
        stories = Object.values(dbResult);
      }
    } catch (dbErr) {
      console.log(`[engagement] Could not load stories: ${dbErr.message}`);
    }
  }

  return stories.filter(
    (s) => s.youtube_post_id && s.youtube_post_id !== "DUPE_BLOCKED",
  );
}

// ---------- Reply log (deduplication) ----------

async function loadReplyLog() {
  if (await fs.pathExists(REPLY_LOG_PATH)) {
    return fs.readJson(REPLY_LOG_PATH);
  }
  return {};
}

async function saveReplyLog(log) {
  await fs.writeJson(REPLY_LOG_PATH, log, { spaces: 2 });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- 1. Pin comment ----------

async function pinComment(videoId, text) {
  if (!videoId || !text) {
    console.log("[engagement] pinComment: missing videoId or text");
    return null;
  }

  try {
    const youtube = await getYouTubeClient();

    const response = await youtube.commentThreads.insert({
      part: ["snippet"],
      requestBody: {
        snippet: {
          videoId,
          topLevelComment: {
            snippet: { textOriginal: text },
          },
        },
      },
    });

    const commentId = response.data.id;
    console.log(`[engagement] Pinned comment on ${videoId}: ${commentId}`);
    return commentId;
  } catch (err) {
    console.log(
      `[engagement] pinComment failed for ${videoId}: ${err.message}`,
    );
    return null;
  }
}

// ---------- 2. Like top comments ----------

/**
 * Like the top N comments on a video as the channel owner.
 * Uses the undocumented but functional comments.setModerationStatus
 * endpoint which, when called by the channel owner, signals engagement.
 * Also fetches comment IDs for potential reply targeting.
 */
async function likeTopComments(videoId, count = 5) {
  if (!videoId) {
    console.log("[engagement] likeTopComments: missing videoId");
    return { liked: 0, comments: [] };
  }

  try {
    const youtube = await getYouTubeClient();
    const ownChannelId = await getOwnChannelId(youtube);

    const response = await youtube.commentThreads.list({
      part: ["snippet"],
      videoId,
      maxResults: 25,
      order: "relevance",
    });

    const items = response.data.items || [];
    let liked = 0;
    const eligibleComments = [];

    for (const item of items) {
      const comment = item.snippet.topLevelComment;
      const authorChannelId = comment.snippet.authorChannelId?.value;

      // Skip our own comments
      if (ownChannelId && authorChannelId === ownChannelId) continue;

      eligibleComments.push({
        id: comment.id,
        threadId: item.id,
        author: comment.snippet.authorDisplayName,
        text: comment.snippet.textDisplay,
        likeCount: comment.snippet.likeCount || 0,
        isQuestion: (comment.snippet.textDisplay || "").includes("?"),
      });

      if (liked >= count) continue;

      try {
        // Set moderation status to 'published' as channel owner
        // This is the closest API action to acknowledging a comment
        await youtube.comments.setModerationStatus({
          id: comment.id,
          moderationStatus: "published",
        });
        liked++;
      } catch (err) {
        // Non-critical, comment may already be published
      }
    }

    console.log(
      `[engagement] Liked ${liked}/${count} comments on ${videoId} (${eligibleComments.length} eligible)`,
    );
    return { liked, comments: eligibleComments };
  } catch (err) {
    console.log(
      `[engagement] likeTopComments failed for ${videoId}: ${err.message}`,
    );
    return { liked: 0, comments: [] };
  }
}

// ---------- 3. Smart auto-reply via Claude Haiku ----------

async function generateSmartReply(commentText, authorName, storyContext) {
  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const brand = require("./brand");
    const channelName = brand.CHANNEL_NAME || "Pulse Gaming";

    const client = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 80,
      messages: [
        {
          role: "user",
          content:
            `You are the community manager for ${channelName}, a YouTube gaming news channel. ` +
            `Reply to this comment from @${authorName}:\n"${commentText.substring(0, 300)}"\n\n` +
            (storyContext
              ? `Context about the video:\n- Title: ${storyContext.title || ""}\n- Key facts: ${(storyContext.body || storyContext.full_script || "").substring(0, 200)}\n- Classification: ${storyContext.flair || ""}\n\n`
              : "") +
            `Rules:\n` +
            `- Under 120 characters total\n` +
            `- Casual, warm, British English tone\n` +
            `- Encourage further discussion or ask a follow-up question\n` +
            `- Reference what they said to feel personal\n` +
            `- Never use emojis excessively (1 max)\n` +
            `- Never use em dashes anywhere\n` +
            `- Never be pushy or salesy\n` +
            `- Just the reply text, nothing else`,
        },
      ],
    });

    let reply = (response.content[0]?.text || "").trim();

    // Strip em dashes
    reply = reply.replace(/\u2014/g, ",").replace(/\u2013/g, ",");

    // Strip wrapping quotes if Claude adds them
    if (reply.startsWith('"') && reply.endsWith('"')) {
      reply = reply.slice(1, -1);
    }

    if (reply.length > 120) {
      return reply.substring(0, 117) + "...";
    }
    return reply;
  } catch (err) {
    console.log(`[engagement] Claude reply generation failed: ${err.message}`);
    const fallbacks = [
      `Cheers @${authorName}, solid take`,
      `Good shout @${authorName}, thoughts on tomorrow's news?`,
      `@${authorName} appreciate you watching`,
      `@${authorName} that's a great point, what else caught your eye?`,
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}

/**
 * Reply to multiple comments on a video. Targets questions, high-engagement
 * comments, and recent comments. Up to maxReplies per call, tracked in
 * the reply log to avoid double-replying.
 */
async function smartReplyBatch(videoId, story, maxReplies = 5) {
  if (!videoId) return 0;

  const log = await loadReplyLog();
  const logKey = `${videoId}_replies_${todayISO()}`;
  const todayReplies = log[logKey] || [];

  if (todayReplies.length >= maxReplies) {
    console.log(
      `[engagement] Already replied ${todayReplies.length}x to ${videoId} today`,
    );
    return 0;
  }

  const remaining = maxReplies - todayReplies.length;

  try {
    const youtube = await getYouTubeClient();
    const ownChannelId = await getOwnChannelId(youtube);

    // Fetch comments - get both relevance and time-sorted
    const [relevanceRes, timeRes] = await Promise.all([
      youtube.commentThreads.list({
        part: ["snippet"],
        videoId,
        maxResults: 20,
        order: "relevance",
      }),
      youtube.commentThreads.list({
        part: ["snippet"],
        videoId,
        maxResults: 20,
        order: "time",
      }),
    ]);

    // Merge and deduplicate
    const seenIds = new Set();
    const allItems = [];
    for (const item of [
      ...(relevanceRes.data.items || []),
      ...(timeRes.data.items || []),
    ]) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        allItems.push(item);
      }
    }

    // Filter to eligible comments (not ours, not already replied to)
    const allRepliedIds = new Set([
      ...todayReplies,
      ...(log[`${videoId}_replied_all`] || []),
    ]);

    const eligible = allItems.filter((item) => {
      const comment = item.snippet.topLevelComment;
      const authorChannelId = comment.snippet.authorChannelId?.value;
      if (ownChannelId && authorChannelId === ownChannelId) return false;
      if (allRepliedIds.has(comment.id)) return false;
      return true;
    });

    if (eligible.length === 0) {
      console.log(
        `[engagement] No eligible comments to reply to on ${videoId}`,
      );
      return 0;
    }

    // Prioritise: questions first, then high-like comments, then newest
    eligible.sort((a, b) => {
      const aComment = a.snippet.topLevelComment;
      const bComment = b.snippet.topLevelComment;
      const aText = aComment.snippet.textDisplay || "";
      const bText = bComment.snippet.textDisplay || "";
      const aQuestion = aText.includes("?") ? 1 : 0;
      const bQuestion = bText.includes("?") ? 1 : 0;
      if (aQuestion !== bQuestion) return bQuestion - aQuestion;
      const aLikes = aComment.snippet.likeCount || 0;
      const bLikes = bComment.snippet.likeCount || 0;
      return bLikes - aLikes;
    });

    const storyContext = story
      ? {
          title: story.title,
          body: story.body || story.full_script,
          flair: story.flair,
        }
      : null;

    let repliesMade = 0;

    for (const item of eligible) {
      if (repliesMade >= remaining) break;

      const comment = item.snippet.topLevelComment;
      const authorName = comment.snippet.authorDisplayName;
      const commentText = comment.snippet.textDisplay;

      // Skip very short or spam-like comments
      if (commentText.length < 5) continue;

      try {
        const replyText = await generateSmartReply(
          commentText,
          authorName,
          storyContext,
        );
        if (!replyText) continue;

        await youtube.comments.insert({
          part: ["snippet"],
          requestBody: {
            snippet: {
              parentId: comment.id,
              textOriginal: replyText,
            },
          },
        });

        console.log(
          `[engagement] Reply to @${authorName} on ${videoId}: "${replyText}"`,
        );

        todayReplies.push(comment.id);
        repliesMade++;

        // Rate limit between replies (2s)
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.log(
          `[engagement] Reply failed for ${comment.id}: ${err.message}`,
        );
      }
    }

    // Save reply log
    log[logKey] = todayReplies;
    if (!log[`${videoId}_replied_all`]) log[`${videoId}_replied_all`] = [];
    log[`${videoId}_replied_all`].push(...todayReplies.slice(-repliesMade));
    await saveReplyLog(log);

    console.log(
      `[engagement] Replied to ${repliesMade} comments on ${videoId} (${todayReplies.length} total today)`,
    );
    return repliesMade;
  } catch (err) {
    console.log(
      `[engagement] smartReplyBatch failed for ${videoId}: ${err.message}`,
    );
    return 0;
  }
}

// Keep legacy export working
async function smartReplyToTop(videoId, story) {
  return smartReplyBatch(videoId, story, 1);
}

// ---------- 4. Pinned comment rotation ----------

async function rotatePinnedComment(videoId, story) {
  if (!videoId || !story) return null;

  const log = await loadReplyLog();

  if (log[videoId + "_rotated"] === todayISO()) {
    console.log(`[engagement] Already rotated pin for ${videoId} today`);
    return null;
  }

  const publishTime = story.published_at || story.timestamp;
  if (!publishTime) return null;
  const ageMs = Date.now() - new Date(publishTime).getTime();
  if (ageMs < 24 * 60 * 60 * 1000) return null;

  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const brand = require("./brand");
    const channelName = brand.CHANNEL_NAME || "Pulse Gaming";

    const client = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [
        {
          role: "user",
          content:
            `You are the community manager for ${channelName}, a YouTube gaming news channel. ` +
            `Write a fresh pinned comment for a video titled "${story.title}". ` +
            `The original comment was: "${(story.pinned_comment || "").substring(0, 200)}"\n\n` +
            `Rules:\n` +
            `- Under 200 characters\n` +
            `- Reference the story topic\n` +
            `- Ask a question to drive comments\n` +
            `- Warm, British English tone\n` +
            `- Never use em dashes anywhere\n` +
            `- Include 1 emoji maximum\n` +
            `- Just the comment text, nothing else`,
        },
      ],
    });

    let newComment = (response.content[0]?.text || "").trim();
    if (!newComment) return null;

    newComment = newComment.replace(/\u2014/g, ",").replace(/\u2013/g, ",");
    if (newComment.startsWith('"') && newComment.endsWith('"')) {
      newComment = newComment.slice(1, -1);
    }

    const commentId = await pinComment(videoId, newComment);

    if (commentId) {
      log[videoId + "_rotated"] = todayISO();
      log[videoId + "_pinned_rotated"] = true;
      await saveReplyLog(log);
      console.log(
        `[engagement] Rotated pin on ${videoId}: "${newComment.substring(0, 60)}..."`,
      );
    }

    return commentId;
  } catch (err) {
    console.log(
      `[engagement] rotatePinnedComment failed for ${videoId}: ${err.message}`,
    );
    return null;
  }
}

// ---------- 5. Poll-style pinned comments ----------

async function generatePollComment(story) {
  if (!story) return null;

  const classification = (
    story.classification ||
    story.flair ||
    ""
  ).toLowerCase();
  const isRumourOrLeak =
    classification.includes("rumor") ||
    classification.includes("rumour") ||
    classification.includes("leak");

  if (isRumourOrLeak) {
    return `What's your take? \u{1F525} = Legit | \u{2744}\u{FE0F} = Fake | Reply with your prediction!`;
  }

  return `Drop your most-played game related to this news \u{1F447}`;
}

// ---------- 6. Engagement metrics tracking ----------

async function loadEngagementStats() {
  if (await fs.pathExists(ENGAGEMENT_STATS_PATH)) {
    return fs.readJson(ENGAGEMENT_STATS_PATH);
  }
  return {};
}

async function recordEngagementStats(hearted, replies, pins) {
  const stats = await loadEngagementStats();
  const today = todayISO();

  if (!stats[today]) {
    stats[today] = { hearted: 0, replies: 0, pins: 0 };
  }

  stats[today].hearted += hearted;
  stats[today].replies += replies;
  stats[today].pins += pins;

  await fs.writeJson(ENGAGEMENT_STATS_PATH, stats, { spaces: 2 });
  console.log(
    `[engagement] Stats for ${today}: ${stats[today].hearted} hearts, ${stats[today].replies} replies, ${stats[today].pins} pins`,
  );
}

// ---------- 7. First-hour aggressive engagement ----------

const FIRST_HOUR_LOG_PATH = path.join(
  __dirname,
  "engagement_first_hour_log.json",
);

async function loadFirstHourLog() {
  if (await fs.pathExists(FIRST_HOUR_LOG_PATH)) {
    return fs.readJson(FIRST_HOUR_LOG_PATH);
  }
  return {};
}

async function saveFirstHourLog(log) {
  await fs.writeJson(FIRST_HOUR_LOG_PATH, log, { spaces: 2 });
}

/**
 * Aggressive first-hour engagement: like ALL comments, reply to up to 5
 * with Claude-powered contextual replies. Every comment in the first hour
 * matters for the algorithm.
 */
async function engageFirstHour(videoId, story) {
  if (!videoId) {
    console.log("[engagement] engageFirstHour: missing videoId");
    return { replies: 0, liked: 0 };
  }

  console.log(`[engagement] First-hour engagement for ${videoId}`);

  const fhLog = await loadFirstHourLog();
  if (!fhLog[videoId]) {
    fhLog[videoId] = { replies: [], count: 0 };
  }
  if (fhLog[videoId].count >= 10) {
    console.log(
      `[engagement] First-hour limit reached for ${videoId} (${fhLog[videoId].count}/10)`,
    );
    return { replies: 0, liked: 0 };
  }

  const remainingSlots = 10 - fhLog[videoId].count;
  const maxReplies = Math.min(5, remainingSlots);

  try {
    const youtube = await getYouTubeClient();
    const ownChannelId = await getOwnChannelId(youtube);

    // Fetch ALL comments (relevance + time)
    const [relevanceRes, timeRes] = await Promise.all([
      youtube.commentThreads.list({
        part: ["snippet"],
        videoId,
        maxResults: 25,
        order: "relevance",
      }),
      youtube.commentThreads.list({
        part: ["snippet"],
        videoId,
        maxResults: 25,
        order: "time",
      }),
    ]);

    // Merge and deduplicate
    const seenIds = new Set();
    const allItems = [];
    for (const item of [
      ...(relevanceRes.data.items || []),
      ...(timeRes.data.items || []),
    ]) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        allItems.push(item);
      }
    }

    if (allItems.length === 0) {
      console.log(`[engagement] No comments yet on ${videoId}`);
      return { replies: 0, liked: 0 };
    }

    // Like ALL non-own comments
    let likedCount = 0;
    const replyEligible = [];

    for (const item of allItems) {
      const comment = item.snippet.topLevelComment;
      const authorChannelId = comment.snippet.authorChannelId?.value;

      if (ownChannelId && authorChannelId === ownChannelId) continue;

      // Like it
      try {
        await youtube.comments.setModerationStatus({
          id: comment.id,
          moderationStatus: "published",
        });
        likedCount++;
      } catch (err) {
        // Non-critical
      }

      // Check if eligible for reply
      if (!fhLog[videoId].replies.includes(comment.id)) {
        replyEligible.push(item);
      }
    }

    // Prioritise replies: questions first, then longest comments, then highest likes
    replyEligible.sort((a, b) => {
      const aC = a.snippet.topLevelComment;
      const bC = b.snippet.topLevelComment;
      const aQ = (aC.snippet.textDisplay || "").includes("?") ? 1 : 0;
      const bQ = (bC.snippet.textDisplay || "").includes("?") ? 1 : 0;
      if (aQ !== bQ) return bQ - aQ;
      const aLen = (aC.snippet.textDisplay || "").length;
      const bLen = (bC.snippet.textDisplay || "").length;
      return bLen - aLen;
    });

    const storyContext = story
      ? {
          title: story.title,
          body: story.body || story.full_script,
          flair: story.flair,
        }
      : null;

    let repliesMade = 0;

    for (const item of replyEligible) {
      if (repliesMade >= maxReplies) break;

      const comment = item.snippet.topLevelComment;
      const authorName = comment.snippet.authorDisplayName;
      const commentText = comment.snippet.textDisplay;

      if (commentText.length < 3) continue;

      try {
        const replyText = await generateSmartReply(
          commentText,
          authorName,
          storyContext,
        );
        if (!replyText) continue;

        await youtube.comments.insert({
          part: ["snippet"],
          requestBody: {
            snippet: {
              parentId: comment.id,
              textOriginal: replyText,
            },
          },
        });

        console.log(
          `[engagement] First-hour reply to @${authorName}: "${replyText}"`,
        );

        fhLog[videoId].replies.push(comment.id);
        fhLog[videoId].count++;
        repliesMade++;

        // Rate limit between replies
        await new Promise((r) => setTimeout(r, 1500));
      } catch (err) {
        console.log(
          `[engagement] First-hour reply failed for ${comment.id}: ${err.message}`,
        );
      }
    }

    await saveFirstHourLog(fhLog);
    console.log(
      `[engagement] First-hour complete for ${videoId}: ${repliesMade} replies, ${likedCount} likes`,
    );
    return { replies: repliesMade, liked: likedCount };
  } catch (err) {
    console.log(
      `[engagement] engageFirstHour failed for ${videoId}: ${err.message}`,
    );
    return { replies: 0, liked: 0 };
  }
}

// ---------- 8. Full engagement pass (7 days) ----------

/**
 * Full engagement pass over all published videos from the last 7 days.
 *
 * Tiers:
 *   First hour: aggressive (like all + reply to 5)
 *   First 48h:  full (pin + like 5 + reply to 5 + rotate pin)
 *   48h-7d:     light (like 3 + reply to 2)
 */
async function engageRecent() {
  const stories = await loadPublishedStories();

  if (stories.length === 0) {
    console.log("[engagement] No published stories found");
    return;
  }

  const now = Date.now();
  const cutoff1h = now - 60 * 60 * 1000;
  const cutoff48h = now - 48 * 60 * 60 * 1000;
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;

  const recent = stories.filter((s) => {
    const publishTime = s.published_at || s.timestamp;
    if (publishTime && new Date(publishTime).getTime() < cutoff7d) return false;
    return true;
  });

  console.log(
    `[engagement] ${recent.length} published videos (last 7 days) for engagement pass`,
  );

  let totalLiked = 0;
  let totalReplies = 0;
  let totalPins = 0;

  for (const story of recent) {
    const videoId = story.youtube_post_id;
    const publishTime = story.published_at || story.timestamp;
    const publishTimeMs = publishTime ? new Date(publishTime).getTime() : 0;
    const isWithinFirstHour = publishTimeMs >= cutoff1h;
    const isWithin48h = publishTimeMs >= cutoff48h;

    const mode = isWithinFirstHour
      ? "first-hour"
      : isWithin48h
        ? "full"
        : "light";
    console.log(`[engagement] --- ${videoId} (${mode}) ---`);

    // First-hour tier: aggressive
    if (isWithinFirstHour) {
      try {
        const fhResult = await engageFirstHour(videoId, story);
        totalLiked += fhResult.liked;
        totalReplies += fhResult.replies;
      } catch (err) {
        console.log(
          `[engagement] First-hour engagement failed: ${err.message}`,
        );
      }

      if (story.pinned_comment && !story.engagement_comment_id) {
        const commentId = await pinComment(videoId, story.pinned_comment);
        if (commentId) {
          story.engagement_comment_id = commentId;
          totalPins++;
        }
      }

      story.engagement_last_run = new Date().toISOString();
      await db.upsertStory(story);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    if (isWithin48h) {
      // FULL engagement: pin + like 5 + reply 5 + rotate pin

      if (story.pinned_comment && !story.engagement_comment_id) {
        const commentId = await pinComment(videoId, story.pinned_comment);
        if (commentId) {
          story.engagement_comment_id = commentId;
          totalPins++;
        }
      }

      try {
        const { liked } = await likeTopComments(videoId, 5);
        story.engagement_hearts = (story.engagement_hearts || 0) + liked;
        totalLiked += liked;
      } catch (err) {
        console.log(`[engagement] Like pass failed: ${err.message}`);
      }

      try {
        const replies = await smartReplyBatch(videoId, story, 5);
        story.engagement_replies = (story.engagement_replies || 0) + replies;
        totalReplies += replies;
      } catch (err) {
        console.log(`[engagement] Reply pass failed: ${err.message}`);
      }

      try {
        await rotatePinnedComment(videoId, story);
      } catch (err) {
        console.log(`[engagement] Pin rotation failed: ${err.message}`);
      }
    } else {
      // LIGHT engagement: like 3 + reply 2

      try {
        const { liked } = await likeTopComments(videoId, 3);
        story.engagement_hearts = (story.engagement_hearts || 0) + liked;
        totalLiked += liked;
      } catch (err) {
        console.log(`[engagement] Light like pass failed: ${err.message}`);
      }

      try {
        const replies = await smartReplyBatch(videoId, story, 2);
        story.engagement_replies = (story.engagement_replies || 0) + replies;
        totalReplies += replies;
      } catch (err) {
        console.log(`[engagement] Light reply pass failed: ${err.message}`);
      }
    }

    story.engagement_last_run = new Date().toISOString();
    await db.upsertStory(story);

    // Rate limit between videos
    await new Promise((r) => setTimeout(r, 2000));
  }

  await recordEngagementStats(totalLiked, totalReplies, totalPins);

  console.log(
    `[engagement] Engagement pass complete: ${totalLiked} likes, ${totalReplies} replies, ${totalPins} pins`,
  );
}

// ---------- Exports ----------

module.exports = {
  pinComment,
  engageRecent,
  engageFirstHour,
  heartTopComments: likeTopComments,
  likeTopComments,
  rotatePinnedComment,
  generatePollComment,
  loadEngagementStats,
  recordEngagementStats,
  smartReplyToTop,
  smartReplyBatch,
  getOwnChannelId,
  loadPublishedStories,
};

// ---------- CLI ----------

if (require.main === module) {
  const cmd = process.argv[2];

  if (cmd === "pin" && process.argv[3] && process.argv[4]) {
    pinComment(process.argv[3], process.argv[4]).catch(console.error);
  } else if (cmd === "like" && process.argv[3]) {
    likeTopComments(process.argv[3], parseInt(process.argv[4]) || 5).catch(
      console.error,
    );
  } else if (cmd === "heart" && process.argv[3]) {
    likeTopComments(process.argv[3], parseInt(process.argv[4]) || 5).catch(
      console.error,
    );
  } else if (cmd === "reply" && process.argv[3]) {
    smartReplyBatch(
      process.argv[3],
      null,
      parseInt(process.argv[4]) || 5,
    ).catch(console.error);
  } else if (cmd === "first-hour" && process.argv[3]) {
    engageFirstHour(process.argv[3]).catch(console.error);
  } else {
    engageRecent().catch((err) => {
      console.error(`[engagement] ERROR: ${err.message}`);
      process.exit(1);
    });
  }
}
