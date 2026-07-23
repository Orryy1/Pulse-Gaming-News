"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { scoreStory } = require("../../lib/scoring");

test("official Xbox Wire announcement scoring uses source content and first-party trust", () => {
  const scored = scoreStory(
    {
      id: "rss_xbox_pc_bc",
      title: "Play More of the Games You Love, Wherever You Play",
      url: "https://news.xbox.com/en-us/2026/07/22/xbox-backward-compatibility-on-pc/",
      article_url: "https://news.xbox.com/en-us/2026/07/22/xbox-backward-compatibility-on-pc/",
      source_type: "rss",
      subreddit: "Xbox Wire",
      flair: "News",
      score: 50,
      num_comments: 0,
      timestamp: new Date().toISOString(),
      source_material_excerpt:
        "Xbox Backward Compatibility on PC launches in early release with Crimson Skies, Blinx, Conker and Fuzion Frenzy. Existing digital owners do not pay again and every Game Pass plan includes the games. Achievements arrive later.",
      article_image: "https://xboxwire.thesourcemediaassets.com/hero.jpg",
      company_logo_url: "https://upload.wikimedia.org/xbox.png",
    },
    { channelId: "pulse-gaming", recentStories: [], existingPublishedPlatforms: [] },
  );

  assert.equal(scored.breakdown.source_confidence, 25);
  assert.ok(scored.breakdown.story_importance >= 10, JSON.stringify(scored.breakdown));
  assert.ok(scored.breakdown.search_demand >= 6, JSON.stringify(scored.breakdown));
  assert.equal(scored.inputs.first_party_announcement?.qualifies, true);
});

test("an Xbox Wire label on an untrusted host does not earn first-party trust", () => {
  const scored = scoreStory(
    {
      id: "rss_spoofed_xbox",
      title: "Xbox announces a major launch",
      url: "https://news.xbox.com.attacker.example/fake-announcement",
      source_type: "rss",
      subreddit: "Xbox Wire",
      flair: "News",
      timestamp: new Date().toISOString(),
      source_material_excerpt:
        "Xbox announces that a major game launches on PC with Game Pass.",
    },
    { channelId: "pulse-gaming", recentStories: [], existingPublishedPlatforms: [] },
  );

  assert.equal(scored.breakdown.source_confidence, 14);
  assert.equal(scored.inputs.first_party_announcement?.qualifies, false);
  assert.equal(scored.inputs.first_party_announcement?.source_host, null);
});
