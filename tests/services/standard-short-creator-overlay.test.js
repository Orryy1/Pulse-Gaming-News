"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStandardShortCreatorOverlayPlan,
  renderStandardShortCreatorOverlayMarkdown,
} = require("../../lib/studio/v2/standard-short-creator-overlay");

function scenes() {
  return [
    { type: "opener", label: "opener_hero", entity: "GTA", duration: 4 },
    { type: "clip.frame", label: "frame_gta", entity: "GTA", duration: 4 },
    { type: "still", label: "red_dead", entity: "Red Dead", duration: 4 },
    { type: "card.source", label: "source", duration: 4 },
    { type: "still", label: "bioshock", entity: "BioShock", duration: 4 },
    { type: "card.stat", label: "context", duration: 4 },
    { type: "card.takeaway", label: "takeaway", duration: 4 },
  ];
}

test("standard short creator overlay builds punch captions and entity popups for game mentions", () => {
  const plan = buildStandardShortCreatorOverlayPlan({
    story: {
      id: "story-1",
      title: "Take-Two killed a legacy sequel while GTA, Red Dead and BioShock fans watched",
      source_type: "rss",
      subreddit: "GameSpot",
      content_pillar: "Confirmed Drop",
      full_script:
        "Take-Two just made a surprising call. GTA, Red Dead and BioShock fans all have a reason to care.",
    },
    scenes: scenes(),
    durationS: 62,
  });

  assert.equal(plan.verdict, "ready_for_standard_short_overlay");
  assert.equal(plan.caption_rules.max_words_per_punch, 2);
  assert.equal(plan.caption_rules.max_phrase_chars, 14);
  assert.deepEqual(
    plan.entity_popups.map((popup) => popup.entity),
    ["GTA", "Red Dead", "BioShock"],
  );
  assert.ok(plan.timeline.some((item) => item.kind === "micro_card" && item.label === "WHY IT MATTERS"));
  assert.ok(plan.timeline.some((item) => item.kind === "source_badge" && item.label === "GAMESPOT"));
});

test("standard short creator overlay refuses fake Reddit comment styling for RSS stories", () => {
  const plan = buildStandardShortCreatorOverlayPlan({
    story: {
      id: "rss-story",
      source_type: "rss",
      subreddit: "GameSpot",
      top_comment: "This is actually the RSS description from the article.",
    },
    scenes: scenes(),
    durationS: 55,
  });

  assert.equal(plan.comment_overlay.allowed, false);
  assert.equal(plan.comment_overlay.source_type, "rss_description_only");
  assert.equal(
    plan.timeline.some((item) => /reddit/i.test(item.label || "")),
    false,
  );
});

test("standard short creator overlay downgrades dense card-led scenes before they look premium", () => {
  const dense = buildStandardShortCreatorOverlayPlan({
    story: { id: "thin", source_type: "rss", subreddit: "IGN" },
    scenes: [
      { type: "opener", label: "opener" },
      { type: "card.source", label: "source" },
      { type: "card.stat", label: "context" },
      { type: "card.timeline", label: "timeline" },
      { type: "card.takeaway", label: "takeaway" },
    ],
    durationS: 61,
  });

  assert.equal(dense.verdict, "needs_standard_overlay_rebuild");
  assert.ok(dense.blockers.includes("standard_short_card_ratio_too_high"));
  assert.ok(dense.recommendations.includes("replace_fullscreen_cards_with_popups"));
});

test("standard short creator overlay markdown is readable for operators", () => {
  const plan = buildStandardShortCreatorOverlayPlan({
    story: { id: "story-1", source_type: "reddit", subreddit: "GamingLeaksAndRumours" },
    scenes: scenes(),
    durationS: 62,
  });
  const md = renderStandardShortCreatorOverlayMarkdown(plan);

  assert.match(md, /Standard Short Creator Overlay v1/);
  assert.match(md, /Caption Rules/);
  assert.match(md, /Entity Popups/);
});
