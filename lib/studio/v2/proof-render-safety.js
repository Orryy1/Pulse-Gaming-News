"use strict";

const {
  evaluateApprovedVoicePath,
  looksLikeLocalTtsPath,
} = require("./approved-voice-path");

function isApprovedLocalVoice(env = process.env) {
  return env.STUDIO_V2_LOCAL_VOICE_APPROVED === "true";
}

function narrationVoiceBlocker(narration, env = process.env) {
  const provider = String(narration?.provider || "").toLowerCase();
  const source = String(narration?.source || "").toLowerCase();
  const audioPath = String(narration?.audioPath || narration?.path || "").toLowerCase();

  if (provider.includes("silent") || source.includes("silent")) {
    return "silent_fixture_not_pilot_proof";
  }

  const result = evaluateApprovedVoicePath({
    narration,
    env,
    requireExistingAudio: env.STUDIO_V2_SKIP_AUDIO_FILE_CHECK !== "true",
  });
  return result.blockers[0] || (result.verdict === "needs_human_voice_review" ? "voice_needs_human_review" : null);
}

function assertNarrationAllowedForProof(narration, opts = {}) {
  const env = opts.env || process.env;
  const blocker = narrationVoiceBlocker(narration, env);
  if (!blocker) return;
  if (blocker === "silent_fixture_not_pilot_proof" && opts.allowSilentFixture === true) return;
  if (
    (blocker === "unapproved_local_tts_voice_path" ||
      blocker === "local_voice_mastering_missing") &&
    opts.allowLocalVoiceDiagnostic === true
  ) return;
  if (blocker === "voice_needs_human_review" && opts.allowVoiceReviewDiagnostic === true) return;

  if (blocker === "silent_fixture_not_pilot_proof") {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof with silent fixture audio. Use real narration, or pass the explicit visual-only diagnostic option.",
    );
  }

  if (blocker === "audio_path_missing") {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof with a missing narration audio path. Supply real approved narration before rendering.",
    );
  }

  if (blocker === "audio_file_missing") {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof because the narration audio file does not exist. Regenerate or select approved narration first.",
    );
  }

  if (blocker === "audio_file_empty") {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof because the narration audio file is empty.",
    );
  }

  if (blocker === "demonic_low_voice_risk") {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof because the narration pitch profile indicates low-voice/demonic risk.",
    );
  }

  if (blocker === "local_voice_mastering_missing") {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof because the local Liam narration has no mastering proof. Regenerate it with the approved local voice mastering path instead of reusing an old MP3.",
    );
  }

  if (blocker === "local_voice_too_quiet") {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof because the local Liam narration is too quiet after loudness analysis. Regenerate or remaster it before render.",
    );
  }

  if (blocker === "local_tts_tempo_stretch_applied") {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof with mechanically tempo-stretched local TTS. Regenerate the local voice at the intended pace, or render against the original timestamped narration.",
    );
  }

  if (blocker === "local_tts_non_native_rate_applied") {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof with local TTS generated below or above native speed. Regenerate the local voice at rate 1.0 so the audio is clean and the pitch stays natural.",
    );
  }

  if (blocker === "spoken_outro_missing") {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof because the spoken outro is missing.",
    );
  }

  if (blocker === "voice_needs_human_review") {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof because the narration voice is missing pitch or spoken-outro verification.",
    );
  }

  if (
    blocker === "local_tts_voice_reference_unverified" ||
    blocker === "local_tts_voice_reference_mismatch"
  ) {
    throw new Error(
      "Refusing to render a Studio V2 pilot proof because the local narration is not tied to the accepted Sleepy Liam voice reference.",
    );
  }

  throw new Error(
    "Refusing to render a Studio V2 pilot proof with an unapproved local TTS voice path. Use approved production/cached audio or set STUDIO_V2_LOCAL_VOICE_APPROVED=true only after human approval.",
  );
}

module.exports = {
  assertNarrationAllowedForProof,
  looksLikeLocalTtsPath,
  narrationVoiceBlocker,
};
