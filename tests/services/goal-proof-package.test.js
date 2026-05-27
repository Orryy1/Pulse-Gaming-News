"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoalProofPackage,
  writeGoalProofPackageArtifacts,
} = require("../../lib/goal-proof-package");
const { buildAffiliateLinkManifest } = require("../../lib/commercial-intelligence-engine");

const story = require("../../test/fixtures/goal/mixtape-governance-story.json");
const rightsLedger = require("../../test/fixtures/goal/mixtape-rights-ledger.json");

function greenStory() {
  const clips = Array.from({ length: 7 }, (_, index) => ({
    id: `forza-clip-${index + 1}`,
    type: "official_trailer_clip",
    path: `output/video/forza-clip-${index + 1}.mp4`,
    source_url: `https://cdn.example.com/forza-clip-${index + 1}.mp4`,
    rights_risk_class: "official_reference_only",
    source_type: "official_trailer",
    source_family: `forza_family_${index + 1}`,
    durationS: 2.8,
    validated: true,
  }));
  const sfxAssets = [
    {
      asset_id: "boom-impact-01",
      role: "impact",
      family: "impact",
      provider_id: "boom_library",
      source_url: "file://audio/licensed-sfx/boom/impact-01.wav",
      licence_basis: "boom_library_media_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "soundly-transition-01",
      role: "transition",
      family: "whoosh",
      provider_id: "soundly",
      source_url: "file://audio/licensed-sfx/soundly/transition-01.wav",
      licence_basis: "soundly_pro_commercial_use",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "soundly-hit-01",
      role: "transition",
      family: "transition_hit",
      provider_id: "soundly",
      source_url: "file://audio/licensed-sfx/soundly/hit-01.wav",
      licence_basis: "soundly_pro_commercial_use",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "sonniss-ui-01",
      role: "ui_tick",
      family: "source_tick",
      provider_id: "sonniss",
      source_url: "file://audio/licensed-sfx/sonniss/ui-01.wav",
      licence_basis: "sonniss_game_audio_gdc_bundle_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "sonniss-chart-01",
      role: "ui_tick",
      family: "chart_tick",
      provider_id: "sonniss",
      source_url: "file://audio/licensed-sfx/sonniss/chart-01.wav",
      licence_basis: "sonniss_game_audio_gdc_bundle_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "pse-riser-01",
      role: "riser",
      family: "riser",
      provider_id: "pro_sound_effects",
      source_url: "file://audio/licensed-sfx/pse/riser-01.wav",
      licence_basis: "pro_sound_effects_subscription_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "boom-sub-01",
      role: "sub_hit",
      family: "sub_hit",
      provider_id: "boom_library",
      source_url: "file://audio/licensed-sfx/boom/sub-01.wav",
      licence_basis: "boom_library_media_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
  ];
  return {
    id: "forza-green-proof",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_angle: "paid early access created a major Steam demand signal",
    title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    public_title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_thumbnail_text: "FORZA STEAM SPIKE",
    thumbnail_source_label: "GamesRadar+",
    source_card_label: "GamesRadar+",
    source_name: "GamesRadar+",
    primary_source: "GamesRadar+",
    article_url: "https://www.gamesradar.com/forza-horizon-6-steam",
    manual_caption_generated: true,
    transformative_edit_evidence: true,
    audio_path: "output/audio/forza-green-proof.mp3",
    full_script:
      "Forza Horizon 6 just gave Xbox the paid access warning it needed. GamesRadar+ reports 178,009 concurrent Steam players and a 92 Metacritic aggregate. The catch is that this happened before the standard launch, with some players paying $120. That means demand is real, but the final ceiling is not settled yet. Follow Pulse Gaming so you never miss a beat.",
    video_clips: clips,
    sfx_asset_inventory: sfxAssets,
    affiliate_link_manifest: {
      story_id: "forza-green-proof",
      vertical: "gaming",
      disclosure_required: false,
      primary_link: null,
      fallback_links: [],
    },
  };
}

function rightsForGreenStory(story) {
  return [
    ...story.video_clips.map((clip) => ({
      asset_id: clip.id,
      path: clip.path,
      source_url: clip.source_url,
      source_type: clip.source_type,
      licence_basis: "official_reference_transformative_short",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
      commercial_use_allowed: true,
      risk_score: 0.18,
      evidence_file: `rights/${clip.id}.json`,
    })),
    {
      asset_id: `${story.id}_audio_path`,
      path: story.audio_path,
      source_url: "local://tts/liam",
      source_type: "local_tts_voice",
      licence_basis: "owned_local_voice_model",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
      commercial_use_allowed: true,
      risk_score: 0.05,
      evidence_file: "rights/local-tts.json",
    },
    ...story.sfx_asset_inventory.map((asset) => ({
      ...asset,
      asset_type: "sfx",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
      risk_score: 0.08,
      evidence_file: `rights/${asset.asset_id}.json`,
    })),
  ];
}

function normalise(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

test("goal proof package builds the remaining creative and commercial artefacts", () => {
  const pack = buildGoalProofPackage({
    story,
    rightsLedger,
    generatedAt: "2026-05-21T19:45:00.000Z",
  });

  assert.equal(pack.story_id, "mixtape-governance-proof");
  assert.equal(pack.script_scorecard.story_id, story.id);
  assert.equal(pack.footage_inventory.story_id, story.id);
  assert.equal(pack.director_beat_map.story_id, story.id);
  assert.equal(pack.audio_manifest.story_id, story.id);
  assert.equal(pack.sfx_manifest.cue_count, pack.audio_manifest.sfx_cue_count);
  assert.equal(pack.affiliate_link_manifest.story_id, story.id);
  assert.equal(pack.platform_publish_manifest.platform_mirroring_detection.verdict, "pass");
  assert.equal(pack.safety.no_publishing_side_effects, true);
  assert.equal(pack.safety.production_db_mutated, false);
});

test("goal proof package produces a GREEN acceptance entry only when every core gate passes", () => {
  const story = greenStory();
  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-21T19:46:00.000Z",
  });

  assert.equal(pack.acceptance_entry.verdict, "GREEN");
  assert.equal(pack.acceptance_entry.story_id, "forza-green-proof");
  assert.equal(pack.sfx_manifest.source_plan.readiness.status, "pass");
  assert.ok(pack.acceptance_entry.artefacts.includes("script_scorecard.json"));
  assert.ok(pack.acceptance_entry.artefacts.includes("platform_publish_manifest.json"));
});

test("goal proof package proves each social pack is platform-native rather than mirrored", () => {
  const story = greenStory();
  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-22T15:45:00.000Z",
  });

  const evidence = pack.platform_publish_manifest.platform_native_evidence;
  assert.equal(evidence.verdict, "pass");
  assert.deepEqual(
    evidence.platforms.map((item) => item.platform).sort(),
    [
      "facebook_reels",
      "instagram_reels",
      "pinterest",
      "threads",
      "tiktok",
      "x",
      "youtube_shorts",
    ],
  );
  assert.equal(evidence.blind_duplicate_pairs.length, 0);
  assert.equal(pack.platform_variant_scorecard.platform_native_evidence.verdict, "pass");
  assert.equal(pack.tiktok_publish_pack.commercial_content_setting_recommendation, "not_required_unless_brand_or_product_promoted");
  assert.equal(pack.instagram_publish_pack.carousel_companion.required, true);
  assert.equal(pack.pinterest_publish_pack.landing_page_required, true);
  assert.notEqual(
    normalise(pack.x_publish_pack.source_safe_post),
    normalise(pack.threads_publish_pack.discussion_post),
  );
});

test("goal proof package never exposes internal source-lock placeholders in social packs", () => {
  const story = greenStory();
  story.id = "star-fox-placeholder-angle";
  story.canonical_subject = "Star Fox";
  story.canonical_game = "Star Fox";
  story.canonical_angle = "source_locked_update";
  story.title = "Star Fox Just Got A Switch 2 Route";
  story.suggested_title = "Star Fox Just Got A Switch 2 Route";
  story.public_title = "Star Fox Just Got A Switch 2 Route";
  story.suggested_thumbnail_text = "STAR FOX SWITCH 2";
  story.full_script =
    "Star Fox just got a Switch 2 route for players who missed the original window. IGN reports the feature is tied to the Nintendo Switch 2 camera setup. The useful point is access, not hype.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-22T17:15:00.000Z",
  });

  const publicSocialCopy = JSON.stringify(pack.platform_publish_manifest.outputs);
  assert.doesNotMatch(publicSocialCopy, /source_locked_update/i);
  assert.doesNotMatch(publicSocialCopy, /practical catch/i);
  assert.match(pack.x_publish_pack.concise_news_post, /Switch 2 route/i);
});

test("goal proof package carries landing-page attribution into publish packs", () => {
  const story = greenStory();
  story.affiliate_link_manifest = buildAffiliateLinkManifest({
    story,
    tag: "pulsegaming-21",
    generatedAt: "2026-05-22T16:45:00.000Z",
  });

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-22T16:46:00.000Z",
  });

  assert.equal(pack.landing_page_manifest.attribution_manifest.verdict, "pass");
  assert.equal(Object.keys(pack.landing_page_manifest.attribution_manifest.platforms).length, 7);
  assert.equal(
    pack.landing_page_manifest.link_pack.primary_link.id,
    story.affiliate_link_manifest.primary_link.id,
  );
  assert.equal(pack.platform_publish_manifest.landing_page_attribution.verdict, "pass");
  assert.match(
    pack.platform_publish_manifest.landing_page_attribution.platforms.youtube.landing_page_url,
    /utm_source=youtube/,
  );
  assert.match(pack.x_publish_pack.landing_page_link, /^\/p\//);
});

test("goal proof package keeps incomplete packages out of GREEN acceptance", () => {
  const pack = buildGoalProofPackage({
    story,
    rightsLedger,
    generatedAt: "2026-05-21T19:47:00.000Z",
  });

  assert.equal(pack.acceptance_entry.verdict, "RED");
  assert.ok(pack.acceptance_entry.blockers.includes("script:rewrite_required"));
  assert.ok(pack.acceptance_entry.blockers.includes("footage:v4_motion_blocked"));
});

test("goal proof package writes goal-named artefacts", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-proof-"));
  const pack = buildGoalProofPackage({
    story,
    rightsLedger,
    generatedAt: "2026-05-21T19:50:00.000Z",
  });

  const written = await writeGoalProofPackageArtifacts(pack, { outputDir: tmp });

  for (const basename of [
    "script_scorecard.json",
    "footage_inventory.json",
    "director_beat_map.json",
    "audio_manifest.json",
    "sfx_manifest.json",
    "visual_quality_report.json",
    "forensic_qa_report.json",
    "benchmark_report.json",
    "affiliate_link_manifest.json",
    "finance_crypto_risk_report.json",
    "uniqueness_report.json",
    "retention_report.json",
    "experiment_manifest.json",
    "platform_publish_manifest.json",
    "platform_variant_scorecard.json",
  ]) {
    assert.equal(await fs.pathExists(path.join(tmp, basename)), true, basename);
  }
  assert.equal(Object.keys(written).length >= 15, true);
});

test("goal proof package materialises every claimed GREEN acceptance artefact", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-proof-complete-"));
  const story = greenStory();
  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-21T23:40:00.000Z",
  });

  assert.equal(pack.acceptance_entry.verdict, "GREEN");
  await writeGoalProofPackageArtifacts(pack, { outputDir: tmp });

  for (const basename of pack.acceptance_entry.artefacts) {
    assert.equal(await fs.pathExists(path.join(tmp, basename)), true, basename);
  }
  const renderStat = await fs.stat(path.join(tmp, "visual_v4_render.mp4"));
  assert.ok(renderStat.size > 1000, "visual_v4_render.mp4 should be a real local proof video");
  const renderManifest = await fs.readJson(path.join(tmp, "render_manifest.json"));
  assert.equal(renderManifest.visual_tier, "local_proof_motion_graphic");
  assert.equal(renderManifest.final_publish_render, false);
});
