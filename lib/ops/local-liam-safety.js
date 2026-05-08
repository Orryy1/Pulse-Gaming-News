"use strict";

const path = require("node:path");

const {
  classifyLocalTtsHealthFailure,
} = require("../studio/local-tts-failures");
const {
  resolveAcceptedLocalVoiceReference,
} = require("../studio/v2/local-voice-reference");

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function basenameOrNull(...values) {
  const raw = firstValue(...values);
  if (!raw) return null;
  return path.basename(String(raw).replace(/\\/g, "/"));
}

function normaliseReference(voice = {}, localTts = {}) {
  const accepted =
    localTts.acceptedLocalVoice ||
    localTts.accepted_local_voice ||
    voice.acceptedLocalVoice ||
    voice.accepted_local_voice ||
    {};
  return {
    id: firstValue(
      accepted.id,
      accepted.referenceId,
      accepted.reference_id,
      voice.acceptedReferenceId,
      voice.accepted_reference_id,
      voice.referenceId,
      voice.reference_id,
    ),
    fileName: basenameOrNull(
      accepted.fileName,
      accepted.file_name,
      accepted.referenceFile,
      accepted.reference_file,
      voice.acceptedReferenceFile,
      voice.accepted_reference_file,
      voice.referenceFile,
      voice.reference_file,
      voice.refVoicePath,
      voice.ref_voice_path,
    ),
    referenceHash: firstValue(
      accepted.referenceHash,
      accepted.reference_hash,
      accepted.referenceSha1,
      accepted.reference_sha1,
      voice.referenceHash,
      voice.reference_hash,
      voice.referenceSha1,
      voice.reference_sha1,
    ),
    referencePresent: bool(firstValue(
      accepted.referencePresent,
      accepted.reference_present,
      voice.referencePresent,
      voice.reference_present,
      voice.refResolved,
      voice.ref_resolved,
    )),
  };
}

function normaliseVoice(localTts = {}) {
  const voice = localTts.voice || {};
  const reference = normaliseReference(voice, localTts);
  return {
    alias: voice.alias || null,
    voiceId: voice.voiceId || voice.voice_id || null,
    loaded: bool(voice.loaded),
    refResolved: bool(voice.refResolved ?? voice.ref_resolved),
    present: voice.present === undefined ? Boolean(voice.alias || voice.voiceId || voice.voice_id) : bool(voice.present),
    reference,
  };
}

function isLiamAlias(alias) {
  return /\bliam\b/i.test(String(alias || ""));
}

function classifyAcceptedReference(reference = {}, env = process.env) {
  const accepted = resolveAcceptedLocalVoiceReference(env);
  const expectedHash = accepted.referenceHash || null;
  const expectedFile = accepted.fileName || null;

  if (accepted.referencePresent !== true) {
    return {
      code: "unsafe_voice",
      message: "accepted Sleepy Liam reference file is missing locally",
    };
  }

  if (reference.referencePresent !== true) {
    return {
      code: "unsafe_voice",
      message: "local TTS health did not confirm the accepted Sleepy Liam reference is present",
    };
  }

  if (reference.id !== accepted.id) {
    return {
      code: "unsafe_voice",
      message: `local TTS reference ${reference.id || "unknown"} is not the accepted Sleepy Liam reference`,
    };
  }

  if (!reference.fileName || reference.fileName !== expectedFile) {
    return {
      code: "unsafe_voice",
      message: `local TTS reference file ${reference.fileName || "unknown"} is not ${expectedFile}`,
    };
  }

  if (!reference.referenceHash || !expectedHash) {
    return {
      code: "unsafe_voice",
      message: "local TTS health did not include the accepted Sleepy Liam reference fingerprint",
    };
  }

  if (reference.referenceHash !== expectedHash) {
    return {
      code: "unsafe_voice",
      message: "local TTS reference fingerprint does not match the accepted Sleepy Liam reference",
    };
  }

  return { code: null, message: "accepted Sleepy Liam reference verified" };
}

function classifyLocalLiamSafety(localTts = {}, options = {}) {
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

  const referenceVerdict = classifyAcceptedReference(
    voice.reference,
    options.env || process.env,
  );
  if (referenceVerdict.code) {
    return {
      ...referenceVerdict,
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
