"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  analyseCoverText,
  buildFirstFrameThumbnailReport,
  formatFirstFrameThumbnailMarkdown,
  scoreFirstFrameThumbnailStory,
} = require("../../lib/ops/first-frame-thumbnail-engine");

function action(storyId, platform, overrides = {}) {
  return {
    story_id: storyId,
    platform,
    title: "Super Mario RPG Drops To $15",
    video_path: `output/goal-proof/batch/${storyId}/visual_v4_render.mp4`,
    cover_frame_source: `output/goal-proof/batch/${storyId}/platform_variants/${platform}/cover.jpg`,
    platform_enabled: ["youtube_shorts", "instagram_reels", "facebook_reels"].includes(platform),
    ...overrides,
  };
}

test("analyseCoverText flags repeated and dangling mobile-cover copy", () => {
  const result = analyseCoverText("THE EXPANSE THE EXPANSE:");

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("cover_text_repeated_token"));
  assert.ok(result.blockers.includes("cover_text_dangling_or_truncated"));
});

test("scoreFirstFrameThumbnailStory passes clean mobile-readable platform covers", () => {
  const report = scoreFirstFrameThumbnailStory({
    story: {
      id: "story-clean",
      title: "Super Mario RPG Drops To $15",
      status: "publish_ready",
      source: { source_type: "rss" },
    },
    canonicalManifest: {
      canonical_subject: "Super Mario RPG",
      selected_title: "Super Mario RPG Drops To $15",
      thumbnail_headline: "SUPER MARIO RPG DROPS",
      first_spoken_line: "Super Mario RPG just dropped to $15 at GameStop.",
      primary_source: "GameStop",
    },
    actions: [
      action("story-clean", "youtube_shorts"),
      action("story-clean", "instagram_reels"),
      action("story-clean", "facebook_reels"),
    ],
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.mobile_readability.verdict, "pass");
  assert.equal(report.title_source_parity.verdict, "pass");
  assert.equal(report.platform_cover_matrix.ready_enabled_platforms, 3);
  assert.deepEqual(report.blockers, []);
});

test("scoreFirstFrameThumbnailStory blocks weak first-frame and cover evidence", () => {
  const report = scoreFirstFrameThumbnailStory({
    story: {
      id: "story-bad",
      title: "Cuphead DLC Gets Two New Games",
      status: "publish_ready",
    },
    canonicalManifest: {
      canonical_subject: "The Expanse Osiris Reborn",
      selected_title: "The Expanse: Osiris Reborn Shows Gameplay",
      thumbnail_headline: "THE EXPANSE THE EXPANSE:",
      first_spoken_line: "The Expanse Osiris Reborn finally shows gameplay.",
      primary_source: "Xbox Wire",
    },
    actions: [
      action("story-bad", "youtube_shorts", { cover_frame_source: "" }),
      action("story-bad", "instagram_reels", { title: "Cuphead DLC Gets Two New Games" }),
    ],
  });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.includes("cover_text_repeated_token"));
  assert.ok(report.blockers.includes("cover_text_dangling_or_truncated"));
  assert.ok(report.blockers.includes("title_source_parity_failed"));
  assert.ok(report.blockers.includes("platform_cover_source_missing:youtube_shorts"));
  assert.ok(report.blockers.includes("platform_cover_source_missing:facebook_reels"));
});

test("buildFirstFrameThumbnailReport creates repair backlog for blocked candidates", () => {
  const report = buildFirstFrameThumbnailReport({
    generatedAt: "2026-06-11T11:00:00.000Z",
    candidates: [
      {
        id: "story-clean",
        title: "Super Mario RPG Drops To $15",
        status: "publish_ready",
      },
      {
        id: "story-bad",
        title: "Cuphead DLC Gets Two New Games",
        status: "publish_ready",
      },
    ],
    canonicalManifests: {
      "story-clean": {
        canonical_subject: "Super Mario RPG",
        selected_title: "Super Mario RPG Drops To $15",
        thumbnail_headline: "SUPER MARIO RPG DROPS",
        first_spoken_line: "Super Mario RPG just dropped to $15 at GameStop.",
        primary_source: "GameStop",
      },
      "story-bad": {
        canonical_subject: "The Expanse Osiris Reborn",
        selected_title: "The Expanse: Osiris Reborn Shows Gameplay",
        thumbnail_headline: "THE EXPANSE THE EXPANSE:",
        first_spoken_line: "The Expanse Osiris Reborn finally shows gameplay.",
        primary_source: "Xbox Wire",
      },
    },
    actions: [
      action("story-clean", "youtube_shorts"),
      action("story-clean", "instagram_reels"),
      action("story-clean", "facebook_reels"),
      action("story-bad", "youtube_shorts", { cover_frame_source: "" }),
    ],
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.summary.green_story_count, 1);
  assert.equal(report.summary.red_story_count, 1);
  assert.equal(report.repair_backlog.length, 1);
  assert.equal(report.repair_backlog[0].story_id, "story-bad");
  assert.match(report.repair_backlog[0].recommended_command, /ops:first-frame-thumbnail/);

  const md = formatFirstFrameThumbnailMarkdown(report);
  assert.match(md, /First Frame/);
  assert.match(md, /story-bad/);
});
