"use strict";

const FLASH_MIN_SECONDS = 61;
const FLASH_MAX_SECONDS = 75;
const DEFAULT_MIN_MEDIAN_PITCH_HZ = 85;
const DEFAULT_MIN_WPM = 130;
const DEFAULT_MAX_WPM = 220;

function textOf(value) {
  if (!value) return "";
  const parts = [
    value.code,
    value.name,
    value.message,
    ...(Array.isArray(value.reasons) ? value.reasons : []),
  ].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

function classification(code, message, extras = {}) {
  return {
    code,
    message,
    requires_server_reset:
      code === "connection_reset" || code === "server_down" || code === "tts_timeout",
    ...extras,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasSpokenOutro(transcript) {
  return normaliseText(transcript).includes("follow pulse gaming so you never miss a beat");
}

function medianPitchFrom(acoustic = {}) {
  if (!acoustic || typeof acoustic !== "object") return null;
  return numberOrNull(
    acoustic.medianPitchHz ??
      acoustic.meanPitchHz ??
      acoustic.pitchHz ??
      acoustic.f0MedianHz ??
      acoustic.median_f0_hz,
  );
}

function classifyLocalTtsHealthFailure(summary = {}) {
  if (summary?.ok === true) return classification(null, "local TTS is ready");
  const haystack = textOf(summary);
  const status = String(summary?.status || "").toLowerCase();
  const voice = summary?.voice || {};

  if (status === "unreachable") {
    if (/abort|timeout|timed?\s*out|etimedout/.test(haystack)) {
      return classification("health_timeout", "local TTS health check timed out");
    }
    return classification("server_down", "local TTS health endpoint is unreachable");
  }

  if (
    summary?.ready === true &&
    voice.present === true &&
    voice.refResolved === true &&
    voice.loaded !== true
  ) {
    return classification("voice_not_loaded", "accepted local voice is not loaded");
  }

  if (voice.present === true && voice.refResolved !== true) {
    return classification("unsafe_voice", "accepted local voice reference is missing");
  }

  if (
    voice.present === true &&
    (
      voice.reference?.referencePresent === false ||
      /accepted sleepy liam reference|reference fingerprint|reference id mismatch|reference file mismatch/.test(haystack)
    )
  ) {
    return classification("unsafe_voice", "accepted local voice reference is not verified");
  }

  return classification("server_down", (summary?.reasons || []).join("; ") || "local TTS is not ready");
}

function classifyLocalTtsFailure(err) {
  const haystack = textOf(err);
  if (/econnreset|socket hang up|connection reset/.test(haystack)) {
    return classification("connection_reset", "local TTS connection reset during generation");
  }
  if (/abort|timeout|timed?\s*out|etimedout/.test(haystack)) {
    return classification("tts_timeout", "local TTS generation timed out");
  }
  if (/econnrefused|enotfound|server_down|fetch failed/.test(haystack)) {
    return classification("server_down", "local TTS server is not reachable");
  }
  if (/voice.*not.*loaded|not loaded/.test(haystack)) {
    return classification("voice_not_loaded", "accepted local voice is not loaded");
  }
  if (/unsafe voice|unapproved.*voice|reference.*missing/.test(haystack)) {
    return classification("unsafe_voice", "local voice is not approved or reference is missing");
  }
  return classification("tts_failed", String(err?.message || err || "local TTS generation failed"));
}

function classifyLocalTtsProofFailure({
  durationSeconds = null,
  timestampsStamped = true,
  localVoiceReference = null,
  acoustic = null,
  transcript = "",
  wordCount = null,
  wpm = null,
  minSeconds = FLASH_MIN_SECONDS,
  maxSeconds = FLASH_MAX_SECONDS,
  minMedianPitchHz = DEFAULT_MIN_MEDIAN_PITCH_HZ,
  minWpm = DEFAULT_MIN_WPM,
  maxWpm = DEFAULT_MAX_WPM,
} = {}) {
  const hasDuration = durationSeconds !== null && durationSeconds !== undefined && durationSeconds !== "";
  const duration = Number(durationSeconds);
  if (!hasDuration || !Number.isFinite(duration)) {
    return classification("duration_unknown", "local TTS proof duration is unknown");
  }
  if (hasDuration && Number.isFinite(duration) && duration < minSeconds) {
    return classification("duration_too_short", `local TTS proof is ${duration.toFixed(2)}s, below ${minSeconds}s`);
  }
  if (hasDuration && Number.isFinite(duration) && duration > maxSeconds) {
    return classification("duration_too_long", `local TTS proof is ${duration.toFixed(2)}s, above ${maxSeconds}s`);
  }
  if (timestampsStamped === false) {
    return classification("missing_timestamps", "local TTS timestamps are missing or could not be stamped");
  }
  if (localVoiceReference && localVoiceReference.referencePresent !== true) {
    return classification("unsafe_voice", "accepted local voice reference is not present");
  }
  const medianPitchHz = medianPitchFrom(acoustic || {});
  if (medianPitchHz === null) {
    return classification("pitch_profile_unverified", "local TTS proof is missing acoustic pitch diagnostics");
  }
  if (medianPitchHz < minMedianPitchHz) {
    return classification(
      "demonic_low_voice_risk",
      `local TTS median pitch ${medianPitchHz.toFixed(2)}Hz is below ${minMedianPitchHz}Hz`,
    );
  }
  if (!hasSpokenOutro(transcript)) {
    return classification("missing_spoken_outro", "local TTS proof transcript is missing the Pulse outro");
  }
  const suppliedWpm = numberOrNull(wpm);
  const words = numberOrNull(wordCount);
  const measuredWpm = suppliedWpm ?? (words && duration > 0 ? (words / duration) * 60 : null);
  if (measuredWpm === null) {
    return classification("spoken_pace_unverified", "local TTS proof is missing spoken pace evidence");
  }
  if (measuredWpm < minWpm) {
    return classification(
      "spoken_pace_too_slow",
      `local TTS proof pace ${Math.round(measuredWpm)} WPM is below ${minWpm} WPM`,
    );
  }
  if (measuredWpm > maxWpm) {
    return classification(
      "spoken_pace_too_fast",
      `local TTS proof pace ${Math.round(measuredWpm)} WPM is above ${maxWpm} WPM`,
    );
  }
  return classification(null, "local TTS proof passed");
}

module.exports = {
  classifyLocalTtsFailure,
  classifyLocalTtsHealthFailure,
  classifyLocalTtsProofFailure,
};
