"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const pulseGaming = require("../../channels/pulse-gaming");
const activeBrand = require("../../brand");
const {
  PULSE_LONGFORM_ISLA_VOICE_ID,
  buildLongformTtsRequest,
  cleanLongformNarration,
  evaluateLongformVoiceAvailability,
  resolveLongformVoiceProfile,
  stampLongformVoiceEvidence,
} = require("../../lib/longform-voice-profile");

test("Pulse Gaming selects Scottish Isla for long-form without changing the Shorts voice", () => {
  const profile = resolveLongformVoiceProfile({
    channel: pulseGaming,
    env: {},
    kind: "weekly_roundup",
  });

  assert.equal(profile.provider, "elevenlabs");
  assert.equal(profile.voiceId, PULSE_LONGFORM_ISLA_VOICE_ID);
  assert.equal(profile.name, "Isla - Youthful, Relaxed, and Warm");
  assert.equal(profile.accent, "Scottish");
  assert.equal(profile.useScope, "longform_only");
  assert.equal(pulseGaming.voiceId, "TX3LPaxmHKxFdv7VOQHJ");
  assert.notEqual(profile.voiceId, pulseGaming.voiceId);
});

test("active brand bridge preserves the dedicated long-form voice profile", () => {
  assert.equal(activeBrand.longformVoice.voiceId, PULSE_LONGFORM_ISLA_VOICE_ID);
  assert.equal(activeBrand.longformVoice.accent, "Scottish");
  assert.equal(activeBrand.voiceId, "TX3LPaxmHKxFdv7VOQHJ");
});

test("long-form voice selection supports a dedicated override without reading the Shorts override", () => {
  const profile = resolveLongformVoiceProfile({
    channel: pulseGaming,
    env: {
      ELEVENLABS_VOICE_ID: "shorts-voice-must-not-leak",
      PULSE_LONGFORM_VOICE_ID: "operator-approved-longform-voice",
    },
    kind: "topic_compilation",
  });

  assert.equal(profile.voiceId, "operator-approved-longform-voice");
});

test("long-form narration uses the shared gaming pronunciation cleaner", () => {
  const cleaned = cleanLongformNarration(
    "Halo: Campaign Evolved meets GTA VI in 2026. [VISUAL: gameplay]",
  );

  assert.doesNotMatch(cleaned, /Halo\s*:/);
  assert.match(cleaned, /Halo Campaign Evolved/);
  assert.doesNotMatch(cleaned, /G T A|GTA VI/);
  assert.doesNotMatch(cleaned, /\[VISUAL:/);
});

test("long-form TTS request uses Isla's stable documentary settings", () => {
  const profile = resolveLongformVoiceProfile({
    channel: pulseGaming,
    env: {},
    kind: "weekly_roundup",
  });
  const request = buildLongformTtsRequest({
    profile,
    text: "This is a long-form narration proof.",
    apiKey: "test-key",
    timeoutMs: 123456,
  });

  assert.match(request.url, new RegExp(`${PULSE_LONGFORM_ISLA_VOICE_ID}/with-timestamps$`));
  assert.equal(request.timeout, 123456);
  assert.equal(request.data.model_id, "eleven_multilingual_v2");
  assert.equal(request.data.voice_settings.speed, 1);
  assert.equal(request.data.voice_settings.stability, 0.58);
  assert.equal(request.data.voice_settings.similarity_boost, 0.86);
});

test("long-form timestamp evidence identifies Isla and the long-form-only route", () => {
  const profile = resolveLongformVoiceProfile({
    channel: pulseGaming,
    env: {},
    kind: "weekly_roundup",
  });
  const alignment = stampLongformVoiceEvidence({
    alignment: { characters: ["H"], character_start_times_seconds: [0] },
    profile,
    kind: "weekly_roundup",
    text: "Hello.",
    generatedAt: "2026-07-14T12:00:00.000Z",
    voiceMastering: {
      ok: true,
      targetLufs: -16,
      truePeak: -2.2,
    },
  });

  assert.equal(alignment.meta.provider, "elevenlabs");
  assert.equal(alignment.meta.longformVoice.voiceId, PULSE_LONGFORM_ISLA_VOICE_ID);
  assert.equal(alignment.meta.longformVoice.name, "Isla - Youthful, Relaxed, and Warm");
  assert.equal(alignment.meta.longformVoice.useScope, "longform_only");
  assert.equal(alignment.meta.longformVoice.kind, "weekly_roundup");
  assert.equal(alignment.meta.transcript, "Hello.");
  assert.equal(alignment.meta.voiceMastering.ok, true);
  assert.equal(alignment.meta.voiceMastering.targetLufs, -16);
});

test("voice doctor distinguishes an available Isla profile from a missing account voice", () => {
  const profile = resolveLongformVoiceProfile({ channel: pulseGaming, env: {} });
  const available = evaluateLongformVoiceAvailability({
    profile,
    voices: [{ voice_id: PULSE_LONGFORM_ISLA_VOICE_ID, name: profile.name }],
  });
  const missing = evaluateLongformVoiceAvailability({ profile, voices: [] });

  assert.equal(available.verdict, "GREEN");
  assert.equal(available.available, true);
  assert.equal(missing.verdict, "RED");
  assert.equal(missing.blocker, "configured_longform_voice_not_available");
});
