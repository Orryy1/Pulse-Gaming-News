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
  assert.doesNotMatch(tool, /publishAll|uploadShort|postShort|autonomous\/publish/);
  assert.doesNotMatch(tool, /UPDATE\s+stories|INSERT\s+INTO\s+stories|DELETE\s+FROM/i);
});
