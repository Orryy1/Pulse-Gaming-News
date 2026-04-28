"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("fs-extra");
const os = require("node:os");

const {
  evaluateStoryVisualQa,
  renderQaMarkdown,
  writeQaArtefacts,
} = require("../../lib/creative/visual-qa-gate");

test("visual QA: premium inventory + clean signals (no pre-built thumbnail) → result=warn but render allowed", () => {
  const story = {
    id: "qa-pass",
    title: "Iron Saint Console Reveal",
    suggested_thumbnail_text: "IRON SAINT CONSOLE REVEAL",
    flair: "Confirmed",
    company_name: "Halberd Games",
    downloaded_images: [
      { path: "p://k.jpg", type: "key_art", source: "steam", priority: 95 },
      { path: "p://h.jpg", type: "hero", source: "steam", priority: 92 },
      { path: "p://s1.jpg", type: "screenshot", source: "steam", priority: 88 },
      { path: "p://s2.jpg", type: "screenshot", source: "steam", priority: 87 },
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
    ],
    video_clips: [
      { path: "p://announce.mp4", type: "trailer", source: "trailer" },
      { path: "p://gameplay.mp4", type: "gameplay_clip", source: "youtube" },
    ],
  };
  const r = evaluateStoryVisualQa(story);
  // No thumbnail_candidate_path set → gate fires a warning. Inventory
  // is solid, runtime is approved, no failures.
  assert.equal(r.result, "warn");
  assert.deepEqual(r.failures, []);
  assert.equal(r.runtime.shouldRender, true);
  assert.equal(r.inventory.classification, "premium_video");
  assert.match(r.recommendedAction, /render|review|target/i);
});

test("visual QA: stock-people heavy → result=fail with reject_visuals", () => {
  const story = {
    id: "qa-reject",
    title: "Random Stock People Story",
    suggested_thumbnail_text: "RANDOM STORY",
    flair: "Rumour",
    downloaded_images: [
      {
        path: "p://stock-1.jpg",
        type: "screenshot",
        source: "pexels",
        stock: true,
        likely_human: true,
        url: "https://pexels.com/people/portrait-1",
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
        path: "p://author.jpg",
        type: "article_hero",
        source: "article",
        role: "author",
        is_author_image: true,
      },
    ],
    video_clips: [],
  };
  const r = evaluateStoryVisualQa(story);
  assert.equal(r.result, "fail");
  assert.ok(
    ["reject_visuals", "blog_only"].includes(r.inventory.classification),
  );
  assert.equal(r.runtime.shouldRender, false);
});

test("visual QA: missing title text is a fail-level failure", () => {
  const story = {
    id: "qa-no-title",
    title: "",
    suggested_thumbnail_text: "",
    flair: "News",
    downloaded_images: [
      { path: "p://k.jpg", type: "key_art", source: "steam", priority: 95 },
      { path: "p://s.jpg", type: "screenshot", source: "steam", priority: 88 },
      {
        path: "p://tf.jpg",
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
    video_clips: [],
  };
  const r = evaluateStoryVisualQa(story);
  assert.ok(r.failures.includes("title_text_present"));
  assert.equal(r.result, "fail");
});

test("visual QA: writes both JSON and Markdown artefacts", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-qa-"));
  try {
    const story = {
      id: "qa-write",
      title: "Aurora Drift Beta Confirmed",
      suggested_thumbnail_text: "AURORA DRIFT BETA",
      flair: "Confirmed",
      downloaded_images: [
        { path: "p://k.jpg", type: "key_art", source: "steam", priority: 95 },
        {
          path: "p://s.jpg",
          type: "screenshot",
          source: "steam",
          priority: 88,
        },
      ],
      video_clips: [],
    };
    const r = evaluateStoryVisualQa(story);
    const { jsonPath, mdPath } = await writeQaArtefacts(r, tmp);
    assert.ok(await fs.pathExists(jsonPath));
    assert.ok(await fs.pathExists(mdPath));
    const md = await fs.readFile(mdPath, "utf8");
    assert.match(md, /# Visual QA — story qa-write/);
    assert.match(md, /inventory class:/);
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("visual QA: renderQaMarkdown gives a structured report", () => {
  const story = {
    id: "qa-md",
    title: "X",
    suggested_thumbnail_text: "X",
    downloaded_images: [
      { path: "p://k.jpg", type: "key_art", source: "steam", priority: 95 },
      { path: "p://s.jpg", type: "screenshot", source: "steam", priority: 88 },
    ],
    video_clips: [],
  };
  const md = renderQaMarkdown(evaluateStoryVisualQa(story));
  assert.match(md, /# Visual QA/);
  assert.match(md, /## Checks/);
});
