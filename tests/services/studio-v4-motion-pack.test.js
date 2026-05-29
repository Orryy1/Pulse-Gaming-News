"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  applyVisualV4MotionPackToStory,
  buildVisualV4MotionPack,
} = require("../../lib/studio/v4/motion-pack");
const {
  buildStudioV4CanonicalPacket,
} = require("../../lib/studio/v4/canonical-policy");
const { normaliseStory, parseArgs } = require("../../tools/studio-v4-motion-pack");
const packageJson = require("../../package.json");

function forzaStory(overrides = {}) {
  return {
    id: "forza-v4-pack",
    title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_thumbnail_text: "FORZA STEAM SPIKE",
    hook: "Forza just gave Xbox the headline it needed.",
    source_name: "Twisted Voxel",
    source_card_label: "Twisted Voxel",
    subtitle_timing_source: "timestamps",
    subtitle_timing_inspection: { usable: true },
    clean_manual_captions: true,
    manual_caption_generated: true,
    full_script:
      "Forza just gave Xbox the headline it needed. Twisted Voxel says Forza Horizon 6 now sits on a 92 Metacritic aggregate, with SteamDB showing 178,009 concurrent users during Premium Edition early access. The sharper detail is price: that Steam peak came at around $120 before the standard launch. That makes the number a paid-access stress test, not the final demand ceiling. Follow Pulse Gaming for the gaming stories behind the headline.",
    downloaded_images: [
      {
        type: "steam_header",
        source: "steam",
        path: "C:\\media\\forza-header.jpg",
        rights_risk_class: "steam_storefront_promotional",
      },
    ],
    ...overrides,
  };
}

function trustedReport(storyId = "forza-v4-pack", families = [
  "steam",
  "xbox",
  "forza",
  "twistedvoxel",
  "gamesradar",
  "ign",
  "digitalfoundry",
  "eurogamer",
]) {
  return {
    story_candidates: families.map((family, index) => ({
      story_id: storyId,
      entity: "Forza Horizon 6",
      source_id: `${family}-${index + 1}`,
      display_name: family,
      source_tier: family === "digitalfoundry" ? "licensed_creator" : "official",
      source_family: family,
      reference_url: `https://example.test/${family}`,
      source_url_kind: family === "steam" ? "hls_manifest" : "direct_video",
      segment_validation_eligible: true,
      autonomous_motion_candidate: true,
      allowed_render_use:
        family === "digitalfoundry"
          ? "licensed_short_clip_candidate"
          : "reference_only_by_default",
      rights_risk_class:
        family === "digitalfoundry"
          ? "licensed_creator_clip"
          : "official_reference_only",
    })),
  };
}

function segment({
  family,
  index,
  storyId = "forza-v4-pack",
  entity = "Forza Horizon 6",
  sourceUrl = null,
  actionScore = 88,
  validated = true,
  allowed = true,
  motionClass = "gameplay_action",
  start = 42,
  duration = 5,
  sourceType = "steam_movie",
  referenceTitle = null,
  trimRecommended = false,
  recommendedStart = null,
  recommendedDuration = null,
  validationReason = null,
} = {}) {
  return {
    story_id: storyId,
    clip_key: `${family}|${index}|${start}`,
    source_url:
      sourceUrl ||
      `https://video.fastly.steamstatic.com/store_trailers/2483190/${1000 + index}/${family}/clip.mp4`,
    source_family: family,
    source_type: sourceType,
    provider: family === "steam" ? "steam" : family,
    entity,
    store_app_id: family === "steam" ? "2483190" : null,
    movie_id: `${family}-${index}`,
    reference_title: referenceTitle || `${family} trailer ${index}`,
    media_start_s: start,
    duration_s: duration,
    segment_validated: validated,
    allowed_for_flash_lane: allowed,
    segment_motion_class: motionClass,
    action_score: actionScore,
    action_sample_count: 3,
    validation_reason: validationReason || (validated ? "segment_samples_passed" : "segment_failed"),
    trim_recommended: trimRecommended,
    recommended_media_start_s: recommendedStart,
    recommended_duration_s: recommendedDuration,
    samples: [
      { local_path: `test/output/${storyId}/${family}-${index}-a.jpg` },
      { local_path: `test/output/${storyId}/${family}-${index}-b.jpg` },
      { local_path: `test/output/${storyId}/${family}-${index}-c.jpg` },
    ],
  };
}

function segmentReport(segments) {
  return {
    schema_version: 1,
    generated_at: "2026-05-19T10:00:00.000Z",
    mode: "apply_local",
    apply_local: true,
    segments,
    summary: {
      segments_validated: segments.filter((item) => item.segment_validated).length,
    },
  };
}

function localTimeline() {
  return {
    duration_s: 42,
    beats: [
      {
        id: "hook",
        type: "hook",
        start: 0.05,
        end: 2.4,
        text: "Forza just gave Xbox the headline it needed.",
      },
      {
        id: "steam",
        type: "metric",
        start: 3.2,
        end: 6.2,
        metric: "178,009",
        text: "SteamDB showing 178,009 concurrent users",
      },
      {
        id: "score",
        type: "metric",
        start: 8.1,
        end: 10.2,
        metric: "92",
        text: "92 Metacritic aggregate",
      },
      {
        id: "price",
        type: "metric",
        start: 18.4,
        end: 20.1,
        metric: "$120",
        text: "around $120 before the standard launch",
      },
    ],
  };
}

function licensedSfxAssets() {
  return [
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
}

test("Visual V4 motion pack turns validated trailer segments into canonical local motion clips", () => {
  const families = ["steam", "xbox", "forza", "twistedvoxel"];
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      full_script:
        "Pokemon contamination from a bad upstream script should not make Nintendo sources relevant. Forza Horizon 6 is the actual subject.",
    }),
    trustedFootageReport: trustedReport("forza-v4-pack", families),
    segmentValidationReport: segmentReport(
      families.map((family, index) => segment({ family, index: index + 1 })),
    ),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.execution_mode, "visual_v4_motion_pack_builder");
  assert.equal(pack.local_only, true);
  assert.equal(pack.story_id, "forza-v4-pack");
  assert.equal(pack.clips.length, 4);
  assert.deepEqual(
    pack.clips.map((clip) => clip.source_family),
    families,
  );
  assert.ok(pack.clips.every((clip) => clip.validated === true));
  assert.ok(pack.clips.every((clip) => clip.type === "motion_clip"));
  assert.equal(pack.handoff.visual_v4_local_motion_clips.length, 4);
  assert.equal(pack.safety.video_downloads_started, false);
  assert.equal(pack.safety.production_db_mutated, false);
  assert.equal(pack.safety.social_posting_triggered, false);
});

test("Visual V4 motion pack keeps repeat official windows as motion beats without inflating family count", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      full_script:
        "Pokemon contamination from a bad upstream script should not make Nintendo sources relevant. Forza Horizon 6 is the actual subject.",
    }),
    trustedFootageReport: trustedReport(),
    segmentValidationReport: segmentReport([
      segment({ family: "steam", index: 1 }),
      segment({ family: "steam", index: 2, start: 54 }),
      segment({ family: "steam", index: 3, start: 66 }),
      segment({ family: "steam", index: 4, start: 78 }),
      segment({ family: "steam", index: 5, start: 90 }),
      segment({ family: "xbox", index: 1, actionScore: 52 }),
      segment({ family: "forza", index: 1, validated: false }),
      segment({
        family: "youtube",
        index: 1,
        sourceUrl: "https://www.youtube.com/watch?v=randomRef",
        sourceType: "igdb_video",
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.clips.length, 5);
  assert.ok(pack.clips.every((clip) => clip.source_family === "steam"));
  assert.equal(pack.motion_budget.available_distinct_families, 1);
  assert.equal(pack.readiness.blockers.includes("actual_motion_clip_minimum_not_met"), false);
  assert.equal(pack.readiness.blockers.includes("distinct_motion_families_minimum_not_met"), true);
  assert.ok(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "segment_action_score_too_low",
    ),
  );
  assert.ok(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "segment_not_validated",
    ),
  );
  assert.ok(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "segment_source_is_youtube_reference",
    ),
  );
});

test("Visual V4 motion pack accepts official product motion for hardware stories without relabelling it as gameplay", () => {
  const pack = buildVisualV4MotionPack({
    story: {
      id: "ps5-product-story",
      title: "PS5 Price Shift Puts Upgrade Timing Back In Play",
      suggested_title: "PS5 Price Shift Puts Upgrade Timing Back In Play",
      suggested_thumbnail_text: "PS5 PRICE SHIFT",
      full_script:
        "PS5 has a cleaner upgrade window now. PlayStation's product page shows the current console line-up while retailers adjust the price story around the next wave of players.",
    },
    trustedFootageReport: trustedReport("ps5-product-story", ["playstation_ps5_product_page"]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "ps5-product-story",
        family: "playstation_ps5_product_page",
        index: 1,
        sourceUrl: "https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/product-motion.mp4",
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 82,
        start: 4,
        duration: 3.8,
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].source_type, "official_platform_product_page");
  assert.equal(pack.clips[0].provenance.segment_motion_class, "official_product_motion");
  assert.ok(
    !pack.rejected_candidates.some(
      (candidate) => candidate.reason === "segment_not_gameplay_action",
    ),
  );
});

test("Visual V4 motion pack accepts official game storefront product motion when it matches the canonical game", () => {
  const pack = buildVisualV4MotionPack({
    story: {
      id: "expanse-osiris-reborn",
      title: "The Expanse Shows Real Gameplay",
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      full_script:
        "The Expanse: Osiris Reborn is finally showing real gameplay. Owlcat's official storefront video gives the story enough real motion to judge the new RPG properly.",
    },
    trustedFootageReport: trustedReport("expanse-osiris-reborn", [
      "xbox_store_the_expanse_osiris_reborn",
    ]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "expanse-osiris-reborn",
        family: "xbox_store_the_expanse_osiris_reborn",
        entity: "The Expanse: Osiris Reborn",
        index: 1,
        sourceUrl: "https://cdn.trailers.xboxservices.com/the-expanse-osiris-reborn.m3u8",
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 81.9,
        start: 36,
        duration: 5,
      }),
    ]),
    generatedAt: "2026-05-28T10:45:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].source_family, "xbox_store_the_expanse_osiris_reborn");
  assert.equal(pack.clips[0].provenance.segment_motion_class, "official_product_motion");
  assert.ok(
    !pack.rejected_candidates.some(
      (candidate) => candidate.reason === "segment_not_gameplay_action",
    ),
  );
});

test("Visual V4 motion pack accepts validated polished product motion at product-motion threshold", () => {
  const pack = buildVisualV4MotionPack({
    story: {
      id: "ps5-product-story",
      title: "PS5 Prices Went Up In Europe",
      suggested_title: "PS5 Prices Went Up In Europe",
      suggested_thumbnail_text: "PS5 PRICE JUMP",
      full_script:
        "PS5 prices went up across Europe and the UK. PlayStation Blog reports updated recommended retail prices for PS5, PS5 Digital Edition and PS5 Pro.",
    },
    trustedFootageReport: trustedReport("ps5-product-story", ["playstation_ps5_product_page"]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "ps5-product-story",
        family: "playstation_ps5_product_page",
        index: 1,
        sourceUrl: "https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/product-motion.mp4",
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 68.4,
        start: 4,
        duration: 3.8,
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].source_type, "official_platform_product_page");
  assert.equal(pack.clips[0].provenance.segment_motion_class, "official_product_motion");
  assert.ok(
    !pack.rejected_candidates.some(
      (candidate) => candidate.reason === "segment_action_score_too_low",
    ),
  );
});

test("Visual V4 motion pack accepts validated hardware lifestyle product motion", () => {
  const pack = buildVisualV4MotionPack({
    story: {
      id: "ps5-product-story",
      title: "PS5 Prices Went Up In Europe",
      suggested_title: "PS5 Prices Went Up In Europe",
      suggested_thumbnail_text: "PS5 PRICE JUMP",
      full_script:
        "PS5 prices went up across Europe and the UK. PlayStation Blog reports updated recommended retail prices for PS5, PS5 Pro and PlayStation Portal.",
    },
    trustedFootageReport: trustedReport("ps5-product-story", ["playstation_portal_product_page"]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "ps5-product-story",
        family: "playstation_portal_product_page",
        index: 1,
        sourceUrl: "https://gmedia.playstation.com/is/content/SIEPDC/global/portal/playstation-portal-lifestyle.mp4",
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 65.5,
        start: 4.3,
        duration: 5,
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].source_type, "official_platform_product_page");
  assert.equal(pack.clips[0].provenance.segment_motion_class, "official_product_motion");
  assert.ok(
    !pack.rejected_candidates.some(
      (candidate) => candidate.reason === "segment_action_score_too_low",
    ),
  );
});

test("Visual V4 motion pack can clear a hardware accessory story with two distinct official product-motion families", () => {
  const pack = buildVisualV4MotionPack({
    story: {
      id: "xbox-controller-accessory-story",
      title: "Xbox Controller Deal Has One Catch",
      canonical_subject: "Xbox Controller",
      canonical_game: "Xbox Controller",
      full_script:
        "The Forza Horizon 6 Xbox controller and headset leak is a hardware story, not a gameplay review.",
    },
    trustedFootageReport: trustedReport("xbox-controller-accessory-story", [
      "xbox_wireless_controller_official_product_page",
      "xbox_forza_horizon_6_controller_headset_product_page",
    ]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "xbox-controller-accessory-story",
        family: "xbox_wireless_controller_official_product_page",
        entity: "Xbox Controller",
        index: 1,
        sourceUrl: "https://cms-assets.xboxservices.com/controller-detail.mp4",
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 65.1,
        start: 4,
        duration: 4.2,
      }),
      segment({
        storyId: "xbox-controller-accessory-story",
        family: "xbox_forza_horizon_6_controller_headset_product_page",
        entity: "Xbox Controller",
        index: 2,
        sourceUrl: "https://cms-assets.xboxservices.com/forza-accessory-detail.mp4",
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 68.1,
        start: 5.75,
        duration: 4.2,
      }),
    ]),
    generatedAt: "2026-05-28T11:20:00.000Z",
  });

  assert.equal(pack.clips.length, 2);
  assert.equal(pack.readiness.status, "v4_motion_ready");
  assert.equal(pack.motion_budget.product_motion_story, true);
  assert.equal(pack.motion_budget.required_motion_scenes, 2);
  assert.equal(pack.motion_budget.required_distinct_families, 2);
  assert.equal(pack.motion_budget.available_official_product_motion_clips, 2);
  assert.equal(pack.motion_budget.available_official_product_motion_families, 2);
  assert.equal(pack.readiness.blockers.includes("actual_motion_clip_minimum_not_met"), false);
  assert.equal(pack.readiness.blockers.includes("distinct_motion_families_minimum_not_met"), false);
});

test("Visual V4 motion pack accepts official storefront cinematic motion without relabelling it as gameplay", () => {
  const pack = buildVisualV4MotionPack({
    story: {
      id: "star-wars-zero-company",
      title: "Star Wars Zero Company Is More Than XCOM",
      suggested_title: "Star Wars Zero Company Is More Than XCOM",
      suggested_thumbnail_text: "STAR WARS TACTICS",
      full_script:
        "Star Wars Zero Company is going bigger than a simple XCOM comparison. The official announce trailer shows a tactics game built around named squads, cinematic battles and a darker Clone Wars-era setup.",
    },
    trustedFootageReport: trustedReport("star-wars-zero-company", ["steam_2075800_876175"]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "star-wars-zero-company",
        family: "steam_2075800_876175",
        index: 1,
        sourceUrl: "https://video.akamai.steamstatic.com/store_trailers/2075800/876175/hash/hls_264_master.m3u8",
        sourceType: "steam_movie",
        motionClass: "official_storefront_cinematic_motion",
        validationReason: "official_storefront_cinematic_motion_samples_passed",
        actionScore: 63.4,
        start: 120,
        duration: 5,
        referenceTitle: "Star Wars Zero Company | Official Announce Trailer",
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].source_type, "steam_movie");
  assert.equal(pack.clips[0].provenance.segment_motion_class, "official_storefront_cinematic_motion");
  assert.ok(
    !pack.rejected_candidates.some(
      (candidate) => candidate.reason === "segment_not_gameplay_action",
    ),
  );
});

test("Visual V4 motion pack rejects official product motion when the story needs gameplay evidence", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", ["playstation_ps5_product_page"]),
    segmentValidationReport: segmentReport([
      segment({
        family: "playstation_ps5_product_page",
        index: 1,
        sourceUrl: "https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/product-motion.mp4",
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 82,
        start: 4,
        duration: 3.8,
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.clips.length, 0);
  assert.ok(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "segment_not_gameplay_action",
    ),
  );
});

test("Visual V4 motion pack can add one non-overlapping repeat after the distinct-family floor is met", () => {
  const families = ["steam", "xbox", "forza", "twistedvoxel", "gamesradar", "ign"];
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", families),
    segmentValidationReport: segmentReport([
      ...families.map((family, index) => segment({ family, index: index + 1 })),
      segment({
        family: "steam",
        index: 9,
        start: 54,
        sourceUrl:
          "https://video.fastly.steamstatic.com/store_trailers/2483190/1001/steam/clip.mp4",
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.clips.length, 7);
  assert.equal(new Set(pack.clips.map((clip) => clip.source_family)).size, 6);
  assert.equal(pack.motion_budget.available_distinct_families, 6);
  assert.equal(pack.readiness.status, "v4_motion_ready");
});

test("Visual V4 motion pack does not pad repeat slots with short trimmed montage cuts", () => {
  const families = ["steam", "xbox", "forza", "twistedvoxel", "gamesradar", "ign"];
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", families),
    segmentValidationReport: segmentReport([
      ...families.map((family, index) => segment({ family, index: index + 1 })),
      segment({
        family: "steam",
        index: 9,
        start: 298.53,
        actionScore: 95.5,
        trimRecommended: true,
        recommendedStart: 298.98,
        recommendedDuration: 2.95,
        validationReason: "trimmed_segment_samples_passed",
        sourceUrl:
          "https://video.fastly.steamstatic.com/store_trailers/2483190/1001/steam/clip.mp4",
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.clips.length, 6);
  assert.equal(new Set(pack.clips.map((clip) => clip.source_family)).size, 6);
  assert.ok(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "repeat_short_trimmed_montage_not_allowed",
    ),
  );
  assert.equal(pack.readiness.status, "v4_motion_blocked");
});

test("Visual V4 motion pack prefers continuous gameplay over short trimmed montage cuts", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", ["gamefront"]),
    segmentValidationReport: segmentReport([
      segment({
        family: "gamefront",
        index: 1,
        start: 298.53,
        actionScore: 95.5,
        trimRecommended: true,
        recommendedStart: 298.98,
        recommendedDuration: 2.95,
        validationReason: "trimmed_segment_samples_passed",
      }),
      segment({
        family: "gamefront",
        index: 2,
        start: 234.85,
        actionScore: 72.1,
        duration: 5,
        validationReason: "segment_samples_passed",
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].mediaStartS, 234.85);
  assert.equal(pack.clips[0].provenance.validation_reason, "segment_samples_passed");
});

test("Visual V4 motion pack treats validated official direct media as trust evidence without hiding motion scarcity", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "oblivion-pack",
      title: "Oblivion Remastered Needs More Gameplay Motion",
      suggested_title: "Oblivion Remastered Needs More Gameplay Motion",
      canonical_subject: "Oblivion Remastered",
      canonical_game: "Oblivion Remastered",
      full_script:
        "Oblivion Remastered needs enough real gameplay motion before Visual V4 can call the render ready.",
    }),
    trustedFootageReport: { story_candidates: [], accepted_sources: [] },
    segmentValidationReport: segmentReport([
      segment({
        family: "playstation_game_page_oblivion_remastered_hero_video",
        storyId: "oblivion-pack",
        index: 1,
        sourceType: "official_game_page_direct_video",
        sourceUrl:
          "https://gmedia.playstation.com/is/content/SIEPDC/global_pdc/en/games/pdps/t/the-elder-scrolls-iv-oblivion-remastered/hero-video.mp4",
        validationReason: "official_direct_media_segment_samples_passed",
      }),
    ]),
    generatedAt: "2026-05-22T11:00:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.trusted_source_pipeline.references_found, 1);
  assert.equal(
    pack.trusted_source_pipeline.trust_evidence_source,
    "validated_official_local_motion",
  );
  assert.equal(
    pack.readiness.blockers.includes("no_trusted_footage_references_for_story"),
    false,
  );
  assert.equal(pack.readiness.blockers.includes("actual_motion_clip_minimum_not_met"), true);
  assert.equal(pack.readiness.blockers.includes("distinct_motion_families_minimum_not_met"), true);
});

test("Visual V4 motion pack rejects promo-card source families as fake motion", () => {
  const families = [
    "steam",
    "xbox",
    "forza_horizon_official_x_fh6_legend_video",
    "twistedvoxel",
    "gamesradar",
    "ign",
    "digitalfoundry",
  ];
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", families),
    segmentValidationReport: segmentReport(
      families.map((family, index) =>
        segment({
          family,
          index: index + 1,
        }),
      ),
    ),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(
    pack.clips.some(
      (clip) => clip.source_family === "forza_horizon_official_x_fh6_legend_video",
    ),
    false,
  );
  assert.ok(
    pack.rejected_candidates.some(
      (candidate) =>
        candidate.source_family === "forza_horizon_official_x_fh6_legend_video" &&
        candidate.reason === "promo_card_source_family",
    ),
  );
});

test("Visual V4 motion pack rejects specialised accessibility visual clips for general story renders", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", [
      "steam",
      "xbox",
      "forza_horizon_official_x_fh6_accessibility_video",
      "twistedvoxel",
      "gamesradar",
      "ign",
      "digitalfoundry",
    ]),
    segmentValidationReport: segmentReport([
      segment({ family: "steam", index: 1 }),
      segment({ family: "xbox", index: 2 }),
      segment({
        family: "forza_horizon_official_x_fh6_accessibility_video",
        index: 3,
        validationReason: "branded_direct_media_motion_samples_passed",
      }),
      segment({ family: "twistedvoxel", index: 4 }),
      segment({ family: "gamesradar", index: 5 }),
      segment({ family: "ign", index: 6 }),
      segment({ family: "digitalfoundry", index: 7 }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(
    pack.clips.some(
      (clip) => clip.source_family === "forza_horizon_official_x_fh6_accessibility_video",
    ),
    false,
  );
  assert.ok(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "specialised_visual_source_family",
    ),
  );
});

test("Visual V4 motion pack accepts validator-approved short detail motion above the detail floor", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", ["honda_beat"]),
    segmentValidationReport: segmentReport([
      segment({
        family: "honda_beat",
        index: 1,
        actionScore: 69.3,
        validationReason: "short_direct_media_detail_motion_samples_passed",
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].source_family, "honda_beat");
  assert.equal(
    pack.clips[0].provenance.validation_reason,
    "short_direct_media_detail_motion_samples_passed",
  );
});

test("Visual V4 motion pack rejects overlapping alternate URLs for the same Steam trailer", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", [
      "steam_2483190_1133501958",
      "steam_forza_horizon_6_launch_trailer",
    ]),
    segmentValidationReport: segmentReport([
      segment({
        family: "steam_2483190_1133501958",
        index: 1,
        sourceUrl:
          "https://video.akamai.steamstatic.com/store_trailers/2483190/1133501958/hash/1778255437/hls_264_master.m3u8?t=1",
      }),
      segment({
        family: "steam_forza_horizon_6_launch_trailer",
        index: 2,
        sourceUrl:
          "https://video.fastly.steamstatic.com/store_trailers/2483190/1133501958/hash/1778255437/microtrailer.mp4",
        actionScore: 82,
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.ok(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "source_asset_window_too_close",
    ),
  );
});

test("Visual V4 motion pack canonicalises Steam aliases from the media URL", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", ["steam_4078430_1546933311"]),
    segmentValidationReport: segmentReport([
      segment({
        family: "steam_old_alias",
        index: 1,
        sourceUrl:
          "https://video.akamai.steamstatic.com/store_trailers/4078430/1546933311/hash/hls_264_master.m3u8",
        sourceType: "steam_storefront_video_reference",
      }),
    ]),
    generatedAt: "2026-05-26T09:25:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].source_family, "steam_4078430_1546933311");
  assert.equal(pack.clips[0].trusted_source_matched, true);
  assert.equal(pack.motion_budget.available_distinct_families, 1);
});

test("Visual V4 motion pack can use separate windows from one source asset without increasing family count", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", ["steam_2483190_1133501958"]),
    segmentValidationReport: segmentReport([
      42,
      50,
      58,
      66,
      74,
      82,
      90,
    ].map((start, index) =>
      segment({
        family: index === 0 ? "steam_2483190_1133501958" : `steam_alias_${index}`,
        index: index + 1,
        start,
        sourceUrl:
          "https://video.akamai.steamstatic.com/store_trailers/2483190/1133501958/hash/1778255437/hls_264_master.m3u8?t=1",
      }),
    )),
    generatedAt: "2026-05-26T09:15:00.000Z",
  });

  assert.equal(pack.clips.length, 7);
  assert.equal(new Set(pack.clips.map((clip) => clip.source_family)).size, 1);
  assert.equal(pack.motion_budget.available_motion_clips, 7);
  assert.equal(pack.motion_budget.available_distinct_families, 1);
  assert.equal(pack.readiness.blockers.includes("actual_motion_clip_minimum_not_met"), false);
  assert.equal(pack.readiness.blockers.includes("distinct_motion_families_minimum_not_met"), true);
});

test("Visual V4 motion pack maximises non-overlapping repeat windows before scoring near-duplicates", () => {
  const sourceUrl =
    "https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/hls_264_master.m3u8?t=1470853282";
  const pack = buildVisualV4MotionPack({
    story: {
      id: "steam-controller-pack",
      title: "Steam Controller Date May Have Leaked",
      canonical_subject: "Steam Controller",
      canonical_game: "Steam Controller",
      full_script:
        "Steam Controller timing may have leaked. Valve's official product video is useful motion evidence for the hardware story.",
    },
    trustedFootageReport: trustedReport("steam-controller-pack", ["steam_353370_37301"]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "steam-controller-pack",
        family: "steam_353370_37301",
        index: 1,
        sourceUrl,
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 84.8,
        start: 36,
        duration: 5,
      }),
      segment({
        storyId: "steam-controller-pack",
        family: "steam_353370_37301",
        index: 2,
        sourceUrl,
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 97.3,
        start: 42,
        duration: 5,
      }),
      segment({
        storyId: "steam-controller-pack",
        family: "steam_353370_37301",
        index: 3,
        sourceUrl,
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 99.7,
        start: 48,
        duration: 5,
      }),
      segment({
        storyId: "steam-controller-pack",
        family: "steam_353370_37301",
        index: 4,
        sourceUrl,
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 78.3,
        start: 54,
        duration: 5,
      }),
      segment({
        storyId: "steam-controller-pack",
        family: "steam_353370_37301",
        index: 5,
        sourceUrl,
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 84.9,
        start: 58.4,
        duration: 5,
      }),
      segment({
        storyId: "steam-controller-pack",
        family: "steam_353370_37301",
        index: 6,
        sourceUrl,
        sourceType: "official_platform_product_page",
        motionClass: "official_product_motion",
        validationReason: "official_product_motion_samples_passed",
        actionScore: 75.1,
        start: 60,
        duration: 5,
      }),
    ]),
    generatedAt: "2026-05-26T19:45:00.000Z",
  });

  assert.equal(pack.clips.length, 5);
  assert.deepEqual(
    pack.clips.map((clip) => clip.mediaStartS).sort((a, b) => a - b),
    [36, 42, 48, 54, 60],
  );
  assert.equal(pack.motion_budget.available_motion_clips, 5);
  assert.equal(pack.readiness.blockers.includes("actual_motion_clip_minimum_not_met"), false);
  assert.equal(pack.readiness.blockers.includes("distinct_motion_families_minimum_not_met"), true);
});

test("Visual V4 motion pack treats separate Steam movie ids as distinct motion families", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "hades-steam-pack",
      title: "Hades II Just Broke PlayStation's Silence",
      canonical_subject: "Hades II",
      canonical_game: "Hades II",
    }),
    trustedFootageReport: trustedReport("hades-steam-pack", [
      "steam_1145350_1078171228",
      "steam_1145350_831414",
      "steam_1145350_695850",
    ]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "hades-steam-pack",
        family: "steam",
        index: 1,
        sourceUrl:
          "https://video.akamai.steamstatic.com/store_trailers/1145350/1078171228/hash/hls_264_master.m3u8",
        referenceTitle: "Hades II v1.0 Showcase",
      }),
      segment({
        storyId: "hades-steam-pack",
        family: "steam",
        index: 2,
        sourceUrl:
          "https://video.akamai.steamstatic.com/store_trailers/1145350/831414/hash/hls_264_master.m3u8",
        referenceTitle: "Hades II Warsong Update",
      }),
      segment({
        storyId: "hades-steam-pack",
        family: "steam",
        index: 3,
        sourceUrl:
          "https://video.akamai.steamstatic.com/store_trailers/1145350/695850/hash/hls_264_master.m3u8",
        referenceTitle: "Hades II Early Access Showcase",
      }),
    ].map((row) => ({
      ...row,
      store_app_id: "1145350",
      movie_id: (row.source_url.match(/store_trailers\/\d+\/(\d+)/) || [])[1],
    }))),
    generatedAt: "2026-05-23T13:10:00.000Z",
  });

  assert.deepEqual(pack.clips.map((clip) => clip.source_family), [
    "steam_1145350_1078171228",
    "steam_1145350_831414",
    "steam_1145350_695850",
  ]);
  assert.equal(pack.motion_budget.available_distinct_families, 3);
  assert.equal(
    pack.rejected_candidates.some((candidate) => candidate.reason === "source_family_already_used"),
    false,
  );
});

test("Visual V4 motion pack preserves previously validated families during fresh scans", () => {
  const previousMotionPack = {
    clips: [
      {
        id: "v4_motion_1_gamefront",
        type: "motion_clip",
        source_family: "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
        source_url: "https://media.gamefront.test/forza-horizon-6-initial-drive.mp4",
        path: "https://media.gamefront.test/forza-horizon-6-initial-drive.mp4",
        source_type: "licensed_direct_media_url",
        provider: "gamefront",
        entity: "Forza Horizon 6",
        mediaStartS: 298.98,
        durationS: 2.85,
        validated: true,
        segmentValidationPassed: true,
        allowed_render_use: "reference_only_by_default",
        rights_risk_class: "official_reference_only",
        provenance: {
          story_id: "forza-v4-pack",
          segment_motion_class: "gameplay_action",
          segment_action_score: 95.5,
          validation_reason: "trimmed_segment_samples_passed",
          sample_paths: ["test/output/gamefront-a.jpg"],
        },
      },
    ],
  };

  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", [
      "steam",
      "gamereactor",
      "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
    ]),
    previousMotionPack,
    segmentValidationReport: segmentReport([
      segment({ family: "steam", index: 1, actionScore: 78.9, start: 36 }),
      segment({
        family: "gamereactor",
        index: 1,
        actionScore: 88.2,
        start: 90,
        sourceUrl: "https://media.gamereactor.test/forza-horizon-6-launch.mp4",
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.deepEqual(
    new Set(pack.clips.map((clip) => clip.source_family)),
    new Set([
      "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
      "gamereactor",
      "steam",
    ]),
  );
  const preserved = pack.clips.find(
    (clip) => clip.source_family === "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
  );
  assert.equal(preserved.provenance.source_report, "previous_visual_v4_motion_pack");
  assert.equal(preserved.mediaStartS, 298.98);
});

test("Visual V4 motion pack filters irrelevant trusted source families before handoff", () => {
  const report = {
    story_candidates: [
      {
        story_id: "forza-v4-pack",
        entity: "Forza Horizon 6",
        source_id: "xbox-forza",
        display_name: "Xbox official YouTube - Forza Horizon 6 launch trailer",
        source_tier: "official",
        source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
        reference_url: "https://www.youtube.com/watch?v=official",
        source_url_kind: "youtube_watch",
      },
      {
        story_id: "forza-v4-pack",
        entity: "Pokemon",
        source_id: "nintendo",
        display_name: "Nintendo of America official YouTube",
        source_tier: "official",
        source_family: "nintendo_america_official_youtube",
        reference_url: "https://www.youtube.com/@NintendoAmerica",
        source_url_kind: "youtube_page",
      },
      {
        story_id: "forza-v4-pack",
        entity: "PlayStation",
        source_id: "playstation",
        display_name: "PlayStation official YouTube",
        source_tier: "official",
        source_family: "playstation_official_youtube",
        reference_url: "https://www.youtube.com/@PlayStation",
        source_url_kind: "youtube_page",
      },
    ],
  };
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      full_script:
        "Pokemon contamination from a bad upstream script should not make Nintendo sources relevant. Forza Horizon 6 is the actual subject.",
    }),
    trustedFootageReport: report,
    segmentValidationReport: segmentReport([segment({ family: "steam", index: 1 })]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });
  const families = pack.trusted_source_pipeline.distinct_reference_families;

  assert.deepEqual(families, ["xbox_official_youtube_forza_horizon_6_launch_trailer"]);
  assert.ok(
    pack.trusted_source_pipeline.intake_queue.every((item) =>
      item.display_name.includes("Forza Horizon 6"),
    ),
  );
});

test("Visual V4 motion pack handoff can make the canonical packet render-ready", () => {
  const families = [
    "steam",
    "xbox",
    "forza",
    "twistedvoxel",
    "gamesradar",
    "ign",
    "digitalfoundry",
    "eurogamer",
  ];
  const story = forzaStory({ sfx_asset_inventory: licensedSfxAssets() });
  const pack = buildVisualV4MotionPack({
    story,
    trustedFootageReport: trustedReport("forza-v4-pack", families),
    segmentValidationReport: segmentReport(
      families.map((family, index) => segment({ family, index: index + 1, start: 42 + index * 6 })),
    ),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  applyVisualV4MotionPackToStory(story, pack);

  const packet = buildStudioV4CanonicalPacket({
    story,
    trustedFootageReport: trustedReport("forza-v4-pack", families),
    localTimeline: localTimeline(),
    generatedAt: "2026-05-19T10:06:00.000Z",
  });

  assert.equal(story.visual_v4_local_motion_clips.length, 8);
  assert.equal(packet.local_motion_clip_count, 8);
  assert.equal(packet.visual_v4_motion_pack.readiness.status, "v4_motion_ready");
  assert.equal(packet.readiness.status, "ready_for_studio_v4_render");
  assert.equal(packet.media_house_benchmark.result, "pass");
});

test("Studio V4 canonical packet can consume a motion pack directly from the story", () => {
  const families = [
    "steam",
    "xbox",
    "forza",
    "twistedvoxel",
    "gamesradar",
    "ign",
    "digitalfoundry",
    "eurogamer",
  ];
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", families),
    segmentValidationReport: segmentReport(
      families.map((family, index) => segment({ family, index: index + 1, start: 42 + index * 6 })),
    ),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  const packet = buildStudioV4CanonicalPacket({
    story: forzaStory({ visual_v4_motion_pack: pack, sfx_asset_inventory: licensedSfxAssets() }),
    trustedFootageReport: trustedReport("forza-v4-pack", families),
    localTimeline: localTimeline(),
    generatedAt: "2026-05-19T10:06:00.000Z",
  });

  assert.equal(packet.local_motion_clip_count, 8);
  assert.equal(packet.visual_v4_motion_pack.readiness.status, "v4_motion_ready");
  assert.equal(packet.readiness.status, "ready_for_studio_v4_render");
});

test("Visual V4 motion pack CLI is registered as a local manifest builder", () => {
  const args = parseArgs([
    "node",
    "tools/studio-v4-motion-pack.js",
    "--story-id",
    "forza-v4-pack",
    "--segment-report",
    "test/output/official_trailer_segment_validation_apply_local.json",
    "--max-clips",
    "8",
  ]);

  assert.equal(args.storyId, "forza-v4-pack");
  assert.equal(args.maxClips, 8);
  assert.match(
    packageJson.scripts["studio:v4:motion-pack"],
    /studio-v4-motion-pack\.js/,
  );
  assert.match(
    packageJson.scripts["ops:v4-motion-pack"],
    /studio-v4-motion-pack\.js/,
  );
});

test("Visual V4 motion pack CLI normalises story_id rows for goal package inputs", () => {
  const story = normaliseStory({
    story_id: "1s49ty7",
    selected_title: "Star Wars Zero Company Is More Than XCOM",
    canonical_game: "Star Wars Zero Company",
    narration_script: "Star Wars Zero Company is trying to be more than Star Wars XCOM.",
  });

  assert.equal(story.id, "1s49ty7");
  assert.equal(story.title, "Star Wars Zero Company Is More Than XCOM");
  assert.equal(story.game_title, "Star Wars Zero Company");
  assert.equal(story.full_script, "Star Wars Zero Company is trying to be more than Star Wars XCOM.");
});

test("Visual V4 motion pack CLI hydrates sparse cutover package rows from canonical manifests", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-pack-story-"));
  await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
    story_id: "1s49ty7",
    selected_title: "Star Wars Zero Company Is More Than XCOM",
    canonical_subject: "Star Wars Zero Company",
    canonical_game: "Star Wars Zero Company",
    narration_script: "Star Wars Zero Company is trying to be more than Star Wars XCOM.",
  });

  const story = normaliseStory({
    story_id: "1s49ty7",
    artifact_dir: dir,
    artefacts: ["canonical_story_manifest.json"],
  });

  assert.equal(story.id, "1s49ty7");
  assert.equal(story.title, "Star Wars Zero Company Is More Than XCOM");
  assert.equal(story.game_title, "Star Wars Zero Company");
  assert.equal(story.primary_entity, "Star Wars Zero Company");
  assert.equal(story.full_script, "Star Wars Zero Company is trying to be more than Star Wars XCOM.");
});
