"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOfficialDirectMediaDiscoveryReport,
  discoverDirectMediaUrlsFromText,
  renderOfficialDirectMediaDiscoveryMarkdown,
} = require("../../lib/official-direct-media-discovery");
const { parseArgs } = require("../../tools/official-direct-media-discovery");
const packageJson = require("../../package.json");

const entries = [
  {
    story_id: "forza-gap",
    entity: "Forza Horizon 6",
    source_family: "forza_official_site_forza_horizon_6",
    source_type: "official_publisher_or_developer_trailer_page",
    source_owner: "Forza official site - Forza Horizon 6",
    official_source_url: "https://forza.example/media",
    direct_media_url_if_available: "",
    downloads_allowed: false,
  },
  {
    story_id: "forza-gap",
    entity: "Forza Horizon 6",
    source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
    source_type: "official_youtube_channel_url",
    source_owner: "Xbox official YouTube - Forza Horizon 6 launch trailer",
    official_source_url: "https://www.youtube.com/watch?v=official",
    direct_media_url_if_available: "",
    downloads_allowed: false,
  },
];

test("direct-media discovery extracts validation-eligible video URLs from official page text", () => {
  const urls = discoverDirectMediaUrlsFromText({
    baseUrl: "https://forza.example/media",
    text: `
      <video>
        <source src="/trailers/forza-launch.mp4" type="video/mp4">
      </video>
      <a href="https://www.youtube.com/watch?v=not-direct">YouTube</a>
      {"hls":"https:\\/\\/cdn.forza.example\\/trailers\\/gameplay.m3u8"}
    `,
  });

  assert.deepEqual(
    urls.map((item) => item.url),
    [
      "https://forza.example/trailers/forza-launch.mp4",
      "https://cdn.forza.example/trailers/gameplay.m3u8",
    ],
  );
  assert.equal(urls[0].source_url_kind, "direct_video");
  assert.equal(urls[1].source_url_kind, "hls_manifest");
});

test("direct-media discovery preserves official YouTube embeds as reference-only intake rows", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "avatar-legends-stage",
        entity: "Avatar Legends",
        source_family: "playstation_blog_avatar_legends_stage",
        source_type: "official_game_site_news_page",
        source_owner: "PlayStation Blog official source",
        official_source_url: "https://blog.playstation.example/avatar-legends-stage",
        direct_media_url_if_available: "",
        downloads_allowed: false,
      },
    ],
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: `
        <iframe src="https://www.youtube.com/embed/NFVg25hd-hw"></iframe>
        <a href="https://www.youtube.com/watch?v=OqyDKxVAIIc">Avatar Legends match video</a>
      `,
    }),
  });

  assert.equal(report.summary.discovered, 0);
  assert.equal(report.summary.reference_only_youtube_embeds, 2);
  assert.equal(report.summary.expanded_template_entries, 3);
  assert.equal(report.rows[0].status, "no_direct_media_found");
  assert.equal(report.rows[0].reference_only_candidates.length, 2);

  const youtubeRows = report.output_template.entries.filter(
    (entry) => entry.source_type === "official_youtube_channel_url",
  );
  assert.deepEqual(
    youtubeRows.map((entry) => entry.official_source_url),
    [
      "https://www.youtube.com/watch?v=NFVg25hd-hw",
      "https://www.youtube.com/watch?v=OqyDKxVAIIc",
    ],
  );
  assert.ok(youtubeRows.every((entry) => entry.direct_media_url_if_available === ""));
  assert.ok(youtubeRows.every((entry) => entry.downloads_allowed === false));
  assert.ok(youtubeRows.every((entry) => entry.segment_validation_eligible === false));
  assert.ok(
    youtubeRows.every(
      (entry) => entry.segment_validation_ineligible_reason === "segment_source_is_youtube_reference",
    ),
  );
});

test("direct-media discovery extracts unicode-escaped official HLS URLs", () => {
  const urls = discoverDirectMediaUrlsFromText({
    baseUrl: "https://news.xbox.com/en-us/2026/06/19/end-of-abyss-combat-exploration-hands-on/",
    text: `{
      "contentUrl":"https\\u003a\\u002f\\u002fcdn.trailers.xboxservices.com\\u002ftrailers\\u002f00000000-0000-0000-0000-000000000000\\u002fis\\u002fcontent\\u002fmicrosoftassets\\u002fEnd-of-Abyss-AVS.m3u8\\u003fpackagedStreaming\\u003dtrue\\u0026playbackPolicy\\u003dDirect"
    }`,
  });

  assert.deepEqual(urls.map((item) => item.url), [
    "https://cdn.trailers.xboxservices.com/trailers/00000000-0000-0000-0000-000000000000/is/content/microsoftassets/End-of-Abyss-AVS.m3u8?packagedStreaming=true&playbackPolicy=Direct",
  ]);
  assert.equal(urls[0].source_url_kind, "hls_manifest");
});

test("direct-media discovery trims HTML-encoded Steam trailer manifest URLs", () => {
  const urls = discoverDirectMediaUrlsFromText({
    baseUrl: "https://store.steampowered.com/app/353370/Steam_Controller",
    text: `
      &quot;dashManifests&quot;:[
        &quot;https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/1751268402/dash_h264.mpd?t=1470853282&quot;
      ],
      &quot;hlsManifest&quot;:&quot;https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/1751268402/hls_264_master.m3u8?t=1470853282&quot;,
      &quot;screenshots&quot;:[{&quot;full&quot;:&quot;https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/353370/ss.jpg&quot;}]
    `,
  });

  assert.deepEqual(
    urls.map((item) => item.url),
    [
      "https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/1751268402/hls_264_master.m3u8?t=1470853282",
      "https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/1751268402/dash_h264.mpd?t=1470853282",
    ],
  );
  assert.ok(urls.every((item) => !/[\"<>]|&quot;/.test(item.url)));
});

test("direct-media discovery accepts same-app Steam trailer manifests with generic media names", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "elliot-gap",
        entity: "The Adventures of Elliot: The Millennium Tales",
        source_family: "steam_adventures_of_elliot_millennium_tales_storefront",
        source_type: "platform_storefront",
        source_owner: "Steam storefront for The Adventures of Elliot: The Millennium Tales",
        official_source_url:
          "https://store.steampowered.com/app/3483510/The_Adventures_of_Elliot_The_Millennium_Tales/",
      },
    ],
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: `
        &quot;hlsManifest&quot;:&quot;https://video.fastly.steamstatic.com/store_trailers/3483510/632943268/ab5efa5d538a2c90f09927047b2df6199cf5e9d6/1780277626/hls_264_master.m3u8?t=1781798240&quot;
      `,
    }),
    probeMedia: async () => ({ duration_seconds: 94, width: 1920, height: 1080 }),
  });

  assert.equal(report.summary.discovered, 1);
  assert.equal(report.rows[0].status, "direct_media_found");
  assert.equal(report.rows[0].entity_mismatch_candidate_count, 0);
  assert.equal(
    report.rows[0].direct_media_url,
    "https://video.fastly.steamstatic.com/store_trailers/3483510/632943268/ab5efa5d538a2c90f09927047b2df6199cf5e9d6/1780277626/hls_264_master.m3u8?t=1781798240",
  );
});

test("direct-media discovery falls back to Steam appdetails movie metadata", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "black-ops-gap",
        entity: "Call of Duty: Black Ops",
        source_family: "steam_42700_call_of_duty_black_ops",
        source_type: "platform_storefront",
        source_owner: "Steam storefront for Call of Duty: Black Ops",
        official_source_url: "https://store.steampowered.com/app/42700/Call_of_Duty_Black_Ops/",
      },
    ],
    generatedAt: "2026-06-24T12:20:00.000Z",
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: "<html><title>Age-check shell without trailer manifests</title></html>",
    }),
    fetchJson: async (url) => {
      assert.equal(url, "https://store.steampowered.com/api/appdetails?appids=42700&l=english&cc=us&filters=movies,basic");
      return {
        ok: true,
        status: 200,
        json: {
          42700: {
            success: true,
            data: {
              name: "Call of Duty: Black Ops",
              movies: [
                {
                  id: 9001,
                  name: "Call of Duty: Black Ops Launch Trailer",
                  hls_h264: "https://video.fastly.steamstatic.com/store_trailers/42700/9001/hls_264_master.m3u8",
                  dash_h264: "https://video.fastly.steamstatic.com/store_trailers/42700/9001/dash_h264.mpd",
                  mp4: {
                    max: "https://video.fastly.steamstatic.com/store_trailers/42700/9001/movie_max.mp4",
                    480: "https://video.fastly.steamstatic.com/store_trailers/42700/9001/movie480.mp4",
                  },
                  webm: {
                    max: "https://video.fastly.steamstatic.com/store_trailers/42700/9001/movie_max.webm",
                  },
                },
              ],
            },
          },
        },
      };
    },
    probeMedia: async (url) => {
      assert.equal(url, "https://video.fastly.steamstatic.com/store_trailers/42700/9001/hls_264_master.m3u8");
      return { duration_seconds: 91, width: 1920, height: 1080 };
    },
  });

  assert.equal(report.summary.discovered, 1);
  assert.equal(report.rows[0].status, "direct_media_found");
  assert.equal(report.rows[0].discovery_source, "steam_appdetails_movie_metadata");
  assert.equal(
    report.rows[0].direct_media_url,
    "https://video.fastly.steamstatic.com/store_trailers/42700/9001/hls_264_master.m3u8",
  );
  assert.equal(report.rows[0].direct_media_candidates[0].media_identity, "hls_264_master");
  assert.equal(
    report.output_template.entries[0].direct_media_url_if_available,
    "https://video.fastly.steamstatic.com/store_trailers/42700/9001/hls_264_master.m3u8",
  );
  assert.equal(report.output_template.entries[0].downloads_allowed, false);
});

test("direct-media discovery accepts official GTA VI compact-title media", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "gta-vi-preorders",
        entity: "Grand Theft Auto VI",
        source_family: "rockstar_gta_vi_official_site",
        source_type: "official_game_website_media_page",
        source_owner: "Rockstar Games",
        official_source_url: "https://www.rockstargames.com/VI/",
        source_url_kind: "html_or_unknown_page",
        segment_validation_eligible: false,
        segment_validation_ineligible_reason: "segment_source_url_not_direct_media",
      },
    ],
    fetchText: async (url) => {
      if (url === "https://www.rockstargames.com/VI/") {
        return {
          ok: true,
          status: 200,
          text: '<a href="https://www.rockstargames.com/VI/media">Media</a>',
        };
      }
      return {
        ok: true,
        status: 200,
        text: '<source src="https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4">',
      };
    },
    probeMedia: async (url) => {
      assert.equal(
        url,
        "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
      );
      return { duration_seconds: 32.67, width: 3840, height: 2160 };
    },
  });

  assert.equal(report.summary.discovered, 1);
  assert.equal(report.rows[0].status, "direct_media_found");
  assert.equal(report.rows[0].entity_mismatch_candidate_count, 0);
  assert.equal(report.rows[0].source_duration_s, 32.67);
  assert.equal(
    report.output_template.entries[0].direct_media_url_if_available,
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
  );
  assert.equal(report.output_template.entries[0].source_url_kind, "direct_video");
  assert.equal(report.output_template.entries[0].segment_validation_eligible, true);
  assert.equal(report.output_template.entries[0].segment_validation_ineligible_reason, null);
});

test("direct-media discovery supplements GTA VI official pages with Rockstar site motion families", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "gta-vi-ps5",
        entity: "Grand Theft Auto VI",
        source_family: "rockstar_gta_vi_official_videos",
        source_type: "official_game_website_media_page",
        source_owner: "Rockstar Games",
        official_source_url: "https://www.rockstargames.com/VI/media/videos",
      },
    ],
    maxCandidatesPerEntry: 8,
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: `
        <source src="https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4">
        <source src="https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4">
        <source src="https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_1/GTAVI_Trailer_1.mp4">
      `,
    }),
    probeMedia: async (url) => {
      if (url.includes("Cover_Art")) return { duration_seconds: 32.67, width: 3840, height: 2160 };
      if (url.includes("Trailer_2")) return { duration_seconds: 166.73, width: 3840, height: 2160 };
      if (url.includes("Trailer_1")) return { duration_seconds: 90.03, width: 3840, height: 2160 };
      if (url.includes("2160.06.kcaed--eoc")) return { duration_seconds: 8, width: 2376, height: 1336 };
      throw new Error(`unexpected probe: ${url}`);
    },
  });

  const urls = report.output_template.entries.map((entry) => entry.direct_media_url_if_available);
  assert.equal(report.summary.discovered, 1);
  assert.equal(report.summary.expanded_template_entries, 4);
  assert.equal(report.rows[0].direct_media_candidates.length, 4);
  assert.ok(
    urls.includes("https://www.rockstargames.com/VI/_next/static/media/2160.06.kcaed--eoc.mp4"),
  );
  assert.equal(new Set(report.output_template.entries.map((entry) => entry.source_family)).size, 4);
  assert.ok(report.output_template.entries.every((entry) => entry.downloads_allowed === false));
});

test("direct-media discovery rejects Steam trailer manifests from a different app id", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "elliot-gap",
        entity: "The Adventures of Elliot: The Millennium Tales",
        source_family: "steam_adventures_of_elliot_millennium_tales_storefront",
        source_type: "platform_storefront",
        source_owner: "Steam storefront for The Adventures of Elliot: The Millennium Tales",
        official_source_url:
          "https://store.steampowered.com/app/3483510/The_Adventures_of_Elliot_The_Millennium_Tales/",
      },
    ],
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: `
        &quot;hlsManifest&quot;:&quot;https://video.fastly.steamstatic.com/store_trailers/4394810/123456789/hash/1780277626/hls_264_master.m3u8?t=1781798240&quot;
      `,
    }),
    probeMedia: async () => ({ duration_seconds: 94, width: 1920, height: 1080 }),
  });

  assert.equal(report.summary.discovered, 0);
  assert.equal(report.rows[0].status, "no_direct_media_found");
  assert.equal(report.rows[0].rejection_reason, "entity_mismatch_direct_media_candidates");
});

test("direct-media discovery expands Nintendo Cloudinary H264 poster URLs into mp4 candidates", () => {
  const urls = discoverDirectMediaUrlsFromText({
    baseUrl: "https://www.nintendo.com/us/store/products/super-mario-rpg-switch/",
    text: `
      <meta property="og:video" content="https://assets.nintendo.com/image/upload/f_auto/q_auto/dpr_1.5/Microsites/Super%20Mario%20RPG%20PMP/posters/Switch_SMRPG_Overview-TRL_Social_1080_H264">
      <img src="https://assets.nintendo.com/image/upload/f_auto/q_auto/dpr_1.5/Marketing/pmp-super-mario-rpg-07756b0e/characters/cards/mario-2x">
    `,
  });

  assert.deepEqual(
    urls.map((item) => item.url),
    [
      "https://assets.nintendo.com/image/upload/f_auto/q_auto/dpr_1.5/Microsites/Super%20Mario%20RPG%20PMP/posters/Switch_SMRPG_Overview-TRL_Social_1080_H264.mp4",
    ],
  );
  assert.equal(urls[0].source_url_kind, "direct_video");
  assert.equal(urls[0].source, "cloudinary_video_derivative");
});

test("direct-media discovery expands Nintendo storefront Cloudinary video poster assets into mp4 candidates", () => {
  const urls = discoverDirectMediaUrlsFromText({
    baseUrl: "https://www.nintendo.com/us/store/products/super-mario-rpg-switch/",
    text: `
      <img src="https://assets.nintendo.com/image/upload/q_auto:best/f_auto/dpr_2.0//store/software/switch/70010000068683/Video/946fb66280168f451a6b0c588f39905d721f477d9160de718f95cb222e684d5f">
      <img src="https://assets.nintendo.com/image/upload/q_auto:best/f_auto/dpr_2.0//store/software/switch/70010000068683/Video/b41c674b67c256fd9ae8e8bd750cbb8626c592d963a63e1e94822ef399833ef3">
      <img src="https://assets.nintendo.com/image/upload/f_auto/q_auto/Marketing/pmp-super-mario-rpg-07756b0e/backgrounds/pattern-stars-blue-2x">
    `,
  });

  assert.deepEqual(
    urls.map((item) => item.url),
    [
      "https://assets.nintendo.com/video/upload/store/software/switch/70010000068683/Video/946fb66280168f451a6b0c588f39905d721f477d9160de718f95cb222e684d5f.mp4",
      "https://assets.nintendo.com/video/upload/store/software/switch/70010000068683/Video/b41c674b67c256fd9ae8e8bd750cbb8626c592d963a63e1e94822ef399833ef3.mp4",
    ],
  );
  assert.ok(urls.every((item) => item.source_url_kind === "direct_video"));
  assert.ok(urls.every((item) => item.source === "cloudinary_video_derivative"));
});

test("direct-media discovery matches Nintendo Cloudinary parent path context to the story entity", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "mario-gap",
        entity: "Super Mario RPG",
        source_family: "nintendo_store_super_mario_rpg_switch",
        official_source_url: "https://www.nintendo.com/us/store/products/super-mario-rpg-switch/",
      },
    ],
    generatedAt: "2026-05-27T13:31:00.000Z",
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: '<meta content="https://assets.nintendo.com/image/upload/f_auto/q_auto/dpr_1.5/Microsites/Super%20Mario%20RPG%20PMP/posters/Switch_SMRPG_Overview-TRL_Social_1080_H264">',
    }),
    probeMedia: async () => ({ duration_seconds: 97, width: 1920, height: 1080 }),
  });

  assert.equal(report.summary.discovered, 1);
  assert.equal(report.rows[0].status, "direct_media_found");
  assert.equal(
    report.rows[0].direct_media_url,
    "https://assets.nintendo.com/image/upload/f_auto/q_auto/dpr_1.5/Microsites/Super%20Mario%20RPG%20PMP/posters/Switch_SMRPG_Overview-TRL_Social_1080_H264.mp4",
  );
  assert.equal(report.rows[0].entity_mismatch_candidate_count, 0);
});

test("direct-media discovery rejects poster-length mp4 derivatives as unusable motion", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "mario-gap",
        entity: "Super Mario RPG",
        source_family: "nintendo_store_super_mario_rpg_switch",
        official_source_url: "https://www.nintendo.com/us/store/products/super-mario-rpg-switch/",
      },
    ],
    generatedAt: "2026-05-27T13:34:00.000Z",
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: '<meta content="https://assets.nintendo.com/image/upload/f_auto/q_auto/dpr_1.5/Microsites/Super%20Mario%20RPG%20PMP/posters/Switch_SMRPG_Overview-TRL_Social_1080_H264">',
    }),
    probeMedia: async () => ({ duration_seconds: 0.1, width: 1280, height: 720 }),
  });

  assert.equal(report.summary.discovered, 0);
  assert.equal(report.rows[0].status, "no_direct_media_found");
  assert.equal(report.rows[0].rejection_reason, "direct_media_candidates_below_min_duration");
  assert.equal(report.output_template.entries[0].direct_media_url_if_available, "");
});

test("direct-media discovery follows bounded same-origin official media pages", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "forza-gap",
        entity: "Forza Horizon 6",
        source_family: "forza_official_resources",
        official_source_url: "https://forza.example/news/forza-horizon-6",
        direct_media_url_if_available: "",
      },
    ],
    generatedAt: "2026-05-20T04:45:00.000Z",
    fetchText: async (url) => {
      if (url === "https://forza.example/news/forza-horizon-6") {
        return {
          ok: true,
          status: 200,
          text: '<a href="/media-kit/forza-horizon-6">Official media kit</a>',
        };
      }
      if (url === "https://forza.example/media-kit/forza-horizon-6") {
        return {
          ok: true,
          status: 200,
          text: '{"gameplay":"https:\\u002F\\u002Fcdn.forza.example\\u002Ffh6\\u002Fgameplay.m3u8"}',
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  assert.equal(report.summary.discovered, 1);
  assert.equal(report.rows[0].status, "direct_media_found");
  assert.equal(report.rows[0].discovery_source, "official_same_origin_media_page");
  assert.equal(report.rows[0].discovered_page_url, "https://forza.example/media-kit/forza-horizon-6");
  assert.equal(report.rows[0].candidate_count, 1);
  assert.equal(
    report.rows[0].direct_media_url,
    "https://cdn.forza.example/fh6/gameplay.m3u8",
  );
  assert.equal(
    report.output_template.entries[0].direct_media_url_if_available,
    "https://cdn.forza.example/fh6/gameplay.m3u8",
  );
});

test("direct-media discovery follows trusted official storefront links from article pages", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "sea-gap",
        entity: "Sea of Thieves",
        source_family: "xbox_wire_sea_of_thieves",
        official_source_url: "https://news.xbox.com/en-us/2026/06/19/sea-of-thieves-custom-seas-update-details/",
        direct_media_url_if_available: "",
      },
    ],
    generatedAt: "2026-06-20T02:50:00.000Z",
    fetchText: async (url) => {
      if (url === "https://news.xbox.com/en-us/2026/06/19/sea-of-thieves-custom-seas-update-details/") {
        return {
          ok: true,
          status: 200,
          text: `
            <a href="https://store.steampowered.com/app/1172620/Sea_of_Thieves_2025_Edition/">Sea of Thieves on Steam</a>
            <a href="https://store.steampowered.com/app/999999/Unrelated_Game/">Unrelated Game</a>
          `,
        };
      }
      if (url === "https://store.steampowered.com/app/1172620/Sea_of_Thieves_2025_Edition/") {
        return {
          ok: true,
          status: 200,
          text: `
            &quot;hlsManifest&quot;:&quot;https://video.fastly.steamstatic.com/store_trailers/1172620/123456/hash/1780277626/hls_264_master.m3u8?t=1781798240&quot;
          `,
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    probeMedia: async () => ({ duration_seconds: 68, width: 1920, height: 1080 }),
  });

  assert.equal(report.summary.discovered, 1);
  assert.equal(report.rows[0].status, "direct_media_found");
  assert.equal(report.rows[0].discovery_source, "trusted_official_linked_media_page");
  assert.equal(
    report.rows[0].discovered_page_url,
    "https://store.steampowered.com/app/1172620/Sea_of_Thieves_2025_Edition/",
  );
  assert.equal(
    report.rows[0].direct_media_url,
    "https://video.fastly.steamstatic.com/store_trailers/1172620/123456/hash/1780277626/hls_264_master.m3u8?t=1781798240",
  );
  assert.equal(
    report.output_template.entries[0].direct_media_url_if_available,
    "https://video.fastly.steamstatic.com/store_trailers/1172620/123456/hash/1780277626/hls_264_master.m3u8?t=1781798240",
  );
});

test("direct-media discovery can expand multiple official media candidates for intake", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "oblivion-gap",
        entity: "Oblivion Remastered",
        source_family: "xbox_store_oblivion_remastered_trailer",
        official_source_url: "https://xbox.example/store/oblivion",
        direct_media_url_if_available: "",
      },
    ],
    generatedAt: "2026-05-22T10:10:00.000Z",
    maxCandidatesPerEntry: 2,
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: `
        <source src="https://cdn.xbox.example/media/7466fbe0-dae3-4299-846f-dc2c436f3b42-AVS.m3u8?packagedStreaming=true">
        <source src="https://cdn.xbox.example/media/5f838898-0cd3-45f6-b8ad-d1492fab45c5-AVS.m3u8?packagedStreaming=true">
      `,
    }),
    probeMedia: async (url) => ({
      duration_seconds: url.includes("7466fbe0") ? 136 : 42,
      width: 1920,
      height: 1080,
    }),
  });

  assert.equal(report.summary.discovered, 1);
  assert.equal(report.summary.expanded_template_entries, 2);
  assert.equal(report.rows[0].direct_media_candidates.length, 2);
  assert.deepEqual(
    report.output_template.entries.map((entry) => entry.source_family),
    [
      "xbox_store_oblivion_remastered_trailer",
      "xbox_store_oblivion_remastered_trailer__media_02_5f838898",
    ],
  );
  assert.deepEqual(
    report.output_template.entries.map((entry) => entry.source_duration_s),
    [136, 42],
  );
  assert.ok(report.output_template.entries.every((entry) => entry.downloads_allowed === false));
});

test("direct-media discovery ignores placeholder UUIDs when naming Xbox media rows", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "oblivion-gap",
        entity: "Oblivion Remastered",
        source_family: "xbox_store_oblivion_remastered_trailer",
        official_source_url: "https://xbox.example/store/oblivion",
      },
    ],
    maxCandidatesPerEntry: 2,
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: `
        <source src="https://cdn.trailers.xboxservices.com/trailers/00000000-0000-0000-0000-000000000000/is/content/microsoftassets/7466fbe0-dae3-4299-846f-dc2c436f3b42-AVS.m3u8?packagedStreaming=true">
        <source src="https://cdn.trailers.xboxservices.com/trailers/00000000-0000-0000-0000-000000000000/is/content/microsoftassets/5f838898-0cd3-45f6-b8ad-d1492fab45c5-AVS.m3u8?packagedStreaming=true">
      `,
    }),
  });

  assert.deepEqual(
    report.rows[0].direct_media_candidates.map((candidate) => candidate.media_identity),
    ["7466fbe0", "5f838898"],
  );
  assert.equal(
    report.output_template.entries[1].source_family,
    "xbox_store_oblivion_remastered_trailer__media_02_5f838898",
  );
});

test("direct-media discovery ranks probed high-resolution motion before low-value placeholders", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "oblivion-gap",
        entity: "Oblivion Remastered",
        source_family: "xbox_store_oblivion_remastered_trailer",
        official_source_url: "https://xbox.example/store/oblivion",
      },
    ],
    maxCandidatesPerEntry: 2,
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: `
        <source src="https://cdn.xbox.example/media/low-320x180.mp4">
        <source src="https://cdn.xbox.example/media/high-gameplay-1920x1080.m3u8">
        <source src="https://cdn.xbox.example/media/short-logo-1920x1080.mp4">
      `,
    }),
    probeMedia: async (url) => {
      if (url.includes("low-320x180")) return { duration_seconds: 8, width: 320, height: 180 };
      if (url.includes("high-gameplay")) return { duration_seconds: 92, width: 1920, height: 1080 };
      return { duration_seconds: 3, width: 1920, height: 1080 };
    },
  });

  assert.deepEqual(
    report.rows[0].direct_media_candidates.map((candidate) => candidate.media_identity),
    ["high_gameplay_1920x1080", "low_320x180"],
  );
  assert.equal(
    report.rows[0].direct_media_url,
    "https://cdn.xbox.example/media/high-gameplay-1920x1080.m3u8",
  );
  assert.deepEqual(
    report.output_template.entries.map((entry) => entry.source_family),
    [
      "xbox_store_oblivion_remastered_trailer",
      "xbox_store_oblivion_remastered_trailer__media_02_low_320x180",
    ],
  );
});

test("direct-media discovery rejects title-like media URLs that do not match the story entity", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "zero-company-gap",
        entity: "Star Wars Zero Company",
        source_family: "starwars_zero_company_official_page",
        official_source_url: "https://www.starwars.example/games/star-wars-zero-company",
      },
    ],
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: `
        <source src="https://cdn.starwars.example/fileName/Star_Wars_The_Mandalorian_and_Grogu_Ace_of_Staves_1080.mp4">
        <source src="https://cdn.starwars.example/fileName/Star_Wars_The_Mandalorian_and_Grogu_Bring_Me_His_Helmet_1080.mp4">
      `,
    }),
    probeMedia: async () => ({ duration_seconds: 62, width: 1920, height: 1080 }),
    maxCandidatesPerEntry: 2,
  });

  assert.equal(report.summary.discovered, 0);
  assert.equal(report.rows[0].status, "no_direct_media_found");
  assert.equal(report.rows[0].rejection_reason, "entity_mismatch_direct_media_candidates");
  assert.equal(report.rows[0].entity_mismatch_candidate_count, 2);
  assert.deepEqual(report.output_template.entries[0].direct_media_url_if_available, "");
});

test("direct-media discovery rejects short distinctive wrong-game media slugs", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: [
      {
        story_id: "forza-gap",
        entity: "Forza Horizon 6",
        source_family: "ign_forza_horizon_6_quick_resume",
        official_source_url: "https://www.ign.example/articles/forza-quick-resume",
      },
    ],
    fetchText: async () => ({
      ok: true,
      status: 200,
      text: '<source src="https://cdn.jsdelivr.net/gh/kaydf/kcd2/kcd2-hero.mp4">',
    }),
    probeMedia: async () => ({ duration_seconds: 7, width: 2350, height: 1080 }),
  });

  assert.equal(report.summary.discovered, 0);
  assert.equal(report.rows[0].status, "no_direct_media_found");
  assert.equal(report.rows[0].rejection_reason, "entity_mismatch_direct_media_candidates");
  assert.equal(report.rows[0].entity_mismatch_candidate_count, 1);
  assert.equal(report.output_template.entries[0].direct_media_url_if_available, "");
});

test("direct-media discovery retries blocked official pages with a neutral fetch", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, userAgent: options.headers?.["user-agent"] || "" });
    if (calls.length === 1) {
      return { ok: false, status: 403, text: async () => "" };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '<source src="https://cdn.forza.example/fh6/initial-drive.mp4">',
    };
  };

  try {
    const report = await buildOfficialDirectMediaDiscoveryReport({
      entries: [
        {
          story_id: "forza-gap",
          entity: "Forza Horizon 6",
          source_family: "publisher_media_repository",
          official_source_url: "https://media.example/forza-horizon-6",
        },
      ],
      generatedAt: "2026-05-20T06:55:00.000Z",
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[1].userAgent, "");
    assert.equal(report.summary.discovered, 1);
    assert.equal(report.rows[0].discovery_source, "html_scan_neutral_retry");
    assert.equal(report.rows[0].direct_media_url, "https://cdn.forza.example/fh6/initial-drive.mp4");
  } finally {
    global.fetch = originalFetch;
  }
});

test("direct-media discovery fills safe intake rows without downloading media", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries,
    generatedAt: "2026-05-19T22:00:00.000Z",
    fetchText: async (url) => {
      if (url === "https://forza.example/media") {
        return {
          ok: true,
          status: 200,
          text: '<source src="https://cdn.forza.example/trailers/forza-gameplay.webm">',
        };
      }
      return { ok: true, status: 200, text: '<iframe src="https://www.youtube.com/embed/official"></iframe>' };
    },
    probeMedia: async (url) => {
      assert.equal(url, "https://cdn.forza.example/trailers/forza-gameplay.webm");
      return { duration_seconds: 10, width: 1920, height: 1080 };
    },
  });

  assert.equal(report.execution_mode, "official_direct_media_discovery");
  assert.equal(report.summary.entries, 2);
  assert.equal(report.summary.discovered, 1);
  assert.equal(report.safety.video_downloads_started, false);
  assert.equal(report.rows[0].status, "direct_media_found");
  assert.equal(
    report.output_template.entries[0].direct_media_url_if_available,
    "https://cdn.forza.example/trailers/forza-gameplay.webm",
  );
  assert.equal(report.rows[0].source_duration_s, 10);
  assert.equal(report.output_template.entries[0].source_duration_s, 10);
  assert.equal(report.output_template.entries[0].downloads_allowed, false);
  assert.equal(report.rows[1].status, "no_direct_media_found");
});

test("direct-media discovery markdown and CLI are operator-safe", async () => {
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries: entries.slice(0, 1),
    fetchText: async () => ({ ok: true, status: 200, text: "" }),
  });
  const markdown = renderOfficialDirectMediaDiscoveryMarkdown(report);
  const args = parseArgs([
    "node",
    "tools/official-direct-media-discovery.js",
    "--input",
    "test/output/visual_v4_source_family_intake_template.json",
    "--story-id",
    "forza-gap",
    "--max-candidates-per-entry",
    "4",
  ]);

  assert.match(markdown, /Official Direct Media Discovery/);
  assert.match(markdown, /No videos are downloaded/);
  assert.equal(args.storyId, "forza-gap");
  assert.equal(args.maxCandidatesPerEntry, 4);
  assert.match(
    packageJson.scripts["media:discover-direct-media"],
    /official-direct-media-discovery\.js/,
  );
});
