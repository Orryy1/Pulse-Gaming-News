"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  scoreStoryMediaInventory,
} = require("../../lib/creative/media-inventory-scorer");

// Cheap fixture builder so each test reads cleanly.
function story(images = [], clips = [], extra = {}) {
  return {
    id: extra.id || "fixture-story",
    title: extra.title || "Fixture Story",
    flair: extra.flair || "News",
    subreddit: extra.subreddit || "gaming",
    downloaded_images: images,
    video_clips: clips,
    ...extra,
  };
}

test("scorer: empty inventory → reject_visuals/blog_only", () => {
  const r = scoreStoryMediaInventory(story([], []));
  assert.equal(r.classification, "blog_only");
  assert.ok(r.classificationReasons.includes("no_visual_inventory"));
  assert.equal(r.counts.total_images, 0);
});

test("scorer: trailer + many store assets → premium_video", () => {
  const r = scoreStoryMediaInventory(
    story(
      [
        { path: "p://k.jpg", type: "key_art", source: "steam", priority: 95 },
        { path: "p://h.jpg", type: "hero", source: "steam", priority: 92 },
        {
          path: "p://s1.jpg",
          type: "screenshot",
          source: "steam",
          priority: 88,
        },
        {
          path: "p://s2.jpg",
          type: "screenshot",
          source: "steam",
          priority: 86,
        },
        {
          path: "p://tf1.jpg",
          type: "trailer_frame",
          source: "trailer",
          priority: 80,
        },
        {
          path: "p://tf2.jpg",
          type: "trailer_frame",
          source: "trailer",
          priority: 79,
        },
      ],
      [
        { path: "p://announce.mp4", type: "trailer", source: "trailer" },
        { path: "p://gameplay.mp4", type: "gameplay_clip", source: "trailer" },
      ],
    ),
  );
  assert.equal(r.classification, "premium_video");
  assert.equal(r.counts.official_trailer_clips, 1);
  assert.equal(r.counts.gameplay_clips, 1);
  assert.equal(r.counts.store_assets, 4);
  assert.ok(r.scores.premiumSuitability >= 70);
});

test("scorer: mostly stock people → reject_visuals", () => {
  const r = scoreStoryMediaInventory(
    story(
      [
        {
          path: "p://stock-1.jpg",
          type: "screenshot",
          source: "pexels",
          stock: true,
          likely_human: true,
          url: "https://pexels.com/people-portrait-1",
        },
        {
          path: "p://stock-2.jpg",
          type: "screenshot",
          source: "unsplash",
          stock: true,
          likely_human: true,
          url: "https://unsplash.com/people/portrait-2",
        },
        {
          path: "p://stock-3.jpg",
          type: "screenshot",
          source: "pexels",
          stock: true,
          likely_human: true,
        },
      ],
      [],
    ),
  );
  assert.equal(r.classification, "reject_visuals");
  assert.ok(r.counts.unknown_human_portrait_risk >= 2);
});

test("scorer: only one capsule + one article hero → briefing or short_only", () => {
  const r = scoreStoryMediaInventory(
    story(
      [
        {
          path: "p://capsule.jpg",
          type: "capsule",
          source: "steam",
          priority: 90,
        },
        {
          path: "p://article.jpg",
          type: "article_hero",
          source: "article",
          priority: 70,
        },
      ],
      [],
    ),
  );
  assert.ok(["briefing_item", "short_only"].includes(r.classification));
  assert.equal(r.counts.store_assets, 1);
  assert.equal(r.counts.article_images, 1);
});

test("scorer: counts trailer-extracted frames separately from clips", () => {
  const r = scoreStoryMediaInventory(
    story(
      [
        {
          path: "p://tf1.jpg",
          type: "trailer_frame",
          source: "trailer",
          priority: 86,
        },
        {
          path: "p://tf2.jpg",
          type: "trailer_frame",
          source: "trailer",
          priority: 85,
        },
        {
          path: "p://tf3.jpg",
          type: "trailer_frame",
          source: "trailer",
          priority: 84,
        },
        {
          path: "p://tf4.jpg",
          type: "trailer_frame",
          source: "trailer",
          priority: 83,
        },
        {
          path: "p://tf5.jpg",
          type: "trailer_frame",
          source: "trailer",
          priority: 82,
        },
        {
          path: "p://tf6.jpg",
          type: "trailer_frame",
          source: "trailer",
          priority: 81,
        },
      ],
      [],
    ),
  );
  assert.equal(r.counts.trailer_extracted_frames, 6);
  assert.equal(r.counts.official_trailer_clips, 0);
});
