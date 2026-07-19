"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const axios = require("axios");
const fs = require("fs-extra");

const audio = require("../audio");
const { getChannel } = require("../channels");
const { masterTtsAudioFile } = require("./audio-quality");
const {
  REQUIRED_POLICY_URLS,
  captureElevenLabsGenerationRightsReceipt,
} = require("./elevenlabs-generation-rights-lineage");

const API_ROOT = "https://api.elevenlabs.io";
const defaultExecFileAsync = promisify(execFile);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeVoiceSettings(value = {}) {
  const allowed = [
    "stability",
    "similarity_boost",
    "style",
    "use_speaker_boost",
    "speed",
    "speaking_rate",
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => value[key] !== undefined && value[key] !== null)
      .map((key) => [key, value[key]]),
  );
}

function responseBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return Buffer.from(value || "");
}

function requestIdFromHeaders(headers = {}) {
  return clean(
    headers["request-id"] ||
      headers["Request-Id"] ||
      headers["x-request-id"] ||
      headers["X-Request-Id"],
  );
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateStrictElevenLabsNarration({
  workspaceRoot = process.cwd(),
  artifactDir,
  storyId,
  assetId = `${storyId}_audio_path`,
  text,
  outputPath,
  voiceId,
  modelId,
  apiKey = process.env.ELEVENLABS_API_KEY,
  requestSettings = {},
  targetPlatforms = [
    "youtube_shorts",
    "instagram_reels",
    "facebook_reels",
  ],
  outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128",
  policyUrls = REQUIRED_POLICY_URLS,
  now = () => new Date(),
  requestImpl = axios,
  masterAudioFile = masterTtsAudioFile,
  execFileAsync = defaultExecFileAsync,
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  policyAttempts = 3,
  policyRetryDelayMs = 500,
  historyAttempts = 6,
  historyRetryDelayMs = 750,
  sleepImpl = sleep,
  captureReceipt = captureElevenLabsGenerationRightsReceipt,
  env = process.env,
} = {}) {
  const root = path.resolve(clean(workspaceRoot) || ".");
  const resolvedArtifactDir = path.resolve(clean(artifactDir) || ".");
  const resolvedOutputPath = path.isAbsolute(clean(outputPath))
    ? path.resolve(outputPath)
    : path.resolve(root, clean(outputPath));
  const selectedText = clean(text);
  const channel = getChannel();
  const selectedVoiceId =
    clean(voiceId) ||
    audio.resolveTtsVoiceIdForProvider("elevenlabs", env, channel);
  const selectedModelId =
    clean(modelId) ||
    audio.resolveTtsModelIdForProvider("elevenlabs", env, channel);
  const selectedApiKey = clean(apiKey);
  if (!clean(artifactDir)) throw new Error("artifact_dir_missing");
  if (!clean(storyId)) throw new Error("story_id_missing");
  if (!selectedText) throw new Error("request_text_missing");
  if (!clean(outputPath)) throw new Error("output_path_missing");
  if (!selectedVoiceId) throw new Error("elevenlabs_voice_id_missing");
  if (!selectedModelId) throw new Error("elevenlabs_model_id_missing");
  if (!selectedApiKey) throw new Error("elevenlabs_api_key_unavailable");
  if (typeof requestImpl !== "function") throw new Error("request_impl_unavailable");

  const voiceSettings = safeVoiceSettings({
    ...(channel.voiceSettings || {}),
    ...requestSettings,
  });
  const requestPayload = audio.buildTtsRequestPayload({
    provider: "elevenlabs",
    text: selectedText,
    resolvedVoiceSettings: voiceSettings,
    outputFormat,
    modelId: selectedModelId,
    seed: audio.resolveTtsSeedForProvider("elevenlabs", env),
    pronunciationDictionaryLocators:
      audio.resolveTtsPronunciationDictionaryLocators("elevenlabs", env),
    env,
  });
  const headers = {
    "xi-api-key": selectedApiKey,
    "Content-Type": "application/json",
    accept: "application/json",
  };
  let providerAlignment = {};

  const requestJson = async (config) => {
    const response = await requestImpl(config);
    if (Number(response?.status || 200) >= 400) {
      throw new Error(`elevenlabs_request_failed:${Number(response.status)}`);
    }
    return response;
  };

  const capture = await captureReceipt({
    artifactDir: resolvedArtifactDir,
    storyId: clean(storyId),
    assetId: clean(assetId),
    modelId: selectedModelId,
    voiceId: selectedVoiceId,
    requestText: selectedText,
    requestSettings: voiceSettings,
    targetPlatforms,
    policyUrls,
    now,
    fetchSubscription: async () =>
      (await requestJson({
        method: "GET",
        url: `${API_ROOT}/v1/user/subscription`,
        headers,
      })).data,
    fetchModelSnapshot: async (expectedModelId) => {
      const response = await requestJson({
        method: "GET",
        url: `${API_ROOT}/v1/models`,
        headers,
      });
      return (Array.isArray(response.data) ? response.data : []).find(
        (entry) => clean(entry?.model_id) === clean(expectedModelId),
      ) || {};
    },
    fetchPolicyDocument: async (url) => {
      let lastError;
      const attempts = Math.max(1, Number(policyAttempts) || 1);
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return responseBytes((await requestJson({
            method: "GET",
            url,
            headers: {
              accept: "text/html,application/xhtml+xml,text/markdown;q=0.9",
              "user-agent": "PulseGamingRightsEvidence/1.0",
            },
            responseType: "arraybuffer",
          })).data);
        } catch (error) {
          lastError = error;
          if (attempt < attempts) {
            await sleepImpl(Math.max(0, Number(policyRetryDelayMs) || 0));
          }
        }
      }
      throw lastError;
    },
    generateAudio: async () => {
      const response = await requestJson({
        method: "POST",
        url: `${API_ROOT}/v1/text-to-speech/${encodeURIComponent(selectedVoiceId)}/with-timestamps`,
        headers,
        params: {
          enable_logging: true,
        },
        data: requestPayload,
        timeout: audio.resolveTtsTimeoutMs("elevenlabs"),
      });
      const rawAudioBytes = Buffer.from(
        clean(response.data?.audio_base64),
        "base64",
      );
      providerAlignment =
        response.data?.alignment ||
        response.data?.normalized_alignment ||
        {};
      return {
        requestId: requestIdFromHeaders(response.headers),
        rawAudioBytes,
      };
    },
    findHistoryItem: async ({ requestId }) => {
      for (let attempt = 1; attempt <= Math.max(1, Number(historyAttempts)); attempt += 1) {
        const response = await requestJson({
          method: "GET",
          url: `${API_ROOT}/v1/history`,
          headers,
          params: {
            page_size: 100,
            source: "TTS",
            voice_id: selectedVoiceId,
          },
        });
        const match = (Array.isArray(response.data?.history)
          ? response.data.history
          : []).find((entry) => clean(entry?.request_id) === clean(requestId));
        if (match) return match;
        if (attempt < Number(historyAttempts)) {
          await sleepImpl(Math.max(0, Number(historyRetryDelayMs)));
        }
      }
      return {};
    },
    downloadHistoryAudio: async ({ historyItemId }) =>
      responseBytes((await requestJson({
        method: "GET",
        url: `${API_ROOT}/v1/history/${encodeURIComponent(historyItemId)}/audio`,
        headers: {
          ...headers,
          accept: "audio/mpeg,application/octet-stream",
        },
        responseType: "arraybuffer",
      })).data),
  });

  if (capture.receipt?.generation_verdict !== "GREEN") {
    const error = new Error(
      `elevenlabs_generation_receipt_not_green:${(
        capture.receipt?.generation_blockers || []
      ).join(",") || "unknown"}`,
    );
    error.receiptPath = capture.receiptPath;
    throw error;
  }
  await fs.ensureDir(path.dirname(resolvedOutputPath));
  await fs.copy(capture.rawAudioPath, resolvedOutputPath, { overwrite: true });
  const mastering = await masterAudioFile({
    inputPath: resolvedOutputPath,
    execFileAsync,
    ffmpegPath,
    env,
    log: null,
  });
  if (mastering?.ok !== true) {
    throw new Error(`elevenlabs_voice_mastering_failed:${clean(mastering?.code) || "unknown"}`);
  }
  const finalAudioBytes = await fs.readFile(resolvedOutputPath);
  const finalAudioSha256 = sha256(finalAudioBytes);
  const timestampPath = resolvedOutputPath.replace(/\.mp3$/i, "_timestamps.json");
  const alignment = {
    ...providerAlignment,
    meta: audio.buildTtsAlignmentMeta({
      existingMeta: providerAlignment.meta || {},
      provider: "elevenlabs",
      voiceId: selectedVoiceId,
      modelId: selectedModelId,
      baseUrl: API_ROOT,
      text: selectedText,
      resolvedVoiceSettings: voiceSettings,
      requestVoiceSettingsSha256: sha256(
        Buffer.from(JSON.stringify(voiceSettings), "utf8"),
      ),
      generatedAudioSha256: finalAudioSha256,
    }),
  };
  alignment.meta.elevenlabsGenerationRights = {
    schemaVersion: 1,
    receiptPath: path
      .relative(resolvedArtifactDir, capture.receiptPath)
      .replace(/\\/g, "/"),
    rawProviderAudioSha256:
      capture.receipt.generation.raw_provider_audio_sha256,
    rawProviderAudioSizeBytes:
      capture.receipt.generation.raw_provider_audio_size_bytes,
    masteredAudioSha256: finalAudioSha256,
    masteredAudioSizeBytes: finalAudioBytes.length,
    requestId: capture.receipt.generation.request_id,
    historyItemId: capture.receipt.generation.history_item_id,
    finalMediaLineageStatus: "PENDING",
  };
  alignment.meta.voiceMastering = mastering;
  await fs.outputJson(timestampPath, alignment, { spaces: 2 });

  capture.receipt.mastering_lineage = {
    raw_provider_audio_sha256:
      capture.receipt.generation.raw_provider_audio_sha256,
    raw_provider_audio_size_bytes:
      capture.receipt.generation.raw_provider_audio_size_bytes,
    mastered_audio_sha256: finalAudioSha256,
    mastered_audio_size_bytes: finalAudioBytes.length,
    transform_status: "COMPLETE",
  };
  await fs.outputJson(capture.receiptPath, capture.receipt, { spaces: 2 });

  return {
    verdict: "AMBER",
    provider: "elevenlabs",
    audioPath: resolvedOutputPath,
    audio_path: resolvedOutputPath,
    audio_sha256: finalAudioSha256,
    audio_size_bytes: finalAudioBytes.length,
    timestampPath,
    timestamp_path: timestampPath,
    receipt: capture.receipt,
    receiptPath: capture.receiptPath,
    receipt_path: capture.receiptPath,
    mastering,
    safety: {
      publishing_triggered: false,
      database_mutated: false,
      oauth_mutated: false,
      token_mutated: false,
      billing_mutated: false,
      secrets_persisted: false,
    },
  };
}

module.exports = {
  generateStrictElevenLabsNarration,
};
