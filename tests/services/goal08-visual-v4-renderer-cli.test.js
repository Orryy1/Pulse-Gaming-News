"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArgs } = require("../../tools/goal08-visual-v4-renderer");

test("Goal 08 CLI parses story package and upstream director arguments", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-director-report",
    "output/goal-07/goal07_readiness_report.json",
    "--out-dir",
    "output/goal-08",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-25T22:35:24.399Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamDirectorReportPath, "output/goal-07/goal07_readiness_report.json");
  assert.equal(args.outDir, "output/goal-08");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-25T22:35:24.399Z");
  assert.equal(args.json, true);
});

test("Goal 08 CLI writes local-proof renderer artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal08-cli-"));
  const artifactDir = path.join(root, "story-one");
  const outDir = path.join(root, "out");
  await fs.ensureDir(artifactDir);
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "story-one",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    sfx_mix_policy_version: "source_lock_news_tick_v6",
    voice_mix_policy_version: "local_voice_levelled_v2",
    visual_design_policy_version: "newsroom_bounded_text_v3",
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    scores: {
      motion_density_score: 92,
      first_3_seconds_hook_score: 88,
      source_lock_quality_score: 96,
      caption_legibility_score: 94,
      card_hierarchy_score: 86,
      transition_energy_score: 84,
      media_house_polish_score: 90,
      rights_risk_score: 100,
      stale_wording_risk: 0,
    },
    thresholds: {
      motion_density_score: 75,
      first_3_seconds_hook_score: 75,
      source_lock_quality_score: 65,
      caption_legibility_score: 70,
      card_hierarchy_score: 65,
      transition_energy_score: 65,
      media_house_polish_score: 75,
      rights_risk_score: 70,
      stale_wording_risk: 30,
    },
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    shot_plan: [
      { id: "hook", kind: "hook_slam", startS: 0, durationS: 1.2 },
      { id: "clip", kind: "motion_clip", startS: 0.35, durationS: 3, source_family: "a" },
    ],
  });
  const packagesPath = path.join(root, "story-packages.json");
  const directorPath = path.join(root, "goal07.json");
  await fs.outputJson(packagesPath, [{ story_id: "story-one", artifact_dir: artifactDir }]);
  await fs.outputJson(directorPath, { stories: [{ story_id: "story-one", status: "ready", blockers: [] }] });

  const result = await main([
    "--story-packages",
    packagesPath,
    "--upstream-director-report",
    directorPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-25T22:35:24.399Z",
  ]);

  assert.equal(result.report.verdict, "PASS");
  assert.equal(await fs.pathExists(path.join(outDir, "visual_render_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "frame_quality_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "mobile_readability_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "visual_repetition_report.json")), true);
});
