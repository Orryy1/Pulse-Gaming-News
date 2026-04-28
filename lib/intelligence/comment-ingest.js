"use strict";

/**
 * lib/intelligence/comment-ingest.js — Session 3 (intelligence pass).
 *
 * Read-only YouTube comment ingest. Two modes:
 *   - mode: 'fixture' (default) — synthetic comments, no network.
 *   - mode: 'real'              — calls youtube.commentThreads.list
 *                                 ONLY when the operator has set
 *                                 INTELLIGENCE_REAL_MODE=true and
 *                                 supplied an authClient.
 *
 * NEVER posts, NEVER replies, NEVER hearts/likes/moderates. The
 * client only reads. The classifier (lib/intelligence/comment-classifier)
 * runs over whatever this returns; the reply-drafter writes drafts
 * tagged `is_draft: true`.
 *
 * Required scopes for real-mode read:
 *   - https://www.googleapis.com/auth/youtube.force-ssl
 *     OR https://www.googleapis.com/auth/youtube
 * Both are in the existing OAuth scope list in upload_youtube.js, so
 * real-mode read can run without re-authorisation as long as the
 * operator gates it with INTELLIGENCE_REAL_MODE=true.
 */

const FIXTURE_COMMENTS = [
  {
    id: "fixture-c1",
    videoId: "fixture-vid-1",
    authorDisplayName: "viewer-a",
    textOriginal:
      "Day 1 buy for me, this game looks fire. Hyped beyond belief.",
  },
  {
    id: "fixture-c2",
    videoId: "fixture-vid-1",
    authorDisplayName: "viewer-b",
    textOriginal: "nice",
  },
  {
    id: "fixture-c3",
    videoId: "fixture-vid-1",
    authorDisplayName: "viewer-c",
    textOriginal:
      "Actually that release date is wrong, the publisher pushed it back to next month according to their own blog.",
  },
  {
    id: "fixture-c4",
    videoId: "fixture-vid-1",
    authorDisplayName: "viewer-d",
    textOriginal: "Can you cover the Pale Compass roadmap next?",
  },
  {
    id: "fixture-c5",
    videoId: "fixture-vid-1",
    authorDisplayName: "viewer-e",
    textOriginal:
      "This is a terrible take. Hard disagree. But honestly the section about platforms was useful.",
  },
  {
    id: "fixture-c6",
    videoId: "fixture-vid-1",
    authorDisplayName: "viewer-f",
    textOriginal:
      "Audio was a bit low on the cold open and the captions are mistimed at 0:14.",
  },
  {
    id: "fixture-c7",
    videoId: "fixture-vid-1",
    authorDisplayName: "viewer-g",
    textOriginal: "Will this be on Switch too?",
  },
  {
    id: "fixture-c8",
    videoId: "fixture-vid-2",
    authorDisplayName: "viewer-h",
    textOriginal: "lol skill issue",
  },
  {
    id: "fixture-c9",
    videoId: "fixture-vid-2",
    authorDisplayName: "viewer-i",
    textOriginal: "free nitro at https://discord.gg/totallylegit",
  },
  {
    id: "fixture-c10",
    videoId: "fixture-vid-2",
    authorDisplayName: "viewer-j",
    textOriginal: "you're an idiot",
  },
  {
    id: "fixture-c11",
    videoId: "fixture-vid-2",
    authorDisplayName: "viewer-k",
    textOriginal: "good content keep it up",
  },
  {
    id: "fixture-c12",
    videoId: "fixture-vid-2",
    authorDisplayName: "viewer-l",
    textOriginal: "okay",
  },
];

function fixtureFetchComments(videoId) {
  return FIXTURE_COMMENTS.filter((c) => !videoId || c.videoId === videoId);
}

async function buildCommentIngestClient(opts = {}) {
  const mode = opts.mode || process.env.INTELLIGENCE_COMMENT_MODE || "fixture";
  if (mode !== "fixture" && mode !== "real") {
    throw new Error(`unknown comment-ingest mode "${mode}"`);
  }
  if (mode === "real" && process.env.INTELLIGENCE_REAL_MODE !== "true") {
    throw new Error(
      "real comment-ingest mode requires INTELLIGENCE_REAL_MODE=true. The current OAuth scopes are sufficient (youtube/youtube.force-ssl) but the gate is opt-in.",
    );
  }
  return {
    mode,
    async listForVideo(videoId, options = {}) {
      if (mode === "fixture") {
        return fixtureFetchComments(videoId);
      }
      const auth = options.authClient;
      if (!auth) throw new Error("real mode requires options.authClient");
      const { google } = require("googleapis");
      const youtube = google.youtube({ version: "v3", auth });
      const out = [];
      let pageToken = null;
      let pages = 0;
      do {
        const resp = await youtube.commentThreads.list({
          part: ["snippet"],
          videoId,
          maxResults: Math.min(100, options.maxResults || 100),
          pageToken: pageToken || undefined,
          textFormat: "plainText",
        });
        for (const item of resp.data.items || []) {
          const top = item.snippet?.topLevelComment?.snippet || {};
          out.push({
            id: item.id,
            videoId,
            authorDisplayName: top.authorDisplayName || null,
            textOriginal: top.textOriginal || top.textDisplay || "",
            likeCount: top.likeCount || 0,
            publishedAt: top.publishedAt || null,
          });
        }
        pageToken = resp.data.nextPageToken || null;
        pages++;
        if (options.maxPages && pages >= options.maxPages) break;
      } while (pageToken);
      return out;
    },
  };
}

module.exports = {
  buildCommentIngestClient,
  fixtureFetchComments,
  FIXTURE_COMMENTS,
};
