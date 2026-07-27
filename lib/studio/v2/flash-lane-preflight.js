"use strict";

const { narrationVoiceBlocker } = require("./proof-render-safety");
const {
  buildFlashLaneVisualDirector,
} = require("./flash-lane-visual-director");
const {
  resolvePulseScriptContract,
} = require("../../services/pulse-editorial-contract");

const FLASH_ACTUAL_CLIP_TYPES = new Set(["clip", "punch", "speed-ramp", "freeze-frame"]);
const FLASH_SUPPORTING_MOTION_TYPES = new Set(["clip.frame"]);
const TARGET_ACTUAL_CLIP_DOMINANCE = 0.55;
const MIN_ACTUAL_CLIP_SCENES = 2;
const MAX_ACTUAL_CLIP_SCENES_PER_REF = 3;
const MAX_CARD_RATIO = 0.35;
const REQUIRED_EDITORIAL_FIELDS = Object.freeze([
  "editorial_lane_id",
  "hook_type",
  "duration_band_id",
]);

function sceneType(scene) {
  return String(scene?.type || scene?.sceneType || "");
}

function isClipBackedOpener(scene) {
  return sceneType(scene) === "opener" && scene?.isClipBacked === true;
}

function isActualClipScene(scene) {
  return FLASH_ACTUAL_CLIP_TYPES.has(sceneType(scene)) || isClipBackedOpener(scene);
}

function isSupportingMotionScene(scene) {
  return FLASH_SUPPORTING_MOTION_TYPES.has(sceneType(scene));
}

function isCardScene(scene) {
  return sceneType(scene).startsWith("card.");
}

function resolveRequiredPulseEditorialContract({
  story = {},
  editorialContract = null,
} = {}) {
  const missingFields = REQUIRED_EDITORIAL_FIELDS.filter(
    (field) => !String(story?.[field] || "").trim(),
  );
  if (!editorialContract && missingFields.length > 0) {
    return {
      contract: null,
      blocker: `pulse_editorial_contract_metadata_missing:${missingFields.join(",")}`,
    };
  }
  try {
    const contract =
      editorialContract || resolvePulseScriptContract({ story });
    if (contract.format_family !== "short") {
      return {
        contract,
        blocker: "pulse_recap_later_pilot_disabled",
      };
    }
    if (
      !Number.isFinite(Number(contract.min_seconds)) ||
      !Number.isFinite(Number(contract.max_seconds)) ||
      !Number.isFinite(Number(contract.min_words)) ||
      !Number.isFinite(Number(contract.max_words))
    ) {
      return {
        contract: null,
        blocker: "pulse_editorial_contract_invalid:runtime_bounds_missing",
      };
    }
    for (const field of REQUIRED_EDITORIAL_FIELDS) {
      if (
        story?.[field] &&
        String(story[field]) !==
          String(
            field === "editorial_lane_id"
              ? contract.editorial_lane_id
              : field === "hook_type"
                ? contract.hook_type
                : contract.duration_band_id,
          )
      ) {
        return {
          contract: null,
          blocker: `pulse_editorial_contract_invalid:${field}_mismatch`,
        };
      }
    }
    return { contract, blocker: null };
  } catch (error) {
    return {
      contract: null,
      blocker: `pulse_editorial_contract_invalid:${error.message}`,
    };
  }
}

function buildFlashLaneNarrationPlan({
  scriptWordCount,
  narrationDurationS,
  story,
  editorialContract,
} = {}) {
  const resolved = resolveRequiredPulseEditorialContract({
    story,
    editorialContract,
  });
  const contract = resolved.contract;
  const wordCount = Number(scriptWordCount);
  const duration = Number(narrationDurationS);
  const targetWordMin = Number(contract?.min_words);
  const targetWordMax = Number(contract?.max_words);
  const minRuntimeS = Number(contract?.min_seconds);
  const maxRuntimeS = Number(contract?.max_seconds);
  const spokenWpm =
    Number.isFinite(wordCount) && wordCount > 0 && Number.isFinite(duration) && duration > 0
      ? Number(((wordCount / duration) * 60).toFixed(1))
      : null;
  const calibratedWpm = Number.isFinite(Number(contract?.seconds_per_word))
    ? Number((60 / Number(contract.seconds_per_word)).toFixed(1))
    : null;
  const issues = resolved.blocker ? [resolved.blocker] : [];
  if (contract && Number.isFinite(wordCount) && wordCount > 0) {
    if (wordCount < targetWordMin) {
      issues.push("script_runtime_below_selected_band");
    }
    if (wordCount > targetWordMax) {
      issues.push("script_runtime_above_selected_band");
    }
  }
  if (contract && Number.isFinite(duration) && duration > 0) {
    if (duration < minRuntimeS) {
      issues.push("audio_duration_below_selected_band");
    }
    if (duration > maxRuntimeS) {
      issues.push("audio_duration_above_selected_band");
    }
  }

  let recommendation = "script_length_ok_generate_approved_voice";
  if (issues.some((issue) => issue.startsWith("pulse_editorial_contract_"))) {
    recommendation = "repair_pulse_editorial_contract_before_voice";
  } else if (issues.includes("pulse_recap_later_pilot_disabled")) {
    recommendation = "route_to_disabled_recap_later_pilot";
  } else if (issues.includes("script_runtime_below_selected_band")) {
    recommendation = "expand_script_to_selected_band_before_voice";
  } else if (issues.includes("script_runtime_above_selected_band")) {
    recommendation = "tighten_script_to_selected_band_before_voice";
  } else if (
    issues.includes("audio_duration_above_selected_band") ||
    issues.includes("audio_duration_below_selected_band")
  ) {
    recommendation = "regenerate_narration_within_selected_band";
  }

  return {
    durationBandId: contract?.duration_band_id || null,
    targetRuntimeS: contract ? [minRuntimeS, maxRuntimeS] : null,
    calibratedWpm,
    idealWpmRange: calibratedWpm
      ? [
          Number((calibratedWpm * 0.85).toFixed(1)),
          Number((calibratedWpm * 1.15).toFixed(1)),
        ]
      : null,
    targetWordRange: contract ? [targetWordMin, targetWordMax] : null,
    scriptWordCount: Number.isFinite(wordCount) && wordCount > 0 ? wordCount : null,
    narrationDurationS: Number.isFinite(duration) && duration > 0 ? Number(duration.toFixed(3)) : null,
    spokenWpm,
    issues,
    recommendation,
  };
}

function buildFlashLaneProofPreflight({
  narration,
  scenes,
  media,
  scriptWordCount,
  story,
  editorialContract,
  env = process.env,
} = {}) {
  const list = Array.isArray(scenes) ? scenes : [];
  const totalScenes = list.length;
  const actualClipScenes = list.filter(isActualClipScene).length;
  const supportingMotionScenes = list.filter(isSupportingMotionScene).length;
  const cardScenes = list.filter(isCardScene).length;
  const actualClipDominance =
    totalScenes > 0 ? Number((actualClipScenes / totalScenes).toFixed(2)) : 0;
  const motionDominance =
    totalScenes > 0
      ? Number(((actualClipScenes + supportingMotionScenes) / totalScenes).toFixed(2))
      : 0;
  const cardRatio = totalScenes > 0 ? Number((cardScenes / totalScenes).toFixed(2)) : 0;
  const narrationDurationS = Number(narration?.durationS);
  const wordCount = Number(scriptWordCount);
  const narrationPlan = buildFlashLaneNarrationPlan({
    scriptWordCount: wordCount,
    narrationDurationS,
    story,
    editorialContract,
  });
  const spokenWpm =
    Number.isFinite(wordCount) && wordCount > 0 && Number.isFinite(narrationDurationS) && narrationDurationS > 0
      ? Number(((wordCount / narrationDurationS) * 60).toFixed(1))
      : null;
  const availableClipRefs = Array.isArray(media?.clips) ? media.clips.length : 0;
  const availableTrailerFrames = Array.isArray(media?.trailerFrames)
    ? media.trailerFrames.length
    : 0;

  const blockers = [];
  const warnings = [];
  const voiceBlocker = narrationVoiceBlocker(narration, env, { story });
  if (voiceBlocker) blockers.push(voiceBlocker);
  blockers.push(...narrationPlan.issues);
  if (availableClipRefs < MIN_ACTUAL_CLIP_SCENES || actualClipScenes < MIN_ACTUAL_CLIP_SCENES) {
    blockers.push("flash_lane_requires_two_actual_clip_scenes");
  }
  if (
    availableClipRefs > 0 &&
    actualClipScenes > availableClipRefs * MAX_ACTUAL_CLIP_SCENES_PER_REF
  ) {
    blockers.push("flash_lane_clip_reuse_too_high");
  }
  if (actualClipDominance < TARGET_ACTUAL_CLIP_DOMINANCE) {
    const exhaustedValidatedClipRefs =
      availableClipRefs > 0 && actualClipScenes >= availableClipRefs;
    const trailerFramesCarryGap =
      exhaustedValidatedClipRefs && supportingMotionScenes >= 3 && motionDominance >= 0.75;
    if (trailerFramesCarryGap) {
      warnings.push("flash_lane_clip_dominance_supported_by_trailer_frames");
    } else {
      blockers.push("flash_lane_clip_dominance_below_target");
    }
  }
  if (supportingMotionScenes === 0 && availableTrailerFrames === 0) {
    warnings.push("flash_lane_has_no_trailer_frame_support");
  }
  if (cardRatio > MAX_CARD_RATIO) warnings.push("flash_lane_card_ratio_high");
  const visualDirector = buildFlashLaneVisualDirector({
    scenes: list,
    media,
    narrationDurationS,
  });
  blockers.push(...visualDirector.blockers);
  warnings.push(...visualDirector.warnings);

  return {
    verdict: blockers.length > 0 ? "block" : "allow",
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    thresholds: {
      minActualClipScenes: MIN_ACTUAL_CLIP_SCENES,
      maxActualClipScenesPerRef: MAX_ACTUAL_CLIP_SCENES_PER_REF,
      targetActualClipDominance: TARGET_ACTUAL_CLIP_DOMINANCE,
      maxCardRatio: MAX_CARD_RATIO,
      durationBandId: narrationPlan.durationBandId,
      minRuntimeS: narrationPlan.targetRuntimeS?.[0] ?? null,
      maxRuntimeS: narrationPlan.targetRuntimeS?.[1] ?? null,
      calibratedWpm: narrationPlan.calibratedWpm,
    },
    metrics: {
      totalScenes,
      actualClipScenes,
      supportingMotionScenes,
      cardScenes,
      actualClipDominance,
      motionDominance,
      cardRatio,
      narrationDurationS: Number.isFinite(narrationDurationS)
        ? Number(narrationDurationS.toFixed(3))
        : null,
      scriptWordCount: Number.isFinite(wordCount) && wordCount > 0 ? wordCount : null,
      spokenWpm,
      availableClipRefs,
      maxAllowedActualClipScenesFromRefs:
        availableClipRefs > 0 ? availableClipRefs * MAX_ACTUAL_CLIP_SCENES_PER_REF : null,
      availableTrailerFrames,
    },
    narrationPlan,
    visualDirector,
  };
}

function assertFlashLaneProofReady(args = {}, opts = {}) {
  const report = buildFlashLaneProofPreflight(args);
  if (report.verdict === "allow" || opts.allowDiagnosticRender === true) return report;
  throw new Error(`Flash Lane proof preflight blocked render: ${report.blockers.join(", ")}`);
}

module.exports = {
  assertFlashLaneProofReady,
  buildFlashLaneNarrationPlan,
  buildFlashLaneProofPreflight,
  isActualClipScene,
  resolveRequiredPulseEditorialContract,
};
