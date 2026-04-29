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
      "A dead franchise just got resurrected and nobody saw it coming. Big studios are responding to a shift in the market that took three years to build and thirty seconds to explode. The numbers are staggering and the timing is surgical. Ubisoft confirmed the reveal is set for later this month and the embargo lifts at midday across every major territory. Sources have verified the timeline through two separate trade outlets and an internal calendar invite that leaked last week. Players are already speculating about what this means for the series going forward, and the marketing team is quietly scrubbing old posts in preparation for the new positioning. Follow Pulse Gaming so you never miss a drop, because this one moves fast.",
    tts_script: "Short clean tts variant for TTS pass.",
    image_path: "/tmp/card.png",
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
  const story = passingStory();
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
