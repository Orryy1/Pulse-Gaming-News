"use strict";

const {
  approvedVoicePathBlocker,
  looksLikeLocalTtsPath,
} = require("./approved-voice-path");

function isApprovedLocalVoice(env = process.env) {
  return env.STUDIO_V2_LOCAL_VOICE_APPROVED === "true";
}

function narrationVoiceBlocker(
  narration,
  env = process.env,
  { story = null, requireCtaPolicy = true } = {},
) {
  const provider = String(narration?.provider || "").toLowerCase();
  const source = String(narration?.source || "").toLowerCase();
  const audioPath = String(narration?.audioPath || narration?.path || "").toLowerCase();

  if (provider.includes("silent") || source.includes("silent")) {
    return "silent_fixture_not_pilot_proof";
  }

  return approvedVoicePathBlocker(narration, {
    story,
    env,
    requireExistingAudio: env.STUDIO_V2_SKIP_AUDIO_FILE_CHECK !== "true",
    requireCtaPolicy,
  });
}

function assertNarrationAllowedForProof(narration, opts = {}) {
  const env = opts.env || process.env;
  const blocker = narrationVoiceBlocker(narration, env, {
    story: opts.story || null,
    requireCtaPolicy: opts.requireCtaPolicy !== false,
  });
  if (!blocker) return;
  if (blocker === "silent_fixture_not_pilot_proof" && opts.allowSilentFixture === true) return;
  if (blocker === "unapproved_local_tts_voice_path" && opts.allowLocalVoiceDiagnostic === true) return;

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

  if (
    blocker === "pulse_cta_policy_missing" ||
    blocker === "selected_cta_missing" ||
    blocker === "selected_cta_missing_from_full_script" ||
    blocker === "cta_not_selected_for_short" ||
    blocker === "banned_generic_follow_cta" ||
    blocker === "banned_generic_comments_cta"
  ) {
    throw new Error(
      `Refusing to render a Studio V2 pilot proof because narration failed the governed CTA contract: ${blocker}.`,
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
