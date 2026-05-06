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
  payload.meta = {
    ...(payload.meta || {}),
    provider,
    source,
    approvedLocalVoice: bool(env.STUDIO_V2_LOCAL_VOICE_APPROVED),
    acceptedLocalVoice,
    localVoiceMetadataVersion: 1,
    text: typeof text === "string" ? text : payload.meta?.text || null,
    rate,
    stampedAt: new Date().toISOString(),
  };

  await fs.writeJson(timestampsAbs, payload, { spaces: 2 });
  return {
    stamped: true,
    timestamps_path: timestampsPath,
    timestamps_abs: timestampsAbs,
    local_voice_reference: publicReference(acceptedLocalVoice),
  };
}

module.exports = {
  publicReference,
  resolveAcceptedLocalVoiceReference,
  stampLocalVoiceTimestampMeta,
  timestampPathForAudio,
};
