"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const mediaPaths = require("./media-paths");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(asArray(values).map(cleanText).filter(Boolean))];
}

function bridgeCandidatesFrom(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return [
    ...asArray(value?.scheduler_bridge_candidates),
    ...asArray(value?.bridge_candidates),
    ...asArray(value?.candidates),
  ];
}

function dryRunBlockedStoriesFrom(value = {}) {
  return [
    ...asArray(value.blocked_stories),
    ...asArray(value.held_stories),
    ...asArray(value.stories).filter((story) => asArray(story.blockers).includes("sfx_render_asset_mismatch")),
  ];
}

function dryRunSfxMismatchIds(value = {}) {
  return new Set(
    dryRunBlockedStoriesFrom(value)
      .filter((story) => asArray(story.blockers).includes("sfx_render_asset_mismatch"))
      .map((story) => cleanText(story.story_id || story.id)),
  );
}

function storyIdForCandidate(candidate = {}) {
  return cleanText(candidate.story_id || candidate.id || candidate.storyId);
}

function artifactDirForCandidate(candidate = {}, workspaceRoot = process.cwd()) {
  const explicit = cleanText(candidate.artifact_dir || candidate.artifactDir);
  if (explicit) return path.resolve(workspaceRoot, explicit);
  const renderManifest = cleanText(candidate.render_manifest_path || candidate.renderManifestPath);
  if (renderManifest) return path.dirname(path.resolve(workspaceRoot, renderManifest));
  const exported = cleanText(candidate.exported_path || candidate.output_path || candidate.final_render_path);
  if (exported) return path.dirname(path.resolve(workspaceRoot, exported));
  const storyId = storyIdForCandidate(candidate);
  return path.join(path.resolve(workspaceRoot), "output", "goal-proof", "batch", storyId);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function selectedSfxAssetsFromManifest(sfxManifest = {}) {
  return asArray(
    sfxManifest.source_plan?.selected_assets ||
      sfxManifest.selected_assets ||
      sfxManifest.assets ||
      sfxManifest.sfx_assets,
  );
}

function renderedSfxAssetsFromStory(renderStory = {}) {
  return asArray(
    renderStory.sfx_asset_inventory ||
      renderStory.sfx_assets ||
      renderStory.sfx_manifest?.source_plan?.selected_assets ||
      renderStory.sfx_manifest?.selected_assets,
  );
}

function assetIds(assets = []) {
  return unique(asArray(assets).map((asset) => asset.asset_id || asset.id || asset.source_url || asset.path));
}

function sameAssetIds(left = [], right = []) {
  const a = assetIds(left).sort();
  const b = assetIds(right).sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function pathValue(item = {}) {
  if (typeof item === "string") return cleanText(item);
  return cleanText(item.path || item.local_path || item.local_materialized_path || item.file_path || item.media_path);
}

function clipPathsFrom(value = {}) {
  if (Array.isArray(value)) return unique(value.map(pathValue));
  return unique([
    ...asArray(value.visual_v4_bridge_video_clips).map(pathValue),
    ...asArray(value.video_clips).map(pathValue),
    ...asArray(value.materialised_motion_clip_paths).map(pathValue),
    ...asArray(value.materialized_motion_clip_paths).map(pathValue),
    ...asArray(value.clips).map(pathValue),
    ...asArray(value.materialised_clips).map(pathValue),
    ...asArray(value.materialized_clips).map(pathValue),
    ...asArray(value.production_motion_clips).map(pathValue),
  ]);
}

function resolveWorkspacePath(filePath, workspaceRoot = process.cwd()) {
  const text = cleanText(filePath);
  if (!text) return null;
  if (path.isAbsolute(text)) return text;
  const mediaResolved = mediaPaths.resolveExistingSync(text);
  if (mediaResolved && fs.existsSync(mediaResolved)) return mediaResolved;
  return path.resolve(workspaceRoot, text);
}

async function usableFile(filePath, workspaceRoot = process.cwd(), minBytes = 1) {
  const resolved = resolveWorkspacePath(filePath, workspaceRoot);
  if (!resolved || !(await fs.pathExists(resolved))) return false;
  const stat = await fs.stat(resolved);
  return stat.isFile() && stat.size >= minBytes;
}

async function usableClipPaths(paths = [], workspaceRoot = process.cwd()) {
  const usable = [];
  for (const clipPath of unique(paths).filter((item) => /\.mp4$/i.test(item))) {
    if (await usableFile(clipPath, workspaceRoot, 1024)) usable.push(clipPath);
  }
  return usable;
}

function actionForReadyRerender(job = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  return {
    action_id: "run_visual_v4_production_render",
    status: "ready_after_sfx_manifest_cutover",
    force: true,
    reason_codes: ["sfx_render_asset_mismatch"],
    target_render_manifest: {
      renderer: "visual_v4_production",
      visual_tier: "production_v4_motion",
      final_publish_render: true,
      output: "visual_v4_render.mp4",
      output_path: path.join(artifactDir, "visual_v4_render.mp4"),
      manifest_path: path.join(artifactDir, "render_manifest.json"),
      story_id: cleanText(job.story_id),
    },
    output_expectations: [
      "visual_v4_render_story.json:sfx_asset_inventory matches sfx_manifest.json source_plan selected_assets",
      "render_manifest.json records a fresh forced Visual V4 production render",
      "strict dry-run no longer reports sfx_render_asset_mismatch for this story",
    ],
  };
}

function actionForBlockedRerender(blockers = []) {
  return {
    action_id: "repair_sfx_rerender_inputs",
    status: "required",
    reason_codes: asArray(blockers),
    output_expectations: [
      "final narration MP3 exists and is larger than 1KB",
      "word timestamp JSON exists and is parseable",
      "at least 3 materialised motion MP4 paths exist for a forced local rerender",
      "sfx_manifest.json contains approved source_plan.selected_assets",
    ],
    blocked_when: [
      "narration_audio_path_missing",
      "word_timestamps_path_missing",
      "materialised_motion_clip_paths_insufficient",
      "sfx_source_plan_missing",
    ],
  };
}

async function buildJobForCandidate(candidate = {}, {
  workspaceRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
} = {}) {
  const storyId = storyIdForCandidate(candidate);
  const artifactDir = artifactDirForCandidate(candidate, workspaceRoot);
  const [audioManifest, sfxManifest, renderStory, materialisedMotion] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "visual_v4_render_story.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {}),
  ]);

  const currentSfxAssets = selectedSfxAssetsFromManifest(sfxManifest);
  const renderedSfxAssets = renderedSfxAssetsFromStory(renderStory);
  const sfxRenderAssetMismatch =
    currentSfxAssets.length > 0 &&
    (renderedSfxAssets.length === 0 || !sameAssetIds(currentSfxAssets, renderedSfxAssets));

  const narrationAudioPath = cleanText(
    candidate.audio_path ||
      candidate.narration_audio_path ||
      audioManifest.narration_audio_path ||
      audioManifest.audio_path ||
      `output/audio/${storyId}.mp3`,
  );
  const wordTimestampsPath = cleanText(
    candidate.timestamps_path ||
      candidate.word_timestamps_path ||
      audioManifest.word_timestamps_path ||
      audioManifest.timestamps_path ||
      `output/audio/${storyId}_timestamps.json`,
  );
  const clipPaths = await usableClipPaths([
    ...clipPathsFrom(candidate),
    ...clipPathsFrom(renderStory),
    ...clipPathsFrom(materialisedMotion),
  ], workspaceRoot);

  const blockers = [];
  if (!currentSfxAssets.length) blockers.push("sfx_source_plan_missing");
  if (!(await usableFile(narrationAudioPath, workspaceRoot, 1024))) blockers.push("narration_audio_path_missing");
  if (!(await usableFile(wordTimestampsPath, workspaceRoot, 16))) blockers.push("word_timestamps_path_missing");
  if (clipPaths.length < 3) blockers.push("materialised_motion_clip_paths_insufficient");

  const job = {
    story_id: storyId,
    title: cleanText(candidate.title || candidate.public_title || candidate.upload_title),
    artifact_dir: artifactDir,
    force_final_render: true,
    status: blockers.length ? "blocked_on_rerender_inputs" : "ready_for_final_render_job",
    blockers,
    generated_at: generatedAt,
    rerender_reason: "sfx_render_asset_mismatch",
    evidence: {
      narration_audio_path: narrationAudioPath,
      word_timestamps_path: wordTimestampsPath,
      materialised_motion_clip_paths: clipPaths,
      materialised_motion_clip_count: clipPaths.length,
      current_sfx_asset_ids: assetIds(currentSfxAssets),
      rendered_sfx_asset_ids: assetIds(renderedSfxAssets),
      sfx_render_asset_mismatch: sfxRenderAssetMismatch,
      sfx_manifest_path: path.join(artifactDir, "sfx_manifest.json"),
      render_story_path: path.join(artifactDir, "visual_v4_render_story.json"),
    },
  };
  job.actions = blockers.length ? [actionForBlockedRerender(blockers)] : [actionForReadyRerender(job)];
  return job;
}

async function buildGoalSfxRerenderWorkOrder({
  bridgeCandidates = [],
  dryRunPlan = null,
  workspaceRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  includeAllBridgeCandidates = false,
} = {}) {
  const candidates = bridgeCandidatesFrom(bridgeCandidates);
  const mismatchIds = dryRunPlan ? dryRunSfxMismatchIds(dryRunPlan) : new Set();
  const dryRunHadMismatchEvidence = dryRunPlan && mismatchIds.size > 0;
  const jobs = [];
  const skippedCandidates = [];

  for (const candidate of candidates) {
    const storyId = storyIdForCandidate(candidate);
    if (!storyId) continue;
    const job = await buildJobForCandidate(candidate, { workspaceRoot, generatedAt });
    const shouldConsider =
      includeAllBridgeCandidates ||
      mismatchIds.has(storyId) ||
      (!dryRunHadMismatchEvidence && job.evidence.sfx_render_asset_mismatch === true);
    if (!shouldConsider) {
      skippedCandidates.push({
        story_id: storyId,
        reason: "not_selected_for_sfx_rerender",
      });
      continue;
    }
    if (job.evidence.sfx_render_asset_mismatch !== true) {
      skippedCandidates.push({
        story_id: storyId,
        reason: "sfx_already_aligned",
      });
      continue;
    }
    jobs.push(job);
  }

  const readyJobs = jobs.filter((job) => job.status === "ready_for_final_render_job");
  const blockedJobs = jobs.filter((job) => job.status === "blocked_on_rerender_inputs");
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_SFX_RERENDER_WORK_ORDER",
    summary: {
      bridge_candidate_count: candidates.length,
      story_count: jobs.length,
      ready_for_final_render_job_count: readyJobs.length,
      blocked_on_rerender_inputs_count: blockedJobs.length,
      sfx_render_asset_mismatch_count: jobs.filter((job) => job.evidence.sfx_render_asset_mismatch === true).length,
      skipped_candidate_count: skippedCandidates.length,
    },
    jobs,
    skipped_candidates: skippedCandidates,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      rerender_is_local_only: true,
    },
  };
}

function renderGoalSfxRerenderWorkOrderMarkdown(workOrder = {}) {
  const lines = [];
  lines.push("# Goal SFX Rerender Work Order");
  lines.push("");
  lines.push(`Generated: ${workOrder.generated_at || ""}`);
  lines.push(`Bridge candidates: ${workOrder.summary?.bridge_candidate_count || 0}`);
  lines.push(`Rerender jobs: ${workOrder.summary?.story_count || 0}`);
  lines.push(`Ready: ${workOrder.summary?.ready_for_final_render_job_count || 0}`);
  lines.push(`Blocked on inputs: ${workOrder.summary?.blocked_on_rerender_inputs_count || 0}`);
  lines.push(`Skipped: ${workOrder.summary?.skipped_candidate_count || 0}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(workOrder.jobs).slice(0, 40)) {
    const blockers = asArray(job.blockers).join(", ") || "none";
    lines.push(`- ${job.story_id}: ${job.status}; blockers: ${blockers}`);
  }
  if (!asArray(workOrder.jobs).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: local rerender planning only. No publish, database mutation, token change or OAuth change.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalSfxRerenderWorkOrder(workOrder = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalSfxRerenderWorkOrder requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "sfx_variant_rerender_work_order.json");
  const markdownPath = path.join(outDir, "sfx_variant_rerender_work_order.md");
  await fs.writeJson(jsonPath, workOrder, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalSfxRerenderWorkOrderMarkdown(workOrder), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  buildGoalSfxRerenderWorkOrder,
  writeGoalSfxRerenderWorkOrder,
  renderGoalSfxRerenderWorkOrderMarkdown,
  bridgeCandidatesFrom,
  dryRunSfxMismatchIds,
};
