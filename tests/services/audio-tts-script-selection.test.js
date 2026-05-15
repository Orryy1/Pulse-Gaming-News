"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureSpokenOutro,
  selectRawTtsScript,
  resolveTtsTimeoutMs,
} = require("../../audio");

test("selectRawTtsScript: uses clean full_script when cached tts_script damaged a protected name", () => {
  const story = {
    id: "pokemon-story",
    full_script: "Pok\u00e9mon Go has a new Mega Mewtwo event.",
    tts_script: "Pokmon Go has a new Mega Mewtwo event.",
  };

  assert.equal(selectRawTtsScript(story), ensureSpokenOutro(story.full_script));
});

test("selectRawTtsScript: keeps clean cached tts_script", () => {
  const story = {
    full_script: "GTA 6 has a new report.",
    tts_script: "G T A six has a new report.",
  };

  assert.equal(selectRawTtsScript(story), ensureSpokenOutro(story.tts_script));
});

test("selectRawTtsScript: prefers canonical full_script over non-canonical cached spelling", () => {
  const story = {
    full_script: "Pok\u00e9mon Go Fest is free for all players.",
    tts_script: "Pokemon Go Fest is free for all players.",
  };

  assert.equal(selectRawTtsScript(story), ensureSpokenOutro(story.full_script));
});

test("selectRawTtsScript: returns cached script when no better fallback exists", () => {
  const story = {
    tts_script: "Pokmon Go has a new event.",
  };

  assert.equal(selectRawTtsScript(story), ensureSpokenOutro(story.tts_script));
});

test("selectRawTtsScript: restores the required spoken outro for source scripts missing it", () => {
  const story = {
    full_script: "Subnautica 2 just passed a million sales.",
  };

  assert.equal(
    selectRawTtsScript(story),
    "Subnautica 2 just passed a million sales. Follow Pulse Gaming so you never miss a beat.",
  );
});

test("resolveTtsTimeoutMs: local VoxCPM defaults to a bounded timeout but remains configurable", () => {
  assert.equal(resolveTtsTimeoutMs("local", {}), 300000);
  assert.equal(
    resolveTtsTimeoutMs("local", { LOCAL_TTS_TIMEOUT_MS: "900000" }),
    900000,
  );
  assert.equal(resolveTtsTimeoutMs("elevenlabs", {}), 60000);
});
