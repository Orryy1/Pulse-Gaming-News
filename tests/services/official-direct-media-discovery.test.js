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
