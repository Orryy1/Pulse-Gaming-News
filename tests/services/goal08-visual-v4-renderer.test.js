"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoal08VisualV4Renderer,
  writeGoal08VisualV4Renderer,
} = require("../../lib/goal08-visual-v4-renderer");
const {
  currentRenderPolicyManifest,
} = require("../../lib/studio/v4/render-policy");

async function makeStory(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(overrides.outputSize || 4096, 1));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    renderer: overrides.renderer || "visual_v4_production",
    visual_tier: overrides.visualTier || "production_v4_motion",
    final_publish_render: overrides.finalPublishRender !== false,
    output: "visual_v4_render.mp4",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    file_size_bytes: overrides.outputSize || 4096,
    rendered_duration_s: 42,
    clips: overrides.clips || 8,
    ...currentRenderPolicyManifest(),
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: overrides.visualResult || "pass",
    failures: overrides.failures || [],
    warnings: overrides.warnings || [],
    scores: {
      motion_density_score: overrides.motionDensity ?? 92,
      first_3_seconds_hook_score: overrides.firstFrame ?? 88,
      source_lock_quality_score: overrides.sourceLock ?? 96,
      caption_legibility_score: overrides.captions ?? 94,
      card_hierarchy_score: overrides.hierarchy ?? 86,
      transition_energy_score: overrides.transitionEnergy ?? 84,
      media_house_polish_score: overrides.polish ?? 90,
      rights_risk_score: overrides.rightsRisk ?? 100,
      stale_wording_risk: overrides.staleRisk ?? 0,
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
    visual_evidence_profile: {
      generated_only_motion_deck: overrides.generatedOnlyMotionDeck === true,
      blockers: overrides.evidenceBlockers || [],
    },
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    readiness: {
      status: overrides.directorStatus || "director_ready",
      blockers: overrides.directorBlockers || [],
    },
    shot_plan: overrides.shots || [
      { id: "hook", kind: "hook_slam", startS: 0, durationS: 1.2 },
      { id: "clip-a", kind: "motion_clip", startS: 0.35, durationS: 3, source_family: "a" },
      { id: "source", kind: "source_lock", startS: 2.2, durationS: 2, source: "IGN", visual_treatment: "large readable source bug" },
      { id: "clip-b", kind: "motion_clip", startS: 5.2, durationS: 3, source_family: "b" },
    ],
    transition_plan: {
      planned: overrides.transitions || [
        { into: "clip-a", family: "speed_ramp" },
        { into: "source", family: "source_wipe" },
        { into: "clip-b", family: "whip_pan" },
      ],
    },
  });
  return {
    story_id: storyId,
    title: `${storyId} title`,
    artifact_dir: artifactDir,
  };
}

test("Goal 08 blocks renderer readiness when upstream director proof is blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal08-upstream-"));
  const story = await makeStory(root, "story-upstream");

  const report = await buildGoal08VisualV4Renderer({
    storyPackages: [story],
    upstreamDirectorReport: {
      stories: [
        {
          story_id: "story-upstream",
          status: "blocked",
          blockers: ["director:source_lock_not_readable"],
        },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-25T22:35:24.399Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.direct_visual_pass_story_count, 1);
  assert.equal(report.summary.visual_ready_story_count, 0);
  assert.deepEqual(report.stories[0].blockers, [
    "upstream:goal07_director_brain_blocked",
    "director:source_lock_not_readable",
  ]);
  assert.equal(report.visual_render_manifest.stories[0].direct_visual_status, "pass");
  assert.equal(report.frame_quality_report.stories[0].status, "pass");
});

test("Goal 08 reports hard visual renderer failures without weakening production gates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal08-hard-fail-"));
  const story = await makeStory(root, "story-visual-fail", {
    finalPublishRender: false,
    renderer: "visual_v4_local_proof",
    visualTier: "local_proof_motion_graphic",
    visualResult: "fail",
    motionDensity: 42,
    firstFrame: 45,
    captions: 51,
    hierarchy: 50,
    transitionEnergy: 40,
    polish: 52,
    generatedOnlyMotionDeck: true,
    transitions: [
      { into: "a", family: "wipe" },
      { into: "b", family: "wipe" },
      { into: "c", family: "wipe" },
      { into: "d", family: "wipe" },
    ],
  });

  const report = await buildGoal08VisualV4Renderer({
    storyPackages: [story],
    upstreamDirectorReport: {
      stories: [{ story_id: "story-visual-fail", status: "ready", blockers: [] }],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-25T22:35:24.399Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.match(report.stories[0].blockers.join("\n"), /render:not_final_visual_v4_production/);
  assert.match(report.stories[0].blockers.join("\n"), /visual:weak_motion_density/);
  assert.match(report.stories[0].blockers.join("\n"), /visual:unclear_first_frame/);
  assert.match(report.stories[0].blockers.join("\n"), /visual:tiny_or_illegible_captions/);
  assert.match(report.stories[0].blockers.join("\n"), /visual:poor_text_hierarchy/);
  assert.match(report.stories[0].blockers.join("\n"), /visual:repeated_rhythm/);
  assert.match(report.stories[0].blockers.join("\n"), /visual:template_looking_output/);
  assert.match(report.stories[0].blockers.join("\n"), /visual:generated_only_motion_deck/);
  assert.equal(report.mobile_readability_report.stories[0].status, "blocked");
  assert.equal(report.visual_repetition_report.stories[0].status, "blocked");
  assert.equal(report.safety.no_render_triggered, true);
  assert.equal(report.safety.no_publish_triggered, true);
});

test("Goal 08 writes the required renderer artefacts as JSON and Markdown", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal08-write-"));
  const story = await makeStory(root, "story-ready");
  const outputDir = path.join(root, "out");
  const report = await buildGoal08VisualV4Renderer({
    storyPackages: [story],
    upstreamDirectorReport: {
      stories: [{ story_id: "story-ready", status: "ready", blockers: [] }],
    },
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-05-25T22:35:24.399Z",
  });

  const written = await writeGoal08VisualV4Renderer(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.visualRenderManifest), true);
  assert.equal(await fs.pathExists(written.frameQualityReport), true);
  assert.equal(await fs.pathExists(written.mobileReadabilityReport), true);
  assert.equal(await fs.pathExists(written.visualRepetitionReport), true);
  const manifest = await fs.readJson(written.visualRenderManifest);
  assert.equal(manifest.ready_story_count, 1);
});
