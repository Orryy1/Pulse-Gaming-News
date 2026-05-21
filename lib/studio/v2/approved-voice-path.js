"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { hasApprovedPulseCta } = require("../../pulse-cta");

const DEFAULT_MIN_MEDIAN_PITCH_HZ = 85;
const DEFAULT_MIN_LOCAL_VOICE_LUFS = -20;
const {
  DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
  resolveAcceptedLocalVoiceReference,
} = require("./local-voice-reference");

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
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
  return hasApprovedPulseCta(transcript);
}

function looksLikeLocalTtsPath(audioPath) {
  const value = String(audioPath || "").toLowerCase().replace(/\\/g, "/");
  return (
    value.includes("/flash-lane-voice-workbench") ||
    value.includes("/local-script-extension/") ||
    value.includes("/local-media-repair/") ||
    value.includes("local_tts") ||
    value.includes("_studio_v1_local") ||
    value.includes("voxcpm") ||
    value.includes("chatterbox") ||
    /\/test\/output\/.*_liam(?:_extended)?\.(mp3|wav|m4a)$/i.test(value)
  );
}

function detectLocalTtsTempoStretch(narration = {}) {
  const generation =
    narration.generation ||
    narration.voiceGeneration ||
    narration.meta?.generation ||
    {};
  const stretch =
    narration.tempoStretch ||
    narration.tempo_stretch ||
    generation.tempo_stretch ||
    generation.tempoStretch ||
    narration.meta?.tempo_stretch ||
    narration.meta?.tempoStretch ||
    {};
  const audioPath = String(narration.audioPath || narration.path || "")
    .toLowerCase()
    .replace(/\\/g, "/");
  const status = String(generation.status || narration.status || "").toLowerCase();
  const source = String(generation.source || narration.source || "").toLowerCase();
  const pathLooksStretched =
    /(?:^|[/_-])stretched(?:[/_-]|$)/.test(audioPath) ||
    /tempo[_-]stretch/.test(audioPath);
  const applied =
    bool(stretch.applied) ||
    status.includes("stretch") ||
    source.includes("stretch") ||
    pathLooksStretched;

  return {
    applied,
    input_duration_s: numberOrNull(stretch.input_duration_s ?? stretch.inputDurationS),
    target_duration_s: numberOrNull(stretch.target_duration_s ?? stretch.targetDurationS),
    output_duration_s: numberOrNull(stretch.output_duration_s ?? stretch.outputDurationS),
    atempo: numberOrNull(stretch.atempo),
    timestamp_scale: numberOrNull(stretch.timestamp_scale ?? stretch.timestampScale),
    source_audio: stretch.source_audio || stretch.sourceAudio || null,
    evidence: applied
      ? {
          metadata: bool(stretch.applied),
          status: status || null,
          source: source || null,
          path: pathLooksStretched,
        }
      : null,
  };
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number !== null) return number;
  }
  return null;
}

function detectLocalTtsNonNativeRate(narration = {}) {
  const meta = narration.meta || {};
  const alignmentMeta =
    narration.alignment?.meta ||
    narration.timestamps?.meta ||
    narration.timestamps?.alignment?.meta ||
    {};
  const generations = [
    narration.generation,
    narration.voiceGeneration,
    meta.generation,
    alignmentMeta.generation,
  ].filter((item) => item && typeof item === "object");
  const diagnostics =
    narration.voiceDiagnostics ||
    meta.voiceDiagnostics ||
    alignmentMeta.voiceDiagnostics ||
    {};
  const diagnosticMetrics = diagnostics.metrics || {};
  const voiceSettings =
    narration.voiceSettings ||
    narration.voice_settings ||
    meta.voiceSettings ||
    meta.voice_settings ||
    alignmentMeta.voiceSettings ||
    alignmentMeta.voice_settings ||
    {};
  const localTts =
    narration.localTts ||
    narration.local_tts ||
    meta.localTts ||
    meta.local_tts ||
    alignmentMeta.localTts ||
    alignmentMeta.local_tts ||
    {};

  const evidence = [];
  for (const generation of generations) {
    evidence.push(
      ["generation.rate", generation.rate],
      ["generation.effective_rate", generation.effective_rate],
      ["generation.effectiveRate", generation.effectiveRate],
      ["generation.speaking_rate", generation.speaking_rate],
      ["generation.speakingRate", generation.speakingRate],
      ["generation.voice_settings.speaking_rate", generation.voice_settings?.speaking_rate],
    );
  }
  evidence.push(
    ["narration.rate", narration.rate],
    ["narration.effective_rate", narration.effective_rate],
    ["narration.effectiveRate", narration.effectiveRate],
    ["narration.speaking_rate", narration.speaking_rate],
    ["narration.speakingRate", narration.speakingRate],
    ["voiceDiagnostics.effective_rate", diagnostics.effective_rate],
    ["voiceDiagnostics.effectiveRate", diagnostics.effectiveRate],
    ["voiceDiagnostics.metrics.effective_rate", diagnosticMetrics.effective_rate],
    ["voiceDiagnostics.metrics.effectiveRate", diagnosticMetrics.effectiveRate],
    ["voiceSettings.speaking_rate", voiceSettings.speaking_rate],
    ["voiceSettings.speakingRate", voiceSettings.speakingRate],
    ["localTts.speakingRate", localTts.speakingRate],
    ["localTts.speaking_rate", localTts.speaking_rate],
  );

  const matched = evidence.find(([, value]) => firstNumber(value) !== null);
  const rate = matched ? firstNumber(matched[1]) : null;
  const nativeRate = 1.0;
  const tolerance = 0.01;
  const delta = rate === null ? null : Math.abs(rate - nativeRate);
  const applied = delta !== null && delta > tolerance;

  return {
    applied,
    rate,
    native_rate: nativeRate,
    tolerance,
    delta,
    evidence: matched
      ? {
          field: matched[0],
          value: matched[1],
        }
      : null,
  };
}

function expectedAcceptedLocalVoiceId(env = process.env) {
  return String(
    env.STUDIO_V2_LOCAL_VOICE_REFERENCE_ID || DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
  ).trim() || DEFAULT_ACCEPTED_LOCAL_VOICE_ID;
}

function localVoiceHumanApproved(narration = {}, env = process.env) {
  return bool(narration.approvedLocalVoice) || bool(env.STUDIO_V2_LOCAL_VOICE_APPROVED);
}

function localVoiceReferenceStatus(narration = {}, env = process.env) {
  const expectedId = expectedAcceptedLocalVoiceId(env);
  const reference =
    narration.acceptedLocalVoice ||
    narration.localVoiceReference ||
    narration.voiceReference ||
    narration.meta?.acceptedLocalVoice ||
    null;
  const id = String(reference?.id || "").trim();
  const referenceHash = String(reference?.referenceHash || reference?.hash || "").trim();
  const referencePresent = reference?.referencePresent === true || Boolean(referenceHash);

  let blocker = null;
  if (!reference || typeof reference !== "object") {
    blocker = "local_tts_voice_reference_unverified";
  } else if (id !== expectedId) {
    blocker = "local_tts_voice_reference_mismatch";
  } else if (!referencePresent || !/^[a-f0-9]{40,64}$/i.test(referenceHash)) {
    blocker = "local_tts_voice_reference_unverified";
  }

  return {
    approved: blocker === null,
    blocker,
    expectedId,
    reference: reference
      ? {
          id: id || null,
          fileName: reference.fileName || null,
          referencePresent,
          referenceHash: referenceHash || null,
        }
      : null,
  };
}

function isLocalVoice(narration = {}) {
  const provider = String(narration.provider || "").toLowerCase();
  const source = String(narration.source || "").toLowerCase();
  const audioPath = String(narration.audioPath || narration.path || "").toLowerCase();
  return (
    provider === "local" ||
    provider === "voxcpm" ||
    provider === "chatterbox" ||
    source.includes("local-production-voxcpm") ||
    source.includes("local-production-chatterbox") ||
    looksLikeLocalTtsPath(audioPath)
  );
}

function isSilentFixture(narration = {}) {
  const provider = String(narration.provider || "").toLowerCase();
  const source = String(narration.source || "").toLowerCase();
  return provider.includes("silent") || source.includes("silent");
}

function approvedLocalVoice(narration = {}, env = process.env) {
  return localVoiceHumanApproved(narration, env) && localVoiceReferenceStatus(narration, env).approved;
}

function fileFacts(audioPath, requireExistingAudio) {
  if (!audioPath) {
    return {
      exists: false,
      size_bytes: 0,
      blocker: "audio_path_missing",
    };
  }
  if (!requireExistingAudio) {
    return {
      exists: null,
      size_bytes: null,
      blocker: null,
    };
  }
  const resolved = path.resolve(audioPath);
  if (!fs.existsSync(resolved)) {
    return {
      exists: false,
      size_bytes: 0,
      blocker: "audio_file_missing",
    };
  }
  const stats = fs.statSync(resolved);
  return {
    exists: true,
    size_bytes: stats.size,
    blocker: stats.size <= 0 ? "audio_file_empty" : null,
  };
}

function evaluateApprovedVoicePath({
  narration = {},
  env = process.env,
  requireExistingAudio = true,
} = {}) {
  const audioPath = narration.audioPath || narration.path || null;
  const blockers = [];
  const warnings = [];
  const localVoice = isLocalVoice(narration);
  const silentFixture = isSilentFixture(narration);
  const localReference = localVoice
    ? localVoiceReferenceStatus(narration, env)
    : null;
  const humanApproved = localVoice
    ? localVoiceHumanApproved(narration, env)
    : null;

  if (silentFixture) blockers.push("silent_fixture_not_pilot_proof");
  if (localVoice && !humanApproved) {
    blockers.push("unapproved_local_tts_voice_path");
  }
  if (localVoice && humanApproved && !localReference.approved) {
    blockers.push(localReference.blocker);
  }

  const tempoStretch = localVoice ? detectLocalTtsTempoStretch(narration) : null;
  if (localVoice && tempoStretch.applied) {
    blockers.push("local_tts_tempo_stretch_applied");
  }
  const nonNativeRate = localVoice ? detectLocalTtsNonNativeRate(narration) : null;
  if (localVoice && nonNativeRate.applied) {
    blockers.push("local_tts_non_native_rate_applied");
  }

  const facts = fileFacts(audioPath, requireExistingAudio);
  if (facts.blocker) blockers.push(facts.blocker);

  const acoustic = narration.acoustic || narration.acousticProfile || {};
  const medianPitchHz = numberOrNull(
    acoustic.medianPitchHz ??
      acoustic.median_f0_hz ??
      acoustic.meanPitchHz ??
      acoustic.mean_f0_hz ??
      acoustic.pitchHz ??
      acoustic.f0MedianHz ??
      acoustic.f0_median_hz,
  );
  const minPitchHz = numberOrNull(env.STUDIO_FLASH_VOICE_MIN_MEDIAN_PITCH_HZ) || DEFAULT_MIN_MEDIAN_PITCH_HZ;
  if (medianPitchHz === null) warnings.push("pitch_profile_unverified");
  else if (medianPitchHz < minPitchHz) blockers.push("demonic_low_voice_risk");

  const voiceMastering = narration.voiceMastering || narration.mastering || {};
  const voiceMasteringOk =
    voiceMastering.ok === true ||
    String(voiceMastering.code || "").toLowerCase() === "voice_mastered";
  if (localVoice && !voiceMasteringOk) {
    blockers.push("local_voice_mastering_missing");
  }
  const integratedLufs = numberOrNull(
    acoustic.integratedLufs ??
      acoustic.integratedLUFS ??
      acoustic.lufs ??
      acoustic.input_i ??
      acoustic.inputI ??
      acoustic.output_i ??
      acoustic.outputI,
  );
  const truePeakDb = numberOrNull(
    acoustic.truePeakDb ??
      acoustic.truePeakDB ??
      acoustic.true_peak_db ??
      acoustic.truePeak ??
      acoustic.input_tp ??
      acoustic.inputTp ??
      acoustic.output_tp ??
      acoustic.outputTp,
  );
  const minLocalVoiceLufs =
    numberOrNull(env.STUDIO_FLASH_VOICE_MIN_LOCAL_LUFS) ??
    DEFAULT_MIN_LOCAL_VOICE_LUFS;
  if (localVoice && integratedLufs !== null && integratedLufs < minLocalVoiceLufs) {
    blockers.push("local_voice_too_quiet");
  }

  const transcript = String(narration.transcript || "");
  if (!transcript.trim()) warnings.push("spoken_outro_unverified");
  else if (!hasSpokenOutro(transcript)) blockers.push("spoken_outro_missing");

  const cleanBlockers = unique(blockers);
  const cleanWarnings = unique(warnings);
  let verdict = "approved_for_studio_v2_proof";
  if (cleanBlockers.length > 0) verdict = "rejected";
  else if (cleanWarnings.length > 0) verdict = "needs_human_voice_review";

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    verdict,
    pilot_allowed: verdict === "approved_for_studio_v2_proof",
    provider: narration.provider || "unknown",
    source: narration.source || "unknown",
    audio_path: audioPath,
    file: facts,
    local_voice: localVoice,
    local_voice_approved: localVoice ? approvedLocalVoice(narration, env) : null,
    local_voice_human_approved: humanApproved,
    local_voice_reference_approved: localReference?.approved ?? null,
    local_voice_reference: localReference?.reference ?? null,
    blockers: cleanBlockers,
    warnings: cleanWarnings,
    acoustic: {
      medianPitchHz,
      minPitchHz,
      integratedLufs,
      truePeakDb,
      minLocalVoiceLufs: localVoice ? minLocalVoiceLufs : null,
    },
    voice_mastering: {
      ok: voiceMasteringOk,
      code: voiceMastering.code || null,
      target_lufs: voiceMastering.targetLufs ?? null,
    },
    tempo_stretch: tempoStretch,
    rate_adjustment: nonNativeRate,
    transcript: {
      present: Boolean(transcript.trim()),
      spoken_outro_present: transcript.trim() ? hasSpokenOutro(transcript) : null,
    },
    safety: {
      local_check_only: true,
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      render_default_changed: false,
    },
  };
}

function approvedVoicePathBlocker(narration, opts = {}) {
  const result = evaluateApprovedVoicePath({
    narration,
    env: opts.env || process.env,
    requireExistingAudio: opts.requireExistingAudio !== false,
  });
  return result.blockers[0] || null;
}

function renderApprovedVoicePathMarkdown(result) {
  const lines = [];
  lines.push("# Approved Voice Path v1");
  lines.push("");
  lines.push(`Generated: ${result.generated_at}`);
  lines.push(`Verdict: ${result.verdict}`);
  lines.push(`Provider: ${result.provider}`);
  lines.push(`Source: ${result.source}`);
  lines.push(`Audio: ${result.audio_path || "missing"}`);
  lines.push(`Blockers: ${result.blockers.join(", ") || "clear"}`);
  lines.push(`Warnings: ${result.warnings.join(", ") || "none"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- No Railway, OAuth, production DB or posting actions are performed.");
  lines.push("- No production voice or renderer defaults are switched.");
  return lines.join("\n") + "\n";
}

module.exports = {
  approvedVoicePathBlocker,
  detectLocalTtsNonNativeRate,
  detectLocalTtsTempoStretch,
  evaluateApprovedVoicePath,
  hasSpokenOutro,
  isLocalVoice,
  localVoiceHumanApproved,
  localVoiceReferenceStatus,
  looksLikeLocalTtsPath,
  resolveAcceptedLocalVoiceReference,
  renderApprovedVoicePathMarkdown,
};
