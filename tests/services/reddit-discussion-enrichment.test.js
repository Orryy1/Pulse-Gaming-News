"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  enrichStoryFromRedditCandidates,
  enrichStoryWithRelatedRedditDiscussion,
  findRelatedRedditDiscussion,
  hasVerifiedRedditReaction,
} = require("../../lib/reddit-discussion-enrichment");

test("fresh intake fetches reactions for a matching Reddit discussion attached to an RSS story", async () => {
  const fetched = [];
  const enriched = await enrichStoryFromRedditCandidates({
    story: {
      id: "rss-halo",
      title: "Halo Campaign Evolved Multiplayer Beta Gets A Date",
      source_type: "rss",
    },
    redditCandidates: [{
      id: "halo-thread",
      title: "Halo Campaign Evolved multiplayer beta date officially confirmed",
      source_type: "reddit",
      subreddit: "XboxSeriesX",
      timestamp: "2026-07-12T18:00:00.000Z",
    }],
    fetchComments: async (subreddit, id, count) => {
      fetched.push({ subreddit, id, count });
      return [{ body: "This is the first Halo reveal in years that actually feels focused.", score: 512 }];
    },
    now: new Date("2026-07-12T20:00:00.000Z"),
  });

  assert.deepEqual(fetched, [{ subreddit: "XboxSeriesX", id: "halo-thread", count: 8 }]);
  assert.equal(enriched.comment_source_type, "related_reddit_discussion");
  assert.equal(enriched.top_comment_score, 512);
});

test("official stories can carry a top-rated related Reddit reaction without changing factual source", () => {
  const story = {
    id: "official-digimon",
    title: "Digimon Story Time Stranger Turns Switch 2 Modes Into A Fight",
    source_type: "rss",
    subreddit: "Bandai Namco",
    top_comment: "Official article description",
    comment_source_type: "rss_description",
  };
  const discussion = {
    id: "reddit-digimon",
    title: "Digimon Story Time Stranger Switch 2 performance and quality modes revealed",
    source_type: "reddit",
    subreddit: "NintendoSwitch",
    url: "https://reddit.com/r/NintendoSwitch/comments/reddit-digimon/example/",
    timestamp: "2026-07-12T18:00:00.000Z",
  };

  const enriched = enrichStoryWithRelatedRedditDiscussion({
    story,
    discussion,
    comments: [
      { body: "Quality mode is pointless if the frame pacing still feels rough.", author: "named-user", score: 84 },
      { body: "Portable mode is the version I actually care about.", author: "another-user", score: 231 },
    ],
    now: new Date("2026-07-12T20:00:00.000Z"),
  });

  assert.equal(enriched.source_type, "rss");
  assert.equal(enriched.rss_description, "Official article description");
  assert.equal(enriched.top_comment, "Portable mode is the version I actually care about.");
  assert.equal(enriched.top_comment_author, "Redditor");
  assert.equal(enriched.top_comment_score, 231);
  assert.equal(enriched.comment_source_type, "related_reddit_discussion");
  assert.equal(enriched.reddit_discussion.subreddit, "NintendoSwitch");
  assert.equal(enriched.reddit_comments[0].author, "Redditor");
  assert.equal(hasVerifiedRedditReaction(enriched), true);
});

test("related discussion matching rejects loose same-franchise chatter", () => {
  const story = {
    title: "Halo Campaign Evolved Multiplayer Beta Gets A Date",
    timestamp: "2026-07-12T18:00:00.000Z",
  };
  const selected = findRelatedRedditDiscussion(story, [
    {
      id: "loose-halo",
      title: "What is your favourite Halo campaign?",
      source_type: "reddit",
      subreddit: "gaming",
      timestamp: "2026-07-12T18:30:00.000Z",
    },
    {
      id: "matching-halo",
      title: "Halo Campaign Evolved multiplayer beta date officially confirmed",
      source_type: "reddit",
      subreddit: "XboxSeriesX",
      timestamp: "2026-07-12T18:45:00.000Z",
    },
  ], { now: new Date("2026-07-12T20:00:00.000Z") });

  assert.equal(selected.id, "matching-halo");
});

test("unsafe, low-score and link-heavy comments do not become public reaction cards", () => {
  const enriched = enrichStoryWithRelatedRedditDiscussion({
    story: { title: "GTA VI Trailer Update", source_type: "rss" },
    discussion: {
      id: "gta-thread",
      title: "GTA VI trailer update discussion",
      source_type: "reddit",
      subreddit: "gaming",
      timestamp: "2026-07-12T18:00:00.000Z",
    },
    comments: [
      { body: "https://spam.example buy this now", score: 900 },
      { body: "kill yourself if you disagree", score: 500 },
      { body: "This is a useful but completely unrated reaction.", score: 1 },
    ],
    now: new Date("2026-07-12T20:00:00.000Z"),
  });

  assert.equal(enriched.comment_source_type, undefined);
  assert.equal(hasVerifiedRedditReaction(enriched), false);
});
