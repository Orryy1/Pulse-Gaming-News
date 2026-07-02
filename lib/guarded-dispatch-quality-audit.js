"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const MIN_HYPERFRAMES_CARDS = 4;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (filePath && await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function artifactDirForAction(action = {}) {
  const candidates = [
    action.canonical_manifest_path,
    action.platform_publish_manifest_path,
    action.video_path,
    action.captions_path,
  ].map(cleanText).filter(Boolean);
  const filePath = candidates.find(Boolean);
  return filePath ? path.dirname(filePath) : "";
}

function normaliseVisualSourceRoot(value = "") {
  return cleanText(value)
    .replace(/\\/g, "/")
    .toLowerCase()
    .replace(/(?:^|[_-])window[_-]\d+(?:[_-]\d+)?/g, "")
    .replace(/(?:^|[_-])segment[_-]?\d+/g, "")
    .replace(/[?#].*$/g, "")
    .replace(/[_-]{2,}/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
}

function sceneSourceRoot(scene = {}) {
  return normaliseVisualSourceRoot(
    scene.sourceRootKey ||
      scene.source_root_key ||
      scene.source_family ||
      scene.sourceFamily ||
      scene.motion_family ||
      scene.motionFamily ||
      scene.source_url ||
      scene.sourceUrl ||
      scene.path ||
      scene.asset_id ||
      scene.id,
  );
}

function sceneListFrom({ renderManifest = {}, renderStory = {} } = {}) {
  for (const candidate of [
    renderManifest.clip_scene_plan?.scenes,
    renderManifest.scene_plan?.scenes,
    renderManifest.scenes,
    renderManifest.clips,
    renderStory.clip_scene_plan?.scenes,
    renderStory.scene_plan?.scenes,
    renderStory.scenes,
    renderStory.selected_clips,
    renderStory.motion_clips,
    renderStory.clips,
  ]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function hyperframesCardCount(renderManifest = {}) {
  const value =
    renderManifest.hyperframesCardCount ??
    renderManifest.hyperframes_card_count ??
    renderManifest.premiumLane?.hyperframesCardCount ??
    renderManifest.premiumLane?.hyperframes_card_count ??
    renderManifest.premium_lane?.hyperframesCardCount ??
    renderManifest.premium_lane?.hyperframes_card_count;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function instagramVariantBlockers({ action = {}, platformManifest = {} } = {}) {
  if (cleanText(action.platform) !== "instagram_reels") return [];
  const output = platformManifest.outputs?.instagram_reels || {};
  const videoPath = cleanText(output.variant_video_path || output.platform_variant_render?.output_path);
  const captionsPath = cleanText(output.variant_captions_path || output.platform_variant_render?.captions_path);
  const profile = cleanText(output.platform_variant_render?.encoder_profile);
  const blockers = [];
  if (!videoPath) blockers.push("instagram_reels_native_variant_missing");
  if (videoPath && !captionsPath) blockers.push("instagram_reels_native_variant_captions_missing");
  if (videoPath && profile !== "instagram_reels_meta_safe_h264_aac_v3") {
    blockers.push("instagram_reels_native_variant_not_meta_safe");
  }
  return blockers;
}

function repeatedSourceRootBlockers(scenes = []) {
  const counts = new Map();
  for (const scene of scenes) {
    const root = sceneSourceRoot(scene);
    if (!root) continue;
    counts.set(root, (counts.get(root) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([root, count]) => `repeated_visual_source_root:${root}:${count}`);
}

async function inspectStory({ storyId, actions = [] } = {}) {
  const firstAction = actions[0] || {};
  const artifactDir = artifactDirForAction(firstAction);
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"));
  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"));
  const renderStory = await readJsonIfPresent(path.join(artifactDir, "visual_v4_render_story.json"));
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"));
  const scenes = sceneListFrom({ renderManifest, renderStory });
  const cardCount = hyperframesCardCount(renderManifest);
  const blockers = [
    ...repeatedSourceRootBlockers(scenes),
    ...actions.flatMap((action) => instagramVariantBlockers({ action, platformManifest })),
  ];
  const warnings = [];
  if (cardCount < MIN_HYPERFRAMES_CARDS) {
    warnings.push(`hyperframes_card_count_below_target:${cardCount}/${MIN_HYPERFRAMES_CARDS}`);
  }

  return {
    story_id: storyId,
    title: cleanText(firstAction.title || canonical.selected_title || canonical.short_title || canonical.title),
    artifact_dir: artifactDir,
    platforms: actions.map((action) => cleanText(action.platform)).filter(Boolean),
    hyperframes_card_count: cardCount,
    scene_count: scenes.length,
    blockers,
    warnings,
  };
}

async function buildGuardedDispatchQualityAudit({
  guardedDispatchExecutorPreflight = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const actions = asArray(guardedDispatchExecutorPreflight.handoff_ready_actions);
  const byStory = new Map();
  for (const action of actions) {
    const storyId = cleanText(action.story_id);
    if (!storyId) continue;
    byStory.set(storyId, [...(byStory.get(storyId) || []), action]);
  }
  const stories = [];
  for (const [storyId, storyActions] of byStory.entries()) {
    stories.push(await inspectStory({ storyId, actions: storyActions }));
  }
  const blockerCount = stories.reduce((sum, story) => sum + story.blockers.length, 0);
  const warningCount = stories.reduce((sum, story) => sum + story.warnings.length, 0);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GUARDED_DISPATCH_QUALITY_AUDIT",
    verdict: blockerCount > 0 ? "RED" : warningCount > 0 ? "AMBER" : "GREEN",
    summary: {
      action_count: actions.length,
      story_count: stories.length,
      blocker_count: blockerCount,
      warning_count: warningCount,
    },
    stories,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function renderGuardedDispatchQualityAuditMarkdown(report = {}) {
  const lines = [
    "# Guarded Dispatch Quality Audit",
    "",
    `Generated: ${report.generated_at || ""}`,
    `Verdict: ${report.verdict || "UNKNOWN"}`,
    `Stories: ${report.summary?.story_count || 0}`,
    `Blockers: ${report.summary?.blocker_count || 0}`,
    `Warnings: ${report.summary?.warning_count || 0}`,
    "",
  ];
  for (const story of asArray(report.stories)) {
    lines.push(`## ${story.story_id}: ${story.title || "Untitled"}`);
    lines.push(`Platforms: ${asArray(story.platforms).join(", ") || "none"}`);
    lines.push(`HyperFrames/cards: ${story.hyperframes_card_count}`);
    lines.push(`Scene count: ${story.scene_count}`);
    if (asArray(story.blockers).length) {
      lines.push(`Blockers: ${story.blockers.join(", ")}`);
    }
    if (asArray(story.warnings).length) {
      lines.push(`Warnings: ${story.warnings.join(", ")}`);
    }
    lines.push("");
  }
  lines.push("Safety: no publish, no network upload, no DB mutation, no OAuth/token change.");
  return `${lines.join("\n")}\n`;
}

async function writeGuardedDispatchQualityAudit(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGuardedDispatchQualityAudit requires outputDir");
  await fs.ensureDir(outputDir);
  const jsonPath = path.join(outputDir, "guarded_dispatch_quality_audit.json");
  const markdownPath = path.join(outputDir, "guarded_dispatch_quality_audit.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGuardedDispatchQualityAuditMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

module.exports = {
  buildGuardedDispatchQualityAudit,
  renderGuardedDispatchQualityAuditMarkdown,
  writeGuardedDispatchQualityAudit,
  _private: {
    normaliseVisualSourceRoot,
    repeatedSourceRootBlockers,
  },
};
