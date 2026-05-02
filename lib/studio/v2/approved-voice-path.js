"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MIN_MEDIAN_PITCH_HZ = 85;

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
  return normaliseText(transcript).includes("follow pulse gaming so you never miss a beat");
}

function looksLikeLocalTtsPath(audioPath) {
  const value = String(audioPath || "").toLowerCase().replace(/\\/g, "/");
  return (
    value.includes("/flash-lane-voice-workbench") ||
    value.includes("local_tts") ||
    value.includes("_studio_v1_local") ||
    value.includes("voxcpm") ||
    value.includes("chatterbox")
  );
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
  return bool(narration.approvedLocalVoice) || bool(env.STUDIO_V2_LOCAL_VOICE_APPROVED);
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

  if (silentFixture) blockers.push("silent_fixture_not_pilot_proof");
  if (localVoice && !approvedLocalVoice(narration, env)) {
    blockers.push("unapproved_local_tts_voice_path");
  }

  const facts = fileFacts(audioPath, requireExistingAudio);
  if (facts.blocker) blockers.push(facts.blocker);

  const acoustic = narration.acoustic || narration.acousticProfile || {};
  const medianPitchHz = numberOrNull(
    acoustic.medianPitchHz ?? acoustic.meanPitchHz ?? acoustic.pitchHz ?? acoustic.f0MedianHz,
  );
  const minPitchHz = numberOrNull(env.STUDIO_FLASH_VOICE_MIN_MEDIAN_PITCH_HZ) || DEFAULT_MIN_MEDIAN_PITCH_HZ;
  if (medianPitchHz === null) warnings.push("pitch_profile_unverified");
  else if (medianPitchHz < minPitchHz) blockers.push("demonic_low_voice_risk");

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
    blockers: cleanBlockers,
    warnings: cleanWarnings,
    acoustic: {
      medianPitchHz,
      minPitchHz,
    },
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
  evaluateApprovedVoicePath,
  hasSpokenOutro,
  isLocalVoice,
  looksLikeLocalTtsPath,
  renderApprovedVoicePathMarkdown,
};
