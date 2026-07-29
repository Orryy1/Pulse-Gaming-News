"use strict";

const crypto = require("node:crypto");
const {
  DEFAULT_SECONDS_PER_WORD,
  countSpokenWords,
  estimateSpeechSecondsFromWords,
} = require("./short-runtime-planner");

const PULSE_BRAND = Object.freeze({
  name: "Pulse Gaming News",
  tagline: "Fast gaming news. Checked. Explained.",
});

const CONTROLLED_EXPERIMENT = Object.freeze({
  id: "pulse-v1-controlled-12",
  matrix_version: "pulse-controlled-12-v1",
});

const EDITORIAL_LANES = Object.freeze({
  what_changes_for_players: Object.freeze({
    id: "what_changes_for_players",
    label: "What Changes for Players",
    viewer_promise: "The practical consequence in under 40 seconds",
    format_family: "short",
    hook_instructions: Object.freeze({
      direct: "State the consequence immediately",
      open_loop: "Reveal the affected player first, then the change",
    }),
  }),
  trailer_truth_check: Object.freeze({
    id: "trailer_truth_check",
    label: "Trailer Truth Check",
    viewer_promise: "What the footage really proves",
    format_family: "short",
    hook_instructions: Object.freeze({
      direct: "State what the footage proves",
      open_loop: "Challenge the headline, then show proof",
    }),
  }),
  platform_pulse: Object.freeze({
    id: "platform_pulse",
    label: "Platform Pulse",
    viewer_promise: "Who wins, who loses and why it matters",
    format_family: "short",
    hook_instructions: Object.freeze({
      direct: "Name winner and loser immediately",
      open_loop: "Present the corporate contradiction first",
    }),
  }),
});

const RECAP_LANE = Object.freeze({
  id: "weekly_occasional_recap",
  label: "Weekly / occasional recap",
  viewer_promise: "A later long-form pilot based on a proven Short topic",
  format_family: "recap",
  pilot_status: "later_pilot",
  hook_instructions: Object.freeze({
    direct: "State the briefing consequence first",
    open_loop: "Open with the connecting thread, then resolve it",
  }),
});

const HOOK_TYPES = Object.freeze({
  direct: Object.freeze({
    id: "direct",
    label: "Direct hook",
  }),
  open_loop: Object.freeze({
    id: "open_loop",
    label: "Open-loop hook",
  }),
});

const RECAP_FORMATS = new Set([
  "weekly_roundup_item",
  "monthly_release_radar_item",
  "pulse_briefing_longform",
  "longform",
]);

const DURATION_BANDS = Object.freeze({
  what_changes_short_25_32: Object.freeze({
    id: "what_changes_short_25_32",
    lane_id: "what_changes_for_players",
    variant: "short",
    label: "What Changes short runtime: 25–32 seconds",
    format_family: "short",
    min_seconds: 25,
    max_seconds: 32,
  }),
  what_changes_standard_35_42: Object.freeze({
    id: "what_changes_standard_35_42",
    lane_id: "what_changes_for_players",
    variant: "standard",
    label: "What Changes standard runtime: 35–42 seconds",
    format_family: "short",
    min_seconds: 35,
    max_seconds: 42,
  }),
  what_changes_breaking_high_cadence_35_42: Object.freeze({
    id: "what_changes_breaking_high_cadence_35_42",
    lane_id: "what_changes_for_players",
    variant: "breaking_high_cadence",
    label:
      "What Changes governed breaking-news high-cadence runtime: 35?42 seconds",
    format_family: "short",
    min_seconds: 35,
    max_seconds: 42,
    seconds_per_word: 0.35,
    delivery_profile_id: "breaking_news_high_cadence_v1",
    experiment_eligible: false,
    target_duration_review_required: true,
  }),
  trailer_truth_short_28_35: Object.freeze({
    id: "trailer_truth_short_28_35",
    lane_id: "trailer_truth_check",
    variant: "short",
    label: "Trailer Truth short runtime: 28–35 seconds",
    format_family: "short",
    min_seconds: 28,
    max_seconds: 35,
  }),
  trailer_truth_standard_38_48: Object.freeze({
    id: "trailer_truth_standard_38_48",
    lane_id: "trailer_truth_check",
    variant: "standard",
    label: "Trailer Truth standard runtime: 38–48 seconds",
    format_family: "short",
    min_seconds: 38,
    max_seconds: 48,
  }),
  platform_pulse_short_30_36: Object.freeze({
    id: "platform_pulse_short_30_36",
    lane_id: "platform_pulse",
    variant: "short",
    label: "Platform Pulse short runtime: 30–36 seconds",
    format_family: "short",
    min_seconds: 30,
    max_seconds: 36,
  }),
  platform_pulse_standard_42_50: Object.freeze({
    id: "platform_pulse_standard_42_50",
    lane_id: "platform_pulse",
    variant: "standard",
    label: "Platform Pulse standard runtime: 42–50 seconds",
    format_family: "short",
    min_seconds: 42,
    max_seconds: 50,
  }),
  governed_explainer_240_480: Object.freeze({
    id: "governed_explainer_240_480",
    lane_id: RECAP_LANE.id,
    variant: "later_pilot",
    label: "Governed explainer: 4–8 minutes",
    format_family: "recap",
    min_seconds: 240,
    max_seconds: 480,
  }),
});

const SHORT_DURATION_BANDS_BY_LANE = Object.freeze({
  what_changes_for_players: Object.freeze([
    "what_changes_short_25_32",
    "what_changes_standard_35_42",
  ]),
  trailer_truth_check: Object.freeze([
    "trailer_truth_short_28_35",
    "trailer_truth_standard_38_48",
  ]),
  platform_pulse: Object.freeze([
    "platform_pulse_short_30_36",
    "platform_pulse_standard_42_50",
  ]),
});

const CTA_POLICY = Object.freeze({
  version: "pulse-selective-cta-v2",
  short_cohort_numerator: 1,
  short_cohort_denominator: 3,
  short_eligible_buckets: Object.freeze([0]),
  copy_strategy: "story_specific_contextual",
  banned_generic_comments_pattern: "let me know in the comments",
  banned_generic_follow_pattern: "generic follow or subscribe request",
});

function text(value) {
  return String(value || "").trim();
}

function listEditorialLanes() {
  return Object.values(EDITORIAL_LANES);
}

function listDurationBands() {
  return Object.values(DURATION_BANDS);
}

function listHookTypes() {
  return Object.values(HOOK_TYPES);
}

function getEditorialLane(laneId) {
  const normalisedId = text(laneId);
  if (normalisedId === RECAP_LANE.id) return RECAP_LANE;
  const lane = EDITORIAL_LANES[normalisedId];
  if (!lane) {
    throw new Error(
      `unknown_pulse_editorial_lane:${normalisedId || "missing"}`,
    );
  }
  return lane;
}

function resolveEditorialLane(story = {}) {
  const explicitId = text(story.editorial_lane_id || story.content_lane_id);
  if (explicitId) return getEditorialLane(explicitId);

  const format = text(
    story.format_route ||
      story.format_verdict ||
      story.suggested_format ||
      story.recommended_format,
  );
  if (
    RECAP_FORMATS.has(format) ||
    /\b(weekly|recap|roundup|round-up)\b/i.test(format)
  ) {
    return RECAP_LANE;
  }

  const corpus = [
    story.title,
    story.hook,
    story.classification,
    story.flair,
    story.content_pillar,
  ]
    .map(text)
    .join(" ");
  if (
    /\b(trailer|gameplay|footage|graphics?|visuals?|demo|remake|remaster)\b/i.test(
      corpus,
    )
  ) {
    return EDITORIAL_LANES.trailer_truth_check;
  }
  if (
    /\b(xbox|playstation|sony|nintendo|switch|steam|pc|platform|console|exclusive|acquisition|strategy)\b/i.test(
      corpus,
    )
  ) {
    return EDITORIAL_LANES.platform_pulse;
  }
  return EDITORIAL_LANES.what_changes_for_players;
}

function getDurationBand(durationBandId) {
  const normalisedId = text(durationBandId);
  const durationBand = DURATION_BANDS[normalisedId];
  if (!durationBand) {
    throw new Error(`unknown_pulse_duration_band:${normalisedId || "missing"}`);
  }
  return durationBand;
}

function stableCohort(namespace, identity, cohortCount) {
  const digest = crypto
    .createHash("sha256")
    .update(`${namespace}:${text(identity)}`)
    .digest();
  return {
    bucket: digest.readUInt32BE(0) % cohortCount,
    audit_hash: `sha256:${digest.toString("hex")}`,
  };
}

function getHookType(hookTypeId) {
  const normalisedId = text(hookTypeId);
  const hookType = HOOK_TYPES[normalisedId];
  if (!hookType) {
    throw new Error(`unknown_pulse_hook_type:${normalisedId || "missing"}`);
  }
  return hookType;
}

function resolveHookType({ story = {}, lane } = {}) {
  const editorialLane = lane || resolveEditorialLane(story);
  const explicitId = text(story.hook_type || story.hook_variant);
  if (explicitId) {
    return {
      hookType: getHookType(explicitId),
      instruction: editorialLane.hook_instructions[explicitId],
      selection: {
        basis: "explicit_story_contract",
        cohort_count: 2,
        bucket: explicitId === "direct" ? 0 : 1,
        audit_hash: null,
      },
    };
  }
  if (editorialLane.format_family === "recap") {
    return {
      hookType: HOOK_TYPES.direct,
      instruction: editorialLane.hook_instructions.direct,
      selection: {
        basis: "governed_later_recap_pilot",
        cohort_count: 1,
        bucket: 0,
        audit_hash: null,
      },
    };
  }
  const storyId = text(story.id);
  if (!storyId) {
    return {
      hookType: HOOK_TYPES.direct,
      instruction: editorialLane.hook_instructions.direct,
      selection: {
        basis: "missing_identity_fail_closed_direct",
        cohort_count: 2,
        bucket: 0,
        audit_hash: null,
      },
    };
  }
  const cohort = stableCohort(
    `pulse-controlled-12-hook-v1:${editorialLane.id}`,
    storyId,
    2,
  );
  const hookType =
    cohort.bucket === 0 ? HOOK_TYPES.direct : HOOK_TYPES.open_loop;
  return {
    hookType,
    instruction: editorialLane.hook_instructions[hookType.id],
    selection: {
      basis: "deterministic_controlled_experiment",
      cohort_count: 2,
      bucket: cohort.bucket,
      audit_hash: cohort.audit_hash,
    },
  };
}

function assertBandMatchesLane(durationBand, editorialLane) {
  if (
    editorialLane.format_family === "recap" &&
    durationBand.format_family !== "recap"
  ) {
    throw new Error("recap_lane_requires_governed_recap_band");
  }
  if (
    editorialLane.format_family === "short" &&
    (durationBand.format_family !== "short" ||
      durationBand.lane_id !== editorialLane.id)
  ) {
    throw new Error("duration_band_not_allowed_for_editorial_lane");
  }
}

function resolveDurationBand({ story = {}, lane } = {}) {
  const editorialLane = lane || resolveEditorialLane(story);
  const explicitBandId = text(story.duration_band_id);
  if (explicitBandId) {
    const explicitBand = getDurationBand(explicitBandId);
    assertBandMatchesLane(explicitBand, editorialLane);
    const controlledBandIds =
      SHORT_DURATION_BANDS_BY_LANE[editorialLane.id] || [];
    const controlledBandIndex = controlledBandIds.indexOf(
      explicitBand.id,
    );
    const governedBreakingNewsContract =
      explicitBand.experiment_eligible === false;
    return {
      durationBand: explicitBand,
      selection: {
        basis: governedBreakingNewsContract
          ? "explicit_governed_breaking_news_contract"
          : "explicit_story_contract",
        cohort_count:
          explicitBand.format_family === "short" &&
          !governedBreakingNewsContract
            ? controlledBandIds.length
            : 1,
        bucket:
          explicitBand.format_family === "short" &&
          !governedBreakingNewsContract
            ? controlledBandIndex
            : 0,
        audit_hash: null,
      },
    };
  }
  if (editorialLane.format_family === "recap") {
    return {
      durationBand: DURATION_BANDS.governed_explainer_240_480,
      selection: {
        basis: "governed_later_recap_pilot",
        cohort_count: 1,
        bucket: 0,
        audit_hash: null,
      },
    };
  }

  const laneBands = SHORT_DURATION_BANDS_BY_LANE[editorialLane.id];
  const explicitVariant = text(story.duration_variant).toLowerCase();
  if (explicitVariant) {
    const variantIndex =
      explicitVariant === "short" ? 0 : explicitVariant === "standard" ? 1 : -1;
    if (variantIndex < 0) {
      throw new Error(`unknown_pulse_duration_variant:${explicitVariant}`);
    }
    return {
      durationBand: DURATION_BANDS[laneBands[variantIndex]],
      selection: {
        basis: "explicit_duration_variant",
        cohort_count: 2,
        bucket: variantIndex,
        audit_hash: null,
      },
    };
  }

  const storyId = text(story.id);
  if (!storyId) {
    return {
      durationBand: DURATION_BANDS[laneBands[0]],
      selection: {
        basis: "missing_identity_fail_closed_short_variant",
        cohort_count: 2,
        bucket: 0,
        audit_hash: null,
      },
    };
  }
  const cohort = stableCohort(
    `pulse-controlled-12-duration-v1:${editorialLane.id}`,
    storyId,
    laneBands.length,
  );
  return {
    durationBand: DURATION_BANDS[laneBands[cohort.bucket]],
    selection: {
      basis: "deterministic_controlled_experiment",
      cohort_count: laneBands.length,
      bucket: cohort.bucket,
      audit_hash: cohort.audit_hash,
    },
  };
}

function resolvePulseScriptContract({
  story = {},
  laneId = null,
  durationBandId = null,
  secondsPerWord = DEFAULT_SECONDS_PER_WORD,
} = {}) {
  const normalisedSecondsPerWord = Number(secondsPerWord);
  if (
    !Number.isFinite(normalisedSecondsPerWord) ||
    normalisedSecondsPerWord <= 0
  ) {
    throw new Error("valid_pulse_seconds_per_word_required");
  }
  const lane = laneId ? getEditorialLane(laneId) : resolveEditorialLane(story);
  const inputStory = durationBandId
    ? { ...story, duration_band_id: durationBandId }
    : story;
  const { durationBand, selection } = resolveDurationBand({
    story: inputStory,
    lane,
  });
  const {
    hookType,
    instruction: hookInstruction,
    selection: hookSelection,
  } = resolveHookType({
    story: inputStory,
    lane,
  });
  const contractSecondsPerWord = Number(
    durationBand.seconds_per_word ?? normalisedSecondsPerWord,
  );
  const experimentEligible =
    lane.format_family === "short" &&
    durationBand.experiment_eligible !== false;
  const rawTargetDuration = inputStory.target_duration_seconds;
  const hasTargetDuration =
    rawTargetDuration !== null &&
    rawTargetDuration !== undefined &&
    rawTargetDuration !== "";
  const targetDurationSeconds = hasTargetDuration
    ? Number(rawTargetDuration)
    : null;
  if (
    durationBand.target_duration_review_required === true &&
    !Number.isFinite(targetDurationSeconds)
  ) {
    throw new Error(
      "operator_reviewed_target_duration_seconds_required",
    );
  }
  if (
    targetDurationSeconds !== null &&
    (!Number.isFinite(targetDurationSeconds) ||
      targetDurationSeconds < durationBand.min_seconds ||
      targetDurationSeconds > durationBand.max_seconds)
  ) {
    throw new Error("target_duration_seconds_out_of_selected_band");
  }
  return {
    contract_version: "pulse-editorial-contract-v2",
    experiment_id: experimentEligible
      ? CONTROLLED_EXPERIMENT.id
      : null,
    experiment_matrix_version:
      experimentEligible
        ? CONTROLLED_EXPERIMENT.matrix_version
        : null,
    brand: PULSE_BRAND,
    editorial_lane_id: lane.id,
    editorial_lane_label: lane.label,
    viewer_promise: lane.viewer_promise,
    pilot_status: lane.pilot_status || null,
    format_family: lane.format_family,
    hook_type: hookType.id,
    hook_type_label: hookType.label,
    hook_instruction: hookInstruction,
    hook_selection: hookSelection,
    duration_band_id: durationBand.id,
    duration_variant: durationBand.variant,
    duration_band_label: durationBand.label,
    min_seconds: durationBand.min_seconds,
    max_seconds: durationBand.max_seconds,
    target_duration_seconds: targetDurationSeconds,
    target_duration_review_required:
      durationBand.target_duration_review_required === true,
    delivery_profile_id:
      durationBand.delivery_profile_id || null,
    seconds_per_word: contractSecondsPerWord,
    min_words: Math.ceil(
      durationBand.min_seconds / contractSecondsPerWord,
    ),
    max_words: Math.floor(
      durationBand.max_seconds / contractSecondsPerWord,
    ),
    experiment_cell_id: experimentEligible
        ? `${lane.id}:${hookType.id}:${durationBand.variant}`
        : null,
    duration_selection: selection,
  };
}

function validatePulseHook({ script = {}, contract } = {}) {
  if (!contract?.hook_type) {
    throw new Error("pulse_hook_contract_required");
  }
  const failures = [];
  const declaredLane = text(script.editorial_lane_id);
  if (!declaredLane) {
    failures.push("editorial_lane_missing");
  } else if (declaredLane !== contract.editorial_lane_id) {
    failures.push("editorial_lane_contract_mismatch");
  }
  const declaredHookType = text(script.hook_type);
  if (!declaredHookType) {
    failures.push("hook_type_missing");
  } else if (declaredHookType !== contract.hook_type) {
    failures.push("hook_type_contract_mismatch");
  }
  if (!text(script.hook)) {
    failures.push("hook_missing");
  }
  const declaredDurationBand = text(script.duration_band_id);
  if (!declaredDurationBand) {
    failures.push("duration_band_missing");
  } else if (declaredDurationBand !== contract.duration_band_id) {
    failures.push("duration_band_contract_mismatch");
  }
  return {
    result: failures.length ? "fail" : "pass",
    failures,
    warnings: [],
    hook_type: declaredHookType || null,
    expected_hook_type: contract.hook_type,
    editorial_lane_id: declaredLane || null,
    expected_editorial_lane_id: contract.editorial_lane_id,
    duration_band_id: declaredDurationBand || null,
    expected_duration_band_id: contract.duration_band_id,
    hook_instruction: contract.hook_instruction,
    experiment_cell_id: contract.experiment_cell_id,
  };
}

function validatePulseScriptRuntime({
  text: scriptText,
  wordCount,
  contract,
} = {}) {
  if (!contract?.duration_band_id) {
    throw new Error("pulse_script_contract_required");
  }
  const words =
    Number.isFinite(Number(wordCount)) && Number(wordCount) >= 0
      ? Number(wordCount)
      : countSpokenWords(scriptText);
  const estimatedSeconds = estimateSpeechSecondsFromWords(
    words,
    contract.seconds_per_word,
  );
  const failures = [];
  if (!estimatedSeconds) {
    failures.push("script_runtime_unknown");
  } else if (words < contract.min_words) {
    failures.push("script_runtime_below_selected_band");
  } else if (words > contract.max_words) {
    failures.push("script_runtime_above_selected_band");
  }
  return {
    result: failures.length ? "fail" : "pass",
    failures,
    warnings: [],
    word_count: words,
    estimated_seconds: estimatedSeconds,
    min_words: contract.min_words,
    max_words: contract.max_words,
    min_seconds: contract.min_seconds,
    max_seconds: contract.max_seconds,
    duration_band_id: contract.duration_band_id,
  };
}

function selectCtaDecision({ storyId, formatFamily = "short" } = {}) {
  const normalisedFamily = text(formatFamily).toLowerCase() || "short";
  if (normalisedFamily !== "short") {
    return {
      policy_version: CTA_POLICY.version,
      scope: "recap",
      include_cta: false,
      copy_strategy: "human_review_later_pilot",
      cohort_bucket: null,
      cohort_numerator: null,
      cohort_denominator: null,
      audit_hash: null,
      reason: "later_recap_pilot_has_no_automatic_cta",
    };
  }
  const normalisedStoryId = text(storyId);
  if (!normalisedStoryId) {
    return {
      policy_version: CTA_POLICY.version,
      scope: "shorts",
      include_cta: false,
      copy_strategy: "none",
      cohort_bucket: null,
      cohort_numerator: CTA_POLICY.short_cohort_numerator,
      cohort_denominator: CTA_POLICY.short_cohort_denominator,
      audit_hash: null,
      reason: "story_identity_missing_fail_closed",
    };
  }
  const cohort = stableCohort(
    CTA_POLICY.version,
    normalisedStoryId,
    CTA_POLICY.short_cohort_denominator,
  );
  const includeCta = CTA_POLICY.short_eligible_buckets.includes(cohort.bucket);
  return {
    policy_version: CTA_POLICY.version,
    scope: "shorts",
    include_cta: includeCta,
    copy_strategy: includeCta ? CTA_POLICY.copy_strategy : "none",
    cohort_bucket: cohort.bucket,
    cohort_numerator: CTA_POLICY.short_cohort_numerator,
    cohort_denominator: CTA_POLICY.short_cohort_denominator,
    audit_hash: cohort.audit_hash,
    reason: includeCta
      ? "deterministic_one_in_three_contextual_cta_cohort"
      : "deterministic_cta_omission_cohort",
  };
}

function normaliseCtaCopy(value) {
  return text(value).replace(/\s+/g, " ").toLowerCase();
}

function isGovernedCtaSelected(decision) {
  return Boolean(
    decision?.policy_version === CTA_POLICY.version &&
    decision?.scope === "shorts" &&
    decision?.include_cta === true &&
    decision?.copy_strategy === CTA_POLICY.copy_strategy &&
    decision?.cohort_numerator === CTA_POLICY.short_cohort_numerator &&
    decision?.cohort_denominator === CTA_POLICY.short_cohort_denominator &&
    CTA_POLICY.short_eligible_buckets.includes(decision?.cohort_bucket) &&
    /^sha256:[a-f0-9]{64}$/i.test(text(decision?.audit_hash)),
  );
}

function validatePulseCta({ script = {}, decision } = {}) {
  if (!decision?.policy_version) {
    throw new Error("pulse_cta_decision_required");
  }
  const failures = [];
  const cta = text(script.cta);
  const fullScript = text(script.full_script);
  const combined = `${cta}\n${fullScript}`;
  if (
    /\b(?:let (?:me|us) know|tell us|share your thoughts|what do you think|comment(?: below)?|drop .{0,30} in (?:the )?comments)\b/i.test(
      combined,
    )
  ) {
    failures.push("banned_generic_comments_cta");
  }
  if (
    /\b(?:follow|subscribe)\b.{0,80}\b(?:pulse gaming(?: news)?|channel|more|updates?|gaming news)\b/i.test(
      combined,
    ) ||
    /\b(?:smash|hit)\b.{0,30}\b(?:like|subscribe)\b/i.test(combined)
  ) {
    failures.push("banned_generic_follow_cta");
  }
  if (
    /\b(?:like (?:this|the) (?:video|short)|hit (?:the )?like|smash (?:the )?like)\b/i.test(
      combined,
    )
  ) {
    failures.push("banned_generic_like_cta");
  }
  const ctaDetected = Boolean(cta);
  if (decision.include_cta === true && !isGovernedCtaSelected(decision)) {
    failures.push("cta_decision_not_auditable");
  }
  if (cta && countSpokenWords(cta) > 24) {
    failures.push("contextual_cta_too_long");
  }
  if (
    decision.scope === "shorts" &&
    decision.include_cta !== true &&
    ctaDetected
  ) {
    failures.push("cta_not_selected_for_short");
  }
  if (isGovernedCtaSelected(decision) && !ctaDetected) {
    failures.push("selected_cta_missing");
  }
  if (
    isGovernedCtaSelected(decision) &&
    ctaDetected &&
    !normaliseCtaCopy(fullScript).includes(normaliseCtaCopy(cta))
  ) {
    failures.push("selected_cta_missing_from_full_script");
  }
  return {
    result: failures.length ? "fail" : "pass",
    failures: [...new Set(failures)],
    warnings: [],
    cta_detected: ctaDetected,
    include_cta: decision.include_cta === true,
    policy_version: decision.policy_version,
    audit_hash: decision.audit_hash || null,
  };
}

function resolveGovernedCtaCopy(story = {}) {
  const decision = story.cta_policy;
  if (!isGovernedCtaSelected(decision)) return "";
  const validation = validatePulseCta({ script: story, decision });
  return validation.result === "pass" ? text(story.cta) : "";
}

function buildPulseGenerationPrompt({ contract, ctaDecision } = {}) {
  if (!contract?.duration_band_id) {
    throw new Error("pulse_script_contract_required");
  }
  if (!ctaDecision?.policy_version) {
    throw new Error("pulse_cta_decision_required");
  }
  const ctaInstruction = ctaDecision.include_cta
    ? 'INCLUDE one concise, story-specific CTA as the final sentence. Use a genuine choice, a direct question tied to the verified facts or a real next-instalment tease. Put the same unique sentence in the "cta" field. Never ask generically for follows, subscriptions, likes or comments.'
    : 'OMIT an explicit audience CTA. Return an empty string in the "cta" field and finish with a final consequence or concise verdict.';
  const wordSpan = Math.max(0, contract.max_words - contract.min_words);
  const draftMinimum =
    wordSpan >= 4 ? contract.min_words + 2 : contract.min_words;
  const draftMaximum =
    wordSpan >= 8 ? contract.max_words - 4 : contract.max_words;
  return [
    "PULSE GAMING NEWS EDITORIAL CONTRACT",
    `Brand: ${PULSE_BRAND.name}`,
    `Tagline: ${PULSE_BRAND.tagline}`,
    ...(contract.experiment_id
      ? [
          `Experiment: ${contract.experiment_id} (${contract.experiment_matrix_version})`,
          `Experiment cell: ${contract.experiment_cell_id}`,
        ]
      : []),
    `Editorial lane: ${contract.editorial_lane_id} (${contract.editorial_lane_label})`,
    `Viewer promise: ${contract.viewer_promise}`,
    `Hook type: ${contract.hook_type} (${contract.hook_type_label})`,
    `Hook instruction: ${contract.hook_instruction}.`,
    `Duration band: ${contract.duration_band_id} (${contract.min_seconds}-${contract.max_seconds} seconds)`,
    `Duration variant: ${contract.duration_variant}`,
    `Script budget: ${contract.min_words}-${contract.max_words} cleaned spoken words, derived at ${contract.seconds_per_word} seconds per word.`,
    `Preferred drafting target: ${draftMinimum}-${draftMaximum} cleaned spoken words. This safety margin sits inside the hard script budget and prevents a locally counted draft from crossing the maximum after cleaning.`,
    `CTA policy: ${ctaDecision.policy_version}. ${ctaInstruction}`,
    "Write in British English with no serial comma.",
    "Never use a generic viewer-comment request.",
    'Return the selected lane as "editorial_lane_id", selected hook as "hook_type" and selected band as "duration_band_id".',
  ].join("\n");
}

module.exports = {
  CONTROLLED_EXPERIMENT,
  CTA_POLICY,
  DURATION_BANDS,
  EDITORIAL_LANES,
  HOOK_TYPES,
  PULSE_BRAND,
  RECAP_LANE,
  SHORT_DURATION_BANDS_BY_LANE,
  buildPulseGenerationPrompt,
  getDurationBand,
  getEditorialLane,
  getHookType,
  isGovernedCtaSelected,
  listDurationBands,
  listEditorialLanes,
  listHookTypes,
  resolveDurationBand,
  resolveEditorialLane,
  resolveGovernedCtaCopy,
  resolveHookType,
  resolvePulseScriptContract,
  selectCtaDecision,
  validatePulseCta,
  validatePulseHook,
  validatePulseScriptRuntime,
};
