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
const {
  mergePreviousMotionPacks,
  normaliseStory,
  parseArgs,
  previousMotionPackFromFootageInventory,
} = require("../../tools/studio-v4-motion-pack");
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
  samples = null,
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
    samples:
      samples || [
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

test("Visual V4 motion pack honours validator-approved Steam storefront trailer motion threshold", () => {
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/3240220/840632/e563e0e788371fcadb925449e0ed485937ddb129/1750825067/hls_264_master.m3u8?t=1740681453";
  const pack = buildVisualV4MotionPack({
    story: {
      id: "gta-subscription-story",
      title: "GTA 5 Joins A Subscription Ahead Of GTA 6 Launch",
      suggested_title: "GTA 5 Joins A Subscription Ahead Of GTA 6 Launch",
      suggested_thumbnail_text: "GTA 5 SUBSCRIPTION",
      canonical_subject: "Grand Theft Auto V Enhanced",
      canonical_game: "Grand Theft Auto V Enhanced",
      full_script:
        "GTA 5 just became the GTA 6 waiting room. GameSpot reports GTA 5 has joined a subscription service ahead of GTA 6.",
    },
    trustedFootageReport: trustedReport("gta-subscription-story", ["steam_3240220_840632"]),
    segmentValidationReport: segmentReport([
      {
        story_id: "gta-subscription-story",
        clip_key: `${sourceUrl}|grand_theft_auto_v_enhanced|8.40`,
        source_url: sourceUrl,
        source_type: "steam_movie",
        provider: "steam",
        source_family: null,
        entity: "Grand Theft Auto V Enhanced",
        reference_title: "Cluckin' Bell Farm Raid",
        movie_id: "840632",
        store_app_id: "3240220",
        store_app_title: "Grand Theft Auto V Enhanced",
        media_start_s: 8.4,
        duration_s: 5,
        segment_validated: true,
        allowed_for_flash_lane: true,
        segment_motion_class: "gameplay_action",
        action_score: 64.9,
        action_sample_count: 0,
        validation_reason: "official_storefront_trailer_motion_samples_passed",
        samples: [
          { local_path: "test/output/gta/a.jpg" },
          { local_path: "test/output/gta/b.jpg" },
          { local_path: "test/output/gta/c.jpg" },
        ],
      },
    ]),
    generatedAt: "2026-06-12T13:08:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].source_family, "steam_3240220_840632");
  assert.equal(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "segment_action_score_too_low",
    ),
    false,
  );
});

test("Visual V4 motion pack honours validator-approved licensed direct storefront motion without repeat padding", () => {
  const pack = buildVisualV4MotionPack({
    story: {
      id: "sea-of-thieves-custom-seas",
      title: "Sea of Thieves Custom Seas Could Split Crews",
      suggested_title: "Sea of Thieves Custom Seas Could Split Crews",
      suggested_thumbnail_text: "CUSTOM SEAS",
      canonical_subject: "Sea of Thieves",
      canonical_game: "Sea of Thieves",
      full_script:
        "Sea of Thieves is testing Custom Seas, and Rare now has to prove private sessions can protect the magic without draining the chaos.",
    },
    trustedFootageReport: trustedReport("sea-of-thieves-custom-seas", [
      "steam_1172620_2026344220",
      "steam_1172620_2137521619",
      "steam_1172620_1980334430",
      "steam_1172620_204445374",
    ]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "sea-of-thieves-custom-seas",
        entity: "Sea of Thieves",
        family: "steam_1172620_2026344220",
        index: 1,
        sourceUrl:
          "https://video.fastly.steamstatic.com/store_trailers/1172620/2026344220/hash/hls_264_master.m3u8",
        sourceType: "licensed_direct_media_url",
        motionClass: "official_storefront_cinematic_motion",
        validationReason: "official_storefront_cinematic_motion_samples_passed",
        actionScore: 68,
      }),
      segment({
        storyId: "sea-of-thieves-custom-seas",
        entity: "Sea of Thieves",
        family: "steam_1172620_2137521619",
        index: 2,
        sourceUrl:
          "https://video.fastly.steamstatic.com/store_trailers/1172620/2137521619/hash/hls_264_master.m3u8",
        sourceType: "licensed_direct_media_url",
        motionClass: "official_storefront_cinematic_motion",
        validationReason: "official_storefront_cinematic_motion_samples_passed",
        actionScore: 75,
      }),
      segment({
        storyId: "sea-of-thieves-custom-seas",
        entity: "Sea of Thieves",
        family: "steam_1172620_1980334430",
        index: 3,
        sourceUrl:
          "https://video.fastly.steamstatic.com/store_trailers/1172620/1980334430/hash/hls_264_master.m3u8",
        sourceType: "licensed_direct_media_url",
        motionClass: "official_storefront_cinematic_motion",
        validationReason: "official_storefront_cinematic_motion_samples_passed",
        actionScore: 75,
      }),
      segment({
        storyId: "sea-of-thieves-custom-seas",
        entity: "Sea of Thieves",
        family: "steam_1172620_204445374",
        index: 4,
        sourceUrl:
          "https://video.fastly.steamstatic.com/store_trailers/1172620/204445374/hash/hls_264_master.m3u8",
        sourceType: "licensed_direct_media_url",
        motionClass: "gameplay_action",
        validationReason: "trimmed_segment_samples_passed",
        actionScore: 72,
        start: 24,
        recommendedStart: 24.45,
        recommendedDuration: 2.95,
        trimRecommended: true,
      }),
      segment({
        storyId: "sea-of-thieves-custom-seas",
        entity: "Sea of Thieves",
        family: "steam_1172620_2137521619",
        index: 5,
        sourceUrl:
          "https://video.fastly.steamstatic.com/store_trailers/1172620/2137521619/hash/hls_264_master.m3u8",
        sourceType: "licensed_direct_media_url",
        motionClass: "official_storefront_cinematic_motion",
        validationReason: "official_storefront_cinematic_motion_samples_passed",
        actionScore: 72,
        start: 56,
      }),
    ]),
    generatedAt: "2026-06-22T09:25:00.000Z",
  });

  assert.equal(pack.clips.length, 4);
  assert.equal(pack.readiness.blockers.includes("actual_motion_clip_minimum_not_met"), true);
  assert.equal(pack.readiness.blockers.includes("distinct_motion_families_minimum_not_met"), false);
  assert.ok(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "source_asset_already_used",
    ),
  );
  assert.equal(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "segment_not_gameplay_action",
    ),
    false,
  );
});

test("Visual V4 motion pack rejects official product motion when the story needs gameplay evidence", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      title: "Forza Horizon 6 Shows Official Motion",
      suggested_title: "Forza Horizon 6 Shows Official Motion",
      suggested_thumbnail_text: "FORZA MOTION",
      full_script:
        "Forza Horizon 6 has a clean official-media story. The clips are separate validated motion windows, not a player-count metric package.",
    }),
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

test("Visual V4 motion pack rejects same-source repeat windows after the source is used", () => {
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

  assert.equal(pack.clips.length, 6);
  assert.equal(new Set(pack.clips.map((clip) => clip.source_family)).size, 6);
  assert.equal(pack.motion_budget.available_distinct_families, 6);
  assert.ok(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "source_asset_already_used",
    ),
  );
  assert.equal(pack.readiness.status, "v4_motion_blocked");
  assert.equal(pack.readiness.blockers.includes("actual_motion_clip_minimum_not_met"), true);
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
      (candidate) =>
        candidate.reason === "repeat_short_trimmed_montage_not_allowed" ||
        candidate.reason === "source_asset_already_used",
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

test("Visual V4 motion pack recognises licensed direct-media acquisition rows as trusted official references", () => {
  const mediaUrl =
    "https://cdn.trailers.xboxservices.com/trailers/00000000-0000-0000-0000-000000000000/is/content/microsoftassets/beastro-AVS.m3u8?packagedStreaming=true";
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "beastro-pack",
      title: "Beastro Turns Cozy Cooking Into A Card Game",
      suggested_title: "Beastro Turns Cozy Cooking Into A Card Game",
      suggested_thumbnail_text: "BEASTRO CARD KITCHEN",
      canonical_subject: "Beastro",
      canonical_game: "Beastro",
      full_script:
        "Beastro turns cooking into a card game, which gives Xbox a stranger Game Pass pitch than another farming sim.",
    }),
    trustedFootageReport: {
      rows: [
        {
          story_id: "beastro-pack",
          entity: "Beastro",
          source_family: "xbox_product_beastro",
          source_type: "official_platform_product_page",
          source_owner: "Xbox",
          source_tier: "official_platform_storefront",
          status: "ready_for_segment_validation",
          access_mode: "approved_direct_media_url",
          rights_gate: "official_source",
          official_source_url: "https://www.xbox.com/en-us/games/store/beastro/9njrsc0b0k88",
          approved_media_url: mediaUrl,
          source_url_kind: "hls_manifest",
          segment_validation_eligible: true,
        },
      ],
    },
    segmentValidationReport: segmentReport([
      {
        story_id: "beastro-pack",
        clip_key: `${mediaUrl}|beastro|42.00`,
        source_url: mediaUrl,
        source_family: "xbox_product_beastro",
        source_type: "licensed_direct_media_url",
        provider: "licensed_direct_media_acquisition",
        entity: "Beastro",
        media_start_s: 42,
        duration_s: 5,
        segment_validated: true,
        allowed_for_flash_lane: true,
        segment_motion_class: "gameplay_action",
        action_score: 84,
        action_sample_count: 3,
        validation_reason: "segment_samples_passed",
        samples: [
          { local_path: "test/output/beastro/a.jpg" },
          { local_path: "test/output/beastro/b.jpg" },
          { local_path: "test/output/beastro/c.jpg" },
        ],
      },
    ]),
    generatedAt: "2026-06-12T12:55:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].trusted_source_matched, true);
  assert.equal(pack.trusted_source_pipeline.references_found, 1);
  assert.equal(
    pack.readiness.blockers.includes("no_trusted_footage_references_for_story"),
    false,
  );
});

test("Visual V4 motion pack accepts refreshed RSS ids for same-entity official direct media", () => {
  const mediaUrl =
    "https://vulcan.dl.playstation.net/img/rnd/202606/1802/granblue-relink-endless-ragnarok.mp4";
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "rss_current_granblue",
      title: "Granblue Fantasy: Relink Demo Is The Real Proof",
      suggested_title: "Granblue Fantasy: Relink Demo Is The Real Proof",
      suggested_thumbnail_text: "GRANBLUE FANTASY RELINK DEMO RISK",
      canonical_subject: "Granblue Fantasy: Relink",
      canonical_game: "Granblue Fantasy: Relink",
      full_script:
        "Granblue Fantasy: Relink has a playable demo, which gives players a real test before they spend time on the new expansion.",
    }),
    trustedFootageReport: {
      rows: [
        {
          story_id: "rss_old_granblue",
          entity: "Granblue Fantasy: Relink",
          source_family: "playstation_store_granblue_relink_endless_ragnarok",
          source_type: "official_platform_product_page",
          source_owner: "PlayStation",
          source_tier: "official_platform_storefront",
          status: "ready_for_segment_validation",
          access_mode: "approved_direct_media_url",
          rights_gate: "official_source",
          official_source_url: "https://www.playstation.com/games/granblue-fantasy-relink/",
          approved_media_url: mediaUrl,
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
        },
      ],
    },
    segmentValidationReport: segmentReport([
      segment({
        family: "playstation_store_granblue_relink_endless_ragnarok",
        storyId: "rss_old_granblue",
        entity: "Granblue Fantasy: Relink",
        sourceUrl: mediaUrl,
        sourceType: "licensed_direct_media_url",
        referenceTitle: "Granblue Fantasy: Relink Endless Ragnarok demo trailer",
        validationReason: "segment_samples_passed",
      }),
    ]),
    generatedAt: "2026-06-20T03:30:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].provenance.story_id, "rss_old_granblue");
  assert.equal(pack.rejected_candidates.some((candidate) => candidate.reason === "story_id_mismatch"), false);
  assert.equal(pack.trusted_source_pipeline.references_found, 1);
});

test("Visual V4 motion pack treats trailer resolver plan references as trusted official evidence", () => {
  const mediaUrl =
    "https://video.akamai.steamstatic.com/store_trailers/123456/7890/demo/hls_264_master.m3u8";
  const family = "steam_123456_7890";
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "invincible-vs-pack",
      title: "Why Invincible VS Could Split Players",
      suggested_title: "Why Invincible VS Could Split Players",
      canonical_subject: "Invincible VS",
      canonical_game: "Invincible VS",
      full_script:
        "Invincible VS has a roster problem: players need the fights to feel brutal, fair and readable.",
    }),
    trustedFootageReport: {
      plans: [
        {
          story_id: "invincible-vs-pack",
          references: [
            {
              story_id: "invincible-vs-pack",
              entity: "Invincible VS",
              source_type: "steam_movie",
              provider: "steam",
              source_url: mediaUrl,
              source_family: family,
              source_verified: true,
              rights_risk_class: "storefront_promotional_video",
              allowed_render_use: "reference_only_by_default",
              source_url_kind: "hls_manifest",
              segment_validation_eligible: true,
            },
          ],
        },
      ],
    },
    segmentValidationReport: segmentReport([
      segment({
        storyId: "invincible-vs-pack",
        entity: "Invincible VS",
        family,
        sourceUrl: mediaUrl,
        sourceType: "steam_movie",
        referenceTitle: "Invincible VS official Steam trailer",
        validationReason: "segment_samples_passed",
      }),
    ]),
    generatedAt: "2026-06-23T19:45:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].trusted_source_matched, true);
  assert.equal(pack.trusted_source_pipeline.references_found, 1);
  assert.equal(
    pack.readiness.blockers.includes("no_trusted_footage_references_for_story"),
    false,
  );
});

test("Visual V4 motion pack does not trust reference-only labels without official source evidence", () => {
  const mediaUrl = "https://example.com/article-video.mp4";
  const family = "article_embed_rehosted_clip";
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "weak-reference-label-pack",
      title: "Why Invincible VS Could Split Players",
      suggested_title: "Why Invincible VS Could Split Players",
      canonical_subject: "Invincible VS",
      canonical_game: "Invincible VS",
      full_script:
        "Invincible VS has a roster problem: players need the fights to feel brutal, fair and readable.",
    }),
    trustedFootageReport: {
      plans: [
        {
          story_id: "weak-reference-label-pack",
          references: [
            {
              story_id: "weak-reference-label-pack",
              entity: "Invincible VS",
              source_type: "article_embed",
              provider: "unknown",
              source_url: mediaUrl,
              source_family: family,
              source_verified: true,
              rights_risk_class: "",
              allowed_render_use: "reference_only_by_default",
              source_url_kind: "direct_video",
              segment_validation_eligible: true,
            },
          ],
        },
      ],
    },
    segmentValidationReport: segmentReport([
      segment({
        storyId: "weak-reference-label-pack",
        entity: "Invincible VS",
        family,
        sourceUrl: mediaUrl,
        sourceType: "article_embed",
        referenceTitle: "Rehosted article clip",
        validationReason: "segment_samples_passed",
      }),
    ]),
    generatedAt: "2026-06-23T19:47:00.000Z",
  });

  assert.equal(pack.clips.length, 0);
  assert.equal(pack.trusted_source_pipeline.references_found, 0);
  assert.equal(
    pack.readiness.blockers.includes("no_trusted_footage_references_for_story"),
    true,
  );
});

test("Visual V4 motion pack still rejects mismatched refreshed ids for unrelated entities", () => {
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "rss_current_granblue",
      title: "Granblue Fantasy: Relink Demo Is The Real Proof",
      suggested_title: "Granblue Fantasy: Relink Demo Is The Real Proof",
      canonical_subject: "Granblue Fantasy: Relink",
      canonical_game: "Granblue Fantasy: Relink",
    }),
    trustedFootageReport: { rows: [] },
    segmentValidationReport: segmentReport([
      segment({
        family: "playstation_store_unrelated_racing_game",
        storyId: "rss_old_unrelated",
        entity: "Unrelated Racing Game",
        sourceType: "licensed_direct_media_url",
        referenceTitle: "Unrelated Racing Game trailer",
      }),
    ]),
    generatedAt: "2026-06-20T03:30:00.000Z",
  });

  assert.equal(pack.clips.length, 0);
  assert.ok(pack.rejected_candidates.some((candidate) => candidate.reason === "story_id_mismatch"));
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

test("Visual V4 motion pack accepts legend-labelled official social clips when samples prove gameplay motion", () => {
  const family = "forza_horizon_official_x_fh6_legend_video";
  const pack = buildVisualV4MotionPack({
    story: forzaStory(),
    trustedFootageReport: trustedReport("forza-v4-pack", ["steam", "xbox", family, "ign"]),
    segmentValidationReport: segmentReport([
      segment({ family: "steam", index: 1 }),
      segment({ family: "xbox", index: 2 }),
      segment({
        family,
        index: 3,
        sourceType: "official_social_media_video",
        sourceUrl: "https://video.twimg.com/amplify_video/legend/vid/avc1/1920x1080/gameplay.mp4?tag=16",
        referenceTitle: "Forza Horizon official X - FH6 Horizon Legend video reference",
        actionScore: 86,
        samples: [
          {
            local_path: "test/output/forza/legend-a.jpg",
            status: "accepted",
            qa: { visual_taste: { tags: ["detail_rich", "gameplay_candidate"] } },
          },
          {
            local_path: "test/output/forza/legend-b.jpg",
            status: "accepted",
            qa: { visual_taste: { tags: ["colourful", "gameplay_candidate"] } },
          },
          {
            local_path: "test/output/forza/legend-c.jpg",
            status: "accepted",
            qa: { gameplay_action_candidate: true, visual_taste: { tags: ["gameplay_candidate"] } },
          },
        ],
      }),
    ]),
    generatedAt: "2026-05-19T10:05:00.000Z",
  });

  assert.ok(
    pack.clips.some((clip) => clip.source_family === family),
    JSON.stringify(pack.rejected_candidates, null, 2),
  );
  assert.equal(
    pack.rejected_candidates.some(
      (candidate) => candidate.source_family === family && candidate.reason === "promo_card_source_family",
    ),
    false,
  );
});

test("Visual V4 motion pack accepts validated official trailer clips for preorder stories", () => {
  const family =
    "xbox_store_grand_theft_auto_vi_seed_gta_vi_preorder_xbox_20260625_rockstar_gta_vi_trailer_2";
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "seed_gta_vi_preorder_xbox_20260625",
      title: "GTA VI Preorders Just Changed The Buying Argument",
      canonical_game: "Grand Theft Auto VI",
      canonical_subject: "Grand Theft Auto VI",
    }),
    trustedFootageReport: trustedReport("seed_gta_vi_preorder_xbox_20260625", [family]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "seed_gta_vi_preorder_xbox_20260625",
        family,
        index: 1,
        entity: "Grand Theft Auto VI",
        sourceType: "official_game_website_media_page",
        sourceUrl:
          "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
        referenceTitle: "Grand Theft Auto VI Trailer 2",
        actionScore: 95,
        samples: [
          { local_path: "test/output/gta/trailer2-a.jpg", content_hash: "gta-trailer-2-a" },
          { local_path: "test/output/gta/trailer2-b.jpg", content_hash: "gta-trailer-2-b" },
          { local_path: "test/output/gta/trailer2-c.jpg", content_hash: "gta-trailer-2-c" },
        ],
      }),
    ]),
    generatedAt: "2026-06-25T10:00:00.000Z",
  });

  assert.ok(
    pack.clips.some((clip) => clip.source_family === family),
    JSON.stringify(pack.rejected_candidates, null, 2),
  );
  assert.equal(
    pack.rejected_candidates.some(
      (candidate) => candidate.source_family === family && candidate.reason === "promo_card_source_family",
    ),
    false,
  );
});

test("Visual V4 motion pack still rejects cover-art animation for preorder stories", () => {
  const family =
    "xbox_store_grand_theft_auto_vi_seed_gta_vi_preorder_xbox_20260625_rockstar_gta_vi_cover_art_animation";
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "seed_gta_vi_preorder_xbox_20260625",
      title: "GTA VI Preorders Just Changed The Buying Argument",
      canonical_game: "Grand Theft Auto VI",
      canonical_subject: "Grand Theft Auto VI",
    }),
    trustedFootageReport: trustedReport("seed_gta_vi_preorder_xbox_20260625", [family]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "seed_gta_vi_preorder_xbox_20260625",
        family,
        index: 1,
        entity: "Grand Theft Auto VI",
        sourceType: "official_game_website_media_page",
        sourceUrl:
          "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
        referenceTitle: "Official Cover Art Animation",
        actionScore: 95,
        samples: [
          { local_path: "test/output/gta/cover-a.jpg", content_hash: "gta-cover-a" },
          { local_path: "test/output/gta/cover-b.jpg", content_hash: "gta-cover-b" },
          { local_path: "test/output/gta/cover-c.jpg", content_hash: "gta-cover-c" },
        ],
      }),
    ]),
    generatedAt: "2026-06-25T10:00:00.000Z",
  });

  assert.equal(pack.clips.some((clip) => clip.source_family === family), false);
  assert.ok(
    pack.rejected_candidates.some(
      (candidate) => candidate.source_family === family && candidate.reason === "promo_card_source_family",
    ),
    JSON.stringify(pack.rejected_candidates, null, 2),
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
      (candidate) =>
        candidate.reason === "source_asset_window_too_close" ||
        candidate.reason === "source_asset_already_used",
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

test("Visual V4 motion pack does not use separate windows from one source asset as fresh motion", () => {
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

  assert.equal(pack.clips.length, 1);
  assert.equal(new Set(pack.clips.map((clip) => clip.source_family)).size, 1);
  assert.equal(pack.motion_budget.available_motion_clips, 1);
  assert.equal(pack.motion_budget.available_distinct_families, 1);
  assert.equal(pack.readiness.blockers.includes("actual_motion_clip_minimum_not_met"), true);
  assert.equal(pack.readiness.blockers.includes("distinct_motion_families_minimum_not_met"), true);
  assert.equal(
    pack.rejected_candidates.filter((candidate) => candidate.reason === "source_asset_already_used").length,
    6,
  );
});

test("Visual V4 motion pack accepts hash-distinct official windows from one Steam trailer without accepting loops", () => {
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1364780/164062000/hash/1782090499/hls_264_master.m3u8?t=1";
  const hashedSamples = (windowId) => [
    {
      local_path: `test/output/sf6/${windowId}-a.jpg`,
      status: "accepted",
      qa: { content_hash: `${windowId}-a`, thumbnail_safe: true, black_frame: false, failures: [] },
    },
    {
      local_path: `test/output/sf6/${windowId}-b.jpg`,
      status: "accepted",
      qa: { content_hash: `${windowId}-b`, thumbnail_safe: true, black_frame: false, failures: [] },
    },
    {
      local_path: `test/output/sf6/${windowId}-c.jpg`,
      status: "accepted",
      qa: { content_hash: `${windowId}-c`, thumbnail_safe: true, black_frame: false, failures: [] },
    },
  ];

  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "sf6-yasmine-pack",
      title: "Street Fighter 6 Shows Yasmine Gameplay",
      canonical_subject: "Street Fighter 6",
      canonical_game: "Street Fighter 6",
      full_script:
        "Street Fighter 6 has a real Yasmine gameplay reveal. Capcom's official trailer shows separate combat beats, not one loop repeated over and over.",
    }),
    trustedFootageReport: trustedReport("sf6-yasmine-pack", ["steam_1364780_164062000"]),
    segmentValidationReport: segmentReport([
      segment({
        storyId: "sf6-yasmine-pack",
        family: "steam_1364780_164062000",
        index: 1,
        sourceUrl,
        start: 36,
        samples: hashedSamples("w36"),
      }),
      segment({
        storyId: "sf6-yasmine-pack",
        family: "steam_1364780_164062000",
        index: 2,
        sourceUrl,
        start: 42,
        actionScore: 86,
        samples: hashedSamples("w42"),
      }),
      segment({
        storyId: "sf6-yasmine-pack",
        family: "steam_1364780_164062000",
        index: 3,
        sourceUrl,
        start: 48,
        actionScore: 84,
        samples: hashedSamples("w48"),
      }),
      segment({
        storyId: "sf6-yasmine-pack",
        family: "steam_1364780_164062000",
        index: 4,
        sourceUrl,
        start: 42.4,
        actionScore: 83,
        samples: hashedSamples("w42"),
      }),
    ]),
    maxClips: 6,
    generatedAt: "2026-06-23T12:30:00.000Z",
  });

  assert.equal(pack.clips.length, 3);
  assert.deepEqual(
    pack.clips.map((clip) => clip.mediaStartS),
    [36, 42, 48],
  );
  assert.equal(pack.motion_budget.available_motion_clips, 3);
  assert.equal(pack.motion_budget.available_distinct_families, 1);
  assert.equal(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "source_asset_window_too_close",
    ),
    true,
  );
  assert.equal(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "source_asset_already_used",
    ),
    false,
  );
});

test("Visual V4 motion pack rejects same-game wrong-character trailers for character-specific stories", () => {
  const yasmineUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1364780/164062000/hash/1782090499/hls_264_master.m3u8?t=1";

  const makeSf6Segment = ({ family, referenceTitle, movieId, score }) =>
    segment({
      storyId: "sf6-yasmine-pack",
      family,
      index: Number(movieId),
      entity: "Street Fighter 6",
      sourceUrl:
        family === "sf6_yasmine_gameplay"
          ? yasmineUrl
          : `https://video.akamai.steamstatic.com/store_trailers/1364780/${movieId}/hash/hls_264_master.m3u8?t=1`,
      sourceType: "steam_storefront_video_reference",
      referenceTitle,
      actionScore: score,
      validationReason: "official_storefront_trailer_motion_samples_passed",
    });

  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "sf6-yasmine-pack",
      title: "Street Fighter 6 Yasmine Gameplay Reveal",
      selected_title: "Street Fighter 6 Just Revealed A Rushdown Problem",
      short_title: "Yasmine Looks Dangerous",
      suggested_thumbnail_text: "YASMINE PRESSURE",
      canonical_subject: "Street Fighter 6 – Yasmine Character Gameplay Reveal Trailer",
      canonical_game: "",
      full_script:
        "Street Fighter 6 just made Yasmine look like a ranked-mode problem. Capcom's official trailer shows her rushdown pressure, knife feints and space control.",
    }),
    trustedFootageReport: trustedReport("sf6-yasmine-pack", [
      "sf6_yasmine_gameplay",
      "sf6_ingrid_gameplay",
      "sf6_alex_gameplay",
      "sf6_c_viper_gameplay",
      "sf6_elena_gameplay",
    ]),
    segmentValidationReport: segmentReport([
      makeSf6Segment({
        family: "sf6_yasmine_gameplay",
        referenceTitle: "SF6_YASMINE_Gameplaytrailer_Multi_EN_ESRB_HD_Steam",
        movieId: "164062000",
        score: 96.7,
      }),
      makeSf6Segment({
        family: "sf6_ingrid_gameplay",
        referenceTitle: "SF6_INGRID_Gameplaytrailer_Multi_EN_ESRB_HD_Steam",
        movieId: "164062111",
        score: 99,
      }),
      makeSf6Segment({
        family: "sf6_alex_gameplay",
        referenceTitle: "SF6_ALEX_Gameplaytrailer_Multi_EN_ESRB_HD_Steam",
        movieId: "164062222",
        score: 98,
      }),
      makeSf6Segment({
        family: "sf6_c_viper_gameplay",
        referenceTitle: "SF6_C.Viper_Gameplaytrailer_Multi_EN_ESRB_HD_Steam",
        movieId: "164062333",
        score: 97,
      }),
      makeSf6Segment({
        family: "sf6_elena_gameplay",
        referenceTitle: "SF6_ELENA_Gameplaytrailer_Multi_EN_ESRB_HD_Steam",
        movieId: "164062444",
        score: 95,
      }),
    ]),
    maxClips: 5,
    generatedAt: "2026-06-23T12:45:00.000Z",
  });

  const acceptedIdentityText = pack.clips
    .map((clip) => `${clip.source_family} ${clip.provenance?.reference_title || ""}`)
    .join(" ");
  assert.match(acceptedIdentityText, /yasmine/i);
  assert.doesNotMatch(acceptedIdentityText, /ingrid|alex|viper|elena/i);
  assert.equal(
    pack.rejected_candidates.filter(
      (candidate) => candidate.reason === "story_subject_motion_mismatch",
    ).length,
    4,
  );
});

test("Visual V4 motion pack does not reject exact game trailers because of generic editorial title wording", () => {
  const storyId = "invincible-vs-pack";
  const pack = buildVisualV4MotionPack({
    story: {
      id: storyId,
      title: "Why Invincible VS Could Split Players",
      canonical_subject: "Invincible VS",
      canonical_game: "Invincible VS",
      full_script:
        "Invincible VS is the actual game here. The official trailer shows why its tag-fighter format could split players.",
    },
    trustedFootageReport: trustedReport(storyId, ["steam_2353060_946822689"]),
    segmentValidationReport: segmentReport([
      segment({
        storyId,
        family: "steam_2353060_946822689",
        entity: "Invincible VS",
        sourceUrl:
          "https://video.akamai.steamstatic.com/store_trailers/2353060/946822689/hash/hls_264_master.m3u8",
        referenceTitle: "Invincible VS | Launch Trailer",
        actionScore: 87.4,
        validationReason: "official_storefront_trailer_motion_samples_passed",
      }),
    ]),
    generatedAt: "2026-06-24T15:58:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].entity, "Invincible VS");
  assert.equal(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "story_subject_motion_mismatch",
    ),
    false,
  );
});

test("Visual V4 motion pack does not top up premium density with repeat windows", () => {
  const families = ["steam_alpha", "steam_beta", "steam_gamma", "steam_delta"];
  const sourceUrls = {
    steam_alpha:
      "https://video.akamai.steamstatic.com/store_trailers/2483190/1001/hash/hls_264_master.m3u8",
    steam_beta:
      "https://video.akamai.steamstatic.com/store_trailers/2483190/1002/hash/hls_264_master.m3u8",
    steam_gamma:
      "https://video.akamai.steamstatic.com/store_trailers/2483190/1003/hash/hls_264_master.m3u8",
    steam_delta:
      "https://video.akamai.steamstatic.com/store_trailers/2483190/1004/hash/hls_264_master.m3u8",
  };
  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      title: "Forza Horizon 6 Shows Official Motion",
      suggested_title: "Forza Horizon 6 Shows Official Motion",
      suggested_thumbnail_text: "FORZA MOTION",
      full_script:
        "Forza Horizon 6 has a clean official-media story. The clips are separate validated motion windows, not a player-count metric package.",
    }),
    trustedFootageReport: trustedReport("forza-v4-pack", families),
    segmentValidationReport: segmentReport(
      families.flatMap((family, familyIndex) =>
        [40, 46].map((start, windowIndex) =>
          segment({
            family,
            index: familyIndex * 2 + windowIndex + 1,
            sourceUrl: sourceUrls[family],
            start,
            actionScore: 90 - familyIndex,
          }),
        ),
      ),
    ),
    generatedAt: "2026-05-26T09:20:00.000Z",
  });

  assert.equal(pack.readiness.status, "v4_motion_blocked");
  assert.equal(pack.clips.length, 4);
  assert.equal(pack.motion_budget.available_motion_clips, 4);
  assert.equal(pack.motion_budget.available_distinct_families, 4);
  assert.equal(pack.readiness.blockers.includes("actual_motion_clip_minimum_not_met"), true);
  assert.equal(
    pack.rejected_candidates.filter((candidate) => candidate.reason === "source_asset_already_used").length,
    4,
  );
});

test("Visual V4 motion pack accepts materialised Steam still-motion topups without relabelling them as gameplay", () => {
  const previousMotionPack = {
    clips: [
      {
        id: "steam-still-motion-1",
        type: "motion_clip",
        source_family: "steam_still_destiny_hero",
        path: "output/video_cache/destiny_hero_motion.mp4",
        source_url: "https://cdn.akamai.steamstatic.com/steam/apps/1085660/library_hero.jpg",
        source_type: "steam_screenshot_derived_motion",
        provider: "steam",
        entity: "Destiny 2",
        mediaStartS: 0,
        durationS: 3.2,
        validated: true,
        segmentValidationPassed: true,
        allowed_render_use: "screenshot_derived_editorial_motion",
        rights_risk_class: "steam_storefront_promotional_editorial_use",
        provenance: {
          story_id: "destiny-still-topup",
          segment_motion_class: "screenshot_derived_motion_clip",
          segment_action_score: 76,
          validation_reason: "screenshot_derived_motion_materialized",
        },
      },
    ],
  };

  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "destiny-still-topup",
      title: "Destiny 2 Needs Clearer Answers",
      suggested_title: "Destiny 2 Needs Clearer Answers",
      suggested_thumbnail_text: "DESTINY ANSWERS",
      canonical_subject: "Destiny 2",
      canonical_game: "Destiny 2",
      full_script:
        "Destiny 2 needs clearer answers from Bungie. The story is about support, trust and what players can still expect.",
    }),
    trustedFootageReport: trustedReport("destiny-still-topup", [
      "steam_still_destiny_hero",
    ]),
    previousMotionPack,
    segmentValidationReport: segmentReport([]),
    generatedAt: "2026-05-30T22:30:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].source_family, "steam_still_destiny_hero");
  assert.equal(
    pack.clips[0].provenance.segment_motion_class,
    "screenshot_derived_motion_clip",
  );
  assert.equal(pack.rejected_candidates.length, 0);
});

test("Visual V4 motion pack rejects product-video repeat windows instead of maximising them", () => {
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

  assert.equal(pack.clips.length, 1);
  assert.deepEqual(
    pack.clips.map((clip) => clip.mediaStartS).sort((a, b) => a - b),
    [48],
  );
  assert.equal(pack.motion_budget.available_motion_clips, 1);
  assert.equal(pack.readiness.blockers.includes("actual_motion_clip_minimum_not_met"), true);
  assert.equal(pack.readiness.blockers.includes("distinct_motion_families_minimum_not_met"), true);
  assert.equal(
    pack.rejected_candidates.filter((candidate) => candidate.reason === "source_asset_already_used").length,
    5,
  );
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

test("Visual V4 motion pack preserves real-motion materializer clips with provenance validation", () => {
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1091500/637422/hash/hls_264_master.m3u8?t=1";
  const previousMotionPack = {
    source: "validated_real_motion_materializer",
    clips: [
      {
        id: "materialized-1",
        path: "output/video_cache/cyberpunk-1.mp4",
        source_url: sourceUrl,
        source_family: "segment_source_family_1_window_36_5",
        source_type: "steam_movie",
        durationS: 5,
        mediaStartS: 36,
        materialized: true,
        counts_towards_motion_readiness: true,
        provenance: {
          segment_validated: true,
          allowed_for_flash_lane: true,
          validation_reason: "official_storefront_cinematic_motion_samples_passed",
          segment_motion_class: "official_storefront_cinematic_motion",
          segment_action_score: 90,
          media_start_s: 36,
          duration_s: 5,
        },
      },
      {
        id: "materialized-duplicate-asset",
        path: "output/video_cache/cyberpunk-2.mp4",
        source_url: sourceUrl,
        source_family: "segment_source_family_1_window_42_5",
        source_type: "steam_movie",
        durationS: 5,
        mediaStartS: 42,
        materialized: true,
        counts_towards_motion_readiness: true,
        provenance: {
          segment_validated: true,
          allowed_for_flash_lane: true,
          validation_reason: "official_storefront_cinematic_motion_samples_passed",
          segment_motion_class: "official_storefront_cinematic_motion",
          segment_action_score: 88,
          media_start_s: 42,
          duration_s: 5,
        },
      },
    ],
  };

  const pack = buildVisualV4MotionPack({
    story: forzaStory({
      id: "cyberpunk-pack",
      title: "Cyberpunk 2077's Trust Debt",
      canonical_subject: "Cyberpunk 2077",
      canonical_game: "Cyberpunk 2077",
      full_script: "Cyberpunk 2077 has a trust debt to pay.",
    }),
    previousMotionPack,
    segmentValidationReport: segmentReport([]),
    generatedAt: "2026-06-22T12:32:00.000Z",
  });

  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0].source_family, "segment_source_family_1_window_36_5");
  assert.equal(pack.clips[0].source_url, sourceUrl);
  assert.equal(pack.clips[0].path, "output/video_cache/cyberpunk-1.mp4");
  assert.equal(
    pack.rejected_candidates.some(
      (candidate) => candidate.reason === "source_asset_already_used",
    ),
    true,
  );
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
  assert.equal(args.segmentReportExplicit, true);
  assert.match(
    packageJson.scripts["studio:v4:motion-pack"],
    /studio-v4-motion-pack\.js/,
  );
  assert.match(
    packageJson.scripts["ops:v4-motion-pack"],
    /studio-v4-motion-pack\.js/,
  );
});

test("Visual V4 motion pack CLI treats previous-pack rebuilds as previous-pack-only by default", () => {
  const args = parseArgs([
    "node",
    "tools/studio-v4-motion-pack.js",
    "--story-id",
    "cyberpunk-pack",
    "--previous-motion-pack",
    "output/studio-v4/motion-packs/cyberpunk-pack_motion_pack_manifest.json",
  ]);

  assert.equal(args.previousMotionPack, "output/studio-v4/motion-packs/cyberpunk-pack_motion_pack_manifest.json");
  assert.equal(args.segmentReportExplicit, false);
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

test("Visual V4 motion pack counts owned explainer clips from package footage inventory", () => {
  const story = {
    id: "halo-ps5-account-catch",
    title: "Halo's PS5 Account Catch",
    canonical_subject: "Halo: Campaign Evolved",
    canonical_game: "Halo: Campaign Evolved",
    full_script:
      "Halo on PS5 has an Xbox account requirement, and players should know the setup friction before they buy.",
  };
  const footageInventory = {
    motion_inventory: {
      accepted_local_clips: Array.from({ length: 5 }, (_, index) => ({
        id: `halo-owned-motion-${index + 1}`,
        source_family: `halo_owned_motion_${index + 1}`,
        motion_family: `halo_owned_motion_${index + 1}`,
        path: `C:\\media\\halo-owned-motion-${index + 1}.mp4`,
        local_materialized_path: `C:\\media\\halo-owned-motion-${index + 1}.mp4`,
        source_url: `local://pulse-generated-motion/halo-ps5-account-catch/${index + 1}`,
        source_type: "internally_generated_motion_graphic",
        media_kind: "owned_explainer_motion",
        rights_basis: "owned_generated_editorial_motion_graphic",
        licence_basis: "owned_generated_editorial_motion_graphic",
        allowed_use: "finished_editorial_video_only",
        durationS: 2.8,
        validated: true,
        counts_towards_motion_readiness: true,
      })),
    },
  };

  const pack = buildVisualV4MotionPack({
    story,
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "xbox-official-youtube",
          display_name: "Xbox official YouTube",
          source_tier: "official",
          source_family: "xbox_official_youtube",
          reference_url: "https://www.youtube.com/@Xbox",
          entities: ["Halo"],
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
      ],
    },
    previousMotionPack: previousMotionPackFromFootageInventory(story, footageInventory),
    segmentValidationReport: segmentReport([]),
    generatedAt: "2026-06-22T19:58:00.000Z",
  });

  assert.equal(pack.readiness.status, "v4_motion_ready");
  assert.equal(pack.motion_budget.product_motion_story, false);
  assert.equal(pack.clips.length, 5);
  assert.equal(pack.motion_budget.available_motion_clips, 5);
  assert.equal(pack.motion_budget.available_distinct_families, 5);
  assert.ok(pack.clips.every((clip) => clip.provenance.segment_motion_class === "owned_explainer_motion"));
  assert.ok(pack.clips.every((clip) => clip.source_url_kind === "local_video_file"));
  assert.ok(pack.clips.every((clip) => clip.allowed_render_use === "finished_editorial_video_only"));
  assert.ok(pack.clips.every((clip) => clip.rights_risk_class === "owned_generated_motion"));
  assert.ok(pack.clips.every((clip) => clip.licence_basis === "owned_generated_editorial_motion_graphic"));
});

test("Visual V4 motion pack previous-pack merge lets fresh inventory override stale clip metadata", () => {
  const merged = mergePreviousMotionPacks(
    {
      clips: [
        {
          id: "owned-clip-1",
          source_family: "owned_family",
          path: "C:\\media\\owned-clip-1.mp4",
          rights_risk_class: "official_reference_only",
        },
      ],
    },
    {
      clips: [
        {
          id: "owned-clip-1",
          source_family: "owned_family",
          path: "C:\\media\\owned-clip-1.mp4",
          rights_risk_class: "owned_generated_motion",
          licence_basis: "owned_generated_editorial_motion_graphic",
        },
      ],
    },
  );

  assert.equal(merged.clips.length, 1);
  assert.equal(merged.clips[0].rights_risk_class, "owned_generated_motion");
  assert.equal(merged.clips[0].licence_basis, "owned_generated_editorial_motion_graphic");
});
