"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_VERSION_FIELDS,
  buildGoal22VersionedPromptModelRegistry,
  writeGoal22VersionedPromptModelRegistry,
} = require("../../lib/goal22-versioned-prompt-model-registry");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: overrides.title || `Story ${storyId}`,
    script_prompt_version: overrides.scriptPromptVersion ?? "script_prompt_v3",
    canonical_angle: "Confirmed Drop",
  });
  await fs.outputJson(path.join(artifactDir, "script_scorecard.json"), {
    story_id: storyId,
    execution_mode: overrides.scriptPromptVersion ?? "script_prompt_v3",
    scores: { hook_strength: 88 },
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    story_id: storyId,
    director_version: overrides.directorVersion ?? "visual_v4_director_brain_v2",
    execution_mode: "visual_v4_director_brain",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    renderer_version: overrides.rendererVersion ?? "visual_v4_renderer_v5",
    renderer: "visual_v4_production",
    visual_model: overrides.visualModel ?? "studio_v4_visual_model_v2",
    visual_tier: "production_v4_motion",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    input_fingerprint: { signature: `${storyId}-fingerprint` },
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), {
    story_id: storyId,
    policy_ruleset: overrides.policyRuleset ?? "platform_policy_rules_v4",
    verdict: "pass",
  });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), {
    story_id: storyId,
    benchmark_pack_version: overrides.benchmarkPackVersion ?? "gold_standard_pack_v2",
    result: "pass",
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    voice_model: overrides.voiceModel ?? "local_voice_model_v1",
    audio_model: overrides.audioModel ?? "local_tts_audio_model_v1",
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: storyId,
    affiliate_ruleset: overrides.affiliateRuleset ?? "source_first_affiliate_rules_v2",
    disclosure_required: true,
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    platform_pack_version: overrides.platformPackVersion ?? "platform_native_pack_v3",
    operating_mode: overrides.publishingMode ?? "DRY_RUN_PUBLISH",
    publish_status: "GREEN",
    outputs: {
      youtube_shorts: { title: `Story ${storyId}` },
      tiktok: { caption: `Story ${storyId}` },
    },
  });
  return { story_id: storyId, artifact_dir: artifactDir, title: overrides.title || `Story ${storyId}` };
}

function readyGoal21(...storyIds) {
  return {
    verdict: "PASS",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "ready",
      blockers: [],
    })),
  };
}

function blockedGoal21(...storyIds) {
  return {
    verdict: "BLOCKED",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "blocked",
      blockers: ["observability:views_missing"],
    })),
  };
}

test("Goal 22 preserves Goal 21 blockers while complete version lineage passes directly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal22-upstream-"));
  const story = await makeStoryPackage(root, "story-a");

  const report = await buildGoal22VersionedPromptModelRegistry({
    storyPackages: [story],
    upstreamObservabilityReport: blockedGoal21("story-a"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T05:37:44.999Z",
    gitContext: { commit: "abcdef1234567890", branch: "main", dirty: false },
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_registry_verdict, "PASS");
  assert.equal(report.summary.direct_registry_pass_story_count, 1);
  assert.equal(report.summary.version_registry_ready_story_count, 0);
  assert.ok(report.stories[0].blockers.includes("upstream:goal21_observability_dashboard_blocked"));
  assert.ok(report.stories[0].blockers.includes("observability:views_missing"));
  for (const field of REQUIRED_VERSION_FIELDS) {
    assert.equal(report.stories[0].version_fields[field].status, "recorded", field);
  }
  assert.equal(report.production_audit_log.entries[0].git_commit, "abcdef1234567890");
  assert.equal(report.model_prompt_registry.registry_fields.length, REQUIRED_VERSION_FIELDS.length);
  assert.equal(report.video_lineage_manifest.videos[0].lineage_complete, true);
});

test("Goal 22 blocks missing required version fields instead of inventing lineage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal22-missing-"));
  const story = await makeStoryPackage(root, "story-b");
  await fs.writeJson(path.join(root, "story-b", "canonical_story_manifest.json"), { story_id: "story-b" });
  await fs.writeJson(path.join(root, "story-b", "script_scorecard.json"), { story_id: "story-b" });
  await fs.writeJson(path.join(root, "story-b", "director_beat_map.json"), { story_id: "story-b" });
  await fs.writeJson(path.join(root, "story-b", "render_manifest.json"), { story_id: "story-b" });
  await fs.writeJson(path.join(root, "story-b", "platform_policy_report.json"), { story_id: "story-b" });
  await fs.writeJson(path.join(root, "story-b", "benchmark_report.json"), { story_id: "story-b" });
  await fs.writeJson(path.join(root, "story-b", "audio_manifest.json"), { story_id: "story-b" });
  await fs.writeJson(path.join(root, "story-b", "affiliate_link_manifest.json"), { story_id: "story-b" });
  await fs.writeJson(path.join(root, "story-b", "platform_publish_manifest.json"), { story_id: "story-b" });

  const report = await buildGoal22VersionedPromptModelRegistry({
    storyPackages: [story],
    upstreamObservabilityReport: readyGoal21("story-b"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T05:37:44.999Z",
    gitContext: { commit: null, branch: "main", dirty: true },
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_registry_verdict, "BLOCKED");
  for (const blocker of [
    "versioning:git_commit_missing",
    "versioning:renderer_version_missing",
    "versioning:script_prompt_version_missing",
    "versioning:director_version_missing",
    "versioning:policy_ruleset_missing",
    "versioning:benchmark_pack_version_missing",
    "versioning:voice_model_missing",
    "versioning:audio_model_missing",
    "versioning:visual_model_missing",
    "versioning:affiliate_ruleset_missing",
    "versioning:platform_pack_version_missing",
    "versioning:publishing_mode_missing",
  ]) {
    assert.ok(report.stories[0].direct_registry_blockers.includes(blocker), blocker);
  }
  assert.equal(report.video_lineage_manifest.videos[0].lineage_complete, false);
  assert.equal(report.production_audit_log.entries[0].publish_allowed_by_goal22, false);
});

test("Goal 22 carries Goal 21 skipped stories without blocking active lineage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal22-skipped-"));
  const readyStory = await makeStoryPackage(root, "story-ready");
  const skippedStory = await makeStoryPackage(root, "story-skipped");
  await fs.writeJson(path.join(root, "story-skipped", "platform_policy_report.json"), { story_id: "story-skipped" });
  await fs.writeJson(path.join(root, "story-skipped", "audio_manifest.json"), {
    story_id: "story-skipped",
    voice_model: "local_voice_model_v1",
  });

  const report = await buildGoal22VersionedPromptModelRegistry({
    storyPackages: [readyStory, skippedStory],
    upstreamObservabilityReport: {
      verdict: "PASS",
      stories: [
        { story_id: "story-ready", status: "ready", blockers: [] },
        {
          story_id: "story-skipped",
          status: "skipped",
          skipped_status: "visual_source_rejected",
          skipped_reason: "reject_visually_unsupported_candidate",
          blockers: [],
        },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T05:37:44.999Z",
    gitContext: { commit: "abcdef1234567890", branch: "main", dirty: false },
  });

  const skipped = report.stories.find((story) => story.story_id === "story-skipped");

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_registry_verdict, "PASS");
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.active_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.version_registry_ready_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(report.summary.direct_registry_blocked_story_count, 0);
  assert.deepEqual(report.blocker_counts, {});
  assert.deepEqual(report.direct_risk_counts, {});
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.direct_registry_status, "skipped");
  assert.equal(skipped.upstream_status, "skipped");
  assert.equal(skipped.skipped_status, "visual_source_rejected");
  assert.equal(skipped.skipped_reason, "reject_visually_unsupported_candidate");
  assert.deepEqual(skipped.blockers, []);
  assert.equal(skipped.lineage_complete, false);
  assert.deepEqual(report.model_prompt_registry.missing_field_counts, {});
});

test("Goal 22 writes required registry artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal22-write-"));
  const story = await makeStoryPackage(root, "story-write");
  const report = await buildGoal22VersionedPromptModelRegistry({
    storyPackages: [story],
    upstreamObservabilityReport: readyGoal21("story-write"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T05:37:44.999Z",
    gitContext: { commit: "abcdef1234567890", branch: "main", dirty: false },
  });
  const written = await writeGoal22VersionedPromptModelRegistry(report, { outputDir: path.join(root, "out") });

  assert.equal(report.verdict, "PASS");
  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.productionAuditLog), true);
  assert.equal(await fs.pathExists(written.modelPromptRegistry), true);
  assert.equal(await fs.pathExists(written.videoLineageManifest), true);
});
