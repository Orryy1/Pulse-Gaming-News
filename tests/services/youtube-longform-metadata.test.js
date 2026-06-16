"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildLongformUploadMetadata } = require("../../upload_youtube");

test("YouTube longform metadata honours custom Release Radar packaging", () => {
  const metadata = buildLongformUploadMetadata(
    {
      title: "Best New Games Coming in July 2026",
      description: "A source-backed Pulse Release Radar with chapters and official sources.",
      tags: ["best games july 2026", "new games", "pulse gaming"],
      privacyStatus: "private",
    },
    {
      channel: {
        niche: "gaming",
        name: "Pulse Gaming",
        hashtags: ["#Gaming"],
        youtubeCategory: "20",
      },
      brand: {
        CHANNEL_NAME: "Pulse Gaming",
        TAGLINE: "Never miss a beat",
      },
    },
  );

  assert.equal(metadata.title, "Best New Games Coming in July 2026");
  assert.match(metadata.description, /Pulse Release Radar/);
  assert.deepEqual(metadata.tags, ["best games july 2026", "new games", "pulse gaming"]);
  assert.equal(metadata.privacyStatus, "private");
  assert.equal(metadata.categoryId, "20");
});
