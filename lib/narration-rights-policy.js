"use strict";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeId(value) {
  return clean(value)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function narrationRightsRecord({ storyId = "", provider = "local", audioPath = "" } = {}) {
  const id = safeId(storyId) || "story";
  const selectedProvider = clean(provider).toLowerCase();
  const elevenLabs = selectedProvider.includes("elevenlabs");
  return {
    asset_id: `${id}_audio_path`,
    asset_type: "narration_audio",
    kind: "audio",
    path: audioPath || `output/audio/${id}.mp3`,
    source_url: elevenLabs ? `elevenlabs://pulse-gaming/${id}` : `local://pulse-local-tts/${id}`,
    source_type: elevenLabs ? "elevenlabs_tts_voice" : "local_tts_voice",
    creator: elevenLabs ? "Pulse Gaming via ElevenLabs" : "Pulse Gaming",
    source_owner: "Pulse Gaming",
    provider_id: elevenLabs ? "elevenlabs" : "pulse_local_tts",
    provider_name: elevenLabs ? "ElevenLabs" : "Pulse Local TTS",
    licence_basis: elevenLabs
      ? "elevenlabs_commercial_tts_generation"
      : "local_tts_voice_rights_evidence_required",
    allowed_use: "short_form_editorial_narration",
    allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
    commercial_use_allowed: false,
    transformation_notes: "Narration generated for the governed Pulse Gaming story package.",
    expiry: null,
    credit_required: false,
    evidence_reference: elevenLabs ? "rights/elevenlabs-commercial-tts.json" : "rights/local-tts-liam.json",
    risk_score: elevenLabs ? 0.45 : 0.8,
    approval_status: elevenLabs
      ? "requires_generation_bound_commercial_evidence"
      : "requires_voice_rights_evidence",
    live_publish_allowed: false,
    requires_human_legal_review_before_publish: !elevenLabs,
  };
}

module.exports = { narrationRightsRecord };
