"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal22-versioned-prompt-model-registry");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Adds A Fresh Weather Detail",
    script_prompt_version: "script_prompt_v3",
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    director_version: "visual_v4_director_brain_v2",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    renderer_version: "visual_v4_renderer_v5",
    visual_model: "studio_v4_visual_model_v2",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), {
    policy_ruleset: "platform_policy_rules_v4",
  });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), {
    benchmark_pack_version: "gold_standard_pack_v2",
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    voice_model: "local_voice_model_v1",
    audio_model: "local_tts_audio_model_v1",
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    affiliate_ruleset: "source_first_affiliate_rules_v2",
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    platform_pack_version: "platform_native_pack_v3",
    operating_mode: "DRY_RUN_PUBLISH",
    outputs: { youtube_shorts: { title: "Forza Adds A Fresh Weather Detail" } },
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 22 CLI parses registry inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-observability-report",
    "output/goal-21/goal21_readiness_report.json",
    "--out-dir",
    "output/goal-22",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T05:37:44.999Z",
    "--git-commit",
    "abcdef1234567890",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamObservabilityReportPath, "output/goal-21/goal21_readiness_report.json");
  assert.equal(args.outDir, "output/goal-22");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T05:37:44.999Z");
  assert.equal(args.gitCommit, "abcdef1234567890");
  assert.equal(args.json, true);
});

test("Goal 22 CLI writes registry artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal22-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal21.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    verdict: "BLOCKED",
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["observability:views_missing"] }],
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-observability-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T05:37:44.999Z",
    "--git-commit",
    "abcdef1234567890",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(result.report.direct_registry_verdict, "PASS");
  assert.equal(await fs.pathExists(path.join(outDir, "goal22_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "production_audit_log.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "model_prompt_registry.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "video_lineage_manifest.json")), true);
});

test("Goal 22 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal22-versioned-prompt-model-registry"],
    "node tools/goal22-versioned-prompt-model-registry.js",
  );
});
