"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { visualEvidenceProfile } = require("../../lib/visual-evidence-classifier");

test("counts materialised Steam HLS trailer clips as direct-video motion evidence", () => {
  const profile = visualEvidenceProfile({
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          {
            path: "C:\\repo\\output\\video_cache\\hades_v4_clip_1.mp4",
            source_url:
              "https://video.akamai.steamstatic.com/store_trailers/1145350/movie_max_vp9_1080p.webm?t=1716400000",
            source_type: "steam_movie",
            media_kind: "direct_video",
            source_url_kind: "hls_manifest",
            source_family: "steam_1145350_695850",
          },
        ],
      },
    },
  });

  assert.equal(profile.direct_video_motion_asset_count, 1);
  assert.equal(profile.direct_video_motion_family_count, 1);
});

test("does not count screenshot-derived local MP4s as direct-video motion evidence", () => {
  const profile = visualEvidenceProfile({
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          {
            path: "C:\\repo\\output\\video_cache\\article_still_pan.mp4",
            source_url: "https://example.com/article-image.jpg",
            source_type: "article_image",
            media_kind: "screenshot_derived_motion",
            source_family: "article_hero_image",
            transformation_notes: "Ken Burns pan from still screenshot",
          },
        ],
      },
    },
  });

  assert.equal(profile.direct_video_motion_asset_count, 0);
});

test("counts licensed direct media local MP4s as direct-video motion evidence", () => {
  const profile = visualEvidenceProfile({
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          {
            path: "C:\\repo\\output\\video_cache\\forza_v4_clip_1.mp4",
            source_url: "https://cdn.example.test/forza-official-social-video.mp4",
            source_type: "licensed_direct_media_url",
            source_family: "forza_official_x_video",
            validated: true,
          },
          {
            path: "C:\\repo\\output\\video_cache\\forza_v4_clip_2.mp4",
            source_url: "https://cdn.example.test/forza-platform-video.mp4",
            source_type: "official_social_media_video",
            source_family: "forza_platform_social_video",
            validated: true,
          },
        ],
      },
    },
  });

  assert.equal(profile.direct_video_motion_asset_count, 2);
  assert.equal(profile.direct_video_motion_family_count, 2);
});

test("deduplicates the same direct-video clip across inventory and rights evidence", () => {
  const clip = {
    id: "steam-controller-window-1",
    path: "C:\\repo\\output\\video_cache\\steam_controller_window_1.mp4",
    source_url:
      "https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/hls_264_master.m3u8?t=1470853282",
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    source_url_kind: "hls_manifest",
    source_family: "steam_353370_37301",
  };
  const profile = visualEvidenceProfile({
    rightsLedger: {
      records: [
        {
          ...clip,
          asset_type: "motion_clip",
          licence_basis: "official_source_transformative_editorial_use",
          approval_status: "approved_for_transformative_editorial_use",
        },
      ],
    },
    footageInventory: {
      motion_inventory: {
        accepted_local_clips: [clip],
        production_motion_clips: [clip],
      },
    },
  });

  assert.equal(profile.direct_video_motion_asset_count, 1);
  assert.equal(profile.direct_video_motion_family_count, 1);
});

test("counts official product-page mp4 clips as direct-video evidence even when renderer omitted media_kind", () => {
  const profile = visualEvidenceProfile({
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          {
            id: "ps5-product-page-motion",
            path: "C:\\repo\\output\\video_cache\\ps5_product_page_clip.mp4",
            source_url:
              "https://gmedia.playstation.com/is/content/SIEPDC/global_pdc/en/hardware/ps5/videos/ps5-overview.mp4",
            source_type: "official_platform_product_page",
            source_family: "official_playstation_ps5_product_page",
            validated: true,
          },
        ],
      },
    },
  });

  assert.equal(profile.direct_video_motion_asset_count, 1);
  assert.equal(profile.direct_video_motion_family_count, 1);
});

test("counts Nintendo storefront mp4 clips as direct-video evidence when renderer omitted media_kind", () => {
  const profile = visualEvidenceProfile({
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          {
            id: "nintendo-storefront-motion",
            path: "C:\\repo\\output\\video_cache\\super_mario_rpg_clip.mp4",
            source_url:
              "https://assets.nintendo.com/video/upload/store/software/switch/70010000068683/Video/946fb66280168f451a6b0c588f39905d721f477d9160de718f95cb222e684d5f.mp4",
            source_type: "platform_storefront",
            source_family: "",
            validated: true,
          },
        ],
      },
    },
  });

  assert.equal(profile.direct_video_motion_asset_count, 1);
  assert.equal(profile.direct_video_motion_family_count, 1);
});

test("does not count licensed audio and SFX records as visual or motion evidence", () => {
  const profile = visualEvidenceProfile({
    rightsLedger: {
      rights_ledger: [
        {
          asset_id: "sonniss_impact_trailer_hit",
          asset_type: "sfx",
          role: "impact",
          family: "impact",
          path:
            "C:\\repo\\audio\\sonniss\\Cinematic Hits & Impacts\\DSGNBoom_Cinematic Metallic Hit, Boom, Trailer, Sub.wav",
          source_url:
            "file://C:/repo/audio/sonniss/Cinematic Hits & Impacts/DSGNBoom_Cinematic Metallic Hit, Boom, Trailer, Sub.wav",
          source_type: "licensed_sfx_library_file",
          licence_basis: "sonniss_game_audio_gdc_bundle_license",
          approval_status: "approved_for_commercial_editorial_use",
        },
        {
          asset_id: "local_voice_narration",
          asset_type: "voice",
          path: "C:\\repo\\output\\audio\\story.mp3",
          source_url: "local://pulse-local-tts/story",
          source_type: "local_tts_voice",
          licence_basis: "owned_local_voice_model",
          approval_status: "approved",
        },
      ],
    },
  });

  assert.equal(profile.asset_count, 0);
  assert.equal(profile.real_media_asset_count, 0);
  assert.equal(profile.motion_asset_count, 0);
  assert.equal(profile.real_motion_asset_count, 0);
  assert.equal(profile.direct_video_motion_asset_count, 0);
});
