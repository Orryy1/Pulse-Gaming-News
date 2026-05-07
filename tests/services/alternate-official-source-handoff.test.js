"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildAlternateOfficialSourceHandoffReport,
  renderAlternateOfficialSourceHandoffMarkdown,
} = require("../../lib/ops/alternate-official-source-handoff");

const ROOT = path.resolve(__dirname, "..", "..");

function motionGap(overrides = {}) {
  return {
    story_id: "rss_gap",
    title: "GTA 6 Owner Passed On A Legacy Franchise",
    motion_gap: {
      acquisition_strategy: {
        status: "alternate_official_sources_required",
        alternate_source_entities: ["Red Dead"],
        entity_statuses: {
          "Red Dead": {
            status: "alternate_source_required",
            recommendation: "find_alternate_official_source_family",
            attempted_segments: 8,
            validated_segments: 0,
            rejected_segments: 8,
            source_family_count: 1,
            top_rejection_reason: "segment_contains_title_or_rating_card",
            rejection_reasons: {
              segment_contains_title_or_rating_card: 5,
              segment_contains_black_frame: 3,
            },
            source_families: [
              {
                provider: "steam",
                store_app_id: "1174180",
                store_app_title: "Red Dead Redemption 2",
                movie_id: "900001",
                reference_title: "Launch Trailer",
                source_url:
                  "https://video.akamai.steamstatic.com/store_trailers/1174180/900001/reddead/hls_264_master.m3u8",
                attempted_segments: 8,
                validated_segments: 0,
                rejected_segments: 8,
                top_rejection_reason: "segment_contains_title_or_rating_card",
              },
            ],
          },
        },
      },
    },
    ...overrides,
  };
}

function referencePlan(overrides = {}) {
  return {
    story_id: "rss_gap",
    alternate_reference_required_entities: ["Red Dead"],
    references: [
      {
        provider: "steam",
        entity: "BioShock",
        source_url: "https://video.example.test/bioshock.m3u8",
      },
    ],
    excluded_references: [
      {
        provider: "steam",
        entity: "Red Dead",
        source_url:
          "https://video.akamai.steamstatic.com/store_trailers/1174180/900001/reddead/hls_264_master.m3u8",
      },
    ],
    verified_store_targets: [
      {
        provider: "steam",
        entity: "Red Dead",
        store_app_id: "1174180",
        store_app_title: "Red Dead Redemption 2",
      },
    ],
    planned_searches: [
      {
        query: "Red Dead official trailer",
        entity: "Red Dead",
        accepted_sources: ["Steam", "IGDB", "official publisher channel", "platform storefront"],
        will_download: false,
      },
    ],
    ...overrides,
  };
}

test("alternate official source handoff turns exhausted motion gaps into entity work", () => {
  const report = buildAlternateOfficialSourceHandoffReport({
    motionGapReport: { gaps: [motionGap()] },
    referenceReport: { plans: [referencePlan()] },
  });

  assert.equal(report.summary.stories_needing_alternate_sources, 1);
  assert.equal(report.summary.entities_needing_alternate_sources, 1);
  assert.equal(report.safety.report_only, true);
  assert.equal(report.safety.downloads_media, false);

  const row = report.rows[0];
  assert.equal(row.story_id, "rss_gap");
  assert.equal(row.entity, "Red Dead");
  assert.equal(row.blocker, "resolved_references_exhausted_and_entity_still_missing_from_validated_motion");
  assert.equal(row.attempted_segments, 8);
  assert.equal(row.rejected_segments, 8);
  assert.equal(row.excluded_reference_count, 1);
  assert.equal(row.remaining_reference_count, 0);
  assert.equal(row.verified_store_targets[0].store_app_id, "1174180");
  assert.ok(row.recommended_source_types.some((item) => item.source_type === "platform_storefront_video_reference"));
  assert.ok(row.unsafe_source_types.includes("random YouTube reuploads"));
  assert.ok(row.next_actions.some((item) => item.includes("media:resolve-trailers")));
});

test("alternate official source handoff includes reference-only entities even without motion-gap status", () => {
  const report = buildAlternateOfficialSourceHandoffReport({
    motionGapReport: {
      gaps: [
        motionGap({
          motion_gap: {
            acquisition_strategy: {
              status: "continue_segment_scan",
              alternate_source_entities: [],
              entity_statuses: {},
            },
          },
        }),
      ],
    },
    referenceReport: { plans: [referencePlan()] },
  });

  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].blocker, "resolved_references_exhausted_before_segment_plan");
});

test("alternate official source handoff creates fallback search queries when reference plan is absent", () => {
  const report = buildAlternateOfficialSourceHandoffReport({
    motionGapReport: { gaps: [motionGap()] },
    referenceReport: { plans: [] },
  });

  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].entity, "Red Dead");
  assert.equal(report.rows[0].planned_search_count, 4);
  assert.ok(report.rows[0].planned_searches.every((item) => item.generated_fallback));
});

test("alternate official source handoff markdown is readable and safety-labelled", () => {
  const report = buildAlternateOfficialSourceHandoffReport({
    motionGapReport: {
      gaps: [
        motionGap({
          motion_gap: {
            acquisition_strategy: {
              status: "alternate_official_sources_required",
              alternate_source_entities: ["Red Dead"],
              entity_statuses: {
                "Red Dead": {
                  ...motionGap().motion_gap.acquisition_strategy.entity_statuses["Red Dead"],
                  source_families: [
                    {
                      provider: "steam",
                      store_app_title: "Marathon",
                      reference_title: "Marathon | Reveal Trailer",
                      attempted_segments: 6,
                      rejected_segments: 6,
                      top_rejection_reason: "segment_lacks_gameplay_action_samples",
                    },
                  ],
                },
              },
            },
          },
        }),
      ],
    },
    referenceReport: { plans: [referencePlan()] },
  });
  const md = renderAlternateOfficialSourceHandoffMarkdown(report);

  assert.match(md, /Alternate Official Source Handoff/);
  assert.match(md, /Red Dead/);
  assert.match(md, /No Railway, OAuth, DB/);
  assert.match(md, /official_publisher_or_developer_trailer_page/);
  assert.match(md, /Marathon \\| Reveal Trailer/);
});

test("studio:v2:alternate-sources command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["studio:v2:alternate-sources"], "node tools/alternate-official-source-handoff.js");
  const tool = fs.readFileSync(path.join(ROOT, "tools", "alternate-official-source-handoff.js"), "utf8");
  assert.match(tool, /alternate_official_source_handoff\.json/);
  assert.match(tool, /Does not download, render, call TTS, post, mutate DB, touch Railway or trigger OAuth/);
});
