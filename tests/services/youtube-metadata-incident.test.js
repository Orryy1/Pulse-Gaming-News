"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMetadata } = require("../../upload_youtube");

test("YouTube metadata does not call preview coverage verified leaks", () => {
  const meta = buildMetadata({
    id: "boltgun-preview",
    title: "Boltgun 2 Leaves The Corridors",
    classification: "NEWS",
    flair: "News",
    full_script:
      "Warhammer 40,000: Boltgun 2 is taking its retro FPS chaos into bigger outdoor spaces. IGN previewed the demo and the useful question is whether those bigger arenas make the sequel feel like a real step up.",
    source_type: "rss",
    subreddit: "IGN",
    url: "https://www.ign.com/articles/warhammer-40000-boltgun-2-preview-fps-preview",
    content_pillar: "Source Breakdown",
  });

  assert.match(meta.description, /PULSE GAMING - Gaming stories with named sources\./);
  assert.doesNotMatch(meta.description, /Verified leaks\. Every day\./);
  assert.doesNotMatch(meta.description, /never miss a beat/i);
});

test("YouTube metadata still allows leak branding for actual leak and rumour classifications", () => {
  const meta = buildMetadata({
    id: "leak-story",
    title: "Switch 2 Leak Points To June",
    classification: "LEAK",
    flair: "Verified",
    full_script:
      "Nintendo Switch 2 just put June back on the calendar for leak watchers. VGC reports that June is the latest claimed target, while Nintendo has not announced a date. For players, it is a clear window to watch without treating the launch as locked.",
    source_type: "reddit",
    subreddit: "GamingLeaksAndRumours",
    primary_source: "VGC",
    article_url: "https://www.videogameschronicle.com/news/switch-2-leak-june/",
    url: "https://www.videogameschronicle.com/news/switch-2-leak-june/",
    content_pillar: "Rumour Watch",
  });

  assert.match(meta.description, /PULSE GAMING - Verified leaks\. Every day\./);
});
