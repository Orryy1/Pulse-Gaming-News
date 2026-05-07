"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOfficialTrailerReferencePlan,
  buildOfficialTrailerReferenceReport,
  renderOfficialTrailerReferenceMarkdown,
} = require("../../lib/official-trailer-reference-resolver");

function baseStory(overrides = {}) {
  return {
    id: "trailer-ref-story",
    title: "GTA 6 owner passed on a sequel to a legacy franchise",
    source_type: "rss",
    subreddit: "IGN",
    flair: "Verified",
    score: 500,
    timestamp: "2026-05-01T10:00:00Z",
    full_script: "GTA has a new official trailer and fans are watching every frame.",
    game_images: [],
    downloaded_images: [],
    igdb_assets: [],
    ...overrides,
  };
}

function verifiedSteamAsset(entity, appId, title) {
  return {
    type: "steam_header",
    source: "steam",
    entity,
    store_asset_source: "steam",
    store_app_id: appId,
    store_app_title: title,
    store_matched_query: entity,
    store_match_status: "verified",
    store_match_verified: true,
  };
}

function appliedLocalSteamAsset(entity, appId, title) {
  return {
    source_url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
    source_type: "steam_hero",
    entity,
    local_path: `C:\\fake\\${entity}.jpg`,
    store_app_id: appId,
    store_app_title: title,
    store_matched_query: title,
    store_match_status: "verified",
    store_match_verified: true,
  };
}

test("official trailer resolver stays report-only and non-downloading", async () => {
  const plan = await buildOfficialTrailerReferencePlan(baseStory());

  assert.equal(plan.execution_mode, "report_only");
  assert.equal(plan.will_download, false);
  assert.equal(plan.will_mutate_story, false);
  assert.equal(plan.safety.video_downloads, false);
  assert.equal(plan.safety.production_db_mutated, false);
});

test("official trailer resolver extracts Steam movie references from verified app metadata", async () => {
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      game_images: [verifiedSteamAsset("GTA", "3240220", "Grand Theft Auto V Enhanced")],
    }),
    {
      steamLookup: async (appId) => ({
        appId,
        success: true,
        title: "Grand Theft Auto V Enhanced",
        movies: [
          {
            id: 1,
            name: "Official Trailer",
            thumbnail: "https://cdn.example/thumb.jpg",
            mp4: { max: "https://cdn.example/trailer_max.mp4" },
            webm: { max: "https://cdn.example/trailer_max.webm" },
          },
        ],
      }),
    },
  );

  assert.equal(plan.motion_reference_readiness, "official_reference_found");
  assert.equal(plan.verified_store_targets.length, 1);
  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].source_type, "steam_movie");
  assert.equal(plan.references[0].store_app_id, "3240220");
  assert.equal(plan.references[0].source_url, "https://cdn.example/trailer_max.mp4");
  assert.equal(plan.references[0].downloads_allowed, false);
  assert.equal(plan.references[0].rights_risk_class, "storefront_promotional_video");
});

test("official trailer resolver marks multi-franchise coverage as partial until every target has a reference", async () => {
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      full_script:
        "Take-Two passed on a sequel and fans are comparing GTA, Red Dead and BioShock.",
      game_images: [verifiedSteamAsset("GTA", "3240220", "Grand Theft Auto V Enhanced")],
    }),
    {
      steamLookup: async () => ({
        success: true,
        title: "Grand Theft Auto V Enhanced",
        movies: [
          {
            id: 1,
            name: "Official Trailer",
            mp4: { max: "https://cdn.example/gta.mp4" },
          },
        ],
      }),
    },
  );

  assert.equal(plan.motion_reference_readiness, "partial_official_reference_found");
  assert.deepEqual(plan.target_entities, ["GTA", "BioShock", "Red Dead"]);
  assert.deepEqual(plan.covered_target_entities, ["GTA"]);
  assert.deepEqual(plan.missing_target_entities, ["BioShock", "Red Dead"]);
  assert.ok(plan.blockers.includes("missing_official_reference_entities"));
  assert.ok(plan.planned_searches.some((item) => item.entity === "BioShock"));
  assert.ok(plan.search_queries.includes("BioShock official trailer"));
  assert.ok(plan.search_queries.includes("Red Dead gameplay trailer"));
});

test("official trailer resolver recognises v1.5 applied-local Steam still assets", async () => {
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      _verified_store_assets: [
        appliedLocalSteamAsset("BioShock", "8870", "BioShock Infinite"),
      ],
    }),
    {
      steamLookup: async (appId) => ({
        appId,
        success: true,
        title: "BioShock Infinite",
        movies: [
          {
            id: 2,
            name: "Launch Trailer",
            mp4: { max: "https://cdn.example/bioshock.mp4" },
          },
        ],
      }),
    },
  );

  assert.equal(plan.verified_store_targets.length, 1);
  assert.equal(plan.verified_store_targets[0].store_app_id, "8870");
  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].entity, "BioShock");
});

test("official trailer resolver records Steam HLS/DASH movie references as reference-only", async () => {
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      _verified_store_assets: [
        appliedLocalSteamAsset("Red Dead", "1174180", "Red Dead Redemption 2"),
      ],
    }),
    {
      steamLookup: async () => ({
        success: true,
        title: "Red Dead Redemption 2",
        movies: [
          {
            id: 3,
            name: "Launch Trailer",
            thumbnail: "https://cdn.example/thumb.jpg",
            hls_h264: "https://video.example/hls_264_master.m3u8",
            dash_h264: "https://video.example/dash_h264.mpd",
          },
        ],
      }),
    },
  );

  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].source_url, "https://video.example/hls_264_master.m3u8");
  assert.equal(plan.references[0].downloads_allowed, false);
  assert.equal(plan.references[0].allowed_render_use, "reference_only_by_default");
});

test("official trailer resolver excludes Steam movie references that are rating-board material", async () => {
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      game_images: [verifiedSteamAsset("GTA", "3240220", "Grand Theft Auto V Enhanced")],
    }),
    {
      steamLookup: async () => ({
        success: true,
        title: "Grand Theft Auto V Enhanced",
        movies: [
          {
            id: 11,
            name: "A Safehouse in the Hills - PEGI",
            hls_h264: "https://video.example/gta-pegi.m3u8",
          },
          {
            id: 12,
            name: "Agents of Sabotage",
            hls_h264: "https://video.example/gta-gameplay.m3u8",
          },
        ],
      }),
    },
  );

  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].movie_name, "Agents of Sabotage");
  assert.equal(plan.references[0].source_url, "https://video.example/gta-gameplay.m3u8");
  assert.equal(plan.lookup_results[0].movies_found, 1);
  assert.equal(plan.lookup_results[0].movies_rejected, 1);
  assert.equal(plan.lookup_results[0].rejected_movie_reasons[0].reason, "rating_board_reference");
});

test("official trailer resolver refuses unverified Steam assets", async () => {
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      game_images: [
        {
          type: "steam_header",
          source: "steam",
          entity: "GTA",
          store_app_id: "3240220",
          store_app_title: "Grand Theft Auto V Enhanced",
          store_match_verified: false,
        },
      ],
    }),
    {
      steamLookup: async () => {
        throw new Error("lookup should not be called");
      },
    },
  );

  assert.equal(plan.verified_store_targets.length, 0);
  assert.equal(plan.references.length, 0);
  assert.equal(plan.motion_reference_readiness, "official_search_required");
});

test("official trailer resolver maps IGDB video ids as reference-only", async () => {
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      igdb_assets: [
        {
          type: "igdb_video",
          source: "igdb",
          entity: "BioShock",
          video_id: "abc123",
          name: "BioShock Trailer",
          subject_match_quality: "exact_game_match",
          store_match_verified: true,
        },
      ],
    }),
  );

  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].source_type, "igdb_video");
  assert.equal(plan.references[0].source_url, "https://www.youtube.com/watch?v=abc123");
  assert.equal(plan.references[0].allowed_render_use, "reference_only_by_default");
});

test("official trailer resolver report emits valid JSON and readable Markdown", async () => {
  const report = await buildOfficialTrailerReferenceReport(
    [
      baseStory({
        id: "with-steam",
        game_images: [verifiedSteamAsset("GTA", "3240220", "Grand Theft Auto V Enhanced")],
      }),
      baseStory({ id: "needs-search" }),
    ],
    {
      steamLookup: async () => ({
        success: true,
        title: "Grand Theft Auto V Enhanced",
        movies: [
          {
            id: 1,
            name: "Official Trailer",
            mp4: { max: "https://cdn.example/trailer.mp4" },
          },
        ],
      }),
    },
  );
  const markdown = renderOfficialTrailerReferenceMarkdown(report);

  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
  assert.equal(report.summary.stories, 2);
  assert.equal(report.summary.official_reference_found, 1);
  assert.equal(report.summary.partial_official_reference_found, 0);
  assert.equal(report.summary.official_search_required, 1);
  assert.match(markdown, /Official Trailer Reference Resolver/);
  assert.match(markdown, /with-steam/);
  assert.match(markdown, /needs-search/);
});
