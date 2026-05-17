"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  clearAudioGenerationState,
  generateTtsForStory,
  buildTtsAlignmentMeta,
  isLocalTtsProvider,
  isRetryableLocalTtsError,
  markAudioGenerationFailure,
  prepareTtsAlignmentForWrite,
  requestTtsWithRetry,
  resolveTtsOutputFormat,
  resolveTtsTimeoutMs,
  resolveTtsVoiceIdForProvider,
  shouldAutoPromoteGeneratedAudioToExtendedShort,
  shouldAutoPromoteRuntimePlanToExtendedShort,
  shouldUseDynamicPacingForProvider,
} = require("../../audio");

test("isRetryableLocalTtsError: recognises transient local socket resets", () => {
  assert.equal(isRetryableLocalTtsError({ code: "ECONNRESET" }), true);
  assert.equal(isRetryableLocalTtsError(new Error("read ECONNRESET")), true);
  assert.equal(isRetryableLocalTtsError({ code: "ETIMEDOUT" }), false);
  assert.equal(isRetryableLocalTtsError(new Error("timeout of 300000ms exceeded")), false);
  assert.equal(isRetryableLocalTtsError(new Error("HTTP 400")), false);
});

test("shouldUseDynamicPacingForProvider: disables split pacing for local Liam", () => {
  const previous = process.env.TTS_DYNAMIC_PACING;
  process.env.TTS_DYNAMIC_PACING = "true";
  try {
    assert.equal(shouldUseDynamicPacingForProvider("local"), false);
    assert.equal(shouldUseDynamicPacingForProvider("elevenlabs"), true);
  } finally {
    if (previous === undefined) delete process.env.TTS_DYNAMIC_PACING;
    else process.env.TTS_DYNAMIC_PACING = previous;
  }
});

test("shouldUseDynamicPacingForProvider: keeps explicit remote opt-out", () => {
  const previous = process.env.TTS_DYNAMIC_PACING;
  process.env.TTS_DYNAMIC_PACING = "false";
  try {
    assert.equal(shouldUseDynamicPacingForProvider("elevenlabs"), false);
  } finally {
    if (previous === undefined) delete process.env.TTS_DYNAMIC_PACING;
    else process.env.TTS_DYNAMIC_PACING = previous;
  }
});

test("shouldAutoPromoteRuntimePlanToExtendedShort: allows approved local 76-90s scripts", () => {
  assert.equal(
    shouldAutoPromoteRuntimePlanToExtendedShort({
      provider: "local",
      story: { approved: true },
      runtimePlan: {
        route: "extended_or_briefing",
        estimatedSeconds: 82,
        shouldGenerateShortAudio: false,
      },
    }),
    true,
  );
});

test("shouldAutoPromoteRuntimePlanToExtendedShort: keeps remote and runaway scripts blocked", () => {
  assert.equal(
    shouldAutoPromoteRuntimePlanToExtendedShort({
      provider: "elevenlabs",
      story: { approved: true },
      runtimePlan: { route: "extended_or_briefing", estimatedSeconds: 82 },
    }),
    false,
  );
  assert.equal(
    shouldAutoPromoteRuntimePlanToExtendedShort({
      provider: "local",
      story: { approved: true },
      runtimePlan: { route: "extended_or_briefing", estimatedSeconds: 95 },
    }),
    false,
  );
});

test("shouldAutoPromoteGeneratedAudioToExtendedShort: accepts local Liam drift under 90s", () => {
  assert.equal(
    shouldAutoPromoteGeneratedAudioToExtendedShort({
      provider: "local",
      story: { approved: true },
      runtimePlan: { route: "flash_short", shouldGenerateShortAudio: true },
      totalDuration: 79.2,
    }),
    true,
  );
});

test("shouldAutoPromoteGeneratedAudioToExtendedShort: blocks remote, unapproved and 90s+ audio", () => {
  assert.equal(
    shouldAutoPromoteGeneratedAudioToExtendedShort({
      provider: "elevenlabs",
      story: { approved: true },
      runtimePlan: { route: "flash_short", shouldGenerateShortAudio: true },
      totalDuration: 79.2,
    }),
    false,
  );
  assert.equal(
    shouldAutoPromoteGeneratedAudioToExtendedShort({
      provider: "local",
      story: { approved: false },
      runtimePlan: { route: "flash_short", shouldGenerateShortAudio: true },
      totalDuration: 79.2,
    }),
    false,
  );
  assert.equal(
    shouldAutoPromoteGeneratedAudioToExtendedShort({
      provider: "local",
      story: { approved: true },
      runtimePlan: { route: "flash_short", shouldGenerateShortAudio: true },
      totalDuration: 95,
    }),
    false,
  );
});

test("requestTtsWithRetry: retries local ECONNRESET once and returns the response", async () => {
  let calls = 0;
  const response = await requestTtsWithRetry({
    provider: "local",
    requestConfig: { url: "http://127.0.0.1:8765/v1/text-to-speech/x" },
    retryDelayMs: 1,
    request: async () => {
      calls++;
      if (calls === 1) {
        const err = new Error("read ECONNRESET");
        err.code = "ECONNRESET";
        throw err;
      }
      return { data: { audio_base64: "abc" } };
    },
  });

  assert.equal(calls, 2);
  assert.equal(response.data.audio_base64, "abc");
});

test("requestTtsWithRetry: does not retry remote provider socket errors", async () => {
  let calls = 0;
  await assert.rejects(
    requestTtsWithRetry({
      provider: "elevenlabs",
      requestConfig: {},
      retryDelayMs: 1,
      request: async () => {
        calls++;
        const err = new Error("read ECONNRESET");
        err.code = "ECONNRESET";
        throw err;
      },
    }),
    /ECONNRESET/,
  );
  assert.equal(calls, 1);
});

test("requestTtsWithRetry: stops after configured local attempts", async () => {
  let calls = 0;
  await assert.rejects(
    requestTtsWithRetry({
      provider: "local",
      requestConfig: {},
      attempts: 2,
      retryDelayMs: 1,
      request: async () => {
        calls++;
        const err = new Error("read ECONNRESET");
        err.code = "ECONNRESET";
        throw err;
      },
    }),
    /ECONNRESET/,
  );
  assert.equal(calls, 2);
});

test("requestTtsWithRetry: does not retry local generation timeouts", async () => {
  let calls = 0;
  await assert.rejects(
    requestTtsWithRetry({
      provider: "local",
      requestConfig: {},
      attempts: 2,
      retryDelayMs: 1,
      request: async () => {
        calls++;
        const err = new Error("timeout of 300000ms exceeded");
        err.code = "ETIMEDOUT";
        throw err;
      },
    }),
    /timeout/,
  );
  assert.equal(calls, 1);
});

test("isLocalTtsProvider: only true for explicit local provider", () => {
  assert.equal(isLocalTtsProvider("local"), true);
  assert.equal(isLocalTtsProvider("LOCAL"), true);
  assert.equal(isLocalTtsProvider("elevenlabs"), false);
});

test("resolveTtsOutputFormat: local Liam requests higher bitrate source audio", () => {
  assert.equal(resolveTtsOutputFormat("local", {}), "mp3_44100_256");
  assert.equal(resolveTtsOutputFormat("elevenlabs", {}), "mp3_44100_128");
  assert.equal(
    resolveTtsOutputFormat("local", { LOCAL_TTS_OUTPUT_FORMAT: "mp3_44100_256" }),
    "mp3_44100_256",
  );
  assert.equal(
    resolveTtsOutputFormat("local", { LOCAL_TTS_OUTPUT_FORMAT: "mp3_44100_128" }),
    "mp3_44100_256",
  );
  assert.equal(
    resolveTtsOutputFormat("local", {
      LOCAL_TTS_OUTPUT_FORMAT: 'mp3_44100_256","injected":"yes',
    }),
    "mp3_44100_256",
  );
});

test("resolveTtsTimeoutMs: local TTS defaults to a bounded five-minute cap", () => {
  assert.equal(resolveTtsTimeoutMs("local", {}), 300000);
  assert.equal(resolveTtsTimeoutMs("local", { LOCAL_TTS_TIMEOUT_MS: "450000" }), 450000);
  assert.equal(resolveTtsTimeoutMs("local", { LOCAL_TTS_TIMEOUT_MS: "0" }), 300000);
  assert.equal(resolveTtsTimeoutMs("elevenlabs", {}), 60000);
});

test("generateTtsForStory: server_down triggers one recovery then keeps the successful MP3", async () => {
  const story = { id: "rss_recover_tts" };
  let calls = 0;
  let recoveries = 0;

  const attempt = await generateTtsForStory({
    story,
    text: "Pulse Gaming local TTS recovery test.",
    outputPath: "output/audio/rss_recover_tts.mp3",
    provider: "local",
    generateTts: async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("connect ECONNREFUSED 127.0.0.1:8765");
        err.code = "ECONNREFUSED";
        throw err;
      }
    },
    recoverLocalTts: async (context) => {
      recoveries += 1;
      assert.equal(context.storyId, "rss_recover_tts");
      assert.equal(context.failure.code, "server_down");
      return { ok: true, action: "start+prewarm" };
    },
  });

  assert.equal(calls, 2);
  assert.equal(recoveries, 1);
  assert.equal(attempt.ok, true);
  assert.equal(attempt.attempts, 2);
  assert.equal(story.local_tts_attempts.length, 1);
  assert.equal(story.local_tts_attempts[0].ok, true);
  assert.equal(story.local_tts_attempts[0].recovery.action, "start+prewarm");
});

test("generateTtsForStory: unsafe voice does not attempt server recovery", async () => {
  const story = { id: "rss_bad_voice" };
  let recoveries = 0;

  await assert.rejects(
    generateTtsForStory({
      story,
      text: "Bad voice must fail closed.",
      outputPath: "output/audio/rss_bad_voice.mp3",
      provider: "local",
      generateTts: async () => {
        throw new Error("unknown voice_id='bad' is not registered; refusing default fallback voice");
      },
      recoverLocalTts: async () => {
        recoveries += 1;
        return { ok: true };
      },
    }),
    /local_tts_generation_failed:unsafe_voice/,
  );

  assert.equal(recoveries, 0);
  assert.equal(story.local_tts_attempts.length, 1);
  assert.equal(story.local_tts_attempts[0].failure_code, "unsafe_voice");
});

test("generateTtsForStory: local generation timeout fails fast without retrying the same story", async () => {
  const story = { id: "rss_timeout_tts" };
  let calls = 0;
  let recoveries = 0;

  await assert.rejects(
    generateTtsForStory({
      story,
      text: "Pulse Gaming local TTS timeout test.",
      outputPath: "output/audio/rss_timeout_tts.mp3",
      provider: "local",
      generateTts: async () => {
        calls += 1;
        const err = new Error("timeout of 180000ms exceeded");
        err.code = "ETIMEDOUT";
        throw err;
      },
      recoverLocalTts: async () => {
        recoveries += 1;
        return { ok: true, action: "restart" };
      },
    }),
    /local_tts_generation_failed:tts_timeout/,
  );

  assert.equal(calls, 1);
  assert.equal(recoveries, 0);
  assert.equal(story.local_tts_attempts[0].attempts, 1);
  assert.equal(story.local_tts_attempts[0].failure_code, "tts_timeout");
});

test("resolveTtsVoiceIdForProvider: local TTS refuses generic or non-Liam fallback voices", () => {
  assert.throws(
    () => resolveTtsVoiceIdForProvider("local", { LOCAL_TTS_VOICE_ID: "__default__" }, {}),
    /unsafe_local_tts_voice:missing_mapped_liam_voice_id/,
  );
  assert.throws(
    () => resolveTtsVoiceIdForProvider("local", { LOCAL_TTS_VOICE_ID: "G17SuINrv2H9FC6nvetn" }, {}),
    /unsafe_local_tts_voice:G17SuINrv2H9FC6nvetn:expected_TX3LPaxmHKxFdv7VOQHJ/,
  );
  assert.equal(
    resolveTtsVoiceIdForProvider("local", { LOCAL_TTS_VOICE_ID: "liam" }, {}),
    "TX3LPaxmHKxFdv7VOQHJ",
  );
  assert.equal(
    resolveTtsVoiceIdForProvider("local", {}, { voiceId: "TX3LPaxmHKxFdv7VOQHJ" }),
    "TX3LPaxmHKxFdv7VOQHJ",
  );
});

test("buildTtsAlignmentMeta: prefers full request text over stale short local transcript", () => {
  const fullText =
    "This is the complete narration that should drive captions all the way to the outro. Follow Pulse Gaming so you never miss a beat.";
  const meta = buildTtsAlignmentMeta({
    existingMeta: { transcript: "short probe transcript" },
    provider: "local",
    voiceId: "TX3LPaxmHKxFdv7VOQHJ",
    baseUrl: "http://127.0.0.1:8765",
    text: fullText,
    resolvedVoiceSettings: { speaking_rate: 1 },
  });

  assert.equal(meta.transcript, fullText);
  assert.equal(meta.spokenOutroPresent, true);
});

test("prepareTtsAlignmentForWrite: local broken timings are replaced before sidecar write", () => {
  const text = "Stardew Valley creator follow Pulse Gaming.";
  const badAlignment = {
    characters: Array.from(text),
    character_start_times_seconds: Array.from(text, (_, i) =>
      i < 7 ? 0.1 : i < 20 ? 36.7 : 64,
    ),
    character_end_times_seconds: Array.from(text, (_, i) =>
      i < 7 ? 0.5 : i < 20 ? 37.1 : 64,
    ),
    meta: { transcript: "short stale transcript" },
  };

  const prepared = prepareTtsAlignmentForWrite({
    provider: "local",
    alignment: badAlignment,
    text,
    durationSeconds: 64,
  });

  assert.equal(prepared.repair.repaired, true);
  assert.equal(prepared.repair.reason, "max_gap_too_large");
  assert.equal(prepared.alignment.characters.join(""), text);
  assert.equal(prepared.alignment.meta.transcript, "short stale transcript");
  assert.equal(prepared.alignment.meta.timestampRepair.reason, "max_gap_too_large");
  assert.equal(
    prepared.alignment.meta.timestampRepair.strategy,
    "synthetic_full_duration",
  );
});

test("prepareTtsAlignmentForWrite: local timings that end before the outro are repaired", () => {
  const text = "Pulse Gaming reports the story and tells viewers to follow so they never miss a beat.";
  const badAlignment = {
    characters: Array.from(text),
    character_start_times_seconds: Array.from(text, (_, i) =>
      i < text.length - 4 ? (i / (text.length - 4)) * 58 : 58,
    ),
    character_end_times_seconds: Array.from(text, (_, i) =>
      i < text.length - 4 ? (i / (text.length - 4)) * 58 + 0.2 : 58.2,
    ),
    meta: { transcript: "short stale transcript" },
  };

  const prepared = prepareTtsAlignmentForWrite({
    provider: "local",
    alignment: badAlignment,
    text,
    durationSeconds: 64,
  });

  assert.equal(prepared.repair.repaired, true);
  assert.equal(prepared.repair.reason, "trailing_caption_gap_too_large");
  assert.equal(prepared.repair.strategy, "synthetic_full_duration");
  assert.equal(prepared.alignment.meta.timestampRepair.reason, "trailing_caption_gap_too_large");
});

test("markAudioGenerationFailure: records local TTS voice failures on the story", () => {
  const story = { id: "rss_bad_voice", title: "Bad local voice" };
  const failure = markAudioGenerationFailure(
    story,
    new Error("unknown voice_id='JBFqnCBsd6RMkjVDRZzb' is not registered; refusing default fallback voice"),
    { provider: "local", now: () => new Date("2026-05-13T00:00:00.000Z") },
  );

  assert.equal(failure.code, "unsafe_voice");
  assert.equal(story.qa_failed, true);
  assert.deepEqual(story.qa_failures, ["audio_generation_failed:unsafe_voice"]);
  assert.equal(story.publish_status, "failed");
  assert.match(story.publish_error, /audio_generation_failed: unsafe_voice/);
  assert.equal(story.local_tts_failure.requires_server_reset, false);
  assert.equal(story.qa_failed_at, "2026-05-13T00:00:00.000Z");
});

test("markAudioGenerationFailure: GPU saturation is pending audio, not hard QA failure", () => {
  const story = {
    id: "gpu-busy",
    title: "GPU busy",
    qa_failed: true,
    qa_failures: ["audio_generation_failed:tts_timeout"],
    qa_failed_at: "2026-05-13T00:00:00.000Z",
  };
  const failure = markAudioGenerationFailure(
    story,
    new Error("local_tts_gpu_busy: GPU free memory 702MB is below 3072MB"),
    { provider: "local", now: () => new Date("2026-05-15T19:30:00.000Z") },
  );

  assert.equal(failure.code, "gpu_saturated");
  assert.equal(story.qa_failed, false);
  assert.deepEqual(story.qa_failures, []);
  assert.deepEqual(story.qa_warnings, ["audio_generation_pending:gpu_saturated"]);
  assert.equal(story.qa_failed_at, null);
  assert.equal(story.publish_status, "pending_audio");
  assert.match(story.publish_error, /audio_generation_pending: gpu_saturated/);
  assert.equal(story.audio_generation_failure.pending, true);
  assert.equal(story.local_tts_failure.requires_server_reset, false);
});

test("clearAudioGenerationState removes stale pending audio after a later success", () => {
  const story = {
    id: "audio-recovered",
    qa_failed: false,
    qa_failures: [],
    qa_warnings: [
      "audio_generation_pending:gpu_saturated",
      "approved_voice:pitch_profile_unverified",
    ],
    publish_status: "pending_audio",
    publish_error: "audio_generation_pending: local_tts_ready_for_retry",
    audio_generation_failure: { provider: "local", code: "gpu_saturated" },
    local_tts_failure: { code: "gpu_saturated" },
  };

  clearAudioGenerationState(story);

  assert.equal(story.publish_status, null);
  assert.equal(story.publish_error, null);
  assert.deepEqual(story.qa_failures, []);
  assert.deepEqual(story.qa_warnings, ["approved_voice:pitch_profile_unverified"]);
  assert.equal(story.audio_generation_failure, null);
  assert.equal(story.local_tts_failure, null);
});
