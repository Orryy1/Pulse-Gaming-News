"use strict";

const GOOGLE_ORIGIN = "https://generativelanguage.googleapis.com";
const GOOGLE_API_VERSION = "v1beta";
const DEFAULT_GOOGLE_MODEL = "gemini-3.1-pro-preview";
const OLLAMA_ORIGIN = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3.5:27b";
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_OLLAMA_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OLLAMA_TIMEOUT_MS = 600_000;
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 1;
const MIN_GOOGLE_OUTPUT_TOKENS = 1024;
const MAX_OUTPUT_TOKENS = 65_536;
const MAX_REQUEST_ATTEMPTS = 3;
const MAX_ATTEMPT_TIMEOUT_MS = 30_000;
const LONG_OUTPUT_TIMEOUT_MS = 120_000;
const LONG_OUTPUT_MAX_ATTEMPTS = 2;
const LONG_OUTPUT_ATTEMPT_TIMEOUT_MS = 90_000;
const RETRY_BASE_DELAY_MS = 250;
const GOOGLE_MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const OLLAMA_MODEL_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,191}(?::[a-zA-Z0-9][a-zA-Z0-9._-]{0,127})?$/;
const GOOGLE_THINKING_LEVELS = new Set([
  "LOW",
  "MEDIUM",
  "HIGH",
]);

function text(value) {
  return String(value ?? "").trim();
}

function configuredSecret(value) {
  const candidate = text(value);
  return candidate && !/^(?:placeholder|changeme|replace_me)$/i.test(candidate)
    ? candidate
    : "";
}

function boundedInteger(value, fallback, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function ollamaTimeoutMs(value) {
  return boundedInteger(value, DEFAULT_OLLAMA_TIMEOUT_MS, {
    minimum: 1_000,
    maximum: MAX_OLLAMA_TIMEOUT_MS,
  });
}

function nonNegativeFinite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normaliseTextContent(content, field) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    throw new Error(`editorial_${field}_text_required`);
  }
  return content
    .map((block) => {
      if (block?.type !== "text" || typeof block.text !== "string") {
        throw new Error(`editorial_${field}_text_only`);
      }
      return block.text;
    })
    .join("");
}

function responseJsonSchema(value) {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("editorial_response_json_schema_invalid");
  }
  try {
    const clone = JSON.parse(JSON.stringify(value));
    if (
      !clone ||
      typeof clone !== "object" ||
      Array.isArray(clone)
    ) {
      throw new Error("editorial_response_json_schema_invalid");
    }
    return clone;
  } catch {
    throw new Error("editorial_response_json_schema_invalid");
  }
}

function googleRequestBody(input = {}) {
  const maxOutputTokens = boundedInteger(input.max_tokens, 1024, {
    minimum: MIN_GOOGLE_OUTPUT_TOKENS,
    maximum: MAX_OUTPUT_TOKENS,
  });
  const temperature = Number(input.temperature);
  const requestedThinkingLevel = text(
    input.editorial_thinking_level,
  );
  const thinkingLevel = requestedThinkingLevel.toUpperCase();
  const exactResponseJsonSchema = responseJsonSchema(
    input.editorial_response_json_schema,
  );
  if (
    requestedThinkingLevel &&
    !GOOGLE_THINKING_LEVELS.has(thinkingLevel)
  ) {
    throw new Error("editorial_thinking_level_invalid");
  }
  const body = {
    contents: (Array.isArray(input.messages) ? input.messages : []).map(
      (message) => {
        if (!["user", "assistant"].includes(message?.role)) {
          throw new Error("editorial_message_role_unsupported");
        }
        return {
          role: message.role === "assistant" ? "model" : "user",
          parts: [
            {
              text: normaliseTextContent(
                message.content,
                "message_content",
              ),
            },
          ],
        };
      },
    ),
    generationConfig: {
      maxOutputTokens,
      ...(Number.isFinite(temperature)
        ? {
            temperature: Math.min(2, Math.max(0, temperature)),
          }
        : {}),
      ...(thinkingLevel
        ? {
            thinkingConfig: { thinkingLevel },
          }
        : {}),
      responseMimeType: "application/json",
      ...(exactResponseJsonSchema
        ? { responseJsonSchema: exactResponseJsonSchema }
        : {}),
    },
  };
  if (input.system !== undefined && input.system !== null) {
    body.systemInstruction = {
      parts: [
        {
          text: normaliseTextContent(input.system, "system"),
        },
      ],
    };
  }
  if (body.contents.length === 0) {
    throw new Error("editorial_messages_required");
  }
  return body;
}

function ollamaOrigin(value = OLLAMA_ORIGIN) {
  let parsed;
  try {
    parsed = new URL(text(value) || OLLAMA_ORIGIN);
  } catch {
    throw new Error("ollama_editorial_origin_invalid");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("ollama_editorial_origin_forbidden");
  }
  return parsed.origin;
}

function ollamaRequestBody(input = {}, model = DEFAULT_OLLAMA_MODEL) {
  const exactResponseJsonSchema = responseJsonSchema(
    input.editorial_response_json_schema,
  );
  const requestProfile = text(input.editorial_request_profile);
  if (requestProfile && requestProfile !== "long_output") {
    throw new Error("editorial_request_profile_unsupported");
  }
  const messages = [];
  if (input.system !== undefined && input.system !== null) {
    messages.push({
      role: "system",
      content: normaliseTextContent(input.system, "system"),
    });
  }
  for (const message of Array.isArray(input.messages)
    ? input.messages
    : []) {
    if (!["user", "assistant"].includes(message?.role)) {
      throw new Error("editorial_message_role_unsupported");
    }
    messages.push({
      role: message.role,
      content: normaliseTextContent(
        message.content,
        "message_content",
      ),
    });
  }
  if (!messages.some((message) => message.role !== "system")) {
    throw new Error("editorial_messages_required");
  }
  return {
    model,
    messages,
    stream: false,
    format: exactResponseJsonSchema || "json",
    think: false,
    options: {
      temperature: 0,
      num_predict: boundedInteger(input.max_tokens, 1024, {
        minimum: 1,
        maximum: MAX_OUTPUT_TOKENS,
      }),
    },
  };
}

async function readBoundedResponseText(
  response,
  maximumBytes = MAX_RESPONSE_BYTES,
) {
  const declaredLength = Number(
    response?.headers?.get?.("content-length"),
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumBytes
  ) {
    throw new Error("editorial_response_too_large");
  }

  if (typeof response?.body?.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let value = "";
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytesRead += part.value.byteLength;
        if (bytesRead > maximumBytes) {
          await reader.cancel().catch(() => {});
          throw new Error("editorial_response_too_large");
        }
        value += decoder.decode(part.value, { stream: true });
      }
      value += decoder.decode();
      return value;
    } finally {
      reader.releaseLock?.();
    }
  }

  const value = await response.text();
  if (Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error("editorial_response_too_large");
  }
  return value;
}

function safeEditorialError(error) {
  if (
    /^editorial_[a-z0-9_]+$/i.test(String(error?.message || ""))
  ) {
    return error;
  }
  if (error?.name === "AbortError") {
    return new Error("editorial_request_timeout");
  }
  return new Error("editorial_transport_failed");
}

function retryableEditorialError(error) {
  const code = String(error?.message || "");
  if (
    code === "editorial_transport_failed" ||
    code === "editorial_request_timeout"
  ) {
    return true;
  }
  const match = /^editorial_http_status_(\d{3})$/.exec(code);
  if (!match) return false;
  const status = Number(match[1]);
  return status === 429 || (status >= 500 && status <= 599);
}

async function boundedRetryDelay({
  delayMs,
  deadlineAt,
  nowImpl,
  sleepImpl,
}) {
  const remainingMs = deadlineAt - nowImpl();
  if (remainingMs <= delayMs) {
    throw new Error("editorial_request_timeout");
  }
  let timeout = null;
  try {
    await Promise.race([
      Promise.resolve().then(() => sleepImpl(delayMs)),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("editorial_request_timeout")),
          remainingMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedHttpsJsonRequest({
  fetchImpl = globalThis.fetch,
  url,
  options,
  allowedOrigins,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRedirects = MAX_REDIRECTS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("editorial_fetch_unavailable");
  }
  const origins = new Set(allowedOrigins || []);
  const boundedTimeout = boundedInteger(timeoutMs, DEFAULT_TIMEOUT_MS, {
    minimum: 1_000,
    maximum: MAX_TIMEOUT_MS,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout);
  let currentUrl = new URL(url);
  let redirects = 0;
  try {
    while (true) {
      if (
        currentUrl.protocol !== "https:" ||
        !origins.has(currentUrl.origin)
      ) {
        throw new Error("editorial_origin_forbidden");
      }
      let response;
      try {
        response = await fetchImpl(currentUrl.href, {
          ...options,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        throw safeEditorialError(error);
      }
      if ([307, 308].includes(response.status)) {
        if (redirects >= maxRedirects) {
          throw new Error("editorial_redirect_limit_exceeded");
        }
        const location = text(response.headers?.get?.("location"));
        if (!location) {
          throw new Error("editorial_redirect_location_missing");
        }
        currentUrl = new URL(location, currentUrl);
        redirects += 1;
        continue;
      }
      if ([301, 302, 303].includes(response.status)) {
        await response.body?.cancel?.().catch(() => {});
        throw new Error("editorial_redirect_status_forbidden");
      }
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        throw new Error(`editorial_http_status_${response.status}`);
      }
      const responseText = await readBoundedResponseText(
        response,
        maxResponseBytes,
      );
      try {
        return JSON.parse(responseText);
      } catch {
        throw new Error("editorial_response_invalid_json");
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function boundedLoopbackJsonRequest({
  fetchImpl = globalThis.fetch,
  url,
  options,
  allowedOrigin = OLLAMA_ORIGIN,
  timeoutMs = DEFAULT_OLLAMA_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("editorial_fetch_unavailable");
  }
  const exactOrigin = ollamaOrigin(allowedOrigin);
  const boundedTimeout = ollamaTimeoutMs(timeoutMs);
  const currentUrl = new URL(url);
  if (
    currentUrl.protocol !== "http:" ||
    currentUrl.origin !== exactOrigin ||
    currentUrl.pathname !== "/api/chat" ||
    currentUrl.search ||
    currentUrl.hash
  ) {
    throw new Error("editorial_origin_forbidden");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout);
  try {
    let response;
    try {
      response = await fetchImpl(currentUrl.href, {
        ...options,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      throw safeEditorialError(error);
    }
    if (response.status >= 300 && response.status <= 399) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error("editorial_redirect_status_forbidden");
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error(`editorial_http_status_${response.status}`);
    }
    const responseText = await readBoundedResponseText(
      response,
      maxResponseBytes,
    );
    try {
      return JSON.parse(responseText);
    } catch {
      throw new Error("editorial_response_invalid_json");
    }
  } finally {
    clearTimeout(timer);
  }
}

async function requestGoogleJsonWithRetry({
  fetchImpl,
  url,
  options,
  timeoutMs,
  maxAttempts = MAX_REQUEST_ATTEMPTS,
  maxAttemptTimeoutMs = MAX_ATTEMPT_TIMEOUT_MS,
  firstAttemptTimeoutMs = null,
  requestProfile = "default",
  requestAttemptObserver,
  nowImpl = Date.now,
  sleepImpl = (delayMs) =>
    new Promise((resolve) => setTimeout(resolve, delayMs)),
}) {
  const totalTimeoutMs = boundedInteger(timeoutMs, DEFAULT_TIMEOUT_MS, {
    minimum: 1_000,
    maximum: MAX_TIMEOUT_MS,
  });
  const boundedMaxAttempts = boundedInteger(
    maxAttempts,
    MAX_REQUEST_ATTEMPTS,
    {
      minimum: 1,
      maximum: MAX_REQUEST_ATTEMPTS,
    },
  );
  const boundedMaxAttemptTimeoutMs = boundedInteger(
    maxAttemptTimeoutMs,
    MAX_ATTEMPT_TIMEOUT_MS,
    {
      minimum: 1_000,
      maximum: MAX_TIMEOUT_MS,
    },
  );
  const boundedFirstAttemptTimeoutMs =
    firstAttemptTimeoutMs == null
      ? null
      : boundedInteger(
          firstAttemptTimeoutMs,
          boundedMaxAttemptTimeoutMs,
          {
            minimum: 1_000,
            maximum: boundedMaxAttemptTimeoutMs,
          },
        );
  const deadlineAt = nowImpl() + totalTimeoutMs;
  let lastError = null;
  for (
    let attempt = 1;
    attempt <= boundedMaxAttempts;
    attempt += 1
  ) {
    const remainingMs = deadlineAt - nowImpl();
    const attemptsRemaining = boundedMaxAttempts - attempt + 1;
    const futureBackoffMs =
      attemptsRemaining > 1
        ? RETRY_BASE_DELAY_MS *
          (2 ** (boundedMaxAttempts - 1) -
            2 ** (attempt - 1))
        : 0;
    if (remainingMs < 1_000) {
      throw new Error("editorial_request_timeout");
    }
    const usableMs = Math.max(1_000, remainingMs - futureBackoffMs);
    const effectiveAttemptTimeoutMs =
      boundedFirstAttemptTimeoutMs != null && attempt === 1
        ? Math.min(boundedFirstAttemptTimeoutMs, usableMs)
        : Math.min(
            boundedMaxAttemptTimeoutMs,
            Math.max(
              1_000,
              Math.floor(usableMs / attemptsRemaining),
            ),
          );
    try {
      requestAttemptObserver?.({
        attempt,
        max_attempts: boundedMaxAttempts,
        timeout_ms: effectiveAttemptTimeoutMs,
        total_timeout_ms: totalTimeoutMs,
        request_profile: requestProfile,
      });
    } catch {
      // Observability must never change the request outcome.
    }
    try {
      return await boundedHttpsJsonRequest({
        fetchImpl,
        url,
        options,
        allowedOrigins: [GOOGLE_ORIGIN],
        timeoutMs: effectiveAttemptTimeoutMs,
      });
    } catch (error) {
      lastError = safeEditorialError(error);
      if (
        attempt >= boundedMaxAttempts ||
        !retryableEditorialError(lastError)
      ) {
        throw lastError;
      }
      await boundedRetryDelay({
        delayMs: RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        deadlineAt,
        nowImpl,
        sleepImpl,
      });
    }
  }
  throw lastError || new Error("editorial_transport_failed");
}

function googleResponseToMessagesShape(payload, identity) {
  const promptBlockReason = text(payload?.promptFeedback?.blockReason)
    .toUpperCase();
  const promptSafetyBlocked = (
    Array.isArray(payload?.promptFeedback?.safetyRatings)
      ? payload.promptFeedback.safetyRatings
      : []
  ).some((rating) => rating?.blocked === true);
  if (
    promptSafetyBlocked ||
    (promptBlockReason &&
      promptBlockReason !== "BLOCK_REASON_UNSPECIFIED")
  ) {
    throw new Error("editorial_prompt_blocked");
  }
  const firstCandidate = Array.isArray(payload?.candidates)
    ? payload.candidates[0]
    : null;
  const candidateSafetyBlocked = (
    Array.isArray(firstCandidate?.safetyRatings)
      ? firstCandidate.safetyRatings
      : []
  ).some((rating) => rating?.blocked === true);
  if (candidateSafetyBlocked) {
    throw new Error("editorial_candidate_blocked");
  }
  const finishReason = text(firstCandidate?.finishReason).toUpperCase();
  if (finishReason !== "STOP") {
    const safeReason = /^[A-Z0-9_]{1,64}$/.test(finishReason)
      ? finishReason.toLowerCase()
      : finishReason
        ? "unsupported"
        : "missing";
    throw new Error(`editorial_finish_reason_${safeReason}`);
  }
  const outputText = (
    Array.isArray(firstCandidate?.content?.parts)
      ? firstCandidate.content.parts
      : []
  )
    .filter(
      (part) =>
        part?.thought !== true && typeof part?.text === "string",
    )
    .map((part) => part.text)
    .join("")
    .trim();
  if (!outputText) {
    throw new Error("editorial_response_text_missing");
  }
  return {
    id: text(payload?.responseId) || null,
    model: identity.model,
    content: [{ type: "text", text: outputText }],
    stop_reason: text(firstCandidate?.finishReason) || null,
    usage: {
      input_tokens: Number(
        payload?.usageMetadata?.promptTokenCount || 0,
      ),
      output_tokens: Number(
        payload?.usageMetadata?.candidatesTokenCount || 0,
      ),
    },
    editorial_identity: { ...identity },
  };
}

function createGoogleMessagesClient({
  apiKey,
  env = process.env,
  model = DEFAULT_GOOGLE_MODEL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  nowImpl = Date.now,
  sleepImpl,
  requestAttemptObserver,
} = {}) {
  if (
    text(env.PULSE_PAID_AI_ENABLED).toLowerCase() !== "true"
  ) {
    throw new Error("paid_editorial_ai_not_enabled");
  }
  const exactApiKey = configuredSecret(apiKey);
  if (!exactApiKey) {
    throw new Error("google_editorial_api_key_required");
  }
  const exactModel = text(model) || DEFAULT_GOOGLE_MODEL;
  if (!GOOGLE_MODEL_PATTERN.test(exactModel)) {
    throw new Error("google_editorial_model_invalid");
  }
  const identity = Object.freeze({
    provider: "google",
    model: exactModel,
    adapter: "gemini.generateContent",
  });
  const endpoint =
    `${GOOGLE_ORIGIN}/${GOOGLE_API_VERSION}/models/` +
    `${encodeURIComponent(exactModel)}:generateContent`;
  return Object.freeze({
    editorial_identity: identity,
    messages: Object.freeze({
      async create(input) {
        const requestProfile = text(
          input?.editorial_request_profile,
        );
        if (
          requestProfile &&
          requestProfile !== "long_output"
        ) {
          throw new Error(
            "editorial_request_profile_unsupported",
          );
        }
        const longOutput = requestProfile === "long_output";
        const requestBody = JSON.stringify(googleRequestBody(input));
        if (Buffer.byteLength(requestBody, "utf8") > MAX_REQUEST_BYTES) {
          throw new Error("editorial_request_too_large");
        }
        const payload = await requestGoogleJsonWithRetry({
          fetchImpl,
          url: endpoint,
          options: {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              "x-goog-api-key": exactApiKey,
            },
            body: requestBody,
          },
          timeoutMs: longOutput
            ? LONG_OUTPUT_TIMEOUT_MS
            : timeoutMs,
          maxAttempts: longOutput
            ? LONG_OUTPUT_MAX_ATTEMPTS
            : MAX_REQUEST_ATTEMPTS,
          maxAttemptTimeoutMs: longOutput
            ? LONG_OUTPUT_ATTEMPT_TIMEOUT_MS
            : MAX_ATTEMPT_TIMEOUT_MS,
          firstAttemptTimeoutMs: longOutput
            ? LONG_OUTPUT_ATTEMPT_TIMEOUT_MS
            : null,
          requestProfile: requestProfile || "default",
          requestAttemptObserver,
          nowImpl,
          sleepImpl,
        });
        return googleResponseToMessagesShape(payload, identity);
      },
    }),
  });
}

function ollamaResponseToMessagesShape(payload, identity) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("editorial_response_invalid_json");
  }
  if (payload.done !== true) {
    throw new Error("editorial_finish_reason_incomplete");
  }
  const finishReason = text(payload.done_reason).toLowerCase();
  if (finishReason !== "stop") {
    const safeReason = /^[a-z0-9_]{1,64}$/.test(finishReason)
      ? finishReason
      : finishReason
        ? "unsupported"
        : "missing";
    throw new Error(`editorial_finish_reason_${safeReason}`);
  }
  const responseModel = text(payload.model);
  if (responseModel && responseModel !== identity.model) {
    throw new Error("editorial_response_model_mismatch");
  }
  if (payload?.message?.role !== "assistant") {
    throw new Error("editorial_response_role_invalid");
  }
  const outputText =
    typeof payload?.message?.content === "string"
      ? payload.message.content.trim()
      : "";
  if (!outputText) {
    throw new Error("editorial_response_text_missing");
  }
  return {
    id: null,
    model: identity.model,
    content: [{ type: "text", text: outputText }],
    stop_reason: finishReason,
    usage: {
      input_tokens: nonNegativeFinite(payload.prompt_eval_count),
      output_tokens: nonNegativeFinite(payload.eval_count),
    },
    editorial_metrics: {
      total_duration_ns: nonNegativeFinite(payload.total_duration),
      load_duration_ns: nonNegativeFinite(payload.load_duration),
      prompt_eval_duration_ns: nonNegativeFinite(
        payload.prompt_eval_duration,
      ),
      eval_duration_ns: nonNegativeFinite(payload.eval_duration),
    },
    editorial_identity: { ...identity },
  };
}

function createOllamaMessagesClient({
  baseUrl = OLLAMA_ORIGIN,
  model = DEFAULT_OLLAMA_MODEL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_OLLAMA_TIMEOUT_MS,
} = {}) {
  const exactOrigin = ollamaOrigin(baseUrl);
  const exactModel = text(model) || DEFAULT_OLLAMA_MODEL;
  if (!OLLAMA_MODEL_PATTERN.test(exactModel)) {
    throw new Error("ollama_editorial_model_invalid");
  }
  const identity = Object.freeze({
    provider: "ollama",
    model: exactModel,
    adapter: "ollama.api.chat",
  });
  const endpoint = `${exactOrigin}/api/chat`;
  return Object.freeze({
    editorial_identity: identity,
    messages: Object.freeze({
      async create(input) {
        const requestBody = JSON.stringify(
          ollamaRequestBody(input, exactModel),
        );
        if (Buffer.byteLength(requestBody, "utf8") > MAX_REQUEST_BYTES) {
          throw new Error("editorial_request_too_large");
        }
        const payload = await boundedLoopbackJsonRequest({
          fetchImpl,
          url: endpoint,
          options: {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: requestBody,
          },
          allowedOrigin: exactOrigin,
          timeoutMs,
        });
        return ollamaResponseToMessagesShape(payload, identity);
      },
    }),
  });
}

function editorialRuntimeSummary(env = process.env) {
  const provider =
    text(env.PULSE_EDITORIAL_PROVIDER).toLowerCase() || "ollama";
  const paidAiEnabled =
    text(env.PULSE_PAID_AI_ENABLED).toLowerCase() === "true";
  const paidAiBlocked =
    ["google", "anthropic"].includes(provider) && !paidAiEnabled;
  const paidFallbackRequested =
    text(env.PULSE_PAID_EDITORIAL_FALLBACK_ENABLED).toLowerCase() ===
    "true";
  if (provider === "ollama") {
    return {
      provider,
      model: text(env.PULSE_OLLAMA_MODEL) || DEFAULT_OLLAMA_MODEL,
      adapter: "ollama.api.chat",
      local_first: true,
      loopback_only: true,
      request_timeout_ms: ollamaTimeoutMs(
        env.PULSE_OLLAMA_EDITORIAL_TIMEOUT_MS ||
          env.PULSE_EDITORIAL_TIMEOUT_MS,
      ),
      paid_fallback_requested: paidFallbackRequested,
      paid_fallback_active: false,
      paid_ai_enabled: paidAiEnabled,
      paid_ai_blocked: paidAiBlocked,
    };
  }
  if (provider === "google") {
    return {
      provider,
      model:
        text(env.PULSE_GOOGLE_AI_MODEL) ||
        text(env.GOOGLE_AI_MODEL) ||
        DEFAULT_GOOGLE_MODEL,
      adapter: "gemini.generateContent",
      local_first: false,
      loopback_only: false,
      paid_fallback_requested: paidFallbackRequested,
      paid_fallback_active: false,
      paid_ai_enabled: paidAiEnabled,
      paid_ai_blocked: paidAiBlocked,
    };
  }
  if (provider === "anthropic") {
    return {
      provider,
      model: text(env.ANTHROPIC_MODEL) || "request-selected",
      adapter: "messages.create",
      local_first: false,
      loopback_only: false,
      paid_fallback_requested: paidFallbackRequested,
      paid_fallback_active: false,
      paid_ai_enabled: paidAiEnabled,
      paid_ai_blocked: paidAiBlocked,
    };
  }
  return {
    provider: "invalid",
    model: "unresolved",
    adapter: "none",
    local_first: false,
    loopback_only: false,
    paid_fallback_requested: paidFallbackRequested,
    paid_fallback_active: false,
    paid_ai_enabled: paidAiEnabled,
    paid_ai_blocked: paidAiBlocked,
  };
}

function wrapInjectedMessagesClient({
  client,
  defaultModel = "",
  provider = "injected",
} = {}) {
  if (typeof client?.messages?.create !== "function") {
    throw new Error("editorial_messages_client_required");
  }
  const identity = Object.freeze({
    provider: text(provider) || "injected",
    model: text(defaultModel) || "request-selected",
    adapter: "messages.create",
  });
  return Object.freeze({
    editorial_identity: identity,
    messages: Object.freeze({
      async create(input) {
        const response = await client.messages.create(input);
        return {
          ...response,
          editorial_identity: Object.freeze({
            ...identity,
            model: text(input?.model) || identity.model,
          }),
        };
      },
    }),
  });
}

function resolveEditorialMessagesClient({
  env = process.env,
  injectedClient = null,
  injectedProvider = "",
  fetchImpl = globalThis.fetch,
  anthropicFactory = null,
  nowImpl = Date.now,
  sleepImpl,
  requestAttemptObserver,
} = {}) {
  const paidAiEnabled =
    text(env.PULSE_PAID_AI_ENABLED).toLowerCase() === "true";
  if (injectedClient) {
    const injectedIdentityProvider = text(
      injectedClient?.editorial_identity?.provider ||
        injectedProvider,
    ).toLowerCase();
    if (
      ["google", "anthropic"].includes(injectedIdentityProvider) &&
      !paidAiEnabled
    ) {
      throw new Error("paid_editorial_ai_not_enabled");
    }
    if (injectedClient.editorial_identity) return injectedClient;
    if (text(injectedProvider).toLowerCase() === "google") {
      throw new Error("google_editorial_injected_identity_required");
    }
    return wrapInjectedMessagesClient({
      client: injectedClient,
      defaultModel: env.ANTHROPIC_MODEL,
      provider: text(injectedProvider).toLowerCase() || "injected",
    });
  }

  const provider =
    text(env.PULSE_EDITORIAL_PROVIDER).toLowerCase() || "ollama";
  if (provider === "ollama") {
    return createOllamaMessagesClient({
      baseUrl: env.PULSE_OLLAMA_BASE_URL || OLLAMA_ORIGIN,
      model: env.PULSE_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
      fetchImpl,
      timeoutMs:
        env.PULSE_OLLAMA_EDITORIAL_TIMEOUT_MS ||
        env.PULSE_EDITORIAL_TIMEOUT_MS,
    });
  }

  if (provider === "google") {
    if (!paidAiEnabled) {
      throw new Error("paid_editorial_ai_not_enabled");
    }
    const googleApiKey = configuredSecret(env.GOOGLE_AI_API_KEY);
    if (!googleApiKey) {
      throw new Error("google_editorial_api_key_required");
    }
    return createGoogleMessagesClient({
      apiKey: googleApiKey,
      env,
      model:
        env.PULSE_GOOGLE_AI_MODEL ||
        env.GOOGLE_AI_MODEL ||
        DEFAULT_GOOGLE_MODEL,
      fetchImpl,
      timeoutMs: env.PULSE_EDITORIAL_TIMEOUT_MS,
      nowImpl,
      sleepImpl,
      requestAttemptObserver,
    });
  }

  if (provider !== "anthropic") {
    throw new Error("editorial_provider_invalid");
  }
  if (!paidAiEnabled) {
    throw new Error("paid_editorial_ai_not_enabled");
  }
  const anthropicApiKey = configuredSecret(env.ANTHROPIC_API_KEY);
  if (!anthropicApiKey) {
    throw new Error("anthropic_editorial_api_key_required");
  }
  const makeAnthropic =
    anthropicFactory ||
    ((options) => {
      const AnthropicModule = require("@anthropic-ai/sdk");
      const Anthropic = AnthropicModule.default || AnthropicModule;
      return new Anthropic(options);
    });
  return wrapInjectedMessagesClient({
    client: makeAnthropic({ apiKey: anthropicApiKey }),
    defaultModel: env.ANTHROPIC_MODEL,
    provider: "anthropic",
  });
}

function editorialModelFor(client, requestedModel) {
  if (
    ["google", "ollama"].includes(
      client?.editorial_identity?.provider,
    )
  ) {
    return client.editorial_identity.model;
  }
  return text(requestedModel);
}

function editorialIdentityFor(client, requestedModel) {
  const identity = client?.editorial_identity || {};
  return Object.freeze({
    provider: text(identity.provider) || "anthropic",
    model:
      ["google", "ollama"].includes(identity.provider)
        ? text(identity.model)
        : text(requestedModel) ||
          text(identity.model) ||
          "request-selected",
    adapter: text(identity.adapter) || "messages.create",
  });
}

module.exports = {
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_OLLAMA_MODEL,
  GOOGLE_ORIGIN,
  OLLAMA_ORIGIN,
  boundedLoopbackJsonRequest,
  boundedHttpsJsonRequest,
  createGoogleMessagesClient,
  createOllamaMessagesClient,
  editorialIdentityFor,
  editorialModelFor,
  editorialRuntimeSummary,
  resolveEditorialMessagesClient,
};
