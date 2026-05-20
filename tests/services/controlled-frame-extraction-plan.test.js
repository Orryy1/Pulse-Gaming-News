"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildControlledFrameExtractionPlan,
  buildControlledFrameExtractionReport,
  renderControlledFrameExtractionMarkdown,
} = require("../../lib/controlled-frame-extraction-plan");
const {
  shouldRebuildMotionPlansFromReferences,
} = require("../../tools/controlled-frame-extraction-plan");

function reference(entity, index = 1, extra = {}) {
  return {
    provider: "steam",
    source_type: "steam_movie",
    source_url: `https://video.example/${entity.toLowerCase()}-${index}.m3u8`,
    entity,
    movie_name: `${entity} Official Trailer ${index}`,
    rights_risk_class: "storefront_promotional_video",
    allowed_render_use: "reference_only_by_default",
    downloads_allowed: false,
    ...extra,
  };
}

function motionPlan(overrides = {}) {
  return {
    story_id: "frame-story",
    title: "Take-Two story mentions GTA, Red Dead and BioShock",
    motion_readiness: "reference_ready_for_local_frame_plan",
    existing_references: [
      reference("GTA"),
      reference("Red Dead"),
      reference("BioShock"),
    ],
    counts: { total_clips: 0, trailer_extracted_frames: 0 },
    ...overrides,
  };
}

test("Controlled Frame Extraction Plan is report-only and never enables downloads", () => {
  const plan = buildControlledFrameExtractionPlan(motionPlan());

  assert.equal(plan.execution_mode, "report_only");
  assert.equal(plan.will_download, false);
  assert.equal(plan.will_extract_frames, false);
  assert.equal(plan.safety.video_downloads, false);
  assert.equal(plan.safety.frame_extraction, false);
});

test("Controlled Frame Extraction Plan selects frames across unique exact entities", () => {
  const plan = buildControlledFrameExtractionPlan(motionPlan());

  assert.equal(plan.frame_plan_readiness, "frame_plan_ready");
  assert.equal(plan.selected_references.length, 3);
  assert.deepEqual(
    plan.selected_references.map((item) => item.entity),
    ["GTA", "Red Dead", "BioShock"],
  );
  assert.equal(plan.target_frames.length, 12);
  assert.ok(plan.target_frames.every((frame) => frame.downloads_allowed === false));
});

test("Controlled Frame Extraction Plan interleaves safe non-intro probe points across sources", () => {
  const plan = buildControlledFrameExtractionPlan(motionPlan());
  const firstSix = plan.target_frames.slice(0, 6).map((frame) => ({
    entity: frame.entity,
    percent: frame.target_time_percent,
    sampleOrder: frame.sample_order,
    strategy: frame.sampling_strategy,
  }));

  assert.deepEqual(firstSix, [
    {
      entity: "GTA",
      percent: 0.42,
      sampleOrder: 1,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
    {
      entity: "Red Dead",
      percent: 0.42,
      sampleOrder: 2,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
    {
      entity: "BioShock",
      percent: 0.42,
      sampleOrder: 3,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
    {
      entity: "GTA",
      percent: 0.58,
      sampleOrder: 4,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
    {
      entity: "Red Dead",
      percent: 0.58,
      sampleOrder: 5,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
    {
      entity: "BioShock",
      percent: 0.58,
      sampleOrder: 6,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
  ]);
  assert.ok(plan.target_frames.every((frame) => frame.target_time_percent >= 0.42));
});

test("Controlled Frame Extraction Plan moves known-duration frame targets out of rating-card window", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      existing_references: [
        reference("GTA", 1, {
          source_duration_s: 50,
        }),
        reference("Red Dead", 1, {
          source_duration_s: 50,
        }),
      ],
    }),
  );

  assert.ok(plan.target_frames.every((frame) => frame.target_time_seconds >= 24));
  assert.ok(
    plan.target_frames
      .filter((frame) => frame.target_time_percent === 0.42)
      .every((frame) =>
      frame.sampling_rejections.some((item) => item.reason === "intro_or_rating_card_window"),
    ),
  );
});

test("Controlled Frame Extraction Plan does not retry previously rejected bad frame windows", () => {
  const previousFrameExtractionReport = {
    plans: [
      {
        story_id: "frame-story",
        frames: [
          {
            source_url: "https://video.example/gta-1.m3u8",
            source_type: "steam_movie",
            entity: "GTA",
            target_time_percent: 0.42,
            target_time_seconds: 25.2,
            status: "rejected_qa",
            qa: { failures: ["title_or_rating_card_frame"] },
          },
        ],
      },
    ],
  };

  const plan = buildControlledFrameExtractionPlan(motionPlan(), {
    previousFrameExtractionReport,
  });

  assert.equal(
    plan.target_frames.some(
      (frame) =>
        frame.entity === "GTA" &&
        frame.source_url === "https://video.example/gta-1.m3u8" &&
        frame.target_time_percent === 0.42,
    ),
    false,
  );
  assert.equal(plan.skipped_previously_rejected_windows.length, 1);
  assert.deepEqual(plan.skipped_previously_rejected_windows[0].rejected_reasons, [
    "title_or_rating_card_frame",
  ]);
});

test("Controlled Frame Extraction Plan supports a max target frame cap", () => {
  const plan = buildControlledFrameExtractionPlan(motionPlan(), { maxTargetFrames: 5 });

  assert.equal(plan.target_frames.length, 5);
  assert.deepEqual(
    plan.target_frames.map((frame) => `${frame.entity}:${frame.target_time_percent}`),
    ["GTA:0.42", "Red Dead:0.42", "BioShock:0.42", "GTA:0.58", "Red Dead:0.58"],
  );
});

test("Controlled Frame Extraction Plan caps repeated same-entity references", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      existing_references: [
        reference("GTA", 1),
        reference("GTA", 2),
        reference("GTA", 3),
        reference("Red Dead", 1),
        reference("BioShock", 1),
      ],
    }),
  );

  assert.equal(plan.selected_references.length, 3);
  assert.equal(plan.selected_references.filter((item) => item.entity === "GTA").length, 1);
});

test("Controlled Frame Extraction Plan de-prioritises PEGI and rating-board trailer references", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      existing_references: [
        reference("GTA", 1, {
          movie_name: "GTA Official PEGI Rating Trailer",
        }),
        reference("GTA", 2, {
          movie_name: "GTA Gameplay Update Trailer",
        }),
        reference("Red Dead", 1),
        reference("BioShock", 1),
      ],
    }),
  );

  assert.equal(
    plan.selected_references.find((item) => item.entity === "GTA").movie_name,
    "GTA Gameplay Update Trailer",
  );
});

test("Controlled Frame Extraction Plan excludes localised and subtitle-labelled trailer references", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      existing_references: [
        reference("Red Dead", 1, {
          movie_name: "RDR2 60 FPS Trailer (DE)",
        }),
        reference("Red Dead", 2, {
          movie_name: "Red Dead Redemption 2 Gameplay Trailer",
        }),
        reference("BioShock", 1, {
          movie_name: "BioShock Infinite Launch Trailer Subtitles",
        }),
        reference("BioShock", 2, {
          movie_name: "BioShock Infinite Gameplay Trailer",
        }),
        reference("GTA", 1),
      ],
    }),
  );

  assert.equal(
    plan.selected_references.find((item) => item.entity === "Red Dead").movie_name,
    "Red Dead Redemption 2 Gameplay Trailer",
  );
  assert.equal(
    plan.selected_references.find((item) => item.entity === "BioShock").movie_name,
    "BioShock Infinite Gameplay Trailer",
  );
  assert.ok(!plan.target_frames.some((frame) => /\(DE\)|Subtitles/i.test(frame.movie_name || "")));
});

test("Controlled Frame Extraction Plan keeps YouTube and HTML official pages out of frame targets", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      existing_references: [
        reference("GTA", 1, {
          source_url: "https://www.youtube.com/watch?v=officialGta",
          source_type: "igdb_video",
          provider: "igdb",
          segment_validation_eligible: false,
        }),
        reference("Red Dead", 1, {
          source_url: "https://www.rockstargames.com/reddeadredemption2/videos",
          source_type: "official_trailer",
          provider: "official_intake",
          segment_validation_eligible: false,
        }),
        reference("BioShock", 1, {
          source_url: "https://video.example/bioshock-gameplay.m3u8",
        }),
      ],
    }),
  );

  assert.equal(plan.selected_references.length, 1);
  assert.equal(plan.selected_references[0].entity, "BioShock");
  assert.equal(plan.selected_references[0].source_url_kind, "hls_manifest");
  assert.equal(plan.selected_references[0].segment_validation_eligible, true);
  assert.ok(plan.target_frames.every((frame) => frame.segment_validation_eligible === true));
  assert.ok(!plan.target_frames.some((frame) => /youtube|rockstargames/i.test(frame.source_url || "")));
});

test("Controlled Frame Extraction Plan can include alternate official references for retry QA", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      existing_references: [
        reference("GTA", 1),
        reference("GTA", 2),
        reference("Red Dead", 1),
        reference("Red Dead", 2),
        reference("BioShock", 1),
      ],
    }),
    {
      maxReferences: 5,
      maxReferencesPerEntity: 2,
      maxTargetFrames: 10,
    },
  );

  assert.equal(plan.selected_references.length, 5);
  assert.deepEqual(
    plan.selected_references.map((item) => `${item.entity}:${item.movie_name}`),
    [
      "GTA:GTA Official Trailer 1",
      "Red Dead:Red Dead Official Trailer 1",
      "BioShock:BioShock Official Trailer 1",
      "GTA:GTA Official Trailer 2",
      "Red Dead:Red Dead Official Trailer 2",
    ],
  );
  assert.equal(plan.selected_references.filter((item) => item.entity === "Red Dead").length, 2);
  assert.equal(plan.exact_subject_motion_coverage.max_references_per_entity, 2);
  assert.equal(plan.target_frames.length, 10);
});

test("Controlled Frame Extraction Plan still caps alternates per entity", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      existing_references: [
        reference("GTA", 1),
        reference("GTA", 2),
        reference("GTA", 3),
        reference("Red Dead", 1),
        reference("BioShock", 1),
      ],
    }),
    {
      maxReferences: 5,
      maxReferencesPerEntity: 2,
    },
  );

  assert.equal(plan.selected_references.length, 4);
  assert.equal(plan.selected_references.filter((item) => item.entity === "GTA").length, 2);
  assert.ok(!plan.selected_references.some((item) => item.movie_name === "GTA Official Trailer 3"));
});

test("Controlled Frame Extraction Plan rejects stories without official references", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      motion_readiness: "official_reference_search_required",
      existing_references: [],
    }),
  );

  assert.equal(plan.frame_plan_readiness, "no_reference");
  assert.equal(plan.target_frames.length, 0);
  assert.ok(plan.blockers.includes("no_official_motion_reference"));
});

test("Controlled Frame Extraction Plan accepts trusted Steam storefront video references", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      story_id: "1tftq7f",
      existing_references: [
        {
          source_type: "steam_storefront_video_reference",
          provider: "trusted_footage_registry",
          source_url:
            "https://video.fastly.steamstatic.com/store_trailers/2483190/1133501958/clip.mp4",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entity: "Forza Horizon 6",
          movie_name: "Steam - Forza Horizon 6 launch trailer reference",
          downloads_allowed: false,
          source_duration_s: 58,
        },
      ],
    }),
    { maxReferences: 1, maxTargetFrames: 4 },
  );

  assert.notEqual(plan.frame_plan_readiness, "no_reference");
  assert.equal(plan.selected_references.length, 1);
  assert.equal(plan.target_frames.length, 4);
  assert.equal(plan.target_frames[0].source_type, "steam_storefront_video_reference");
});

test("Controlled Frame Extraction Plan accepts direct media discovered from official pages", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      story_id: "1tftq7f",
      existing_references: [
        {
          source_type: "official_publisher_or_developer_trailer_page",
          provider: "official_intake",
          source_url:
            "https://cdn.forza.net/strapi-uploads/assets/Forza_Horizon_6_Primary_Animated_Keyart.webm",
          reference_page_url: "https://forza.net/forzahorizon6/",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entity: "Forza Horizon 6",
          movie_name: "Forza Horizon 6 official reference",
          downloads_allowed: false,
          source_duration_s: 10,
        },
      ],
    }),
    { maxReferences: 1, maxTargetFrames: 4 },
  );

  assert.equal(plan.selected_references.length, 1);
  assert.equal(plan.target_frames.length, 4);
  assert.equal(plan.target_frames[0].source_type, "official_publisher_or_developer_trailer_page");
  assert.equal(plan.target_frames[0].segment_validation_eligible, true);
  assert.equal(plan.target_frames[0].target_time_seconds, 4.2);
  assert.equal(plan.target_frames[3].target_time_seconds, 8.8);
});

test("Controlled Frame Extraction Plan accepts official social direct media", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      story_id: "1tftq7f",
      existing_references: [
        {
          source_type: "official_social_media_video",
          provider: "trusted_footage_registry",
          source_url:
            "https://video-s.twimg.com/amplify_video/2021227162603339776/vid/avc1/1280x720/IbJGc42nnQTptud_.mp4?tag=14",
          reference_page_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entity: "Forza Horizon 6",
          movie_name: "Forza Horizon official X - FH6 Lowlands video",
          rights_risk_class: "official_reference_only",
          allowed_render_use: "reference_only_by_default",
          downloads_allowed: false,
          source_duration_s: 27.71,
        },
      ],
    }),
    { maxReferences: 1, maxTargetFrames: 4 },
  );

  assert.equal(plan.selected_references.length, 1);
  assert.equal(plan.target_frames.length, 4);
  assert.equal(plan.target_frames[0].source_type, "official_social_media_video");
  assert.equal(plan.target_frames[0].source_url_kind, "direct_video");
  assert.equal(plan.target_frames[0].downloads_allowed, false);
});

test("Controlled Frame Extraction Plan samples licensed direct media across distinct source families", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      title: "Forza Horizon 6 needs multiple official motion sources",
      existing_references: [
        reference("Forza Horizon 6", 1, {
          source_family: "steam_forza_horizon_6_launch_trailer",
        }),
        reference("Forza Horizon 6", 2, {
          provider: "official_intake",
          source_type: "licensed_direct_media_url",
          source_url: "https://cdn.forza.example/fh6/keyart.webm",
          source_family: "forza_official_site_forza_horizon_6",
          rights_risk_class: "official_direct_media",
          allowed_render_use: "official_direct_media_segment_candidate",
        }),
        reference("Forza Horizon 6", 3, {
          provider: "official_intake",
          source_type: "licensed_direct_media_url",
          source_url: "https://media.example/fh6/initial-drive.mp4",
          source_family: "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
          rights_risk_class: "official_direct_media",
          allowed_render_use: "official_direct_media_segment_candidate",
        }),
      ],
    }),
    { maxReferences: 4, maxReferencesPerEntity: 4, maxTargetFrames: 12 },
  );

  assert.equal(plan.selected_references.length, 3);
  assert.deepEqual(
    plan.selected_references.map((item) => item.source_family),
    [
      "steam_forza_horizon_6_launch_trailer",
      "forza_official_site_forza_horizon_6",
      "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
    ],
  );
  assert.ok(
    plan.target_frames.some(
      (frame) => frame.source_family === "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
    ),
  );
});

test("Controlled Frame Extraction Plan automatically uses distinct official alternates for single-game stories", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      story_id: "1tftq7f",
      existing_references: [
        reference("Forza Horizon 6", 1, {
          source_type: "steam_movie",
          provider: "steam",
          source_url: "https://video.example/forza-steam.m3u8",
          movie_name: "Forza Horizon 6 Launch Trailer",
        }),
        {
          source_type: "official_publisher_or_developer_trailer_page",
          provider: "official_intake",
          source_url:
            "https://cdn.forza.net/strapi-uploads/assets/Forza_Horizon_6_Primary_Animated_Keyart.webm",
          reference_page_url: "https://forza.net/forzahorizon6/",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entity: "Forza Horizon 6",
          movie_name: "Forza Horizon 6 official animated keyart",
          downloads_allowed: false,
          source_duration_s: 10,
        },
      ],
    }),
  );

  assert.equal(plan.frame_plan_readiness, "frame_plan_ready");
  assert.equal(plan.selected_references.length, 2);
  assert.deepEqual(
    plan.selected_references.map((item) => item.source_url_kind),
    ["hls_manifest", "direct_video"],
  );
  assert.equal(plan.exact_subject_motion_coverage.max_references_per_entity, 2);
  assert.ok(!plan.blockers.includes("needs_two_unique_official_references"));
});

test("Controlled Frame Extraction Plan rebuilds stale story motion plans when fresh trailer refs exist", () => {
  assert.equal(
    shouldRebuildMotionPlansFromReferences({
      storyId: "1te1oq7",
      explicitMotionPath: null,
      plans: [
        {
          story_id: "1te1oq7",
          motion_readiness: "official_reference_search_required",
          existing_references: [],
        },
      ],
      trailerReferenceReport: {
        plans: [
          {
            story_id: "1te1oq7",
            references: [reference("Forza Horizon 6")],
          },
        ],
      },
    }),
    true,
  );

  assert.equal(
    shouldRebuildMotionPlansFromReferences({
      storyId: "1te1oq7",
      explicitMotionPath: "test/output/custom_motion.json",
      plans: [
        {
          story_id: "1te1oq7",
          existing_references: [],
        },
      ],
      trailerReferenceReport: {
        plans: [
          {
            story_id: "1te1oq7",
            references: [reference("Forza Horizon 6")],
          },
        ],
      },
    }),
    false,
  );
});

test("Controlled Frame Extraction Plan rebuilds stale motion plans when trailer refs are richer", () => {
  assert.equal(
    shouldRebuildMotionPlansFromReferences({
      storyId: "1tftq7f",
      explicitMotionPath: null,
      plans: [
        {
          story_id: "1tftq7f",
          motion_readiness: "reference_ready_for_local_frame_plan",
          existing_references: [
            { source_url: "https://video.example/old.m3u8", entity: "Forza Horizon 6" },
          ],
        },
      ],
      trailerReferenceReport: {
        plans: [
          {
            story_id: "1tftq7f",
            references: [
              { source_url: "https://video.example/old.m3u8", entity: "Forza Horizon 6" },
              {
                source_url: "https://cdn.forza.net/assets/keyart.webm",
                entity: "Forza Horizon 6",
                source_duration_s: 10,
              },
            ],
          },
        ],
      },
    }),
    true,
  );
});

test("Controlled Frame Extraction report emits valid JSON and readable Markdown", () => {
  const report = buildControlledFrameExtractionReport([
    motionPlan({ story_id: "ready" }),
    motionPlan({
      story_id: "missing",
      motion_readiness: "official_reference_search_required",
      existing_references: [],
    }),
  ]);
  const markdown = renderControlledFrameExtractionMarkdown(report);

  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
  assert.equal(report.summary.stories, 2);
  assert.equal(report.summary.frame_plan_ready, 1);
  assert.equal(report.summary.no_reference, 1);
  assert.match(markdown, /Controlled Frame Extraction Plan/);
  assert.match(markdown, /ready/);
  assert.match(markdown, /missing/);
});
