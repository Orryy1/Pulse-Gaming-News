"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFlashLaneProductionContract,
  renderFlashLaneProductionContractMarkdown,
} = require("../../lib/studio/v2/flash-lane-production-contract");

function contractedStory(overrides = {}) {
  const hook =
    "Xbox players just gained a feature the old catalogue was missing.";
  return {
    id: "contracted-flash",
    title: "Xbox changes backwards compatibility for players",
    hook,
    hook_type: "direct",
    editorial_lane_id: "what_changes_for_players",
    duration_band_id: "what_changes_standard_35_42",
    cta: "",
    full_script: `${hook} ${Array.from(
      { length: 45 },
      (_, index) => `verified${index + 1}`,
    ).join(" ")}.`,
    ...overrides,
  };
}

test("production voice contract uses the story's exact Pulse duration cell", () => {
  const contract = buildFlashLaneProductionContract({
    story: contractedStory(),
  });

  assert.equal(contract.lane_id, "what_changes_for_players");
  assert.equal(contract.duration_band_id, "what_changes_standard_35_42");
  assert.deepEqual(contract.runtime_target_seconds, { min: 35, max: 42 });
  assert.equal(contract.script.min_words, 52);
  assert.equal(contract.script.max_words, 61);
  assert.equal(contract.script.spoken_outro_required, undefined);
  assert.equal(contract.next_action, "generate_approved_flash_lane_voice");
});

test("production voice contract fails closed without explicit editorial metadata", () => {
  const contract = buildFlashLaneProductionContract({
    story: contractedStory({
      editorial_lane_id: undefined,
      hook_type: undefined,
      duration_band_id: undefined,
    }),
  });

  assert.equal(contract.lane_id, null);
  assert.equal(contract.duration_band_id, null);
  assert.equal(contract.runtime_target_seconds, null);
  assert.ok(
    contract.blockers.some((blocker) =>
      blocker.startsWith("pulse_editorial_contract_metadata_missing:"),
    ),
  );
  assert.equal(
    contract.next_action,
    "repair_pulse_editorial_contract_before_voice",
  );
  assert.equal(contract.render_allowed, false);
});

test("production voice contract rejects narration above its selected band", () => {
  const contract = buildFlashLaneProductionContract({
    story: contractedStory(),
    narrationDurationS: 42.1,
  });

  assert.equal(contract.render_allowed, false);
  assert.ok(
    contract.blockers.includes("audio_duration_above_selected_band"),
  );
  assert.equal(
    contract.next_action,
    "regenerate_approved_voice_within_selected_band",
  );
});

test("production voice contract blocks scripts below the selected word range", () => {
  const contract = buildFlashLaneProductionContract({
    story: contractedStory({
      full_script:
        "Xbox players just gained a feature the old catalogue was missing. One detail changed.",
    }),
  });

  assert.equal(contract.render_allowed, false);
  assert.ok(
    contract.blockers.includes("script_runtime_below_selected_band"),
  );
  assert.equal(
    contract.next_action,
    "expand_script_to_selected_band_before_voice",
  );
});

test("Flash Lane contract markdown is readable and action-oriented", () => {
  const contract = buildFlashLaneProductionContract({
    story: contractedStory(),
    narrationDurationS: 42.1,
  });
  const markdown = renderFlashLaneProductionContractMarkdown(contract);

  assert.match(markdown, /Pulse Flash Lane Production Contract/);
  assert.match(markdown, /what_changes_standard_35_42/);
  assert.match(markdown, /regenerate_approved_voice_within_selected_band/);
  assert.match(markdown, /audio_duration_above_selected_band/);
  assert.match(markdown, /No TTS, render, OAuth, Railway or posting actions/);
});
