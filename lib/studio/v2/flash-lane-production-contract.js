"use strict";

const { buildStudioEditorial } = require("../editorial-layer");
const {
  buildFlashLaneNarrationPlan,
  buildFlashLaneProofPreflight,
  resolveRequiredPulseEditorialContract,
} = require("./flash-lane-preflight");
const {
  resolveGovernedCtaCopy,
} = require("../../services/pulse-editorial-contract");

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function decideNextAction({ narrationPlan, hasNarration }) {
  const issues = new Set(narrationPlan?.issues || []);
  if (
    [...issues].some((issue) =>
      String(issue).startsWith("pulse_editorial_contract_"),
    )
  ) {
    return "repair_pulse_editorial_contract_before_voice";
  }
  if (issues.has("pulse_recap_later_pilot_disabled")) {
    return "route_to_disabled_recap_later_pilot";
  }
  if (
    issues.has("audio_duration_above_selected_band") ||
    issues.has("audio_duration_below_selected_band")
  ) {
    return "regenerate_approved_voice_within_selected_band";
  }
  if (issues.has("script_runtime_below_selected_band")) {
    return "expand_script_to_selected_band_before_voice";
  }
  if (issues.has("script_runtime_above_selected_band")) {
    return "tighten_script_to_selected_band_before_voice";
  }
  return hasNarration
    ? "ready_for_selected_band_render_preflight"
    : "generate_approved_flash_lane_voice";
}

function buildFlashLaneProductionContract({
  story,
  narrationDurationS = null,
  media = null,
  scenes = null,
  env = process.env,
} = {}) {
  const resolved = resolveRequiredPulseEditorialContract({ story });
  const editorialContract = resolved.contract;
  const editorial = buildStudioEditorial(
    story || {},
    editorialContract ? { maxWords: editorialContract.max_words } : {},
  );
  const scriptWordCount = Number(
    editorial.ttsWordCount || editorial.wordCount || 0,
  );
  const hasNarration =
    Number.isFinite(Number(narrationDurationS)) &&
    Number(narrationDurationS) > 0;
  const narrationPlan = buildFlashLaneNarrationPlan({
    scriptWordCount,
    narrationDurationS: hasNarration ? Number(narrationDurationS) : null,
    story,
    editorialContract,
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
          story,
          editorialContract,
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
    editorialContract?.format_family === "short" &&
    blockers.length === 0 &&
    (!proofPreflight || proofPreflight.verdict === "allow");
  const governedCta = resolveGovernedCtaCopy(story);

  return {
    schema_version: 2,
    lane_id: editorialContract?.editorial_lane_id || null,
    lane_name: editorialContract?.editorial_lane_label || null,
    render_lane_id: "pulse_flash_short",
    story_id: story?.id || null,
    title: story?.title || null,
    editorial_contract_version:
      editorialContract?.contract_version || null,
    duration_band_id: editorialContract?.duration_band_id || null,
    duration_variant: editorialContract?.duration_variant || null,
    runtime_target_seconds: editorialContract
      ? {
          min: editorialContract.min_seconds,
          max: editorialContract.max_seconds,
        }
      : null,
    script: {
      min_words: editorialContract?.min_words ?? null,
      max_words: editorialContract?.max_words ?? null,
      word_count: scriptWordCount,
      hook: editorial.hook,
      script_for_caption: editorial.scriptForCaption,
      script_for_tts: editorial.scriptForTTS,
      contextual_cta_selected: Boolean(governedCta),
      contextual_cta: governedCta || null,
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
    `Lane: ${contract.lane_id || "missing editorial contract"}`,
    `Duration band: ${contract.duration_band_id || "missing"}`,
    `Render allowed: ${contract.render_allowed === true ? "yes" : "no"}`,
    `Next action: ${contract.next_action || "unknown"}`,
    "",
    "## Script",
    "",
    `- Words: ${script.word_count ?? "unknown"} / max ${script.max_words ?? "unknown"}`,
    `- Target word range: ${plan.targetWordRange?.[0] ?? "?"}-${plan.targetWordRange?.[1] ?? "?"}`,
    `- Contextual CTA selected: ${script.contextual_cta_selected === true ? "yes" : "no"}`,
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
};
