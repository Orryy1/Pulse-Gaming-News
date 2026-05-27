"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArgs } = require("../../tools/goal09-sound-design-engine");

async function makePackage(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    narration_audio_path: "output/audio/story.mp3",
    word_timestamps_path: "output/audio/story_timestamps.json",
    voice_status: "materialized",
    word_timestamp_count: 80,
    mix_rules: {
      narration_priority: true,
      duck_under_narration: true,
      limiter: true,
    },
    safety: {
      no_publishing_side_effects: true,
      oauth_triggered: false,
      production_db_mutated: false,
    },
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: {
      required_roles: ["impact", "transition", "ui_tick"],
      covered_roles: ["impact", "transition", "ui_tick"],
      selected_assets: [
        { asset_id: "impact", role: "impact", provider_id: "sonniss", approval_status: "approved_for_commercial_editorial_use" },
        { asset_id: "transition", role: "transition", provider_id: "sonniss", approval_status: "approved_for_commercial_editorial_use" },
        { asset_id: "ui", role: "ui_tick", provider_id: "sonniss", approval_status: "approved_for_commercial_editorial_use" },
      ],
      readiness: { status: "pass", blockers: [] },
    },
  });
  await fs.outputJson(path.join(artifactDir, "audio_segment_loudness_report.json"), {
    verdict: "pass",
    blockers: [],
    metrics: {
      valid_segment_count: 6,
      mean_range_db: 1,
      max_adjacent_rise_db: 0.5,
      max_peak_db: -1.8,
    },
    safety: {
      mutates_media: false,
      mutates_production_db: false,
      mutates_tokens: false,
      posts_to_platforms: false,
    },
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    sound_transition_plan: {
      sfx: {
        cue_count: 4,
        max_same_family_run: 1,
        cues: [
          { family: "impact" },
          { family: "whoosh" },
          { family: "source_tick" },
          { family: "transition_hit" },
        ],
      },
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    final_publish_render: true,
    sfx_mix_policy_version: "source_lock_news_tick_v6",
    voice_mix_policy_version: "local_voice_levelled_v2",
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 09 CLI parses story package and upstream visual arguments", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-visual-report",
    "output/goal-08/goal08_readiness_report.json",
    "--out-dir",
    "output/goal-09",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-25T23:05:36.619Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamVisualReportPath, "output/goal-08/goal08_readiness_report.json");
  assert.equal(args.outDir, "output/goal-09");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-25T23:05:36.619Z");
  assert.equal(args.json, true);
});

test("Goal 09 CLI writes local-proof sound artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal09-cli-"));
  const story = await makePackage(root, "story-ready");
  const packagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal08.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(packagesPath, [story]);
  await fs.outputJson(upstreamPath, { stories: [{ story_id: "story-ready", status: "ready", blockers: [] }] });

  const result = await main([
    "--story-packages",
    packagesPath,
    "--upstream-visual-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-25T23:05:36.619Z",
  ]);

  assert.equal(result.report.verdict, "PASS");
  assert.equal(await fs.pathExists(path.join(outDir, "audio_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "sfx_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "loudness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "audio_quality_scorecard.json")), true);
});
