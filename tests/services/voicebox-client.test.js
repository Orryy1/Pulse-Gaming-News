"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVoiceboxGenerateStreamRequest,
  isVoiceboxLocalTtsEngine,
  resolveVoiceboxConfig,
  resolveVoiceboxProfileId,
} = require("../../lib/studio/voicebox-client");

test("isVoiceboxLocalTtsEngine only opts in explicit Voicebox local engines", () => {
  assert.equal(isVoiceboxLocalTtsEngine({ LOCAL_TTS_ENGINE: "voicebox" }), true);
  assert.equal(isVoiceboxLocalTtsEngine({ STUDIO_V2_LOCAL_TTS_ENGINE: "VoiceBox" }), true);
  assert.equal(isVoiceboxLocalTtsEngine({ LOCAL_TTS_BACKEND: "voicebox" }), true);
  assert.equal(isVoiceboxLocalTtsEngine({ LOCAL_TTS_ENGINE: "voxcpm2" }), false);
  assert.equal(isVoiceboxLocalTtsEngine({}), false);
});

test("resolveVoiceboxConfig keeps Voicebox local and profile explicit", () => {
  const config = resolveVoiceboxConfig({
    VOICEBOX_BASE_URL: "http://127.0.0.1:17493/",
    VOICEBOX_PROFILE_ID: "profile-123",
    VOICEBOX_LANGUAGE: "en",
    VOICEBOX_TTS_ENGINE: "chatterbox_turbo",
    VOICEBOX_MODEL_SIZE: "1B",
    VOICEBOX_MAX_CHUNK_CHARS: "1200",
    VOICEBOX_CROSSFADE_MS: "80",
    VOICEBOX_NORMALIZE: "false",
  });

  assert.equal(config.baseUrl, "http://127.0.0.1:17493");
  assert.equal(config.profileId, "profile-123");
  assert.equal(config.profileName, null);
  assert.equal(config.language, "en");
  assert.equal(config.engine, "chatterbox_turbo");
  assert.equal(config.modelSize, "1B");
  assert.equal(config.maxChunkChars, 1200);
  assert.equal(config.crossfadeMs, 80);
  assert.equal(config.normalize, false);
  assert.equal(config.callsExternalApis, false);
});

test("buildVoiceboxGenerateStreamRequest omits engine unless explicitly configured", async () => {
  const request = await buildVoiceboxGenerateStreamRequest({
    text: "Pulse Gaming local Voicebox proof.",
    env: {
      VOICEBOX_BASE_URL: "http://localhost:17493",
      VOICEBOX_PROFILE_ID: "profile-abc",
    },
  });

  assert.equal(request.method, "POST");
  assert.equal(request.url, "http://localhost:17493/generate/stream");
  assert.equal(request.responseType, "arraybuffer");
  assert.equal(request.data.profile_id, "profile-abc");
  assert.equal(request.data.text, "Pulse Gaming local Voicebox proof.");
  assert.equal(request.data.language, "en");
  assert.equal(request.data.normalize, true);
  assert.equal(Object.prototype.hasOwnProperty.call(request.data, "engine"), false);
});

test("buildVoiceboxGenerateStreamRequest sends selected engine and model size", async () => {
  const request = await buildVoiceboxGenerateStreamRequest({
    text: "Engine-specific proof.",
    env: {
      VOICEBOX_PROFILE_ID: "profile-abc",
      VOICEBOX_TTS_ENGINE: "qwen",
      VOICEBOX_MODEL_SIZE: "0.6B",
    },
  });

  assert.equal(request.url, "http://127.0.0.1:17493/generate/stream");
  assert.equal(request.data.engine, "qwen");
  assert.equal(request.data.model_size, "0.6B");
});

test("resolveVoiceboxProfileId can resolve a configured profile name locally", async () => {
  let calls = 0;
  const profileId = await resolveVoiceboxProfileId({
    config: {
      baseUrl: "http://127.0.0.1:17493",
      profileId: null,
      profileName: "Pulse Liam",
    },
    request: async (requestConfig) => {
      calls += 1;
      assert.equal(requestConfig.method, "GET");
      assert.equal(requestConfig.url, "http://127.0.0.1:17493/profiles");
      return {
        data: [
          { id: "other", name: "Other" },
          { id: "profile-liam", name: "pulse liam" },
        ],
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(profileId, "profile-liam");
});

test("resolveVoiceboxProfileId fails closed without a local profile", async () => {
  await assert.rejects(
    resolveVoiceboxProfileId({
      config: {
        baseUrl: "http://127.0.0.1:17493",
        profileId: null,
        profileName: null,
      },
      request: async () => ({ data: [] }),
    }),
    /voicebox_profile_missing/,
  );
});
