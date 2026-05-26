"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOfficialTrailerClipsFromFrameReport,
  buildOfficialTrailerClipsFromAcquisitionPlan,
  buildExploratoryClipRefs,
  DEFAULT_EXPLORATORY_START_SECONDS,
  safeClipStartFromFrame,
  scoreOfficialTrailerFrameForClip,
  MIN_OFFICIAL_CLIP_START_S,
} = require("../../lib/studio/v2/official-trailer-clip-refs");
const {
  segmentKeyForClipRef,
} = require("../../lib/studio/v2/official-trailer-segment-validator");

function acceptedFrame(overrides = {}) {
  return {
    status: "accepted",
    source_url: "https://video.example/game.m3u8",
    source_type: "steam_movie",
    entity: "GTA",
    target_time_seconds: 31.2,
    local_path: "frame.jpg",
    qa: {
      thumbnail_safe: true,
      verdict: "pass",
      content_hash: "hash",
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0,
        edge_density: 0.18,
        saturation_mean: 0.29,
      },
    },
    ...overrides,
  };
}

test("official clip refs start after the accepted safe frame, not before it", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [acceptedFrame({ target_time_seconds: 31.2 })],
        },
      ],
    },
    "story-1",
  );

  assert.equal(refs.length, 1);
  assert.equal(refs[0].mediaStartS, 36);
  assert.equal(refs[0].provenance.clip_start_policy, "start_after_accepted_safe_frame");
  assert.equal(refs[0].provenance.requires_segment_validation, true);
  assert.equal(refs[0].provenance.segment_validated, false);
  assert.equal(refs[0].provenance.allowed_for_flash_lane, false);
});

test("official clip refs enforce a minimum start to avoid trailer rating/opening boards", () => {
  assert.equal(MIN_OFFICIAL_CLIP_START_S, 36);
  assert.equal(safeClipStartFromFrame({ target_time_seconds: 10.8 }), MIN_OFFICIAL_CLIP_START_S);
  assert.equal(
    safeClipStartFromFrame({ target_time_seconds: 4.2, source_duration_s: 10 }),
    5.75,
  );
});

test("official clip refs keep short direct media windows inside the source duration", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              source_url: "https://cdn.example/short-keyart.webm",
              source_type: "official_publisher_or_developer_trailer_page",
              source_duration_s: 10,
              target_time_seconds: 4.2,
            }),
          ],
        },
      ],
    },
    "story-1",
    { includeFrameAnchoredWindows: true, maxClips: 4 },
  );

  assert.deepEqual(
    refs.map((ref) => ref.mediaStartS),
    [2.8, 5.75],
  );
  assert.ok(refs.every((ref) => ref.sourceDurationS === 10));
  assert.ok(refs.every((ref) => ref.provenance.source_duration_s === 10));
});

test("exploratory refs skip Steam microtrailer aliases when duration is unknown", () => {
  const refs = buildExploratoryClipRefs(
    {
      plans: [],
    },
    "story-1",
    {
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_url:
                  "https://video.akamai.steamstatic.com/store_trailers/2483190/1133501958/hash/1778255437/hls_264_master.m3u8",
                source_type: "steam_movie",
                entity: "Forza Horizon 6",
              },
              {
                source_url:
                  "https://video.fastly.steamstatic.com/store_trailers/2483190/1133501958/hash/1778255437/microtrailer.mp4",
                source_type: "steam_storefront_video_reference",
                entity: "Forza Horizon 6",
              },
            ],
          },
        ],
      },
    },
  );

  assert.ok(refs.length > 0);
  assert.ok(refs.every((ref) => ref.path.includes("hls_264_master.m3u8")));
});

test("exploratory refs include licensed direct media references from official intake", () => {
  const refs = buildExploratoryClipRefs(
    {
      plans: [],
    },
    "story-1",
    {
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_url: "https://video.twimg.com/amplify_video/123/vid/avc1/1280x720/gameplay.mp4",
                source_type: "licensed_direct_media_url",
                source_family: "official_x_gameplay_clip",
                entity: "Forza Horizon 6",
                source_duration_s: 45,
                downloads_allowed: false,
                segment_validation_eligible: true,
              },
            ],
          },
        ],
      },
      exploratoryStartSeconds: [36],
    },
  );

  assert.equal(refs.length, 1);
  assert.equal(refs[0].path, "https://video.twimg.com/amplify_video/123/vid/avc1/1280x720/gameplay.mp4");
  assert.equal(refs[0].sourceType, "licensed_direct_media_url");
  assert.equal(refs[0].sourceFamily, "official_x_gameplay_clip");
  assert.equal(refs[0].sourceDurationS, 45);
  assert.equal(refs[0].provenance.reference_report_source, true);
  assert.equal(refs[0].provenance.source_duration_s, 45);
});

test("exploratory refs use source-relative windows for short licensed direct media", () => {
  const refs = buildExploratoryClipRefs(
    {
      plans: [],
    },
    "story-1",
    {
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_url: "https://video.twimg.com/amplify_video/123/vid/avc1/720x1280/short.mp4",
                source_type: "licensed_direct_media_url",
                source_family: "official_x_short_social_clip",
                entity: "Forza Horizon 6",
                source_duration_s: 12,
                downloads_allowed: false,
                segment_validation_eligible: true,
              },
            ],
          },
        ],
      },
      exploratoryStartSeconds: [36, 42, 48],
    },
  );

  assert.ok(refs.length >= 2);
  assert.ok(refs.every((ref) => ref.mediaStartS >= 4));
  assert.ok(refs.every((ref) => ref.mediaStartS <= 7.75));
  assert.ok(refs.every((ref) => ref.sourceFamily === "official_x_short_social_clip"));
});

test("exploratory refs skip no-duration Steam microtrailers from frame reports", () => {
  const refs = buildExploratoryClipRefs(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            {
              source_url:
                "https://video.fastly.steamstatic.com/store_trailers/2483190/1133501958/hash/1778255437/microtrailer.mp4",
              source_type: "steam_storefront_video_reference",
              entity: "Forza Horizon 6",
              target_time_seconds: 25,
              status: "rejected_qa",
            },
            {
              source_url:
                "https://video.akamai.steamstatic.com/store_trailers/2483190/1133501958/hash/1778255437/hls_264_master.m3u8",
              source_type: "steam_movie",
              entity: "Forza Horizon 6",
              target_time_seconds: 36,
              status: "accepted",
            },
          ],
        },
      ],
    },
    "story-1",
  );

  assert.ok(refs.length > 0);
  assert.ok(refs.every((ref) => ref.path.includes("hls_264_master.m3u8")));
});

test("official clip refs ignore accepted frames that trailer guards classify as title/rating cards", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              qa: {
                thumbnail_safe: true,
                verdict: "pass",
                prescan: {
                  likely_is_logo: true,
                  text_overlay_likelihood: 0.42,
                  edge_density: 0.25,
                  saturation_mean: 0.26,
                },
              },
            }),
          ],
        },
      ],
    },
    "story-1",
  );

  assert.deepEqual(refs, []);
});

test("official clip refs ignore text-heavy rating cards even without logo detection", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              qa: {
                thumbnail_safe: true,
                verdict: "pass",
                prescan: {
                  likely_is_logo: false,
                  text_overlay_likelihood: 0.51,
                  edge_density: 0.22,
                  saturation_mean: 0.18,
                },
              },
            }),
          ],
        },
      ],
    },
    "story-1",
  );

  assert.deepEqual(refs, []);
});

test("official clip refs ignore frames already carrying blur or low-detail warnings", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              qa: {
                thumbnail_safe: true,
                verdict: "warn",
                blur_verdict: "warn",
                warnings: ["low_detail_or_blur_risk"],
                prescan: {
                  likely_is_logo: false,
                  text_overlay_likelihood: 0.05,
                  edge_density: 0.011,
                  saturation_mean: 0.28,
                },
              },
            }),
          ],
        },
      ],
    },
    "story-1",
  );

  assert.deepEqual(refs, []);
});

test("official clip refs choose the strongest quality frame, not merely the latest", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              target_time_seconds: 42.1,
              local_path: "late-but-weak.jpg",
              qa: {
                thumbnail_safe: true,
                verdict: "pass",
                prescan: {
                  likely_is_logo: false,
                  text_overlay_likelihood: 0.29,
                  edge_density: 0.055,
                  saturation_mean: 0.19,
                },
              },
            }),
            acceptedFrame({
              target_time_seconds: 24.4,
              local_path: "earlier-strong.jpg",
              qa: {
                thumbnail_safe: true,
                verdict: "pass",
                prescan: {
                  likely_is_logo: false,
                  text_overlay_likelihood: 0.04,
                  edge_density: 0.21,
                  saturation_mean: 0.46,
                },
              },
            }),
          ],
        },
      ],
    },
    "story-1",
  );

  assert.equal(refs.length, 1);
  assert.equal(refs[0].provenance.frame_local_path, "earlier-strong.jpg");
  assert.equal(refs[0].provenance.segment_selection_policy, "highest_quality_safe_frame");
  assert.ok(refs[0].provenance.segment_quality_score > 0);
});

test("official clip frame quality score penalises text-heavy and dull frames", () => {
  const strong = scoreOfficialTrailerFrameForClip(
    acceptedFrame({
      qa: {
        prescan: {
          likely_is_logo: false,
          text_overlay_likelihood: 0.04,
          edge_density: 0.22,
          saturation_mean: 0.43,
        },
      },
    }),
  );
  const weak = scoreOfficialTrailerFrameForClip(
    acceptedFrame({
      qa: {
        prescan: {
          likely_is_logo: false,
          text_overlay_likelihood: 0.31,
          edge_density: 0.06,
          saturation_mean: 0.16,
        },
      },
    }),
  );

  assert.ok(strong > weak);
});

test("official clip score does not over-penalise safe post-intro cinematic frames", () => {
  const score = scoreOfficialTrailerFrameForClip(
    acceptedFrame({
      target_time_seconds: 25.2,
      qa: {
        thumbnail_safe: true,
        verdict: "pass",
        prescan: {
          likely_is_logo: false,
          text_overlay_likelihood: 0,
          edge_density: 0.145,
          saturation_mean: 0.21,
        },
      },
    }),
  );

  assert.ok(score >= 75);
});

test("official clip refs choose the later accepted frame per source", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({ target_time_seconds: 10.8, local_path: "early.jpg" }),
            acceptedFrame({ target_time_seconds: 31.2, local_path: "late.jpg" }),
          ],
        },
      ],
    },
    "story-1",
  );

  assert.equal(refs.length, 1);
  assert.equal(refs[0].provenance.frame_local_path, "late.jpg");
  assert.equal(refs[0].mediaStartS, 36);
});

test("official clip refs can emit alternate windows for the same source when validating footage", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              target_time_seconds: 25.2,
              local_path: "gta-42.jpg",
              qa: {
                thumbnail_safe: true,
                verdict: "pass",
                content_hash: "hash-a",
                prescan: {
                  likely_is_logo: false,
                  text_overlay_likelihood: 0,
                  edge_density: 0.18,
                  saturation_mean: 0.34,
                },
              },
            }),
            acceptedFrame({
              target_time_seconds: 34.8,
              local_path: "gta-58.jpg",
              qa: {
                thumbnail_safe: true,
                verdict: "pass",
                content_hash: "hash-b",
                prescan: {
                  likely_is_logo: false,
                  text_overlay_likelihood: 0,
                  edge_density: 0.16,
                  saturation_mean: 0.32,
                },
              },
            }),
            acceptedFrame({
              target_time_seconds: 44.4,
              local_path: "gta-74.jpg",
              qa: {
                thumbnail_safe: true,
                verdict: "pass",
                content_hash: "hash-c",
                prescan: {
                  likely_is_logo: false,
                  text_overlay_likelihood: 0,
                  edge_density: 0.14,
                  saturation_mean: 0.29,
                },
              },
            }),
          ],
        },
      ],
    },
    "story-1",
    { maxCandidateWindowsPerSource: 3 },
  );

  assert.equal(refs.length, 3);
  assert.deepEqual(
    refs.map((ref) => ref.mediaStartS),
    [36, 38.8, 48.4],
  );
  assert.ok(refs.every((ref) => ref.provenance.segment_selection_policy === "ranked_quality_candidate_window"));
});

test("official clip refs can emit frame-anchored retry windows around a safe frame", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              entity: "Red Dead",
              source_url: "https://video.example/reddead.m3u8",
              target_time_seconds: 44.4,
              local_path: "red-dead-74.jpg",
            }),
          ],
        },
      ],
    },
    "story-1",
    { includeFrameAnchoredWindows: true, maxCandidateWindowsPerSource: 2 },
  );

  assert.equal(refs.length, 2);
  assert.deepEqual(
    refs.map((ref) => ref.mediaStartS),
    [42.4, 48.4],
  );
  assert.deepEqual(
    refs.map((ref) => ref.provenance.clip_start_policy),
    ["start_before_accepted_safe_frame", "start_after_accepted_safe_frame"],
  );
});

test("official clip refs dedupe duplicate anchored starts from the same source", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              source_url: "https://video.example/gta.m3u8",
              target_time_seconds: 25.2,
              local_path: "gta-42.jpg",
            }),
            acceptedFrame({
              source_url: "https://video.example/gta.m3u8",
              target_time_seconds: 34.8,
              local_path: "gta-58.jpg",
            }),
          ],
        },
      ],
    },
    "story-1",
    {
      includeFrameAnchoredWindows: true,
      maxCandidateWindowsPerSource: 2,
      maxClips: 4,
    },
  );

  assert.deepEqual(
    refs.map((ref) => ref.mediaStartS),
    [36, 38.8],
  );
});

test("official clip refs can deep-scan official sources even when initial frames were rejected", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              status: "rejected_qa",
              entity: "GTA",
              source_url: "https://video.example/gta.m3u8",
              target_time_seconds: 25.2,
              local_path: "gta-bad-open.jpg",
              qa: {
                thumbnail_safe: false,
                verdict: "fail",
                failures: ["title_or_rating_card_frame"],
                prescan: {
                  likely_is_logo: true,
                  text_overlay_likelihood: 0.44,
                  edge_density: 0.21,
                  saturation_mean: 0.33,
                },
              },
            }),
          ],
        },
      ],
    },
    "story-1",
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [36, 42, 48],
      maxClips: 10,
    },
  );

  assert.equal(DEFAULT_EXPLORATORY_START_SECONDS[0], 36);
  assert.deepEqual(
    refs.map((ref) => ref.mediaStartS),
    [36, 42, 48],
  );
  assert.ok(refs.every((ref) => ref.provenance.segment_selection_policy === "deep_scan_uniform_window"));
  assert.ok(refs.every((ref) => ref.provenance.exploratory_scan === true));
});

test("official clip refs default deep-scan adds later windows for long official media", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    { plans: [{ story_id: "story-1", frames: [] }] },
    "story-1",
    {
      includeExploratoryWindows: true,
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/star-wars-zero-company.m3u8",
                entity: "Star Wars Zero Company",
                movie_name: "Official Announce Trailer",
                source_duration_s: 134.2,
                downloads_allowed: false,
              },
            ],
          },
        ],
      },
      maxClips: 20,
    },
  );

  assert.deepEqual(
    refs.map((ref) => ref.mediaStartS),
    [36, 42, 48, 54, 60, 66, 78, 90, 102, 114, 120, 126],
  );
  assert.ok(refs.every((ref) => ref.provenance.segment_selection_policy === "deep_scan_uniform_window"));
});

test("official clip refs deep-scan dedupes repeated source/entity/start windows", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              status: "rejected_qa",
              entity: "GTA",
              source_url: "https://video.example/gta.m3u8",
            }),
            acceptedFrame({
              status: "accepted",
              entity: "GTA",
              source_url: "https://video.example/gta.m3u8",
              target_time_seconds: 44.4,
            }),
          ],
        },
      ],
    },
    "story-1",
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [36, 36, 42],
      maxClips: 20,
    },
  );

  const exploratory = refs.filter((ref) => ref.provenance.exploratory_scan === true);
  assert.deepEqual(
    exploratory.map((ref) => ref.mediaStartS),
    [36, 42],
  );
});

test("official clip refs deep-scan alternate official sources from a resolver report", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              status: "rejected_qa",
              entity: "GTA",
              source_url: "https://video.example/gta-open.m3u8",
            }),
          ],
        },
      ],
    },
    "story-1",
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [72],
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/gta-open.m3u8",
                entity: "GTA",
                movie_name: "Opening Rating Board",
                downloads_allowed: false,
              },
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/gta-action.m3u8",
                entity: "GTA",
                movie_name: "Gameplay Update Trailer",
                downloads_allowed: false,
              },
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/reddead-action.m3u8",
                entity: "Red Dead",
                movie_name: "Launch Trailer",
                downloads_allowed: false,
              },
            ],
          },
        ],
      },
      maxClips: 20,
    },
  );

  assert.deepEqual(
    refs.map((ref) => `${ref.entity}:${ref.path}:${ref.mediaStartS}`),
    [
      "GTA:https://video.example/gta-open.m3u8:72",
      "GTA:https://video.example/gta-action.m3u8:72",
      "Red Dead:https://video.example/reddead-action.m3u8:72",
    ],
  );
  assert.equal(refs[1].provenance.reference_report_source, true);
  assert.equal(refs[1].provenance.movie_name, "Gameplay Update Trailer");
});

test("official clip refs skip resolver references that are only rating-board material", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    { plans: [{ story_id: "story-1", frames: [] }] },
    "story-1",
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [42],
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/gta-pegi-board.m3u8",
                entity: "GTA",
                movie_name: "GTA Official PEGI Rating Trailer",
                downloads_allowed: false,
              },
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/gta-gameplay.m3u8",
                entity: "GTA",
                movie_name: "GTA Gameplay Update Trailer",
                downloads_allowed: false,
              },
            ],
          },
        ],
      },
      maxClips: 20,
    },
  );

  assert.deepEqual(
    refs.map((ref) => ref.path),
    ["https://video.example/gta-gameplay.m3u8"],
  );
  assert.equal(refs[0].provenance.movie_name, "GTA Gameplay Update Trailer");
});

test("official clip refs skip resolver references that are logo/title-only material", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    { plans: [{ story_id: "story-1", frames: [] }] },
    "story-1",
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [42],
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/gta-logo-loop.m3u8",
                entity: "GTA",
                movie_name: "GTA Logo Loop",
                downloads_allowed: false,
              },
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/gta-gameplay.m3u8",
                entity: "GTA",
                movie_name: "GTA Gameplay Update Trailer",
                downloads_allowed: false,
              },
            ],
          },
        ],
      },
      maxClips: 20,
    },
  );

  assert.deepEqual(
    refs.map((ref) => ref.path),
    ["https://video.example/gta-gameplay.m3u8"],
  );
  assert.equal(refs[0].provenance.movie_name, "GTA Gameplay Update Trailer");
});

test("official clip refs do not deep-scan YouTube watch references from resolver reports", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    { plans: [{ story_id: "story-1", frames: [] }] },
    "story-1",
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [42],
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_type: "igdb_video",
                provider: "igdb",
                source_url: "https://www.youtube.com/watch?v=officialRef",
                entity: "BioShock",
                movie_name: "BioShock Official Trailer",
                downloads_allowed: false,
                segment_validation_eligible: false,
              },
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/bioshock-gameplay.m3u8",
                entity: "BioShock",
                movie_name: "BioShock Gameplay Trailer",
                downloads_allowed: false,
              },
            ],
          },
        ],
      },
      maxClips: 20,
    },
  );

  assert.deepEqual(refs.map((ref) => ref.path), ["https://video.example/bioshock-gameplay.m3u8"]);
  assert.equal(refs[0].provenance.source_url_kind, "hls_manifest");
  assert.equal(refs[0].provenance.segment_validation_eligible, true);
});

test("official clip refs do not build acquisition refs from HTML official pages", () => {
  const refs = buildOfficialTrailerClipsFromAcquisitionPlan(
    {
      story_id: "story-1",
      shopping_list: [
        {
          entity: "Red Dead",
          suggested_windows: [{ start_s: 48, duration_s: 5 }],
        },
      ],
    },
    {
      plans: [
        {
          story_id: "story-1",
          references: [
            {
              source_type: "official_trailer",
              provider: "official_intake",
              source_url: "https://www.rockstargames.com/reddeadredemption2/videos",
              entity: "Red Dead",
              movie_name: "Red Dead official media page",
              downloads_allowed: false,
              segment_validation_eligible: false,
            },
            {
              source_type: "steam_movie",
              provider: "steam",
              source_url: "https://video.example/reddead-gameplay.m3u8",
              entity: "Red Dead",
              movie_name: "Red Dead gameplay trailer",
              downloads_allowed: false,
            },
          ],
        },
      ],
    },
    "story-1",
  );

  assert.deepEqual(refs.map((ref) => ref.path), ["https://video.example/reddead-gameplay.m3u8"]);
  assert.equal(refs[0].provenance.segment_validation_eligible, true);
});

test("official clip refs do not create frame-derived refs from accepted YouTube or HTML frames", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              source_url: "https://www.youtube.com/watch?v=officialRef",
              source_type: "igdb_video",
              entity: "BioShock",
            }),
            acceptedFrame({
              source_url: "https://www.rockstargames.com/reddeadredemption2/videos",
              source_type: "official_trailer",
              entity: "Red Dead",
            }),
            acceptedFrame({
              source_url: "https://video.example/gta-gameplay.m3u8",
              source_type: "steam_movie",
              entity: "GTA",
            }),
          ],
        },
      ],
    },
    "story-1",
    { maxClips: 10 },
  );

  assert.deepEqual(refs.map((ref) => ref.path), ["https://video.example/gta-gameplay.m3u8"]);
  assert.equal(refs[0].provenance.source_url_kind, "hls_manifest");
});

test("official clip refs ignore stale validated segment reports with non-direct URLs", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    { plans: [{ story_id: "story-1", frames: [] }] },
    "story-1",
    {
      maxClips: 10,
      requireValidatedSegments: true,
      segmentValidationReport: {
        generated_at: "2026-05-08T11:00:00.000Z",
        segments: [
          {
            source_url: "https://www.youtube.com/watch?v=officialRef",
            source_type: "igdb_video",
            entity: "BioShock",
            media_start_s: 42,
            duration_s: 5,
            segment_validated: true,
            allowed_for_flash_lane: true,
            validation_reason: "segment_samples_passed",
            segment_motion_class: "gameplay_action",
            action_score: 88,
            action_sample_count: 3,
            samples: [{ local_path: "test/output/official-trailer-segment-validation-v1/assets/story-1/a.jpg" }],
          },
          {
            source_url: "https://www.rockstargames.com/reddeadredemption2/videos",
            source_type: "official_trailer",
            entity: "Red Dead",
            media_start_s: 48,
            duration_s: 5,
            segment_validated: true,
            allowed_for_flash_lane: true,
            validation_reason: "segment_samples_passed",
            segment_motion_class: "gameplay_action",
            action_score: 86,
            action_sample_count: 3,
            samples: [{ local_path: "test/output/official-trailer-segment-validation-v1/assets/story-1/b.jpg" }],
          },
          {
            source_url: "https://video.example/gta-gameplay.m3u8",
            source_type: "steam_movie",
            entity: "GTA",
            media_start_s: 54,
            duration_s: 5,
            segment_validated: true,
            allowed_for_flash_lane: true,
            validation_reason: "segment_samples_passed",
            segment_motion_class: "gameplay_action",
            action_score: 84,
            action_sample_count: 3,
            samples: [{ local_path: "test/output/official-trailer-segment-validation-v1/assets/story-1/c.jpg" }],
          },
        ],
      },
    },
  );

  assert.deepEqual(refs.map((ref) => ref.path), ["https://video.example/gta-gameplay.m3u8"]);
  assert.equal(refs[0].provenance.source_url_kind, "hls_manifest");
});

test("official clip refs deep-scan balances entities before repeated same-entity sources", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    { plans: [{ story_id: "story-1", frames: [] }] },
    "story-1",
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [36, 42],
      maxClips: 4,
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/gta-a.m3u8",
                entity: "GTA",
                downloads_allowed: false,
              },
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/gta-b.m3u8",
                entity: "GTA",
                downloads_allowed: false,
              },
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/reddead.m3u8",
                entity: "Red Dead",
                downloads_allowed: false,
              },
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/bioshock.m3u8",
                entity: "BioShock",
                downloads_allowed: false,
              },
            ],
          },
        ],
      },
    },
  );

  assert.deepEqual(
    refs.slice(0, 3).map((ref) => ref.entity),
    ["GTA", "Red Dead", "BioShock"],
  );
  assert.equal(new Set(refs.map((ref) => ref.entity)).size, 3);
});

test("official clip refs deep-scan rotates later start windows before exhausting early starts", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    { plans: [{ story_id: "story-1", frames: [] }] },
    "story-1",
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [36, 42, 48],
      maxClips: 6,
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_type: "steam_movie",
                source_url: "https://video.example/gta.m3u8",
                entity: "GTA",
                downloads_allowed: false,
              },
              {
                source_type: "steam_movie",
                source_url: "https://video.example/reddead.m3u8",
                entity: "Red Dead",
                downloads_allowed: false,
              },
              {
                source_type: "steam_movie",
                source_url: "https://video.example/bioshock.m3u8",
                entity: "BioShock",
                downloads_allowed: false,
              },
            ],
          },
        ],
      },
    },
  );

  assert.deepEqual(
    refs.map((ref) => `${ref.entity}:${ref.mediaStartS}`),
    ["GTA:36", "Red Dead:36", "BioShock:36", "GTA:42", "Red Dead:42", "BioShock:42"],
  );
});

test("official clip refs deep-scan rotates alternate sources before later starts for the same entity", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    { plans: [{ story_id: "story-1", frames: [] }] },
    "story-1",
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [36, 42],
      maxClips: 5,
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_type: "steam_movie",
                source_url: "https://video.example/gta-source-a.m3u8",
                entity: "GTA",
                downloads_allowed: false,
              },
              {
                source_type: "steam_movie",
                source_url: "https://video.example/gta-source-b.m3u8",
                entity: "GTA",
                downloads_allowed: false,
              },
              {
                source_type: "steam_movie",
                source_url: "https://video.example/reddead.m3u8",
                entity: "Red Dead",
                downloads_allowed: false,
              },
            ],
          },
        ],
      },
    },
  );

  assert.deepEqual(
    refs.map((ref) => `${ref.entity}:${ref.path}:${ref.mediaStartS}`),
    [
      "GTA:https://video.example/gta-source-a.m3u8:36",
      "Red Dead:https://video.example/reddead.m3u8:36",
      "GTA:https://video.example/gta-source-b.m3u8:36",
      "Red Dead:https://video.example/reddead.m3u8:42",
      "GTA:https://video.example/gta-source-a.m3u8:42",
    ],
  );
});

test("official clip refs ignore unsafe or downloadable resolver references", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    { plans: [{ story_id: "story-1", frames: [] }] },
    "story-1",
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [72],
      referenceReport: {
        plans: [
          {
            story_id: "story-1",
            references: [
              {
                source_type: "steam_movie",
                provider: "steam",
                source_url: "https://video.example/downloadable.m3u8",
                entity: "GTA",
                downloads_allowed: true,
              },
              {
                source_type: "unofficial_clip",
                provider: "unknown",
                source_url: "https://video.example/unofficial.mp4",
                entity: "GTA",
                downloads_allowed: false,
              },
              {
                source_type: "igdb_video",
                provider: "igdb",
                source_url: "https://video.example/official.m3u8",
                entity: "BioShock",
                downloads_allowed: false,
              },
            ],
          },
        ],
      },
      maxClips: 20,
    },
  );

  assert.deepEqual(
    refs.map((ref) => ref.path),
    ["https://video.example/official.m3u8"],
  );
});

test("official clip refs deep-scan official product page direct media without calling it gameplay", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    { plans: [{ story_id: "ps5-story", frames: [] }] },
    "ps5-story",
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [2, 6],
      referenceReport: {
        plans: [
          {
            story_id: "ps5-story",
            references: [
              {
                source_type: "official_platform_product_page",
                provider: "playstation",
                source_url: "https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/product-motion.mp4",
                entity: "PS5",
                source_family: "playstation_ps5_product_page",
                duration_seconds: 9.88,
                downloads_allowed: false,
                segment_validation_eligible: true,
              },
            ],
          },
        ],
      },
      maxClips: 4,
    },
  );

  assert.deepEqual(
    refs.map((ref) => `${ref.sourceType}:${ref.mediaStartS}`),
    [
      "official_platform_product_page:4",
      "official_platform_product_page:4.15",
      "official_platform_product_page:5.63",
    ],
  );
  assert.ok(refs.every((ref) => ref.provenance.segment_validation_reason === "exploratory_window_not_sampled"));
  assert.ok(refs.every((ref) => ref.provenance.segment_validation_eligible === true));
});

test("official clip refs inherit local segment validation before Flash Lane use", () => {
  const frameReport = {
    plans: [
      {
        story_id: "story-1",
        frames: [acceptedFrame({ target_time_seconds: 42, local_path: "strong.jpg" })],
      },
    ],
  };
  const unvalidated = buildOfficialTrailerClipsFromFrameReport(frameReport, "story-1");
  const refs = buildOfficialTrailerClipsFromFrameReport(frameReport, "story-1", {
    segmentValidationReport: {
      generated_at: "2026-05-02T22:00:00.000Z",
      segments: [
        {
          clip_key: segmentKeyForClipRef(unvalidated[0]),
          segment_validated: true,
          allowed_for_flash_lane: true,
          validation_reason: "segment_samples_passed",
          segment_motion_class: "gameplay_action",
          action_score: 82,
          action_sample_count: 3,
          samples: [{}, {}, {}],
        },
      ],
    },
  });

  assert.equal(refs.length, 1);
  assert.equal(refs[0].provenance.segment_validated, true);
  assert.equal(refs[0].provenance.allowed_for_flash_lane, true);
  assert.equal(refs[0].provenance.segment_validation_reason, "segment_samples_passed");
});

test("official clip refs can filter out segment-validation failures for render packages", () => {
  const frameReport = {
    plans: [
      {
        story_id: "story-1",
        frames: [
          acceptedFrame({
            source_url: "https://video.example/gta.m3u8",
            entity: "GTA",
            target_time_seconds: 42,
          }),
          acceptedFrame({
            source_url: "https://video.example/reddead.m3u8",
            entity: "Red Dead",
            target_time_seconds: 42,
          }),
        ],
      },
    ],
  };
  const unvalidated = buildOfficialTrailerClipsFromFrameReport(frameReport, "story-1");
  const refs = buildOfficialTrailerClipsFromFrameReport(frameReport, "story-1", {
    requireValidatedSegments: true,
    segmentValidationReport: {
      generated_at: "2026-05-02T22:00:00.000Z",
      segments: [
        {
          clip_key: segmentKeyForClipRef(unvalidated.find((ref) => ref.entity === "GTA")),
          segment_validated: true,
          allowed_for_flash_lane: true,
          validation_reason: "segment_samples_passed",
          segment_motion_class: "gameplay_action",
          action_score: 82,
          action_sample_count: 3,
          samples: [{}, {}, {}],
        },
        {
          clip_key: segmentKeyForClipRef(unvalidated.find((ref) => ref.entity === "Red Dead")),
          segment_validated: false,
          allowed_for_flash_lane: false,
          validation_reason: "segment_contains_low_detail_frame",
          samples: [{}, {}, {}],
        },
      ],
    },
  });

  assert.equal(refs.length, 1);
  assert.equal(refs[0].entity, "GTA");
  assert.equal(refs[0].provenance.allowed_for_flash_lane, true);
});

test("official clip refs keep searching past rejected validation windows until max valid refs", () => {
  const frameReport = {
    plans: [
      {
        story_id: "story-1",
        frames: [
          acceptedFrame({
            source_url: "https://video.example/gta.m3u8",
            entity: "GTA",
            target_time_seconds: 50,
            qa: {
              thumbnail_safe: true,
              verdict: "pass",
              prescan: {
                likely_is_logo: false,
                text_overlay_likelihood: 0,
                edge_density: 0.22,
                saturation_mean: 0.45,
              },
            },
          }),
          acceptedFrame({
            source_url: "https://video.example/xbox.m3u8",
            entity: "Xbox",
            target_time_seconds: 48,
            qa: {
              thumbnail_safe: true,
              verdict: "pass",
              prescan: {
                likely_is_logo: false,
                text_overlay_likelihood: 0,
                edge_density: 0.21,
                saturation_mean: 0.41,
              },
            },
          }),
          acceptedFrame({
            source_url: "https://video.example/reddead.m3u8",
            entity: "Red Dead",
            target_time_seconds: 44,
            qa: {
              thumbnail_safe: true,
              verdict: "pass",
              prescan: {
                likely_is_logo: false,
                text_overlay_likelihood: 0,
                edge_density: 0.16,
                saturation_mean: 0.33,
              },
            },
          }),
          acceptedFrame({
            source_url: "https://video.example/bioshock.m3u8",
            entity: "BioShock",
            target_time_seconds: 42,
            qa: {
              thumbnail_safe: true,
              verdict: "pass",
              prescan: {
                likely_is_logo: false,
                text_overlay_likelihood: 0,
                edge_density: 0.15,
                saturation_mean: 0.31,
              },
            },
          }),
        ],
      },
    ],
  };
  const candidates = buildOfficialTrailerClipsFromFrameReport(frameReport, "story-1", {
    maxClips: 4,
  });
  const segment = (entity, allowed) => ({
    clip_key: segmentKeyForClipRef(candidates.find((ref) => ref.entity === entity)),
    segment_validated: allowed,
    allowed_for_flash_lane: allowed,
    validation_reason: allowed ? "segment_samples_passed" : "segment_contains_title_or_rating_card",
    segment_motion_class: allowed ? "gameplay_action" : "rejected",
    action_score: allowed ? 82 : 0,
    action_sample_count: allowed ? 3 : 0,
    samples: [{}, {}, {}],
  });

  const refs = buildOfficialTrailerClipsFromFrameReport(frameReport, "story-1", {
    maxClips: 2,
    requireValidatedSegments: true,
    segmentValidationReport: {
      generated_at: "2026-05-02T22:00:00.000Z",
      segments: [
        segment("GTA", false),
        segment("Xbox", false),
        segment("Red Dead", true),
        segment("BioShock", true),
      ],
    },
  });

  assert.deepEqual(
    refs.map((ref) => ref.entity),
    ["Red Dead", "BioShock"],
  );
  assert.ok(refs.every((ref) => ref.provenance.allowed_for_flash_lane === true));
});

test("official clip refs include validated deep-scan segments even when no accepted frame window matched", () => {
  const sourceA = "https://video.example/marathon-gameplay-a.m3u8";
  const sourceB = "https://video.example/marathon-gameplay-b.m3u8";
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              status: "rejected_qa",
              entity: "Marathon",
              source_url: sourceA,
              target_time_seconds: 12,
              qa: {
                thumbnail_safe: false,
                verdict: "fail",
                failures: ["title_or_rating_card_frame"],
                prescan: {
                  likely_is_logo: true,
                  text_overlay_likelihood: 0.55,
                  edge_density: 0.18,
                  saturation_mean: 0.22,
                },
              },
            }),
          ],
        },
      ],
    },
    "story-1",
    {
      maxClips: 4,
      requireValidatedSegments: true,
      segmentValidationReport: {
        generated_at: "2026-05-02T22:00:00.000Z",
        segments: [
          {
            clip_key: `${sourceA}|marathon|42.00`,
            source_url: sourceA,
            source_type: "steam_movie",
            entity: "Marathon",
            media_start_s: 42,
            duration_s: 5,
            status: "validated",
            segment_validated: true,
            allowed_for_flash_lane: true,
            validation_reason: "segment_samples_passed",
            segment_motion_class: "gameplay_action",
            action_score: 78,
            action_sample_count: 3,
            samples: [
              { local_path: "test/output/official-trailer-segment-validation-v1/assets/story-1/a.jpg" },
            ],
          },
          {
            clip_key: `${sourceB}|marathon|84.00`,
            source_url: sourceB,
            source_type: "steam_movie",
            entity: "Marathon",
            media_start_s: 84,
            duration_s: 5,
            status: "validated",
            segment_validated: true,
            allowed_for_flash_lane: true,
            validation_reason: "segment_samples_passed",
            segment_motion_class: "gameplay_action",
            action_score: 82,
            action_sample_count: 3,
            samples: [
              { local_path: "test/output/official-trailer-segment-validation-v1/assets/story-1/b.jpg" },
            ],
          },
        ],
      },
    },
  );

  assert.deepEqual(
    refs.map((ref) => `${ref.entity}:${ref.mediaStartS}`),
    ["Marathon:84", "Marathon:42"],
  );
  assert.ok(refs.every((ref) => ref.provenance.segment_validated === true));
  assert.ok(refs.every((ref) => ref.provenance.segment_selection_policy === "validated_deep_scan_segment"));
});

test("official clip refs prefer deep-scan gameplay segments over late frame-anchored windows", () => {
  const source = "https://video.example/forza-gameplay.m3u8";
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              source_url: source,
              entity: "Forza Horizon 6",
              target_time_seconds: 80.4,
            }),
          ],
        },
      ],
    },
    "story-1",
    {
      maxClips: 3,
      requireValidatedSegments: true,
      segmentValidationReport: {
        generated_at: "2026-05-02T22:00:00.000Z",
        segments: [42, 48, 54, 84].map((start, index) => ({
          clip_key: `${source}|forza_horizon_6|${start.toFixed(2)}`,
          source_url: source,
          source_type: "steam_movie",
          entity: "Forza Horizon 6",
          media_start_s: start,
          duration_s: 5,
          status: "validated",
          segment_validated: true,
          allowed_for_flash_lane: true,
          validation_reason: "segment_samples_passed",
          segment_motion_class: "gameplay_action",
          action_score: index === 3 ? 70 : 90 - index,
          action_sample_count: 3,
          samples: [
            { local_path: `test/output/official-trailer-segment-validation-v1/assets/story-1/${start}.jpg` },
          ],
        })),
      },
    },
  );

  assert.deepEqual(refs.map((ref) => ref.mediaStartS), [42, 48, 54]);
  assert.ok(refs.every((ref) => ref.provenance.segment_selection_policy === "validated_deep_scan_segment"));
});

test("official clip refs use recommended trim timing from validated deep-scan segments", () => {
  const source = "https://video.example/gta-gameplay.m3u8";
  const refs = buildOfficialTrailerClipsFromFrameReport(
    { plans: [{ story_id: "story-1", frames: [] }] },
    "story-1",
    {
      maxClips: 4,
      requireValidatedSegments: true,
      segmentValidationReport: {
        generated_at: "2026-05-02T22:00:00.000Z",
        segments: [
          {
            clip_key: `${source}|gta|42.00`,
            source_url: source,
            source_type: "steam_movie",
            entity: "GTA",
            media_start_s: 42,
            duration_s: 5,
            status: "validated",
            segment_validated: true,
            allowed_for_flash_lane: true,
            validation_reason: "trimmed_segment_samples_passed",
            segment_motion_class: "gameplay_action",
            action_score: 88,
            action_sample_count: 2,
            trim_recommended: true,
            recommended_media_start_s: 42.45,
            recommended_duration_s: 2.8,
            trim_sample_orders: [1, 2],
            samples: [
              { local_path: "test/output/official-trailer-segment-validation-v1/assets/story-1/a.jpg" },
              { local_path: "test/output/official-trailer-segment-validation-v1/assets/story-1/b.jpg" },
            ],
          },
        ],
      },
    },
  );

  assert.equal(refs.length, 1);
  assert.equal(refs[0].mediaStartS, 42.7);
  assert.equal(refs[0].durationS, 2.2);
  assert.equal(refs[0].provenance.segment_validation_reason, "trimmed_segment_samples_passed");
  assert.equal(refs[0].provenance.segment_trim_recommended, true);
  assert.equal(refs[0].provenance.segment_original_start_s, 42);
  assert.equal(refs[0].provenance.segment_original_duration_s, 5);
  assert.equal(refs[0].provenance.segment_recommended_start_s, 42.45);
  assert.equal(refs[0].provenance.segment_recommended_duration_s, 2.8);
  assert.equal(refs[0].provenance.segment_render_start_s, 42.7);
  assert.equal(refs[0].provenance.segment_render_duration_s, 2.2);
  assert.equal(refs[0].provenance.segment_render_head_inset_s, 0.25);
  assert.equal(refs[0].provenance.segment_render_tail_inset_s, 0.35);
});

test("official clip refs can be built from Flash Lane acquisition queue windows", () => {
  const refs = buildOfficialTrailerClipsFromAcquisitionPlan(
    {
      stories: [
        {
          story_id: "story-1",
          shopping_list: [
            {
              entity: "Red Dead",
              suggested_windows: [
                { start_s: 72, duration_s: 4 },
                { start_s: 84, duration_s: 4 },
              ],
              reasons: ["find_validated_official_trailer_window"],
            },
          ],
        },
      ],
    },
    {
      plans: [
        {
          story_id: "story-1",
          references: [
            {
              source_url: "https://video.example/red-dead-trailer.m3u8",
              source_type: "steam_movie",
              entity: "Red Dead",
              provider: "steam",
              movie_name: "Red Dead Gameplay Trailer",
              movie_id: "rdr2-1",
              store_app_id: "1174180",
            },
            {
              source_url: "https://video.example/gta-trailer.m3u8",
              source_type: "steam_movie",
              entity: "GTA",
            },
          ],
        },
      ],
    },
    "story-1",
  );

  assert.deepEqual(
    refs.map((ref) => `${ref.entity}:${ref.mediaStartS}:${ref.durationS}`),
    ["Red Dead:72:4", "Red Dead:84:4"],
  );
  assert.ok(refs.every((ref) => ref.path === "https://video.example/red-dead-trailer.m3u8"));
  assert.ok(refs.every((ref) => ref.storyId === "story-1"));
  assert.equal(refs[0].provenance.segment_selection_policy, "flash_lane_acquisition_queue");
  assert.equal(refs[0].provenance.provider, "steam");
  assert.equal(refs[0].provenance.movie_id, "rdr2-1");
  assert.equal(refs[0].provenance.store_app_id, "1174180");
});

test("official clip refs from acquisition queue reject rating-board references", () => {
  const refs = buildOfficialTrailerClipsFromAcquisitionPlan(
    {
      story_id: "story-1",
      shopping_list: [
        {
          entity: "Red Dead",
          suggested_windows: [{ start_s: 72, duration_s: 4 }],
          reasons: ["find_validated_official_trailer_window"],
        },
      ],
    },
    {
      plans: [
        {
          story_id: "story-1",
          references: [
            {
              source_url: "https://video.example/red-dead-pegi.m3u8",
              source_type: "steam_movie",
              entity: "Red Dead",
              movie_name: "Red Dead PEGI Rating Trailer",
            },
          ],
        },
      ],
    },
    "story-1",
  );

  assert.deepEqual(refs, []);
});

test("official clip refs from acquisition queue skip exhausted source families", () => {
  const refs = buildOfficialTrailerClipsFromAcquisitionPlan(
    {
      story_id: "story-1",
      shopping_list: [
        {
          entity: "Marathon",
          suggested_windows: [{ start_s: 72, duration_s: 4 }],
          exhausted_source_families: [
            { key: "https://video.example/marathon-loop.m3u8" },
          ],
        },
      ],
    },
    {
      plans: [
        {
          story_id: "story-1",
          references: [
            {
              source_url: "https://video.example/marathon-loop.m3u8",
              source_type: "steam_movie",
              entity: "Marathon",
              movie_name: "Marathon Loop",
            },
            {
              source_url: "https://video.example/marathon-gameplay.m3u8",
              source_type: "steam_movie",
              entity: "Marathon",
              movie_name: "Marathon Gameplay Trailer",
            },
          ],
        },
      ],
    },
    "story-1",
  );

  assert.deepEqual(
    refs.map((ref) => ref.path),
    ["https://video.example/marathon-gameplay.m3u8"],
  );
});
