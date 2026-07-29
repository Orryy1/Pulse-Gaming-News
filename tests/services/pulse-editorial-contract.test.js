"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const channel = require("../../channels/pulse-gaming");
const {
  CONTROLLED_EXPERIMENT,
  CTA_POLICY,
  HOOK_TYPES,
  PULSE_BRAND,
  buildPulseGenerationPrompt,
  isGovernedCtaSelected,
  listEditorialLanes,
  listDurationBands,
  listHookTypes,
  resolveEditorialLane,
  resolveGovernedCtaCopy,
  resolveHookType,
  resolvePulseScriptContract,
  selectCtaDecision,
  validatePulseCta,
  validatePulseHook,
  validatePulseScriptRuntime,
} = require("../../lib/services/pulse-editorial-contract");
const {
  EXPERIMENT_MATRIX,
  MATRIX_VERSION,
} = require("../../lib/repositories/controlled_video_experiments");

const MATRIX = [
  {
    lane: "what_changes_for_players",
    label: "What Changes for Players",
    short: ["what_changes_short_25_32", 25, 32],
    standard: ["what_changes_standard_35_42", 35, 42],
  },
  {
    lane: "trailer_truth_check",
    label: "Trailer Truth Check",
    short: ["trailer_truth_short_28_35", 28, 35],
    standard: ["trailer_truth_standard_38_48", 38, 48],
  },
  {
    lane: "platform_pulse",
    label: "Platform Pulse",
    short: ["platform_pulse_short_30_36", 30, 36],
    standard: ["platform_pulse_standard_42_50", 42, 50],
  },
];
const AUDIT_HASH = `sha256:${"a".repeat(64)}`;

test("Pulse Gaming News identity and three outward editorial lanes are canonical", () => {
  assert.deepEqual(PULSE_BRAND, {
    name: "Pulse Gaming News",
    tagline: "Fast gaming news. Checked. Explained.",
  });
  assert.equal(channel.name, PULSE_BRAND.name);
  assert.equal(channel.tagline, PULSE_BRAND.tagline);
  assert.deepEqual(
    listEditorialLanes().map(({ id, label }) => ({ id, label })),
    MATRIX.map(({ lane, label }) => ({ id: lane, label })),
  );
});

test("controlled experiment exposes exactly direct and open-loop hook types", () => {
  assert.deepEqual(
    listHookTypes().map(({ id, label }) => ({ id, label })),
    [
      { id: "direct", label: "Direct hook" },
      { id: "open_loop", label: "Open-loop hook" },
    ],
  );
  assert.equal(HOOK_TYPES.direct.id, "direct");
  assert.equal(HOOK_TYPES.open_loop.id, "open_loop");
});

test("editorial and analytics layers share one exact 12-cell experiment identity", () => {
  assert.equal(CONTROLLED_EXPERIMENT.id, "pulse-v1-controlled-12");
  assert.equal(CONTROLLED_EXPERIMENT.matrix_version, MATRIX_VERSION);
  assert.equal(EXPERIMENT_MATRIX.length, 12);
  for (const cell of EXPERIMENT_MATRIX) {
    const contract = resolvePulseScriptContract({
      story: {
        editorial_lane_id: cell.editorialLane,
        hook_type: cell.hookType,
        duration_variant: cell.durationBand,
      },
    });
    assert.equal(contract.experiment_id, CONTROLLED_EXPERIMENT.id);
    assert.equal(contract.experiment_matrix_version, MATRIX_VERSION);
    assert.equal(contract.experiment_cell_id, cell.cellKey);
    assert.equal(contract.min_seconds, cell.runtimeMinSeconds);
    assert.equal(contract.max_seconds, cell.runtimeMaxSeconds);
  }
});

test("editorial lane resolution is explicit, topical and fail-closed", () => {
  assert.equal(
    resolveEditorialLane({
      editorial_lane_id: "trailer_truth_check",
      title: "Xbox changes pricing",
    }).id,
    "trailer_truth_check",
  );
  assert.equal(
    resolveEditorialLane({
      title: "New gameplay trailer shows the remake in motion",
    }).id,
    "trailer_truth_check",
  );
  assert.equal(
    resolveEditorialLane({
      title: "Xbox and PlayStation change their platform strategy",
    }).id,
    "platform_pulse",
  );
  assert.equal(
    resolveEditorialLane({
      title: "A release date change affects existing owners",
    }).id,
    "what_changes_for_players",
  );
  assert.equal(
    resolveEditorialLane({ suggested_format: "weekly_roundup_item" }).id,
    "weekly_occasional_recap",
  );
  assert.throws(
    () => resolveEditorialLane({ editorial_lane_id: "made_up_lane" }),
    /unknown_pulse_editorial_lane/,
  );
});

test("controlled 12-video matrix has exact lane-specific Short runtime bands", () => {
  const bands = listDurationBands();
  for (const row of MATRIX) {
    for (const variant of ["short", "standard"]) {
      const [id, minSeconds, maxSeconds] = row[variant];
      const band = bands.find((candidate) => candidate.id === id);
      assert.ok(band, `missing ${id}`);
      assert.equal(band.lane_id, row.lane);
      assert.equal(band.variant, variant);
      assert.equal(band.min_seconds, minSeconds);
      assert.equal(band.max_seconds, maxSeconds);

      const contract = resolvePulseScriptContract({
        story: {
          id: `${row.lane}-${variant}`,
          editorial_lane_id: row.lane,
          duration_band_id: id,
        },
      });
      assert.equal(contract.experiment_id, "pulse-v1-controlled-12");
      assert.equal(
        contract.experiment_matrix_version,
        "pulse-controlled-12-v1",
      );
      assert.equal(
        contract.min_words,
        Math.ceil(minSeconds / contract.seconds_per_word),
      );
      assert.equal(
        contract.max_words,
        Math.floor(maxSeconds / contract.seconds_per_word),
      );
    }
  }
  assert.equal(
    bands.filter(
      (band) =>
        band.format_family === "short" &&
        band.experiment_eligible !== false,
    ).length,
    6,
  );
  assert.equal(
    bands.some((band) => /61_75|35_50/.test(band.id)),
    false,
  );
});

test("explicit breaking-news high-cadence contract accepts the 106-word YAZD spoken script without entering the controlled experiment", () => {
  const contract = resolvePulseScriptContract({
    story: {
      id: "official_3b8d305c4e17",
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id:
        "what_changes_breaking_high_cadence_35_42",
      target_duration_seconds: 36.48,
    },
  });

  assert.equal(
    contract.duration_band_id,
    "what_changes_breaking_high_cadence_35_42",
  );
  assert.equal(contract.duration_variant, "breaking_high_cadence");
  assert.equal(contract.min_seconds, 35);
  assert.equal(contract.max_seconds, 42);
  assert.equal(contract.target_duration_seconds, 36.48);
  assert.equal(
    contract.delivery_profile_id,
    "breaking_news_high_cadence_v1",
  );
  assert.equal(contract.seconds_per_word, 0.35);
  assert.equal(contract.min_words, 100);
  assert.equal(contract.max_words, 120);
  assert.equal(contract.experiment_id, null);
  assert.equal(contract.experiment_matrix_version, null);
  assert.equal(contract.experiment_cell_id, null);
  assert.equal(
    contract.duration_selection.basis,
    "explicit_governed_breaking_news_contract",
  );
  assert.deepEqual(
    validatePulseScriptRuntime({
      wordCount: 106,
      contract,
    }).failures,
    [],
  );
});

test("duration selection is stable within a lane and selected-band validation is strict", () => {
  const input = {
    story: {
      id: "stable-platform-story",
      editorial_lane_id: "platform_pulse",
    },
  };
  const first = resolvePulseScriptContract(input);
  const second = resolvePulseScriptContract(input);
  assert.equal(first.duration_band_id, second.duration_band_id);
  assert.ok(
    ["platform_pulse_short_30_36", "platform_pulse_standard_42_50"].includes(
      first.duration_band_id,
    ),
  );
  assert.equal(
    first.duration_selection.basis,
    "deterministic_controlled_experiment",
  );
  assert.match(first.duration_selection.audit_hash, /^sha256:/);
  assert.deepEqual(
    validatePulseScriptRuntime({
      wordCount: first.min_words,
      contract: first,
    }).failures,
    [],
  );
  assert.ok(
    validatePulseScriptRuntime({
      wordCount: first.max_words + 1,
      contract: first,
    }).failures.includes("script_runtime_above_selected_band"),
  );
});

test("hook selection is explicit or deterministic and binds an experiment cell", () => {
  const explicit = resolvePulseScriptContract({
    story: {
      id: "explicit-hook",
      editorial_lane_id: "platform_pulse",
      hook_type: "open_loop",
      duration_band_id: "platform_pulse_standard_42_50",
    },
  });
  assert.equal(explicit.hook_type, "open_loop");
  assert.equal(
    explicit.hook_instruction,
    "Present the corporate contradiction first",
  );
  assert.equal(
    explicit.experiment_cell_id,
    "platform_pulse:open_loop:standard",
  );
  assert.equal(explicit.hook_selection.basis, "explicit_story_contract");

  const story = {
    id: "stable-hook-story",
    editorial_lane_id: "trailer_truth_check",
  };
  const first = resolveHookType({ story });
  const second = resolveHookType({ story });
  assert.deepEqual(first, second);
  assert.ok(["direct", "open_loop"].includes(first.hookType.id));
  assert.match(first.selection.audit_hash, /^sha256:/);
  assert.throws(
    () =>
      resolvePulseScriptContract({ story: { ...story, hook_type: "vague" } }),
    /unknown_pulse_hook_type/,
  );
});

test("hook validation rejects missing or mismatched model declarations", () => {
  const contract = resolvePulseScriptContract({
    story: {
      id: "hook-validation",
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_variant: "short",
    },
  });
  assert.deepEqual(
    validatePulseHook({
      script: {
        editorial_lane_id: "what_changes_for_players",
        hook_type: "direct",
        duration_band_id: "what_changes_short_25_32",
        hook: "Existing owners lose access next month.",
      },
      contract,
    }).failures,
    [],
  );
  assert.ok(
    validatePulseHook({
      script: {
        editorial_lane_id: "what_changes_for_players",
        hook_type: "open_loop",
        duration_band_id: "what_changes_short_25_32",
        hook: "Existing owners lose access next month.",
      },
      contract,
    }).failures.includes("hook_type_contract_mismatch"),
  );
  assert.ok(
    validatePulseHook({
      script: {
        editorial_lane_id: "what_changes_for_players",
        duration_band_id: "what_changes_short_25_32",
        hook: "Existing owners lose access next month.",
      },
      contract,
    }).failures.includes("hook_type_missing"),
  );
  assert.ok(
    validatePulseHook({
      script: {
        editorial_lane_id: "platform_pulse",
        hook_type: "direct",
        duration_band_id: "what_changes_standard_35_42",
        hook: "Existing owners lose access next month.",
      },
      contract,
    }).failures.includes("editorial_lane_contract_mismatch"),
  );
  assert.ok(
    validatePulseHook({
      script: {
        editorial_lane_id: "what_changes_for_players",
        hook_type: "direct",
        duration_band_id: "what_changes_standard_35_42",
        hook: "Existing owners lose access next month.",
      },
      contract,
    }).failures.includes("duration_band_contract_mismatch"),
  );
});

test("lane-specific bands cannot cross lanes and recap stays a separate later pilot", () => {
  assert.throws(
    () =>
      resolvePulseScriptContract({
        story: {
          editorial_lane_id: "trailer_truth_check",
          duration_band_id: "platform_pulse_short_30_36",
        },
      }),
    /duration_band_not_allowed_for_editorial_lane/,
  );
  const recap = resolvePulseScriptContract({
    story: {
      id: "recap-1",
      editorial_lane_id: "weekly_occasional_recap",
    },
  });
  assert.equal(recap.experiment_id, null);
  assert.equal(recap.duration_band_id, "governed_explainer_240_480");
  assert.equal(recap.min_seconds, 240);
  assert.equal(recap.max_seconds, 480);
  assert.equal(recap.pilot_status, "later_pilot");
});

test("Short CTA selection is deterministic, auditable and capped at one cohort in three", () => {
  const first = selectCtaDecision({
    storyId: "stable-story-42",
    formatFamily: "short",
  });
  const second = selectCtaDecision({
    storyId: "stable-story-42",
    formatFamily: "short",
  });
  assert.deepEqual(first, second);
  assert.equal(CTA_POLICY.short_cohort_numerator, 1);
  assert.equal(CTA_POLICY.short_cohort_denominator, 3);
  assert.deepEqual(CTA_POLICY.short_eligible_buckets, [0]);
  assert.equal(first.include_cta, first.cohort_bucket === 0);
  assert.equal(
    first.copy_strategy,
    first.include_cta ? "story_specific_contextual" : "none",
  );
  assert.equal("approved_text" in first, false);
  assert.match(first.audit_hash, /^sha256:/);
});

test("CTA validation accepts unique contextual copy and rejects generic templates", () => {
  const selected = {
    policy_version: CTA_POLICY.version,
    scope: "shorts",
    include_cta: true,
    copy_strategy: CTA_POLICY.copy_strategy,
    cohort_bucket: 0,
    cohort_numerator: 1,
    cohort_denominator: 3,
    audit_hash: AUDIT_HASH,
  };
  const contextual = "Which version would you install first?";
  assert.deepEqual(
    validatePulseCta({
      script: {
        cta: contextual,
        full_script: `The PC release now has achievements. ${contextual}`,
      },
      decision: selected,
    }).failures,
    [],
  );
  assert.ok(
    validatePulseCta({
      script: {
        cta: "Follow Pulse Gaming News for more updates.",
        full_script: "Follow Pulse Gaming News for more updates.",
      },
      decision: selected,
    }).failures.includes("banned_generic_follow_cta"),
  );
  assert.ok(
    validatePulseCta({
      script: {
        cta: "Let me know in the comments.",
        full_script: "Let me know in the comments.",
      },
      decision: selected,
    }).failures.includes("banned_generic_comments_cta"),
  );
  assert.ok(
    validatePulseCta({
      script: {
        cta: "What do you think? Comment below.",
        full_script: "What do you think? Comment below.",
      },
      decision: selected,
    }).failures.includes("banned_generic_comments_cta"),
  );
  assert.ok(
    validatePulseCta({
      script: {
        cta: "Like this video for more.",
        full_script: "Like this video for more.",
      },
      decision: selected,
    }).failures.includes("banned_generic_like_cta"),
  );
  assert.ok(
    validatePulseCta({
      script: { cta: "", full_script: "The consequence is clear." },
      decision: selected,
    }).failures.includes("selected_cta_missing"),
  );
});

test("unselected CTA cohort omits CTA and renderer copy resolves fail-closed", () => {
  const omitted = {
    policy_version: CTA_POLICY.version,
    scope: "shorts",
    include_cta: false,
    copy_strategy: "none",
    audit_hash: "sha256:omitted",
  };
  const contextual = "Which version would you install first?";
  assert.ok(
    validatePulseCta({
      script: {
        cta: contextual,
        full_script: `The release is confirmed. ${contextual}`,
      },
      decision: omitted,
    }).failures.includes("cta_not_selected_for_short"),
  );
  assert.equal(
    resolveGovernedCtaCopy({
      cta: contextual,
      full_script: `The release is confirmed. ${contextual}`,
      cta_policy: omitted,
    }),
    "",
  );
  const selected = {
    ...omitted,
    include_cta: true,
    copy_strategy: CTA_POLICY.copy_strategy,
  };
  Object.assign(selected, {
    cohort_bucket: 0,
    cohort_numerator: 1,
    cohort_denominator: 3,
    audit_hash: AUDIT_HASH,
  });
  assert.equal(isGovernedCtaSelected(selected), true);
  assert.equal(
    resolveGovernedCtaCopy({
      cta: contextual,
      full_script: `The release is confirmed. ${contextual}`,
      cta_policy: selected,
    }),
    contextual,
  );
});

test("generation prompt carries matrix identity, runtime and selective dynamic CTA", () => {
  const contract = resolvePulseScriptContract({
    story: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: "what_changes_short_25_32",
    },
  });
  const selectedPrompt = buildPulseGenerationPrompt({
    contract,
    ctaDecision: {
      policy_version: CTA_POLICY.version,
      scope: "shorts",
      include_cta: true,
      copy_strategy: CTA_POLICY.copy_strategy,
    },
  });
  assert.match(selectedPrompt, /What Changes for Players/);
  assert.match(selectedPrompt, /pulse-v1-controlled-12/);
  assert.match(
    selectedPrompt,
    /what_changes_for_players:direct:short/,
  );
  assert.match(selectedPrompt, /Hook type: direct/);
  assert.match(selectedPrompt, /State the consequence immediately/);
  assert.match(selectedPrompt, /25-32 seconds/);
  assert.match(selectedPrompt, /37-47 cleaned spoken words/);
  assert.match(selectedPrompt, /story-specific CTA/);
  assert.doesNotMatch(selectedPrompt, /Follow Pulse Gaming News/);
  assert.doesNotMatch(selectedPrompt, /let me know in the comments/i);

  const omittedPrompt = buildPulseGenerationPrompt({
    contract,
    ctaDecision: {
      policy_version: CTA_POLICY.version,
      scope: "shorts",
      include_cta: false,
      copy_strategy: "none",
    },
  });
  assert.match(omittedPrompt, /OMIT an explicit audience CTA/);
});
