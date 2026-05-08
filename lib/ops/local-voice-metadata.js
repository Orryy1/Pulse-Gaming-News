"use strict";

const fs = require("fs-extra");

const mediaPaths = require("../media-paths");
const {
  resolveAcceptedLocalVoiceReference,
} = require("../studio/v2/local-voice-reference");

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function timestampPathForAudio(audioPath) {
  return String(audioPath || "").replace(/\.(mp3|wav|m4a)$/i, "_timestamps.json");
}

function publicReference(reference = {}) {
  return {
    id: reference.id || null,
    fileName: reference.fileName || null,
    referencePresent: reference.referencePresent === true,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textFromPayload(payload = {}, fallback = "") {
  if (typeof payload.meta?.transcript === "string" && payload.meta.transcript.trim()) {
    return payload.meta.transcript.trim();
  }
  if (typeof payload.meta?.text === "string" && payload.meta.text.trim()) {
    return payload.meta.text.trim();
  }
  if (Array.isArray(payload.characters)) {
    return payload.characters.join("").replace(/\s+/g, " ").trim();
  }
  return String(fallback || "").replace(/\s+/g, " ").trim();
}

function normaliseVoiceDiagnostics(diagnostics = null) {
  if (!diagnostics || typeof diagnostics !== "object") return null;
  const metrics = diagnostics.metrics || diagnostics.acoustic || diagnostics;
  const medianPitchHz = numberOrNull(
    metrics.medianPitchHz ??
      metrics.meanPitchHz ??
      metrics.pitchHz ??
      metrics.f0MedianHz ??
      metrics.median_f0_hz,
  );
  const acoustic = {
    medianPitchHz,
    p10PitchHz: numberOrNull(metrics.p10PitchHz ?? metrics.p10_f0_hz),
    p90PitchHz: numberOrNull(metrics.p90PitchHz ?? metrics.p90_f0_hz),
    centroidHz: numberOrNull(metrics.centroidHz ?? metrics.centroid_hz),
    durationSeconds: numberOrNull(metrics.durationSeconds ?? metrics.duration_s),
  };
  return {
    ...diagnostics,
    metrics,
    acoustic,
  };
}

function acousticFromMeta(meta = {}) {
  if (meta.acoustic && typeof meta.acoustic === "object") {
    return {
      ...meta.acoustic,
      medianPitchHz: numberOrNull(
        meta.acoustic.medianPitchHz ??
          meta.acoustic.meanPitchHz ??
          meta.acoustic.pitchHz ??
          meta.acoustic.f0MedianHz ??
          meta.acoustic.median_f0_hz,
      ),
    };
  }
  const diagnostics = normaliseVoiceDiagnostics(meta.voiceDiagnostics || meta.voice_diagnostics);
  return diagnostics?.acoustic || null;
}

function hasSpokenOutro(transcript) {
  return String(transcript || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .includes("follow pulse gaming so you never miss a beat");
}

async function stampLocalVoiceTimestampMeta({
  outputAudioPath,
  text,
  source = "provided-local-tts-audio",
  provider = "local",
  rate = null,
  env = process.env,
} = {}) {
  const timestampsPath = timestampPathForAudio(outputAudioPath);
  if (!timestampsPath || timestampsPath === outputAudioPath) {
    return { stamped: false, reason: "timestamp_path_unresolvable" };
  }

  const timestampsAbs = mediaPaths.writePath(timestampsPath);
  if (!(await fs.pathExists(timestampsAbs))) {
    return {
      stamped: false,
      reason: "timestamps_missing",
      timestamps_path: timestampsPath,
    };
  }

  const payload = await fs.readJson(timestampsAbs);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      stamped: false,
      reason: "timestamps_unexpected_shape",
      timestamps_path: timestampsPath,
    };
  }

  const acceptedLocalVoice = resolveAcceptedLocalVoiceReference(env);
  const existingMeta = payload.meta || {};
  const diagnostics = normaliseVoiceDiagnostics(
    existingMeta.voiceDiagnostics || existingMeta.voice_diagnostics,
  );
  const acoustic = acousticFromMeta(existingMeta);
  const transcript = textFromPayload(payload, text);
  payload.meta = {
    ...existingMeta,
    provider,
    source,
    approvedLocalVoice: bool(env.STUDIO_V2_LOCAL_VOICE_APPROVED),
    acceptedLocalVoice,
    localVoiceMetadataVersion: 1,
    text: typeof text === "string" ? text : existingMeta.text || null,
    transcript,
    spokenOutroPresent: hasSpokenOutro(transcript),
    acoustic: acoustic || existingMeta.acoustic || null,
    voiceDiagnostics: diagnostics || existingMeta.voiceDiagnostics || null,
    rate,
    stampedAt: new Date().toISOString(),
  };

  await fs.writeJson(timestampsAbs, payload, { spaces: 2 });
  return {
    stamped: true,
    timestamps_path: timestampsPath,
    timestamps_abs: timestampsAbs,
    local_voice_reference: publicReference(acceptedLocalVoice),
    acoustic: payload.meta.acoustic,
    voice_diagnostics: payload.meta.voiceDiagnostics,
    transcript: payload.meta.transcript,
    spoken_outro_present: payload.meta.spokenOutroPresent,
  };
}

module.exports = {
  publicReference,
  normaliseVoiceDiagnostics,
  resolveAcceptedLocalVoiceReference,
  stampLocalVoiceTimestampMeta,
  timestampPathForAudio,
};
