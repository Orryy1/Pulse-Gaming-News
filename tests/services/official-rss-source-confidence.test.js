"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { scoreStory } = require("../../lib/scoring");

test("configured Xbox and PlayStation first-party RSS feeds receive maximum source confidence", () => {
  const fixtures = [
    {
      subreddit: "XboxWire",
      title: "Xbox confirms a new Game Pass update",
    },
    {
      subreddit: "PlayStationBlog",
      title: "PlayStation confirms a new PS5 game update",
    },
  ];

  for (const fixture of fixtures) {
    const score = scoreStory(
      {
        ...fixture,
        source_type: "rss",
        flair: "News",
        score: 0,
        timestamp: "2026-07-29T12:00:00.000Z",
      },
      {
        channelId: "pulse-gaming",
        now: new Date("2026-07-29T12:05:00.000Z"),
      },
    );

    assert.equal(
      score.breakdown.source_confidence,
      25,
      fixture.subreddit,
    );
  }
});
