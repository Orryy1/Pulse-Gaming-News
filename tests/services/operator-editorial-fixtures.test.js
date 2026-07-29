"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  fixtureStory: approvedVoiceFixtureStory,
} = require("../../tools/approved-voice-path");
const {
  fixtureStory: productionContractFixtureStory,
} = require("../../tools/flash-lane-production-contract");
const {
  fixtureStory: voiceWorkbenchFixtureStory,
} = require("../../tools/flash-lane-voice-workbench");
const {
  resolveRequiredPulseEditorialContract,
} = require("../../lib/studio/v2/flash-lane-preflight");
const {
  validatePulseScriptRuntime,
} = require("../../lib/services/pulse-editorial-contract");

const fixtureBuilders = [
  ["approved voice", approvedVoiceFixtureStory],
  ["production contract", productionContractFixtureStory],
  ["voice workbench", voiceWorkbenchFixtureStory],
];

for (const [label, buildFixture] of fixtureBuilders) {
  test(`${label} operator fixture carries an exact in-band editorial contract`, () => {
    assert.equal(typeof buildFixture, "function");
    const story = buildFixture();
    const resolved = resolveRequiredPulseEditorialContract({ story });

    assert.equal(resolved.blocker, null);
    assert.equal(resolved.contract.format_family, "short");
    assert.equal(
      validatePulseScriptRuntime({
        text: story.full_script,
        contract: resolved.contract,
      }).result,
      "pass",
    );
  });

  test(`${label} operator fixture cannot reinsert a generic follow CTA`, () => {
    assert.equal(typeof buildFixture, "function");
    const story = buildFixture();

    assert.equal(story.cta, "");
    assert.equal(story.cta_policy.include_cta, false);
    assert.doesNotMatch(
      `${story.full_script} ${story.loop || ""} ${story.cta}`,
      /\b(?:follow|subscribe)\b/i,
    );
  });
}
