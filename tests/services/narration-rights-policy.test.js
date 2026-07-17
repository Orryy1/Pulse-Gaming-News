"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { narrationRightsRecord } = require("../../lib/narration-rights-policy");

test("narration rights policy emits a complete commercial-use record for local narration", () => {
  const record = narrationRightsRecord({
    storyId: "fresh-story",
    provider: "local",
    audioPath: "output/audio/fresh-story.mp3",
  });

  assert.deepEqual(record, {
    asset_id: "fresh-story_audio_path",
    asset_type: "narration_audio",
    kind: "audio",
    path: "output/audio/fresh-story.mp3",
    source_url: "local://pulse-local-tts/fresh-story",
    source_type: "local_tts_voice",
    licence_basis: "owned_local_voice_model",
    allowed_use: "short_form_editorial_narration",
    allowed_platforms: [
      "youtube",
      "tiktok",
      "instagram",
      "facebook",
      "x",
      "threads",
      "pinterest",
    ],
    commercial_use_allowed: true,
    transformation_notes: "Narration generated for the governed Pulse Gaming story package.",
    expiry: null,
    credit_required: false,
    evidence_reference: "rights/local-tts-liam.json",
    risk_score: 0.05,
    approval_status: "approved",
  });
});

test("narration rights policy records ElevenLabs provenance without exposing credentials", () => {
  const record = narrationRightsRecord({
    storyId: "story with spaces",
    provider: "elevenlabs",
  });

  assert.equal(record.asset_id, "story_with_spaces_audio_path");
  assert.equal(record.source_url, "elevenlabs://pulse-gaming/story_with_spaces");
  assert.equal(record.source_type, "elevenlabs_tts_voice");
  assert.equal(record.licence_basis, "elevenlabs_commercial_tts_generation");
  assert.equal(record.evidence_reference, "rights/elevenlabs-commercial-tts.json");
  assert.equal(record.commercial_use_allowed, true);
  assert.equal(record.approval_status, "approved");
});
