"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { runContentQa } = require("../../lib/services/content-qa");

// 2026-04-29 follow-up to the production render regression.
// assemble.js now stamps render_lane / distinct_visual_count /
// outro_present / thumbnail_candidate_present / render_quality_class
// on every story. content-qa surfaces a warning when outro_present
// is false so an operator catches a missing-asset deploy before
// the next produce cycle.

// ── Source-string structural pins on assemble.js ──────────────────

const ASSEMBLE_SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "assemble.js"),
  "utf8",
);

test("assemble.js stamps render_lane on every story", () => {
  assert.match(
    ASSEMBLE_SRC,
    /story\.render_lane\s*=\s*"legacy_multi_image"/,
    "default render_lane must be stamped at the top of the produce loop",
  );
  assert.match(
    ASSEMBLE_SRC,
    /story\.render_lane\s*=\s*"legacy_single_image_fallback"/,
    "fallback path must update render_lane when ffmpeg drops to composite-only",
  );
});

test("assemble.js stamps render_quality_class derived from inventory size", () => {
  assert.match(
    ASSEMBLE_SRC,
    /story\.render_quality_class\s*=[\s\S]{0,200}?premium[\s\S]{0,200}?standard[\s\S]{0,200}?fallback[\s\S]{0,200}?reject/,
    "quality-class ladder premium → standard → fallback → reject must be present",
  );
});

test("assemble.js stamps distinct_visual_count + thumbnail_candidate_present + outro_present", () => {
  assert.match(
    ASSEMBLE_SRC,
    /story\.distinct_visual_count\s*=\s*realImages\.length/,
    "distinct_visual_count must alias realImages.length so dashboards have a self-describing field",
  );
  assert.match(
    ASSEMBLE_SRC,
    /story\.thumbnail_candidate_present\s*=\s*!!\(/,
    "thumbnail_candidate_present must check the candidate path chain",
  );
  assert.match(
    ASSEMBLE_SRC,
    /story\.outro_present\s*=\s*await\s+fs\.pathExists\(OUTRO_CARD\)/,
    "outro_present must reflect whether the OUTRO_CARD file resolved",
  );
});

test("assemble.js fallback path lowers render_quality_class to fallback when single-image fires", () => {
  // Look for the fallback block that updates render_quality_class
  // to "fallback". The block also flips render_lane.
  assert.match(
    ASSEMBLE_SRC,
    /render_lane\s*=\s*"legacy_single_image_fallback"[\s\S]{0,200}?render_quality_class\s*=\s*"fallback"/,
    "fallback block must downgrade render_quality_class when entering composite-only mode",
  );
});

// ── content-qa picks up outro_present ─────────────────────────────

test("assemble.js can force selected legacy unstamped renders through fresh rerender", () => {
  assert.match(
    ASSEMBLE_SRC,
    /FORCE_RERENDER_LEGACY_UNSTAMPED/,
    "operator-targeted legacy rerender flag must exist",
  );
  assert.match(
    ASSEMBLE_SRC,
    /legacy unstamped render selected for fresh rerender[\s\S]{0,240}?s\.exported_path\s*=\s*null/,
    "legacy unstamped rerender path must clear only exported_path so assemble regenerates the MP4",
  );
});

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
    id: "fix-render-meta",
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

test("content-qa: outro_present=false produces a warning", async () => {
  const story = passingStory({ outro_present: false });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.equal(qa.result, "warn");
  assert.ok(
    qa.warnings.includes("outro_card_missing_at_render_time"),
    `expected outro warning, got ${JSON.stringify(qa.warnings)}`,
  );
});

test("content-qa: outro_present=true produces no outro warning", async () => {
  const story = passingStory({ outro_present: true });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  for (const w of qa.warnings) {
    assert.ok(
      !/outro_card_missing/.test(w),
      `unexpected outro warning when outro_present=true: ${w}`,
    );
  }
});

test("content-qa: outro_present field absent (pre-stamp story) produces no outro warning", async () => {
  // Back-compat: stories from before the stamp shipped do not
  // carry outro_present at all. The gate must NOT fire on those.
  const story = passingStory({ allow_legacy_unstamped_render: true });
  delete story.render_lane;
  delete story.render_quality_class;
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  for (const w of qa.warnings) {
    assert.ok(
      !/outro_card_missing/.test(w),
      `unexpected outro warning on stamp-less story: ${w}`,
    );
  }
});
