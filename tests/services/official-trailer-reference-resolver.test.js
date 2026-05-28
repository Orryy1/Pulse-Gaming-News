"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOfficialTrailerReferencePlan,
  buildOfficialTrailerReferenceReport,
  renderOfficialTrailerReferenceMarkdown,
} = require("../../lib/official-trailer-reference-resolver");
const {
  writeOfficialTrailerReferenceReportFiles,
} = require("../../lib/official-trailer-reference-report-files");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const {
  loadStories,
  parseArgs: parseOfficialTrailerReferenceCliArgs,
  shouldWriteLatestReport,
} = require("../../tools/official-trailer-reference-resolver");
const {
  buildStillsAssetMapFromReports,
} = require("../../lib/official-trailer-reference-report-loader");
const {
  buildTrustedFootageRegistryReport,
} = require("../../lib/trusted-footage-registry");

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

test("official trailer resolver CLI keeps one-story runs from overwriting the latest report by default", () => {
  const oneStoryArgs = parseOfficialTrailerReferenceCliArgs([
    "node",
    "tools/official-trailer-reference-resolver.js",
    "--story-id",
    "rss_gap",
  ]);
  const batchArgs = parseOfficialTrailerReferenceCliArgs([
    "node",
    "tools/official-trailer-reference-resolver.js",
    "--limit",
    "5",
  ]);
  const explicitOneStoryArgs = parseOfficialTrailerReferenceCliArgs([
    "node",
    "tools/official-trailer-reference-resolver.js",
    "--story-id",
    "rss_gap",
    "--write-latest-report",
  ]);
  const intakeArgs = parseOfficialTrailerReferenceCliArgs([
    "node",
    "tools/official-trailer-reference-resolver.js",
    "--official-source-intake-report",
    "test/output/official_source_intake_report.json",
  ]);
  const trustedRegistryArgs = parseOfficialTrailerReferenceCliArgs([
    "node",
    "tools/official-trailer-reference-resolver.js",
    "--trusted-footage-registry-report",
    "test/output/trusted_footage_registry_report.json",
  ]);

  assert.equal(shouldWriteLatestReport(oneStoryArgs), false);
  assert.equal(shouldWriteLatestReport(batchArgs), true);
  assert.equal(shouldWriteLatestReport(explicitOneStoryArgs), true);
  assert.equal(intakeArgs.officialSourceIntakeReport, "test/output/official_source_intake_report.json");
  assert.equal(
    trustedRegistryArgs.trustedFootageRegistryReport,
    "test/output/trusted_footage_registry_report.json",
  );
});

test("official trailer resolver story-json mode accepts governed story_id manifests", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-trailer-story-json-"));
  const storyPath = path.join(dir, "canonical_story_manifest.json");
  await fs.writeJson(storyPath, {
    story_id: "story-from-manifest",
    canonical_subject: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    game_images: [],
    downloaded_images: [],
  });
  await fs.writeJson(path.join(dir, "rights_ledger.json"), {
    verdict: "pass",
    assets: [
      {
        asset_id: "steam-header",
        source: "steam",
        source_type: "steam_header",
        source_url: "https://cdn.akamai.steamstatic.com/steam/apps/3727390/header.jpg",
        licence_basis: "source_documented_transformative_editorial_use",
        approval_status: "approved",
      },
    ],
  });

  const result = await loadStories({
    storyJsonPath: storyPath,
    storyId: "story-from-manifest",
  });

  assert.equal(result.mode, "story_json");
  assert.equal(result.stories.length, 1);
  assert.equal(result.stories[0].id, "story-from-manifest");
  assert.equal(result.stories[0].title, "The Expanse Shows Real Gameplay");
  assert.equal(result.stories[0].game_title, "The Expanse: Osiris Reborn");
  assert.equal(result.stories[0].rights_ledger.length, 1);
});

test("official trailer resolver CLI reads current asset acquisition reports first", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "official-trailer-reference-resolver.js"),
    "utf8",
  );

  assert.match(src, /asset_acquisition_pro\.json/);
  assert.match(src, /asset_acquisition_v16_gameplay_stills_apply_local\.json/);
});

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
  assert.equal(plan.references[0].source_url_kind, "direct_video");
  assert.equal(plan.references[0].segment_validation_eligible, true);
  assert.equal(plan.segment_validation_reference_counts.eligible, 1);
  assert.equal(plan.segment_validation_reference_counts.ineligible, 0);
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

test("official trailer resolver ignores score-table comparison games as source targets", async () => {
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
      hook: "Forza Horizon 6 just hit 92 on Metacritic, beating out Pok\u00e9mon Pokopia.",
      body:
        "The racing title is currently ahead of Pok\u00e9mon Pokopia and Resident Evil Requiem in overall ratings.",
      full_script:
        "Forza Horizon 6 just hit 92 on Metacritic, beating out Pok\u00e9mon Pokopia. The racing title is currently ahead of Pok\u00e9mon Pokopia.",
      game_images: [verifiedSteamAsset("Forza Horizon 6", "2483190", "Forza Horizon 6")],
    }),
    {
      steamLookup: async () => ({
        success: true,
        title: "Forza Horizon 6",
        movies: [
          {
            id: 1133501958,
            name: "Launch Trailer",
            hls_h264: "https://video.akamai.steamstatic.com/store_trailers/2483190/1133501958/hash/hls_264_master.m3u8",
          },
        ],
      }),
    },
  );

  assert.deepEqual(plan.target_entities, ["Forza Horizon 6"]);
  assert.deepEqual(plan.missing_target_entities, []);
  assert.ok(!plan.search_queries.includes("Pok\u00e9mon official trailer"));
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

test("official trailer resolver derives Steam motion targets from exact-subject storefront URLs", async () => {
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      title:
        "Forza Horizon 6 immediately beats its predecessor's all-time Steam record",
      full_script:
        "Forza Horizon 6 has a verified Steam record and exact-subject Steam storefront art.",
      _verified_store_assets: [
        {
          source_url:
            "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2483190/abc/ss_forza.1920x1080.jpg",
          source_type: "steam_screenshot",
          entity: "steam",
          subject_match_quality: "exact_game_match",
          exact_subject_group: "Forza Horizon 6",
          counted_for_premium: true,
        },
      ],
    }),
    {
      steamLookup: async (appId) => ({
        appId,
        success: true,
        title: "Forza Horizon 6",
        movies: [
          {
            id: 257270546,
            name: "Forza Horizon 6 Launch Trailer",
            hls_h264:
              "https://video.akamai.steamstatic.com/store_trailers/2483190/1133501958/abc/hls_264_master.m3u8",
          },
        ],
      }),
    },
  );

  assert.equal(plan.motion_reference_readiness, "official_reference_found");
  assert.equal(plan.verified_store_targets.length, 1);
  assert.equal(plan.verified_store_targets[0].store_app_id, "2483190");
  assert.equal(plan.verified_store_targets[0].entity, "Forza Horizon 6");
  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].movie_name, "Forza Horizon 6 Launch Trailer");
  assert.equal(plan.references[0].segment_validation_eligible, true);
});

test("official trailer resolver derives Steam motion targets from repaired rights-ledger evidence", async () => {
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      id: "expanse-v4",
      title: "The Expanse Shows Real Gameplay",
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      full_script:
        "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed it during Xbox Partner Preview.",
      rights_ledger: [
        {
          asset_id: "expanse_screenshot_1",
          asset_type: "screenshot_derived_motion_clip",
          source_type: "screenshot",
          source_url:
            "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3727390/abc/ss_expanse.1920x1080.jpg",
          licence_basis: "source_documented_transformative_editorial_use",
          approval_status: "approved_for_transformative_editorial_use",
        },
      ],
    }),
    {
      steamLookup: async (appId) => ({
        appId,
        success: true,
        title: "The Expanse: Osiris Reborn",
        movies: [
          {
            id: 44,
            name: "Gameplay Trailer",
            mp4: { max: "https://cdn.example/expanse-gameplay.mp4" },
          },
        ],
      }),
    },
  );

  assert.equal(plan.motion_reference_readiness, "official_reference_found");
  assert.equal(plan.verified_store_targets.length, 1);
  assert.equal(plan.verified_store_targets[0].store_app_id, "3727390");
  assert.equal(plan.verified_store_targets[0].entity, "The Expanse: Osiris Reborn");
  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].source_url, "https://cdn.example/expanse-gameplay.mp4");
  assert.equal(plan.references[0].source_url_kind, "direct_video");
});

test("official trailer resolver treats governed Steam CDN rights rows as storefront reference targets", async () => {
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      id: "expanse-v4-minimal-rights",
      title: "The Expanse Shows Real Gameplay",
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      full_script: "The Expanse: Osiris Reborn finally showed real gameplay.",
      rights_ledger: [
        {
          asset_id: "steam-header",
          source: "steam",
          source_type: "key_art",
          source_url: "https://cdn.akamai.steamstatic.com/steam/apps/3727390/header.jpg",
        },
      ],
    }),
    {
      steamLookup: async (appId) => ({
        appId,
        success: true,
        title: "The Expanse: Osiris Reborn",
        movies: [
          {
            id: 44,
            name: "Gameplay Trailer",
            mp4: { max: "https://cdn.example/expanse-gameplay.mp4" },
          },
        ],
      }),
    },
  );

  assert.equal(plan.motion_reference_readiness, "official_reference_found");
  assert.equal(plan.verified_store_targets[0].store_app_id, "3727390");
  assert.equal(plan.references[0].allowed_render_use, "reference_only_by_default");
});

test("official trailer resolver loader includes visual deck exact-subject assets", () => {
  const { map } = buildStillsAssetMapFromReports([
    {
      filePath: "test/output/asset_acquisition_pro.json",
      report: {
        plans: [
          {
            story_id: "1te1oq7",
            visual_deck: {
              items: [
                {
                  source_url:
                    "https://cdn.akamai.steamstatic.com/steam/apps/2483190/header.jpg",
                  source_type: "steam_hero",
                  entity: "steam",
                  subject_match_quality: "exact_game_match",
                  exact_subject_group: "Forza Horizon 6",
                },
              ],
            },
          },
        ],
      },
    },
  ]);

  assert.equal(map.get("1te1oq7").length, 1);
  assert.equal(map.get("1te1oq7")[0].exact_subject_group, "Forza Horizon 6");
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
  assert.equal(plan.references[0].source_url_kind, "hls_manifest");
  assert.equal(plan.references[0].segment_validation_eligible, true);
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

test("official trailer resolver excludes Steam movie references that are logo/title-only material", async () => {
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
            id: 21,
            name: "Rockstar Games Logo Sequence",
            hls_h264: "https://video.example/gta-logo.m3u8",
          },
          {
            id: 22,
            name: "Gameplay Deep Dive",
            hls_h264: "https://video.example/gta-gameplay-deep-dive.m3u8",
          },
        ],
      }),
    },
  );

  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].movie_name, "Gameplay Deep Dive");
  assert.equal(plan.lookup_results[0].movies_found, 1);
  assert.equal(plan.lookup_results[0].movies_rejected, 1);
  assert.equal(
    plan.lookup_results[0].rejected_movie_reasons[0].reason,
    "logo_or_title_only_reference",
  );
});

test("official trailer resolver excludes localised and subtitle-labelled Steam movie references", async () => {
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
            id: 31,
            name: "RDR2 60 FPS Trailer (DE)",
            hls_h264: "https://video.example/reddead-de.m3u8",
          },
          {
            id: 32,
            name: "Launch Trailer Subtitles",
            hls_h264: "https://video.example/reddead-subtitles.m3u8",
          },
          {
            id: 33,
            name: "Gameplay Trailer",
            hls_h264: "https://video.example/reddead-gameplay.m3u8",
          },
        ],
      }),
    },
  );

  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].movie_name, "Gameplay Trailer");
  assert.equal(plan.lookup_results[0].movies_found, 1);
  assert.equal(plan.lookup_results[0].movies_rejected, 2);
  assert.deepEqual(
    plan.lookup_results[0].rejected_movie_reasons.map((item) => item.reason),
    ["localised_non_english_reference", "embedded_subtitle_reference"],
  );
});

test("official trailer resolver excludes exhausted Steam source families from previous local validation", async () => {
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/3240220/832632/4b8d5f06cf0a1/hls_264_master.m3u8";
  const segmentValidationReport = {
    segments: Array.from({ length: 8 }, (_, index) => ({
      story_id: "trailer-ref-story",
      entity: "GTA",
      source_url: sourceUrl,
      source_type: "steam_movie",
      media_start_s: 36 + index * 6,
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      validation_reason: "segment_samples_too_repetitive",
    })),
  };

  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      game_images: [verifiedSteamAsset("GTA", "3240220", "Grand Theft Auto V Enhanced")],
    }),
    {
      segmentValidationReport,
      steamLookup: async () => ({
        success: true,
        title: "Grand Theft Auto V Enhanced",
        movies: [
          {
            id: 257100577,
            name: "Official Trailer",
            hls_h264: sourceUrl,
          },
        ],
      }),
    },
  );

  assert.equal(plan.motion_reference_readiness, "alternate_official_reference_required");
  assert.equal(plan.resolved_reference_count, 1);
  assert.equal(plan.references.length, 0);
  assert.equal(plan.excluded_references.length, 1);
  assert.equal(plan.excluded_references[0].movie_id, "832632");
  assert.equal(plan.exhausted_source_family_filter.enabled, true);
  assert.equal(plan.exhausted_source_family_filter.excluded_references, 1);
  assert.deepEqual(plan.missing_target_entities, ["GTA"]);
  assert.ok(plan.blockers.includes("resolved_references_exhausted"));
  assert.ok(plan.warnings.includes("some_resolved_references_were_exhausted_locally"));
  assert.ok(plan.search_queries.includes("GTA official trailer"));
});

test("official trailer resolver names exhausted missing entities inside partial reference plans", async () => {
  const redDeadSourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1174180/900001/reddead/hls_264_master.m3u8";
  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      full_script:
        "Take-Two fans are comparing GTA, Red Dead and BioShock after the publisher passed on a legacy sequel.",
      game_images: [
        verifiedSteamAsset("GTA", "3240220", "Grand Theft Auto V Enhanced"),
        verifiedSteamAsset("Red Dead", "1174180", "Red Dead Redemption 2"),
      ],
    }),
    {
      segmentValidationReport: {
        segments: Array.from({ length: 8 }, (_, index) => ({
          story_id: "trailer-ref-story",
          entity: "Red Dead",
          source_url: redDeadSourceUrl,
          source_type: "steam_movie",
          media_start_s: 36 + index * 6,
          status: "rejected",
          segment_validated: false,
          allowed_for_flash_lane: false,
          validation_reason: "segment_contains_black_frame",
        })),
      },
      steamLookup: async (appId) => ({
        appId,
        success: true,
        title: appId === "3240220" ? "Grand Theft Auto V Enhanced" : "Red Dead Redemption 2",
        movies:
          appId === "3240220"
            ? [
                {
                  id: 1,
                  name: "GTA gameplay",
                  hls_h264: "https://video.example/gta-gameplay.m3u8",
                },
              ]
            : [
                {
                  id: 900001,
                  name: "Red Dead launch trailer",
                  hls_h264: redDeadSourceUrl,
                },
              ],
      }),
      exhaustedSourceFamilyThreshold: 5,
    },
  );

  assert.equal(plan.motion_reference_readiness, "partial_official_reference_found");
  assert.deepEqual(plan.covered_target_entities, ["GTA"]);
  assert.ok(plan.missing_target_entities.includes("Red Dead"));
  assert.deepEqual(plan.alternate_reference_required_entities, ["Red Dead"]);
  assert.ok(plan.blockers.includes("alternate_official_reference_required"));
  assert.ok(plan.warnings.includes("alternate_source_needed_for_missing_entities"));
  assert.ok(plan.planned_searches.some((item) => item.entity === "Red Dead"));
});

test("official trailer resolver keeps missing-entity searches free of story-title fragments", async () => {
  const report = await buildOfficialTrailerReferenceReport(
    [
      baseStory({
        id: "title-fragment-story",
        title: "GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One",
        full_script: "Take-Two discussed GTA, BioShock and Red Dead in a legacy franchise story.",
        _verified_store_assets: [
          verifiedSteamAsset("BioShock", "8870", "BioShock Infinite"),
          verifiedSteamAsset("Red Dead", "1174180", "Red Dead Redemption 2"),
        ],
      }),
    ],
    {
      steamLookup: async (appId) => ({
        success: true,
        title: appId === "8870" ? "BioShock Infinite" : "Red Dead Redemption 2",
        movies: [
          {
            id: appId === "8870" ? 11 : 22,
            name: "Official Trailer",
            mp4: { max: `https://cdn.example/${appId}/trailer.mp4` },
          },
        ],
      }),
    },
  );

  const plan = report.plans[0];
  assert.deepEqual(plan.missing_target_entities, ["GTA"]);
  assert.ok(plan.search_queries.includes("GTA official trailer"));
  assert.ok(plan.search_queries.includes("GTA gameplay trailer"));
  assert.equal(
    plan.search_queries.some((query) => /GTA 6 Owner Passed On A Sequel/i.test(query)),
    false,
  );
  assert.equal(
    plan.planned_searches.every((item) => item.entity === "GTA"),
    true,
  );
});

test("official trailer resolver keeps exhausted families when exclusion is explicitly disabled", async () => {
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/3240220/832632/4b8d5f06cf0a1/hls_264_master.m3u8";
  const segmentValidationReport = {
    segments: Array.from({ length: 8 }, (_, index) => ({
      story_id: "trailer-ref-story",
      entity: "GTA",
      source_url: sourceUrl,
      source_type: "steam_movie",
      media_start_s: 36 + index * 6,
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      validation_reason: "segment_samples_too_repetitive",
    })),
  };

  const plan = await buildOfficialTrailerReferencePlan(
    baseStory({
      game_images: [verifiedSteamAsset("GTA", "3240220", "Grand Theft Auto V Enhanced")],
    }),
    {
      excludeExhaustedSourceFamilies: false,
      segmentValidationReport,
      steamLookup: async () => ({
        success: true,
        title: "Grand Theft Auto V Enhanced",
        movies: [
          {
            id: 257100577,
            name: "Official Trailer",
            hls_h264: sourceUrl,
          },
        ],
      }),
    },
  );

  assert.equal(plan.motion_reference_readiness, "official_reference_found");
  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].movie_id, "832632");
  assert.equal(plan.references[0].steam_movie_id, 257100577);
  assert.equal(plan.excluded_references.length, 0);
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.exhausted_source_family_filter.enabled, false);
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
  assert.equal(plan.references[0].source_url_kind, "youtube_watch");
  assert.equal(plan.references[0].segment_validation_eligible, false);
  assert.equal(plan.references[0].segment_validation_ineligible_reason, "segment_source_is_youtube_reference");
  assert.equal(plan.segment_validation_reference_counts.eligible, 0);
  assert.equal(plan.segment_validation_reference_counts.ineligible, 1);
});

test("official trailer resolver separates source proof from direct-motion eligibility", async () => {
  const story = baseStory({
    id: "reference-only-official",
    title: "Super Mario RPG Drops To $15",
    full_script: "Super Mario RPG just dropped to fifteen dollars on Nintendo Switch.",
  });

  const plan = await buildOfficialTrailerReferencePlan(story, {
    officialSourceIntakeReport: {
      accepted_references: [
        {
          story_id: "reference-only-official",
          source_url: "https://www.nintendo.com/us/store/products/super-mario-rpg-switch/",
          source_type: "platform_storefront",
          entity: "Super Mario RPG",
          source_verified: true,
          allowed_render_use: "reference_only_by_default",
        },
      ],
    },
  });

  assert.deepEqual(plan.target_entities, ["Super Mario RPG"]);
  assert.deepEqual(plan.source_proof_covered_target_entities, ["Super Mario RPG"]);
  assert.deepEqual(plan.source_proof_missing_target_entities, []);
  assert.deepEqual(plan.covered_target_entities, []);
  assert.deepEqual(plan.missing_target_entities, ["Super Mario RPG"]);
  assert.equal(plan.motion_reference_readiness, "official_search_required");
  assert.ok(plan.blockers.includes("no_segment_validation_eligible_reference_resolved"));
  assert.ok(!plan.blockers.includes("missing_official_reference_entities"));
  assert.ok(plan.warnings.includes("some_references_are_provenance_only_not_direct_media"));
});

test("official trailer resolver keeps Xbox Controller as the visual target for hardware stories", async () => {
  const story = baseStory({
    id: "xbox-controller-reference-only",
    title: "Xbox Controller Deal Has One Catch",
    canonical_subject: "Xbox Controller",
    canonical_game: "Xbox Controller",
    full_script:
      "Xbox controller deals are getting aggressive, but the catch is the retailer. Follow Pulse Gaming so you never miss a beat.",
  });

  const plan = await buildOfficialTrailerReferencePlan(story, {
    officialSourceIntakeReport: {
      accepted_references: [
        {
          story_id: "xbox-controller-reference-only",
          source_url:
            "https://www.xbox.com/en-US/accessories/forza-horizon-6-xbox-wireless-controller-and-wireless-headset",
          source_type: "official_platform_product_page",
          entity: "Xbox Controller",
          source_verified: true,
          allowed_render_use: "reference_only_by_default",
        },
      ],
    },
  });

  assert.deepEqual(plan.target_entities, ["Xbox Controller"]);
  assert.deepEqual(plan.source_proof_covered_target_entities, ["Xbox Controller"]);
  assert.deepEqual(plan.missing_target_entities, ["Xbox Controller"]);
  assert.ok(plan.search_queries.includes("Xbox Controller official trailer"));
});

test("official trailer resolver does not drop Star Wars targets after a miss-a-beat CTA", async () => {
  const story = baseStory({
    id: "galactic-racer-reference-only",
    title: "Star Wars Racer Date Leaked Early",
    canonical_subject: "Star Wars: Galactic Racer",
    canonical_game: "Star Wars: Galactic Racer",
    full_script:
      "Star Wars: Galactic Racer may have leaked the part players actually needed: a date. Follow Pulse Gaming so you never miss a beat.",
    description: "Star Wars: Galactic Racer release details came from an official source page.",
  });

  const plan = await buildOfficialTrailerReferencePlan(story, {
    officialSourceIntakeReport: {
      accepted_references: [
        {
          story_id: "galactic-racer-reference-only",
          source_url: "https://www.starwars.com/games-apps/star-wars-galactic-racer",
          source_type: "official_game_website_media_page",
          entity: "Star Wars: Galactic Racer",
          source_verified: true,
          allowed_render_use: "reference_only_by_default",
        },
      ],
    },
  });

  assert.deepEqual(plan.target_entities, ["Star Wars: Galactic Racer"]);
  assert.deepEqual(plan.source_proof_covered_target_entities, ["Star Wars: Galactic Racer"]);
  assert.deepEqual(plan.missing_target_entities, ["Star Wars: Galactic Racer"]);
  assert.ok(plan.search_queries.includes("Star Wars: Galactic Racer official trailer"));
});

test("official trailer resolver consumes trusted footage registry references without enabling downloads", async () => {
  const story = baseStory({
    id: "registry-forza",
    title: "Forza Horizon 6 just hit 130,000 players on Steam",
    full_script:
      "Forza Horizon 6 is pulling a huge Steam number and Xbox fans are watching the official channel.",
  });
  const trustedFootageRegistryReport = buildTrustedFootageRegistryReport({
    stories: [story],
    entries: [
      {
        source_id: "xbox-official-youtube",
        display_name: "Xbox official YouTube",
        owner_type: "platform",
        platform: "youtube",
        channel_url: "https://www.youtube.com/@Xbox",
        source_family: "xbox_official_youtube",
        entities: ["Forza Horizon 6"],
        allowed_uses: ["reference_only"],
        official_evidence: "Official Xbox channel operated by the platform owner.",
      },
    ],
    generatedAt: "2026-05-17T12:00:00.000Z",
  });

  const plan = await buildOfficialTrailerReferencePlan(story, {
    trustedFootageRegistryReport,
  });

  assert.equal(plan.summary_accepted_trusted_footage_references, 1);
  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].provider, "trusted_footage_registry");
  assert.equal(plan.references[0].trusted_footage_source_id, "xbox-official-youtube");
  assert.equal(plan.references[0].source_tier, "official");
  assert.equal(plan.references[0].downloads_allowed, false);
  assert.equal(plan.references[0].allowed_render_use, "reference_only_by_default");
  assert.equal(plan.references[0].source_url_kind, "youtube_page");
  assert.equal(plan.references[0].segment_validation_eligible, false);
  assert.equal(plan.segment_validation_reference_counts.ineligible, 1);
  assert.equal(plan.safety.video_downloads, false);
  assert.ok(plan.provenance_ledger.some((item) => item.provider === "trusted_footage_registry"));
});

test("official trailer resolver rejects trusted registry references when the story has no matching target entity", async () => {
  const story = baseStory({
    id: "registry-steam-controller",
    title: "The Steam controller release date may have been leaked online",
    full_script: "Valve may have a new Steam Controller date, but the trailer source still needs checking.",
  });
  const trustedFootageRegistryReport = {
    accepted_sources: [
      {
        source_id: "ea-star-wars-zero-company",
        display_name: "EA official Star Wars Zero Company trailer",
        owner_type: "publisher",
        platform: "youtube",
        channel_url: "https://www.youtube.com/watch?v=starwars",
        reference_url: "https://www.youtube.com/watch?v=starwars",
        source_family: "ea_star_wars_zero_company",
        allowed_uses: ["reference_only"],
        source_tier: "official",
        provenance: {
          official_evidence: "Official EA trailer for a different game.",
        },
      },
    ],
    story_candidates: [
      {
        story_id: "registry-steam-controller",
        source_id: "ea-star-wars-zero-company",
        entity: "Star Wars Zero Company",
        display_name: "EA official Star Wars Zero Company trailer",
        source_family: "ea_star_wars_zero_company",
      },
    ],
  };

  const plan = await buildOfficialTrailerReferencePlan(story, {
    trustedFootageRegistryReport,
  });

  assert.equal(plan.summary_accepted_trusted_footage_references, 1);
  assert.equal(plan.filtered_target_mismatch_reference_count, 1);
  assert.equal(plan.references.length, 0);
  assert.equal(plan.motion_reference_readiness, "official_search_required");
  assert.ok(plan.search_queries.includes("The Steam controller release date may have been leaked online official trailer"));
});

test("official trailer resolver filters trusted registry comparison references", async () => {
  const story = baseStory({
    id: "registry-forza-comparison",
    title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
    hook: "Forza Horizon 6 just hit 92 on Metacritic, beating out Pok\u00e9mon Pokopia.",
    full_script:
      "Forza Horizon 6 just hit 92 on Metacritic, beating out Pok\u00e9mon Pokopia. Xbox Game Studios has the racing story.",
  });
  const trustedFootageRegistryReport = buildTrustedFootageRegistryReport({
    stories: [story],
    entries: [
      {
        source_id: "xbox-forza-launch-trailer",
        display_name: "Xbox official YouTube - Forza Horizon 6 launch trailer",
        owner_type: "platform",
        platform: "youtube",
        channel_url: "https://www.youtube.com/watch?v=forza",
        source_family: "xbox_forza_launch_trailer",
        entities: ["Forza Horizon 6"],
        allowed_uses: ["reference_only"],
        official_evidence: "Official Xbox trailer for Forza Horizon 6.",
      },
      {
        source_id: "nintendo-pokemon-channel",
        display_name: "Nintendo official YouTube - Pokemon",
        owner_type: "platform",
        platform: "youtube",
        channel_url: "https://www.youtube.com/@NintendoAmerica",
        source_family: "nintendo_pokemon",
        entities: ["Pokemon"],
        allowed_uses: ["reference_only"],
        official_evidence: "Official Nintendo channel.",
      },
    ],
    generatedAt: "2026-05-17T12:00:00.000Z",
  });

  const plan = await buildOfficialTrailerReferencePlan(story, {
    trustedFootageRegistryReport,
  });

  assert.deepEqual(plan.target_entities, ["Forza Horizon 6"]);
  assert.deepEqual(
    plan.references.map((reference) => reference.trusted_footage_source_id),
    ["xbox-forza-launch-trailer"],
  );
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
  assert.equal(report.summary.segment_validation_eligible_references, 1);
  assert.equal(report.summary.segment_validation_ineligible_references, 0);
  assert.match(markdown, /Official Trailer Reference Resolver/);
  assert.match(markdown, /segment-validation eligible references/);
  assert.match(markdown, /with-steam/);
  assert.match(markdown, /needs-search/);
});

test("official trailer report writer keeps story-specific outputs for separate candidate runs", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-trailer-reference-"));
  const firstReport = await buildOfficialTrailerReferenceReport([baseStory({ id: "flash-a" })]);
  const secondReport = await buildOfficialTrailerReferenceReport([baseStory({ id: "flash-b" })]);

  const firstWritten = await writeOfficialTrailerReferenceReportFiles(
    firstReport,
    renderOfficialTrailerReferenceMarkdown(firstReport),
    { outputDir },
  );
  const secondWritten = await writeOfficialTrailerReferenceReportFiles(
    secondReport,
    renderOfficialTrailerReferenceMarkdown(secondReport),
    { outputDir },
  );

  assert.notEqual(firstWritten.storyJson, secondWritten.storyJson);
  assert.equal(await fs.pathExists(firstWritten.storyJson), true);
  assert.equal(await fs.pathExists(secondWritten.storyJson), true);

  const firstStored = await fs.readJson(firstWritten.storyJson);
  const secondStored = await fs.readJson(secondWritten.storyJson);
  assert.deepEqual(firstStored, firstReport);
  assert.deepEqual(secondStored, secondReport);
  assert.deepEqual(firstStored.plans.map((plan) => plan.story_id), ["flash-a"]);
  assert.deepEqual(secondStored.plans.map((plan) => plan.story_id), ["flash-b"]);
  assert.equal(firstStored.safety.posted_to_platforms, false);
  assert.equal(secondStored.safety.production_db_mutated, false);
});

test("official trailer report writer keeps a stable one-story alias without updating latest", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-trailer-reference-alias-"));
  const report = await buildOfficialTrailerReferenceReport([baseStory({ id: "rss_5b3abe925b27a199" })]);
  const written = await writeOfficialTrailerReferenceReportFiles(
    report,
    renderOfficialTrailerReferenceMarkdown(report),
    { outputDir, writeCanonical: false },
  );

  const stableAlias = path.join(outputDir, "official_trailer_references_v1_story_rss_5b3abe925b27a199.json");
  const canonicalLatest = path.join(outputDir, "official_trailer_references_v1.json");

  assert.notEqual(written.storyJson, stableAlias);
  assert.equal(written.storyAliasJson, stableAlias);
  assert.equal(written.wroteCanonical, false);
  assert.equal(written.wroteStoryAlias, true);
  assert.equal(await fs.pathExists(written.storyJson), true);
  assert.equal(await fs.pathExists(stableAlias), true);
  assert.equal(await fs.pathExists(canonicalLatest), false);
  assert.deepEqual(await fs.readJson(stableAlias), report);
});
