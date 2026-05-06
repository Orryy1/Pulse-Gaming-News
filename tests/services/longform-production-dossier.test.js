"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  LONGFORM_FORMATS,
  buildLongformCandidateSelector,
  buildLongformProductionDossier,
  renderLongformDossierMarkdown,
} = require("../../lib/longform/production-dossier");

const FIXTURE_STORIES = [
  {
    id: "subnautica2",
    title: "Subnautica 2 release times confirmed for PC and Xbox",
    source_type: "rss",
    source_name: "Xbox Wire",
    url: "https://news.xbox.com/example/subnautica-2-release-times",
    flair: "Confirmed",
    breaking_score: 82,
    content_pillar: "Confirmed Drop",
    full_script:
      "Subnautica 2 now has confirmed release timings for PC and Xbox. The useful angle is exactly when players can start downloading.",
    platforms: ["PC", "Xbox"],
    release_date: "2026-05-09",
    media_inventory: {
      classification: "premium_video",
      exact_subject_asset_count: 6,
      validated_clip_count: 2,
      visual_strength_score: 84,
    },
  },
  {
    id: "switch2ff14",
    title: "FF14 director confirms Nintendo Switch 2 plans",
    source_type: "rss",
    source_name: "IGN",
    url: "https://ign.com/example/ff14-switch-2",
    flair: "Verified",
    breaking_score: 79,
    content_pillar: "Confirmed Drop",
    full_script:
      "The Final Fantasy 14 director has confirmed the team is thinking seriously about Nintendo Switch 2 support.",
    platforms: ["Nintendo Switch 2"],
    media_inventory: {
      classification: "standard_video",
      exact_subject_asset_count: 4,
      validated_clip_count: 1,
      visual_strength_score: 72,
    },
  },
  {
    id: "gta6trailer",
    title: "All the evidence that GTA 6's next trailer is nearly here",
    source_type: "rss",
    source_name: "GameSpot",
    url: "https://gamespot.com/example/gta-6-trailer-evidence",
    flair: "Rumour",
    breaking_score: 76,
    content_pillar: "Rumour Watch",
    full_script:
      "GTA 6 fans think the next trailer could be close, but Rockstar has not confirmed a date.",
    media_inventory: {
      classification: "standard_video",
      exact_subject_asset_count: 3,
      validated_clip_count: 0,
      visual_strength_score: 61,
    },
  },
  {
    id: "unsupported-date",
    title: "Mystery horror game may launch next month",
    source_type: "rss",
    source_name: "Unknown Blog",
    url: "https://example.com/mystery-horror-game",
    flair: "Rumour",
    breaking_score: 44,
    release_date: "2026-06-01",
    platforms: ["PC"],
    media_inventory: {
      classification: "blog_only",
      exact_subject_asset_count: 1,
      validated_clip_count: 0,
      visual_strength_score: 24,
    },
  },
];

test("longform format catalogue exposes all required formats", () => {
  const ids = LONGFORM_FORMATS.map((format) => format.id).sort();
  assert.deepEqual(ids, [
    "before_you_download",
    "daily_briefing",
    "monthly_release_radar",
    "trailer_breakdown",
    "weekly_roundup",
  ]);
});

test("longform selector favours confirmed high-media stories and labels rumours", () => {
  const selector = buildLongformCandidateSelector(FIXTURE_STORIES);
  assert.equal(selector.candidates[0].story_id, "subnautica2");
  assert.equal(selector.candidates[0].recommended_format, "monthly_release_radar");

  const rumour = selector.candidates.find((candidate) => candidate.story_id === "gta6trailer");
  assert.equal(rumour.source_confidence, "rumour");
  assert.ok(rumour.fact_check_flags.includes("rumour_must_be_labelled"));
});

test("monthly release radar dossier blocks unsupported release dates", () => {
  const dossier = buildLongformProductionDossier({
    formatId: "monthly_release_radar",
    stories: FIXTURE_STORIES,
    generatedAt: "2026-05-06T21:30:00.000Z",
  });

  assert.equal(dossier.safety.live_actions_allowed, false);
  assert.ok(dossier.fact_check_flags.includes("unsupported_release_date:unsupported-date"));
  assert.equal(dossier.publish_status, "local_prototype_only");
  assert.ok(dossier.segment_list.length >= 2);
});

test("longform dossier produces chapters, visual plan, SEO and Shorts spin-offs", () => {
  const dossier = buildLongformProductionDossier({
    formatId: "weekly_roundup",
    stories: FIXTURE_STORIES,
    generatedAt: "2026-05-06T21:35:00.000Z",
  });

  assert.ok(dossier.chapter_plan.length >= 3);
  assert.ok(dossier.visual_plan.every((entry) => entry.story_id));
  assert.ok(dossier.seo_package.title.includes("Pulse Gaming"));
  assert.ok(dossier.shorts_spin_off_plan.length >= 2);
});

test("longform markdown is operator-readable and clearly local-only", () => {
  const dossier = buildLongformProductionDossier({
    formatId: "daily_briefing",
    stories: FIXTURE_STORIES,
    generatedAt: "2026-05-06T21:40:00.000Z",
  });
  const markdown = renderLongformDossierMarkdown(dossier);

  assert.match(markdown, /# Pulse Gaming Longform Production Dossier/);
  assert.match(markdown, /local-only prototype/i);
  assert.match(markdown, /No upload/);
  assert.match(markdown, /Shorts Spin-Off Plan/);
});

