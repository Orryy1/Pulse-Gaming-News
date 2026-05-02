"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFlashLaneProductionContract,
  FLASH_LANE_DEFAULT_MAX_WORDS,
  renderFlashLaneProductionContractMarkdown,
} = require("../../lib/studio/v2/flash-lane-production-contract");

const richStory = {
  id: "flash-rich",
  title: "GTA 6 Owner Passed On A Sequel To A Legacy Franchise",
  hook: "Take-Two just made the weirdest legacy franchise call of the week.",
  full_script: [
    "Take-Two just made the weirdest legacy franchise call of the week.",
    "The company says it passed on a sequel to one of its legacy franchises because the pitch was not strong enough.",
    "That matters because Take-Two owns names that still make gaming audiences stop scrolling: GTA, Red Dead, BioShock, Mafia and Borderlands.",
    "This is not a release-date reveal and it is not confirmation of a cancelled project.",
    "It is a rare look at how the publisher decides what gets revived and what stays buried.",
    "The interesting bit is the standard.",
    "Take-Two is basically saying nostalgia alone is not enough.",
    "If a sequel cannot clear the creative bar, even a famous logo does not save it.",
    "That makes the mystery bigger, not smaller.",
    "Was it BioShock, Midnight Club, Bully, Max Payne or something else entirely?",
    "For players, the real takeaway is brutal.",
    "A beloved franchise can still lose internally if the pitch feels average.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" "),
};

test("Flash Lane contract keeps rich scripts in the 61-75s word budget", () => {
  const contract = buildFlashLaneProductionContract({
    story: richStory,
  });

  assert.equal(contract.lane_id, "pulse_flash_short");
  assert.equal(contract.script.max_words, FLASH_LANE_DEFAULT_MAX_WORDS);
  assert.ok(contract.script.word_count >= contract.narration_plan.targetWordRange[0]);
  assert.ok(contract.script.word_count <= contract.narration_plan.targetWordRange[1]);
  assert.equal(contract.next_action, "generate_approved_flash_lane_voice");
  assert.equal(contract.render_allowed, false);
});

test("Flash Lane contract rejects cached slow narration before render", () => {
  const contract = buildFlashLaneProductionContract({
    story: richStory,
    narrationDurationS: 118.025,
  });

  assert.equal(contract.render_allowed, false);
  assert.ok(contract.blockers.includes("narration_too_long_for_flash_lane"));
  assert.ok(contract.blockers.includes("spoken_pace_too_slow"));
  assert.equal(contract.next_action, "regenerate_approved_flash_lane_voice");
});

test("Flash Lane contract blocks short scripts before voice generation", () => {
  const contract = buildFlashLaneProductionContract({
    story: {
      id: "short",
      title: "Tiny gaming story",
      full_script: "A publisher confirmed one small update. Follow Pulse Gaming so you never miss a beat.",
    },
  });

  assert.equal(contract.render_allowed, false);
  assert.ok(contract.blockers.includes("script_too_short_for_flash_lane_target"));
  assert.equal(contract.next_action, "expand_flash_lane_script_before_voice");
});

test("Flash Lane contract markdown is readable and action-oriented", () => {
  const contract = buildFlashLaneProductionContract({
    story: richStory,
    narrationDurationS: 118.025,
  });
  const markdown = renderFlashLaneProductionContractMarkdown(contract);

  assert.match(markdown, /Pulse Flash Lane Production Contract/);
  assert.match(markdown, /regenerate_approved_flash_lane_voice/);
  assert.match(markdown, /spoken_pace_too_slow/);
  assert.match(markdown, /No TTS, render, OAuth, Railway or posting actions/);
});
