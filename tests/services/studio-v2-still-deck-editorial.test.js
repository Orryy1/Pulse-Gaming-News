"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRenderStory,
  resolveTargetRuntimeS,
} = require("../../tools/studio-v2-still-deck-ingestion");
const {
  resolveRequiredPulseEditorialContract,
} = require("../../lib/studio/v2/flash-lane-preflight");
const {
  validatePulseScriptRuntime,
} = require("../../lib/services/pulse-editorial-contract");

function story(overrides = {}) {
  return {
    id: "still-deck-editorial",
    title: "Xbox adds achievements to backwards-compatible games",
    hook: "Xbox has added achievement support to selected original Xbox games.",
    hook_type: "direct",
    editorial_lane_id: "what_changes_for_players",
    duration_band_id: "what_changes_standard_35_42",
    cta: "",
    cta_policy: {
      policy_version: "pulse-selective-cta-v2",
      scope: "shorts",
      include_cta: false,
      copy_strategy: "none",
      cohort_bucket: 1,
      cohort_numerator: 1,
      cohort_denominator: 3,
      audit_hash: `sha256:${"d".repeat(64)}`,
    },
    full_script: [
      "Xbox has added achievement support to selected original Xbox games in backwards compatibility.",
      "That changes old catalogue releases from simple nostalgia plays into trackable games with modern profile progress.",
      "Microsoft has not confirmed every title yet, so the affected list still matters.",
      "For players, the practical change is clear: returning classics can now contribute achievements alongside newer Game Pass releases.",
    ].join(" "),
    ...overrides,
  };
}

test("still-deck render story preserves an exact in-band script without inventing copy", () => {
  const rendered = buildRenderStory(story());
  const resolved = resolveRequiredPulseEditorialContract({ story: rendered });

  assert.equal(resolved.blocker, null);
  assert.equal(
    validatePulseScriptRuntime({
      text: rendered.tts_script,
      contract: resolved.contract,
    }).result,
    "pass",
  );
  assert.doesNotMatch(
    `${rendered.full_script} ${rendered.tts_script}`,
    /\b(?:follow|subscribe)\b/i,
  );
});

test("still-deck target runtime is the selected band midpoint, not a minute floor", () => {
  assert.equal(resolveTargetRuntimeS(story()), 38.5);
});

test("still-deck render story fails closed without editorial metadata", () => {
  assert.throws(
    () =>
      buildRenderStory(
        story({
          editorial_lane_id: undefined,
          hook_type: undefined,
          duration_band_id: undefined,
        }),
      ),
    /pulse_editorial_contract_metadata_missing/,
  );
});
