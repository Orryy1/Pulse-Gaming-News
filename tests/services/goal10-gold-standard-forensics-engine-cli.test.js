"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { GOAL10_BENCHMARK_PACKS } = require("../../lib/goal10-gold-standard-forensics-engine");
const { main, parseArgs } = require("../../tools/goal10-gold-standard-forensics-engine");

function referenceLibraryFixture() {
  return {
    workbook_path: "fixture/gold_standards_reference_library.xlsx",
    summary: {
      total_references: 50,
      core_legal_rule:
        "Treat every entry as reference-only unless a specific asset has verified reuse rights, licence terms or written permission.",
    },
    references: Array.from({ length: 50 }, (_, index) => ({
      id: `GS-${index + 1}`,
      rights_usage_note: "Reference only. Do not copy footage, music, graphics or templates without permission/licence.",
    })),
    codex_rules: Array.from({ length: 12 }, (_, index) => ({ rule_id: `R-${index + 1}` })),
    reference_packs: GOAL10_BENCHMARK_PACKS.map((pack) => ({
      pack,
      primary_references: "IGN, Reuters",
      use_this_when: "Fixture coverage",
      main_extraction_targets: "title structure, hook type, first-frame structure, platform behaviour",
    })),
  };
}

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script: "The Expanse: Osiris Reborn finally showed real gameplay. Follow Pulse Gaming for the gaming stories behind the headline.",
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    reference_pack_used: ["Gaming News Core", "Official Publisher Motion"],
    result: "pass",
    scores: {
      motion_density_score: 90,
      first_3_seconds_hook_score: 86,
      rights_risk_score: 100,
    },
    thresholds: {
      motion_density_score: 75,
      first_3_seconds_hook_score: 75,
      rights_risk_score: 70,
    },
  });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), { result: "pass" });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    shot_plan: [
      { id: "hook", kind: "hook_slam", startS: 0, durationS: 2.1 },
      { id: "source", kind: "source_lock", startS: 2.2, durationS: 1.8 },
      { id: "card", kind: "proof_card", startS: 4.2, durationS: 1.8 },
    ],
    transition_plan: { planned: [{ family: "speed_ramp", atS: 0.2 }] },
    sound_transition_plan: {
      duration_s: 38,
      sfx: {
        cues: [
          { family: "impact", atS: 0 },
          { family: "source_tick", atS: 2.2 },
        ],
        mastering: { duck_under_narration: true },
      },
    },
    caption_policy: { clean_manual_captions: true },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    rendered_duration_s: 38,
    clips: 8,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: { cta_style: "identity_follow" },
      instagram_reels: { cta_style: "bio_link", carousel_companion: { required: true } },
      x: { cta_style: "source_first_link", thread_posts: ["one", "two"] },
    },
    platform_native_evidence: { verdict: "pass" },
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    disclosure_required: true,
    landing_page_route: "/p/story",
    landing_page_attribution: { link_tracking: [{ platform: "youtube" }] },
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 10 CLI parses benchmark inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-sound-report",
    "output/goal-09/goal09_readiness_report.json",
    "--reference-library",
    "test/output/reference-library.json",
    "--workbook",
    "C:\\tmp\\gold.xlsx",
    "--out-dir",
    "output/goal-10",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-25T23:35:45.269Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamSoundReportPath, "output/goal-09/goal09_readiness_report.json");
  assert.equal(args.referenceLibraryPath, "test/output/reference-library.json");
  assert.equal(args.workbookPath, "C:\\tmp\\gold.xlsx");
  assert.equal(args.outDir, "output/goal-10");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-25T23:35:45.269Z");
  assert.equal(args.json, true);
});

test("Goal 10 CLI writes local-proof forensic benchmark artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal10-cli-"));
  const story = await makeStory(root, "story-ready");
  const packagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal09.json");
  const referencePath = path.join(root, "reference-library.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(packagesPath, [story]);
  await fs.outputJson(upstreamPath, { stories: [{ story_id: "story-ready", status: "ready", blockers: [] }] });
  await fs.outputJson(referencePath, referenceLibraryFixture());

  const result = await main([
    "--story-packages",
    packagesPath,
    "--upstream-sound-report",
    upstreamPath,
    "--reference-library",
    referencePath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-25T23:35:45.269Z",
  ]);

  assert.equal(result.report.verdict, "PASS");
  assert.equal(await fs.pathExists(path.join(outDir, "reference_pack_scorecard.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "benchmark_comparison_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "pulse_render_benchmark_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "benchmark_rejection_reasons.json")), true);
});
