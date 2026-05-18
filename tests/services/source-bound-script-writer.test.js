"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSourceBoundFallbackScript,
  shouldUseSourceBoundFallback,
  sourceNameFromUrl,
} = require("../../lib/source-bound-script-writer");
const { runScriptCoherenceQa } = require("../../lib/script-coherence-qa");
const { lintScript } = require("../../lib/services/script-lint");
const {
  classifyShortScriptRuntime,
} = require("../../lib/services/short-runtime-planner");

const LOCAL_PROFILE = {
  provider: "local",
  secondsPerWord: 0.34,
  minWords: 180,
  maxWords: 220,
  aimMin: 190,
  aimMax: 210,
};

test("source-bound fallback builds a validated Forza script from an article-backed Reddit story", () => {
  const story = {
    id: "1te1oq7",
    title:
      "Forza Horizon 6 immediately beats its predecessor's all-time Steam record with 130,000 concurrent players, and that's only counting people willing to pay $120 for early access",
    source_type: "reddit",
    subreddit: "pcgaming",
    article_url:
      "https://www.gamesradar.com/games/racing/forza-horizon-6-immediately-beats-its-predecessors-all-time-steam-record-with-130-000-concurrent-players-and-thats-only-counting-people-willing-to-pay-usd120-for-early-access/",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
    sourceMaterial: "Forza Horizon 6 takes the series to Japan.",
  });

  assert.ok(script);
  assert.equal(script.classification, "[CONFIRMED]");
  assert.match(script.full_script, /GamesRadar reports/);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(script.full_script, /,\./);
  assert.doesNotMatch(script.full_script, /signal|safe read|community is buzzing|verified insider/i);
  assert.ok(script.word_count >= 180 && script.word_count <= 220);

  const coherence = runScriptCoherenceQa(
    { ...story, ...script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  assert.equal(coherence.result, "pass", coherence.failures.join(", "));

  const lint = lintScript(script.full_script, {
    minWords: LOCAL_PROFILE.minWords,
    maxWords: LOCAL_PROFILE.maxWords,
  });
  assert.equal(lint.result, "warn");
  assert.deepEqual(lint.failures, []);

  const runtime = classifyShortScriptRuntime({
    text: script.full_script,
    secondsPerWord: LOCAL_PROFILE.secondsPerWord,
  });
  assert.equal(runtime.result, "pass");
});

test("source-bound fallback does not inject Steam player-count context into Forza review-score stories", () => {
  const story = {
    id: "1tftq7f",
    title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
    source_type: "reddit",
    subreddit: "PCMasterRace",
    article_url:
      "https://twistedvoxel.com/forza-horizon-6-becomes-highest-rated-game-of-2026-on-metacritic/",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
    sourceMaterial:
      "Twisted Voxel reports Forza Horizon 6 reached a 92 Metacritic score and is currently the highest rated game of 2026.",
  });

  assert.ok(script);
  assert.match(script.hook, /review-score slot/i);
  assert.match(script.full_script, /Metacritic/i);
  assert.doesNotMatch(script.full_script, /Steam number|Steam peak|concurrent players|early-access crowd|\$120/i);

  const coherence = runScriptCoherenceQa(
    { ...story, ...script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  assert.equal(coherence.result, "pass", coherence.failures.join(", "));
});

test("source-bound fallback refuses general community Reddit posts without article backing", () => {
  const story = {
    title: "Had a PS5 for years and someone just pointed this out to me.",
    source_type: "reddit",
    subreddit: "PS5",
  };

  assert.equal(shouldUseSourceBoundFallback(story), false);
  assert.equal(buildSourceBoundFallbackScript(story, { runtimeProfile: LOCAL_PROFILE }), null);
});

test("source-bound fallback keeps Stop Killing Games wording intact", () => {
  const story = {
    title:
      "California bill backed by Stop Killing Games campaign pushing to keep games playable after server shutdowns passes key hurdle, paving way for full assembly vote",
    source_type: "reddit",
    subreddit: "Games",
    article_url:
      "https://www.rockpapershotgun.com/california-bill-pushing-to-keep-games-playable-after-server-shutdowns-passes-key-hurdle-paving-way-for-full-assembly-vote",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
  });

  assert.ok(script);
  assert.match(script.full_script, /Stop Killing Games/);
  assert.doesNotMatch(script.full_script, /Stop Ending Games/i);
  assert.match(script.full_script, /committee vote is progress, not a finished law/i);
});

test("sourceNameFromUrl gives readable publisher names", () => {
  assert.equal(
    sourceNameFromUrl("https://www.rockpapershotgun.com/example"),
    "Rock Paper Shotgun",
  );
  assert.equal(sourceNameFromUrl("https://www.pcgamer.com/example"), "PC Gamer");
});
