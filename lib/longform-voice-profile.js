"use strict";

const PULSE_LONGFORM_ISLA_VOICE_ID = "h8eW5xfRUGVJrZhAFxqK";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveLongformVoiceProfile({
  channel = {},
  env = process.env,
  kind = "longform",
} = {}) {
  const configured = channel.longformVoice || {};
  const voiceId = clean(
    env.PULSE_LONGFORM_VOICE_ID ||
      env.LONGFORM_VOICE_ID ||
      configured.voiceId ||
      channel.voiceId,
  );
  if (!voiceId) {
    throw new Error("longform_voice_missing: configure PULSE_LONGFORM_VOICE_ID");
  }

  const provider = clean(
    env.PULSE_LONGFORM_TTS_PROVIDER ||
      env.LONGFORM_TTS_PROVIDER ||
      configured.provider ||
      "elevenlabs",
  ).toLowerCase();
  if (provider !== "elevenlabs") {
    throw new Error(`unsupported_longform_tts_provider:${provider}`);
  }

  const settings = configured.voiceSettings || {};
  const speed = finiteNumber(
    env.PULSE_LONGFORM_VOICE_SPEED || env.LONGFORM_VOICE_SPEED,
    finiteNumber(settings.speed ?? settings.speaking_rate, 1),
  );

  return {
    provider,
    voiceId,
    name: clean(configured.name) || clean(channel.name) || "Long-form narrator",
    accent: clean(configured.accent) || null,
    modelId: clean(configured.modelId || channel.voiceModel) || "eleven_multilingual_v2",
    useScope: "longform_only",
    kind: clean(kind) || "longform",
    source: clean(configured.source) || "managed_voice_account",
    voiceSettings: {
      stability: finiteNumber(settings.stability, 0.58),
      similarity_boost: finiteNumber(settings.similarity_boost, 0.86),
      style: finiteNumber(settings.style, 0.28),
      speed,
    },
  };
}

function cleanLongformNarration(text, options = {}) {
  // Load after the caller has initialised dotenv/channel selection. audio.js
  // resolves the active brand at module load time.
  const { cleanForTTS } = require("../audio");
  return cleanForTTS(text, options)
    .replace(/\s+/g, " ")
    .trim();
}

function buildLongformTtsRequest({
  profile,
  text,
  apiKey,
  timeoutMs = 600000,
} = {}) {
  if (!profile?.voiceId) throw new Error("longform_voice_profile_missing");
  if (!clean(text)) throw new Error("longform_narration_text_missing");

  return {
    method: "POST",
    url: `https://api.elevenlabs.io/v1/text-to-speech/${profile.voiceId}/with-timestamps`,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    data: {
      text,
      model_id: profile.modelId,
      voice_settings: { ...profile.voiceSettings },
      output_format: "mp3_44100_128",
    },
    timeout: finiteNumber(timeoutMs, 600000),
  };
}

function stampLongformVoiceEvidence({
  alignment = {},
  profile,
  kind = "longform",
  text,
  generatedAt = new Date().toISOString(),
  voiceMastering = null,
} = {}) {
  const existingMeta = alignment?.meta && typeof alignment.meta === "object"
    ? alignment.meta
    : {};
  return {
    ...(alignment || {}),
    meta: {
      ...existingMeta,
      provider: profile.provider,
      transcript: clean(text),
      longformVoice: {
        voiceId: profile.voiceId,
        name: profile.name,
        accent: profile.accent,
        modelId: profile.modelId,
        useScope: profile.useScope,
        kind: clean(kind) || profile.kind,
        source: profile.source,
        voiceSettings: { ...profile.voiceSettings },
      },
      voiceMastering,
      stampedAt: generatedAt,
    },
  };
}

function evaluateLongformVoiceAvailability({ profile, voices = [] } = {}) {
  const match = (Array.isArray(voices) ? voices : []).find(
    (voice) => clean(voice?.voice_id || voice?.voiceId) === clean(profile?.voiceId),
  );
  if (!match) {
    return {
      verdict: "RED",
      available: false,
      blocker: "configured_longform_voice_not_available",
      voice_id: profile?.voiceId || null,
      voice_name: profile?.name || null,
    };
  }
  return {
    verdict: "GREEN",
    available: true,
    blocker: null,
    voice_id: profile.voiceId,
    voice_name: clean(match.name) || profile.name,
    category: clean(match.category) || null,
    labels: match.labels || {},
  };
}

module.exports = {
  PULSE_LONGFORM_ISLA_VOICE_ID,
  buildLongformTtsRequest,
  cleanLongformNarration,
  evaluateLongformVoiceAvailability,
  resolveLongformVoiceProfile,
  stampLongformVoiceEvidence,
};
