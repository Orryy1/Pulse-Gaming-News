"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildLicensedDirectMediaAcquisitionReport,
  renderLicensedDirectMediaAcquisitionMarkdown,
} = require("../../lib/studio/v4/licensed-direct-media-acquisition");
const { parseArgs, rowsFromPayload } = require("../../tools/studio-v4-licensed-direct-media");
const packageJson = require("../../package.json");

const GENERATED_AT = "2026-05-20T09:00:00.000Z";

function sourceFamilyReport(candidateOverrides = {}) {
  const candidate = {
    story_id: "forza-gap",
    entity: "Forza Horizon 6",
    source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
    source_type: "official_youtube_channel_url",
    source_owner: "Xbox official YouTube",
    official_source_url: "https://www.youtube.com/watch?v=official",
    direct_media_url_if_available: "",
    source_tier: "official",
    source_url_kind: "youtube_watch",
    segment_validation_eligible: false,
    ...candidateOverrides,
  };

  return {
    schema_version: 1,
    execution_mode: "studio_v4_source_family_acquisition",
    generated_at: GENERATED_AT,
    rows: [
      {
        story_id: "forza-gap",
        title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
        primary_story_entity: "Forza Horizon 6",
        source_family_candidates: [candidate],
      },
    ],
    source_intake_template: {
      schema_version: 1,
      entries: [candidate],
    },
  };
}

function directDiscoveryReport(rowOverrides = {}) {
  return {
    schema_version: 1,
    execution_mode: "official_direct_media_discovery",
    rows: [
      {
        story_id: "forza-gap",
        entity: "Forza Horizon 6",
        source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
        status: "direct_media_found",
        direct_media_url: "https://cdn.xbox.com/forza-horizon-6/gameplay.webm",
        source_url_kind: "direct_video",
        segment_validation_eligible: true,
        source_duration_s: 398.01,
        media_width: 1280,
        media_height: 720,
        ...rowOverrides,
      },
    ],
  };
}

async function withTempVideo(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-v4-license-"));
  const file = path.join(dir, "creator-forza-clip.mp4");
  await fs.writeFile(file, "not a real video; path validation only");
  try {
    await fn({ dir, file });
  } finally {
    await fs.remove(dir);
  }
}

test("licensed direct media lane promotes official discovered direct media to render-ready", () => {
  const report = buildLicensedDirectMediaAcquisitionReport({
    sourceFamilyReport: sourceFamilyReport(),
    directMediaReport: directDiscoveryReport(),
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.execution_mode, "visual_v4_licensed_direct_media_acquisition");
  assert.equal(report.summary.render_ready_sources, 1);
  assert.equal(report.summary.direct_media_ready, 1);
  assert.equal(report.summary.blocked_sources, 0);
  assert.equal(report.safety.video_downloads_started, false);
  assert.equal(report.safety.production_db_mutated, false);
  assert.equal(report.accepted_references.length, 1);
  assert.equal(report.accepted_references[0].provider, "licensed_direct_media_acquisition");
  assert.equal(report.accepted_references[0].source_url, "https://cdn.xbox.com/forza-horizon-6/gameplay.webm");
  assert.equal(report.accepted_references[0].source_duration_s, 398.01);
  assert.equal(report.accepted_references[0].media_width, 1280);
  assert.equal(report.accepted_references[0].media_height, 720);

  const row = report.rows[0];
  assert.equal(row.status, "ready_for_segment_validation");
  assert.equal(row.access_mode, "approved_direct_media_url");
  assert.equal(row.rights_gate, "official_source");
  assert.equal(row.segment_validation_eligible, true);
  assert.equal(row.approved_media_url, "https://cdn.xbox.com/forza-horizon-6/gameplay.webm");
});

test("licensed direct media lane preserves duration metadata from implicit official direct media candidates", () => {
  const report = buildLicensedDirectMediaAcquisitionReport({
    sourceFamilyReport: sourceFamilyReport({
      source_family: "forza_horizon_official_x_fh6_lowlands_video",
      source_type: "platform_storefront_video_reference",
      source_owner: "Forza Horizon official X",
      official_source_url: "https://x.com/ForzaHorizon/status/example",
      source_url:
        "https://video-s.twimg.com/amplify_video/2021227162603339776/vid/avc1/1280x720/IbJGc42nnQTptud_.mp4?tag=14",
      source_url_kind: "direct_video",
      source_duration_s: 27.71,
      media_width: 1280,
      media_height: 720,
      segment_validation_eligible: true,
    }),
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.render_ready_sources, 1);
  assert.equal(report.rows[0].source_duration_s, 27.71);
  assert.equal(report.rows[0].media_width, 1280);
  assert.equal(report.rows[0].media_height, 720);
  assert.equal(report.accepted_references[0].source_duration_s, 27.71);
  assert.equal(report.accepted_references[0].source_family, "forza_horizon_official_x_fh6_lowlands_video");
});

test("licensed direct media lane preserves metadata from operator direct-media intake URLs", () => {
  const report = buildLicensedDirectMediaAcquisitionReport({
    sourceFamilyReport: sourceFamilyReport(),
    directMediaReport: directDiscoveryReport(),
    operatorIntake: [
      {
        story_id: "forza-gap",
        source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
        direct_media_url_if_available: "https://cdn.xbox.com/forza-horizon-6/gameplay.webm",
        source_duration_s: 398.01,
        media_width: 1280,
        media_height: 720,
      },
    ],
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.render_ready_sources, 1);
  assert.equal(report.rows[0].source_duration_s, 398.01);
  assert.equal(report.rows[0].media_width, 1280);
  assert.equal(report.rows[0].media_height, 720);
  assert.equal(report.accepted_references[0].source_duration_s, 398.01);
  assert.equal(report.accepted_references[0].media_width, 1280);
  assert.equal(report.accepted_references[0].media_height, 720);
});

test("licensed direct media CLI row normaliser reads official discovery output templates", () => {
  const rows = rowsFromPayload({
    schema_version: 1,
    execution_mode: "official_direct_media_discovery",
    rows: [],
    output_template: {
      entries: [
        {
          story_id: "forza-gap",
          source_family: "steam_forza_horizon_6_gameplay_trailer",
          direct_media_url_if_available: "https://video.akamai.steamstatic.com/store_trailers/forza/hls_264_master.m3u8",
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].story_id, "forza-gap");
  assert.match(rows[0].direct_media_url_if_available, /hls_264_master\.m3u8$/);
});

test("licensed direct media lane accepts CLI-filtered official discovery output templates", () => {
  const officialDiscovery = {
    schema_version: 1,
    execution_mode: "official_direct_media_discovery",
    rows: [],
    output_template: {
      entries: [
        {
          story_id: "forza-gap",
          entity: "Forza Horizon 6",
          source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
          source_type: "platform_storefront_video_reference",
          source_owner: "Xbox official storefront",
          official_source_url: "https://store.steampowered.com/app/example",
          direct_media_url_if_available: "https://cdn.xbox.com/forza-horizon-6/gameplay.webm",
          source_url_kind: "direct_video",
          source_duration_s: 398.01,
          media_width: 1280,
          media_height: 720,
        },
      ],
    },
  };
  const filtered = {
    ...officialDiscovery,
    rows: rowsFromPayload(officialDiscovery).filter((row) => row.story_id === "forza-gap"),
    entries: rowsFromPayload(officialDiscovery).filter((row) => row.story_id === "forza-gap"),
  };
  const report = buildLicensedDirectMediaAcquisitionReport({
    sourceFamilyReport: sourceFamilyReport(),
    directMediaReport: filtered,
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.source_candidates, 1);
  assert.equal(report.summary.render_ready_sources, 1);
  assert.equal(report.accepted_references[0].source_url, "https://cdn.xbox.com/forza-horizon-6/gameplay.webm");
});

test("licensed direct media lane promotes discovered direct media when source-family candidates are search-only", () => {
  const report = buildLicensedDirectMediaAcquisitionReport({
    sourceFamilyReport: {
      schema_version: 1,
      execution_mode: "studio_v4_source_family_acquisition",
      rows: [
        {
          story_id: "steam-controller",
          title: "Steam Controller Date May Have Leaked",
          primary_story_entity: "Steam Controller",
          source_family_candidates: [],
          official_search_actions: [
            {
              query: "Steam Controller official product video",
              status: "official_search_required",
            },
          ],
        },
      ],
    },
    directMediaReport: {
      schema_version: 1,
      execution_mode: "official_direct_media_discovery",
      rows: [
        {
          story_id: "steam-controller",
          entity: "Steam Controller",
          source_family: "steam_controller_valve_storefront_trailer",
          source_type: "official_platform_product_page",
          source_owner: "Valve / Steam official storefront",
          official_source_url: "https://store.steampowered.com/app/353370/Steam_Controller",
          direct_media_url: "https://video.fastly.steamstatic.com/store_trailers/353370/hls_264_master.m3u8",
          source_url_kind: "hls_manifest",
          source_duration_s: 93.8,
          media_width: 1920,
          media_height: 1080,
          status: "direct_media_found",
        },
      ],
    },
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.source_candidates, 1);
  assert.equal(report.summary.render_ready_sources, 1);
  assert.equal(report.summary.direct_media_ready, 1);
  assert.equal(report.accepted_references[0].source_url, "https://video.fastly.steamstatic.com/store_trailers/353370/hls_264_master.m3u8");
});

test("licensed direct media lane keeps operator official-source rows visible without source-family candidates", () => {
  const report = buildLicensedDirectMediaAcquisitionReport({
    sourceFamilyReport: {
      schema_version: 1,
      execution_mode: "studio_v4_source_family_acquisition",
      rows: [
        {
          story_id: "pokemon-go",
          title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
          primary_story_entity: "Pokémon Go",
          source_family_candidates: [],
        },
      ],
      source_intake_template: { entries: [] },
    },
    operatorIntake: [
      {
        story_id: "pokemon-go",
        entity: "Pokémon Go",
        source_family: "pokemon_go_mega_mewtwo_gofest_2026_official_news",
        source_type: "official_game_website_media_page",
        source_owner: "Pokémon GO official website",
        official_source_url: "https://pokemongo.com/news/mega-mewtwo-gofest-2026",
        evidence_of_officialness: "Official Pokémon GO website news page.",
        entity_match_notes: "Official page names Mega Mewtwo and Pokémon GO Fest 2026.",
      },
    ],
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.source_candidates, 1);
  assert.equal(report.summary.blocked_sources, 1);
  assert.equal(report.rows[0].story_id, "pokemon-go");
  assert.equal(report.rows[0].entity, "Pokémon Go");
  assert.equal(report.rows[0].source_family, "pokemon_go_mega_mewtwo_gofest_2026_official_news");
  assert.equal(report.rows[0].status, "blocked");
  assert.equal(report.rows[0].blocking_reason, "direct_media_or_local_operator_file_required");
  assert.equal(report.intake_template.entries.length, 1);
  assert.doesNotMatch(JSON.stringify(report), /PokÃ|Â/);
});

test("licensed direct media lane blocks trusted creator local files without permission evidence", async () => {
  await withTempVideo(async ({ dir, file }) => {
    const report = buildLicensedDirectMediaAcquisitionReport({
      sourceFamilyReport: sourceFamilyReport({
        source_family: "ign_first_forza_horizon_6_rush_events",
        source_type: "trusted_creator_channel_reference",
        source_owner: "IGN First",
        official_source_url: "https://www.youtube.com/watch?v=ign",
        source_tier: "trusted_creator_reference",
        rights_risk_class: "trusted_creator_reference_only",
      }),
      operatorIntake: [
        {
          story_id: "forza-gap",
          source_family: "ign_first_forza_horizon_6_rush_events",
          local_operator_file_path: file,
        },
      ],
      allowedLocalRoots: [dir],
      generatedAt: GENERATED_AT,
    });

    assert.equal(report.summary.render_ready_sources, 0);
    assert.equal(report.summary.trusted_creator_blocked, 1);
    assert.equal(report.rows[0].status, "blocked");
    assert.equal(report.rows[0].blocking_reason, "trusted_creator_requires_licence_or_permission");
  });
});

test("licensed direct media lane accepts trusted creator local files when the licence marker is complete", async () => {
  await withTempVideo(async ({ dir, file }) => {
    const report = buildLicensedDirectMediaAcquisitionReport({
      sourceFamilyReport: sourceFamilyReport({
        source_family: "ign_first_forza_horizon_6_rush_events",
        source_type: "trusted_creator_channel_reference",
        source_owner: "IGN First",
        official_source_url: "https://www.youtube.com/watch?v=ign",
        source_tier: "trusted_creator_reference",
        rights_risk_class: "trusted_creator_reference_only",
      }),
      operatorIntake: [
        {
          story_id: "forza-gap",
          source_family: "ign_first_forza_horizon_6_rush_events",
          local_operator_file_path: file,
          licence_evidence: "Written permission email saved in rights vault #FH6-IGN-001.",
          licence_scope: "Pulse Gaming vertical Shorts, UK and US social distribution.",
          autonomous_use_approved: true,
        },
      ],
      allowedLocalRoots: [dir],
      generatedAt: GENERATED_AT,
    });

    assert.equal(report.summary.render_ready_sources, 1);
    assert.equal(report.summary.local_file_ready, 1);
    assert.equal(report.rows[0].status, "ready_for_segment_validation");
    assert.equal(report.rows[0].access_mode, "local_operator_file");
    assert.equal(report.rows[0].rights_gate, "licence_marker");
    assert.equal(report.rows[0].local_operator_file_path, file);
    assert.equal(report.accepted_references[0].source_url, file);
    assert.equal(report.accepted_references[0].source_url_kind, "local_video_file");
    assert.equal(report.accepted_references[0].allowed_render_use, "licensed_short_clip_candidate");
  });
});

test("licensed direct media lane keeps bare official YouTube references blocked", () => {
  const report = buildLicensedDirectMediaAcquisitionReport({
    sourceFamilyReport: sourceFamilyReport(),
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.render_ready_sources, 0);
  assert.equal(report.summary.official_youtube_blocked, 1);
  assert.equal(report.rows[0].status, "blocked");
  assert.equal(
    report.rows[0].blocking_reason,
    "youtube_reference_requires_direct_media_local_file_or_permission",
  );
});

test("licensed direct media lane treats permission markers without media as permission-only", () => {
  const report = buildLicensedDirectMediaAcquisitionReport({
    sourceFamilyReport: sourceFamilyReport({
      source_family: "ign_first_forza_horizon_6_rush_events",
      source_type: "trusted_creator_channel_reference",
      source_owner: "IGN First",
      official_source_url: "https://www.youtube.com/watch?v=ign",
      source_tier: "trusted_creator_reference",
    }),
    operatorIntake: [
      {
        story_id: "forza-gap",
        source_family: "ign_first_forza_horizon_6_rush_events",
        licence_evidence: "Written permission email saved in rights vault #FH6-IGN-001.",
        licence_scope: "Pulse Gaming vertical Shorts, UK and US social distribution.",
        autonomous_use_approved: true,
      },
    ],
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.permission_only, 1);
  assert.equal(report.summary.render_ready_sources, 0);
  assert.equal(report.rows[0].status, "permission_ready_asset_needed");
  assert.equal(report.rows[0].rights_gate, "licence_marker");
});

test("licensed direct media lane rejects local files outside the allowed roots", () => {
  const report = buildLicensedDirectMediaAcquisitionReport({
    sourceFamilyReport: sourceFamilyReport({
      source_family: "operator_supplied_forza_clip",
      source_type: "official_game_website_media_page",
      source_tier: "official",
    }),
    operatorIntake: [
      {
        story_id: "forza-gap",
        source_family: "operator_supplied_forza_clip",
        local_operator_file_path: "C:\\Windows\\Temp\\forza.mp4",
      },
    ],
    allowedLocalRoots: [path.join(process.cwd(), "test", "output")],
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.render_ready_sources, 0);
  assert.equal(report.rows[0].status, "blocked");
  assert.equal(report.rows[0].blocking_reason, "local_operator_file_outside_allowed_roots");
});

test("licensed direct media lane exposes an operator intake template and safe CLI", () => {
  const report = buildLicensedDirectMediaAcquisitionReport({
    sourceFamilyReport: sourceFamilyReport(),
    generatedAt: GENERATED_AT,
  });
  const markdown = renderLicensedDirectMediaAcquisitionMarkdown(report);
  const args = parseArgs([
    "node",
    "tools/studio-v4-licensed-direct-media.js",
    "--story-id",
    "forza-gap",
    "--operator-intake",
    "test/output/licensed_direct_media_intake.json",
  ]);

  assert.equal(report.intake_template.entries.length, 1);
  assert.ok("approved_direct_media_url" in report.intake_template.entries[0]);
  assert.ok("local_operator_file_path" in report.intake_template.entries[0]);
  assert.ok("licence_evidence" in report.intake_template.entries[0]);
  assert.ok("autonomous_use_approved" in report.intake_template.entries[0]);
  assert.match(markdown, /Licensed Direct Media Acquisition/);
  assert.match(markdown, /No downloads, DB mutation, OAuth or posting/);
  assert.equal(args.storyId, "forza-gap");
  assert.match(
    packageJson.scripts["ops:v4-licensed-direct-media"],
    /studio-v4-licensed-direct-media\.js/,
  );
});
