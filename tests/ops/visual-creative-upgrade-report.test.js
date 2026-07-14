"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildVisualCreativeUpgradeReport,
  renderVisualCreativeUpgradeMarkdown,
  writeVisualCreativeUpgradeReport,
} = require("../../lib/ops/visual-creative-upgrade-report");

function passingRenderProof() {
  return {
    story_id: "story-v5",
    output: "test/output/story-v5.mp4",
    creative_system_version: "pulse_visual_identity_v5",
    kinetic_typography_version: "pulse_kinetic_typography_v5",
    decoded_visual_gate: {
      status: "pass",
      decoded_media_evidence: true,
      frame_count: 58,
      visual_repetition: {
        verdict: "pass",
        repeatPairCount: 3,
        blackFrames: [],
        averageLuminance: 89,
      },
      rendered_frame_taste: { verdict: "pass", badFrameCount: 0 },
    },
    clip_scene_plan: {
      repeat_free: true,
      repeated_base_sources: [],
      premium_edit_rhythm: {
        status: "pass",
        metrics: {
          direct_motion_scene_count: 12,
          generated_card_scene_count: 3,
          generated_card_duration_ratio: 0.192,
        },
      },
      direct_motion_visual_selection: {
        accepted_count: 15,
        rejected_count: 5,
      },
    },
    hyperframes_premium_shell_gate: {
      verdict: "pass",
      evidenceSource: "selected_card_sidecars",
      selectedCardCount: 3,
      passCount: 3,
      checks: {
        source: {
          verdict: "pass",
          evidence: {
            checks: { check: { status: "pass" } },
            creativeIdentityContract: {
              status: "pass",
              evidence: { version: "pulse_visual_identity_v5" },
            },
          },
        },
      },
    },
    no_publish_side_effects: true,
    no_db_mutation: true,
  };
}

function passingCampaignProof() {
  const output = (platform) => ({
    platform,
    static_path: `output/${platform}.png`,
    creative_identity: { version: "pulse_visual_identity_v5" },
  });
  return {
    story_id: "story-v5",
    verdict: "green",
    hero_evidence: {
      mode: "scored_official_direct_motion_frame_selection",
      rights_basis: "official_direct_media",
      candidate_count: 12,
      winning_score: 29.2,
    },
    outputs: {
      youtube_thumbnail: output("youtube_thumbnail"),
      youtube_shorts_cover: output("youtube_shorts_cover"),
      instagram_reels_cover: output("instagram_reels_cover"),
      instagram_story: output("instagram_story"),
      facebook_reels_cover: output("facebook_reels_cover"),
    },
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

test("visual creative upgrade report passes only aligned decoded V5 proof", () => {
  const report = buildVisualCreativeUpgradeReport({
    renderProof: passingRenderProof(),
    campaignProof: passingCampaignProof(),
    generatedAt: "2026-07-14T05:00:00.000Z",
  });

  assert.equal(report.verdict, "PASS", JSON.stringify(report.blockers));
  assert.deepEqual(report.blockers, []);
  assert.equal(report.metrics.direct_motion_scene_count, 12);
  assert.equal(report.metrics.generated_card_duration_ratio, 0.192);
  assert.equal(report.metrics.platform_visual_output_count, 5);
  assert.equal(report.gates.current_hyperframes_sidecars, "PASS");
  assert.equal(report.gates.official_hero_frame, "PASS");
  assert.equal(report.safety.no_publish_triggered, true);
  assert.match(renderVisualCreativeUpgradeMarkdown(report), /Verdict: PASS/);
});

test("visual creative upgrade report fails closed on stale shell or black frames", () => {
  const renderProof = passingRenderProof();
  renderProof.hyperframes_premium_shell_gate.evidenceSource = "story_package";
  renderProof.decoded_visual_gate.visual_repetition.blackFrames.push("frame_004.jpg");

  const report = buildVisualCreativeUpgradeReport({
    renderProof,
    campaignProof: passingCampaignProof(),
  });

  assert.equal(report.verdict, "FAIL");
  assert.ok(report.blockers.includes("decoded_black_frames_present"));
  assert.ok(report.blockers.includes("current_hyperframes_sidecar_evidence_missing"));
});

test("visual creative upgrade report writes machine and human proof", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-visual-upgrade-report-"));
  try {
    const report = buildVisualCreativeUpgradeReport({
      renderProof: passingRenderProof(),
      campaignProof: passingCampaignProof(),
    });
    const written = await writeVisualCreativeUpgradeReport(report, { outputDir });

    assert.equal(await fs.pathExists(written.jsonPath), true);
    assert.equal(await fs.pathExists(written.markdownPath), true);
    assert.equal((await fs.readJson(written.jsonPath)).verdict, "PASS");
    assert.match(await fs.readFile(written.markdownPath, "utf8"), /Verdict: PASS/);
  } finally {
    await fs.remove(outputDir);
  }
});
