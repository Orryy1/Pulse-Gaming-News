"use strict";

const path = require("node:path");
const fs = require("fs-extra");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map(clean).filter(Boolean)));
}

function actionId(action = {}) {
  return clean(action.action_id) || `${clean(action.story_id)}:${clean(action.platform)}`;
}

function resolvePath(root, filePath) {
  const value = clean(filePath);
  if (!value) return "";
  return path.isAbsolute(value) ? value : path.resolve(root || process.cwd(), value);
}

function planSafetyOk(plan = {}) {
  const safety = plan.safety || {};
  return (
    clean(plan.mode) === "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT" &&
    plan.ready_for_live_executor_handoff === true &&
    plan.live_publish_allowed_from_this_tool === false &&
    clean(plan.required_next_step) === "run_guarded_live_dispatch_executor" &&
    Number(plan.blocked_selected_action_count || 0) === 0 &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
}

async function readJsonIfPresent(filePath) {
  try {
    if (!filePath || !(await fs.pathExists(filePath))) return {};
    return await fs.readJson(filePath);
  } catch {
    return {};
  }
}

function storyById(stories = []) {
  return new Map(asArray(stories).map((story) => [clean(story.id || story.story_id), story]));
}

function storyCardPath(story = {}) {
  return clean(
    story.story_image_path ||
      story.image_path ||
      story.image_path_for_story_card ||
      story.story_card_path,
  );
}

async function imageExists(root, imagePath) {
  const resolved = resolvePath(root, imagePath);
  if (!resolved) return false;
  try {
    return (await fs.stat(resolved)).size >= 1024;
  } catch {
    return false;
  }
}

async function storyFromAction({ root, action, storiesById }) {
  const storyId = clean(action.story_id);
  const row = storiesById.get(storyId) || {};
  const canonical = await readJsonIfPresent(resolvePath(root, action.canonical_manifest_path));
  const title = clean(
    row.title ||
      canonical.selected_title ||
      canonical.canonical_title ||
      canonical.short_title ||
      action.title,
  );
  return {
    ...row,
    id: storyId,
    title,
    selected_title: title,
    approved: true,
    exported_path: clean(row.exported_path || action.video_path),
    flair: clean(row.flair || canonical.canonical_angle || canonical.content_pillar || "News"),
    classification: clean(row.classification || canonical.canonical_angle || canonical.content_pillar || "Confirmed Drop"),
    canonical_subject: clean(row.canonical_subject || canonical.canonical_subject || canonical.canonical_game),
    canonical_game: clean(row.canonical_game || canonical.canonical_game || canonical.canonical_subject),
    source_card_label: clean(row.source_card_label || canonical.source_card_label),
    thumbnail_source_label: clean(row.thumbnail_source_label || canonical.source_card_label),
    artifact_dir: clean(row.artifact_dir || path.dirname(resolvePath(root, action.canonical_manifest_path))),
    goal_artifact_dir: clean(row.goal_artifact_dir || path.dirname(resolvePath(root, action.canonical_manifest_path))),
    story_image_path: storyCardPath(row),
  };
}

async function defaultCardGenerator(stories, options) {
  const { generateStoryImagesForStories } = require("../images_story");
  return generateStoryImagesForStories(stories, options);
}

async function ensureStoryCardImage({
  root,
  action,
  story,
  materializeCards,
  cardGenerator,
  log,
} = {}) {
  if (storyCardPath(story) && (await imageExists(root, storyCardPath(story)))) {
    return {
      story,
      story_image_path: storyCardPath(story),
      generated: false,
      blockers: [],
    };
  }

  if (!materializeCards) {
    return {
      story,
      story_image_path: "",
      generated: false,
      blockers: ["story_card_image_missing"],
    };
  }

  const cardStory = {
    ...story,
    approved: true,
    exported_path: clean(story.exported_path || action.video_path),
  };
  const generator = cardGenerator || defaultCardGenerator;
  await generator([cardStory], {
    artifactRoot: path.resolve(root, "output", "goal-proof", "batch"),
    outputDir: path.join("output", "stories"),
    writePath: (relPath) => resolvePath(root, relPath),
    resolveExisting: async (relPath) => resolvePath(root, relPath),
    log: typeof log === "function" ? log : () => {},
  });

  const generatedPath = storyCardPath(cardStory);
  if (!generatedPath || !(await imageExists(root, generatedPath))) {
    return {
      story: cardStory,
      story_image_path: generatedPath,
      generated: Boolean(generatedPath),
      blockers: ["story_card_image_missing_after_materialize"],
    };
  }
  return {
    story: cardStory,
    story_image_path: generatedPath,
    generated: true,
    blockers: [],
  };
}

const STORY_CARD_DERIVATIVES = [
  {
    platform: "instagram_story",
    corePlatform: "instagram_reels",
  },
  {
    platform: "facebook_story",
    corePlatform: "facebook_reels",
  },
];

const STORY_CARD_PLATFORMS = new Set(STORY_CARD_DERIVATIVES.map((item) => item.platform));

function buildStoryCardAction({ baseAction, platform, corePlatform, imagePath, generatedAt }) {
  return {
    action_id: `${clean(baseAction.story_id)}:${platform}`,
    story_id: clean(baseAction.story_id),
    platform,
    title: clean(baseAction.title),
    operator: clean(baseAction.operator),
    operator_decided_at: clean(baseAction.operator_decided_at),
    image_path: clean(imagePath),
    story_image_path: clean(imagePath),
    first_frame_source: clean(imagePath),
    video_path: "",
    captions_path: "",
    canonical_manifest_path: clean(baseAction.canonical_manifest_path),
    platform_publish_manifest_path: clean(baseAction.platform_publish_manifest_path),
    derived_from_action_id: actionId(baseAction),
    derived_from_platform: corePlatform,
    media_type: "story_image",
    generated_at: generatedAt,
    live_publish_allowed_from_preflight_only: false,
    requires_live_executor_command: true,
    requires_last_second_kill_switch_check: true,
    requires_last_second_platform_recheck: true,
  };
}

async function buildGuardedStoryCardHandoff({
  root = process.cwd(),
  executorPlan = {},
  stories = [],
  materializeCards = false,
  cardGenerator = null,
  generatedAt = new Date().toISOString(),
  log = () => {},
} = {}) {
  const rootDir = path.resolve(root);
  const originalActions = asArray(executorPlan.handoff_ready_actions);
  const actionsByStory = new Map();
  const existingIds = new Set(originalActions.map(actionId));
  const appendedActionsByStory = new Map();
  const storiesById = storyById(stories);
  const blockedStoryCards = [];
  const generatedStoryIds = new Set();
  const advisory = [];
  const existingStoryCardActionCount = originalActions.filter((action) =>
    STORY_CARD_PLATFORMS.has(clean(action.platform)),
  ).length;

  for (const action of originalActions) {
    const storyId = clean(action.story_id);
    if (!storyId) continue;
    if (!actionsByStory.has(storyId)) actionsByStory.set(storyId, []);
    actionsByStory.get(storyId).push(action);
  }

  if (!planSafetyOk(executorPlan)) {
    blockedStoryCards.push({
      story_id: null,
      platform: null,
      blockers: ["executor_plan_safety_contract_failed"],
    });
  } else {
    for (const [storyId, storyActions] of actionsByStory.entries()) {
      const platforms = new Set(storyActions.map((action) => clean(action.platform)));
      const derivatives = STORY_CARD_DERIVATIVES.filter((item) => platforms.has(item.corePlatform));
      if (!derivatives.length) continue;

      const baseAction = storyActions.find((action) => clean(action.platform) === derivatives[0].corePlatform) || storyActions[0];
      const existingCardAction = storyActions.find(
        (item) => STORY_CARD_PLATFORMS.has(clean(item.platform)) && storyCardPath(item),
      );
      const story = await storyFromAction({ root: rootDir, action: baseAction, storiesById });
      if (!storyCardPath(story) && existingCardAction) {
        story.story_image_path = storyCardPath(existingCardAction);
      }
      const card = await ensureStoryCardImage({
        root: rootDir,
        action: baseAction,
        story,
        materializeCards,
        cardGenerator,
        log,
      });
      if (card.generated) generatedStoryIds.add(storyId);
      if (card.blockers.length) {
        blockedStoryCards.push({
          story_id: storyId,
          title: clean(baseAction.title),
          platforms: derivatives.map((item) => item.platform),
          blockers: card.blockers,
        });
        continue;
      }

      const appended = [];
      for (const derivative of derivatives) {
        const id = `${storyId}:${derivative.platform}`;
        if (existingIds.has(id)) continue;
        const coreAction = storyActions.find((item) => clean(item.platform) === derivative.corePlatform) || baseAction;
        appended.push(buildStoryCardAction({
          baseAction: coreAction,
          platform: derivative.platform,
          corePlatform: derivative.corePlatform,
          imagePath: card.story_image_path,
          generatedAt,
        }));
      }
      if (appended.length) appendedActionsByStory.set(storyId, appended);
    }
  }

  const augmentedActions = [];
  const lastIndexByStory = new Map();
  originalActions.forEach((action, index) => lastIndexByStory.set(clean(action.story_id), index));
  originalActions.forEach((action, index) => {
    augmentedActions.push(action);
    const storyId = clean(action.story_id);
    if (lastIndexByStory.get(storyId) === index) {
      augmentedActions.push(...asArray(appendedActionsByStory.get(storyId)));
    }
  });

  const appendedActions = Array.from(appendedActionsByStory.values()).flat();
  const totalStoryCardActionCount = existingStoryCardActionCount + appendedActions.length;
  if (!appendedActions.length && !existingStoryCardActionCount) {
    advisory.push("no_story_card_actions_appended");
  } else if (!appendedActions.length) {
    advisory.push("story_card_actions_already_present");
  }
  const verdict = blockedStoryCards.length
    ? "RED"
    : totalStoryCardActionCount
      ? "GREEN"
      : "AMBER";

  const executorPlanOut = {
    ...executorPlan,
    generated_at: generatedAt,
    handoff_ready_action_count: augmentedActions.length,
    handoff_ready_actions: augmentedActions,
    story_card_handoff: {
      generated_at: generatedAt,
      materialize_cards: materializeCards === true,
      existing_story_card_action_count: existingStoryCardActionCount,
      appended_story_card_action_count: appendedActions.length,
      total_story_card_action_count: totalStoryCardActionCount,
      generated_story_card_count: generatedStoryIds.size,
      source_executor_plan_generated_at: clean(executorPlan.generated_at),
    },
  };

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GUARDED_STORY_CARD_HANDOFF",
    verdict,
    safe_to_publish_boolean: false,
    summary: {
      source_handoff_action_count: originalActions.length,
      existing_story_card_action_count: existingStoryCardActionCount,
      appended_story_card_action_count: appendedActions.length,
      total_story_card_action_count: totalStoryCardActionCount,
      generated_story_card_count: generatedStoryIds.size,
      blocked_story_card_count: blockedStoryCards.length,
      output_handoff_action_count: augmentedActions.length,
    },
    appended_actions: appendedActions,
    blocked_story_cards: blockedStoryCards,
    advisory,
    executor_plan: executorPlanOut,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function renderGuardedStoryCardHandoffMarkdown(report = {}) {
  const lines = [
    "# Guarded Story Card Handoff",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "UNKNOWN"}`,
    `Appended Story actions: ${report.summary?.appended_story_card_action_count || 0}`,
    `Generated cards: ${report.summary?.generated_story_card_count || 0}`,
    `Blocked cards: ${report.summary?.blocked_story_card_count || 0}`,
    "No uploads are triggered. No database rows, OAuth settings or token files are changed.",
    "",
  ];
  for (const action of asArray(report.appended_actions)) {
    lines.push(`- ${action.action_id}: ${action.story_image_path}`);
  }
  if (asArray(report.blocked_story_cards).length) {
    lines.push("", "## Blocked", "");
    for (const item of asArray(report.blocked_story_cards)) {
      lines.push(`- ${item.story_id || "unknown"}: ${asArray(item.blockers).join(", ")}`);
    }
  }
  return lines.join("\n");
}

async function writeGuardedStoryCardHandoff(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGuardedStoryCardHandoff requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, "guarded_story_card_handoff_report.json");
  const executorPlanPath = path.join(outDir, "guarded_dispatch_executor_plan.json");
  const markdownPath = path.join(outDir, "guarded_story_card_handoff.md");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeJson(executorPlanPath, report.executor_plan || {}, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGuardedStoryCardHandoffMarkdown(report), "utf8");
  return { outputDir: outDir, reportPath, executorPlanPath, markdownPath };
}

module.exports = {
  buildGuardedStoryCardHandoff,
  renderGuardedStoryCardHandoffMarkdown,
  writeGuardedStoryCardHandoff,
};
