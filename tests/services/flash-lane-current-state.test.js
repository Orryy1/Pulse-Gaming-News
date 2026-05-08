"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildFlashLaneCurrentStateReport,
  renderFlashLaneCurrentStateMarkdown,
  classifyCurrentState,
} = require("../../lib/ops/flash-lane-current-state");

const ROOT = path.resolve(__dirname, "..", "..");

function candidate(overrides = {}) {
  return {
    story_id: "story_readyish",
    title: "GTA 6 Owner Passed On A Legacy Franchise",
    priority: 90,
    verdict: "needs_motion_or_exact_assets",
    blockers: ["flash_proof_requires_exact_subject_entity_coverage"],
    audio: {
      ready: true,
      status: "approved_local_liam_audio_ready",
      duration_seconds: 67.2,
      output_audio_path: "test/output/audio/story_readyish.mp3",
    },
    visuals: {
      exact_subject_count: 8,
      exact_subject_groups: ["GTA", "BioShock", "Red Dead"],
      story_target_entities: ["GTA", "BioShock", "Red Dead"],
      accepted_frame_count: 0,
      validated_clip_ref_count: 3,
      validated_clip_source_count: 3,
      validated_clip_entities: ["GTA", "BioShock"],
      missing_validated_clip_entities: ["Red Dead"],
    },
    ...overrides,
  };
}

test("current state prioritises alternate official motion sources when an entity is exhausted", () => {
  const report = buildFlashLaneCurrentStateReport({
    proofCandidateReport: { candidates: [candidate()] },
    motionGapReport: {
      gaps: [
        {
          story_id: "story_readyish",
          title: "GTA 6 Owner Passed On A Legacy Franchise",
          motion_gap: {
            story_entities: ["GTA", "BioShock", "Red Dead"],
            validated_entities: ["GTA", "BioShock"],
            missing_validated_entities: ["Red Dead"],
            acquisition_strategy: { status: "alternate_official_sources_required" },
          },
        },
      ],
    },
    footageAcquisitionReport: {
      stories: [
        {
          story_id: "story_readyish",
          verdict: "needs_more_validated_footage",
          next_best_action: "find_alternate_official_source_or_downgrade_story",
          story_entities: ["GTA", "BioShock", "Red Dead"],
          validated_entities: ["GTA", "BioShock"],
        },
      ],
    },
    alternateSourceReport: {
      rows: [
        {
          story_id: "story_readyish",
          entity: "Red Dead",
          blocker: "resolved_references_exhausted_and_entity_still_missing_from_validated_motion",
          top_rejection_reason: "segment_contains_black_frame",
          planned_searches: [{ query: "Red Dead official gameplay trailer" }],
          next_actions: ["Then rerun: npm run studio:v2:motion-gap -- --story story_readyish"],
        },
      ],
    },
  });

  const row = report.rows[0];
  assert.equal(row.stage, "needs_alternate_official_motion_source");
  assert.equal(row.operator_next_action, "find_non_exhausted_official_motion_source");
  assert.deepEqual(row.acquisition.alternate_source_entities, ["Red Dead"]);
  assert.deepEqual(row.visuals.missing_motion_entities, ["Red Dead"]);
  assert.ok(row.recommended_commands.some((item) => item.command.includes("studio:v2:motion-gap")));
  assert.equal(report.summary.needs_alternate_official_motion_source, 1);
});

test("current state flags stale alternate-source handoffs and preserves motion-gap entities", () => {
  const report = buildFlashLaneCurrentStateReport({
    proofCandidateReport: { candidates: [candidate()] },
    motionGapReport: {
      generated_at: "2026-05-07T10:00:00.000Z",
      gaps: [
        {
          story_id: "story_readyish",
          title: "GTA 6 Owner Passed On A Legacy Franchise",
          motion_gap: {
            story_entities: ["GTA", "BioShock", "Red Dead"],
            validated_entities: ["BioShock"],
            missing_validated_entities: ["GTA", "Red Dead"],
            acquisition_strategy: {
              status: "alternate_official_sources_required",
              alternate_source_entities: ["GTA", "Red Dead"],
            },
          },
        },
      ],
    },
    alternateSourceReport: {
      generated_at: "2026-05-07T09:00:00.000Z",
      rows: [
        {
          story_id: "story_readyish",
          entity: "Red Dead",
          blocker: "local_segment_validation_exhausted_current_motion_sources",
          next_actions: [],
        },
      ],
    },
  });
  const md = renderFlashLaneCurrentStateMarkdown(report);

  assert.deepEqual(report.rows[0].acquisition.alternate_source_entities, ["GTA", "Red Dead"]);
  assert.equal(report.input_freshness.warnings[0].code, "alternate_source_report_older_than_motion_gap");
  assert.match(md, /alternate_source_report_older_than_motion_gap/);
  assert.match(md, /studio:v2:alternate-sources/);
});

test("current state reports ready local proofs when all blockers are cleared", () => {
  const report = buildFlashLaneCurrentStateReport({
    proofCandidateReport: {
      candidates: [
        candidate({
          story_id: "ready_story",
          verdict: "ready_flash_proof",
          blockers: [],
          recommended_command: "npm run studio:v2:still-deck -- --story ready_story",
          visuals: {
            exact_subject_count: 7,
            exact_subject_groups: ["Marathon"],
            story_target_entities: ["Marathon"],
            accepted_frame_count: 5,
            validated_clip_ref_count: 4,
            validated_clip_source_count: 3,
            validated_clip_entities: ["Marathon"],
            missing_validated_clip_entities: [],
          },
        }),
      ],
    },
  });

  assert.equal(report.rows[0].stage, "ready_for_local_flash_proof");
  assert.equal(report.rows[0].distance_to_local_proof, "ready");
  assert.equal(report.summary.ready_for_local_flash_proof, 1);
  assert.equal(report.rows[0].recommended_commands[0].command, "npm run studio:v2:still-deck -- --story ready_story");
});

test("current state does not hide missing Liam audio behind visual blockers", () => {
  const state = classifyCurrentState({
    candidate: candidate({
      audio: { ready: false, status: "approved_local_liam_audio_missing" },
      visuals: {
        exact_subject_count: 0,
        story_target_entities: ["GTA"],
        validated_clip_ref_count: 0,
        validated_clip_source_count: 0,
      },
    }),
  });

  assert.equal(state.stage, "needs_local_liam_audio");
  assert.ok(state.blocking_dimensions.includes("audio"));
  assert.ok(state.blocking_dimensions.includes("exact_subject_assets"));
  assert.ok(state.blocking_dimensions.includes("validated_motion"));
});

test("current state rejects out-of-range Liam audio even when the source report says ready", () => {
  const report = buildFlashLaneCurrentStateReport({
    proofCandidateReport: {
      candidates: [
        candidate({
          story_id: "short_audio",
          audio: {
            ready: true,
            status: "approved_local_liam_audio_ready",
            duration_seconds: 35.5,
            output_audio_path: "test/output/audio/short_audio.mp3",
          },
          visuals: {
            exact_subject_count: 8,
            validated_clip_ref_count: 4,
            validated_clip_source_count: 3,
            missing_validated_clip_entities: [],
          },
        }),
      ],
    },
  });

  assert.equal(report.rows[0].stage, "needs_liam_audio_duration_repair");
  assert.equal(report.rows[0].audio.ready, false);
  assert.ok(report.rows[0].blocking_dimensions.includes("audio_duration"));
  assert.equal(report.summary.needs_liam_audio_duration_repair, 1);
});

test("current state routes stories with no exact subject target instead of forcing blind asset hunts", () => {
  const report = buildFlashLaneCurrentStateReport({
    proofCandidateReport: {
      candidates: [
        candidate({
          story_id: "business_story",
          title: "Nintendo stopped selling products on Amazon",
          audio: {
            ready: true,
            status: "approved_local_liam_audio_ready",
            duration_seconds: 66.5,
            output_audio_path: "test/output/audio/business_story.mp3",
          },
          visuals: {
            exact_subject_count: 0,
            exact_subject_groups: [],
            story_target_entities: [],
            accepted_frame_count: 0,
            validated_clip_ref_count: 0,
            validated_clip_source_count: 0,
            validated_clip_entities: [],
            missing_validated_clip_entities: [],
          },
        }),
      ],
    },
    motionGapReport: {
      gaps: [
        {
          story_id: "business_story",
          recommended_commands: [{ command: "npm run media:resolve-trailers -- --story-id business_story" }],
        },
      ],
    },
  });

  assert.equal(report.rows[0].stage, "needs_format_router_decision");
  assert.equal(report.rows[0].operator_next_action, "route_to_briefing_or_context_card_lane");
  assert.ok(report.rows[0].blocking_dimensions.includes("format_route"));
  assert.deepEqual(report.rows[0].recommended_commands, []);
  assert.equal(report.summary.needs_format_router_decision, 1);
});

test("current state markdown is readable, escaped and safety labelled", () => {
  const report = buildFlashLaneCurrentStateReport({
    proofCandidateReport: {
      candidates: [
        candidate({
          story_id: "pipe_story",
          title: "GTA | BioShock story with Pok\u00c3\u00a9mon text",
        }),
      ],
    },
  });
  const md = renderFlashLaneCurrentStateMarkdown(report);

  assert.match(md, /Flash Lane Current State/);
  assert.match(md, /GTA \\| BioShock story with Pokémon text/);
  assert.match(md, /Does not download media, render video, call TTS, post, mutate the DB, touch Railway or trigger OAuth/);
  assert.doesNotMatch(md, /PokÃ/);
});

test("studio:v2:flash-state command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["studio:v2:flash-state"], "node tools/flash-lane-current-state.js");
  assert.equal(pkg.scripts["ops:flash-state"], "node tools/flash-lane-current-state.js");
  const tool = fs.readFileSync(path.join(ROOT, "tools", "flash-lane-current-state.js"), "utf8");
  assert.match(tool, /flash_lane_current_state\.json/);
  assert.match(tool, /Does not download, render, call TTS, post, mutate DB, touch Railway or trigger OAuth/);
});
