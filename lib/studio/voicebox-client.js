"use strict";

const axios = require("axios");

const DEFAULT_VOICEBOX_BASE_URL = "http://127.0.0.1:17493";

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

function normaliseBaseUrl(value) {
  return String(value || DEFAULT_VOICEBOX_BASE_URL).replace(/\/+$/, "");
}

function finiteInt(value, fallback, min, max) {
  const parsed = Number(value);
  const integer = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.min(max, Math.max(min, integer));
}

function isVoiceboxLocalTtsEngine(env = process.env) {
  const raw = firstNonBlank(
    env.LOCAL_TTS_ENGINE,
    env.STUDIO_V2_LOCAL_TTS_ENGINE,
    env.LOCAL_TTS_BACKEND,
  );
  return /^voicebox$/i.test(String(raw || ""));
}

function resolveVoiceboxConfig(env = process.env) {
  const baseUrl = normaliseBaseUrl(
    firstNonBlank(
      env.VOICEBOX_BASE_URL,
      env.LOCAL_VOICEBOX_URL,
      env.LOCAL_TTS_VOICEBOX_URL,
    ),
  );
  return {
    baseUrl,
    profileId: firstNonBlank(
      env.VOICEBOX_PROFILE_ID,
      env.LOCAL_TTS_VOICEBOX_PROFILE_ID,
      env.STUDIO_V2_VOICEBOX_PROFILE_ID,
    ),
    profileName: firstNonBlank(
      env.VOICEBOX_PROFILE,
      env.VOICEBOX_PROFILE_NAME,
      env.LOCAL_TTS_VOICEBOX_PROFILE,
      env.STUDIO_V2_VOICEBOX_PROFILE,
    ),
    language: firstNonBlank(env.VOICEBOX_LANGUAGE, env.LOCAL_TTS_LANGUAGE) || "en",
    engine: firstNonBlank(env.VOICEBOX_TTS_ENGINE, env.VOICEBOX_ENGINE),
    modelSize: firstNonBlank(env.VOICEBOX_MODEL_SIZE),
    instruct: firstNonBlank(env.VOICEBOX_INSTRUCT),
    personality: truthy(env.VOICEBOX_PERSONALITY),
    maxChunkChars: finiteInt(env.VOICEBOX_MAX_CHUNK_CHARS, 800, 100, 5000),
    crossfadeMs: finiteInt(env.VOICEBOX_CROSSFADE_MS, 50, 0, 500),
    normalize: !/^(false|0|no|off)$/i.test(String(env.VOICEBOX_NORMALIZE || "true")),
    timeoutMs: finiteInt(env.VOICEBOX_TIMEOUT_MS, 300000, 1000, 1800000),
    callsExternalApis: false,
  };
}

function profileRowsFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.profiles)) return data.profiles;
  return [];
}

async function resolveVoiceboxProfileId({
  config = resolveVoiceboxConfig(),
  request = axios,
} = {}) {
  if (config.profileId) return config.profileId;
  if (!config.profileName) {
    throw new Error(
      "voicebox_profile_missing:set VOICEBOX_PROFILE_ID or VOICEBOX_PROFILE_NAME",
    );
  }

  const response = await request({
    method: "GET",
    url: `${normaliseBaseUrl(config.baseUrl)}/profiles`,
    timeout: config.timeoutMs || 30000,
  });
  const wanted = String(config.profileName).trim().toLowerCase();
  const match = profileRowsFromResponse(response.data).find((profile) => {
    const id = String(profile?.id || "").trim().toLowerCase();
    const name = String(profile?.name || "").trim().toLowerCase();
    return id === wanted || name === wanted;
  });
  if (!match?.id) {
    throw new Error(`voicebox_profile_not_found:${config.profileName}`);
  }
  return String(match.id);
}

async function buildVoiceboxGenerateStreamRequest({
  text,
  env = process.env,
  request = axios,
} = {}) {
  const config = resolveVoiceboxConfig(env);
  const profileId = await resolveVoiceboxProfileId({ config, request });
  const data = {
    text,
    profile_id: profileId,
    language: config.language,
    max_chunk_chars: config.maxChunkChars,
    crossfade_ms: config.crossfadeMs,
    normalize: config.normalize,
  };
  if (config.engine) data.engine = config.engine;
  if (config.modelSize) data.model_size = config.modelSize;
  if (config.instruct) data.instruct = config.instruct;
  if (config.personality) data.personality = true;

  return {
    method: "POST",
    url: `${config.baseUrl}/generate/stream`,
    headers: { "Content-Type": "application/json" },
    data,
    responseType: "arraybuffer",
    timeout: config.timeoutMs,
    meta: {
      config,
      profileId,
    },
  };
}

async function requestVoiceboxSpeech({
  text,
  env = process.env,
  request = axios,
} = {}) {
  const requestConfig = await buildVoiceboxGenerateStreamRequest({
    text,
    env,
    request,
  });
  const response = await request(requestConfig);
  return {
    response,
    requestConfig,
    profileId: requestConfig.meta.profileId,
    config: requestConfig.meta.config,
  };
}

module.exports = {
  DEFAULT_VOICEBOX_BASE_URL,
  buildVoiceboxGenerateStreamRequest,
  isVoiceboxLocalTtsEngine,
  requestVoiceboxSpeech,
  resolveVoiceboxConfig,
  resolveVoiceboxProfileId,
};
