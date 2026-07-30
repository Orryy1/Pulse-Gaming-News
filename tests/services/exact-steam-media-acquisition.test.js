"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const axios = require("axios");

const getBestImage = require("../../images_download");
const { fetchGameImages } = require("../../hunter");
const {
  selectExactSteamSearchMatch,
  filterMixedSteamAssetsForExactApp,
} = require("../../images_download");
const {
  normaliseAcquiredMediaForStory,
} = require("../../images");
const {
  buildAssetAcquisitionPlan,
} = require("../../lib/asset-acquisition-pro");

function searchAttempt(searchTerm, items) {
  return {
    search_term: searchTerm,
    items,
  };
}

test("exact Steam selector chooses Townfall app 1636440 instead of the first Silent Hill franchise result", () => {
  const story = {
    id: "rss_859a44c4ba983cbb",
    title:
      "Silent Hill: Townfall hands-on report reveals its first-person combat",
  };

  const selected = selectExactSteamSearchMatch(story, [
    searchAttempt("Silent Hill", [
      { id: 2124490, name: "SILENT HILL 2" },
      { id: 1636440, name: "SILENT HILL: Townfall" },
    ]),
  ]);

  assert.deepEqual(
    {
      app_id: selected.app_id,
      app_title: selected.app_title,
      matched_query: selected.matched_query,
    },
    {
      app_id: "1636440",
      app_title: "SILENT HILL: Townfall",
      matched_query: "Silent Hill",
    },
  );
});

test("exact Steam selector resolves the second current auto candidate Stupid Never Dies", () => {
  const selected = selectExactSteamSearchMatch(
    {
      id: "rss_7077fe96c9ebdb40",
      title:
        "Stylish action RPG Stupid Never Dies gets release date, new trailer",
    },
    [
      searchAttempt("Stylish action RPG Stupid Never Dies", [
        { id: 3486530, name: "Stupid Never Dies" },
      ]),
    ],
  );

  assert.equal(selected.app_id, "3486530");
  assert.equal(selected.app_title, "Stupid Never Dies");
});

test("exact Steam selector accepts distinctive one-word games and normal game-title colon headlines", () => {
  const starfield = selectExactSteamSearchMatch(
    { title: "Starfield gets a major new update" },
    [
      searchAttempt("Starfield major new update", [
        { id: 1716740, name: "Starfield" },
      ]),
    ],
  );
  const colonHeadline = selectExactSteamSearchMatch(
    { title: "Stupid Never Dies: release date and new trailer" },
    [
      searchAttempt("Stupid Never Dies", [
        { id: 3486530, name: "Stupid Never Dies" },
      ]),
    ],
  );

  assert.equal(starfield?.app_id, "1716740");
  assert.equal(colonHeadline?.app_id, "3486530");
});

test("exact Steam selector rejects an incidental common phrase that happens to be an app title", () => {
  const newWorld = selectExactSteamSearchMatch(
    {
      title: "A New World record was set in Super Mario 64",
    },
    [
      searchAttempt("New World Record Super Mario 64", [
        { id: 1063730, name: "New World" },
      ]),
    ],
  );
  const control = selectExactSteamSearchMatch(
    {
      title: "Changes in control groups improve this experiment",
    },
    [
      searchAttempt("Changes Control Groups Experiment", [
        { id: 870780, name: "Control" },
      ]),
    ],
  );

  assert.equal(newWorld, null);
  assert.equal(control, null);
});

test("exact Steam selector rejects every non-nested app in a multi-game headline", () => {
  const selected = selectExactSteamSearchMatch(
    {
      title:
        "Final Fantasy VII Remake Intergrade, Final Fantasy VII and New World all get updates",
    },
    [
      searchAttempt("Final Fantasy VII Remake Intergrade", [
        {
          id: 1462040,
          name: "FINAL FANTASY VII REMAKE INTERGRADE",
        },
        { id: 1026680, name: "FINAL FANTASY VII" },
        { id: 1063730, name: "New World" },
      ]),
    ],
  );

  assert.equal(selected, null);
});

test("exact Steam selector fails closed for franchise-only and ambiguous search results", () => {
  const selected = selectExactSteamSearchMatch(
    {
      id: "rss-townfall",
      title: "Silent Hill: Townfall hands-on report",
    },
    [
      searchAttempt("Silent Hill", [
        { id: 2124490, name: "SILENT HILL 2" },
        { id: 1900, name: "Silent Hill" },
        { id: "not-an-app-id", name: "Silent Hill: Townfall" },
      ]),
    ],
  );

  assert.equal(selected, null);
});

test("automatic image production downloads only exact Townfall Steam media and stamps durable identity", async () => {
  const imageDownloads = [];
  const videoDownloads = [];
  const lookupIds = [];
  const searchTerms = [];

  const result = await getBestImage(
    {
      id: "rss_859a44c4ba983cbb",
      title:
        "Silent Hill: Townfall hands-on report reveals its first-person combat",
      approved: true,
      game_images: [],
      downloaded_images: [],
    },
    {
      async steamSearch(searchTerm) {
        searchTerms.push(searchTerm);
        return searchTerm.toLowerCase().includes("silent hill")
          ? [
              { id: 2124490, name: "SILENT HILL 2" },
              { id: 1636440, name: "SILENT HILL: Townfall" },
            ]
          : [];
      },
      async steamLookup(appId) {
        lookupIds.push(String(appId));
        return {
          name: "SILENT HILL: Townfall",
          screenshots: [
            {
              path_full:
                "https://cdn.akamai.steamstatic.com/steam/apps/1636440/ss_01.jpg",
            },
            {
              path_full:
                "https://cdn.akamai.steamstatic.com/steam/apps/1636440/ss_02.jpg",
            },
            {
              path_full:
                "https://cdn.akamai.steamstatic.com/steam/apps/1636440/ss_03.jpg",
            },
            {
              path_full:
                "https://cdn.akamai.steamstatic.com/steam/apps/1636440/ss_04.jpg",
            },
          ],
          movies: [
            {
              name: "Launch Trailer",
              webm: {
                max:
                  "https://cdn.akamai.steamstatic.com/steam/apps/1636440/townfall.webm",
              },
            },
          ],
        };
      },
      async downloadImage(url, filename) {
        imageDownloads.push(url);
        return `output/image_cache/${filename}`;
      },
      async downloadVideoClip(url, filename) {
        videoDownloads.push(url);
        return `output/video_cache/${filename}`;
      },
      async recordProvenance() {},
      disableFallbackBroll: true,
    },
  );

  assert.deepEqual(lookupIds, ["1636440"]);
  assert.equal(searchTerms.length <= 3, true);
  assert.equal(imageDownloads.length, 7);
  assert.equal(videoDownloads.length, 1);
  assert.equal(
    [...imageDownloads, ...videoDownloads].some((url) =>
      url.includes("/2124490/"),
    ),
    false,
  );
  assert.equal(result.images.length, 7);
  assert.equal(result.videoClips.length, 1);
  for (const asset of [...result.images, ...result.videoClips]) {
    assert.equal(asset.store_app_id, "1636440");
    assert.equal(asset.store_app_title, "SILENT HILL: Townfall");
    assert.equal(asset.store_match_verified, true);
    assert.equal(asset.entity, "SILENT HILL: Townfall");
  }
  assert.equal(result.images[0].source_type.startsWith("steam_"), true);
  assert.equal(result.videoClips[0].source_type, "steam_trailer");

  const persisted = normaliseAcquiredMediaForStory({
    images: result.images,
    videoClips: result.videoClips,
  });
  const readiness = buildAssetAcquisitionPlan({
    id: "rss_859a44c4ba983cbb",
    title:
      "Silent Hill: Townfall hands-on report reveals its first-person combat",
    url: "https://example.test/silent-hill-townfall",
    source_type: "rss",
    subreddit: "official",
    flair: "Verified",
    score: 100,
    timestamp: "2026-07-30T05:30:00Z",
    hook: "Silent Hill: Townfall is finally playable.",
    body:
      "The first hands-on report confirms first-person combat and the exact game footage now supports the story.",
    loop: "Townfall now has a much clearer identity.",
    full_script:
      "Silent Hill: Townfall is finally playable. The first hands-on report confirms first-person combat and the exact game footage now supports the story. Townfall now has a much clearer identity.",
    editorial_lane_id: "what_changes_for_players",
    hook_type: "direct",
    duration_band_id: "what_changes_standard_35_42",
    thumbnail_candidate_path: result.images[0].path,
    outro_present: true,
    ...persisted,
  });
  assert.equal(
    readiness.exact_subject_readiness.exact_subject_asset_count >= 4,
    true,
  );
  assert.equal(
    readiness.exact_subject_readiness
      .studio_v2_selected_band_eligible,
    true,
    readiness.exact_subject_readiness.downgrade_reasons.join(","),
  );
});

test("automatic image production replaces stale wrong-app Steam media before deciding fallback is unnecessary", async () => {
  const imageDownloads = [];
  const videoDownloads = [];
  const lookupIds = [];

  const result = await getBestImage(
    {
      id: "rss_859a44c4ba983cbb",
      title:
        "Silent Hill: Townfall hands-on report reveals its first-person combat",
      approved: true,
      article_image: "https://assets.example.test/townfall-article.jpg",
      game_images: [
        {
          url:
            "https://cdn.akamai.steamstatic.com/steam/apps/2124490/header.jpg",
          type: "key_art",
          source: "steam",
          steam_app_id: "2124490",
          steam_app_title: "SILENT HILL 2",
          steam_matched_query: "Silent Hill",
        },
        {
          url:
            "https://cdn.akamai.steamstatic.com/steam/apps/2124490/sh2.webm",
          type: "trailer",
          source: "steam",
          is_video: true,
          steam_app_id: "2124490",
          steam_app_title: "SILENT HILL 2",
          steam_matched_query: "Silent Hill",
        },
      ],
      downloaded_images: [],
    },
    {
      async steamSearch(searchTerm) {
        return searchTerm.toLowerCase().includes("silent hill")
          ? [
              { id: 2124490, name: "SILENT HILL 2" },
              { id: 1636440, name: "SILENT HILL: Townfall" },
            ]
          : [];
      },
      async steamLookup(appId) {
        lookupIds.push(String(appId));
        return {
          name: "SILENT HILL: Townfall",
          screenshots: [
            {
              path_full:
                "https://cdn.akamai.steamstatic.com/steam/apps/1636440/ss_01.jpg",
            },
          ],
          movies: [
            {
              name: "Official Trailer",
              webm: {
                max:
                  "https://cdn.akamai.steamstatic.com/steam/apps/1636440/townfall.webm",
              },
            },
          ],
        };
      },
      async downloadImage(url, filename) {
        imageDownloads.push(url);
        return `output/image_cache/${filename}`;
      },
      async downloadVideoClip(url, filename) {
        videoDownloads.push(url);
        return `output/video_cache/${filename}`;
      },
      async recordProvenance() {},
      disableFallbackBroll: true,
    },
  );

  assert.deepEqual(lookupIds, ["1636440"]);
  assert.equal(
    [...imageDownloads, ...videoDownloads].some((url) =>
      url.includes("/2124490/"),
    ),
    false,
  );
  assert.equal(
    result.images.filter((asset) => asset.store_app_id === "1636440")
      .length >= 4,
    true,
  );
  assert.equal(result.videoClips[0].store_app_id, "1636440");
});

test("automatic image production keeps current hunter Steam trailers by inheriting verified sibling app identity", async () => {
  const videoDownloads = [];
  const result = await getBestImage(
    {
      id: "hunter-townfall-shape",
      title: "Silent Hill: Townfall hands-on report",
      game_images: [
        {
          url:
            "https://cdn.akamai.steamstatic.com/steam/apps/1636440/header.jpg",
          type: "key_art",
          source: "steam",
          steam_app_id: "1636440",
          steam_app_title: "SILENT HILL: Townfall",
          steam_matched_query: "Silent Hill: Townfall",
        },
        {
          url:
            "https://cdn.akamai.steamstatic.com/steam/apps/1636440/townfall.webm",
          type: "trailer",
          source: "steam",
          is_video: true,
        },
      ],
    },
    {
      async steamSearch() {
        throw new Error("a verified sibling image must suppress direct search");
      },
      async downloadImage(_url, filename) {
        return `output/image_cache/${filename}`;
      },
      async downloadVideoClip(url, filename) {
        videoDownloads.push(url);
        return `output/video_cache/${filename}`;
      },
      async recordProvenance() {},
      disableFallbackBroll: true,
    },
  );

  assert.equal(videoDownloads.length, 1);
  assert.equal(result.videoClips.length, 1);
  assert.equal(result.videoClips[0].store_app_id, "1636440");
  assert.equal(result.videoClips[0].store_match_verified, true);
});

test("hunter stamps Steam app identity on future trailer rows", async () => {
  const originalGet = axios.get;
  axios.get = async (url) => {
    if (String(url).includes("/api/storesearch/")) {
      return {
        data: {
          items: [
            { id: 1636440, name: "SILENT HILL: Townfall" },
          ],
        },
      };
    }
    if (String(url).includes("/api/appdetails")) {
      return {
        data: {
          1636440: {
            data: {
              name: "SILENT HILL: Townfall",
              movies: [
                {
                  name: "Official Trailer",
                  highlight: true,
                  webm: {
                    max:
                      "https://cdn.akamai.steamstatic.com/steam/apps/1636440/townfall.webm",
                  },
                },
              ],
            },
          },
        },
      };
    }
    if (String(url).includes("/appreviews/")) {
      return { data: { query_summary: {} } };
    }
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const assets = await fetchGameImages(
      "Silent Hill: Townfall",
    );
    const trailer = assets.find((asset) => asset.is_video);
    assert.ok(trailer);
    assert.equal(trailer.source_type, "steam_trailer");
    assert.equal(trailer.steam_app_id, "1636440");
    assert.equal(
      trailer.steam_app_title,
      "SILENT HILL: Townfall",
    );
    assert.equal(
      trailer.steam_matched_query,
      "Silent Hill: Townfall",
    );
  } finally {
    axios.get = originalGet;
  }
});

test("mixed Steam assets keep only title-verified app media once an exact app is known", () => {
  const story = {
    title: "Silent Hill: Townfall hands-on report",
  };
  const filtered = filterMixedSteamAssetsForExactApp(story, [
    {
      path: "townfall.jpg",
      source: "steam",
      url:
        "https://cdn.akamai.steamstatic.com/steam/apps/1636440/header.jpg",
      steam_app_id: "1636440",
      steam_app_title: "SILENT HILL: Townfall",
      steam_matched_query: "Silent Hill: Townfall",
    },
    {
      path: "silent-hill-2.jpg",
      source: "steam",
      url:
        "https://cdn.akamai.steamstatic.com/steam/apps/2124490/header.jpg",
      steam_app_id: "2124490",
      steam_app_title: "SILENT HILL 2",
      steam_matched_query: "Silent Hill",
    },
    {
      path: "article.jpg",
      source: "article",
      url: "https://publisher.example/townfall.jpg",
    },
  ]);

  assert.deepEqual(
    filtered.map((asset) => asset.path),
    ["townfall.jpg", "article.jpg"],
  );
  assert.equal(filtered[0].store_match_verified, true);
});

test("non-Steam presaved video keeps its real source family", async () => {
  const result = await getBestImage(
    {
      id: "youtube-video-shape",
      title: "A platform policy explainer",
      game_images: [
        {
          url: "https://video.example.test/platform-explainer.mp4",
          type: "trailer",
          source: "youtube",
          is_video: true,
        },
      ],
    },
    {
      async steamSearch() {
        return [];
      },
      async downloadImage() {
        return null;
      },
      async downloadVideoClip(_url, filename) {
        return `output/video_cache/${filename}`;
      },
      async recordProvenance() {},
      disableFallbackBroll: true,
    },
  );

  assert.equal(result.videoClips.length, 1);
  assert.equal(
    result.videoClips[0].source_type,
    "youtube_video_reference",
  );
});

test("automatic image production does not download a loose Steam mismatch", async () => {
  let downloads = 0;
  let lookups = 0;

  const result = await getBestImage(
    {
      id: "rss-townfall",
      title: "Silent Hill: Townfall hands-on report",
      approved: true,
      game_images: [],
      downloaded_images: [],
    },
    {
      async steamSearch() {
        return [{ id: 2124490, name: "SILENT HILL 2" }];
      },
      async steamLookup() {
        lookups += 1;
        return {};
      },
      async downloadImage() {
        downloads += 1;
        return "should-not-exist.jpg";
      },
      async downloadVideoClip() {
        downloads += 1;
        return "should-not-exist.webm";
      },
      async recordProvenance() {},
      disableFallbackBroll: true,
    },
  );

  assert.equal(lookups, 0);
  assert.equal(downloads, 0);
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.videoClips, []);
});

test("story persistence keeps exact Steam provenance while retaining renderer-compatible clip paths", () => {
  const identity = {
    entity: "SILENT HILL: Townfall",
    source: "steam",
    store_app_id: "1636440",
    store_app_title: "SILENT HILL: Townfall",
    store_matched_query: "Silent Hill: Townfall",
    store_match_verified: true,
    rights_status: "UNREVIEWED",
    rights_risk_class:
      "official_steam_storefront_editorial_use_review_required",
  };
  const projected = normaliseAcquiredMediaForStory({
    existingGameImages: [],
    images: [
      {
        ...identity,
        path: "output/image_cache/townfall-header.jpg",
        url:
          "https://cdn.akamai.steamstatic.com/steam/apps/1636440/header.jpg",
        type: "key_art",
        source_type: "steam_header",
      },
    ],
    videoClips: [
      {
        ...identity,
        path: "output/video_cache/townfall.webm",
        url:
          "https://cdn.akamai.steamstatic.com/steam/apps/1636440/townfall.webm",
        type: "trailer",
        source_type: "steam_trailer",
        is_video: true,
      },
    ],
  });

  assert.deepEqual(projected.video_clips, [
    "output/video_cache/townfall.webm",
  ]);
  assert.equal(
    projected.downloaded_images[0].store_app_id,
    "1636440",
  );
  assert.equal(
    projected.downloaded_images[0].store_match_verified,
    true,
  );
  assert.equal(projected.game_images.length, 1);
  assert.equal(projected.game_images[0].source_type, "steam_trailer");
  assert.equal(projected.game_images[0].store_app_id, "1636440");
  assert.equal(projected.game_images[0].is_video, true);
});

test("story persistence replaces stale clip paths and stale structured videos when fresh clips exist", () => {
  const projected = normaliseAcquiredMediaForStory({
    existingGameImages: [
      {
        path: "output/video_cache/silent-hill-2.webm",
        url:
          "https://cdn.akamai.steamstatic.com/steam/apps/2124490/sh2.webm",
        type: "trailer",
        source: "steam",
        is_video: true,
        store_app_id: "2124490",
        store_app_title: "SILENT HILL 2",
      },
    ],
    existingVideoClips: [
      "output/video_cache/silent-hill-2.webm",
    ],
    videoClips: [
      {
        path: "output/video_cache/townfall.webm",
        url:
          "https://cdn.akamai.steamstatic.com/steam/apps/1636440/townfall.webm",
        type: "trailer",
        source: "steam",
        source_type: "steam_trailer",
        is_video: true,
        store_app_id: "1636440",
        store_app_title: "SILENT HILL: Townfall",
        store_match_verified: true,
      },
    ],
  });

  assert.deepEqual(projected.video_clips, [
    "output/video_cache/townfall.webm",
  ]);
  assert.equal(
    projected.game_images.some(
      (asset) => asset.store_app_id === "2124490",
    ),
    false,
  );
  assert.equal(projected.game_images.length, 1);
  assert.equal(projected.game_images[0].store_app_id, "1636440");
});

test("exact still-only repair removes an unbound stale renderer clip", () => {
  const projected = normaliseAcquiredMediaForStory({
    existingGameImages: [
      {
        path: "output/video_cache/silent-hill-2.webm",
        url:
          "https://cdn.akamai.steamstatic.com/steam/apps/2124490/sh2.webm",
        type: "trailer",
        source: "steam",
        source_type: "steam_trailer",
        is_video: true,
        store_app_id: "2124490",
        store_app_title: "SILENT HILL 2",
        store_match_verified: true,
      },
    ],
    existingVideoClips: [
      "output/video_cache/silent-hill-2.webm",
    ],
    images: [
      {
        path: "output/image_cache/townfall-header.jpg",
        type: "key_art",
        source: "steam",
        source_type: "steam_header",
        store_app_id: "1636440",
        store_app_title: "SILENT HILL: Townfall",
        store_match_verified: true,
      },
    ],
    videoClips: [],
  });

  assert.deepEqual(projected.video_clips, []);
  assert.equal(
    projected.game_images.some((asset) => asset.is_video),
    false,
  );
});

test("exact still-only repair retains a matching existing verified clip", () => {
  const exactClip = {
    path: "output/video_cache/townfall.webm",
    url:
      "https://cdn.akamai.steamstatic.com/steam/apps/1636440/townfall.webm",
    type: "trailer",
    source: "steam",
    source_type: "steam_trailer",
    is_video: true,
    store_app_id: "1636440",
    store_app_title: "SILENT HILL: Townfall",
    store_match_verified: true,
  };
  const projected = normaliseAcquiredMediaForStory({
    existingGameImages: [exactClip],
    existingVideoClips: [exactClip.path],
    images: [
      {
        path: "output/image_cache/townfall-header.jpg",
        type: "key_art",
        source: "steam",
        source_type: "steam_header",
        store_app_id: "1636440",
        store_app_title: "SILENT HILL: Townfall",
        store_match_verified: true,
      },
    ],
    videoClips: [],
  });

  assert.deepEqual(projected.video_clips, [exactClip.path]);
  assert.equal(projected.game_images.length, 1);
  assert.equal(projected.game_images[0].store_app_id, "1636440");
});

test("non-exact rerun preserves existing renderer clips for compatibility", () => {
  const projected = normaliseAcquiredMediaForStory({
    existingGameImages: [],
    existingVideoClips: ["output/video_cache/context.webm"],
    images: [
      {
        path: "output/image_cache/article.jpg",
        type: "article_hero",
        source: "article",
      },
    ],
    videoClips: [],
  });

  assert.deepEqual(projected.video_clips, [
    "output/video_cache/context.webm",
  ]);
});

test("video downloads are recorded in provenance with non-image prescan disabled", async () => {
  const provenance = [];
  await getBestImage(
    {
      id: "townfall-provenance",
      title: "Silent Hill: Townfall hands-on report",
      game_images: [],
    },
    {
      async steamSearch() {
        return [
          { id: 1636440, name: "SILENT HILL: Townfall" },
        ];
      },
      async steamLookup() {
        return {
          name: "SILENT HILL: Townfall",
          movies: [
            {
              name: "Official Trailer",
              webm: {
                max:
                  "https://cdn.akamai.steamstatic.com/steam/apps/1636440/townfall.webm",
              },
            },
          ],
        };
      },
      async downloadImage(_url, filename) {
        return `output/image_cache/${filename}`;
      },
      async downloadVideoClip(_url, filename) {
        return `output/video_cache/${filename}`;
      },
      async recordProvenance(record) {
        provenance.push(record);
      },
      disableFallbackBroll: true,
    },
  );

  const videoRecord = provenance.find(
    (record) => record.source_type === "steam_trailer",
  );
  assert.ok(videoRecord);
  assert.equal(videoRecord.skipPrescan, true);
  assert.equal(videoRecord.raw_meta.store_app_id, "1636440");
  assert.equal(videoRecord.raw_meta.rights_status, "UNREVIEWED");
});
