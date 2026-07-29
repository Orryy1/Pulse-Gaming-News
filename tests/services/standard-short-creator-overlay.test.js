"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStandardShortCreatorOverlayPlan,
  renderStandardShortCreatorOverlayMarkdown,
} = require("../../lib/studio/v2/standard-short-creator-overlay");
const { CTA_POLICY } = require("../../lib/services/pulse-editorial-contract");

const CONTEXTUAL_CTA = "Which version would you install first?";
const AUDIT_HASH = `sha256:${"a".repeat(64)}`;

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

function editorialStory(overrides = {}) {
  return {
    id: "story-1",
    editorial_lane_id: "what_changes_for_players",
    hook_type: "direct",
    duration_band_id: "what_changes_standard_35_42",
    ...overrides,
  };
}

test("standard short creator overlay builds punch captions and entity popups for game mentions", () => {
  const plan = buildStandardShortCreatorOverlayPlan({
    story: editorialStory({
      id: "story-1",
      title:
        "Take-Two killed a legacy sequel while GTA, Red Dead and BioShock fans watched",
      source_type: "rss",
      subreddit: "GameSpot",
      content_pillar: "Confirmed Drop",
      full_script:
        "Take-Two just made a surprising call. GTA, Red Dead and BioShock fans all have a reason to care.",
    }),
    scenes: scenes(),
    durationS: 38,
  });

  assert.equal(plan.verdict, "ready_for_standard_short_overlay");
  assert.equal(plan.caption_rules.max_words_per_punch, 2);
  assert.equal(plan.caption_rules.max_phrase_chars, 14);
  assert.deepEqual(
    plan.entity_popups.map((popup) => popup.entity),
    ["GTA", "Red Dead", "BioShock"],
  );
  assert.ok(
    plan.timeline.some(
      (item) => item.kind === "micro_card" && item.label === "WHY IT MATTERS",
    ),
  );
  assert.ok(
    plan.timeline.some(
      (item) => item.kind === "source_badge" && item.label === "GAMESPOT",
    ),
  );
});

test("standard short creator overlay refuses fake Reddit comment styling for RSS stories", () => {
  const plan = buildStandardShortCreatorOverlayPlan({
    story: editorialStory({
      id: "rss-story",
      source_type: "rss",
      subreddit: "GameSpot",
      top_comment: "This is actually the RSS description from the article.",
    }),
    scenes: scenes(),
    durationS: 38,
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
    story: editorialStory({ id: "thin", source_type: "rss", subreddit: "IGN" }),
    scenes: [
      { type: "opener", label: "opener" },
      { type: "card.source", label: "source" },
      { type: "card.stat", label: "context" },
      { type: "card.timeline", label: "timeline" },
      { type: "card.takeaway", label: "takeaway" },
    ],
    durationS: 38,
  });

  assert.equal(dense.verdict, "needs_standard_overlay_rebuild");
  assert.ok(dense.blockers.includes("standard_short_card_ratio_too_high"));
  assert.ok(
    dense.recommendations.includes("replace_fullscreen_cards_with_popups"),
  );
});

test("standard short creator overlay markdown is readable for operators", () => {
  const plan = buildStandardShortCreatorOverlayPlan({
    story: editorialStory({
      id: "story-1",
      source_type: "reddit",
      subreddit: "GamingLeaksAndRumours",
    }),
    scenes: scenes(),
    durationS: 38,
  });
  const md = renderStandardShortCreatorOverlayMarkdown(plan);

  assert.match(md, /Standard Short Creator Overlay v1/);
  assert.match(md, /Caption Rules/);
  assert.match(md, /Entity Popups/);
});

test("standard short creator overlay includes CTA only for a governed selected cohort", () => {
  const selected = buildStandardShortCreatorOverlayPlan({
    story: editorialStory({
      id: "selected-cta",
      source_type: "rss",
      subreddit: "IGN",
      cta: CONTEXTUAL_CTA,
      full_script: `Achievements are now confirmed. ${CONTEXTUAL_CTA}`,
      cta_policy: {
        policy_version: CTA_POLICY.version,
        scope: "shorts",
        include_cta: true,
        copy_strategy: CTA_POLICY.copy_strategy,
        cohort_bucket: 0,
        cohort_numerator: 1,
        cohort_denominator: 3,
        audit_hash: AUDIT_HASH,
      },
    }),
    scenes: scenes(),
    durationS: 40,
  });
  const ctaChip = selected.timeline.find((item) => item.kind === "cta_chip");
  assert.equal(ctaChip.label, CONTEXTUAL_CTA);
  assert.equal(ctaChip.at_s, 37);
  assert.equal(selected.cta_policy.renderer_applied, true);
  assert.equal(selected.cta_policy.audit_hash, AUDIT_HASH);

  const omitted = buildStandardShortCreatorOverlayPlan({
    story: editorialStory({
      id: "omitted-cta",
      source_type: "rss",
      subreddit: "IGN",
      cta_policy: {
        policy_version: CTA_POLICY.version,
        scope: "shorts",
        include_cta: false,
        copy_strategy: "none",
        cohort_bucket: 1,
        cohort_numerator: 1,
        cohort_denominator: 3,
        audit_hash: AUDIT_HASH,
      },
    }),
    scenes: scenes(),
    durationS: 40,
  });
  assert.equal(
    omitted.timeline.some((item) => item.kind === "cta_chip"),
    false,
  );
  assert.equal(omitted.cta_policy.renderer_applied, false);
});

test("standard short creator overlay enforces the selected editorial band", () => {
  const outsideBand = buildStandardShortCreatorOverlayPlan({
    story: editorialStory(),
    scenes: scenes(),
    durationS: 62,
  });
  assert.ok(
    outsideBand.blockers.includes(
      "standard_short_duration_outside_selected_band",
    ),
  );

  const missingMetadata = buildStandardShortCreatorOverlayPlan({
    story: { id: "missing-contract" },
    scenes: scenes(),
    durationS: 38,
  });
  assert.match(
    missingMetadata.blockers[0],
    /^pulse_editorial_contract_metadata_missing:/,
  );
});
