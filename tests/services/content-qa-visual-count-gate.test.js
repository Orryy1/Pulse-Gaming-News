"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  runContentQa,
  MIN_DISTINCT_VISUAL_COUNT,
} = require("../../lib/services/content-qa");

// 2026-04-29 incident continuation: assemble.js stamps qa_visual_count
// after image gathering. This file pins the publish-time gate that
// reads it. Default behaviour is warn (record-only first publish
// cycle). Operator flips BLOCK_THIN_VISUALS=true on Railway env to
// make the same condition fail-and-skip. Per-story bypass via
// story.allow_thin_visuals=true is reserved for the eventual
// breaking-news single-image template.

function fakeFs(map) {
  return {
    async pathExists(p) {
      return Object.prototype.hasOwnProperty.call(map, p) && map[p] !== null;
    },
    async stat(p) {
      if (!map[p]) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { size: map[p].size };
    },
  };
}

function passingStory(overrides = {}) {
  return {
    id: "fix-vc",
    title: "Test Story",
    exported_path: "/tmp/out.mp4",
    full_script:
      "Nintendo just turned a Switch 2 purchase into a much simpler decision. Nintendo says the new Choose Your Game Bundle launches in early June at participating retailers for four hundred and ninety nine dollars and ninety nine cents. The key detail is the download code. Buyers can choose Mario Kart World, Donkey Kong Bananza or Pokémon Pokopia, which makes the bundle easier to explain than a normal console listing. For players waiting on a first-party reason to upgrade, this is a cleaner pitch than a vague launch-window promise. Follow Pulse Gaming so you never miss a beat.",
    tts_script: "Short clean tts variant for TTS pass.",
    image_path: "/tmp/card.png",
    render_lane: "legacy_multi_image",
    render_quality_class: "standard",
    downloaded_images: [
      { path: "/tmp/hero.jpg", type: "article_hero" },
      { path: "/tmp/logo.png", type: "company_logo" },
    ],
    ...overrides,
  };
}

// ── default behaviour: record-only / warn (env unset) ──────────────

test("visual-count gate: env unset, qa_visual_count >= MIN → no warn from this gate", async () => {
  delete process.env.BLOCK_THIN_VISUALS;
  const story = passingStory({ qa_visual_count: 5 });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.equal(qa.result, "pass");
  for (const w of qa.warnings) {
    assert.ok(
      !/thin_visuals|no_real_images_used_composite/.test(w),
      `unexpected visual-count warning at count=5: ${w}`,
    );
  }
});

test("visual-count gate: env unset, qa_visual_count = 0 → warn (composite-only) but still publishable", async () => {
  delete process.env.BLOCK_THIN_VISUALS;
  const story = passingStory({
    qa_visual_count: 0,
    qa_visual_warning: "no_real_images_used_composite",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.equal(qa.result, "warn");
  assert.deepEqual(qa.failures, []);
  assert.ok(
    qa.warnings.some((w) => w.includes("no_real_images_used_composite")),
    `expected composite warning, got ${JSON.stringify(qa.warnings)}`,
  );
});

test("visual-count gate: env unset, qa_visual_count = 1 → warn (thin) but still publishable", async () => {
  delete process.env.BLOCK_THIN_VISUALS;
  const story = passingStory({
    qa_visual_count: 1,
    qa_visual_warning: "thin_visuals_below_three",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.equal(qa.result, "warn");
  assert.deepEqual(qa.failures, []);
  assert.ok(
    qa.warnings.some((w) => w.includes("thin_visuals_below_three")),
    `expected thin-visuals warning, got ${JSON.stringify(qa.warnings)}`,
  );
});

// ── env-flagged behaviour: hard fail when BLOCK_THIN_VISUALS=true ──

test("visual-count gate: BLOCK_THIN_VISUALS=true + low count → fail + thin_visuals_blocked reason", async () => {
  const story = passingStory({
    qa_visual_count: 1,
    qa_visual_warning: "thin_visuals_below_three",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
    blockThinVisuals: true, // explicit override beats env for tests
  });
  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) => f.startsWith("thin_visuals_blocked:")),
    `expected thin_visuals_blocked failure, got ${JSON.stringify(qa.failures)}`,
  );
});

test("visual-count gate: BLOCK_THIN_VISUALS=true + zero count → fail + composite reason", async () => {
  const story = passingStory({ qa_visual_count: 0 });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
    blockThinVisuals: true,
  });
  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) => f.includes("no_real_images_used_composite")),
    `expected composite-blocked failure, got ${JSON.stringify(qa.failures)}`,
  );
});

test("visual-count gate: BLOCK_THIN_VISUALS=true + high count → no failure from this gate", async () => {
  const story = passingStory({ qa_visual_count: 5 });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
    blockThinVisuals: true,
  });
  assert.equal(qa.result, "pass");
});

// ── per-story override: allow_thin_visuals bypasses the gate ──────

test("visual-count gate: allow_thin_visuals=true bypasses the gate even when block flag is on", async () => {
  const story = passingStory({
    qa_visual_count: 1,
    qa_visual_warning: "thin_visuals_below_three",
    allow_thin_visuals: true,
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
    blockThinVisuals: true,
  });
  assert.equal(qa.result, "pass");
  assert.deepEqual(qa.failures, []);
  assert.deepEqual(qa.warnings, []);
});

// ── back-compat: stories rendered before the stamp shipped ────────

test("visual-count gate: story without qa_visual_count field is unaffected (back-compat)", async () => {
  delete process.env.BLOCK_THIN_VISUALS;
  // No qa_visual_count on the story — pre-stamp era. Gate should
  // not fire at all.
  const story = passingStory();
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.equal(qa.result, "pass");
  for (const w of qa.warnings) {
    assert.ok(
      !/thin_visuals|no_real_images_used_composite/.test(w),
      `unexpected visual-count warning on stamp-less story: ${w}`,
    );
  }
});

test("legacy unstamped render is blocked unless explicitly allowed", async () => {
  const story = passingStory({
    render_lane: undefined,
    render_quality_class: undefined,
    qa_visual_count: undefined,
  });
  const result = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 2_000_000 } }),
  });

  assert.equal(result.result, "fail");
  assert.ok(result.failures.includes("legacy_unstamped_render_requires_rerender"));
});

test("legacy unstamped render can be allowed for operator-only exceptions", async () => {
  const story = passingStory({
    render_lane: undefined,
    render_quality_class: undefined,
    qa_visual_count: undefined,
    allow_legacy_unstamped_render: true,
  });
  const result = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 2_000_000 } }),
  });

  assert.notEqual(result.result, "fail");
  assert.ok(!result.failures.includes("legacy_unstamped_render_requires_rerender"));
});

test("visual-count gate: MIN_DISTINCT_VISUAL_COUNT is exported and >= 3", () => {
  assert.equal(typeof MIN_DISTINCT_VISUAL_COUNT, "number");
  assert.ok(MIN_DISTINCT_VISUAL_COUNT >= 3);
});
