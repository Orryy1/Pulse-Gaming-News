"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyThumbnailImage,
  rankThumbnailCandidates,
  selectThumbnailSubjectImage,
  filterUnsafeImagesForRender,
  runThumbnailPreUploadQa,
} = require("../../lib/thumbnail-safety");

// These tests cover the existing in-progress thumbnail-safety module
// against the cases Session 2 §5.4 demands. The module itself is
// authored elsewhere; these tests pin the public contract so the
// creative-pass deliverables don't drift away from it.

test("thumbnail-safety: unknown human portrait is rejected", () => {
  const story = { title: "Aurora Drift Beta Confirmed" };
  const r = classifyThumbnailImage(story, {
    path: "/cache/random-portrait.jpg",
    type: "screenshot",
    source: "pexels",
    stock: true,
    likely_human: true,
    url: "https://pexels.com/people/random-portrait",
  });
  assert.equal(r.safeForThumbnail, false);
  assert.ok(r.reasons.length > 0);
  assert.ok(r.score < 30);
});

test("thumbnail-safety: article author headshot rejected", () => {
  const story = { title: "Iron Saint Roadmap" };
  const r = classifyThumbnailImage(story, {
    path: "/cache/author-byline.jpg",
    type: "article_hero",
    source: "article",
    role: "author",
    is_author_image: true,
    url: "https://example.com/byline-jane",
  });
  assert.equal(r.safeForThumbnail, false);
  assert.ok(r.reasons.includes("article_author_or_profile_image"));
});

test("thumbnail-safety: game key art is preferred (high score)", () => {
  const story = { title: "Aurora Drift Beta Confirmed" };
  const r = classifyThumbnailImage(story, {
    path: "/cache/aurora-keyart.jpg",
    type: "key_art",
    source: "steam",
  });
  assert.equal(r.safeForThumbnail, true);
  assert.ok(r.score >= 70);
  assert.equal(r.isGameAsset, true);
});

test("thumbnail-safety: platform logo preferred for platform story", () => {
  const story = { title: "PlayStation 5 firmware adds cross-save" };
  const r = classifyThumbnailImage(story, {
    path: "/cache/ps5-logo.png",
    type: "platform_logo",
    source: "logo",
  });
  assert.equal(r.safeForThumbnail, true);
  assert.equal(r.isPlatformAsset, true);
});

test("thumbnail-safety: human image allowed when entity matches story", () => {
  const story = {
    title: "Phil Spencer talks Xbox roadmap",
    full_script:
      "Phil Spencer discussed the Xbox roadmap during a recorded interview.",
  };
  const r = classifyThumbnailImage(story, {
    path: "/cache/phil-spencer.jpg",
    type: "article_hero",
    source: "article",
    personName: "Phil Spencer",
    likely_human: true,
  });
  assert.equal(r.safeForThumbnail, true);
  assert.equal(r.namedPersonAllowed, true);
});

test("thumbnail-safety: random portrait cannot become thumbnail candidate", () => {
  const story = { title: "Aurora Drift Beta" };
  const ranked = rankThumbnailCandidates(story, [
    {
      path: "/cache/random-portrait.jpg",
      type: "article_hero",
      source: "article",
      likely_human: true,
      url: "https://example.com/random/portrait",
    },
    {
      path: "/cache/aurora-keyart.jpg",
      type: "key_art",
      source: "steam",
    },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].image.path, "/cache/aurora-keyart.jpg");
});

test("thumbnail-safety: filterUnsafeImagesForRender drops stock-people candidates", () => {
  const story = { title: "Aurora Drift Beta" };
  const result = filterUnsafeImagesForRender(story, [
    {
      path: "/cache/portrait-stock.jpg",
      type: "screenshot",
      source: "pexels",
      stock: true,
      likely_human: true,
      url: "https://pexels.com/people/portrait",
    },
    {
      path: "/cache/keyart.jpg",
      type: "key_art",
      source: "steam",
    },
  ]);
  // The keyart survives, the stock person is dropped.
  const keptPaths = result.images.map((i) => i.path);
  assert.deepEqual(keptPaths, ["/cache/keyart.jpg"]);
  assert.ok(result.rejected.length >= 1);
});

test("thumbnail-safety: pre-upload QA flags missing title text + unsafe candidates", async () => {
  const story = {
    title: "",
    suggested_thumbnail_text: "",
    downloaded_images: [
      {
        path: "/cache/portrait.jpg",
        type: "article_hero",
        source: "article",
        likely_human: true,
        url: "https://example.com/random/portrait",
      },
    ],
  };
  const qa = await runThumbnailPreUploadQa(story);
  assert.equal(qa.result, "fail");
  assert.ok(qa.failures.includes("thumbnail_title_text_missing"));
});

test("thumbnail-safety: selectThumbnailSubjectImage picks the highest scorer", () => {
  const story = { title: "Aurora Drift Beta" };
  const sel = selectThumbnailSubjectImage(story, [
    { path: "/cache/article.jpg", type: "article_hero", source: "article" },
    { path: "/cache/keyart.jpg", type: "key_art", source: "steam" },
    { path: "/cache/screenshot.jpg", type: "screenshot", source: "steam" },
  ]);
  assert.ok(sel);
  assert.equal(sel.image.path, "/cache/keyart.jpg");
});
