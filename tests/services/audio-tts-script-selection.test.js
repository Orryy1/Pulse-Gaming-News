"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanForTTS,
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

test("selectRawTtsScript: removes adjacent duplicate opener and duplicate spoken outro", () => {
  const opener = "Forza Horizon 6 just put up a ridiculous Steam number.";
  const story = {
    id: "forza-steam-record",
    tts_script:
      `${opener} ${opener} GamesRadar reports the early access launch hit a new Steam peak. ` +
      "Follow Pulse Gaming so you never miss a beat. Follow Pulse Gaming so you never miss a beat.",
  };

  const selected = selectRawTtsScript(story);

  assert.equal(
    (selected.match(/Forza Horizon 6 just put up a ridiculous Steam number/g) || []).length,
    1,
  );
  assert.equal(
    (selected.match(/Follow Pulse Gaming so you never miss a beat/g) || []).length,
    1,
  );
  assert.equal(
    selected,
    `${opener} GamesRadar reports the early access launch hit a new Steam peak. Follow Pulse Gaming so you never miss a beat.`,
  );
});

test("ensureSpokenOutro: collapses repeated terminal CTAs to exactly one", () => {
  assert.equal(
    ensureSpokenOutro(
      "A clean gaming update. Follow Pulse Gaming so you never miss a beat. Follow Pulse Gaming so you never miss a beat.",
    ),
    "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
  );
});

test("ensureSpokenOutro: keeps a custom terminal Pulse CTA without adding the default", () => {
  assert.equal(
    ensureSpokenOutro("A clean gaming update. Follow Pulse Gaming for the next read."),
    "A clean gaming update. Follow Pulse Gaming for the next read.",
  );
});

test("cleanForTTS: expands comma-formatted large numbers for clearer narration", () => {
  assert.equal(
    cleanForTTS("Forza Horizon 6 hit 130,000 concurrent players on Steam."),
    "Forza Horizon 6 hit one hundred and thirty thousand concurrent players on Steam.",
  );
});

test("cleanForTTS: expands modern years without hybrid spoken digits", () => {
  assert.equal(
    cleanForTTS("Forza Horizon 6 topped Metacritic in 2026, not 2039."),
    "Forza Horizon 6 topped Metacritic in twenty twenty six, not twenty thirty nine.",
  );
});

test("cleanForTTS: speaks Hades II as Hades two for local voice clarity", () => {
  assert.equal(
    cleanForTTS("Hades II just put PlayStation and Xbox players on the same April countdown."),
    "Hades two just put PlayStation and Xbox players on the same April countdown.",
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
