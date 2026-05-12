"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildStudioV2ProofCandidateReport,
  renderStudioV2ProofCandidatesMarkdown,
} = require("../../lib/ops/studio-v2-proof-candidates");

const ROOT = path.resolve(__dirname, "..", "..");

function story(id, title = "GTA and Red Dead trailer evidence is stacking up") {
  return {
    id,
    title,
    approved: true,
    breaking_score: 82,
    full_script: "GTA and Red Dead have a confirmed Take-Two clue today. ".repeat(32),
  };
}

function audioReport(storyId, overrides = {}) {
  return {
    applied: [
      {
        story_id: storyId,
        output_audio_path: `test/output/local-media-repair/audio/${storyId}_liam.mp3`,
        duration_seconds: 66.4,
        duration_verdict: "pass",
        text_word_count: 190,
        wpm: 172,
        acoustic: { medianPitchHz: 107 },
        transcript: "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
        local_voice_metadata: "stamped",
        local_voice_reference: {
          id: "pulse-sleepy-liam-20260502",
          fileName: "pulse_liam_sleepy.wav",
          referencePresent: true,
        },
        ...overrides,
      },
    ],
  };
}

function assetReport(storyId, count = 6) {
  return {
    plans: [
      {
        story_id: storyId,
        title: "GTA and Red Dead trailer evidence is stacking up",
        would_fetch: Array.from({ length: count }, (_, index) => ({
          id: `${storyId}_asset_${index}`,
          source_type: "steam_screenshot",
          entity: index % 2 === 0 ? "GTA" : "Red Dead",
          subject_match_quality: index % 2 === 0 ? "exact_game_match" : "exact_franchise_match",
          exact_subject_group: index % 2 === 0 ? "GTA" : "Red Dead",
          counted_for_premium: true,
          counted_for_standard: true,
          store_match_verified: true,
          local_path: `test/output/assets/${storyId}_${index}.jpg`,
        })),
      },
    ],
  };
}

function frameReport(storyId, count = 3) {
  return {
    plans: [
      {
        story_id: storyId,
        frames: Array.from({ length: count }, (_, index) => ({
          status: "accepted",
          entity: index % 2 === 0 ? "GTA" : "Red Dead",
          source_type: "steam_movie",
          source_url: `https://video.example.test/${storyId}_${index}.m3u8`,
          target_time_seconds: 44 + index,
          local_path: `test/output/frames/${storyId}_${index}.jpg`,
          qa: {
            verdict: "pass",
            failures: [],
            prescan: {
              edge_density: 0.24,
              saturation_mean: 0.46,
              text_overlay_likelihood: 0.04,
              white_text_on_dark_likelihood: 0,
            },
          },
        })),
      },
    ],
  };
}

function segmentReport(storyId, count = 3) {
  return {
    segments: Array.from({ length: count }, (_, index) => ({
      story_id: storyId,
      source_url: `https://video.example.test/${storyId}_${index}.m3u8`,
      entity: ["GTA", "Red Dead", "BioShock"][index % 3],
      media_start_s: 48 + index * 5,
      duration_s: 5,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      segment_motion_class: "gameplay_action",
      action_score: 82,
      action_sample_count: 3,
    })),
  };
}

test("proof candidates mark motion-backed Liam stories ready for a Studio V2 proof", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [story("ready")],
    localAudioReports: [audioReport("ready")],
    assetReports: [assetReport("ready", 7)],
    frameReports: [frameReport("ready", 10)],
    segmentValidationReports: [segmentReport("ready", 10)],
  });

  assert.equal(report.summary.ready_flash_proof, 1);
  assert.equal(report.candidates[0].verdict, "ready_flash_proof");
  assert.equal(report.candidates[0].audio.status, "approved_local_liam_audio_ready");
  assert.equal(report.candidates[0].visuals.motion_backbone_ready, true);
  assert.match(report.candidates[0].recommended_command, /studio:v2:still-deck/);
  assert.match(report.candidates[0].recommended_command, /--segment-validation-report/);
  assert.match(report.candidates[0].recommended_command, /--use-official-trailer-clips/);
  assert.match(report.candidates[0].recommended_command, /--with-sound-design/);
});

test("proof readiness packet recommends a local proof only when voice, captions, overlays and cover are ready", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [
      {
        ...story("ready_packet"),
        hf_thumbnail_path: "output/thumbnails/ready_packet.jpg",
      },
    ],
    localAudioReports: [
      audioReport("ready_packet", {
        timestamps_path: "test/output/audio/ready_packet_timestamps.json",
        timestamp_word_count: 154,
        caption_coverage_ratio: 0.97,
        caption_max_gap_s: 1.1,
      }),
    ],
    assetReports: [assetReport("ready_packet", 7)],
    frameReports: [frameReport("ready_packet", 10)],
    segmentValidationReports: [segmentReport("ready_packet", 10)],
    stillDeckReports: [
      {
        story_id: "ready_packet",
        render_readiness: {
          verdict: "render_ready",
          readinessClass: "green",
          blockers: [],
          warnings: [],
          storyBeatOverlayCount: 2,
          requiredBeatOverlayMinimum: 2,
        },
      },
    ],
  });

  const readiness = report.candidates[0].proof_readiness;
  assert.equal(readiness.final_recommendation, "render_local_proof");
  assert.equal(readiness.runtime_target.status, "pass");
  assert.deepEqual(readiness.runtime_target.target_seconds, [64, 70]);
  assert.equal(readiness.approved_voice_evidence.status, "pass");
  assert.equal(readiness.caption.status, "pass");
  assert.equal(readiness.overlay_safe_area.status, "pass");
  assert.equal(readiness.thumbnail_cover.status, "pass");
  assert.equal(readiness.exact_subject_visual_count, 7);
  assert.equal(readiness.validated_frame_count, 10);
  assert.equal(readiness.validated_clip_count, 10);
  assert.equal(readiness.bad_frame_rejection_count, 0);
  assert.equal(readiness.outro_expected.status, "pass");
});

test("proof readiness packet sends edge-duration Liam proofs back to voice repair", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [story("edge_duration")],
    localAudioReports: [
      audioReport("edge_duration", {
        duration_seconds: 61.4,
      }),
    ],
    assetReports: [assetReport("edge_duration", 7)],
    frameReports: [frameReport("edge_duration", 10)],
    segmentValidationReports: [segmentReport("edge_duration", 10)],
  });

  const readiness = report.candidates[0].proof_readiness;
  assert.equal(readiness.runtime_target.status, "fail");
  assert.deepEqual(readiness.runtime_target.target_seconds, [64, 70]);
  assert.equal(readiness.final_recommendation, "repair_voice_first");
});

test("proof readiness packet prioritises voice repair before media repair", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [story("voice_first")],
    localAudioReports: [
      audioReport("voice_first", {
        local_voice_reference: { id: "old-local-voice", referencePresent: true },
      }),
    ],
    assetReports: [assetReport("voice_first", 7)],
    frameReports: [frameReport("voice_first", 10)],
    segmentValidationReports: [segmentReport("voice_first", 10)],
  });

  const readiness = report.candidates[0].proof_readiness;
  assert.equal(readiness.final_recommendation, "repair_voice_first");
  assert.equal(readiness.approved_voice_evidence.status, "fail");
});

test("proof readiness packet rejects wrong-story exact visual evidence", () => {
  const storyId = "reject_wrong_story_packet";
  const report = buildStudioV2ProofCandidateReport({
    stories: [
      {
        ...story(storyId, "GTA and Red Dead sequel rumours get new Take-Two context"),
        full_script:
          "Take-Two has new context for GTA and Red Dead fans after passing on a legacy sequel pitch.",
      },
    ],
    localAudioReports: [audioReport(storyId)],
    assetReports: [
      {
        plans: [
          {
            story_id: storyId,
            would_fetch: [
              ...assetReport(storyId, 4).plans[0].would_fetch,
              {
                id: `${storyId}_wrong`,
                source_type: "steam_screenshot",
                entity: "Metro 2033",
                subject_match_quality: "exact_game_match",
                exact_subject_group: "Metro 2033",
                counted_for_premium: true,
                counted_for_standard: true,
                store_match_verified: true,
                local_path: `test/output/assets/${storyId}_wrong.jpg`,
              },
            ],
          },
        ],
      },
    ],
    frameReports: [frameReport(storyId, 10)],
    segmentValidationReports: [segmentReport(storyId, 10)],
  });

  const readiness = report.candidates[0].proof_readiness;
  assert.equal(readiness.final_recommendation, "reject");
  assert.equal(readiness.stale_wrong_story_risk.status, "fail");
});

test("proof candidates require Liam audio before a visual-ready render", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [story("needs_audio")],
    assetReports: [assetReport("needs_audio", 8)],
    frameReports: [frameReport("needs_audio", 10)],
    segmentValidationReports: [segmentReport("needs_audio", 10)],
  });

  assert.equal(report.candidates[0].verdict, "needs_liam_audio_then_flash_proof");
  assert.ok(report.candidates[0].blockers.includes("approved_liam_audio_missing"));
  assert.equal(report.candidates[0].next_action, "generate_sleepy_liam_audio");
});

test("proof candidates reject local audio without accepted Liam proof evidence", () => {
  const storyId = "weak_audio_evidence";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [
      audioReport(storyId, {
        local_voice_reference: {
          id: "old-local-voice",
          referencePresent: true,
        },
      }),
    ],
    assetReports: [assetReport(storyId, 8)],
    frameReports: [frameReport(storyId, 10)],
    segmentValidationReports: [segmentReport(storyId, 10)],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_liam_audio_then_flash_proof");
  assert.equal(candidate.audio.ready, false);
  assert.equal(candidate.audio.proof_failure_code, "unaccepted_local_voice_reference");
  assert.ok(candidate.blockers.includes("approved_liam_audio_missing"));
});

test("proof candidates reject local audio with demonic low voice risk", () => {
  const storyId = "low_voice_audio";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [
      audioReport(storyId, {
        acoustic: { medianPitchHz: 61 },
      }),
    ],
    assetReports: [assetReport(storyId, 8)],
    frameReports: [frameReport(storyId, 10)],
    segmentValidationReports: [segmentReport(storyId, 10)],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_liam_audio_then_flash_proof");
  assert.equal(candidate.audio.ready, false);
  assert.equal(candidate.audio.proof_failure_code, "demonic_low_voice_risk");
  assert.ok(candidate.blockers.includes("approved_liam_audio_missing"));
});

test("proof candidates block Liam-ready stories with weak still-only visual packages", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [story("weak_visual")],
    localAudioReports: [audioReport("weak_visual")],
    assetReports: [assetReport("weak_visual", 3)],
    frameReports: [frameReport("weak_visual", 0)],
    segmentValidationReports: [segmentReport("weak_visual", 0)],
    stillDeckReports: [
      {
        story_id: "weak_visual",
        render_package_gate: {
          verdict: "block",
          blockers: ["still_deck_too_thin_for_render"],
        },
      },
    ],
  });

  assert.equal(report.candidates[0].verdict, "needs_motion_or_exact_assets");
  assert.ok(report.candidates[0].blockers.includes("flash_proof_requires_motion_backbone"));
  assert.ok(report.candidates[0].blockers.includes("still_deck_too_thin_for_render"));
  assert.doesNotMatch(report.candidates[0].recommended_command || "", /still-deck/);
});

test("proof candidates require enough validated gameplay clip refs, not just still frames", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [story("one_clip")],
    localAudioReports: [audioReport("one_clip")],
    assetReports: [assetReport("one_clip", 7)],
    frameReports: [frameReport("one_clip", 5)],
    segmentValidationReports: [segmentReport("one_clip", 1)],
  });

  assert.equal(report.candidates[0].verdict, "needs_motion_or_exact_assets");
  assert.ok(report.candidates[0].blockers.includes("flash_proof_requires_three_validated_clip_refs"));
  assert.equal(report.candidates[0].visuals.validated_clip_ref_count, 1);
});

test("proof candidates do not count stale localised validated segment rows", () => {
  const storyId = "localised_segment_row";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [assetReport(storyId, 7)],
    frameReports: [frameReport(storyId, 5)],
    segmentValidationReports: [
      {
        segments: [
          ...segmentReport(storyId, 2).segments,
          {
            story_id: storyId,
            source_url: "https://video.example.test/reddead-de.m3u8",
            entity: "Red Dead",
            reference_title: "RDR2 60 FPS Trailer (DE)",
            media_start_s: 58,
            duration_s: 5,
            status: "validated",
            segment_validated: true,
            allowed_for_flash_lane: true,
            segment_motion_class: "gameplay_action",
            action_score: 88,
            action_sample_count: 3,
          },
        ],
      },
    ],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_motion_or_exact_assets");
  assert.equal(candidate.visuals.validated_clip_ref_count, 2);
  assert.ok(candidate.blockers.includes("flash_proof_requires_three_validated_clip_refs"));
});

test("proof candidates require enough validated clip seconds for Flash Lane dominance", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [story("short_clip_backbone")],
    localAudioReports: [audioReport("short_clip_backbone")],
    assetReports: [assetReport("short_clip_backbone", 7)],
    frameReports: [frameReport("short_clip_backbone", 5)],
    segmentValidationReports: [segmentReport("short_clip_backbone", 5)],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_motion_or_exact_assets");
  assert.equal(candidate.visuals.validated_clip_ref_count, 5);
  assert.equal(candidate.visuals.footage_backbone_ready, false);
  assert.equal(candidate.visuals.footage_backbone_verdict, "needs_more_validated_footage");
  assert.ok(candidate.blockers.includes("flash_proof_requires_footage_backbone_dominance"));
  assert.ok(candidate.blockers.includes("footage_backbone_clip_dominance_too_low"));
  assert.equal(candidate.recommended_command, null);
});

test("proof candidates let validated footage satisfy motion backbone without standalone frames", () => {
  const storyId = "footage_backbone_only";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [assetReport(storyId, 8)],
    frameReports: [frameReport(storyId, 0)],
    segmentValidationReports: [segmentReport(storyId, 12)],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "ready_flash_proof");
  assert.equal(candidate.visuals.frame_motion_backbone_ready, false);
  assert.equal(candidate.visuals.footage_motion_backbone_ready, true);
  assert.equal(candidate.visuals.motion_backbone_ready, true);
  assert.ok(!candidate.blockers.includes("flash_proof_requires_motion_backbone"));
  assert.match(candidate.recommended_command, /--use-official-trailer-clips/);
});

test("proof candidates do not count accepted frames with failing visual taste metadata", () => {
  const storyId = "bad_taste_frame";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [assetReport(storyId, 7)],
    frameReports: [
      {
        plans: [
          {
            story_id: storyId,
            frames: [
              {
                status: "accepted",
                entity: "GTA",
                source_type: "steam_movie",
                local_path: `test/output/frames/${storyId}_dead_dark.jpg`,
                qa: {
                  verdict: "pass",
                  failures: [],
                  content_hash: "dead-dark",
                  visual_taste: {
                    verdict: "fail",
                    reason: "dead_dark_frame",
                  },
                },
              },
              {
                status: "accepted",
                entity: "Red Dead",
                source_type: "steam_movie",
                local_path: `test/output/frames/${storyId}_good.jpg`,
                qa: { verdict: "pass", failures: [], content_hash: "good-frame" },
              },
            ],
          },
        ],
      },
    ],
    segmentValidationReports: [segmentReport(storyId, 3)],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_motion_or_exact_assets");
  assert.equal(candidate.visuals.accepted_frame_count, 1);
  assert.equal(candidate.visuals.motion_backbone_ready, false);
  assert.ok(candidate.blockers.includes("flash_proof_requires_motion_backbone"));
});

test("proof candidates distinguish source diversity gaps from missing clip count", () => {
  const storyId = "same_source";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [assetReport(storyId, 7)],
    frameReports: [frameReport(storyId, 5)],
    segmentValidationReports: [
      {
        segments: Array.from({ length: 3 }, (_, index) => ({
          story_id: storyId,
          source_url: "https://video.example.test/one-official-source.m3u8",
          entity: ["GTA", "Red Dead", "BioShock"][index],
          media_start_s: 42 + index * 6,
          status: "validated",
          segment_validated: true,
          allowed_for_flash_lane: true,
          segment_motion_class: "gameplay_action",
        })),
      },
    ],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_motion_or_exact_assets");
  assert.equal(candidate.visuals.validated_clip_ref_count, 3);
  assert.equal(candidate.visuals.validated_clip_source_count, 1);
  assert.ok(candidate.blockers.includes("flash_proof_requires_three_validated_clip_sources"));
  assert.ok(!candidate.blockers.includes("flash_proof_requires_three_validated_clip_refs"));
});

test("proof candidates require validated entity coverage for multi-game stories", () => {
  const storyId = "single_entity_motion";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [assetReport(storyId, 7)],
    frameReports: [frameReport(storyId, 5)],
    segmentValidationReports: [
      {
        segments: Array.from({ length: 3 }, (_, index) => ({
          story_id: storyId,
          source_url: `https://video.example.test/bioshock_${index}.m3u8`,
          entity: "BioShock",
          media_start_s: 42 + index * 6,
          status: "validated",
          segment_validated: true,
          allowed_for_flash_lane: true,
          segment_motion_class: "gameplay_action",
        })),
      },
    ],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_motion_or_exact_assets");
  assert.equal(candidate.visuals.validated_clip_ref_count, 3);
  assert.deepEqual(candidate.visuals.validated_clip_entities, ["BioShock"]);
  assert.ok(candidate.blockers.includes("flash_proof_requires_validated_entity_coverage"));
  assert.ok(!candidate.recommended_command);
});

test("proof candidates use script target entities to block single-game assets on multi-franchise stories", () => {
  const storyId = "take_two_multi_target";
  const report = buildStudioV2ProofCandidateReport({
    stories: [
      {
        ...story(storyId, "Take-Two killed a mystery sequel while GTA, Red Dead and BioShock fans watched"),
        full_script:
          "Take-Two just passed on a legacy sequel. GTA, Red Dead and BioShock fans all have a reason to care because the missing game could sit inside any of those worlds.",
      },
    ],
    localAudioReports: [audioReport(storyId)],
    assetReports: [
      {
        plans: [
          {
            story_id: storyId,
            would_fetch: Array.from({ length: 6 }, (_, index) => ({
              id: `${storyId}_gta_${index}`,
              source_type: "steam_screenshot",
              entity: "GTA",
              subject_match_quality: "exact_game_match",
              exact_subject_group: "GTA",
              counted_for_premium: true,
              counted_for_standard: true,
              store_match_verified: true,
              local_path: `test/output/assets/${storyId}_${index}.jpg`,
            })),
          },
        ],
      },
    ],
    frameReports: [frameReport(storyId, 4)],
    segmentValidationReports: [
      {
        segments: Array.from({ length: 3 }, (_, index) => ({
          story_id: storyId,
          source_url: `https://video.example.test/gta_${index}.m3u8`,
          entity: "GTA",
          media_start_s: 42 + index * 6,
          status: "validated",
          segment_validated: true,
          allowed_for_flash_lane: true,
          segment_motion_class: "gameplay_action",
        })),
      },
    ],
  });

  const candidate = report.candidates[0];
  assert.deepEqual(candidate.visuals.story_target_entities, ["GTA", "BioShock", "Red Dead"]);
  assert.deepEqual(candidate.visuals.exact_subject_groups, ["GTA"]);
  assert.deepEqual(candidate.visuals.exact_subject_motion_groups, ["GTA", "Red Dead"]);
  assert.deepEqual(candidate.visuals.missing_exact_subject_entities, ["BioShock"]);
  assert.deepEqual(candidate.visuals.missing_validated_clip_entities, ["BioShock", "Red Dead"]);
  assert.equal(candidate.verdict, "needs_motion_or_exact_assets");
  assert.ok(candidate.blockers.includes("flash_proof_requires_exact_subject_entity_coverage"));
  assert.ok(candidate.blockers.includes("flash_proof_requires_validated_entity_coverage"));
  assert.equal(candidate.recommended_command, null);
});

test("proof candidates let validated official clips cover exact-subject entity gaps", () => {
  const storyId = "take_two_motion_covers_targets";
  const report = buildStudioV2ProofCandidateReport({
    stories: [
      {
        ...story(storyId, "Take-Two killed a mystery sequel while GTA, Red Dead and BioShock fans watched"),
        full_script:
          "Take-Two just passed on a legacy sequel. GTA, Red Dead and BioShock fans all have a reason to care because the missing game could sit inside any of those worlds.",
      },
    ],
    localAudioReports: [audioReport(storyId)],
    assetReports: [
      {
        plans: [
          {
            story_id: storyId,
            would_fetch: Array.from({ length: 6 }, (_, index) => ({
              id: `${storyId}_gta_${index}`,
              source_type: "steam_screenshot",
              entity: "GTA",
              subject_match_quality: "exact_game_match",
              exact_subject_group: "GTA",
              counted_for_premium: true,
              counted_for_standard: true,
              store_match_verified: true,
              local_path: `test/output/assets/${storyId}_${index}.jpg`,
            })),
          },
        ],
      },
    ],
    frameReports: [frameReport(storyId, 10)],
    segmentValidationReports: [segmentReport(storyId, 10)],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "ready_flash_proof");
  assert.deepEqual(candidate.visuals.story_target_entities, ["GTA", "BioShock", "Red Dead"]);
  assert.deepEqual(candidate.visuals.exact_subject_groups, ["GTA"]);
  assert.deepEqual(candidate.visuals.exact_subject_motion_groups, ["GTA", "Red Dead", "BioShock"]);
  assert.deepEqual(candidate.visuals.missing_exact_subject_entities, []);
  assert.ok(!candidate.blockers.includes("flash_proof_requires_exact_subject_entity_coverage"));
  assert.match(candidate.recommended_command, /--use-official-trailer-clips/);
});

test("proof candidates block stale ready proof commands when the latest render has forensic warnings", () => {
  const storyId = "warned_render";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [{ generated_at: "2026-05-05T10:00:00.000Z", ...assetReport(storyId, 7) }],
    frameReports: [{ generated_at: "2026-05-05T11:00:00.000Z", ...frameReport(storyId, 10) }],
    segmentValidationReports: [{ generated_at: "2026-05-05T12:00:00.000Z", ...segmentReport(storyId, 10) }],
    latestForensicReports: [
      {
        storyId: `${storyId}_enriched`,
        generatedAt: "2026-05-06T12:00:00.000Z",
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
    ],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_forensic_warning_repair");
  assert.ok(candidate.blockers.includes("latest_render_forensic_warnings"));
  assert.equal(candidate.latest_render_proof.verdict, "warn");
  assert.equal(candidate.latest_render_proof.visual_inputs_are_newer, false);
  assert.deepEqual(candidate.latest_render_proof.repeat_pair_times, ["46.5s/49.5s"]);
  assert.deepEqual(candidate.latest_render_proof.weak_frame_times, ["22.5s washed_low_detail_frame"]);
  assert.equal(candidate.recommended_command, null);
  assert.equal(report.summary.needs_forensic_warning_repair, 1);
});

test("proof candidates require verified store matches before Steam exact assets count", () => {
  const storyId = "unverified_store_exact";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [
      {
        plans: [
          {
            story_id: storyId,
            would_fetch: Array.from({ length: 6 }, (_, index) => ({
              id: `${storyId}_steam_${index}`,
              source_type: "steam_screenshot",
              entity: index % 2 === 0 ? "GTA" : "Red Dead",
              subject_match_quality: "exact_game_match",
              exact_subject_group: index % 2 === 0 ? "GTA" : "Red Dead",
              counted_for_premium: true,
              counted_for_standard: true,
              local_path: `test/output/assets/${storyId}_${index}.jpg`,
            })),
          },
        ],
      },
    ],
    frameReports: [frameReport(storyId, 10)],
    segmentValidationReports: [segmentReport(storyId, 10)],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_motion_or_exact_assets");
  assert.equal(candidate.visuals.exact_subject_count, 0);
  assert.ok(candidate.blockers.includes("flash_proof_requires_verified_store_exact_assets"));
  assert.ok(candidate.blockers.includes("flash_proof_requires_four_exact_subject_assets"));
});

test("proof candidates block Flash proofs when exact assets are cover dominated", () => {
  const storyId = "cover_dominated_exact";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [
      {
        plans: [
          {
            story_id: storyId,
            would_fetch: Array.from({ length: 6 }, (_, index) => ({
              id: `${storyId}_cover_${index}`,
              source_type: index % 2 === 0 ? "steam_capsule" : "igdb_cover",
              entity: index % 2 === 0 ? "GTA" : "Red Dead",
              subject_match_quality: "exact_game_match",
              exact_subject_group: index % 2 === 0 ? "GTA" : "Red Dead",
              counted_for_premium: true,
              counted_for_standard: true,
              store_match_verified: true,
              local_path: `test/output/assets/${storyId}_${index}.jpg`,
            })),
          },
        ],
      },
    ],
    frameReports: [frameReport(storyId, 10)],
    segmentValidationReports: [segmentReport(storyId, 10)],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_motion_or_exact_assets");
  assert.ok(candidate.blockers.includes("flash_proof_blocks_cover_dominated_exact_assets"));
  assert.equal(candidate.visuals.cover_dominated_exact_asset_count, 6);
  assert.equal(candidate.visuals.cover_dominated_exact_asset_share, 1);
});

test("proof candidates count gameplay-still repairs against cover domination", () => {
  const storyId = "cover_repaired_with_gameplay_stills";
  const coverReport = {
    plans: [
      {
        story_id: storyId,
        would_fetch: Array.from({ length: 4 }, (_, index) => ({
          id: `${storyId}_cover_${index}`,
          source_type: index % 2 === 0 ? "steam_capsule" : "igdb_cover",
          entity: index % 2 === 0 ? "GTA" : "Red Dead",
          subject_match_quality: "exact_game_match",
          exact_subject_group: index % 2 === 0 ? "GTA" : "Red Dead",
          counted_for_premium: true,
          counted_for_standard: true,
          store_match_verified: true,
          local_path: `test/output/assets/${storyId}_cover_${index}.jpg`,
        })),
      },
    ],
  };
  const gameplayRepairReport = {
    plans: [
      {
        story_id: storyId,
        visual_evidence_repair: {
          prefer_gameplay_stills: true,
          accepted_gameplay_stills: 5,
          accepted_cover_like_stills: 0,
        },
        applied_assets: Array.from({ length: 5 }, (_, index) => ({
          id: `${storyId}_gameplay_${index}`,
          source_type: "steam_screenshot",
          entity: index % 2 === 0 ? "GTA" : "Red Dead",
          subject_match_quality: "exact_game_match",
          exact_subject_group: index % 2 === 0 ? "GTA" : "Red Dead",
          counted_for_premium: true,
          counted_for_standard: true,
          store_match_verified: true,
          local_path: `test/output/assets/${storyId}_gameplay_${index}.jpg`,
        })),
      },
    ],
  };

  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [gameplayRepairReport, coverReport],
    frameReports: [frameReport(storyId, 10)],
    segmentValidationReports: [segmentReport(storyId, 10)],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.visuals.cover_dominated_exact_asset_count, 4);
  assert.equal(candidate.visuals.cover_dominated_exact_asset_share, 0.444);
  assert.ok(!candidate.blockers.includes("flash_proof_blocks_cover_dominated_exact_assets"));
});

test("proof candidates block wrong-story exact assets even when motion covers the real entities", () => {
  const storyId = "wrong_story_exact_assets";
  const report = buildStudioV2ProofCandidateReport({
    stories: [
      {
        ...story(storyId, "Take-Two mystery sequel has GTA, Red Dead and BioShock fans watching"),
        full_script:
          "Take-Two has raised questions for GTA, Red Dead and BioShock fans after passing on a legacy sequel.",
      },
    ],
    localAudioReports: [audioReport(storyId)],
    assetReports: [
      {
        plans: [
          {
            story_id: storyId,
            would_fetch: Array.from({ length: 6 }, (_, index) => ({
              id: `${storyId}_metro_${index}`,
              source_type: "steam_screenshot",
              entity: "Metro 2033",
              subject_match_quality: "exact_game_match",
              exact_subject_group: "Metro 2033",
              counted_for_premium: true,
              counted_for_standard: true,
              store_match_verified: true,
              local_path: `test/output/assets/${storyId}_${index}.jpg`,
            })),
          },
        ],
      },
    ],
    frameReports: [frameReport(storyId, 10)],
    segmentValidationReports: [segmentReport(storyId, 10)],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_motion_or_exact_assets");
  assert.ok(candidate.blockers.includes("flash_proof_blocks_wrong_story_exact_assets"));
  assert.deepEqual(candidate.visuals.wrong_story_exact_asset_groups, ["Metro 2033"]);
  assert.equal(candidate.recommended_command, null);
});

test("proof candidates block a single wrong-story exact asset even at low share", () => {
  const storyId = "low_share_wrong_story_exact_asset";
  const report = buildStudioV2ProofCandidateReport({
    stories: [
      {
        ...story(storyId, "GTA and Red Dead sequel rumours get new Take-Two context"),
        full_script:
          "Take-Two has new context for GTA and Red Dead fans after passing on a legacy sequel pitch.",
      },
    ],
    localAudioReports: [audioReport(storyId)],
    assetReports: [
      {
        plans: [
          {
            story_id: storyId,
            would_fetch: [
              ...Array.from({ length: 4 }, (_, index) => ({
                id: `${storyId}_real_${index}`,
                source_type: "steam_screenshot",
                entity: index % 2 === 0 ? "GTA" : "Red Dead",
                subject_match_quality: "exact_game_match",
                exact_subject_group: index % 2 === 0 ? "GTA" : "Red Dead",
                counted_for_premium: true,
                counted_for_standard: true,
                store_match_verified: true,
                local_path: `test/output/assets/${storyId}_real_${index}.jpg`,
              })),
              {
                id: `${storyId}_wrong_metro`,
                source_type: "steam_screenshot",
                entity: "Metro 2033",
                subject_match_quality: "exact_game_match",
                exact_subject_group: "Metro 2033",
                counted_for_premium: true,
                counted_for_standard: true,
                store_match_verified: true,
                local_path: `test/output/assets/${storyId}_wrong_metro.jpg`,
              },
            ],
          },
        ],
      },
    ],
    frameReports: [frameReport(storyId, 10)],
    segmentValidationReports: [segmentReport(storyId, 10)],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "needs_motion_or_exact_assets");
  assert.ok(candidate.blockers.includes("flash_proof_blocks_wrong_story_exact_assets"));
  assert.equal(candidate.warnings.includes("some_exact_assets_do_not_match_story_targets"), false);
  assert.equal(candidate.visuals.wrong_story_exact_asset_count, 1);
  assert.equal(candidate.visuals.wrong_story_exact_asset_share, 0.2);
  assert.deepEqual(candidate.visuals.wrong_story_exact_asset_groups, ["Metro 2033"]);
  assert.equal(candidate.recommended_command, null);
});

test("proof candidates allow a fresh local proof when visual inputs are newer than the warned render", () => {
  const storyId = "fresh_after_warn";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [{ generated_at: "2026-05-07T09:00:00.000Z", ...assetReport(storyId, 7) }],
    frameReports: [{ generated_at: "2026-05-07T10:00:00.000Z", ...frameReport(storyId, 10) }],
    segmentValidationReports: [{ generated_at: "2026-05-07T11:00:00.000Z", ...segmentReport(storyId, 10) }],
    latestForensicReports: [
      {
        storyId: `${storyId}_enriched`,
        generatedAt: "2026-05-06T12:00:00.000Z",
        summary: { verdict: "warn", failCount: 0, warnCount: 1 },
        visual: { repeatPairCount: 1 },
        issues: [{ code: "visual_repetition" }],
      },
    ],
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.verdict, "ready_flash_proof");
  assert.equal(candidate.latest_render_proof.visual_inputs_are_newer, true);
  assert.ok(candidate.warnings.includes("latest_render_warned_but_visual_inputs_refreshed"));
  assert.match(candidate.recommended_command, /studio:v2:still-deck/);
});

test("proof candidate markdown is operator-readable and says when no render is safe", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [story("weak_visual")],
    localAudioReports: [audioReport("weak_visual")],
    assetReports: [assetReport("weak_visual", 1)],
  });
  const md = renderStudioV2ProofCandidatesMarkdown(report);

  assert.match(md, /Studio V2 Proof Candidate Selector/);
  assert.match(md, /No Studio V2 proof render is safe yet/);
  assert.match(md, /local-only/);
  assert.match(md, /Visual evidence gate:/);
});

test("proof readiness packet JSON and Markdown expose all required proof fields", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [
      {
        ...story("packet_validity"),
        thumbnail_candidate_path: "output/thumbnails/packet_validity.png",
      },
    ],
    localAudioReports: [
      audioReport("packet_validity", {
        timestamps_path: "test/output/audio/packet_validity_timestamps.json",
      }),
    ],
    assetReports: [assetReport("packet_validity", 7)],
    frameReports: [frameReport("packet_validity", 10)],
    segmentValidationReports: [segmentReport("packet_validity", 10)],
  });
  const reparsed = JSON.parse(JSON.stringify(report));
  const md = renderStudioV2ProofCandidatesMarkdown(report);

  assert.equal(reparsed.candidates[0].proof_readiness.final_recommendation, "render_local_proof");
  assert.match(md, /Approved voice evidence:/);
  assert.match(md, /Runtime target 64-70s:/);
  assert.match(md, /Caption coverage\/density:/);
  assert.match(md, /Overlay safe area:/);
  assert.match(md, /Validated frames\/clips:/);
  assert.match(md, /Bad-frame rejections:/);
  assert.match(md, /Stale\/wrong-story risk:/);
  assert.match(md, /Outro expected:/);
  assert.match(md, /Thumbnail\/cover readiness:/);
  assert.match(md, /Final recommendation: render_local_proof/);
});

test("proof candidates normalise mojibake titles before reporting", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [story("mojibake", "Pok\u00c3\u00a9mon fans don\u00e2\u20ac\u2122t need another broken caption")],
    localAudioReports: [audioReport("mojibake")],
    assetReports: [assetReport("mojibake", 1)],
  });
  const md = renderStudioV2ProofCandidatesMarkdown(report);

  assert.equal(report.candidates[0].title, "Pok\u00e9mon fans don\u2019t need another broken caption");
  assert.match(md, /Pok\u00e9mon fans don\u2019t need another broken caption/);
  assert.doesNotMatch(md, /Pok\u00c3|\u00e2|\u00c2/);
});

test("studio:v2:proof-candidates command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["studio:v2:proof-candidates"], "node tools/studio-v2-proof-candidates.js");

  const tool = fs.readFileSync(path.join(ROOT, "tools", "studio-v2-proof-candidates.js"), "utf8");
  assert.match(tool, /discoverLocalAudioProofReport/);
  assert.match(tool, /ffprobeDuration/);
  assert.match(tool, /DEFAULT_FORENSIC_REPORTS/);
  assert.match(tool, /--no-db/);
  assert.match(tool, /if \(args\.noDb\) return \[\]/);
  assert.doesNotMatch(tool, /dotenv/);
  assert.doesNotMatch(tool, /publishAll|uploadShort|postShort|autonomous\/publish/);
  assert.doesNotMatch(tool, /UPDATE\s+stories|INSERT\s+INTO\s+stories|DELETE\s+FROM/i);
});
