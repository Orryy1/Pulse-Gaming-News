"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildCommentDigest,
  renderCommentDigestMarkdown,
} = require("../lib/comments/comment-copilot");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "test", "output");

function fixtureComments() {
  return [
    {
      id: "fixture_hype_1",
      video_id: "yt_recent_topic_fixture",
      text: "🔥🔥🔥",
    },
    {
      id: "fixture_support_1",
      video_id: "yt_recent_topic_fixture",
      text: "good video",
    },
    {
      id: "fixture_question_1",
      video_id: "local_1sn9xhe_v21",
      text: "when is it out?",
    },
    {
      id: "fixture_correction_1",
      video_id: "yt_bloodlines_fixture",
      text: "this isn't new, they said this last year",
    },
    {
      id: "fixture_topic_1",
      video_id: "yt_recent_topic_fixture",
      text: "please do a video on the next Nintendo Direct",
    },
    {
      id: "fixture_criticism_1",
      video_id: "local_1sn9xhe_v21",
      text: "captions are good but the weird sound effect is distracting",
    },
    {
      id: "fixture_hostile_1",
      video_id: "yt_recent_topic_fixture",
      text: "close your channel",
    },
  ];
}

async function main() {
  await fs.ensureDir(OUTPUT_DIR);
  const digest = buildCommentDigest({
    comments: fixtureComments(),
    optionsByCommentId: {
      fixture_question_1: {
        answerKnown: true,
        knownAnswer: "No release date has been confirmed yet. The trailer confirms the reveal, not timing.",
      },
    },
  });
  const jsonPath = path.join(OUTPUT_DIR, "comment_digest.json");
  const mdPath = path.join(OUTPUT_DIR, "comment_digest.md");
  const queuePath = path.join(OUTPUT_DIR, "comment_reply_queue.json");
  await fs.writeJson(jsonPath, digest, { spaces: 2 });
  await fs.writeFile(mdPath, renderCommentDigestMarkdown(digest), "utf8");
  await fs.writeJson(queuePath, digest.replyQueue, { spaces: 2 });
  console.log(`[comments] wrote ${path.relative(ROOT, jsonPath)}`);
  console.log(`[comments] wrote ${path.relative(ROOT, mdPath)}`);
  console.log(`[comments] wrote ${path.relative(ROOT, queuePath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { fixtureComments };
