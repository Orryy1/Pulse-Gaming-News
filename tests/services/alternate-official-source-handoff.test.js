"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildAlternateOfficialSourceHandoffReport,
  renderAlternateOfficialSourceHandoffMarkdown,
  buildSourceIntakeTemplate,
} = require("../../lib/ops/alternate-official-source-handoff");
const { parseArgs } = require("../../tools/alternate-official-source-handoff");

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
  assert.equal(row.manual_source_intake.default_downloads_allowed, false);
  assert.ok(row.manual_source_intake.required_fields.includes("official_source_url"));
  assert.ok(row.manual_source_intake.optional_fields.includes("direct_media_url_if_available"));
  assert.equal(row.manual_source_intake.url_handling.direct_media_url_required_for_segment_validation, true);
  assert.ok(row.manual_source_intake.url_handling.segment_validation_eligible_url_kinds.includes("hls_manifest"));
  assert.ok(row.manual_source_intake.url_handling.reference_only_url_kinds.includes("youtube_watch"));
  assert.ok(row.manual_source_intake.acceptance_checks.some((item) => item.includes("Red Dead")));
  assert.ok(row.manual_source_intake.acceptance_checks.some((item) => item.includes("direct_media_url_if_available")));
  assert.ok(row.manual_source_intake.rejection_checks.includes("unofficial_reupload"));
  assert.ok(row.manual_source_intake.rejection_checks.includes("direct_media_field_contains_page_url"));
  assert.ok(row.manual_source_intake.rejection_checks.includes("localised_non_english_reference"));
  assert.ok(row.manual_source_intake.rejection_checks.includes("embedded_subtitle_reference"));
  assert.ok(row.manual_source_intake.safe_next_commands.some((item) => item.includes("media:intake-official-sources")));
  assert.ok(
    row.manual_source_intake.safe_next_commands.some((item) =>
      item.includes("--input test/output/official_source_intake_template.json"),
    ),
  );
  assert.ok(row.next_actions.some((item) => item.includes("test/output/official_source_intake_template.json")));
  assert.ok(row.unsafe_source_types.includes("random YouTube reuploads"));
  assert.ok(row.unsafe_source_types.includes("localised or non-English trailer references for Flash Lane footage"));
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

test("alternate official source handoff can filter rows to one story", () => {
  const report = buildAlternateOfficialSourceHandoffReport({
    storyId: "rss_gap",
    motionGapReport: {
      gaps: [
        motionGap(),
        motionGap({
          story_id: "other_story",
          title: "Other story",
          motion_gap: {
            acquisition_strategy: {
              status: "alternate_official_sources_required",
              alternate_source_entities: ["Marathon"],
              entity_statuses: {},
            },
          },
        }),
      ],
    },
    referenceReport: {
      plans: [
        referencePlan(),
        { story_id: "other_story", alternate_reference_required_entities: ["Marathon"] },
      ],
    },
  });

  assert.equal(report.story_filter, "rss_gap");
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].story_id, "rss_gap");
  assert.equal(report.summary.source_intake_template_entries, 1);
  assert.equal(report.source_intake_template.entries[0].story_id, "rss_gap");
});

test("alternate official source handoff generates a fillable intake template", () => {
  const report = buildAlternateOfficialSourceHandoffReport({
    motionGapReport: { gaps: [motionGap()] },
    referenceReport: { plans: [referencePlan()] },
    storyId: "rss_gap",
  });
  const template = buildSourceIntakeTemplate(report.rows);
  const md = renderAlternateOfficialSourceHandoffMarkdown(report);

  assert.equal(template.length, 1);
  assert.equal(template[0].story_id, "rss_gap");
  assert.equal(template[0].entity, "Red Dead");
  assert.equal(template[0].official_source_url, "");
  assert.equal(template[0].official_source_url_usage.includes("provenance/reference"), true);
  assert.equal(template[0].direct_media_url_if_available, "");
  assert.equal(template[0].direct_media_url_kind, "");
  assert.match(template[0].direct_media_url_notes, /\.mp4/);
  assert.match(template[0].direct_media_url_notes, /\.m3u8/);
  assert.equal(template[0].downloads_allowed, false);
  assert.equal(template[0].source_family, "rss_gap_red_dead_alternate_official_source");
  assert.match(template[0].operator_notes, /Suggested searches: Red Dead official trailer/);
  assert.equal(report.source_intake_template.validation_command.includes("--story-id rss_gap"), true);
  assert.match(md, /Source Intake Template/);
  assert.match(md, /official_source_intake_template\.json/);
  assert.match(md, /direct_media_url_if_available/);
  assert.match(md, /reference-only/);
});

test("alternate official source handoff separates reference pages from direct media URLs", () => {
  const report = buildAlternateOfficialSourceHandoffReport({
    motionGapReport: { gaps: [motionGap()] },
    referenceReport: { plans: [referencePlan()] },
  });
  const intake = report.rows[0].manual_source_intake;
  const md = renderAlternateOfficialSourceHandoffMarkdown(report);

  assert.match(intake.url_handling.official_source_url, /reference page/);
  assert.match(intake.url_handling.direct_media_url_if_available, /direct \.mp4/);
  assert.deepEqual(intake.url_handling.segment_validation_eligible_url_kinds, [
    "direct_video",
    "hls_manifest",
    "dash_manifest",
  ]);
  assert.ok(intake.acceptance_checks.some((item) => item.includes("leave direct_media_url_if_available blank")));
  assert.ok(intake.acceptance_checks.some((item) => item.includes(".mpd")));
  assert.match(md, /URL handling/);
  assert.match(md, /HTML pages and official YouTube links are allowed/);
  assert.match(md, /Only direct media or manifest URLs can feed segment validation/);
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

test("alternate official source handoff flags stale reference reports", () => {
  const report = buildAlternateOfficialSourceHandoffReport({
    motionGapReport: { generated_at: "2026-05-07T10:00:00.000Z", gaps: [motionGap()] },
    referenceReport: { generated_at: "2026-05-07T09:00:00.000Z", plans: [referencePlan()] },
  });
  const md = renderAlternateOfficialSourceHandoffMarkdown(report);

  assert.equal(report.input_freshness.warnings[0].code, "reference_report_older_than_motion_gap");
  assert.equal(report.input_freshness.reference_counts_provisional, true);
  assert.match(md, /Input Freshness/);
  assert.match(md, /reference_report_older_than_motion_gap/);
  assert.match(md, /Remaining refs \(provisional\)/);
  assert.match(md, /media:resolve-trailers/);
});

test("alternate official source handoff does not describe exhausted references as keep-sampling", () => {
  const report = buildAlternateOfficialSourceHandoffReport({
    motionGapReport: {
      gaps: [
        motionGap({
          motion_gap: {
            acquisition_strategy: {
              alternate_source_entities: [],
              entity_statuses: {
                "Red Dead": {
                  status: "keep_sampling",
                  recommendation: "scan_remaining_references",
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

  assert.equal(report.rows[0].blocker, "resolved_references_exhausted_before_segment_plan");
  assert.equal(
    report.rows[0].motion_status,
    "current_references_exhausted_needs_new_official_source_before_sampling",
  );
  assert.doesNotMatch(md, /Motion status: keep_sampling/);
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
  assert.match(md, /Manual Official Source Intake/);
  assert.match(md, /official_source_url/);
  assert.match(md, /Downloads allowed by default: no/);
  assert.match(md, /Marathon \\| Reveal Trailer/);
});

test("alternate official source handoff rejects loose manual source intake paths", () => {
  const report = buildAlternateOfficialSourceHandoffReport({
    motionGapReport: { gaps: [motionGap()] },
    referenceReport: { plans: [referencePlan()] },
  });
  const intake = report.rows[0].manual_source_intake;

  assert.equal(intake.mode, "operator_supplied_reference_only");
  assert.equal(intake.apply_local_required_before_any_media_extraction, true);
  assert.ok(intake.accepted_source_types.some((item) => item.includes("official publisher")));
  assert.ok(intake.acceptance_checks.some((item) => item.includes("not only the publisher")));
  assert.ok(intake.acceptance_checks.some((item) => item.includes("localised/non-English trailer")));
  assert.ok(intake.acceptance_checks.some((item) => item.includes("baked-in subtitles")));
  assert.ok(intake.rejection_checks.includes("publisher_context_only"));
  assert.ok(intake.safe_next_commands.every((item) => item.startsWith("npm run ")));
});

test("studio:v2:alternate-sources command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["studio:v2:alternate-sources"], "node tools/alternate-official-source-handoff.js");
  const tool = fs.readFileSync(path.join(ROOT, "tools", "alternate-official-source-handoff.js"), "utf8");
  assert.match(tool, /alternate_official_source_handoff\.json/);
  assert.match(tool, /official_source_intake_template\.json/);
  assert.match(tool, /--story-id/);
  assert.match(tool, /Does not download, render, call TTS, post, mutate DB, touch Railway or trigger OAuth/);
});

test("studio:v2:alternate-sources CLI parses story filter and template output", () => {
  const args = parseArgs([
    "node",
    "tools/alternate-official-source-handoff.js",
    "--story",
    "rss_gap",
    "--template-output",
    "test/output/custom_intake_template.json",
  ]);

  assert.equal(args.storyId, "rss_gap");
  assert.match(args.templateOutput, /custom_intake_template\.json$/);
});
