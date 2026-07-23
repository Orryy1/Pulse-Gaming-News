const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyShortScriptRuntime,
  estimateSpeechSecondsFromWords,
  countSpokenWords,
  secondsPerWordForTtsProvider,
  DEFAULT_LOCAL_SECONDS_PER_WORD,
  DEFAULT_MIN_WORDS,
  DEFAULT_MAX_WORDS,
  BREAKING_NEWS_MIN_SECONDS,
  BREAKING_NEWS_MAX_SECONDS,
} = require("../../lib/services/short-runtime-planner");

const XBOX_BREAKING_STORY = {
  title: "Play More of the Games You Love, Wherever You Play",
  url: "https://news.xbox.com/en-us/2026/07/22/xbox-backward-compatibility-on-pc/",
  source_type: "rss",
  subreddit: "Xbox Wire",
  source_material_excerpt:
    "Xbox Backward Compatibility on PC launches in early release. Existing digital owners do not pay again. Every Game Pass plan includes the games and achievements arrive later.",
};

test("short runtime planner: 61s lower edge passes Flash Lane", () => {
  const plan = classifyShortScriptRuntime({ wordCount: 90 });
  assert.equal(plan.result, "pass");
  assert.equal(plan.shouldGenerateShortAudio, true);
  assert.equal(plan.estimatedSeconds, 61.2);
});

test("short runtime planner: 75s upper edge passes Flash Lane", () => {
  const plan = classifyShortScriptRuntime({ wordCount: 110 });
  assert.equal(plan.result, "pass");
  assert.equal(plan.shouldGenerateShortAudio, true);
  assert.equal(plan.estimatedSeconds, 74.8);
});

test("short runtime planner: 90s script is review, not normal Short audio", () => {
  const plan = classifyShortScriptRuntime({ wordCount: 132 });
  assert.equal(plan.result, "review");
  assert.equal(plan.route, "extended_or_briefing");
  assert.equal(plan.shouldGenerateShortAudio, false);
  assert.ok(
    plan.warnings.some((w) => w.startsWith("script_runtime_extended_review_required")),
  );
});

test("short runtime planner: 90s script can generate only when explicitly routed as extended Short", () => {
  const plan = classifyShortScriptRuntime({
    wordCount: 132,
    format: "pulse_extended_short",
  });

  assert.equal(plan.result, "pass");
  assert.equal(plan.route, "extended_short");
  assert.equal(plan.shouldGenerateShortAudio, true);
  assert.equal(plan.maxSeconds, 90);
});

test("short runtime planner: 117s script blocks before audio/render", () => {
  const plan = classifyShortScriptRuntime({ wordCount: 172 });
  assert.equal(plan.result, "fail");
  assert.equal(plan.route, "blocked");
  assert.equal(plan.shouldGenerateShortAudio, false);
  assert.ok(
    plan.failures.some((f) => f.startsWith("script_runtime_too_long")),
  );
});

test("short runtime planner: longform candidate routes away from normal Short", () => {
  const plan = classifyShortScriptRuntime({
    wordCount: 172,
    format: "weekly_roundup_item",
  });
  assert.equal(plan.result, "route_longform");
  assert.equal(plan.route, "briefing_or_longform");
  assert.equal(plan.shouldGenerateShortAudio, false);
  assert.deepEqual(plan.failures, []);
});

test("short runtime planner: default word budget matches current voice calibration", () => {
  assert.equal(DEFAULT_MIN_WORDS, 90);
  assert.equal(DEFAULT_MAX_WORDS, 110);
  assert.equal(estimateSpeechSecondsFromWords(100), 68);
  assert.equal(countSpokenWords("G T A six just moved again."), 7);
});

test("short runtime planner: local Liam voice uses measured approved-reference calibration", () => {
  assert.equal(DEFAULT_LOCAL_SECONDS_PER_WORD, 0.3);
  assert.equal(secondsPerWordForTtsProvider("local", {}), 0.3);
  assert.equal(secondsPerWordForTtsProvider("voxcpm", {}), 0.3);
  assert.equal(secondsPerWordForTtsProvider("elevenlabs", {}), 0.68);
  assert.equal(
    secondsPerWordForTtsProvider("local", { LOCAL_TTS_SECONDS_PER_WORD: "0.4" }),
    0.4,
  );

  const shortLocal = classifyShortScriptRuntime({
    wordCount: 130,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });
  assert.equal(shortLocal.result, "warn");
  assert.match(shortLocal.warnings[0], /below_flash_target/);
  assert.equal(shortLocal.estimatedSeconds, 39);

  const passLocal = classifyShortScriptRuntime({
    wordCount: 215,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });
  assert.equal(passLocal.result, "pass");
  assert.equal(passLocal.estimatedSeconds, 64.5);
  assert.equal(passLocal.minWords, 204);
  assert.equal(passLocal.maxWords, 250);
});

test("short runtime planner: latest Liam proof calibration no longer under-targets 200-word scripts", () => {
  const measuredProofWords = 202;
  const measuredProofSeconds = 59.36;
  const measuredSecondsPerWord = measuredProofSeconds / measuredProofWords;
  assert.ok(Math.abs(measuredSecondsPerWord - DEFAULT_LOCAL_SECONDS_PER_WORD) < 0.01);

  const repairedLocal = classifyShortScriptRuntime({
    wordCount: 215,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });
  assert.equal(repairedLocal.result, "pass");
  assert.ok(repairedLocal.estimatedSeconds >= 64);
  assert.ok(repairedLocal.estimatedSeconds <= 70);
});

test("short runtime planner: punctuation-heavy local Liam scripts include pause budget in duration estimates", () => {
  const text = "Wait. GTA? Xbox! Steam, moving now. ".repeat(35);
  const plan = classifyShortScriptRuntime({
    text,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });

  assert.equal(countSpokenWords(text), 210);
  assert.equal(plan.result, "pass");
  assert.equal(plan.estimatedSeconds, 66.5);
  assert.equal(plan.punctuationPauseSeconds, 3.5);
});

test("short runtime planner: local Liam too-short and too-long estimates are explicit", () => {
  const tooShort = classifyShortScriptRuntime({
    wordCount: 130,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });
  const tooLong = classifyShortScriptRuntime({
    wordCount: 310,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });

  assert.equal(tooShort.result, "warn");
  assert.match(tooShort.warnings[0], /script_runtime_below_flash_target/);
  assert.equal(tooLong.result, "fail");
  assert.match(tooLong.failures[0], /script_runtime_too_long/);
});

test("short runtime planner: verified breaking news generates audio before final measured-duration authority", () => {
  const plan = classifyShortScriptRuntime({
    wordCount: 137,
    story: XBOX_BREAKING_STORY,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });

  assert.equal(plan.result, "measurement_required");
  assert.equal(plan.route, "breaking_news_measurement_required");
  assert.equal(plan.durationLane, "breaking_news");
  assert.equal(plan.shouldGenerateShortAudio, true);
  assert.equal(plan.finalAudioAuthority, false);
  assert.equal(plan.minWords, 80);
  assert.equal(plan.maxWords, 180);
  assert.deepEqual(
    [plan.minSeconds, plan.maxSeconds],
    [BREAKING_NEWS_MIN_SECONDS, BREAKING_NEWS_MAX_SECONDS],
  );
});

test("short runtime planner: measured breaking-news audio is authoritative only inside its lane", () => {
  const pass = classifyShortScriptRuntime({
    wordCount: 137,
    story: XBOX_BREAKING_STORY,
    measuredAudioSeconds: 41,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });
  const tooShort = classifyShortScriptRuntime({
    wordCount: 137,
    story: XBOX_BREAKING_STORY,
    measuredAudioSeconds: 29,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });
  const tooLong = classifyShortScriptRuntime({
    wordCount: 137,
    story: XBOX_BREAKING_STORY,
    measuredAudioSeconds: 65,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });

  assert.equal(pass.result, "pass");
  assert.equal(pass.route, "breaking_news_short");
  assert.equal(pass.finalAudioAuthority, true);
  assert.equal(tooShort.result, "fail");
  assert.match(tooShort.failures[0], /breaking_news_audio_duration_too_short/);
  assert.equal(tooLong.result, "fail");
  assert.match(tooLong.failures[0], /breaking_news_audio_duration_too_long/);
});
