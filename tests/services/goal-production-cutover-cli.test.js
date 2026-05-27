"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArgs } = require("../../tools/goal-production-cutover");

function productionCopy(overrides = {}) {
  const subject = overrides.canonical_subject || "Forza Horizon 6";
  return {
    canonical_subject: subject,
    selected_title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    first_spoken_line: `${subject} is turning Xbox's Steam plan into a real test.`,
    narration_script: `${subject} is turning Xbox's Steam plan into a real test. The PC launch gives players another way to judge Xbox's biggest racing series.`,
    description: `${subject} gives Xbox a sharper Steam test with players watching the PC launch signal.`,
    ...overrides,
  };
}

test("goal production cutover CLI parses dry local arguments", () => {
  const args = parseArgs([
    "--story-packages",
    "packages.json",
    "--out-dir",
    "out",
    "--generated-at",
    "2026-05-22T03:20:00.000Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "packages.json");
  assert.equal(args.outDir, "out");
  assert.equal(args.generatedAt, "2026-05-22T03:20:00.000Z");
  assert.equal(args.json, true);
});

test("goal production cutover CLI combines repeated story-package manifests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-combine-"));
  const staleDir = path.join(root, "stale-story");
  const freshDir = path.join(root, "fresh-story");
  const otherDir = path.join(root, "other-story");
  const outDir = path.join(root, "out");
  for (const dir of [staleDir, freshDir, otherDir]) {
    await fs.ensureDir(dir);
    await fs.outputJson(path.join(dir, "canonical_story_manifest.json"), {
      ...productionCopy(),
      story_id: path.basename(dir),
    });
    await fs.outputJson(path.join(dir, "director_beat_map.json"), {});
    await fs.outputJson(path.join(dir, "rights_ledger.json"), []);
    await fs.outputJson(path.join(dir, "benchmark_report.json"), {
      result: "pass",
      scores: {
        motion_density_score: 90,
        first_3_seconds_hook_score: 90,
        caption_legibility_score: 90,
        transition_energy_score: 90,
        sfx_impact_score: 90,
        media_house_polish_score: 90,
      },
    });
    await fs.outputJson(path.join(dir, "visual_quality_report.json"), { result: "pass" });
    await fs.outputJson(path.join(dir, "platform_publish_manifest.json"), { publish_status: "GREEN" });
    await fs.outputJson(path.join(dir, "publish_verdict.json"), { verdict: "GREEN" });
    await fs.outputJson(path.join(dir, "sfx_manifest.json"), {
      cue_count: 4,
      source_plan: { readiness: { status: "pass", blockers: [] } },
    });
    await fs.outputJson(path.join(dir, "render_manifest.json"), {
      renderer: "visual_v4_local_proof",
      final_publish_render: false,
      output: "visual_v4_render.mp4",
    });
    await fs.outputFile(path.join(dir, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nForza.\n");
    await fs.outputFile(path.join(dir, "visual_v4_render.mp4"), Buffer.alloc(2000, 1));
  }
  await fs.outputJson(path.join(freshDir, "canonical_story_manifest.json"), {
    ...productionCopy({
      selected_title: "Fresh Candidate",
    }),
    story_id: "fresh-story",
  });
  const firstPackages = path.join(root, "story-packages-a.json");
  const secondPackages = path.join(root, "story-packages-b.json");
  await fs.outputJson(firstPackages, [
    { story_id: "duplicate-story", title: "Old Candidate", verdict: "GREEN", artifact_dir: staleDir },
    { story_id: "other-story", title: "Other Candidate", verdict: "GREEN", artifact_dir: otherDir },
  ]);
  await fs.outputJson(secondPackages, [
    { story_id: "duplicate-story", title: "Fresh Candidate", verdict: "GREEN", artifact_dir: freshDir },
  ]);

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--story-packages",
      firstPackages,
      "--story-packages",
      secondPackages,
      "--out-dir",
      outDir,
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.plan.summary.story_count, 2);
  const queued = result.plan.queue.find((item) => item.story_id === "duplicate-story");
  assert.equal(queued.title, "Fresh Candidate");
  assert.equal(queued.artifact_dir, freshDir);
  const combinedManifest = await fs.readJson(path.join(outDir, "production_cutover_story_packages.json"));
  assert.equal(combinedManifest.length, 2);
  assert.equal(combinedManifest.find((item) => item.story_id === "duplicate-story").artifact_dir, freshDir);
});

test("goal production cutover CLI writes local cutover artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-cli-"));
  const storyDir = path.join(root, "story-one");
  const outDir = path.join(root, "out");
  await fs.ensureDir(storyDir);
  await fs.outputJson(path.join(storyDir, "canonical_story_manifest.json"), {
    ...productionCopy(),
    story_id: "story-one",
  });
  await fs.outputJson(path.join(storyDir, "director_beat_map.json"), {});
  await fs.outputJson(path.join(storyDir, "rights_ledger.json"), []);
  await fs.outputJson(path.join(storyDir, "benchmark_report.json"), {
    result: "pass",
    scores: {
      motion_density_score: 90,
      first_3_seconds_hook_score: 90,
      caption_legibility_score: 90,
      transition_energy_score: 90,
      sfx_impact_score: 90,
      media_house_polish_score: 90,
    },
  });
  await fs.outputJson(path.join(storyDir, "visual_quality_report.json"), { result: "pass" });
  await fs.outputJson(path.join(storyDir, "platform_publish_manifest.json"), { publish_status: "GREEN" });
  await fs.outputJson(path.join(storyDir, "publish_verdict.json"), { verdict: "GREEN" });
  await fs.outputJson(path.join(storyDir, "sfx_manifest.json"), {
    cue_count: 4,
    source_plan: { readiness: { status: "pass", blockers: [] } },
  });
  await fs.outputJson(path.join(storyDir, "render_manifest.json"), {
    renderer: "visual_v4_local_proof",
    visual_tier: "local_proof_motion_graphic",
    final_publish_render: false,
    output: "visual_v4_render.mp4",
  });
  await fs.outputFile(path.join(storyDir, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nForza.\n");
  await fs.outputFile(path.join(storyDir, "visual_v4_render.mp4"), Buffer.alloc(2000, 1));
  const packagesPath = path.join(root, "story-packages.json");
  await fs.outputJson(packagesPath, [
    { story_id: "story-one", verdict: "GREEN", artifact_dir: storyDir },
  ]);

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--story-packages",
      packagesPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-22T03:25:00.000Z",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.plan.summary.queued_final_render_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "production_render_cutover_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "production_render_queue.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "production_render_validation_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "scheduler_bridge_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "scheduler_bridge_candidates.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "production_render_cutover_plan.md")), true);
  const markdown = await fs.readFile(path.join(outDir, "production_render_cutover_plan.md"), "utf8");
  assert.match(markdown, /inputs blocked:/);
  assert.match(markdown, /final_narration_audio_missing/);
  assert.equal(result.plan.safety.no_publish_triggered, true);
});
