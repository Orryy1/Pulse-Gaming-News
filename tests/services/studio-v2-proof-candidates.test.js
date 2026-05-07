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

function story(id, title = "GTA 6 trailer evidence is stacking up") {
  return {
    id,
    title,
    approved: true,
    breaking_score: 82,
    full_script: "GTA 6 has a confirmed clue today. ".repeat(32),
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
        title: "GTA 6 trailer evidence is stacking up",
        would_fetch: Array.from({ length: count }, (_, index) => ({
          id: `${storyId}_asset_${index}`,
          source_type: "steam_screenshot",
          entity: index % 2 === 0 ? "GTA" : "Red Dead",
          subject_match_quality: index % 2 === 0 ? "exact_game_match" : "exact_franchise_match",
          exact_subject_group: index % 2 === 0 ? "GTA" : "Red Dead",
          counted_for_premium: true,
          counted_for_standard: true,
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
          local_path: `test/output/frames/${storyId}_${index}.jpg`,
          qa: { verdict: "pass", failures: [] },
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
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      segment_motion_class: "gameplay_action",
    })),
  };
}

test("proof candidates mark motion-backed Liam stories ready for a Studio V2 proof", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [story("ready")],
    localAudioReports: [audioReport("ready")],
    assetReports: [assetReport("ready", 7)],
    frameReports: [frameReport("ready", 4)],
    segmentValidationReports: [segmentReport("ready", 3)],
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

test("proof candidates require Liam audio before a visual-ready render", () => {
  const report = buildStudioV2ProofCandidateReport({
    stories: [story("needs_audio")],
    assetReports: [assetReport("needs_audio", 8)],
    frameReports: [frameReport("needs_audio", 4)],
    segmentValidationReports: [segmentReport("needs_audio", 3)],
  });

  assert.equal(report.candidates[0].verdict, "needs_liam_audio_then_flash_proof");
  assert.ok(report.candidates[0].blockers.includes("approved_liam_audio_missing"));
  assert.equal(report.candidates[0].next_action, "generate_sleepy_liam_audio");
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
  assert.deepEqual(candidate.visuals.missing_exact_subject_entities, ["BioShock", "Red Dead"]);
  assert.deepEqual(candidate.visuals.missing_validated_clip_entities, ["BioShock", "Red Dead"]);
  assert.equal(candidate.verdict, "needs_motion_or_exact_assets");
  assert.ok(candidate.blockers.includes("flash_proof_requires_exact_subject_entity_coverage"));
  assert.ok(candidate.blockers.includes("flash_proof_requires_validated_entity_coverage"));
  assert.equal(candidate.recommended_command, null);
});

test("proof candidates block stale ready proof commands when the latest render has forensic warnings", () => {
  const storyId = "warned_render";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [{ generated_at: "2026-05-05T10:00:00.000Z", ...assetReport(storyId, 7) }],
    frameReports: [{ generated_at: "2026-05-05T11:00:00.000Z", ...frameReport(storyId, 5) }],
    segmentValidationReports: [{ generated_at: "2026-05-05T12:00:00.000Z", ...segmentReport(storyId, 3) }],
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

test("proof candidates allow a fresh local proof when visual inputs are newer than the warned render", () => {
  const storyId = "fresh_after_warn";
  const report = buildStudioV2ProofCandidateReport({
    stories: [story(storyId)],
    localAudioReports: [audioReport(storyId)],
    assetReports: [{ generated_at: "2026-05-07T09:00:00.000Z", ...assetReport(storyId, 7) }],
    frameReports: [{ generated_at: "2026-05-07T10:00:00.000Z", ...frameReport(storyId, 5) }],
    segmentValidationReports: [{ generated_at: "2026-05-07T11:00:00.000Z", ...segmentReport(storyId, 3) }],
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
});

test("studio:v2:proof-candidates command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["studio:v2:proof-candidates"], "node tools/studio-v2-proof-candidates.js");

  const tool = fs.readFileSync(path.join(ROOT, "tools", "studio-v2-proof-candidates.js"), "utf8");
  assert.match(tool, /discoverLocalAudioProofReport/);
  assert.match(tool, /ffprobeDuration/);
  assert.match(tool, /DEFAULT_FORENSIC_REPORTS/);
  assert.doesNotMatch(tool, /publishAll|uploadShort|postShort|autonomous\/publish/);
  assert.doesNotMatch(tool, /UPDATE\s+stories|INSERT\s+INTO\s+stories|DELETE\s+FROM/i);
});
