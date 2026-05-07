"use strict";

const {
  classifyLocalTtsHealthFailure,
} = require("../studio/local-tts-failures");

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function normaliseVoice(localTts = {}) {
  const voice = localTts.voice || {};
  return {
    alias: voice.alias || null,
    voiceId: voice.voiceId || voice.voice_id || null,
    loaded: bool(voice.loaded),
    refResolved: bool(voice.refResolved ?? voice.ref_resolved),
    present: voice.present === undefined ? Boolean(voice.alias || voice.voiceId || voice.voice_id) : bool(voice.present),
  };
}

function isLiamAlias(alias) {
  return /\bliam\b/i.test(String(alias || ""));
}

function classifyLocalLiamSafety(localTts = {}) {
  const source = localTts || {};
  const voice = normaliseVoice(source);
  const summary = {
    ...source,
    voice,
  };

  if (!localTts || typeof localTts !== "object") {
    return {
      code: "unsafe_voice",
      message: "local TTS voice is unknown; refusing non-Liam fallback",
      safe: false,
      voice,
    };
  }

  if (localTts.ready !== true || localTts.ok === false) {
    const failure = classifyLocalTtsHealthFailure(summary);
    return {
      ...failure,
      safe: false,
      voice,
    };
  }

  if (!voice.present) {
    return {
      code: "unsafe_voice",
      message: "local TTS voice is unknown; refusing non-Liam fallback",
      requires_server_reset: false,
      safe: false,
      voice,
    };
  }

  if (!voice.loaded || !voice.refResolved) {
    const failure = classifyLocalTtsHealthFailure(summary);
    return {
      ...failure,
      safe: false,
      voice,
    };
  }

  if (!isLiamAlias(voice.alias)) {
    return {
      code: "unsafe_voice",
      message: `local TTS voice ${voice.alias || voice.voiceId || "unknown"} is not Liam`,
      requires_server_reset: false,
      safe: false,
      voice,
    };
  }

  return {
    code: null,
    message: "local Liam voice is safe",
    requires_server_reset: false,
    safe: true,
    voice,
  };
}

function unsafeVoiceSkip(storyId, safety) {
  return {
    story_id: storyId || null,
    reason: safety.code || "unsafe_voice",
    failure_code: safety.code || "unsafe_voice",
    server_reset_recorded: safety.requires_server_reset === true,
    error: safety.message,
  };
}

module.exports = {
  classifyLocalLiamSafety,
  unsafeVoiceSkip,
};
