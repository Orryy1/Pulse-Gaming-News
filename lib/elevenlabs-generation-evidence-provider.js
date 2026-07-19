"use strict";

const crypto = require("node:crypto");

const ELEVENLABS_API_ORIGIN = "https://api.elevenlabs.io";
const SUBSCRIPTION_URL = `${ELEVENLABS_API_ORIGIN}/v1/user/subscription`;
const MODELS_URL = `${ELEVENLABS_API_ORIGIN}/v1/models`;

class ElevenLabsGenerationEvidenceProviderError extends Error {
  constructor(code) {
    super(code);
    this.name = "ElevenLabsGenerationEvidenceProviderError";
    this.code = code;
  }
}

function fail(code) {
  throw new ElevenLabsGenerationEvidenceProviderError(code);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isOfficialElevenLabsUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === "elevenlabs.io" ||
        url.hostname.endsWith(".elevenlabs.io"))
    );
  } catch {
    return false;
  }
}

function responseStatus(response) {
  const status = Number(response?.status ?? response?.statusCode);
  if (Number.isInteger(status)) return status;
  if (response?.ok === true) return 200;
  return 0;
}

function responseData(response) {
  return Object.prototype.hasOwnProperty.call(response || {}, "data")
    ? response.data
    : response?.body;
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") {
    return clean(headers.get(name));
  }
  const target = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === target) return clean(value);
  }
  return "";
}

function toBytes(value, { allowText = false } = {}) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (allowText && typeof value === "string") return Buffer.from(value, "utf8");
  return Buffer.alloc(0);
}

function decodeAudioBase64(value) {
  const encoded = clean(value).replace(/\s+/g, "");
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    fail("tts_raw_audio_missing_or_invalid");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length) fail("tts_raw_audio_missing_or_invalid");
  return bytes;
}

function sanitiseSubscription(value, retrievedAt) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("subscription_response_invalid");
  }
  const tier = clean(value.tier).toLowerCase();
  const status = clean(value.status).toLowerCase();
  if (!tier || !status) fail("subscription_identity_missing");
  return {
    tier,
    status,
    billing_period: clean(value.billing_period).toLowerCase() || null,
    character_refresh_period:
      clean(value.character_refresh_period).toLowerCase() || null,
    paid_plan:
      status === "active" && !["free", "trial"].includes(tier),
    retrieved_at: retrievedAt,
  };
}

function sanitiseModel(value, expectedModelId, retrievedAt) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("model_response_invalid");
  }
  const modelId = clean(value.model_id || value.modelId);
  if (!modelId || modelId !== expectedModelId) fail("model_identity_mismatch");
  return {
    model_id: modelId,
    name: clean(value.name || value.display_name) || null,
    can_do_text_to_speech: value.can_do_text_to_speech === true,
    requires_alpha_access: value.requires_alpha_access === true,
    requires_beta_access:
      value.requires_beta_access === true || value.is_beta === true,
    deprecated:
      value.deprecated === true || value.is_deprecated === true,
    retrieved_at: retrievedAt,
  };
}

function sanitiseHistoryItem(
  value,
  { requestId, voiceId, modelId, text },
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("history_item_missing");
  }
  const historyItemId = clean(value.history_item_id || value.id);
  const historyRequestId = clean(value.request_id);
  const historyVoiceId = clean(value.voice_id);
  const historyModelId = clean(value.model_id);
  const historyText = clean(value.text);
  const dateUnix = Number(value.date_unix ?? value.dateUnix);

  if (!historyItemId) fail("history_item_id_missing");
  if (!historyRequestId) fail("history_request_id_missing");
  if (historyRequestId !== requestId) fail("history_request_id_mismatch");
  if (!historyVoiceId || historyVoiceId !== voiceId) {
    fail("history_voice_id_mismatch");
  }
  if (!historyModelId || historyModelId !== modelId) {
    fail("history_model_id_mismatch");
  }
  if (!historyText || historyText !== text) fail("history_text_mismatch");
  if (!Number.isInteger(dateUnix) || dateUnix <= 0) {
    fail("history_date_unix_missing");
  }

  return {
    history_item_id: historyItemId,
    request_id: historyRequestId,
    date_unix: dateUnix,
    model_id: historyModelId,
    voice_id_sha256: sha256(Buffer.from(historyVoiceId, "utf8")),
    text_sha256: sha256(Buffer.from(historyText, "utf8")),
  };
}

function sanitiseVoiceSettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const key of [
    "stability",
    "similarity_boost",
    "style",
    "use_speaker_boost",
    "speed",
  ]) {
    const entry = value[key];
    if (
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry))
    ) {
      output[key] = entry;
    }
  }
  return output;
}

function sanitiseAlignment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const characters = Array.isArray(value.characters)
    ? value.characters.map((entry) => String(entry))
    : [];
  const starts = Array.isArray(value.character_start_times_seconds)
    ? value.character_start_times_seconds.map(Number)
    : [];
  const ends = Array.isArray(value.character_end_times_seconds)
    ? value.character_end_times_seconds.map(Number)
    : [];
  if (
    !characters.length ||
    starts.length !== characters.length ||
    ends.length !== characters.length ||
    starts.some((entry) => !Number.isFinite(entry)) ||
    ends.some((entry) => !Number.isFinite(entry))
  ) {
    return null;
  }
  return {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

function createElevenLabsGenerationEvidenceProvider({
  httpRequest,
  apiKey,
  now = () => new Date(),
} = {}) {
  if (typeof httpRequest !== "function") fail("http_request_dependency_missing");
  const credential = clean(apiKey);
  if (!credential) fail("elevenlabs_api_key_missing");
  if (typeof now !== "function") fail("clock_dependency_invalid");

  function capturedAt() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) fail("clock_value_invalid");
    return date.toISOString();
  }

  async function requestOfficial({
    method,
    url,
    headers,
    body,
    responseType,
    errorCode,
  }) {
    if (!isOfficialElevenLabsUrl(url)) fail("unofficial_elevenlabs_url");
    let response;
    try {
      response = await httpRequest({
        method,
        url,
        headers,
        ...(body === undefined ? {} : { body }),
        ...(responseType ? { responseType } : {}),
      });
    } catch {
      fail(errorCode);
    }
    const status = responseStatus(response);
    if (status < 200 || status >= 300) fail(`${errorCode}:${status}`);
    if (response?.url && !isOfficialElevenLabsUrl(response.url)) {
      fail("unofficial_elevenlabs_response_url");
    }
    return response;
  }

  function apiHeaders(contentType = null) {
    return {
      accept: "application/json",
      ...(contentType ? { "content-type": contentType } : {}),
      "xi-api-key": credential,
    };
  }

  async function retrieveSubscription() {
    const response = await requestOfficial({
      method: "GET",
      url: SUBSCRIPTION_URL,
      headers: apiHeaders(),
      errorCode: "subscription_request_failed",
    });
    return sanitiseSubscription(responseData(response), capturedAt());
  }

  async function retrieveModel(modelId) {
    const expectedModelId = clean(modelId);
    if (!expectedModelId) fail("model_id_missing");
    const response = await requestOfficial({
      method: "GET",
      url: MODELS_URL,
      headers: apiHeaders(),
      errorCode: "models_request_failed",
    });
    const data = responseData(response);
    const models = Array.isArray(data)
      ? data
      : Array.isArray(data?.models)
        ? data.models
        : [];
    const model = models.find(
      (entry) => clean(entry?.model_id || entry?.modelId) === expectedModelId,
    );
    if (!model) fail("model_identity_not_found");
    return sanitiseModel(model, expectedModelId, capturedAt());
  }

  async function retrievePolicy(urlValue) {
    const url = clean(urlValue);
    if (!isOfficialElevenLabsUrl(url)) fail("unofficial_policy_url");
    const response = await requestOfficial({
      method: "GET",
      url,
      headers: { accept: "text/html" },
      responseType: "arraybuffer",
      errorCode: "policy_request_failed",
    });
    const bytes = toBytes(responseData(response), { allowText: true });
    if (!bytes.length) fail("policy_document_missing");
    return {
      url,
      bytes,
      sha256: sha256(bytes),
      size_bytes: bytes.length,
      retrieved_at: capturedAt(),
    };
  }

  async function generateWithTimestamps({
    voiceId,
    modelId,
    text,
    voiceSettings,
    outputFormat,
  }) {
    const endpoint = new URL(
      `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`,
      ELEVENLABS_API_ORIGIN,
    );
    endpoint.searchParams.set("output_format", outputFormat);
    const response = await requestOfficial({
      method: "POST",
      url: endpoint.toString(),
      headers: apiHeaders("application/json"),
      body: {
        text,
        model_id: modelId,
        voice_settings: sanitiseVoiceSettings(voiceSettings),
      },
      errorCode: "tts_generation_failed",
    });
    const requestId =
      headerValue(response?.headers, "request-id") ||
      headerValue(response?.headers, "x-request-id");
    if (!requestId) fail("tts_request_id_missing");
    const data = responseData(response);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      fail("tts_response_invalid");
    }
    const rawAudioBytes = decodeAudioBase64(data.audio_base64);
    return {
      request_id: requestId,
      raw_audio_bytes: rawAudioBytes,
      alignment: sanitiseAlignment(data.alignment),
      normalized_alignment: sanitiseAlignment(data.normalized_alignment),
    };
  }

  async function retrieveHistoryItem({ requestId, voiceId, modelId, text }) {
    const endpoint = new URL("/v1/history", ELEVENLABS_API_ORIGIN);
    endpoint.searchParams.set("page_size", "100");
    endpoint.searchParams.set("voice_id", voiceId);
    const response = await requestOfficial({
      method: "GET",
      url: endpoint.toString(),
      headers: apiHeaders(),
      errorCode: "history_request_failed",
    });
    const data = responseData(response);
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data?.history)
        ? data.history
        : [];
    const item = items.find(
      (entry) => clean(entry?.request_id) === requestId,
    );
    if (!item) fail("history_request_identity_not_found");
    return sanitiseHistoryItem(item, {
      requestId,
      voiceId,
      modelId,
      text,
    });
  }

  async function retrieveHistoryAudio(historyItemId) {
    const identity = clean(historyItemId);
    if (!identity) fail("history_item_id_missing");
    const url = new URL(
      `/v1/history/${encodeURIComponent(identity)}/audio`,
      ELEVENLABS_API_ORIGIN,
    ).toString();
    const response = await requestOfficial({
      method: "GET",
      url,
      headers: {
        accept: "audio/mpeg,application/octet-stream",
        "xi-api-key": credential,
      },
      responseType: "arraybuffer",
      errorCode: "history_audio_request_failed",
    });
    const bytes = toBytes(responseData(response));
    if (!bytes.length) fail("history_audio_missing");
    return bytes;
  }

  async function captureGeneration({
    voiceId: voiceIdValue,
    modelId: modelIdValue,
    text: textValue,
    voiceSettings = {},
    outputFormat = "mp3_44100_128",
    policyUrls = [],
  } = {}) {
    const voiceId = clean(voiceIdValue);
    const modelId = clean(modelIdValue);
    const text = clean(textValue);
    if (!voiceId) fail("voice_id_missing");
    if (!modelId) fail("model_id_missing");
    if (!text) fail("generation_text_missing");
    if (!clean(outputFormat)) fail("output_format_missing");
    if (!Array.isArray(policyUrls)) fail("policy_urls_invalid");
    if (!policyUrls.length) fail("policy_urls_missing");

    const pre = await retrieveSubscription();
    const model = await retrieveModel(modelId);
    const policies = [];
    for (const policyUrl of policyUrls) {
      policies.push(await retrievePolicy(policyUrl));
    }
    const generation = await generateWithTimestamps({
      voiceId,
      modelId,
      text,
      voiceSettings,
      outputFormat: clean(outputFormat),
    });
    const post = await retrieveSubscription();
    const history = await retrieveHistoryItem({
      requestId: generation.request_id,
      voiceId,
      modelId,
      text,
    });
    const historyAudioBytes = await retrieveHistoryAudio(
      history.history_item_id,
    );
    const rawAudioSha256 = sha256(generation.raw_audio_bytes);
    const historyAudioSha256 = sha256(historyAudioBytes);
    if (
      rawAudioSha256 !== historyAudioSha256 ||
      generation.raw_audio_bytes.length !== historyAudioBytes.length
    ) {
      fail("history_audio_identity_mismatch");
    }

    return {
      provider: "elevenlabs",
      captured_at: capturedAt(),
      request_id: generation.request_id,
      history_item_id: history.history_item_id,
      date_unix: history.date_unix,
      raw_audio_bytes: generation.raw_audio_bytes,
      raw_audio_sha256: rawAudioSha256,
      raw_audio_size_bytes: generation.raw_audio_bytes.length,
      history_audio_bytes: historyAudioBytes,
      history_audio_sha256: historyAudioSha256,
      history_audio_size_bytes: historyAudioBytes.length,
      alignment: generation.alignment,
      normalized_alignment: generation.normalized_alignment,
      subscription: { pre, post },
      model,
      history,
      policies,
      safety: {
        credentials_returned: false,
        authorization_headers_returned: false,
        persisted: false,
        network_transport_injected: true,
        tts_generation_calls: 1,
        read_only_evidence_calls_only: false,
        credit_consuming_generation: true,
        provider_account_mutated: false,
      },
    };
  }

  return Object.freeze({
    captureGeneration,
    generateWithTimestamps,
    retrieveHistoryAudio,
    retrieveHistoryItem,
    retrieveModel,
    retrievePolicy,
    retrieveSubscription,
  });
}

module.exports = {
  ELEVENLABS_API_ORIGIN,
  ElevenLabsGenerationEvidenceProviderError,
  createElevenLabsGenerationEvidenceProvider,
  isOfficialElevenLabsUrl,
};
