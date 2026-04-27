"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildClipIntelligenceVault,
  reorderMediaByVault,
} = require("./clip-intelligence-vault");
const { analyseVisualTimeline, buildFrameQaChecklist } = require("./creator-visual-qa");
const { runHumanStyleRewrite } = require("./human-style-rewrite");
const { planRetentionAB } = require("./retention-ab-engine");
const { buildSemanticTimeline, annotateScenesWithBeats } = require("./semantic-timeline-director");
const { planSoundDesign } = require("./sound-design-composer");

function loadJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return fs.readJsonSync(filePath);
  } catch {
    return null;
  }
}

function buildCreatorGradePlan({
  story = {},
  media = {},
  packageData = null,
  renderReport = null,
  scenes = null,
  runtimeS = null,
  previousUsage = {},
} = {}) {
  const script =
    packageData?.script?.tightened ||
    story.full_script ||
    story.body ||
    renderReport?.editorial?.chosenHook ||
    "";
  const rewrite = runHumanStyleRewrite({
    title: story.title || packageData?.title || "",
    script,
  });
  const vault = buildClipIntelligenceVault({
    storyId: story.id || packageData?.storyId || renderReport?.storyId,
    media,
    previousUsage,
  });
  const plannedRuntime =
    runtimeS ||
    renderReport?.runtime?.durationS ||
    renderReport?.auto?.durationIntegrity?.renderedDurationS ||
    54;
  const timeline = buildSemanticTimeline({
    story,
    script: rewrite.tightenedScript || script,
    vault,
    runtimeS: plannedRuntime,
  });
  const annotatedScenes = annotateScenesWithBeats(
    scenes || renderReport?.sceneList || [],
    timeline,
  );
  const visualQa = analyseVisualTimeline({ scenes: annotatedScenes, vault, timeline });
  const soundPlan = planSoundDesign({
    timeline,
    heroMoments: renderReport?.heroMoments?.moments || [],
  });
  const abPlan = planRetentionAB({ vault, timeline, visualQa });

  const blockers = [];
  if (vault.stats.clipCount < 2) blockers.push("clip_inventory_thin");
  if (visualQa.verdict === "reject") blockers.push("visual_qa_reject");
  if (soundPlan.verdict !== "pass") blockers.push("sound_recurrence_review");
  if (timeline.alignment.coverage < 0.65) blockers.push("shot_script_alignment_low");

  const verdict = blockers.length
    ? blockers.includes("visual_qa_reject") || blockers.includes("clip_inventory_thin")
      ? "review"
      : "pass_with_notes"
    : "pass";

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    storyId: story.id || packageData?.storyId || renderReport?.storyId || null,
    verdict,
    blockers,
    rewrite,
    vault,
    timeline,
    annotatedScenes,
    visualQa,
    soundPlan,
    abPlan,
    reorderedMediaPreview: {
      clips: reorderMediaByVault(media, vault).clips?.map((item) => path.basename(item.path)) || [],
      trailerFrames:
        reorderMediaByVault(media, vault).trailerFrames?.map((item) => path.basename(item.path)) || [],
      articleHeroes:
        reorderMediaByVault(media, vault).articleHeroes?.map((item) => path.basename(item.path)) || [],
    },
  };
}

function renderCreatorGradeMarkdown(plan, { renderPath = null, contactSheetPath = null } = {}) {
  const lines = [];
  lines.push("# Creator-Grade Studio Brain");
  lines.push("");
  lines.push(`Generated: ${plan.generatedAt}`);
  lines.push(`Story: ${plan.storyId}`);
  lines.push(`Verdict: ${plan.verdict}`);
  if (plan.blockers.length) lines.push(`Blockers: ${plan.blockers.join(", ")}`);
  lines.push("");
  lines.push("## Rewrite");
  lines.push(`- Hook: ${plan.rewrite.hook}`);
  lines.push(`- Tightened words: ${plan.rewrite.wordCount}`);
  lines.push(`- AI tells removed: ${plan.rewrite.removedAiTells.length}`);
  lines.push(`- Filler removed: ${plan.rewrite.removedFiller.length}`);
  lines.push("");
  lines.push("## Clip Intelligence Vault");
  lines.push(`- Accepted assets: ${plan.vault.stats.acceptedAssets}`);
  lines.push(`- Clips: ${plan.vault.stats.clipCount}`);
  lines.push(`- Stock rejected: ${plan.vault.stats.stockRejected}`);
  for (const asset of plan.vault.assets.slice(0, 6)) {
    lines.push(`- ${asset.file}: ${asset.score}/100 (${asset.kind})`);
  }
  lines.push("");
  lines.push("## Semantic Timeline");
  for (const beat of plan.timeline.beats) {
    lines.push(`- ${beat.type} ${beat.startS}-${beat.endS}s: ${beat.treatment}`);
  }
  lines.push("");
  lines.push("## Shot Alignment");
  lines.push(`- Coverage: ${Math.round(plan.timeline.alignment.coverage * 100)}%`);
  for (const a of plan.timeline.alignment.alignments.slice(0, 8)) {
    lines.push(`- ${a.tags.join("/")} -> ${a.assetFile || "no asset"}: ${a.text}`);
  }
  lines.push("");
  lines.push("## Visual QA");
  lines.push(`- Score: ${plan.visualQa.score}/100 (${plan.visualQa.verdict})`);
  for (const issue of plan.visualQa.issues.slice(0, 10)) {
    lines.push(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
  }
  if (!plan.visualQa.issues.length) lines.push("- No timeline issues found in planned scene audit.");
  lines.push("");
  lines.push("## Sound Design");
  lines.push(`- Verdict: ${plan.soundPlan.verdict}`);
  for (const cue of plan.soundPlan.cues) {
    lines.push(`- ${cue.kind}@${cue.atS}s: ${cue.reason}`);
  }
  lines.push("");
  lines.push("## A/B Recommendation");
  lines.push(`- Winner: ${plan.abPlan.winner?.id || "none"} (${plan.abPlan.winner?.score ?? 0}/100)`);
  lines.push(`- ${plan.abPlan.recommendation}`);
  lines.push("");
  lines.push("## Rendered Proof Checklist");
  for (const check of buildFrameQaChecklist({ renderPath, contactSheetPath })) {
    lines.push(`- ${check.check}: ${check.method}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Local planning and render-scoring only.");
  lines.push("- No publishing, deploys, env changes or platform APIs.");
  return `${lines.join("\n")}\n`;
}

async function writeCreatorGradePlan({ plan, outputDir, basename = "creator_grade" }) {
  await fs.ensureDir(outputDir);
  const jsonPath = path.join(outputDir, `${basename}.json`);
  const mdPath = path.join(outputDir, `${basename}.md`);
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeFile(mdPath, renderCreatorGradeMarkdown(plan), "utf8");
  return { jsonPath, mdPath };
}

module.exports = {
  buildCreatorGradePlan,
  loadJsonIfExists,
  renderCreatorGradeMarkdown,
  writeCreatorGradePlan,
};
