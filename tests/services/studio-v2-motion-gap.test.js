"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildStudioV2MotionGapReport,
  renderStudioV2MotionGapMarkdown,
} = require("../../lib/ops/studio-v2-motion-gap");

const ROOT = path.resolve(__dirname, "..", "..");

function proofCandidate(overrides = {}) {
  return {
    story_id: "rss_gap",
    title: "GTA 6 Owner Passed On A Legacy Franchise",
    verdict: "needs_motion_or_exact_assets",
    next_action: "acquire_motion_frames_or_exact_subject_assets",
    blockers: [
      "approved_liam_audio_missing",
      "flash_proof_requires_three_validated_clip_refs",
    ],
    audio: {
      status: "approved_local_liam_audio_missing",
      ready: false,
      output_audio_path: null,
      duration_seconds: null,
    },
    visuals: {
      exact_subject_count: 26,
      exact_subject_groups: ["GTA", "Red Dead", "BioShock"],
      accepted_frame_count: 7,
      frame_groups: ["GTA", "Red Dead", "BioShock"],
      validated_clip_ref_count: 2,
      validated_clip_source_count: 2,
      validated_clip_entities: ["BioShock"],
    },
    ...overrides,
  };
}

function segment(storyId, entity, reason, overrides = {}) {
  return {
    story_id: storyId,
    entity,
    status: reason ? "rejected" : "validated",
    validation_reason: reason || "segment_samples_passed",
    allowed_for_flash_lane: !reason,
    segment_validated: !reason,
    segment_motion_class: !reason ? "gameplay_action" : "rejected",
    action_score: !reason ? 82 : 0,
    media_start_s: 42,
    source_url: `https://video.example.test/${entity.toLowerCase()}.m3u8`,
    samples: [
      {
        local_path: `C:/repo/test/output/official-trailer-segment-validation-v1/assets/${storyId}/${entity}.jpg`,
      },
    ],
    ...overrides,
  };
}

test("motion gap report explains why the closest Flash Lane proof is blocked", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [proofCandidate()],
      thresholds: { flash_min_validated_clip_refs: 3 },
    },
    segmentValidationReport: {
      segments: [
        segment("rss_gap", "BioShock", null),
        segment("rss_gap", "BioShock", null, { source_url: "https://video.example.test/bioshock-2.m3u8" }),
        segment("rss_gap", "GTA", "segment_contains_title_or_rating_card"),
        segment("rss_gap", "GTA", "segment_contains_black_frame", { media_start_s: 48 }),
        segment("rss_gap", "Red Dead", "segment_contains_low_detail_frame"),
      ],
    },
  });

  const gap = report.gaps[0];
  assert.equal(report.summary.ready_flash_proofs, 0);
  assert.equal(report.summary.blocked_flash_proofs, 1);
  assert.equal(gap.story_id, "rss_gap");
  assert.equal(gap.render_recommendation, "do_not_render_yet");
  assert.equal(gap.audio_gap.needs_liam_audio, true);
  assert.equal(gap.motion_gap.missing_validated_clip_refs, 1);
  assert.deepEqual(gap.motion_gap.validated_entities, ["BioShock"]);
  assert.deepEqual(gap.motion_gap.missing_validated_entities, ["GTA", "Red Dead"]);
  assert.equal(gap.motion_gap.rejection_reasons.segment_contains_title_or_rating_card, 1);
  assert.equal(gap.motion_gap.rejection_reasons.segment_contains_black_frame, 1);
  assert.equal(gap.motion_gap.rejection_reasons.segment_contains_low_detail_frame, 1);
  assert.ok(gap.priority_next_steps.includes("find_one_more_validated_gameplay_clip_window"));
  assert.ok(gap.priority_next_steps.includes("generate_approved_sleepy_liam_audio_after_visuals_are_ready"));
  assert.ok(gap.recommended_commands.some((item) => /media:validate-trailer-segments/.test(item.command)));
  assert.ok(gap.recommended_commands.some((item) => /media:resolve-trailers -- --story-id rss_gap/.test(item.command)));
  assert.ok(gap.recommended_commands.some((item) => /media:plan-frames -- --story-id rss_gap/.test(item.command)));
});

test("motion gap report preserves ready proof commands instead of blocking", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "ready",
          verdict: "ready_flash_proof",
          blockers: [],
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/audio/ready_liam.mp3",
            duration_seconds: 66.2,
          },
          visuals: {
            exact_subject_count: 8,
            exact_subject_groups: ["GTA", "Red Dead", "BioShock"],
            accepted_frame_count: 9,
            frame_groups: ["GTA", "Red Dead", "BioShock"],
            validated_clip_ref_count: 3,
            validated_clip_source_count: 3,
            validated_clip_entities: ["GTA", "Red Dead", "BioShock"],
          },
          recommended_command: "npm run studio:v2:still-deck -- --story ready",
        }),
      ],
    },
  });

  assert.equal(report.gaps[0].render_recommendation, "ready_for_local_flash_proof");
  assert.equal(report.gaps[0].audio_gap.needs_liam_audio, false);
  assert.deepEqual(report.gaps[0].blockers, []);
  assert.ok(report.gaps[0].recommended_commands.some((item) => item.command.includes("studio:v2:still-deck")));
});

test("motion gap report keeps Liam-ready visual gaps focused on acquisition", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "liam_ready_visual_gap",
          blockers: [
            "flash_proof_requires_motion_backbone",
            "flash_proof_requires_four_exact_subject_assets",
          ],
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/audio/liam.mp3",
            duration_seconds: 67.1,
          },
          visuals: {
            exact_subject_count: 0,
            exact_subject_groups: [],
            accepted_frame_count: 0,
            frame_groups: [],
            validated_clip_ref_count: 0,
            validated_clip_entities: [],
          },
        }),
      ],
    },
    segmentValidationReport: { segments: [] },
  });

  assert.equal(report.gaps[0].audio_gap.needs_liam_audio, false);
  assert.ok(report.gaps[0].priority_next_steps.includes("acquire_exact_subject_images_or_official_motion_refs"));
  assert.doesNotMatch(report.gaps[0].priority_next_steps.join(" "), /generate_approved_sleepy_liam/);
});

test("motion gap report ranks closest visual proof ahead of zero-inventory stories", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "audio_ready_zero_visuals",
          title: "High scoring but no media",
          blockers: [
            "flash_proof_requires_motion_backbone",
            "flash_proof_requires_three_validated_clip_refs",
            "flash_proof_requires_four_exact_subject_assets",
          ],
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/audio/high_score.mp3",
            duration_seconds: 67,
          },
          visuals: {
            exact_subject_count: 0,
            exact_subject_groups: [],
            accepted_frame_count: 0,
            frame_groups: [],
            validated_clip_ref_count: 0,
            validated_clip_entities: [],
          },
        }),
        proofCandidate({ story_id: "closest_visuals" }),
      ],
      thresholds: { flash_min_validated_clip_refs: 3 },
    },
  });

  assert.equal(report.summary.closest_story_id, "closest_visuals");
  assert.equal(report.gaps[0].story_id, "closest_visuals");
});

test("motion gap report explains source diversity gaps when clip count reaches three", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "three_refs_two_sources",
          blockers: ["flash_proof_requires_three_validated_clip_refs"],
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/audio/ready.mp3",
            duration_seconds: 70,
          },
          visuals: {
            exact_subject_count: 26,
            exact_subject_groups: ["GTA", "Red Dead", "BioShock"],
            accepted_frame_count: 12,
            frame_groups: ["GTA", "Red Dead", "BioShock"],
            validated_clip_ref_count: 3,
            validated_clip_source_count: 2,
            validated_clip_entities: ["BioShock"],
          },
        }),
      ],
      thresholds: { flash_min_validated_clip_refs: 3 },
    },
  });

  const gap = report.gaps[0];
  assert.equal(gap.motion_gap.missing_validated_clip_refs, 0);
  assert.equal(gap.motion_gap.missing_validated_clip_sources, 1);
  assert.ok(gap.priority_next_steps.includes("find_one_more_validated_clip_source"));
  assert.doesNotMatch(gap.priority_next_steps.join(" "), /find_0_more/);
});

test("motion gap markdown is operator-readable and local-only", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: { candidates: [proofCandidate()] },
  });
  const md = renderStudioV2MotionGapMarkdown(report);

  assert.match(md, /Studio V2 Motion Gap Planner/);
  assert.match(md, /do_not_render_yet/);
  assert.match(md, /Validated clip sources:/);
  assert.match(md, /Validated entities:/);
  assert.match(md, /local-only/);
  assert.match(md, /No DB, Railway, OAuth, render-default or posting changes/);
});

test("studio:v2:motion-gap command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["studio:v2:motion-gap"], "node tools/studio-v2-motion-gap.js");

  const tool = fs.readFileSync(path.join(ROOT, "tools", "studio-v2-motion-gap.js"), "utf8");
  assert.match(tool, /motion_gap_report\.json/);
  assert.match(tool, /MOTION_ACQUISITION_OVERNIGHT_REPORT\.md/);
  assert.doesNotMatch(tool, /publishAll|uploadShort|postShort|autonomous\/publish/);
  assert.doesNotMatch(tool, /UPDATE\s+stories|INSERT\s+INTO\s+stories|DELETE\s+FROM/i);
});
