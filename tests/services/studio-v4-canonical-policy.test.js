"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function forzaStory(overrides = {}) {
  return {
    id: "forza-v4-canonical",
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
      {
        type: "steam_screenshot",
        source: "steam",
        path: "C:\\media\\forza-shot.jpg",
        rights_risk_class: "steam_storefront_promotional",
      },
    ],
    ...overrides,
  };
}

function trustedReport() {
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
  return {
    story_candidates: families.map((family, index) => ({
      story_id: "forza-v4-canonical",
      entity: "Forza Horizon 6",
      source_id: `${family}-${index + 1}`,
      display_name: family,
      source_tier: family === "digitalfoundry" ? "licensed_creator" : "official",
      source_family: family,
      reference_url: `https://example.test/${family}`,
      source_url_kind: family === "steam" ? "hls_manifest" : "web_page",
      segment_validation_eligible: family === "steam",
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

function localMotionClips(count = 8) {
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
  return families.slice(0, count).map((family, index) => ({
    id: `${family}-clip`,
    source_family: family,
    path: `C:\\media\\${family}.mp4`,
    durationS: 2.4 + index * 0.2,
    validated: true,
    rights_risk_class:
      family === "digitalfoundry"
        ? "licensed_creator_clip"
        : "official_reference_only",
  }));
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

test("Studio V4 canonical packet holds legacy rendering when real motion is too thin", () => {
  const {
    buildStudioV4CanonicalPacket,
    shouldHoldLegacyRender,
    applyStudioV4PacketToStory,
  } = require("../../lib/studio/v4/canonical-policy");
  const story = forzaStory();
  const packet = buildStudioV4CanonicalPacket({
    story,
    trustedFootageReport: trustedReport(),
    localTimeline: localTimeline(),
    localMotionClips: localMotionClips(3),
    generatedAt: "2026-05-19T09:00:00.000Z",
  });

  assert.equal(packet.readiness.status, "hold_for_motion_acquisition");
  assert.ok(packet.readiness.blockers.includes("actual_motion_clip_minimum_not_met"));
  assert.equal(shouldHoldLegacyRender(story, packet), true);

  applyStudioV4PacketToStory(story, packet);
  assert.equal(story.studio_v4_readiness_status, "hold_for_motion_acquisition");
  assert.equal(story.require_studio_v4_premium_publish, true);
  assert.equal(story.qa_failed, undefined);
  assert.equal(story.publish_status, undefined);
  assert.match(story.render_fallback_reason, /^studio_v4_motion_acquisition_pending:/);
});

test("Studio V4 canonical packet is ready when motion, captions, source lock and benchmark pass", () => {
  const {
    buildStudioV4CanonicalPacket,
    shouldHoldLegacyRender,
  } = require("../../lib/studio/v4/canonical-policy");
  const packet = buildStudioV4CanonicalPacket({
    story: forzaStory({ video_clips: localMotionClips(8), sfx_asset_inventory: licensedSfxAssets() }),
    trustedFootageReport: trustedReport(),
    localTimeline: localTimeline(),
    localMotionClips: localMotionClips(8),
    retentionIntelligence: {
      recommendations: [
        {
          id: "move_metric_first",
          action: "Move the Steam chart and concrete number into the opening four seconds.",
        },
      ],
    },
    generatedAt: "2026-05-19T09:00:00.000Z",
  });

  assert.equal(packet.readiness.status, "ready_for_studio_v4_render");
  assert.equal(packet.footage_plan.readiness.status, "v4_motion_ready");
  assert.equal(packet.director_plan.readiness.status, "director_ready");
  assert.equal(packet.media_house_benchmark.result, "pass");
  assert.equal(shouldHoldLegacyRender(forzaStory(), packet), false);
});

test("Studio V4 canonical benchmark does not score stale legacy images outside the V4 render plan", () => {
  const {
    buildStudioV4CanonicalPacket,
  } = require("../../lib/studio/v4/canonical-policy");
  const clips = localMotionClips(8).map((clip, index) => ({
    ...clip,
    source_family: `steam_v4_family_${index + 1}`,
    path: `https://video.akamai.steamstatic.com/store_trailers/2483190/${1000 + index}/hash/hls_264_master.m3u8`,
    source_url: `https://video.akamai.steamstatic.com/store_trailers/2483190/${1000 + index}/hash/hls_264_master.m3u8`,
    source_type: "steam_movie",
    provider: "steam",
  }));
  const packet = buildStudioV4CanonicalPacket({
    story: forzaStory({
      video_clips: null,
      downloaded_images: [
        { path: "output/image_cache/story_article.webp", source: "article" },
        { path: "output/image_cache/story_inline.webp", source: "article" },
      ],
      sfx_asset_inventory: licensedSfxAssets(),
    }),
    trustedFootageReport: trustedReport(),
    localTimeline: localTimeline(),
    localMotionClips: clips,
    generatedAt: "2026-05-19T09:00:00.000Z",
  });

  assert.equal(packet.readiness.status, "ready_for_studio_v4_render");
  assert.equal(packet.media_house_benchmark.result, "pass");
  assert.ok(packet.media_house_benchmark.scores.rights_risk_score >= 90);
  assert.equal(
    packet.media_house_benchmark.failures.includes("gold_standard:rights_risk_above_reference"),
    false,
  );
});

test("Studio V4 emergency fallback can allow legacy rendering without weakening readiness metadata", () => {
  const {
    buildStudioV4CanonicalPacket,
    shouldHoldLegacyRender,
    resolveStudioV4Policy,
  } = require("../../lib/studio/v4/canonical-policy");
  const packet = buildStudioV4CanonicalPacket({
    story: forzaStory(),
    trustedFootageReport: trustedReport(),
    localTimeline: localTimeline(),
    localMotionClips: localMotionClips(2),
    generatedAt: "2026-05-19T09:00:00.000Z",
  });
  const policy = resolveStudioV4Policy({
    STUDIO_V4_ALLOW_LEGACY_FALLBACK: "true",
  });

  assert.equal(packet.readiness.status, "hold_for_motion_acquisition");
  assert.equal(shouldHoldLegacyRender(forzaStory(), packet, policy), false);
  assert.equal(policy.allowEmergencyLegacyFallback, true);
});
