"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { narrationRightsRecord } = require("../../lib/narration-rights-policy");

test("narration rights policy keeps local narration blocked until voice-rights evidence is reconciled", () => {
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
    creator: "Pulse Gaming",
    source_owner: "Pulse Gaming",
    provider_id: "pulse_local_tts",
    provider_name: "Pulse Local TTS",
    licence_basis: "local_tts_voice_rights_evidence_required",
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
    commercial_use_allowed: false,
    transformation_notes: "Narration generated for the governed Pulse Gaming story package.",
    expiry: null,
    credit_required: false,
    evidence_reference: "rights/local-tts-liam.json",
    risk_score: 0.8,
    approval_status: "requires_voice_rights_evidence",
    live_publish_allowed: false,
    requires_human_legal_review_before_publish: true,
  });
});

test("narration rights policy keeps ElevenLabs narration blocked until generation-bound commercial evidence exists", () => {
  const record = narrationRightsRecord({
    storyId: "story with spaces",
    provider: "elevenlabs",
  });

  assert.equal(record.asset_id, "story_with_spaces_audio_path");
  assert.equal(record.source_url, "elevenlabs://pulse-gaming/story_with_spaces");
  assert.equal(record.source_type, "elevenlabs_tts_voice");
  assert.equal(record.creator, "Pulse Gaming via ElevenLabs");
  assert.equal(record.source_owner, "Pulse Gaming");
  assert.equal(record.provider_id, "elevenlabs");
  assert.equal(record.provider_name, "ElevenLabs");
  assert.equal(record.licence_basis, "elevenlabs_commercial_tts_generation");
  assert.equal(record.evidence_reference, "rights/elevenlabs-commercial-tts.json");
  assert.equal(record.commercial_use_allowed, false);
  assert.equal(record.approval_status, "requires_generation_bound_commercial_evidence");
  assert.equal(record.live_publish_allowed, false);
});
