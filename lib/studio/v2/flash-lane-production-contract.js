"use strict";

const { buildStudioEditorial } = require("../editorial-layer");
const {
  buildFlashLaneNarrationPlan,
  buildFlashLaneProofPreflight,
} = require("./flash-lane-preflight");

const FLASH_LANE_DEFAULT_MAX_WORDS = 175;

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function normaliseMaxWords(env = process.env) {
  const configured = Number(env.STUDIO_FLASH_LANE_MAX_WORDS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return FLASH_LANE_DEFAULT_MAX_WORDS;
}

function decideNextAction({ narrationPlan, hasNarration }) {
  const issues = new Set(narrationPlan?.issues || []);
  if (issues.has("spoken_pace_too_slow") || issues.has("spoken_pace_too_fast")) {
    return "regenerate_approved_flash_lane_voice";
  }
  if (issues.has("narration_too_long_for_flash_lane")) {
    return "regenerate_approved_flash_lane_voice";
  }
  if (issues.has("narration_too_short_for_creator_rewards_target")) {
    return "expand_or_regenerate_flash_lane_voice";
  }
  if (issues.has("script_too_short_for_flash_lane_target")) {
    return "expand_flash_lane_script_before_voice";
  }
  if (issues.has("script_too_long_for_flash_lane_target")) {
    return "tighten_flash_lane_script_before_voice";
  }
  return hasNarration ? "ready_for_flash_lane_render_preflight" : "generate_approved_flash_lane_voice";
}

function buildFlashLaneProductionContract({
  story,
  narrationDurationS = null,
  media = null,
  scenes = null,
  env = process.env,
} = {}) {
  const maxWords = normaliseMaxWords(env);
  const editorial = buildStudioEditorial(story || {}, { maxWords });
  const scriptWordCount = Number(editorial.ttsWordCount || editorial.wordCount || 0);
  const hasNarration = Number.isFinite(Number(narrationDurationS)) && Number(narrationDurationS) > 0;
  const narrationPlan = buildFlashLaneNarrationPlan({
    scriptWordCount,
    narrationDurationS: hasNarration ? Number(narrationDurationS) : null,
  });

  const proofPreflight =
    media && Array.isArray(scenes)
      ? buildFlashLaneProofPreflight({
          narration: {
            mode: hasNarration ? "real_audio" : "pending_audio",
            provider: hasNarration ? "external" : "none",
            source: hasNarration ? "provided-real-audio" : "not_generated",
            durationS: hasNarration ? Number(narrationDurationS) : null,
          },
          scenes,
          media,
          scriptWordCount,
          env,
        })
      : null;

  const blockers = unique([
    ...narrationPlan.issues,
    ...(proofPreflight?.blockers || []),
  ]);
  const warnings = unique(proofPreflight?.warnings || []);
  const nextAction = decideNextAction({ narrationPlan, hasNarration });
  const renderAllowed =
    hasNarration &&
    blockers.length === 0 &&
    (!proofPreflight || proofPreflight.verdict === "allow");

  return {
    schema_version: 1,
    lane_id: "pulse_flash_short",
    lane_name: "Pulse Flash Lane",
    story_id: story?.id || null,
    title: story?.title || null,
    runtime_target_seconds: { min: 61, max: 75 },
    script: {
      max_words: maxWords,
      word_count: scriptWordCount,
      hook: editorial.hook,
      script_for_caption: editorial.scriptForCaption,
      script_for_tts: editorial.scriptForTTS,
      spoken_outro_required: true,
      generic_cta_removed_from_body: editorial.removedGenericCta,
    },
    narration_plan: narrationPlan,
    proof_preflight: proofPreflight,
    blockers,
    warnings,
    next_action: nextAction,
    render_allowed: renderAllowed,
    production_safety: {
      report_only: true,
      calls_tts: false,
      renders_video: false,
      posts_to_platforms: false,
      mutates_production_db: false,
      mutates_railway: false,
    },
  };
}

function renderFlashLaneProductionContractMarkdown(contract = {}) {
  const plan = contract.narration_plan || {};
  const script = contract.script || {};
  const blockers = Array.isArray(contract.blockers) ? contract.blockers : [];
  const warnings = Array.isArray(contract.warnings) ? contract.warnings : [];
  const currentDuration =
    plan.narrationDurationS === null || plan.narrationDurationS === undefined
      ? "not generated"
      : `${plan.narrationDurationS}s`;
  const currentPace =
    plan.spokenWpm === null || plan.spokenWpm === undefined
      ? "not generated"
      : `${plan.spokenWpm} WPM`;
  const lines = [
    "# Pulse Flash Lane Production Contract",
    "",
    `Story: ${contract.story_id || "unknown"}`,
    `Title: ${contract.title || "Untitled"}`,
    `Lane: ${contract.lane_id || "pulse_flash_short"}`,
    `Render allowed: ${contract.render_allowed === true ? "yes" : "no"}`,
    `Next action: ${contract.next_action || "unknown"}`,
    "",
    "## Script",
    "",
    `- Words: ${script.word_count ?? "unknown"} / max ${script.max_words ?? "unknown"}`,
    `- Target word range: ${plan.targetWordRange?.[0] ?? "?"}-${plan.targetWordRange?.[1] ?? "?"}`,
    `- Spoken outro required: ${script.spoken_outro_required === true ? "yes" : "no"}`,
    "",
    "## Narration Plan",
    "",
    `- Target runtime: ${plan.targetRuntimeS?.[0] ?? "?"}-${plan.targetRuntimeS?.[1] ?? "?"}s`,
    `- Ideal pace: ${plan.idealWpmRange?.[0] ?? "?"}-${plan.idealWpmRange?.[1] ?? "?"} WPM`,
    `- Current duration: ${currentDuration}`,
    `- Current pace: ${currentPace}`,
    `- Recommendation: ${plan.recommendation || "unknown"}`,
    "",
    "## Blockers",
    "",
    blockers.length ? blockers.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "## Warnings",
    "",
    warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "## Safety",
    "",
    "- No TTS, render, OAuth, Railway or posting actions are performed by this contract.",
  ];
  return lines.join("\n") + "\n";
}

module.exports = {
  buildFlashLaneProductionContract,
  renderFlashLaneProductionContractMarkdown,
  FLASH_LANE_DEFAULT_MAX_WORDS,
};
