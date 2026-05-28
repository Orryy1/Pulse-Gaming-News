"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("fs-extra");

const {
  buildStudioV4SourceFamilyAcquisitionReport,
  buildSourceFamilyIntakeTemplate,
  renderStudioV4SourceFamilyAcquisitionMarkdown,
} = require("../../lib/studio/v4/source-family-acquisition");
const {
  hydrateMotionPacksWithCanonicalManifests,
  mergeReferenceReports,
  parseArgs,
  commandPathsFromArgs,
} = require("../../tools/studio-v4-source-family-acquisition");
const packageJson = require("../../package.json");

function motionPack(overrides = {}) {
  return {
    schema_version: 1,
    story_id: "forza-gap",
    title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    readiness: {
      status: "v4_motion_blocked",
      blockers: [
        "actual_motion_clip_minimum_not_met",
        "distinct_motion_families_minimum_not_met",
      ],
      warnings: [],
    },
    motion_budget: {
      required_motion_scenes: 7,
      available_motion_clips: 1,
      required_distinct_families: 6,
      available_distinct_families: 1,
    },
    clips: [
      {
        id: "steam-window",
        source_family: "steam_2483190_1133501958",
        path: "https://video.akamai.steamstatic.com/store_trailers/2483190/1133501958/clip.m3u8",
        source_url_kind: "hls_manifest",
        validated: true,
      },
    ],
    trusted_source_pipeline: {
      references_found: 4,
      intake_queue: [
        {
          source_id: "steam-forza",
          display_name: "Steam - Forza Horizon 6 launch trailer",
          source_family: "steam_forza_horizon_6_launch_trailer",
          source_tier: "official",
          source_url_kind: "hls_manifest",
          segment_validation_eligible: true,
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
        {
          source_id: "xbox-youtube",
          display_name: "Xbox official YouTube - Forza Horizon 6 launch trailer",
          source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
          source_tier: "official",
          source_url_kind: "youtube_watch",
          segment_validation_eligible: false,
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
        {
          source_id: "forza-site",
          display_name: "Forza official site - Forza Horizon 6",
          source_family: "forza_official_site_forza_horizon_6",
          source_tier: "official",
          source_url_kind: "html_or_unknown_page",
          segment_validation_eligible: false,
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
      ],
    },
    ...overrides,
  };
}

function trustedReport() {
  return {
    story_candidates: [
      {
        story_id: "forza-gap",
        entity: "Forza Horizon 6",
        source_id: "xbox-youtube",
        display_name: "Xbox official YouTube - Forza Horizon 6 launch trailer",
        source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
        source_tier: "official",
        reference_url: "https://www.youtube.com/watch?v=official",
        source_url_kind: "youtube_watch",
        segment_validation_eligible: false,
        rights_risk_class: "official_reference_only",
        allowed_render_use: "reference_only_by_default",
      },
      {
        story_id: "forza-gap",
        entity: "Forza Horizon 6",
        source_id: "forza-site",
        display_name: "Forza official site - Forza Horizon 6",
        source_family: "forza_official_site_forza_horizon_6",
        source_tier: "official",
        reference_url: "https://forza.net/forzahorizon6/",
        source_url_kind: "html_or_unknown_page",
        segment_validation_eligible: false,
        rights_risk_class: "official_reference_only",
        allowed_render_use: "reference_only_by_default",
      },
    ],
  };
}

function referenceReport() {
  return {
    plans: [
      {
        story_id: "forza-gap",
        title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
        target_entities: ["Forza Horizon 6"],
        missing_target_entities: [],
        references: [
          {
            provider: "steam",
            entity: "Forza Horizon 6",
            source_family: "steam_forza_horizon_6_launch_trailer",
            source_url: "https://video.akamai.steamstatic.com/store_trailers/2483190/1133501958/clip.m3u8",
            source_url_kind: "hls_manifest",
            segment_validation_eligible: true,
            rights_risk_class: "storefront_promotional_video",
            allowed_render_use: "reference_only_by_default",
          },
          {
            provider: "trusted_footage_registry",
            entity: "Forza Horizon 6",
            source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
            source_url: "https://www.youtube.com/watch?v=official",
            source_url_kind: "youtube_watch",
            segment_validation_eligible: false,
            rights_risk_class: "official_reference_only",
            allowed_render_use: "reference_only_by_default",
          },
        ],
        planned_searches: [
          {
            query: "Forza Horizon 6 official trailer",
            entity: "Forza Horizon 6",
            accepted_sources: ["Steam", "official publisher channel", "platform storefront"],
            will_download: false,
          },
        ],
      },
    ],
  };
}

test("Studio V4 source-family acquisition turns a blocked motion pack into exact intake work", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [motionPack()],
    trustedFootageReport: trustedReport(),
    referenceReport: referenceReport(),
    generatedAt: "2026-05-19T21:00:00.000Z",
  });

  assert.equal(report.execution_mode, "studio_v4_source_family_acquisition");
  assert.equal(report.summary.stories_blocked, 1);
  assert.equal(report.summary.source_intake_template_entries, 2);
  assert.equal(report.safety.video_downloads_started, false);
  assert.equal(report.safety.production_db_mutated, false);

  const row = report.rows[0];
  assert.equal(row.story_id, "forza-gap");
  assert.deepEqual(row.source_proof_covered_target_entities, []);
  assert.deepEqual(row.source_proof_missing_target_entities, []);
  assert.equal(row.current_motion_families, 1);
  assert.equal(row.required_motion_families, 6);
  assert.equal(row.missing_motion_families, 5);
  assert.equal(row.current_motion_clips, 1);
  assert.equal(row.required_motion_clips, 7);
  assert.equal(row.missing_motion_clips, 6);
  assert.ok(row.current_family_names.includes("steam_2483190_1133501958"));
  assert.ok(
    row.source_family_candidates.some(
      (candidate) =>
        candidate.source_family === "xbox_official_youtube_forza_horizon_6_launch_trailer" &&
        candidate.status === "needs_direct_media_url",
    ),
  );
  assert.ok(
    row.safe_next_commands.some((item) =>
      item.command.includes("media:intake-official-sources"),
    ),
  );
  assert.ok(
    row.safe_next_commands.some((item) =>
      item.command.includes("ops:v4-licensed-direct-media"),
    ),
  );
  assert.ok(
    row.safe_next_commands.some((item) =>
      item.command.includes("ops:v4-motion-pack"),
    ),
  );
  assert.deepEqual(
    row.safe_next_commands.slice(0, 2).map((item) => item.step),
    ["discover_direct_media_from_official_pages", "validate_operator_supplied_official_sources"],
  );
  assert.match(
    row.safe_next_commands[1].command,
    /--input test\/output\/official_direct_media_intake_template\.json/,
  );
});

test("Studio V4 source-family acquisition preserves source-proof coverage separately from motion gaps", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "source-proof-only",
        title: "Super Mario RPG Drops To $15",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
      }),
    ],
    referenceReport: {
      plans: [
        {
          story_id: "source-proof-only",
          title: "Super Mario RPG Drops To $15",
          target_entities: ["Super Mario RPG"],
          source_proof_covered_target_entities: ["Super Mario RPG"],
          source_proof_missing_target_entities: [],
          covered_target_entities: [],
          missing_target_entities: ["Super Mario RPG"],
          motion_reference_readiness: "official_search_required",
          references: [
            {
              provider: "official_intake",
              entity: "Super Mario RPG",
              source_family: "nintendo_store_super_mario_rpg",
              source_url: "https://www.nintendo.com/us/store/products/super-mario-rpg-switch/",
              source_url_kind: "html_or_unknown_page",
              segment_validation_eligible: false,
              rights_risk_class: "official_reference_only",
              allowed_render_use: "reference_only_by_default",
            },
          ],
          planned_searches: [
            {
              query: "Super Mario RPG official trailer",
              entity: "Super Mario RPG",
              accepted_sources: ["official publisher channel", "platform storefront"],
              will_download: false,
            },
          ],
        },
      ],
    },
    generatedAt: "2026-05-27T16:25:00.000Z",
  });

  const row = report.rows[0];
  assert.deepEqual(row.source_proof_covered_target_entities, ["Super Mario RPG"]);
  assert.deepEqual(row.source_proof_missing_target_entities, []);
  assert.deepEqual(row.motion_covered_target_entities, []);
  assert.deepEqual(row.motion_missing_target_entities, ["Super Mario RPG"]);
  assert.equal(row.source_family_candidates[0].status, "needs_direct_media_url");
  assert.equal(row.source_family_candidates[0].source_family, "nintendo_store_super_mario_rpg");
  assert.equal(report.summary.source_proof_covered_story_count, 1);
});

test("Studio V4 source-family acquisition lets official source entities repair broad Pokemon targets", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "pokemon-go-source-proof",
        title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
        canonical_subject: "Pokémon",
        canonical_game: "Pokémon",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
      }),
    ],
    referenceReport: {
      plans: [
        {
          story_id: "pokemon-go-source-proof",
          title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
          target_entities: ["Pokémon"],
          source_proof_covered_target_entities: ["Pokémon"],
          source_proof_missing_target_entities: [],
          covered_target_entities: [],
          missing_target_entities: ["Pokémon"],
          motion_reference_readiness: "official_search_required",
          references: [
            {
              provider: "official_intake",
              entity: "Pokémon Go",
              source_family: "pokemon_go_official_mega_mewtwo_gofest_2026",
              source_url: "https://pokemongo.com/en/news/mega-mewtwo-gofest-2026",
              source_url_kind: "html_or_unknown_page",
              segment_validation_eligible: false,
              rights_risk_class: "official_reference_only",
              allowed_render_use: "reference_only_by_default",
            },
          ],
        },
      ],
    },
    generatedAt: "2026-05-27T17:05:00.000Z",
  });

  const row = report.rows[0];
  assert.equal(row.primary_story_entity, "Pokémon Go");
  assert.deepEqual(row.source_search_blockers, []);
  assert.deepEqual(row.canonical_entity_repair_blockers, []);
  assert.equal(row.source_family_candidates[0].entity, "Pokémon Go");
  assert.equal(row.source_family_candidates[0].status, "needs_direct_media_url");
  assert.equal(report.canonical_entity_repair_template.entries.length, 0);
});

test("Studio V4 source-family acquisition can enrich V4-ready packs with direct-video gaps", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        readiness: { status: "v4_motion_ready", blockers: [], warnings: [] },
        clips: [
          {
            id: "still-1",
            source_family: "steam_still_family_1",
            path: "https://cdn.akamai.steamstatic.com/steam/apps/1/ss_1.jpg",
            source_url_kind: "image",
            validated: true,
          },
          {
            id: "still-2",
            source_family: "steam_still_family_2",
            path: "https://cdn.akamai.steamstatic.com/steam/apps/1/ss_2.jpg",
            source_url_kind: "image",
            validated: true,
          },
        ],
        motion_budget: {
          required_motion_scenes: 7,
          available_motion_clips: 7,
          required_distinct_families: 6,
          available_distinct_families: 6,
        },
      }),
    ],
    trustedFootageReport: trustedReport(),
    referenceReport: referenceReport(),
    directVideoEnrichmentWorkOrder: {
      jobs: [
        {
          story_id: "forza-gap",
          repair_lane: "direct_video_enrichment",
          blocker_type: "visual_evidence:direct_video_motion_missing",
        },
      ],
    },
    generatedAt: "2026-05-26T12:30:00.000Z",
  });

  assert.equal(report.summary.stories_blocked, 0);
  assert.equal(report.summary.direct_video_enrichment_stories, 1);
  assert.equal(report.summary.stories_needing_acquisition, 1);
  assert.equal(report.summary.source_intake_template_entries, 3);

  const row = report.rows[0];
  assert.equal(row.story_id, "forza-gap");
  assert.equal(row.readiness_status, "v4_motion_ready");
  assert.equal(row.direct_video_enrichment_requested, true);
  assert.equal(row.missing_direct_video_motion, 1);
  assert.equal(row.blocking_current_motion_readiness, false);
  assert.ok(row.blockers.includes("visual_evidence:direct_video_motion_missing"));
  assert.ok(
    row.source_family_candidates.some(
      (candidate) =>
        candidate.source_family === "xbox_official_youtube_forza_horizon_6_launch_trailer" &&
        candidate.status === "needs_direct_media_url",
    ),
  );
});

test("Studio V4 source-family acquisition refreshes page-backed current families", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        clips: [
          {
            id: "gamefront-window",
            source_family: "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
            path:
              "https://osiris.gamefront.test/forza-horizon-6-official-initial-drive-gameplay.mp4?expires=soon",
            source_url_kind: "direct_video",
            validated: true,
          },
        ],
      }),
    ],
    trustedFootageReport: {
      story_candidates: [
        {
          story_id: "forza-gap",
          entity: "Forza Horizon 6",
          source_id: "gamefront-xgs-fh6",
          display_name: "GameFront - Xbox Game Studios FH6 Initial Drive Gameplay",
          source_type: "publisher_media_repository_video_reference",
          source_family: "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
          reference_url:
            "https://www.gamefront.com/videos/forza-horizon-6/forza-horizon-6-official-initial-drive-gameplay",
          source_url:
            "https://www.gamefront.com/videos/forza-horizon-6/forza-horizon-6-official-initial-drive-gameplay",
          source_url_kind: "html_or_unknown_page",
          segment_validation_eligible: false,
          rights_risk_class: "official_reference_only",
          allowed_render_use: "reference_only_by_default",
        },
      ],
    },
    referenceReport: referenceReport(),
    generatedAt: "2026-05-20T07:45:00.000Z",
  });

  assert.ok(
    report.rows[0].source_family_candidates.some(
      (candidate) =>
        candidate.source_family === "gamefront_xbox_game_studios_fh6_initial_drive_gameplay" &&
        candidate.status === "needs_direct_media_url",
    ),
  );
  assert.ok(
    report.source_intake_template.entries.some(
      (entry) =>
        entry.source_family === "gamefront_xbox_game_studios_fh6_initial_drive_gameplay" &&
        entry.source_type === "publisher_media_repository_video_reference",
    ),
  );
});

test("Studio V4 source-family acquisition builds fillable official-source intake rows", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [motionPack()],
    trustedFootageReport: trustedReport(),
    referenceReport: referenceReport(),
  });
  const template = buildSourceFamilyIntakeTemplate(report.rows);

  assert.equal(template.length, 2);
  assert.equal(template[0].story_id, "forza-gap");
  assert.equal(template[0].entity, "Forza Horizon 6");
  assert.equal(template[0].downloads_allowed, false);
  assert.equal(template[0].direct_media_url_if_available, "");
  assert.equal(template[0].approved_direct_media_url, "");
  assert.equal(template[0].local_operator_file_path, "");
  assert.equal(template[0].licence_evidence, "");
  assert.equal(template[0].permission_evidence, "");
  assert.equal(template[0].licence_scope, "");
  assert.equal(template[0].autonomous_use_approved, false);
  assert.match(template[0].direct_media_url_notes, /\.mp4/);
  assert.match(template[0].direct_media_url_notes, /\.m3u8/);
  assert.ok(template[0].acceptance_checks.some((item) => item.includes("official")));
  assert.ok(template[0].rejection_checks.includes("random_youtube_reupload"));
});

test("Studio V4 source-family acquisition does not mislabel trusted creator references as official YouTube", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        trusted_source_pipeline: {
          references_found: 1,
          intake_queue: [
            {
              source_id: "ign-first-forza-rush-events",
              display_name: "IGN First - Forza Horizon 6 Rush Events gameplay",
              source_family: "ign_first_forza_horizon_6_rush_events",
              source_tier: "trusted_creator_reference",
              source_url: "https://www.youtube.com/watch?v=FvKBNy1VYhg",
              reference_url: "https://www.youtube.com/watch?v=FvKBNy1VYhg",
              source_url_kind: "youtube_watch",
              segment_validation_eligible: false,
              allowed_render_use: "reference_only_by_default",
              rights_risk_class: "trusted_creator_reference_only",
            },
          ],
        },
      }),
    ],
    trustedFootageReport: { story_candidates: [], accepted_sources: [] },
    referenceReport: referenceReport(),
  });
  const template = buildSourceFamilyIntakeTemplate(report.rows);

  const ign = template.find((entry) => entry.source_family === "ign_first_forza_horizon_6_rush_events");
  assert.ok(ign);
  assert.equal(ign.source_type, "trusted_creator_channel_reference");
  assert.ok(ign.acceptance_checks.some((item) => /licen[cs]e/i.test(item)));
});

test("Studio V4 source-family acquisition ignores stale frame-ready flags on page URLs", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        trusted_source_pipeline: {
          references_found: 1,
          intake_queue: [
            {
              source_id: "forza-site",
              display_name: "Forza official site - Forza Horizon 6",
              source_family: "forza_official_site_forza_horizon_6",
              source_tier: "official",
              source_url: "https://forza.net/forzahorizon6/",
              reference_url: "https://forza.net/forzahorizon6/",
              source_url_kind: "html_or_unknown_page",
              segment_validation_eligible: true,
            },
          ],
        },
      }),
    ],
    trustedFootageReport: { story_candidates: [], accepted_sources: [] },
    referenceReport: referenceReport(),
  });

  const candidate = report.rows[0].source_family_candidates.find(
    (item) => item.source_family === "forza_official_site_forza_horizon_6",
  );
  assert.ok(candidate);
  assert.equal(candidate.segment_validation_eligible, false);
  assert.equal(candidate.status, "needs_direct_media_url");
});

test("Studio V4 source-family acquisition does not trust stale direct-video kind on social page URLs", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        trusted_source_pipeline: {
          references_found: 1,
          intake_queue: [
            {
              source_id: "forza-official-x-fh6-lowlands-video",
              display_name: "Forza Horizon official X - FH6 Lowlands video",
              source_family: "forza_horizon_official_x_fh6_lowlands_video",
              source_tier: "official",
              source_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
              reference_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
              source_url_kind: "direct_video",
              segment_validation_eligible: true,
            },
          ],
        },
      }),
    ],
    trustedFootageReport: { story_candidates: [], accepted_sources: [] },
    referenceReport: referenceReport(),
  });

  const candidate = report.rows[0].source_family_candidates.find(
    (item) => item.source_family === "forza_horizon_official_x_fh6_lowlands_video",
  );
  const template = buildSourceFamilyIntakeTemplate(report.rows);
  const intake = template.find(
    (entry) => entry.source_family === "forza_horizon_official_x_fh6_lowlands_video",
  );

  assert.ok(candidate);
  assert.equal(candidate.source_url_kind, "html_or_unknown_page");
  assert.equal(candidate.segment_validation_eligible, false);
  assert.equal(candidate.status, "needs_direct_media_url");
  assert.equal(intake.official_source_url, "https://x.com/ForzaHorizon/status/2021227288788947178");
  assert.equal(intake.direct_media_url_if_available, "");
});

test("Studio V4 source-family acquisition merges global direct media only for a specific title entity", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "forza-direct-gap",
        title: "Forza Horizon 6 achieved a huge Steam player peak",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
        trusted_source_pipeline: {
          references_found: 1,
          intake_queue: [
            {
              source_id: "forza-official-x-fh6-lowlands-video",
              display_name: "Forza Horizon official X - FH6 Lowlands video",
              source_family: "forza_horizon_official_x_fh6_lowlands_video",
              source_tier: "official",
              source_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
              reference_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
              source_url_kind: "direct_video",
              entities: ["Forza Horizon 6", "Forza", "Xbox Game Studios"],
            },
          ],
        },
      }),
    ],
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "forza-official-x-fh6-lowlands-video",
          display_name: "Forza Horizon official X - FH6 Lowlands video",
          source_family: "forza_horizon_official_x_fh6_lowlands_video",
          source_tier: "official",
          source_url:
            "https://video-s.twimg.com/amplify_video/2021227162603339776/vid/avc1/1280x720/IbJGc42nnQTptud_.mp4?tag=14",
          direct_media_url_if_available:
            "https://video-s.twimg.com/amplify_video/2021227162603339776/vid/avc1/1280x720/IbJGc42nnQTptud_.mp4?tag=14",
          reference_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          source_duration_s: 27.71,
          entities: ["Forza Horizon 6", "Forza", "Xbox Game Studios"],
        },
      ],
      story_candidates: [],
    },
    referenceReport: { plans: [] },
  });

  const candidate = report.rows[0].source_family_candidates.find(
    (item) => item.source_family === "forza_horizon_official_x_fh6_lowlands_video",
  );

  assert.ok(candidate);
  assert.equal(
    candidate.source_url,
    "https://video-s.twimg.com/amplify_video/2021227162603339776/vid/avc1/1280x720/IbJGc42nnQTptud_.mp4?tag=14",
  );
  assert.equal(candidate.reference_url, "https://x.com/ForzaHorizon/status/2021227288788947178");
  assert.equal(candidate.source_url_kind, "direct_video");
  assert.equal(candidate.segment_validation_eligible, true);
  assert.equal(candidate.status, "ready_for_frame_plan");
  assert.equal(candidate.source_duration_s, 27.71);
});

test("Studio V4 source-family acquisition preserves direct media when merging the same source family", () => {
  const pageFirstPack = motionPack({
    trusted_source_pipeline: {
      references_found: 1,
      intake_queue: [
        {
          source_id: "forza-site",
          display_name: "Forza official site - Forza Horizon 6",
          source_family: "forza_official_site_forza_horizon_6",
          source_tier: "official",
          source_url: "https://forza.net/forzahorizon6/",
          reference_url: "https://forza.net/forzahorizon6/",
          source_url_kind: "html_or_unknown_page",
          segment_validation_eligible: false,
        },
      ],
    },
  });
  const directMediaReferences = {
    plans: [
      {
        story_id: "forza-gap",
        title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
        target_entities: ["Forza Horizon 6"],
        covered_target_entities: ["Forza Horizon 6"],
        references: [
          {
            provider: "official_intake",
            entity: "Forza Horizon 6",
            source_family: "forza_official_site_forza_horizon_6",
            source_url: "https://cdn.forza.net/forza-horizon-6-keyart.webm",
            reference_page_url: "https://forza.net/forzahorizon6/",
            source_url_kind: "direct_video",
            segment_validation_eligible: true,
            source_duration_s: 10,
          },
        ],
      },
    ],
  };

  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [pageFirstPack],
    trustedFootageReport: { story_candidates: [], accepted_sources: [] },
    referenceReport: directMediaReferences,
  });
  const candidate = report.rows[0].source_family_candidates.find(
    (item) => item.source_family === "forza_official_site_forza_horizon_6",
  );
  const template = buildSourceFamilyIntakeTemplate(report.rows);

  assert.equal(candidate.source_url, "https://cdn.forza.net/forza-horizon-6-keyart.webm");
  assert.equal(candidate.reference_url, "https://forza.net/forzahorizon6/");
  assert.equal(candidate.source_url_kind, "direct_video");
  assert.equal(candidate.segment_validation_eligible, true);
  assert.equal(candidate.source_duration_s, 10);
  assert.equal(candidate.status, "ready_for_frame_plan");
  const intake = template.find((entry) => entry.source_family === "forza_official_site_forza_horizon_6");
  assert.ok(intake);
  assert.equal(intake.official_source_url, "https://forza.net/forzahorizon6/");
  assert.equal(intake.direct_media_url_if_available, "https://cdn.forza.net/forza-horizon-6-keyart.webm");
  assert.equal(intake.source_duration_s, 10);
});

test("Studio V4 source-family acquisition stays empty when packs are ready", () => {
  const readyPack = motionPack({
    readiness: { status: "v4_motion_ready", blockers: [], warnings: [] },
    motion_budget: {
      required_motion_scenes: 7,
      available_motion_clips: 7,
      required_distinct_families: 6,
      available_distinct_families: 6,
    },
  });
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [readyPack],
    trustedFootageReport: trustedReport(),
    referenceReport: referenceReport(),
  });

  assert.equal(report.summary.stories_blocked, 0);
  assert.equal(report.rows.length, 0);
  assert.equal(report.source_intake_template.entries.length, 0);
});

test("Studio V4 source-family acquisition rejects unrelated source families before intake", () => {
  const noisyPack = motionPack({
    trusted_source_pipeline: {
      references_found: 5,
      intake_queue: [
        {
          source_id: "nintendo-america-official-youtube",
          display_name: "Nintendo of America official YouTube",
          source_family: "nintendo_america_official_youtube",
          source_tier: "official",
          source_url_kind: "youtube_page",
          segment_validation_eligible: false,
        },
        {
          source_id: "playstation-official-youtube",
          display_name: "PlayStation official YouTube",
          source_family: "playstation_official_youtube",
          source_tier: "official",
          source_url_kind: "youtube_page",
          segment_validation_eligible: false,
        },
        {
          source_id: "forza-site",
          display_name: "Forza official site - Forza Horizon 6",
          source_family: "forza_official_site_forza_horizon_6",
          source_tier: "official",
          source_url_kind: "html_or_unknown_page",
          segment_validation_eligible: false,
        },
      ],
    },
  });
  const noisyReferences = {
    plans: [
      {
        story_id: "forza-gap",
        title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
        target_entities: ["Pokemon", "Forza Horizon 6"],
        covered_target_entities: ["Forza Horizon 6"],
        verified_store_targets: [{ entity: "Forza Horizon 6" }],
        references: [
          {
            provider: "trusted_footage_registry",
            entity: "Pokemon",
            source_family: "nintendo_america_official_youtube",
            source_url: "https://www.youtube.com/@NintendoAmerica",
            source_url_kind: "youtube_page",
          },
          {
            provider: "trusted_footage_registry",
            entity: "PlayStation",
            source_family: "playstation_official_youtube",
            source_url: "https://www.youtube.com/@PlayStation",
            source_url_kind: "youtube_page",
          },
          {
            provider: "trusted_footage_registry",
            entity: "Forza Horizon 6",
            source_family: "forza_official_site_forza_horizon_6",
            source_url: "https://forza.net/forzahorizon6/",
            source_url_kind: "html_or_unknown_page",
          },
        ],
      },
    ],
  };

  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [noisyPack],
    trustedFootageReport: {
      accepted_sources: [
        {
          source_family: "nintendo_america_official_youtube",
          entities: ["Nintendo", "Pokemon"],
        },
        {
          source_family: "playstation_official_youtube",
          entities: ["PlayStation", "PS5"],
        },
      ],
      story_candidates: [],
    },
    referenceReport: noisyReferences,
  });
  const candidates = report.rows[0].source_family_candidates.map((candidate) => candidate.source_family);
  const template = buildSourceFamilyIntakeTemplate(report.rows);

  assert.deepEqual(candidates, ["forza_official_site_forza_horizon_6"]);
  assert.equal(template.length, 1);
  assert.equal(template[0].entity, "Forza Horizon 6");
});

test("Studio V4 source-family acquisition does not count the same Steam trailer as a new family", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [motionPack()],
    trustedFootageReport: trustedReport(),
    referenceReport: referenceReport(),
  });
  const families = report.rows[0].source_family_candidates.map((candidate) => candidate.source_family);

  assert.ok(!families.includes("steam_forza_horizon_6_launch_trailer"));
});

test("Studio V4 source-family acquisition skips generic parent channels when a story-specific source exists", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [motionPack()],
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "xbox-official-youtube",
          display_name: "Xbox official YouTube",
          source_family: "xbox_official_youtube",
          source_tier: "official",
          channel_url: "https://www.youtube.com/@Xbox",
          source_url_kind: "youtube_page",
          entities: ["Xbox", "Forza", "Forza Horizon 6"],
        },
        {
          source_id: "xbox-forza-launch-trailer",
          display_name: "Xbox official YouTube - Forza Horizon 6 launch trailer",
          source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
          source_tier: "official",
          channel_url: "https://www.youtube.com/watch?v=official",
          source_url_kind: "youtube_watch",
          entities: ["Forza Horizon 6", "Xbox"],
        },
      ],
    },
    referenceReport: referenceReport(),
  });
  const families = report.rows[0].source_family_candidates.map((candidate) => candidate.source_family);

  assert.ok(!families.includes("xbox_official_youtube"));
  assert.ok(families.includes("xbox_official_youtube_forza_horizon_6_launch_trailer"));
});

test("Studio V4 source-family acquisition rejects wrong-game platform references", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "expanse-gap",
        title: "The Expanse Shows Real Gameplay",
        trusted_source_pipeline: {
          references_found: 2,
          intake_queue: [
            {
              source_id: "xbox-official-youtube",
              display_name: "Xbox official YouTube",
              source_family: "xbox_official_youtube",
              source_tier: "official",
              reference_url: "https://www.youtube.com/@Xbox",
              source_url_kind: "youtube_page",
              entities: ["Xbox", "Forza", "Forza Horizon 6"],
            },
            {
              source_id: "xbox-forza-launch-trailer",
              display_name: "Xbox official YouTube - Forza Horizon 6 launch trailer",
              source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
              source_tier: "official",
              reference_url: "https://www.youtube.com/watch?v=official",
              source_url_kind: "youtube_watch",
              entities: ["Forza Horizon 6", "Xbox"],
            },
          ],
        },
      }),
    ],
    trustedFootageReport: { accepted_sources: [], story_candidates: [] },
    referenceReport: { plans: [] },
  });

  const row = report.rows[0];
  const families = row.source_family_candidates.map((candidate) => candidate.source_family);
  assert.deepEqual(families, []);
  assert.equal(row.official_search_actions[0].entity, "The Expanse Shows Real Gameplay");
  assert.match(row.official_search_actions[0].query, /The Expanse/);
});

test("Studio V4 source-family acquisition ignores stale wrong-entity clips", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "lotr-gap",
        title: "Amazon Has Cancelled The Lord of the Rings MMO",
        canonical_game: "The Lord of the Rings MMO",
        clips: [
          {
            id: "stale-forza-clip",
            entity: "Forza Horizon 6",
            source_family: "forza_horizon_official_x_fh6_coast_video",
            path: "https://video.twimg.com/amplify_video/2020858232789487616/vid/avc1/1280x720/h2mPH2YV-GPuJ6Q9.mp4?tag=14",
            source_url_kind: "direct_video",
          },
        ],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 1,
          required_distinct_families: 4,
          available_distinct_families: 1,
        },
        trusted_source_pipeline: {
          references_found: 1,
          intake_queue: [
            {
              source_id: "forza-official-x-fh6-coast-video",
              display_name: "Forza Horizon official X - FH6 Coast video",
              source_family: "forza_horizon_official_x_fh6_coast_video",
              source_tier: "official",
              reference_url: "https://x.com/ForzaHorizon/status/2020858359071617098",
              source_url_kind: "direct_video",
              entities: ["Forza Horizon 6", "Forza"],
            },
          ],
        },
      }),
    ],
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "forza-official-x-fh6-coast-video",
          display_name: "Forza Horizon official X - FH6 Coast video",
          source_family: "forza_horizon_official_x_fh6_coast_video",
          source_tier: "official",
          source_url:
            "https://video.twimg.com/amplify_video/2020858232789487616/vid/avc1/1280x720/h2mPH2YV-GPuJ6Q9.mp4?tag=14",
          reference_url: "https://x.com/ForzaHorizon/status/2020858359071617098",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entities: ["Forza Horizon 6", "Forza"],
        },
      ],
      story_candidates: [],
    },
    referenceReport: { plans: [] },
  });

  const row = report.rows[0];
  assert.equal(row.primary_story_entity, "The Lord of the Rings MMO");
  assert.deepEqual(row.source_family_candidates, []);
  assert.equal(row.official_search_actions[0].entity, "The Lord of the Rings MMO");
  assert.match(row.official_search_actions[0].query, /Lord of the Rings MMO/);
  assert.equal(report.source_intake_template.entries.length, 0);
});

test("Studio V4 source-family acquisition does not match games on one shared word", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "horizon-gap",
        title: "Billbil-kun: Horizon Zero Dawn Remastered leaked into April's PS Plus lineup",
        canonical_game: "Horizon Zero Dawn Remastered",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
      }),
    ],
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "forza-official-x-fh6-coast-video",
          display_name: "Forza Horizon official X - FH6 Coast video",
          source_family: "forza_horizon_official_x_fh6_coast_video",
          source_tier: "official",
          source_url:
            "https://video.twimg.com/amplify_video/2020858232789487616/vid/avc1/1280x720/h2mPH2YV-GPuJ6Q9.mp4?tag=14",
          reference_url: "https://x.com/ForzaHorizon/status/2020858359071617098",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entities: ["Forza Horizon 6", "Forza"],
        },
      ],
      story_candidates: [],
    },
    referenceReport: { plans: [] },
  });

  const row = report.rows[0];
  assert.equal(row.primary_story_entity, "Horizon Zero Dawn Remastered");
  assert.deepEqual(row.source_family_candidates, []);
  assert.equal(row.official_search_actions[0].entity, "Horizon Zero Dawn Remastered");
});

test("Studio V4 source-family acquisition expands FH6 before matching sources", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "fh6-accessory-gap",
        title: "FH6 limited-edition Xbox controller and headset have just leaked",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
      }),
    ],
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "xbox-forza-launch-trailer",
          display_name: "Xbox official YouTube - Forza Horizon 6 launch trailer",
          source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
          source_tier: "official",
          source_url: "https://www.youtube.com/watch?v=official",
          reference_url: "https://www.youtube.com/watch?v=official",
          source_url_kind: "youtube_watch",
          entities: ["Forza Horizon 6", "Xbox"],
        },
      ],
      story_candidates: [],
    },
    referenceReport: { plans: [] },
  });

  const row = report.rows[0];
  const families = row.source_family_candidates.map((candidate) => candidate.source_family);
  assert.equal(row.primary_story_entity, "Forza Horizon 6");
  assert.ok(families.includes("xbox_official_youtube_forza_horizon_6_launch_trailer"));
});

test("Studio V4 source-family acquisition rejects specific game footage on generic platform overlap", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "xbox-chief-gap",
        title: "Tom Warren - Microsoft's new Xbox chief is reevaluating exclusive games",
        canonical_subject: "Xbox chief",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
      }),
    ],
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "xbox-forza-launch-trailer",
          display_name: "Xbox official YouTube - Forza Horizon 6 launch trailer",
          source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
          source_tier: "official",
          source_url: "https://www.youtube.com/watch?v=official",
          reference_url: "https://www.youtube.com/watch?v=official",
          source_url_kind: "youtube_watch",
          entities: ["Forza Horizon 6", "Xbox"],
        },
      ],
      story_candidates: [],
    },
    referenceReport: { plans: [] },
  });

  const row = report.rows[0];
  assert.equal(row.primary_story_entity, "Xbox chief");
  assert.deepEqual(row.source_family_candidates, []);
  assert.deepEqual(row.official_search_actions, []);
  assert.ok(
    row.source_search_blockers.includes("broad_platform_story_requires_specific_visual_plan"),
  );
});

test("Studio V4 source-family acquisition rejects specific game footage for broad platform stories", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "xbox-feedback-gap",
        title: "Xbox Fans Used Feedback To Demand Exclusives",
        canonical_subject: "Xbox",
        canonical_company: "Microsoft",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
      }),
    ],
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "forza-official-x-fh6-accessibility-video",
          display_name: "Forza Horizon official X - FH6 Accessibility video",
          source_family: "forza_horizon_official_x_fh6_accessibility_video",
          source_tier: "official",
          source_url:
            "https://video.twimg.com/amplify_video/2017238384930918400/vid/avc1/1280x720/iAH7hRim4lDKc7Ym.mp4?tag=14",
          reference_url: "https://x.com/ForzaHorizon/status/2017238596088943035",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entities: ["Forza Horizon 6", "Xbox Game Studios", "Xbox"],
        },
      ],
      story_candidates: [],
    },
    referenceReport: { plans: [] },
  });

  const row = report.rows[0];
  assert.equal(row.primary_story_entity, "Xbox");
  assert.deepEqual(row.source_family_candidates, []);
  assert.deepEqual(row.official_search_actions, []);
  assert.ok(
    row.source_search_blockers.includes("broad_platform_story_requires_specific_visual_plan"),
  );
});

test("Studio V4 source-family acquisition filters planned searches to the canonical story entity", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "xbox-feedback-gap",
        title: "Xbox Fans Used Feedback To Demand Exclusives",
        canonical_subject: "Xbox",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
      }),
    ],
    trustedFootageReport: { accepted_sources: [], story_candidates: [] },
    referenceReport: {
      plans: [
        {
          story_id: "xbox-feedback-gap",
          title: "Xbox Fans Used Feedback To Demand Exclusives",
          planned_searches: [
            { query: "PlayStation official trailer", entity: "PlayStation" },
            { query: "Nintendo gameplay", entity: "Nintendo" },
            { query: "Xbox Exclusives official gameplay trailer", entity: "Xbox Exclusives" },
            { query: "Xbox Player Voice official source", entity: "Xbox" },
          ],
        },
      ],
    },
  });

  const queries = report.rows[0].official_search_actions.map((action) => action.query);
  assert.deepEqual(queries, ["Xbox Player Voice official source"]);
});

test("Studio V4 source-family acquisition surfaces official search actions without faking candidates", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
      }),
    ],
    trustedFootageReport: { story_candidates: [], accepted_sources: [] },
    referenceReport: {
      plans: [
        {
          story_id: "forza-gap",
          title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
          target_entities: ["Forza Horizon 6"],
          motion_reference_readiness: "official_search_required",
          planned_searches: [
            {
              query: "Forza Horizon 6 gameplay trailer",
              entity: "Forza Horizon 6",
              accepted_sources: ["Steam", "official publisher channel", "platform storefront"],
              will_download: false,
            },
          ],
        },
      ],
    },
  });

  const row = report.rows[0];
  assert.deepEqual(row.source_family_candidates, []);
  assert.deepEqual(row.official_search_actions, [
    {
      query: "Forza Horizon 6 gameplay trailer",
      entity: "Forza Horizon 6",
      accepted_sources: ["Steam", "official publisher channel", "platform storefront"],
      will_download: false,
      status: "official_search_required",
    },
  ]);
  assert.equal(report.no_dead_end_blockers, true);
  assert.equal(report.summary.official_search_actions, 1);
  assert.equal(report.source_intake_template.entries.length, 0);
  assert.equal(
    row.safe_next_commands[0].step,
    "fill_official_source_intake_from_search_template",
  );
  assert.match(
    row.safe_next_commands[0].command,
    /visual_v4_official_search_template\.json/,
  );
  assert.doesNotMatch(
    row.safe_next_commands[0].command,
    /media:discover-direct-media/,
  );
  assert.equal(row.safe_next_commands[1].step, "validate_operator_supplied_official_sources");
  assert.match(
    row.safe_next_commands[1].command,
    /--input test\/output\/visual_v4_source_family_intake_template\.json/,
  );
  assert.deepEqual(report.official_search_template.entries, [
    {
      story_id: "forza-gap",
      entity: "Forza Horizon 6",
      query: "Forza Horizon 6 gameplay trailer",
      accepted_sources: ["Steam", "official publisher channel", "platform storefront"],
      will_download: false,
      status: "official_search_required",
      downloads_allowed: false,
      candidate_generation_policy: "search_action_only_not_render_candidate",
      next_step:
        "Find an official, storefront, publisher or platform-holder page, then rerun trusted footage/direct media intake.",
    },
  ]);
});

test("Studio V4 source-family acquisition carries dead-end work-order blockers", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "image-post-dead-end",
        title: "Capturing Has One Player Question",
        canonical_subject: "Capturing",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
      }),
    ],
    trustedFootageReport: { story_candidates: [], accepted_sources: [] },
    referenceReport: { plans: [] },
    directVideoEnrichmentWorkOrder: {
      jobs: [
        {
          story_id: "image-post-dead-end",
          status: "blocked_on_render_inputs",
          blockers: [
            "public_copy_repair_required",
            "source_label_consistency_repair_required",
          ],
          actions: [
            {
              status: "reject_recommended",
              repair_lane: "reject_or_human_review_non_news_image_post",
              dead_end_blocker: true,
              operator_approval_required: true,
            },
          ],
        },
      ],
    },
  });

  assert.equal(report.no_dead_end_blockers, false);
  assert.equal(report.summary.dead_end_blocker_entries, 1);
  assert.equal(report.summary.reject_recommended_entries, 1);
  assert.equal(report.summary.operator_required_entries, 1);
  assert.equal(report.acquisition_runway.dead_end_blocker_rows, 1);
  assert.equal(report.acquisition_runway.reject_recommended_rows, 1);

  const row = report.rows[0];
  assert.equal(row.render_input_dead_end_blocker, true);
  assert.equal(row.render_input_operator_required, true);
  assert.equal(row.render_input_reject_recommended, true);
  assert.deepEqual(row.render_input_blockers, [
    "public_copy_repair_required",
    "source_label_consistency_repair_required",
  ]);
  assert.deepEqual(row.render_input_repair_lanes, ["reject_or_human_review_non_news_image_post"]);
});

test("Studio V4 source-family acquisition extracts a game entity from a messy source-led title", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "oblivion-gap",
        title: "It's been a year since release and Oblivion Remastered is still broken- Digital Foundry",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
      }),
    ],
    trustedFootageReport: { story_candidates: [], accepted_sources: [] },
    referenceReport: { plans: [] },
  });

  const row = report.rows[0];
  assert.equal(row.primary_story_entity, "Oblivion Remastered");
  assert.equal(report.no_dead_end_blockers, true);
  assert.deepEqual(row.official_search_actions, [
    {
      query: "Oblivion Remastered official gameplay trailer",
      entity: "Oblivion Remastered",
      accepted_sources: ["Steam", "official publisher channel", "platform storefront"],
      will_download: false,
      status: "official_search_required",
    },
  ]);
  assert.equal(report.official_search_template.entries[0].entity, "Oblivion Remastered");
});

test("Studio V4 source-family acquisition does not attach global accepted sources when the story entity is unknown", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "state-of-play-gap",
        title: "State of Play returns Tuesday, June 2",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
      }),
    ],
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "forza-official-x-fh6-coast-video",
          display_name: "Forza Horizon official X - FH6 Coast video",
          source_family: "forza_horizon_official_x_fh6_coast_video",
          source_tier: "official",
          source_url:
            "https://video.twimg.com/amplify_video/2020858232789487616/vid/avc1/1280x720/h2mPH2YV-GPuJ6Q9.mp4?tag=14",
          reference_url: "https://x.com/ForzaHorizon/status/2020858359071617098",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entities: ["Forza Horizon 6", "Forza"],
        },
      ],
      story_candidates: [],
    },
    referenceReport: {
      plans: [
        {
          story_id: "state-of-play-gap",
          title: "State of Play returns Tuesday, June 2",
          target_entities: [],
          motion_reference_readiness: "official_search_required",
          planned_searches: [
            {
              query: "State of Play June 2 official PlayStation stream",
              entity: "State of Play",
              accepted_sources: ["PlayStation official channel", "PlayStation Blog"],
              will_download: false,
            },
          ],
        },
      ],
    },
  });

  const row = report.rows[0];
  assert.deepEqual(row.source_family_candidates, []);
  assert.deepEqual(row.official_search_actions, [
    {
      query: "State of Play June 2 official PlayStation stream",
      entity: "State of Play",
      accepted_sources: ["PlayStation official channel", "PlayStation Blog"],
      will_download: false,
      status: "official_search_required",
    },
  ]);
  assert.equal(report.no_dead_end_blockers, true);
  assert.equal(report.official_search_template.entries[0].query, "State of Play June 2 official PlayStation stream");
  assert.equal(report.source_intake_template.entries.length, 0);
});

test("Studio V4 source-family acquisition does not inherit title-decoy source families", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "subnautica-gap",
        title: "After Forza Horizon 6, Now Subnautica 2 Has Reportedly Leaked 48 Hours Ahead of Launch",
        clips: [
          {
            id: "subnautica-steam-window",
            entity: "Subnautica 2",
            source_family: "steam_1962700_1381761660",
            path: "https://video.akamai.steamstatic.com/store_trailers/1962700/1381761660/clip.m3u8",
            source_url_kind: "hls_manifest",
            validated: true,
          },
        ],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 1,
          required_distinct_families: 4,
          available_distinct_families: 1,
        },
        trusted_source_pipeline: {
          references_found: 2,
          intake_queue: [
            {
              source_id: "forza-x",
              display_name: "Forza Horizon official X - FH6 Accessibility video",
              entity: "Forza Horizon 6",
              entities: ["Forza Horizon 6", "Forza", "Playground Games"],
              source_family: "forza_horizon_official_x_fh6_accessibility_video",
              source_tier: "official",
              source_url:
                "https://video.twimg.com/amplify_video/2017238384930918400/vid/avc1/1280x720/iAH7hRim4lDKc7Ym.mp4?tag=14",
              reference_url: "https://x.com/ForzaHorizon/status/2017238596088943035",
              source_url_kind: "direct_video",
              segment_validation_eligible: true,
              allowed_render_use: "reference_only_by_default",
              rights_risk_class: "official_reference_only",
            },
          ],
        },
      }),
    ],
    trustedFootageReport: { story_candidates: [], accepted_sources: [] },
    referenceReport: { plans: [] },
  });

  const row = report.rows[0];
  assert.equal(row.primary_story_entity, "Subnautica 2");
  assert.deepEqual(row.source_family_candidates, []);
  assert.equal(row.official_search_actions[0].query, "Subnautica 2 official gameplay trailer");
  assert.equal(report.source_intake_template.entries.length, 0);
});

test("Studio V4 source-family acquisition hydrates raw motion packs from canonical package manifests", () => {
  const hydrated = hydrateMotionPacksWithCanonicalManifests(
    [
      motionPack({
        story_id: "expanse-gap",
        title: null,
        canonical_subject: "",
        canonical_game: "",
        clips: [],
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
      }),
    ],
    new Map([
      [
        "expanse-gap",
        {
          story_id: "expanse-gap",
          selected_title: "The Expanse Shows Real Gameplay",
          canonical_subject: "The Expanse: Osiris Reborn",
          canonical_game: "The Expanse: Osiris Reborn",
          canonical_company: "Owlcat Games",
        },
      ],
    ]),
  );
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: hydrated,
    trustedFootageReport: { story_candidates: [], accepted_sources: [] },
    referenceReport: { plans: [] },
  });

  const row = report.rows[0];
  assert.equal(hydrated[0].title, "The Expanse Shows Real Gameplay");
  assert.equal(hydrated[0].canonical_subject, "The Expanse: Osiris Reborn");
  assert.equal(row.primary_story_entity, "The Expanse: Osiris Reborn");
  assert.equal(row.official_search_actions[0].entity, "The Expanse: Osiris Reborn");
  assert.equal(
    row.official_search_actions[0].query,
    "The Expanse: Osiris Reborn official gameplay trailer",
  );
});

test("Studio V4 source-family acquisition markdown and CLI are operator-safe", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [motionPack()],
    trustedFootageReport: trustedReport(),
    referenceReport: referenceReport(),
  });
  const markdown = renderStudioV4SourceFamilyAcquisitionMarkdown(report);
  const args = parseArgs([
    "node",
    "tools/studio-v4-source-family-acquisition.js",
    "--story-id",
    "forza-gap",
    "--story-id",
    "extra-gap",
    "--story-ids",
    "third-gap,fourth-gap",
    "--motion-pack",
    "output/studio-v4/motion-packs/forza-gap_motion_pack_manifest.json",
    "--search-template",
    "test/output/custom_official_search_template.json",
    "--governed-visual-plan-template",
    "test/output/custom_governed_visual_plan_template.json",
    "--story-packages",
    "output/goal-contract/production_cutover_story_packages.json",
    "--work-order",
    "output/goal-contract/render_input_work_order.json",
    "--reference-report",
    "output/goal-contract/official_trailer_references_a.json",
    "--reference-report",
    "output/goal-contract/official_trailer_references_b.json",
  ]);

  assert.match(markdown, /Visual V4 Source-Family Acquisition/);
  assert.match(markdown, /No downloads, DB mutation, OAuth or posting/);
  assert.doesNotMatch(markdown, /--merge-previous/);
  for (const command of report.rows[0].safe_next_commands.map((item) => item.command)) {
    assert.doesNotMatch(command, /--merge-previous/);
  }
  assert.equal(args.storyId, "forza-gap");
  assert.deepEqual(args.storyIds, ["forza-gap", "extra-gap", "third-gap", "fourth-gap"]);
  assert.equal(args.searchTemplate, "test/output/custom_official_search_template.json");
  assert.equal(
    args.governedVisualPlanTemplate,
    "test/output/custom_governed_visual_plan_template.json",
  );
  assert.equal(args.storyPackages, "output/goal-contract/production_cutover_story_packages.json");
  assert.equal(args.workOrder, "output/goal-contract/render_input_work_order.json");
  assert.deepEqual(args.referenceReports, [
    "output/goal-contract/official_trailer_references_a.json",
    "output/goal-contract/official_trailer_references_b.json",
  ]);
  assert.equal(report.no_dead_end_blockers, true);
  assert.ok(report.acquisition_runway.next_action);
  assert.match(
    packageJson.scripts["ops:v4-source-family-acquisition"],
    /studio-v4-source-family-acquisition\.js/,
  );
});

test("Studio V4 source-family acquisition CLI uses the live direct-video work order by default", () => {
  const root = path.join(__dirname, "..", "..");
  const args = parseArgs(["node", "tools/studio-v4-source-family-acquisition.js"]);

  assert.equal(
    args.workOrder,
    path.join(root, "output", "goal-contract", "direct_video_enrichment_work_order.json"),
  );
  assert.equal(
    args.storyPackages,
    path.join(root, "output", "goal-contract", "production_cutover_story_packages.json"),
  );
});

test("Studio V4 source-family acquisition CLI derives template paths from explicit output JSON", () => {
  const args = parseArgs([
    "node",
    "tools/studio-v4-source-family-acquisition.js",
    "--output-json",
    "output/goal-contract/studio_v4_source_family_acquisition_remaining.json",
  ]);
  const commandPaths = commandPathsFromArgs(args);
  const goalContractDir = path.join("output", "goal-contract");

  assert.equal(
    args.intakeTemplate,
    path.join(goalContractDir, "visual_v4_source_family_intake_template.json"),
  );
  assert.equal(
    args.searchTemplate,
    path.join(goalContractDir, "visual_v4_official_search_template.json"),
  );
  assert.equal(
    args.governedVisualPlanTemplate,
    path.join(goalContractDir, "visual_v4_governed_visual_plan_template.json"),
  );
  assert.equal(
    args.canonicalEntityRepairTemplate,
    path.join(goalContractDir, "visual_v4_canonical_entity_repair_template.json"),
  );
  assert.equal(
    commandPaths.sourceFamilyIntakeTemplate,
    "output/goal-contract/visual_v4_source_family_intake_template.json",
  );
});

test("Studio V4 source-family acquisition CLI filters repeatable story IDs before writing reports", async () => {
  const root = path.join(__dirname, "..", "..");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-source-family-"));
  try {
    const packDir = path.join(tempDir, "packs");
    await fs.ensureDir(packDir);
    const stories = ["blocked-a", "blocked-b", "blocked-c"];
    const packs = [];
    for (const storyId of stories) {
      const packPath = path.join(packDir, `${storyId}.json`);
      await fs.writeJson(
        packPath,
        motionPack({
          story_id: storyId,
          title: `${storyId} Game Trailer Needs Motion`,
          canonical_subject: `${storyId} Game`,
          canonical_game: `${storyId} Game`,
          clips: [],
          motion_budget: {
            required_motion_scenes: 5,
            available_motion_clips: 0,
            required_distinct_families: 4,
            available_distinct_families: 0,
          },
          trusted_source_pipeline: { references_found: 0, intake_queue: [] },
        }),
        { spaces: 2 },
      );
      packs.push({ story_id: storyId, manifest_path: packPath });
    }

    const indexPath = path.join(tempDir, "visual_v4_motion_packs.json");
    const workOrderPath = path.join(tempDir, "render_input_work_order.json");
    const outputJson = path.join(tempDir, "source_family.json");
    const outputMd = path.join(tempDir, "source_family.md");
    const intakeTemplate = path.join(tempDir, "intake.json");
    const searchTemplate = path.join(tempDir, "search.json");
    const governedVisualPlanTemplate = path.join(tempDir, "governed-visual-plan.json");
    await fs.writeJson(indexPath, { packs }, { spaces: 2 });
    await fs.writeJson(
      workOrderPath,
      { jobs: stories.map((story_id) => ({ story_id })) },
      { spaces: 2 },
    );

    execFileSync(
      process.execPath,
      [
        path.join(root, "tools", "studio-v4-source-family-acquisition.js"),
        "--motion-pack-index",
        indexPath,
        "--work-order",
        workOrderPath,
        "--story-id",
        "blocked-a",
        "--story-id",
        "blocked-c",
        "--output-json",
        outputJson,
        "--output-md",
        outputMd,
        "--intake-template",
        intakeTemplate,
        "--search-template",
        searchTemplate,
        "--governed-visual-plan-template",
        governedVisualPlanTemplate,
      ],
      {
        cwd: root,
        env: { ...process.env, PULSE_SKIP_DOTENV: "true" },
        stdio: "pipe",
      },
    );

    const report = await fs.readJson(outputJson);
    assert.deepEqual(
      report.rows.map((row) => row.story_id),
      ["blocked-a", "blocked-c"],
    );
    assert.equal(report.summary.stories_blocked, 2);
    assert.ok(!(await fs.readJson(searchTemplate)).some((entry) => entry.story_id === "blocked-b"));
    assert.ok(!(await fs.readJson(governedVisualPlanTemplate)).some((entry) => entry.story_id === "blocked-b"));
  } finally {
    await fs.remove(tempDir);
  }
});

test("Studio V4 source-family acquisition CLI writes runnable next commands for custom templates", async () => {
  const root = path.join(__dirname, "..", "..");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-source-family-paths-"));
  try {
    const packDir = path.join(tempDir, "packs");
    await fs.ensureDir(packDir);
    const packs = [
      motionPack({
        story_id: "pokemon-go",
        title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
        canonical_subject: "Pokemon Go",
        canonical_game: "Pokemon Go",
        clips: [],
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
      }),
      motionPack({
        story_id: "kadokawa-stake",
        title: "Kadokawa Stake Just Passed Sony",
        canonical_subject: "Kadokawa Stake",
        canonical_game: "",
        clips: [],
        trusted_source_pipeline: { references_found: 0, intake_queue: [] },
        motion_budget: {
          required_motion_scenes: 5,
          available_motion_clips: 0,
          required_distinct_families: 4,
          available_distinct_families: 0,
        },
      }),
    ];
    const indexPacks = [];
    for (const pack of packs) {
      const packPath = path.join(packDir, `${pack.story_id}.json`);
      await fs.writeJson(packPath, pack, { spaces: 2 });
      indexPacks.push({ story_id: pack.story_id, manifest_path: packPath });
    }

    const indexPath = path.join(tempDir, "visual_v4_motion_packs.json");
    const outputJson = path.join(tempDir, "source_family.json");
    const outputMd = path.join(tempDir, "source_family.md");
    const intakeTemplate = path.join(tempDir, "custom-intake.json");
    const searchTemplate = path.join(tempDir, "custom-search.json");
    const governedVisualPlanTemplate = path.join(tempDir, "custom-governed-plan.json");
    await fs.writeJson(indexPath, { packs: indexPacks }, { spaces: 2 });

    execFileSync(
      process.execPath,
      [
        path.join(root, "tools", "studio-v4-source-family-acquisition.js"),
        "--motion-pack-index",
        indexPath,
        "--no-work-order",
        "--no-story-packages",
        "--output-json",
        outputJson,
        "--output-md",
        outputMd,
        "--intake-template",
        intakeTemplate,
        "--search-template",
        searchTemplate,
        "--governed-visual-plan-template",
        governedVisualPlanTemplate,
      ],
      {
        cwd: root,
        env: { ...process.env, PULSE_SKIP_DOTENV: "true" },
        stdio: "pipe",
      },
    );

    const report = await fs.readJson(outputJson);
    const rows = Object.fromEntries(report.rows.map((row) => [row.story_id, row]));
    const intakePath = intakeTemplate.replace(/\\/g, "/");
    const searchPath = searchTemplate.replace(/\\/g, "/");
    const governedPath = governedVisualPlanTemplate.replace(/\\/g, "/");
    const officialDirectMediaIntakePath = path
      .join(tempDir, "official_direct_media_intake_template.json")
      .replace(/\\/g, "/");
    const licensedDirectMediaReportPath = path
      .join(tempDir, "studio_v4_licensed_direct_media_acquisition.json")
      .replace(/\\/g, "/");
    const trustedFootageRegistryReportPath = path
      .join(tempDir, "trusted_footage_registry_report.json")
      .replace(/\\/g, "/");
    const segmentValidationReportPath = path
      .join(tempDir, "official_trailer_segment_validation_apply_local.json")
      .replace(/\\/g, "/");

    assert.match(rows["pokemon-go"].safe_next_commands[0].command, new RegExp(searchPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(rows["pokemon-go"].safe_next_commands[0].command, new RegExp(intakePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(rows["pokemon-go"].safe_next_commands[1].command, new RegExp(intakePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(
      rows["kadokawa-stake"].safe_next_commands[0].command,
      new RegExp(governedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    const directMediaStory = buildStudioV4SourceFamilyAcquisitionReport({
      motionPackReports: [motionPack()],
      trustedFootageReport: trustedReport(),
      referenceReport: referenceReport(),
      commandPaths: {
        sourceFamilyIntakeTemplate: intakePath,
        officialDirectMediaIntakeTemplate: officialDirectMediaIntakePath,
        licensedDirectMediaReport: licensedDirectMediaReportPath,
        trustedFootageRegistryReport: trustedFootageRegistryReportPath,
        segmentValidationReport: segmentValidationReportPath,
      },
    }).rows[0];
    assert.match(
      directMediaStory.safe_next_commands[0].command,
      /--output-template /,
    );
    assert.match(
      directMediaStory.safe_next_commands[0].command,
      new RegExp(officialDirectMediaIntakePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.match(
      directMediaStory.safe_next_commands[1].command,
      new RegExp(officialDirectMediaIntakePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    const resolveCommand = directMediaStory.safe_next_commands.find(
      (item) => item.step === "resolve_trailer_references",
    ).command;
    assert.match(
      resolveCommand,
      new RegExp(licensedDirectMediaReportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.match(
      resolveCommand,
      new RegExp(trustedFootageRegistryReportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.match(
      resolveCommand,
      new RegExp(segmentValidationReportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.doesNotMatch(resolveCommand, /test\/output/);
    assert.doesNotMatch(
      JSON.stringify(report.rows.flatMap((row) => row.safe_next_commands)),
      /test\/output\/visual_v4_/,
    );
  } finally {
    await fs.remove(tempDir);
  }
});

test("Studio V4 source-family acquisition merges repeatable trailer reference reports", () => {
  const merged = mergeReferenceReports([
    {
      generated_at: "2026-05-24T01:00:00.000Z",
      plans: [
        {
          story_id: "story-a",
          references: [{ source_url: "https://video.example/a.m3u8" }],
        },
      ],
    },
    {
      generated_at: "2026-05-24T01:01:00.000Z",
      plans: [
        {
          story_id: "story-b",
          references: [{ source_url: "https://video.example/b.m3u8" }],
        },
      ],
    },
  ]);

  assert.equal(merged.plans.length, 2);
  assert.deepEqual(
    merged.plans.map((plan) => plan.story_id),
    ["story-a", "story-b"],
  );
  assert.equal(merged.merged_reference_report_count, 2);
});

test("Studio V4 source-family acquisition blocks official search from malformed or generic story entities", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "bad-subject",
        title: "Capturing Has One Player Question",
        canonical_subject: "Capturing",
        canonical_game: "",
      }),
      motionPack({
        story_id: "malformed-subject",
        title: "Super Mario RPG GameStop, Just Got More Expensive",
        canonical_subject: "Super Mario RPG GameStop,",
        canonical_game: "",
      }),
    ],
    trustedFootageReport: { story_candidates: [] },
    referenceReport: { plans: [] },
  });

  assert.equal(report.no_dead_end_blockers, true);
  assert.deepEqual(report.rows[0].official_search_actions, []);
  assert.ok(report.rows[0].source_search_blockers.includes("generic_gerund_primary_entity"));
  assert.equal(report.rows[0].safe_next_commands[0].step, "repair_canonical_entity");
  assert.match(
    report.rows[0].safe_next_commands[0].command,
    /ops:goal-public-copy-repair/,
  );
  assert.equal(report.rows[1].official_search_actions[0].entity, "Super Mario RPG");
  assert.ok(report.rows[1].canonical_entity_repair_blockers.includes("malformed_primary_entity"));
  assert.equal(report.summary.official_search_actions, 1);
  assert.equal(report.summary.canonical_entity_repair_entries, 2);
  assert.ok(
    report.canonical_entity_repair_template.entries.some(
      (entry) =>
        entry.story_id === "malformed-subject" &&
        entry.repair_lane === "canonical_entity_repair" &&
        entry.operator_approval_required === true,
    ),
  );
});

test("Studio V4 source-family acquisition avoids fake gameplay searches for non-game stories", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "ps5-price",
        title: "PS5 Price Hike Rumour Hits Europe",
        canonical_subject: "PS5",
        canonical_game: "",
        trusted_source_pipeline: { intake_queue: [] },
        clips: [],
        motion_budget: {
          required_motion_scenes: 7,
          available_motion_clips: 0,
          required_distinct_families: 6,
          available_distinct_families: 0,
        },
      }),
      motionPack({
        story_id: "kadokawa-stake",
        title: "Kadokawa Stake Just Passed Sony",
        canonical_subject: "Kadokawa Stake",
        canonical_game: "",
        trusted_source_pipeline: { intake_queue: [] },
        clips: [],
        motion_budget: {
          required_motion_scenes: 7,
          available_motion_clips: 0,
          required_distinct_families: 6,
          available_distinct_families: 0,
        },
      }),
      motionPack({
        story_id: "nintendo-lawsuit",
        title: "Nintendo Professor Lawsuit Just Got Weird",
        canonical_subject: "Nintendo Professor Lawsuit",
        canonical_game: "",
        trusted_source_pipeline: { intake_queue: [] },
        clips: [],
        motion_budget: {
          required_motion_scenes: 7,
          available_motion_clips: 0,
          required_distinct_families: 6,
          available_distinct_families: 0,
        },
      }),
      motionPack({
        story_id: "pokemon-go",
        title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
        canonical_subject: "Pokemon Go",
        canonical_game: "Pokemon Go",
        trusted_source_pipeline: { intake_queue: [] },
        clips: [],
        motion_budget: {
          required_motion_scenes: 7,
          available_motion_clips: 0,
          required_distinct_families: 6,
          available_distinct_families: 0,
        },
      }),
    ],
    generatedAt: "2026-05-24T01:45:00.000Z",
  });

  const rows = Object.fromEntries(report.rows.map((row) => [row.story_id, row]));
  assert.match(rows["ps5-price"].official_search_actions[0].query, /official product video/i);
  assert.doesNotMatch(rows["ps5-price"].official_search_actions[0].query, /gameplay/i);
  assert.equal(rows["ps5-price"].governed_visual_plan.plan_type, "platform_product_visual_plan");
  assert.equal(rows["ps5-price"].governed_visual_plan.operator_approval_required, true);
  assert.equal(rows["ps5-price"].governed_visual_plan.counts_towards_motion_readiness, false);
  assert.ok(
    rows["ps5-price"].governed_visual_plan.prohibited_asset_classes.includes(
      "unrelated gameplay footage",
    ),
  );
  assert.ok(
    report.governed_visual_plan_template.entries.some(
      (entry) =>
        entry.story_id === "ps5-price" &&
        entry.plan_type === "platform_product_visual_plan" &&
        entry.operator_approval_required === true,
    ),
  );
  assert.deepEqual(rows["kadokawa-stake"].official_search_actions, []);
  assert.ok(
    rows["kadokawa-stake"].source_search_blockers.includes(
      "corporate_transaction_requires_owned_explainer_visual_plan",
    ),
  );
  assert.equal(
    rows["kadokawa-stake"].governed_visual_plan.plan_type,
    "corporate_transaction_owned_explainer_plan",
  );
  assert.ok(
    rows["kadokawa-stake"].governed_visual_plan.allowed_source_classes.includes(
      "official investor relations source",
    ),
  );
  assert.ok(
    !rows["kadokawa-stake"].governed_visual_plan.allowed_source_classes.includes(
      "platform storefront",
    ),
  );
  assert.ok(
    rows["kadokawa-stake"].governed_visual_plan.required_artefacts.includes(
      "non_discovery_primary_source_intake_report.json",
    ),
  );
  assert.equal(rows["kadokawa-stake"].safe_next_commands[0].step, "approve_governed_visual_plan");
  assert.match(
    rows["kadokawa-stake"].safe_next_commands[0].command,
    /visual_v4_governed_visual_plan_template\.json/,
  );
  assert.equal(rows["kadokawa-stake"].safe_next_commands[1].step, "rerun_source_family_acquisition");
  assert.deepEqual(rows["nintendo-lawsuit"].official_search_actions, []);
  assert.ok(
    rows["nintendo-lawsuit"].source_search_blockers.includes(
      "legal_story_requires_source_card_or_human_visual_plan",
    ),
  );
  assert.match(rows["pokemon-go"].official_search_actions[0].query, /official trailer/i);
  assert.doesNotMatch(rows["pokemon-go"].official_search_actions[0].query, /official gameplay trailer/i);

  const markdown = renderStudioV4SourceFamilyAcquisitionMarkdown(report);
  assert.match(markdown, /kadokawa-stake .*approve_governed_visual_plan/);
  assert.match(markdown, /pokemon-go .*fill_official_source_intake_from_search_template/);
});

test("Studio V4 source-family acquisition stops suggesting governed visual plans after owned explainer decks fail benchmark", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "kadokawa-stake",
        title: "Kadokawa Stake Just Passed Sony",
        canonical_subject: "Kadokawa Stake",
        canonical_game: "",
        trusted_source_pipeline: { intake_queue: [] },
        clips: [],
        motion_budget: {
          required_motion_scenes: 7,
          available_motion_clips: 0,
          required_distinct_families: 6,
          available_distinct_families: 0,
        },
      }),
    ],
    directVideoEnrichmentWorkOrder: {
      jobs: [
        {
          story_id: "kadokawa-stake",
          actions: [
            {
              repair_lane: "real_visual_media_required_after_owned_explainer_deck_failed_benchmark",
              action_id: "materialise_validated_real_motion_clips",
            },
          ],
          blockers: [
            "visual_evidence:generated_only_motion_deck",
            "visual_evidence:no_real_visual_media_asset",
          ],
        },
      ],
    },
    generatedAt: "2026-05-27T18:25:00.000Z",
  });

  const row = report.rows[0];
  assert.equal(row.real_visual_media_required_after_owned_explainer_failed, true);
  assert.equal(row.governed_visual_plan, null);
  assert.equal(report.summary.governed_visual_plan_entries, 0);
  assert.equal(report.summary.real_visual_or_human_review_entries, 1);
  assert.equal(report.no_dead_end_blockers, true);
  assert.equal(report.acquisition_runway.status, "real_visual_media_or_human_review_required");
  assert.equal(row.safe_next_commands[0].step, "supply_rights_backed_real_visual_media");
  assert.equal(row.safe_next_commands[1].step, "route_to_human_review_or_reject");

  const markdown = renderStudioV4SourceFamilyAcquisitionMarkdown(report);
  assert.doesNotMatch(markdown, /approve_governed_visual_plan/);
  assert.match(markdown, /supply_rights_backed_real_visual_media/);
});

test("Studio V4 source-family acquisition normalises mojibake in source repair templates", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "pokemon-go-mojibake",
        title: "Mega Mewtwo Is Finally Coming To Pok\u00c3\u00a9mon Go",
        canonical_subject: "Pok\u00c3\u00a9mon Go",
        canonical_game: "Pok\u00c3\u00a9mon Go",
        trusted_source_pipeline: { intake_queue: [] },
        clips: [],
        motion_budget: {
          required_motion_scenes: 7,
          available_motion_clips: 0,
          required_distinct_families: 6,
          available_distinct_families: 0,
        },
      }),
    ],
    generatedAt: "2026-05-26T14:10:00.000Z",
  });

  const row = report.rows[0];
  const searchEntry = report.official_search_template.entries[0];
  const governedPlan = report.governed_visual_plan_template.entries[0];
  assert.equal(row.primary_story_entity, "Pok\u00e9mon Go");
  assert.equal(row.official_search_actions[0].entity, "Pok\u00e9mon Go");
  assert.equal(row.official_search_actions[0].query, "Pok\u00e9mon Go official trailer");
  assert.equal(searchEntry.entity, "Pok\u00e9mon Go");
  assert.equal(searchEntry.query, "Pok\u00e9mon Go official trailer");
  assert.equal(governedPlan.entity, "Pok\u00e9mon Go");
  assert.doesNotMatch(JSON.stringify(report), /Pok\u00c3|Ã|Â/);
});

test("Studio V4 source-family acquisition blocks product subject mismatches before source search", () => {
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: [
      motionPack({
        story_id: "steam-controller-date",
        title: "Steam Controller Date May Have Leaked",
        canonical_subject: "Steam Deck",
        canonical_game: "Steam Deck",
        trusted_source_pipeline: { intake_queue: [] },
        clips: [],
        motion_budget: {
          required_motion_scenes: 7,
          available_motion_clips: 0,
          required_distinct_families: 6,
          available_distinct_families: 0,
        },
      }),
    ],
    generatedAt: "2026-05-24T02:10:00.000Z",
  });

  const row = report.rows[0];
  assert.equal(row.primary_story_entity, "Steam Deck");
  assert.equal(row.official_search_actions[0].entity, "Steam Controller");
  assert.ok(row.canonical_entity_repair_blockers.includes("canonical_subject_title_mismatch"));
  assert.equal(report.canonical_entity_repair_template.entries[0].suggested_repaired_entity, "Steam Controller");
});
