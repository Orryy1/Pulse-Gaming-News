"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  assertNarrationAllowedForProof,
  narrationVoiceBlocker,
} = require("../../lib/studio/v2/proof-render-safety");

function proofAudioPath(name = "approved.mp3") {
  const dir = path.join(process.cwd(), "test", "output", "tmp-proof-render-safety");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, "fake proof audio bytes");
  return file;
}

test("Studio V2 proof safety blocks unapproved local VoxCPM narration before render", () => {
  const narration = {
    mode: "real_audio",
    provider: "local",
    source: "local-production-voxcpm-path",
    audioPath: proofAudioPath("local-approved.mp3"),
    transcript: "Follow Pulse Gaming so you never miss a beat.",
    acoustic: { medianPitchHz: 118 },
  };

  assert.equal(
    narrationVoiceBlocker(narration, { STUDIO_V2_LOCAL_VOICE_APPROVED: "false" }),
    "unapproved_local_tts_voice_path",
  );
  assert.throws(
    () =>
      assertNarrationAllowedForProof(narration, {
        env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "false" },
      }),
    /unapproved local TTS voice path/i,
  );
});

test("Studio V2 proof safety allows approved local narration only with explicit flag", () => {
  const narration = {
    mode: "real_audio",
    provider: "local",
    source: "local-production-voxcpm-path",
    audioPath: proofAudioPath("local-explicitly-approved.mp3"),
    transcript: "Follow Pulse Gaming so you never miss a beat.",
    acoustic: { medianPitchHz: 118 },
  };

  assert.equal(narrationVoiceBlocker(narration, { STUDIO_V2_LOCAL_VOICE_APPROVED: "true" }), null);
  assert.doesNotThrow(() =>
    assertNarrationAllowedForProof(narration, {
      env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "true" },
    }),
  );
});

test("Studio V2 proof safety blocks silent visual diagnostics unless explicitly allowed", () => {
  const narration = {
    mode: "silent_fixture",
    provider: "silent_fixture",
    source: "silent_visual_proof",
  };

  assert.equal(narrationVoiceBlocker(narration, {}), "silent_fixture_not_pilot_proof");
  assert.throws(
    () => assertNarrationAllowedForProof(narration, { allowSilentFixture: false }),
    /silent fixture/i,
  );
  assert.doesNotThrow(() =>
    assertNarrationAllowedForProof(narration, { allowSilentFixture: true }),
  );
});

test("Studio V2 proof safety allows provided real audio for local proof renders", () => {
  const narration = {
    mode: "real_audio",
    provider: "external",
    source: "provided-real-audio",
    audioPath: proofAudioPath(),
    transcript: "Follow Pulse Gaming so you never miss a beat.",
    acoustic: { medianPitchHz: 118 },
  };

  assert.equal(narrationVoiceBlocker(narration, {}), null);
  assert.doesNotThrow(() => assertNarrationAllowedForProof(narration));
});

test("Studio V2 proof safety blocks missing narration before render", () => {
  assert.equal(
    narrationVoiceBlocker({ mode: "real_audio", provider: "external" }, {}),
    "audio_path_missing",
  );
  assert.throws(
    () => assertNarrationAllowedForProof({ mode: "real_audio", provider: "external" }),
    /missing narration audio path/i,
  );
});

test("Studio V2 proof safety blocks missing narration files before render", () => {
  const narration = {
    mode: "real_audio",
    provider: "external",
    source: "provided-real-audio",
    audioPath: path.join(process.cwd(), "test", "output", "tmp-proof-render-safety", "missing.mp3"),
    transcript: "Follow Pulse Gaming so you never miss a beat.",
    acoustic: { medianPitchHz: 118 },
  };

  assert.equal(narrationVoiceBlocker(narration, {}), "audio_file_missing");
  assert.throws(() => assertNarrationAllowedForProof(narration), /narration audio file does not exist/i);
});

test("Studio V2 proof safety does not let supplied local voice workbench audio masquerade as external audio", () => {
  const narration = {
    mode: "real_audio",
    provider: "external",
    source: "provided-real-audio",
    audioPath:
      "test/output/flash-lane-voice-workbench-pitch210/flash-lane-voice-workbench-assets/fixture_flash_lane_story_voxcpm2_1_9.mp3",
  };

  assert.equal(
    narrationVoiceBlocker(narration, { STUDIO_V2_LOCAL_VOICE_APPROVED: "false" }),
    "unapproved_local_tts_voice_path",
  );
});

test("Studio V2 proof safety allows unapproved local voice only for explicit diagnostics", () => {
  const narration = {
    mode: "real_audio",
    provider: "local",
    source: "provided-local-tts-audio",
    audioPath: proofAudioPath("foo_voxcpm2.mp3"),
    transcript: "Follow Pulse Gaming so you never miss a beat.",
    acoustic: { medianPitchHz: 118 },
  };

  assert.doesNotThrow(() =>
    assertNarrationAllowedForProof(narration, {
      env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "false" },
      allowLocalVoiceDiagnostic: true,
    }),
  );
});
