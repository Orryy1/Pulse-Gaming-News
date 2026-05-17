"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMotionAcquisitionPlan,
  buildMotionAcquisitionReport,
  renderMotionAcquisitionMarkdown,
} = require("../../lib/motion-acquisition-pro");

function baseStory(overrides = {}) {
  return {
    id: "motion-story-1",
    title: "GTA 6 gets a new Xbox showcase update",
    source_type: "rss",
    subreddit: "IGN",
    flair: "Verified",
    score: 500,
    timestamp: "2026-05-01T10:00:00Z",
    full_script:
      "GTA 6 just became the biggest Xbox story of the week. Rockstar and Xbox are the centre of the conversation.",
    downloaded_images: [],
    video_clips: [],
    ...overrides,
  };
}

function trailer(path = "test/trailer.mp4", extra = {}) {
  return {
    type: "official_trailer",
    source: "steam",
    path,
    entity: "GTA",
    ...extra,
  };
}

function frame(path = "test/frame.jpg", extra = {}) {
  return {
    type: "trailer_frame",
    source: "trailer",
    path,
    entity: "GTA",
    ...extra,
  };
}

test("Motion Acquisition Pro is report-only and never enables downloads", () => {
  const plan = buildMotionAcquisitionPlan(baseStory());

  assert.equal(plan.execution_mode, "report_only");
  assert.equal(plan.will_download, false);
  assert.equal(plan.will_extract_frames, false);
  assert.equal(plan.safety.railway_mutated, false);
  assert.equal(plan.safety.production_db_mutated, false);
  assert.equal(plan.safety.posted_to_platforms, false);
});

test("Motion Acquisition Pro asks for official trailer search when no motion reference exists", () => {
  const plan = buildMotionAcquisitionPlan(baseStory({ id: "needs-trailer" }));
  const actionTypes = plan.planned_actions.map((action) => action.type);

  assert.equal(plan.motion_readiness, "official_reference_search_required");
  assert.equal(plan.existing_references.length, 0);
  assert.ok(actionTypes.includes("official_trailer_search"));
  assert.ok(plan.search_queries.some((query) => /official trailer/i.test(query)));
});

test("Motion Acquisition Pro routes existing trailer references to frame and clip planning", () => {
  const plan = buildMotionAcquisitionPlan(
    baseStory({
      id: "has-trailer",
      video_clips: [trailer("test/gta-trailer.mp4")],
    }),
  );
  const actionTypes = plan.planned_actions.map((action) => action.type);

  assert.equal(plan.motion_readiness, "reference_ready_for_local_frame_plan");
  assert.equal(plan.existing_references.length, 1);
  assert.equal(plan.existing_references[0].local_path, "test/gta-trailer.mp4");
  assert.ok(actionTypes.includes("trailer_frame_extract"));
  assert.ok(actionTypes.includes("clip_slice_extract"));
  assert.equal(actionTypes.includes("official_trailer_search"), false);
});

test("Motion Acquisition Pro consumes official resolver references as local frame-plan ready", () => {
  const plan = buildMotionAcquisitionPlan(
    baseStory({ id: "has-official-reference" }),
    {
      officialTrailerReferencePlans: [
        {
          story_id: "has-official-reference",
          references: [
            {
              provider: "steam",
              source_type: "steam_movie",
              source_url: "https://video.example/hls_264_master.m3u8",
              entity: "GTA",
              rights_risk_class: "storefront_promotional_video",
              allowed_render_use: "reference_only_by_default",
              downloads_allowed: false,
            },
          ],
        },
      ],
    },
  );
  const actionTypes = plan.planned_actions.map((action) => action.type);

  assert.equal(plan.motion_readiness, "reference_ready_for_local_frame_plan");
  assert.equal(plan.existing_references.length, 1);
  assert.equal(plan.existing_references[0].source_type, "steam_movie");
  assert.equal(plan.existing_references[0].source_url, "https://video.example/hls_264_master.m3u8");
  assert.ok(actionTypes.includes("trailer_frame_extract_plan"));
  assert.equal(actionTypes.includes("official_trailer_search"), false);
  assert.equal(plan.safety.video_downloads, false);
});

test("Motion Acquisition Pro keeps partial resolver references in targeted-search mode", () => {
  const plan = buildMotionAcquisitionPlan(
    baseStory({ id: "partial-official-reference" }),
    {
      officialTrailerReferencePlans: [
        {
          story_id: "partial-official-reference",
          motion_reference_readiness: "partial_official_reference_found",
          target_entities: ["GTA", "BioShock", "Red Dead"],
          covered_target_entities: ["GTA"],
          missing_target_entities: ["BioShock", "Red Dead"],
          references: [
            {
              provider: "steam",
              source_type: "steam_movie",
              source_url: "https://video.example/gta.m3u8",
              entity: "GTA",
              downloads_allowed: false,
            },
          ],
        },
      ],
    },
  );
  const actionTypes = plan.planned_actions.map((action) => action.type);

  assert.equal(plan.motion_readiness, "partial_reference_needs_targeted_search");
  assert.deepEqual(plan.resolver_reference_coverage.missing_target_entities, ["BioShock", "Red Dead"]);
  assert.ok(plan.blockers.includes("missing_official_reference_entities"));
  assert.equal(actionTypes.filter((type) => type === "targeted_official_reference_search").length, 2);
  assert.ok(actionTypes.includes("trailer_frame_extract_plan"));
  assert.equal(plan.studio_v2_motion_candidate, false);
});

test("Motion Acquisition Pro preserves official resolver movie names for downstream frame scoring", () => {
  const plan = buildMotionAcquisitionPlan(
    baseStory({ id: "has-named-official-reference" }),
    {
      officialTrailerReferencePlans: [
        {
          story_id: "has-named-official-reference",
          references: [
            {
              provider: "steam",
              source_type: "steam_movie",
              source_url: "https://video.example/pegi-rating.m3u8",
              entity: "GTA",
              movie_name: "GTA Official PEGI Rating Trailer",
              rights_risk_class: "storefront_promotional_video",
              allowed_render_use: "reference_only_by_default",
              downloads_allowed: false,
            },
          ],
        },
      ],
    },
  );

  assert.equal(plan.existing_references[0].movie_name, "GTA Official PEGI Rating Trailer");
});

test("Motion Acquisition Pro preserves trusted registry provenance for autonomous local planning", () => {
  const plan = buildMotionAcquisitionPlan(
    baseStory({ id: "has-trusted-registry-reference" }),
    {
      officialTrailerReferencePlans: [
        {
          story_id: "has-trusted-registry-reference",
          references: [
            {
              provider: "trusted_footage_registry",
              source_type: "official_youtube_channel_url",
              source_url: "https://www.youtube.com/@Xbox",
              entity: "GTA",
              source_tier: "official",
              trusted_footage_source_id: "xbox-official-youtube",
              trusted_footage_registry_status: "accepted",
              rights_risk_class: "official_reference_only",
              allowed_render_use: "reference_only_by_default",
              downloads_allowed: false,
            },
          ],
        },
      ],
    },
  );

  assert.equal(plan.motion_readiness, "reference_ready_for_local_frame_plan");
  assert.equal(plan.existing_references[0].provider, "trusted_footage_registry");
  assert.equal(plan.existing_references[0].trusted_footage_source_id, "xbox-official-youtube");
  assert.equal(plan.existing_references[0].trusted_footage_registry_status, "accepted");
  assert.equal(plan.existing_references[0].source_tier, "official");
  assert.equal(plan.planned_actions[0].accepted_sources.includes("trusted footage registry references"), true);
});

test("Motion Acquisition Pro report counts resolver references in readiness summary", () => {
  const report = buildMotionAcquisitionReport(
    [
      baseStory({ id: "has-official-reference" }),
      baseStory({ id: "needs-trailer" }),
    ],
    {
      officialTrailerReferencePlans: [
        {
          story_id: "has-official-reference",
          references: [
            {
              provider: "steam",
              source_type: "steam_movie",
              source_url: "https://video.example/hls_264_master.m3u8",
              entity: "GTA",
              downloads_allowed: false,
            },
          ],
        },
      ],
    },
  );

  assert.equal(report.summary.reference_ready_for_local_frame_plan, 1);
  assert.equal(report.summary.official_reference_search_required, 1);
});

test("Motion Acquisition Pro report counts partial resolver references separately", () => {
  const report = buildMotionAcquisitionReport(
    [
      baseStory({ id: "partial-official-reference" }),
      baseStory({ id: "has-official-reference" }),
    ],
    {
      officialTrailerReferencePlans: [
        {
          story_id: "partial-official-reference",
          motion_reference_readiness: "partial_official_reference_found",
          target_entities: ["GTA", "BioShock"],
          covered_target_entities: ["GTA"],
          missing_target_entities: ["BioShock"],
          references: [
            {
              provider: "steam",
              source_type: "steam_movie",
              source_url: "https://video.example/gta.m3u8",
              entity: "GTA",
              downloads_allowed: false,
            },
          ],
        },
        {
          story_id: "has-official-reference",
          references: [
            {
              provider: "steam",
              source_type: "steam_movie",
              source_url: "https://video.example/hls_264_master.m3u8",
              entity: "GTA",
              downloads_allowed: false,
            },
          ],
        },
      ],
    },
  );

  assert.equal(report.summary.partial_reference_needs_targeted_search, 1);
  assert.equal(report.summary.reference_ready_for_local_frame_plan, 1);
});

test("Motion Acquisition Pro marks enough clips and frames as local motion proof ready", () => {
  const plan = buildMotionAcquisitionPlan(
    baseStory({
      id: "motion-ready",
      video_clips: [
        trailer("test/clip-a.mp4"),
        trailer("test/clip-b.mp4"),
        trailer("test/clip-c.mp4"),
      ],
      downloaded_images: [
        frame("test/frame-1.jpg"),
        frame("test/frame-2.jpg"),
        frame("test/frame-3.jpg"),
      ],
    }),
  );

  assert.equal(plan.motion_readiness, "local_motion_proof_ready");
  assert.equal(plan.counts.total_clips, 3);
  assert.equal(plan.counts.trailer_extracted_frames, 3);
  assert.equal(plan.studio_v2_motion_candidate, true);
});

test("Motion Acquisition Pro report emits valid JSON and readable Markdown", () => {
  const report = buildMotionAcquisitionReport([
    baseStory({ id: "needs-trailer" }),
    baseStory({ id: "has-trailer", video_clips: [trailer()] }),
  ]);
  const markdown = renderMotionAcquisitionMarkdown(report);

  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
  assert.equal(report.summary.stories, 2);
  assert.equal(report.summary.official_reference_search_required, 1);
  assert.equal(report.summary.reference_ready_for_local_frame_plan, 1);
  assert.match(markdown, /Motion Acquisition Pro/);
  assert.match(markdown, /needs-trailer/);
  assert.match(markdown, /has-trailer/);
});
