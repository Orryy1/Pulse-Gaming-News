"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const processor = require("../../processor");
const pulseChannel = require("../../channels/pulse-gaming");
const {
  CTA_POLICY,
  buildPulseGenerationPrompt,
  resolvePulseScriptContract,
} = require("../../lib/services/pulse-editorial-contract");
const PROCESSOR_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "processor.js"),
  "utf8",
);
const AUDIT_HASH = `sha256:${"a".repeat(64)}`;

function words(count) {
  return Array.from({ length: count }, (_, index) => `detail${index}`).join(
    " ",
  );
}

function script(wordCount, cta = "", declarations = {}) {
  const ctaWords = cta ? cta.trim().split(/\s+/).length : 0;
  const body = words(Math.max(0, wordCount - ctaWords));
  return {
    classification: "[CONFIRMED]",
    editorial_lane_id:
      declarations.editorial_lane_id || "what_changes_for_players",
    hook_type: declarations.hook_type || "direct",
    duration_band_id:
      declarations.duration_band_id || "what_changes_short_25_32",
    hook: "Nintendo quietly confirmed a hardware shift.",
    body: "Details landed from an official source.",
    cta,
    full_script: [body, cta].filter(Boolean).join(" "),
    word_count: wordCount,
    suggested_thumbnail_text: "Nintendo shift",
  };
}

function scriptForContract(wordCount, selectedContract, cta = "") {
  return script(wordCount, cta, {
    editorial_lane_id: selectedContract.editorial_lane_id,
    hook_type: selectedContract.hook_type,
    duration_band_id: selectedContract.duration_band_id,
  });
}

function contract(durationBandId, laneId) {
  return resolvePulseScriptContract({
    story: {
      id: `story-${durationBandId}`,
      editorial_lane_id: laneId,
      hook_type: "direct",
      duration_band_id: durationBandId,
    },
  });
}

function ctaDecision(includeCta) {
  return {
    policy_version: CTA_POLICY.version,
    scope: "shorts",
    include_cta: includeCta,
    copy_strategy: includeCta ? CTA_POLICY.copy_strategy : "none",
    cohort_bucket: includeCta ? 0 : 1,
    cohort_numerator: 1,
    cohort_denominator: 3,
    audit_hash: AUDIT_HASH,
  };
}

test("processor validates the selected What Changes short runtime", () => {
  const selected = contract(
    "what_changes_short_25_32",
    "what_changes_for_players",
  );
  assert.deepEqual(
    processor.validate(scriptForContract(42, selected), "pulse-gaming", {
      contract: selected,
      ctaDecision: ctaDecision(false),
    }),
    [],
  );
});

test("processor does not substitute one lane's runtime for another", () => {
  const draft = script(42);
  const short = contract(
    "what_changes_short_25_32",
    "what_changes_for_players",
  );
  const standard = contract("platform_pulse_standard_42_50", "platform_pulse");
  assert.deepEqual(
    processor.validate(draft, "pulse-gaming", {
      contract: short,
      ctaDecision: ctaDecision(false),
    }),
    [],
  );
  assert.ok(
    processor
      .validate(draft, "pulse-gaming", {
        contract: standard,
        ctaDecision: ctaDecision(false),
      })
      .some((error) => error.includes("script_runtime_below_selected_band")),
  );
});

test("processor validates the isolated governed recap runtime", () => {
  const recap = contract(
    "governed_explainer_240_480",
    "weekly_occasional_recap",
  );
  assert.deepEqual(
    processor.validate(
      scriptForContract(recap.min_words, recap),
      "pulse-gaming",
      {
      contract: recap,
      ctaDecision: {
        policy_version: CTA_POLICY.version,
        scope: "recap",
        include_cta: false,
        copy_strategy: "human_review_later_pilot",
        },
      },
    ),
    [],
  );
});

test("processor accepts a selected contextual CTA and rejects generic follow copy", () => {
  const selected = contract(
    "trailer_truth_standard_38_48",
    "trailer_truth_check",
  );
  const contextual = "Which version would you play first?";
  assert.deepEqual(
    processor.validate(
      scriptForContract(60, selected, contextual),
      "pulse-gaming",
      {
      contract: selected,
      ctaDecision: ctaDecision(true),
      },
    ),
    [],
  );
  const errors = processor.validate(
    scriptForContract(
      60,
      selected,
      "Follow Pulse Gaming News for more updates.",
    ),
    "pulse-gaming",
    {
      contract: selected,
      ctaDecision: ctaDecision(true),
    },
  );
  assert.ok(errors.includes("banned_generic_follow_cta"));
});

test("processor rejects a model-declared hook type outside the selected cell", () => {
  const selected = contract("platform_pulse_short_30_36", "platform_pulse");
  const draft = {
    ...scriptForContract(48, selected),
    hook_type: "open_loop",
  };
  const errors = processor.validate(draft, "pulse-gaming", {
    contract: selected,
    ctaDecision: ctaDecision(false),
  });
  assert.ok(errors.includes("hook_type_contract_mismatch"));
});

test("processor rejects a contextual CTA outside its selected cohort", () => {
  const selected = contract("platform_pulse_standard_42_50", "platform_pulse");
  const errors = processor.validate(
    scriptForContract(
      68,
      selected,
      "Which platform wins this round?",
    ),
    "pulse-gaming",
    {
      contract: selected,
      ctaDecision: ctaDecision(false),
    },
  );
  assert.ok(errors.includes("cta_not_selected_for_short"));
});

test("non-Pulse channels keep their existing word-count contract", () => {
  assert.deepEqual(processor.validate(script(166), "the-signal"), []);
});

test("editor prompt uses selected matrix budget and selective CTA decision", () => {
  const instruction = processor.editorWordCountInstruction(
    { id: "pulse-gaming" },
    {
      contract: contract(
        "what_changes_short_25_32",
        "what_changes_for_players",
      ),
      ctaDecision: ctaDecision(false),
    },
  );
  assert.match(instruction, /37-47/);
  assert.match(instruction, /what_changes_short_25_32/);
  assert.match(instruction, /omit a CTA/i);
  assert.doesNotMatch(instruction, /90-110|155-185/);
});

test("processor editor pass revalidates edited scripts before accepting them", () => {
  assert.match(PROCESSOR_SOURCE, /validate\(\s*edited,\s*channel\.id,\s*\{/);
  assert.match(PROCESSOR_SOURCE, /editor_validation_failed/);
});

test("generation prompt carries matrix lane, duration and dynamic CTA rules", () => {
  const selectedContract = contract(
    "platform_pulse_short_30_36",
    "platform_pulse",
  );
  const prompt = buildPulseGenerationPrompt({
    contract: selectedContract,
    ctaDecision: ctaDecision(true),
  });
  assert.match(prompt, /Pulse Gaming News/);
  assert.match(prompt, /Fast gaming news\. Checked\. Explained\./);
  assert.match(prompt, /platform_pulse/);
  assert.match(prompt, /platform_pulse_short_30_36/);
  assert.match(prompt, /30-36 seconds/);
  assert.match(prompt, /45-52 cleaned spoken words/);
  assert.match(prompt, /story-specific CTA/);
  assert.doesNotMatch(prompt, /Follow Pulse Gaming News/);
});

test("generated story metadata records the selected editorial experiment", () => {
  const selectedContract = contract(
    "platform_pulse_short_30_36",
    "platform_pulse",
  );
  const decision = ctaDecision(false);
  const stamped = processor.applyPulseEditorialMetadata(
    {},
    selectedContract,
    decision,
  );
  assert.equal(stamped.brand_name, "Pulse Gaming News");
  assert.equal(stamped.editorial_lane_id, "platform_pulse");
  assert.equal(stamped.hook_type, "direct");
  assert.equal(stamped.experiment_id, "pulse-v1-controlled-12");
  assert.equal(
    stamped.experiment_matrix_version,
    "pulse-controlled-12-v1",
  );
  assert.equal(stamped.experiment_cell_id, "platform_pulse:direct:short");
  assert.equal(stamped.duration_band_id, "platform_pulse_short_30_36");
  assert.deepEqual(stamped.target_duration_seconds, { min: 30, max: 36 });
  assert.deepEqual(stamped.script_word_range, {
    min: 45,
    max: 52,
    seconds_per_word: 0.68,
  });
  assert.equal(stamped.cta_policy.audit_hash, AUDIT_HASH);
});

test("canonical generation has no fixed 60-second or 61-75 second Pulse rule", () => {
  assert.match(PROCESSOR_SOURCE, /resolvePulseScriptContract/);
  assert.match(PROCESSOR_SOURCE, /buildPulseGenerationPrompt/);
  assert.doesNotMatch(PROCESSOR_SOURCE, /61-75 second/);
  assert.doesNotMatch(pulseChannel.systemPrompt, /in 60 seconds/i);
  assert.doesNotMatch(pulseChannel.systemPrompt, /90-110 spoken words/i);
  assert.doesNotMatch(pulseChannel.systemPrompt, /Structure: Hook ->/i);
  assert.equal(pulseChannel.cta, "");
});

test("exhausted contract validation fails closed into human review", () => {
  assert.doesNotMatch(
    PROCESSOR_SOURCE,
    /Using script despite validation issues/,
  );
  assert.match(PROCESSOR_SOURCE, /contract_status:\s*"human_review_required"/);
  assert.match(
    PROCESSOR_SOURCE,
    /script\.contract_status === "human_review_required"\s*\?\s*false/,
  );
});
