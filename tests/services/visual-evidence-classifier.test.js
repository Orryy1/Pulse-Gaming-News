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

test("counts repeated windows from one direct-video URL as one motion family", () => {
  const sourceUrl =
    "https://video.fastly.steamstatic.com/store_trailers/1172620/418022350/hash/hls_264_master.m3u8?t=1720000000";
  const profile = visualEvidenceProfile({
    footageInventory: {
      motion_inventory: {
        production_motion_clips: Array.from({ length: 5 }, (_, index) => ({
          id: `sea-of-thieves-window-${index + 1}`,
          path: `C:\\repo\\output\\video_cache\\sea_of_thieves_window_${index + 1}.mp4`,
          source_url: sourceUrl,
          source_type: "official_platform_product_page",
          media_kind: "direct_video",
          source_url_kind: "hls_manifest",
          source_family: `steam_1172620_sea_of_thieves_window_${index + 1}`,
        })),
      },
    },
  });

  assert.equal(profile.direct_video_motion_asset_count, 5);
  assert.equal(profile.direct_video_motion_family_count, 1);
  assert.equal(profile.real_media_family_count, 1);
  assert.ok(profile.blockers.includes("visual_evidence:insufficient_real_visual_source_families"));
});

test("counts distinct official YouTube videos as distinct motion families", () => {
  const profile = visualEvidenceProfile({
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          ["video-one", 1],
          ["video-one", 2],
          ["video-two", 1],
          ["video-two", 2],
        ].map(([videoId, window]) => ({
          id: `${videoId}-window-${window}`,
          path: `C:\\repo\\output\\video_cache\\${videoId}_${window}.mp4`,
          source_url: `https://www.youtube.com/watch?v=${videoId}`,
          source_type: "official_publisher_trailer_segment",
          media_kind: "direct_video",
          source_family: `${videoId}_window_${window}`,
        })),
      },
    },
  });

  assert.equal(profile.direct_video_motion_asset_count, 4);
  assert.equal(profile.direct_video_motion_family_count, 2);
  assert.equal(profile.real_media_family_count, 2);
  assert.deepEqual(profile.blockers, []);
});

test("counts official trailer segment windows as distinct scene evidence", () => {
  const sourceUrl =
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4";
  const profile = visualEvidenceProfile({
    footageInventory: {
      motion_inventory: {
        production_motion_clips: Array.from({ length: 5 }, (_, index) => ({
          id: `gta-vi-trailer-window-${index + 1}`,
          path: `C:\\repo\\output\\video_cache\\gta_vi_window_${index + 1}.mp4`,
          source_url: sourceUrl,
          source_type: "official_trailer_segment",
          media_kind: "direct_video",
          source_url_kind: "direct_video",
          source_family: `rockstar_gta_vi_trailer_2_window_${36 + index * 6}_5`,
        })),
      },
    },
  });

  assert.equal(profile.direct_video_motion_asset_count, 5);
  assert.equal(profile.direct_video_motion_family_count, 5);
  assert.equal(profile.real_media_family_count, 5);
  assert.deepEqual(profile.blockers, []);
});

test("counts Steam CDN aliases for the same trailer as one motion family", () => {
  const profile = visualEvidenceProfile({
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          {
            id: "sea-of-thieves-fastly",
            path: "C:\\repo\\output\\video_cache\\sea_fastly.mp4",
            source_url:
              "https://video.fastly.steamstatic.com/store_trailers/1172620/204445374/hash/1773669773/hls_264_master.m3u8?t=new",
            source_type: "licensed_direct_media_url",
            media_kind: "direct_video",
            source_url_kind: "hls_manifest",
            source_family: "steam_fastly_alias",
          },
          {
            id: "sea-of-thieves-akamai",
            path: "C:\\repo\\output\\video_cache\\sea_akamai.mp4",
            source_url:
              "https://video.akamai.steamstatic.com/store_trailers/1172620/204445374/hash/1773669773/hls_264_master.m3u8?t=old",
            source_type: "licensed_direct_media_url",
            media_kind: "direct_video",
            source_url_kind: "hls_manifest",
            source_family: "steam_akamai_alias",
          },
        ],
      },
    },
  });

  assert.equal(profile.direct_video_motion_asset_count, 2);
  assert.equal(profile.direct_video_motion_family_count, 1);
  assert.equal(profile.real_media_family_count, 1);
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

test("blocks direct-video motion when source family names a different game than the story", () => {
  const profile = visualEvidenceProfile({
    story: {
      canonical_subject: "Bethesda Game Studios and ZeniMax",
      selected_title: "Bethesda Game Studios and ZeniMax Needs One Real Proof Point",
    },
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          {
            id: "segment_direct_motion_1",
            source_url:
              "https://video.twimg.com/amplify_video/2023438994873221120/vid/avc1/720x1280/example.mp4",
            source_type: "official_social_media_video",
            source_family: "forza_horizon_official_x_fh6_maserati_mc20_video_window_4_5",
            media_kind: "direct_video",
          },
        ],
      },
    },
  });

  assert.ok(profile.blockers.includes("visual_evidence:subject_motion_mismatch"));
  assert.equal(profile.subject_motion_mismatch_count, 1);
  assert.equal(profile.subject_motion_mismatches[0].matched_foreign_topic, "forza_horizon");
});

test("allows direct-video motion whose franchise token matches the story", () => {
  const profile = visualEvidenceProfile({
    story: {
      canonical_subject: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Needs A Real Reveal",
    },
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          {
            id: "segment_direct_motion_1",
            source_url:
              "https://video.twimg.com/amplify_video/2023438994873221120/vid/avc1/720x1280/example.mp4",
            source_type: "official_social_media_video",
            source_family: "forza_horizon_official_x_fh6_maserati_mc20_video_window_4_5",
            media_kind: "direct_video",
          },
        ],
      },
    },
  });

  assert.ok(!profile.blockers.includes("visual_evidence:subject_motion_mismatch"));
});

test("trusts an explicit matching asset entity over incidental title words in its source family", () => {
  const profile = visualEvidenceProfile({
    story: {
      canonical_subject: "Denshattack",
      selected_title: "Denshattack Brings Train Kickflips To Game Pass",
    },
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          {
            id: "denshattack-meet-the-crew-window",
            entity: "Denshattack",
            path: "C:\\repo\\output\\video_cache\\denshattack-meet-the-crew-window.mp4",
            source_url: "https://www.youtube.com/watch?v=yDozyKrNNDk",
            source_type: "official_youtube_channel",
            source_family: "fireshine_official_denshattack_meet_the_crew_window_6_5",
            media_kind: "direct_video",
          },
        ],
      },
    },
  });

  assert.equal(profile.direct_video_motion_asset_count, 1);
  assert.equal(profile.subject_motion_mismatch_count, 0);
  assert.ok(!profile.blockers.includes("visual_evidence:subject_motion_mismatch"));
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

test("deduplicates direct-video rights records that omit source family but share the same file", () => {
  const clip = {
    id: "subnautica-window-1",
    path: "C:\\repo\\output\\video_cache\\subnautica_clip_1.mp4",
    source_url:
      "https://video.akamai.steamstatic.com/store_trailers/1962700/1381761660/hash/hls_264_master.m3u8",
    source_type: "steam_movie",
    media_kind: "direct_video",
    source_url_kind: "hls_manifest",
    source_family: "steam_1962700_1381761660",
  };
  const profile = visualEvidenceProfile({
    rightsLedger: {
      records: [
        {
          asset_id: "subnautica-window-1",
          path: clip.path,
          source_url: clip.source_url,
          source_type: clip.source_type,
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

test("deduplicating selected render fallbacks preserves richer direct-video metadata", () => {
  const localPath = "C:\\repo\\output\\video_cache\\star_wars_window.mp4";
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/2075800/876175/hash/hls_264_master.m3u8";
  const profile = visualEvidenceProfile({
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          {
            id: "steam-trailer-window",
            path: localPath,
            source_url: sourceUrl,
            source_type: "steam_movie",
            media_kind: "",
          },
          {
            id: "selected_render_clip_1",
            path: localPath,
            source_type: "selected_render_motion_clip",
            source_family: "selected_render_clip_1",
            validated: true,
          },
        ],
      },
    },
  });

  assert.equal(profile.asset_count, 1);
  assert.equal(profile.direct_video_motion_asset_count, 1);
  assert.equal(profile.direct_video_motion_family_count, 1);
});

test("same local fixture path with different source URLs remains distinct evidence", () => {
  const localPath = "C:\\repo\\output\\video_cache\\official_motion_fixture.mp4";
  const profile = visualEvidenceProfile({
    footageInventory: {
      motion_inventory: {
        production_motion_clips: Array.from({ length: 5 }, (_, index) => ({
          id: `official-motion-${index + 1}`,
          path: localPath,
          source_url: `https://cdn.example.test/official-${index + 1}.mp4`,
          source_type: "official_trailer_segment",
          source_family: `official_family_${index + 1}`,
          media_kind: "direct_video",
        })),
      },
    },
  });

  assert.equal(profile.asset_count, 5);
  assert.equal(profile.direct_video_motion_asset_count, 5);
  assert.equal(profile.direct_video_motion_family_count, 5);
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

test("authoritative final-render selection cannot borrow unused subject media to hide an abstract-only deck", () => {
  const ownedClips = Array.from({ length: 3 }, (_, index) => ({
    asset_id: `xbox-story-owned-motion-${index + 1}`,
    kind: "video",
    path: `C:\\repo\\output\\owned-motion\\abstract-${index + 1}.mp4`,
    source_url: `local://pulse-generated-motion/xbox-story/abstract-${index + 1}`,
  }));
  const unusedOfficialClip = {
    asset_id: "xbox-story-conker-official",
    path: "C:\\repo\\output\\video_cache\\conker-official.mp4",
    source_url: "https://cdn.xbox.com/games/conker-official.mp4",
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    subject_match_quality: "exact_game_match",
    exact_subject_group: "conker live and reloaded",
  };

  const profile = visualEvidenceProfile({
    story: {
      canonical_subject: "Xbox",
      canonical_game: "Xbox",
      selected_title: "4 Xbox Classics Hit PC",
    },
    renderManifest: {
      final_publish_render: true,
      selected_input_assets: {
        authoritative: true,
        complete: true,
        assets: ownedClips,
      },
    },
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          ...ownedClips.map((clip) => ({
            ...clip,
            source_type: "internally_generated_motion_graphic",
            media_kind: "owned_explainer_motion",
            licence_basis: "owned_generated_editorial_motion_graphic",
          })),
          unusedOfficialClip,
        ],
      },
    },
  });

  assert.equal(profile.evidence_scope, "authoritative_final_render_selection");
  assert.equal(profile.asset_count, 3);
  assert.equal(profile.real_media_asset_count, 0);
  assert.equal(profile.subject_matched_editorial_media_count, 0);
  assert.equal(profile.generated_only_motion_deck, true);
  assert.ok(profile.blockers.includes("visual_evidence:generated_only_motion_deck"));
  assert.ok(
    profile.blockers.includes(
      "visual_evidence:selected_render_subject_matched_editorial_media_missing",
    ),
  );
});

test("authoritative final-render selection accepts positively subject-matched editorial media", () => {
  const selectedPath = "C:\\repo\\output\\video_cache\\forza-official.mp4";
  const profile = visualEvidenceProfile({
    story: {
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Gets Its First Gameplay Reveal",
    },
    renderManifest: {
      final_publish_render: true,
      selected_input_assets: {
        authoritative: true,
        complete: true,
        assets: [
          {
            asset_id: "forza-official-window",
            kind: "video",
            path: selectedPath,
          },
        ],
      },
    },
    footageInventory: {
      motion_inventory: {
        production_motion_clips: [
          {
            asset_id: "forza-official-window",
            path: selectedPath,
            source_url: "https://cdn.xbox.com/games/forza-horizon-6/gameplay.mp4",
            source_type: "official_platform_product_page",
            media_kind: "direct_video",
            subject_match_quality: "exact_game_match",
            exact_subject_group: "forza horizon 6",
          },
        ],
      },
    },
  });

  assert.equal(profile.evidence_scope, "authoritative_final_render_selection");
  assert.equal(profile.real_media_asset_count, 1);
  assert.equal(profile.subject_matched_editorial_media_count, 1);
  assert.ok(
    !profile.blockers.includes(
      "visual_evidence:selected_render_subject_matched_editorial_media_missing",
    ),
  );
});
