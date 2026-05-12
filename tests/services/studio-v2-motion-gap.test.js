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
  assert.ok(
    gap.recommended_commands.some((item) =>
      /media:plan-frames -- --story-id rss_gap --trailer-references test\/output\/official_trailer_references_v1_story_rss_gap\.json/.test(
        item.command,
      ),
    ),
  );
  assert.ok(
    gap.recommended_commands.some((item) =>
      /media:validate-trailer-segments -- --story-id rss_gap .*--reference-report test\/output\/official_trailer_references_v1_story_rss_gap\.json/.test(
        item.command,
      ),
    ),
  );
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

test("motion gap report downgrades ready language when latest render proof has forensic warnings", () => {
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
            exact_subject_groups: ["Marathon"],
            accepted_frame_count: 9,
            frame_groups: ["Marathon"],
            validated_clip_ref_count: 7,
            validated_clip_source_count: 5,
            validated_clip_entities: ["Marathon"],
          },
          recommended_command: "npm run studio:v2:still-deck -- --story ready",
        }),
      ],
    },
    latestForensicReport: {
      storyId: "ready_enriched",
      summary: { verdict: "warn", failCount: 0, warnCount: 2 },
      visual: {
        repeatPairCount: 2,
        repeatPairs: [{ aTimeS: 46.5, bTimeS: 49.5 }],
        taste: {
          badFrameCount: 1,
          badFrames: [{ timeS: 22.5, reason: "washed_low_detail_frame" }],
        },
      },
      issues: [{ code: "rendered_frame_taste" }],
    },
  });

  const gap = report.gaps[0];
  assert.equal(gap.render_recommendation, "ready_for_local_flash_proof");
  assert.equal(gap.latest_render_proof.verdict, "warn");
  assert.equal(gap.latest_render_proof.needs_human_visual_review, true);
  assert.deepEqual(gap.latest_render_proof.repeat_pair_times, ["46.5s/49.5s"]);
  assert.deepEqual(gap.latest_render_proof.weak_frame_times, ["22.5s washed_low_detail_frame"]);
  assert.ok(gap.priority_next_steps.includes("review_latest_render_forensic_warnings_before_pilot"));
  assert.equal(report.summary.ready_flash_proofs_with_forensic_warnings, 1);

  const md = renderStudioV2MotionGapMarkdown(report);
  assert.match(md, /Latest render proof: warn/);
  assert.match(md, /22\.5s washed_low_detail_frame/);
});

test("motion gap report does not show render preflight when proof candidates block latest forensic warnings", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "warn_blocked",
          verdict: "needs_forensic_warning_repair",
          blockers: ["latest_render_forensic_warnings"],
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/audio/warn_blocked_liam.mp3",
            duration_seconds: 66.2,
          },
          visuals: {
            exact_subject_count: 8,
            exact_subject_groups: ["Marathon"],
            accepted_frame_count: 8,
            frame_groups: ["Marathon"],
            validated_clip_ref_count: 7,
            validated_clip_source_count: 5,
            validated_clip_entities: ["Marathon"],
          },
        }),
      ],
    },
    latestForensicReport: {
      storyId: "warn_blocked_enriched",
      summary: { verdict: "warn", failCount: 0, warnCount: 2 },
      visual: {
        repeatPairCount: 2,
        taste: { badFrameCount: 1, badFrames: [{ timeS: 16.5, reason: "dead_dark_frame" }] },
      },
      issues: [{ code: "visual_repetition" }],
    },
  });

  const gap = report.gaps[0];
  assert.equal(gap.render_recommendation, "do_not_render_yet");
  assert.ok(gap.priority_next_steps.includes("repair_motion_quality_before_next_proof"));
  assert.ok(!gap.priority_next_steps.includes("ready_for_local_flash_render_preflight"));
  assert.ok(!gap.recommended_commands.some((item) => /studio:v2:still-deck/.test(item.command)));
});

test("motion gap report preserves latest render proof supplied by proof candidates", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "candidate_forensic",
          blockers: ["latest_render_forensic_warnings"],
          latest_render_proof: {
            status: "available",
            verdict: "fail",
            fail_count: 1,
            warn_count: 1,
            needs_human_visual_review: true,
            issue_codes: ["audio_presence"],
            repeat_pair_count: 0,
            repeat_pair_times: [],
            weak_frame_count: 0,
            weak_frame_times: [],
            rating_or_title_frame_count: 0,
          },
        }),
      ],
    },
  });

  assert.equal(report.gaps[0].latest_render_proof.status, "available");
  assert.equal(report.gaps[0].latest_render_proof.verdict, "fail");
  assert.deepEqual(report.gaps[0].latest_render_proof.issue_codes, ["audio_presence"]);
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

test("motion gap report gives closest candidate a path from two validated sources to three-plus source backbone", () => {
  const fullTitle = "LEGO Batman: Legacy of the Dark Knight";
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "1t0zhng",
          title: "LEGO Batman: Legacy of the Dark Knight PC specs revealed",
          blockers: [
            "flash_proof_requires_motion_backbone",
            "flash_proof_requires_three_validated_clip_sources",
            "footage_backbone_clip_dominance_too_low",
          ],
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/local-script-extension/audio/1t0zhng_liam_extended.mp3",
            duration_seconds: 71.52,
          },
          visuals: {
            story_target_entities: ["LEGO Batman", "Legacy of the Dark Knight"],
            exact_subject_count: 24,
            exact_subject_groups: ["LEGO Batman"],
            accepted_frame_count: 0,
            frame_groups: [],
            validated_clip_ref_count: 4,
            validated_clip_source_count: 2,
            validated_clip_entities: ["LEGO Batman"],
            validated_clip_coverage_labels: [fullTitle],
            projected_clip_seconds: 11.6,
            projected_clip_dominance: 0.16,
          },
        }),
      ],
      thresholds: { flash_min_validated_clip_refs: 3 },
    },
    segmentValidationReport: {
      segments: [
        segment("1t0zhng", "LEGO Batman", null, {
          source_url: "https://video.example.test/lego-deluxe.m3u8",
          provider: "steam",
          store_app_id: "2215200",
          store_app_title: fullTitle,
          movie_id: "737714637",
          reference_title: "Deluxe Edition Trailer WW",
          media_start_s: 42,
        }),
        segment("1t0zhng", "LEGO Batman", null, {
          source_url: "https://video.example.test/lego-deluxe.m3u8",
          provider: "steam",
          store_app_id: "2215200",
          store_app_title: fullTitle,
          movie_id: "737714637",
          reference_title: "Deluxe Edition Trailer WW",
          media_start_s: 66,
        }),
        segment("1t0zhng", "LEGO Batman", null, {
          source_url: "https://video.example.test/lego-joker.m3u8",
          provider: "steam",
          store_app_id: "2215200",
          store_app_title: fullTitle,
          movie_id: "513615710",
          reference_title: "The Joker Cinematic Trailer WW",
          media_start_s: 48,
        }),
        segment("1t0zhng", "LEGO Batman", null, {
          source_url: "https://video.example.test/lego-joker.m3u8",
          provider: "steam",
          store_app_id: "2215200",
          store_app_title: fullTitle,
          movie_id: "513615710",
          reference_title: "The Joker Cinematic Trailer WW",
          media_start_s: 72,
        }),
        segment("1t0zhng", "LEGO Batman", "segment_lacks_gameplay_action_samples", {
          source_url: "https://video.example.test/lego-reveal.m3u8",
          provider: "steam",
          store_app_id: "2215200",
          store_app_title: fullTitle,
          movie_id: "1784773044",
          reference_title: "Reveal Trailer WW",
          media_start_s: 54,
        }),
      ],
    },
  });

  const gap = report.gaps[0];
  assert.equal(gap.story_id, "1t0zhng");
  assert.equal(gap.motion_gap.validated_clip_ref_count, 4);
  assert.equal(gap.motion_gap.motion_backbone_gap.required_validated_clip_sources, 3);
  assert.equal(gap.motion_gap.motion_backbone_gap.current_validated_clip_sources, 2);
  assert.equal(gap.motion_gap.motion_backbone_gap.missing_validated_clip_sources, 1);
  assert.equal(gap.motion_gap.motion_backbone_gap.status, "needs_additional_validated_source_family");
  assert.deepEqual(
    gap.motion_gap.motion_backbone_gap.validated_source_families.map((family) => family.reference_title),
    ["Deluxe Edition Trailer WW", "The Joker Cinematic Trailer WW"],
  );
  assert.ok(
    gap.motion_gap.motion_backbone_gap.next_actions.includes(
      "add_1_validated_official_source_family_for:LEGO Batman",
    ),
  );
  assert.ok(
    gap.motion_gap.source_coverage_warnings.includes(
      "multi_entity_coverage_satisfied_by_validated_labels:Legacy of the Dark Knight",
    ),
  );

  const md = renderStudioV2MotionGapMarkdown(report);
  assert.match(md, /Motion Backbone Gap/);
  assert.match(md, /Validated source families: 2 \/ 3\+/);
  assert.match(md, /Need 1 more validated official source family/);
  assert.match(md, /Deluxe Edition Trailer WW/);
  assert.match(md, /The Joker Cinematic Trailer WW/);
  assert.match(md, /\| Entity \| Provider \| App \| Movie\/source \| Attempts \| Validated \| Rejected \| Top rejection \|/);
  assert.match(md, /Source coverage warnings:/);
  assert.match(md, /multi_entity_coverage_satisfied_by_validated_labels:Legacy of the Dark Knight/);
});

test("motion gap report keeps missing entity coverage warnings separate from source diversity gaps", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "multi_entity_gap",
          blockers: [
            "flash_proof_requires_three_validated_clip_sources",
            "footage_backbone_clip_dominance_too_low",
          ],
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/audio/multi_entity_gap.mp3",
            duration_seconds: 70,
          },
          visuals: {
            story_target_entities: ["GTA", "BioShock", "Red Dead"],
            exact_subject_count: 10,
            exact_subject_groups: ["GTA", "BioShock", "Red Dead"],
            accepted_frame_count: 0,
            frame_groups: [],
            validated_clip_ref_count: 4,
            validated_clip_source_count: 2,
            validated_clip_entities: ["GTA"],
          },
        }),
      ],
      thresholds: { flash_min_validated_clip_refs: 3 },
    },
  });

  const gap = report.gaps[0];
  assert.equal(gap.motion_gap.motion_backbone_gap.missing_validated_clip_sources, 1);
  assert.deepEqual(gap.motion_gap.missing_validated_entities, ["BioShock", "Red Dead"]);
  assert.ok(
    gap.motion_gap.source_coverage_warnings.includes(
      "missing_validated_motion_entities:BioShock,Red Dead",
    ),
  );

  const md = renderStudioV2MotionGapMarkdown(report);
  assert.match(md, /Need 1 more validated official source family/);
  assert.match(md, /missing_validated_motion_entities:BioShock,Red Dead/);
});

test("motion gap report does not show ready language when footage dominance is too low", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "dominance_gap",
          blockers: [
            "footage_backbone_clip_dominance_too_low",
            "flash_proof_requires_footage_backbone_dominance",
          ],
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/audio/dominance_gap.mp3",
            duration_seconds: 72.48,
          },
          visuals: {
            exact_subject_count: 26,
            exact_subject_groups: ["GTA", "Red Dead", "BioShock"],
            accepted_frame_count: 2,
            frame_groups: ["GTA", "Red Dead"],
            validated_clip_ref_count: 5,
            validated_clip_source_count: 4,
            validated_clip_entities: ["BioShock", "Red Dead", "GTA"],
            footage_backbone_verdict: "needs_more_validated_footage",
            projected_clip_seconds: 16.7,
            projected_clip_dominance: 0.23,
            projected_motion_seconds: 21.7,
            projected_motion_dominance: 0.3,
          },
        }),
      ],
      thresholds: { flash_min_validated_clip_refs: 3 },
    },
    segmentValidationReport: {
      segments: [
        segment("dominance_gap", "GTA", null, { source_url: "https://video.example.test/gta-a.m3u8" }),
        segment("dominance_gap", "Red Dead", null, { source_url: "https://video.example.test/red-a.m3u8" }),
        segment("dominance_gap", "BioShock", null, { source_url: "https://video.example.test/bio-a.m3u8" }),
        segment("dominance_gap", "BioShock", null, { source_url: "https://video.example.test/bio-b.m3u8" }),
        segment("dominance_gap", "BioShock", null, { source_url: "https://video.example.test/bio-c.m3u8" }),
      ],
    },
  });

  const gap = report.gaps[0];
  const md = renderStudioV2MotionGapMarkdown(report);
  assert.equal(gap.render_recommendation, "do_not_render_yet");
  assert.equal(gap.motion_gap.needs_footage_backbone_dominance, true);
  assert.equal(gap.motion_gap.required_clip_seconds_for_dominance, 39.86);
  assert.equal(gap.motion_gap.missing_clip_seconds_for_dominance, 23.16);
  assert.ok(gap.priority_next_steps.includes("find_more_validated_gameplay_seconds_for_flash_lane"));
  assert.ok(!gap.priority_next_steps.includes("ready_for_local_flash_render_preflight"));
  assert.ok(gap.recommended_commands.some((item) => /media:validate-trailer-segments/.test(item.command)));
  assert.ok(!gap.recommended_commands.some((item) => /studio:v2:still-deck/.test(item.command)));
  assert.match(md, /Clip dominance shortfall: 23\.2s/);
});

test("motion gap report asks for alternate sources when partial validated footage is exhausted", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "marathon_partial",
          blockers: [
            "flash_proof_requires_motion_backbone",
            "flash_proof_requires_three_validated_clip_refs",
            "flash_proof_requires_three_validated_clip_sources",
          ],
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/audio/marathon.mp3",
            duration_seconds: 72,
          },
          visuals: {
            story_target_entities: ["Marathon"],
            exact_subject_count: 6,
            exact_subject_groups: ["Marathon"],
            accepted_frame_count: 0,
            frame_groups: [],
            validated_clip_ref_count: 2,
            validated_clip_source_count: 1,
            validated_clip_entities: ["Marathon"],
          },
        }),
      ],
      thresholds: { flash_min_validated_clip_refs: 3 },
    },
    segmentValidationReport: {
      segments: [
        segment("marathon_partial", "Marathon", null, {
          source_url: "https://video.example.test/marathon-gameplay.m3u8",
          media_start_s: 42,
        }),
        segment("marathon_partial", "Marathon", null, {
          source_url: "https://video.example.test/marathon-gameplay.m3u8",
          media_start_s: 60,
        }),
        ...Array.from({ length: 5 }, (_, index) =>
          segment("marathon_partial", "Marathon", "segment_lacks_gameplay_action_samples", {
            source_url: "https://video.example.test/marathon-gameplay.m3u8",
            media_start_s: 72 + index * 6,
          }),
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          segment("marathon_partial", "Marathon", "segment_samples_too_repetitive", {
            source_url: "https://video.example.test/marathon-loop.m3u8",
            media_start_s: 36 + index * 6,
          }),
        ),
      ],
    },
  });

  const gap = report.gaps[0];
  assert.equal(gap.motion_gap.acquisition_strategy.status, "alternate_official_sources_required");
  assert.deepEqual(gap.motion_gap.acquisition_strategy.alternate_source_entities, ["Marathon"]);
  assert.equal(gap.motion_gap.acquisition_strategy.entity_statuses.Marathon.status, "alternate_source_required");
  assert.ok(gap.priority_next_steps.includes("find_alternate_official_sources_for:Marathon"));
  assert.ok(gap.priority_next_steps.includes("do_not_rescan_same_official_sources_for:Marathon"));
});

test("motion gap report asks for alternate official sources when missing entities are exhausted", () => {
  const rejectedSegments = [
    ...Array.from({ length: 9 }, (_, index) =>
      segment("rss_gap", "GTA", index % 2 ? "segment_contains_black_frame" : "segment_contains_title_or_rating_card", {
        media_start_s: 24 + index * 6,
        source_url: "https://video.example.test/gta-official.m3u8",
        provider: "steam",
        movie_id: "gta-trailer-1",
        reference_title: "GTA official trailer",
        store_app_id: "3240220",
        store_app_title: "Grand Theft Auto V Enhanced",
      }),
    ),
    ...Array.from({ length: 8 }, (_, index) =>
      segment(
        "rss_gap",
        "Red Dead",
        index % 2 ? "segment_samples_too_repetitive" : "segment_contains_low_detail_frame",
        {
          media_start_s: 30 + index * 6,
          source_url: "https://video.example.test/red-dead-official.m3u8",
          provider: "steam",
          movie_id: "red-dead-trailer-1",
          reference_title: "Red Dead official trailer",
          store_app_id: "1174180",
          store_app_title: "Red Dead Redemption 2",
        },
      ),
    ),
  ];
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [proofCandidate()],
      thresholds: { flash_min_validated_clip_refs: 3 },
    },
    segmentValidationReport: {
      segments: [
        segment("rss_gap", "BioShock", null),
        segment("rss_gap", "BioShock", null, { source_url: "https://video.example.test/bioshock-2.m3u8" }),
        ...rejectedSegments,
      ],
    },
  });

  const gap = report.gaps[0];
  assert.equal(gap.motion_gap.acquisition_strategy.status, "alternate_official_sources_required");
  assert.deepEqual(gap.motion_gap.acquisition_strategy.alternate_source_entities, ["GTA", "Red Dead"]);
  assert.equal(gap.motion_gap.acquisition_strategy.entity_statuses.GTA.status, "alternate_source_required");
  assert.equal(gap.motion_gap.acquisition_strategy.entity_statuses["Red Dead"].status, "alternate_source_required");
  assert.equal(gap.motion_gap.acquisition_strategy.entity_statuses.BioShock.status, "validated");
  assert.equal(gap.motion_gap.acquisition_strategy.entity_statuses.GTA.source_family_count, 1);
  assert.equal(gap.motion_gap.acquisition_strategy.entity_statuses.GTA.source_families[0].movie_id, "gta-trailer-1");
  assert.equal(gap.motion_gap.acquisition_strategy.entity_statuses.GTA.source_families[0].attempted_segments, 9);
  assert.ok(gap.priority_next_steps.includes("find_alternate_official_sources_for:GTA,Red Dead"));
  assert.ok(gap.priority_next_steps.includes("do_not_rescan_same_official_sources_for:GTA,Red Dead"));
  assert.ok(
    gap.recommended_commands.some((item) =>
      /media:intake-official-sources -- --input test\/output\/official_source_intake_template\.json --story-id rss_gap/.test(
        item.command,
      ),
    ),
  );
  assert.ok(
    gap.recommended_commands.some((item) =>
      /media:resolve-trailers -- --story-id rss_gap --no-latest-report --official-source-intake-report test\/output\/official_source_intake_report\.json --segment-validation-report test\/output\/official_trailer_segment_validation_apply_local\.json --exhausted-source-family-threshold 5/.test(
        item.command,
      ),
    ),
  );
});

test("motion gap report refuses stale validated localised trailer segments", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "localised_ready",
          verdict: "ready_flash_proof",
          blockers: [],
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/audio/localised_ready.mp3",
            duration_seconds: 66,
          },
          visuals: {
            story_target_entities: ["GTA", "Red Dead", "BioShock"],
            exact_subject_count: 18,
            exact_subject_groups: ["GTA", "Red Dead", "BioShock"],
            accepted_frame_count: 8,
            frame_groups: ["GTA", "Red Dead", "BioShock"],
            validated_clip_ref_count: 3,
            validated_clip_source_count: 3,
            validated_clip_entities: ["GTA", "Red Dead", "BioShock"],
          },
          recommended_command: "npm run studio:v2:still-deck -- --story localised_ready",
        }),
      ],
      thresholds: { flash_min_validated_clip_refs: 3 },
    },
    segmentValidationReport: {
      segments: [
        segment("localised_ready", "GTA", null, {
          source_url: "https://video.example.test/gta-clean.m3u8",
          reference_title: "GTA official gameplay trailer",
        }),
        segment("localised_ready", "BioShock", null, {
          source_url: "https://video.example.test/bioshock-clean.m3u8",
          reference_title: "BioShock official gameplay trailer",
        }),
        segment("localised_ready", "Red Dead", null, {
          source_url: "https://video.example.test/red-dead-de.m3u8",
          provider: "steam",
          store_app_id: "1174180",
          store_app_title: "Red Dead Redemption 2",
          movie_id: "900002",
          reference_title: "RDR2 60 FPS Trailer (DE)",
        }),
      ],
    },
  });

  const gap = report.gaps[0];
  assert.equal(gap.render_recommendation, "do_not_render_yet");
  assert.ok(gap.blockers.includes("segment_validation_report_invalidates_ready_motion"));
  assert.equal(gap.motion_gap.validated_clip_ref_count, 2);
  assert.equal(gap.motion_gap.validated_clip_source_count, 2);
  assert.deepEqual(gap.motion_gap.validated_entities, ["GTA", "BioShock"]);
  assert.deepEqual(gap.motion_gap.missing_validated_entities, ["Red Dead"]);
  assert.equal(gap.motion_gap.rejection_reasons.segment_source_is_localised_non_english_reference, 1);
  assert.equal(
    gap.motion_gap.acquisition_strategy.entity_statuses["Red Dead"].top_rejection_reason,
    "segment_source_is_localised_non_english_reference",
  );
  assert.ok(!gap.recommended_commands.some((item) => /studio:v2:still-deck/.test(item.command)));
});

test("motion gap report backfills Steam source-family metadata from legacy source URLs", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [proofCandidate()],
      thresholds: { flash_min_validated_clip_refs: 3 },
    },
    segmentValidationReport: {
      segments: Array.from({ length: 8 }, (_, index) =>
        segment("rss_gap", "GTA", "segment_samples_too_repetitive", {
          source_url: "https://video.akamai.steamstatic.com/store_trailers/3240220/832632/4b8d5f06cf0a1/hls_264_master.m3u8",
          media_start_s: 36 + index * 6,
        }),
      ),
    },
  });

  const family = report.gaps[0].motion_gap.acquisition_strategy.entity_statuses.GTA.source_families[0];

  assert.equal(family.provider, "steam");
  assert.equal(family.store_app_id, "3240220");
  assert.equal(family.movie_id, "832632");
  assert.equal(family.reference_title, "Steam movie 832632");
  assert.equal(family.attempted_segments, 8);
});

test("motion gap report keeps first segment scan guidance for unattempted missing entities", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "unscanned_gap",
          visuals: {
            exact_subject_count: 6,
            exact_subject_groups: ["GTA", "Red Dead", "BioShock"],
            accepted_frame_count: 3,
            frame_groups: ["GTA", "Red Dead", "BioShock"],
            validated_clip_ref_count: 0,
            validated_clip_source_count: 0,
            validated_clip_entities: [],
          },
        }),
      ],
    },
    segmentValidationReport: { segments: [] },
  });

  const gap = report.gaps[0];
  assert.equal(gap.motion_gap.acquisition_strategy.status, "needs_first_segment_scan");
  assert.deepEqual(gap.motion_gap.acquisition_strategy.unattempted_entities, ["GTA", "Red Dead", "BioShock"]);
  assert.equal(gap.motion_gap.acquisition_strategy.alternate_source_entities.length, 0);
  assert.ok(gap.priority_next_steps.includes("run_initial_segment_scan_for:GTA,Red Dead,BioShock"));
  assert.doesNotMatch(gap.priority_next_steps.join(" "), /do_not_rescan_same_official_sources/);
});

test("motion gap report uses story target entities before exact asset groups", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "target_gap",
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/audio/target_gap.mp3",
            duration_seconds: 66,
          },
          visuals: {
            story_target_entities: ["GTA", "BioShock", "Red Dead"],
            exact_subject_count: 6,
            exact_subject_groups: ["GTA"],
            accepted_frame_count: 4,
            frame_groups: ["GTA"],
            validated_clip_ref_count: 3,
            validated_clip_source_count: 3,
            validated_clip_entities: ["GTA"],
          },
        }),
      ],
    },
  });

  const gap = report.gaps[0];
  assert.deepEqual(gap.motion_gap.story_entities, ["GTA", "BioShock", "Red Dead"]);
  assert.deepEqual(gap.motion_gap.missing_validated_entities, ["BioShock", "Red Dead"]);
  assert.ok(gap.priority_next_steps.includes("cover_missing_entities:BioShock,Red Dead"));
});

test("motion gap report treats verified full store titles as coverage for subtitle-style entity splits", () => {
  const fullTitle = "LEGO® Batman™: Legacy of the Dark Knight";
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "lego_split_gap",
          title: "LEGO Batman: Legacy of the Dark Knight PC specs revealed",
          blockers: ["flash_proof_requires_footage_backbone_dominance"],
          audio: {
            status: "approved_local_liam_audio_ready",
            ready: true,
            output_audio_path: "test/output/audio/lego_split_gap.mp3",
            duration_seconds: 68,
          },
          visuals: {
            story_target_entities: ["LEGO Batman", "Legacy of the Dark Knight"],
            exact_subject_count: 8,
            exact_subject_groups: ["LEGO Batman"],
            accepted_frame_count: 8,
            frame_groups: ["LEGO Batman"],
            validated_clip_ref_count: 4,
            validated_clip_source_count: 3,
            validated_clip_entities: ["LEGO Batman"],
            validated_clip_coverage_labels: [fullTitle],
            projected_clip_seconds: 14,
            projected_clip_dominance: 0.21,
          },
        }),
      ],
      thresholds: { flash_min_validated_clip_refs: 3 },
    },
    segmentValidationReport: {
      segments: Array.from({ length: 4 }, (_, index) =>
        segment("lego_split_gap", "LEGO Batman", null, {
          source_url: `https://video.example.test/lego-${index}.m3u8`,
          provider: "steam",
          store_app_id: "123456",
          store_app_title: fullTitle,
          movie_id: `lego-${index}`,
          reference_title: `${fullTitle} gameplay clip ${index}`,
          media_start_s: 42 + index * 6,
        }),
      ),
    },
  });

  const gap = report.gaps[0];
  assert.deepEqual(gap.motion_gap.story_entities, ["LEGO Batman", "Legacy of the Dark Knight"]);
  assert.deepEqual(gap.motion_gap.validated_entities, ["LEGO Batman"]);
  assert.deepEqual(gap.motion_gap.missing_validated_entities, []);
  assert.equal(gap.motion_gap.acquisition_strategy.status, "continue_segment_scan");
  assert.deepEqual(gap.motion_gap.acquisition_strategy.unattempted_entities, []);
  assert.doesNotMatch(gap.priority_next_steps.join(" "), /Legacy of the Dark Knight/);
  assert.doesNotMatch(gap.priority_next_steps.join(" "), /cover_missing_entities/);
});

test("motion gap markdown is operator-readable and local-only", () => {
  const report = buildStudioV2MotionGapReport({
    proofCandidateReport: { candidates: [proofCandidate()] },
    segmentValidationReport: {
      segments: Array.from({ length: 8 }, (_, index) =>
        segment("rss_gap", "GTA", "segment_contains_low_detail_frame", {
          media_start_s: 18 + index * 6,
          reference_title: index === 0 ? "Marathon | Reveal Trailer" : "GTA Trailer",
        }),
      ),
    },
  });
  const md = renderStudioV2MotionGapMarkdown(report);

  assert.match(md, /Studio V2 Motion Gap Planner/);
  assert.match(md, /do_not_render_yet/);
  assert.match(md, /Validated clip sources:/);
  assert.match(md, /Validated entities:/);
  assert.match(md, /Acquisition Strategy/);
  assert.match(md, /alternate_official_sources_required/);
  assert.match(md, /Source families/);
  assert.match(md, /Marathon \\| Reveal Trailer/);
  assert.match(md, /--previous-validation-report test\/output\/official_trailer_segment_validation_apply_local\.json --merge-previous/);
  assert.match(md, /--input test\/output\/official_source_intake_template\.json/);
  assert.doesNotMatch(md, /test\/input\/official_sources\.json/);
  assert.match(md, /local-only/);
  assert.match(md, /No DB, Railway, OAuth, render-default or posting changes/);
});

test("studio:v2:motion-gap command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["studio:v2:motion-gap"], "node tools/studio-v2-motion-gap.js");

  const tool = fs.readFileSync(path.join(ROOT, "tools", "studio-v2-motion-gap.js"), "utf8");
  assert.match(tool, /motion_gap_report\.json/);
  assert.match(tool, /MOTION_ACQUISITION_OVERNIGHT_REPORT\.md/);
  assert.match(tool, /--stdout-only/);
  assert.match(tool, /--no-root-report/);
  assert.match(tool, /--output-dir/);
  assert.doesNotMatch(tool, /publishAll|uploadShort|postShort|autonomous\/publish/);
  assert.doesNotMatch(tool, /UPDATE\s+stories|INSERT\s+INTO\s+stories|DELETE\s+FROM/i);
});
