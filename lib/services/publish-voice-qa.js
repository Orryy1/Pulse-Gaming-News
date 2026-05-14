"use strict";

const fsExtra = require("fs-extra");

const mediaPaths = require("../media-paths");
const {
  evaluateApprovedVoicePath,
} = require("../studio/v2/approved-voice-path");

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function timestampPathForAudio(audioPath) {
  return String(audioPath || "").replace(/\.(mp3|wav|m4a)$/i, "_timestamps.json");
}

function normaliseText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasRequiredOutro(value) {
  return normaliseText(value)
    .toLowerCase()
    .includes("follow pulse gaming so you never miss a beat");
}

function transcriptFromPayload(payload = {}, fallback = "") {
  const meta = payload.meta || {};
  const candidates = [
    typeof meta.transcript === "string" ? meta.transcript : "",
    typeof meta.text === "string" ? meta.text : "",
    Array.isArray(payload.characters) && payload.characters.length > 0
      ? payload.characters.join("")
      : "",
    fallback,
  ]
    .map(normaliseText)
    .filter(Boolean);

  const withOutro = candidates.find(hasRequiredOutro);
  if (withOutro) return withOutro;

  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}

function acousticFromMeta(meta = {}) {
  if (meta.acoustic && typeof meta.acoustic === "object") return meta.acoustic;
  const diagnostics = meta.voiceDiagnostics || meta.voice_diagnostics || {};
  if (diagnostics.acoustic && typeof diagnostics.acoustic === "object") {
    return diagnostics.acoustic;
  }
  if (diagnostics.metrics && typeof diagnostics.metrics === "object") {
    return diagnostics.metrics;
  }
  return null;
}

function strictVoiceQaEnabled(story = {}, env = process.env) {
  if (bool(env.REQUIRE_APPROVED_VOICE_FOR_PUBLISH)) return true;
  if (String(env.REQUIRE_APPROVED_VOICE_FOR_PUBLISH || "").toLowerCase() === "false") {
    return false;
  }
  return (
    String(env.DEPLOYMENT_MODE || "").toLowerCase() === "local" &&
    bool(env.AUTO_PUBLISH)
  );
}

function shouldInspectVoice(story = {}, env = process.env) {
  return strictVoiceQaEnabled(story, env) || Boolean(story.audio_path || story.audioPath);
}

async function runPublishVoiceQa(story, opts = {}) {
  const fs = opts.fs || fsExtra;
  const env = opts.env || process.env;
  const failures = [];
  const warnings = [];

  if (!story || typeof story !== "object") {
    return { result: "fail", failures: ["approved_voice:no_story"], warnings };
  }

  const strict = strictVoiceQaEnabled(story, env);

  function recordProblem(code) {
    if (strict) failures.push(code);
    else warnings.push(code);
  }

  function problemResult(extra = {}) {
    return {
      result: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
      failures,
      warnings,
      inspected: true,
      strict,
      ...extra,
    };
  }

  if (!shouldInspectVoice(story, env)) {
    return { result: "pass", failures, warnings, inspected: false };
  }

  const audioPath = story.audio_path || story.audioPath || null;
  if (!audioPath) {
    recordProblem("approved_voice:audio_path_missing");
    return problemResult();
  }

  const audioAbs = await mediaPaths.resolveExisting(audioPath, { fs });
  if (!audioAbs || !(await fs.pathExists(audioAbs))) {
    recordProblem("approved_voice:audio_file_missing");
    return problemResult();
  }

  const timestampsPath = timestampPathForAudio(audioPath);
  const timestampsAbs = await mediaPaths.resolveExisting(timestampsPath, { fs });
  if (!timestampsAbs || !(await fs.pathExists(timestampsAbs))) {
    recordProblem("approved_voice:metadata_missing");
    return problemResult();
  }

  let payload;
  try {
    payload = await fs.readJson(timestampsAbs);
  } catch (err) {
    recordProblem(`approved_voice:metadata_unreadable:${err.code || "unknown"}`);
    return problemResult();
  }

  const meta = payload && typeof payload === "object" ? payload.meta || {} : {};
  const provider = String(meta.provider || "").trim();
  const source = String(meta.source || "").trim();
  if (!provider || !source) {
    recordProblem("approved_voice:metadata_missing");
    return problemResult();
  }

  const narration = {
    provider,
    source,
    audioPath: audioAbs,
    transcript: transcriptFromPayload(payload, story.tts_script || story.full_script || ""),
    acoustic: acousticFromMeta(meta),
    voiceMastering:
      meta.voiceMastering ||
      meta.voice_mastering ||
      meta.mastering ||
      null,
    approvedLocalVoice: meta.approvedLocalVoice,
    acceptedLocalVoice:
      meta.acceptedLocalVoice ||
      meta.localVoiceReference ||
      meta.voiceReference ||
      null,
  };

  const approved = evaluateApprovedVoicePath({
    narration,
    env,
    requireExistingAudio: true,
  });

  for (const failure of approved.blockers) {
    recordProblem(`approved_voice:${failure}`);
  }
  warnings.push(...approved.warnings.map((warning) => `approved_voice:${warning}`));

  return {
    result: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures,
    warnings,
    inspected: true,
    strict,
    voice: {
      provider: approved.provider,
      source: approved.source,
      verdict: approved.verdict,
      local_voice: approved.local_voice,
      local_voice_reference_approved: approved.local_voice_reference_approved,
      transcript: approved.transcript,
      acoustic: approved.acoustic,
    },
  };
}

module.exports = {
  runPublishVoiceQa,
  shouldInspectVoice,
  strictVoiceQaEnabled,
  timestampPathForAudio,
};
