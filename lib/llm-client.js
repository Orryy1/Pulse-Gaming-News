"use strict";

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_LOCAL_MODEL = "gemma3:4b";
const DEFAULT_LOCAL_STRONG_MODEL = "gemma3:12b";
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

function normalise(value) {
  return String(value || "").trim();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function resolveRequestTimeoutMs(env = process.env) {
  return positiveInteger(
    env.LLM_REQUEST_TIMEOUT_MS || env.LOCAL_LLM_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
}

function trimTrailingSlash(value) {
  return normalise(value).replace(/\/+$/, "");
}

function resolveProvider(env = process.env) {
  const provider = normalise(env.LLM_PROVIDER || env.AI_PROVIDER).toLowerCase();
  if (provider === "anthropic" || provider === "claude") return "anthropic";
  if (
    provider === "local" ||
    provider === "ollama" ||
    provider === "openai-compatible"
  ) {
    return "local";
  }
  if (
    env.LOCAL_LLM_ENABLED === "true" ||
    env.LOCAL_LLM_BASE_URL ||
    env.LOCAL_LLM_MODEL
  ) {
    return "local";
  }
  return "local";
}

function resolveLocalBaseUrl(env = process.env) {
  return trimTrailingSlash(
    env.LOCAL_LLM_BASE_URL ||
      env.OPENAI_COMPATIBLE_BASE_URL ||
      DEFAULT_LOCAL_BASE_URL,
  );
}

function isStrongRequested(model) {
  return /sonnet|opus|strong|editor/i.test(String(model || ""));
}

function resolveLocalModel(requestedModel, env = process.env) {
  if (isStrongRequested(requestedModel)) {
    return (
      normalise(env.LOCAL_LLM_STRONG_MODEL) ||
      normalise(env.LOCAL_LLM_MODEL) ||
      DEFAULT_LOCAL_STRONG_MODEL
    );
  }
  return normalise(env.LOCAL_LLM_MODEL || env.LLM_MODEL) || DEFAULT_LOCAL_MODEL;
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block.text === "string") return block.text;
        if (block && typeof block.content === "string") return block.content;
        return JSON.stringify(block);
      })
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

function buildOpenAiMessages({ system, messages = [] }) {
  const out = [];
  if (system) out.push({ role: "system", content: contentToText(system) });
  for (const message of messages) {
    out.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: contentToText(message.content),
    });
  }
  return out;
}

function extractOpenAiText(payload) {
  return (
    payload?.choices?.[0]?.message?.content ??
    payload?.choices?.[0]?.text ??
    payload?.message?.content ??
    payload?.response ??
    ""
  );
}

function asAnthropicResponse(text) {
  return {
    content: [
      {
        type: "text",
        text: String(text || ""),
      },
    ],
  };
}

function createLocalMessagesClient({ env, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new Error("No fetch implementation available for local LLM client");
  }

  return {
    create: async (request, options = {}) => {
      const baseUrl = resolveLocalBaseUrl(env);
      const model = resolveLocalModel(request.model, env);
      const timeoutMs = positiveInteger(
        options.timeout || request.timeout,
        resolveRequestTimeoutMs(env),
      );
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const upstreamSignal = options.signal || request.signal;
      const abortFromUpstream = () => controller.abort();
      if (upstreamSignal) {
        if (upstreamSignal.aborted) {
          controller.abort();
        } else {
          upstreamSignal.addEventListener("abort", abortFromUpstream, {
            once: true,
          });
        }
      }
      const headers = { "content-type": "application/json" };
      const apiKey = normalise(env.LOCAL_LLM_API_KEY);
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;

      const body = {
        model,
        messages: buildOpenAiMessages(request),
        stream: false,
      };
      if (request.max_tokens) body.max_tokens = request.max_tokens;
      if (request.temperature != null) body.temperature = request.temperature;

      let response;
      try {
        response = await doFetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        const timedOut = controller.signal.aborted && !upstreamSignal?.aborted;
        const reason = timedOut
          ? `timed out after ${timeoutMs}ms`
          : err.message;
        throw new Error(`Local LLM request failed: ${reason}`);
      } finally {
        clearTimeout(timer);
        if (upstreamSignal) {
          upstreamSignal.removeEventListener("abort", abortFromUpstream);
        }
      }

      if (!response.ok) {
        const detail =
          typeof response.text === "function" ? await response.text() : "";
        throw new Error(
          `Local LLM request failed: HTTP ${response.status || "unknown"} ${detail}`.trim(),
        );
      }

      const payload = await response.json();
      return asAnthropicResponse(extractOpenAiText(payload));
    },
  };
}

function createAnthropicMessagesClient({ env }) {
  const apiKey = normalise(env.ANTHROPIC_API_KEY);
  if (!apiKey || apiKey.toLowerCase() === "placeholder") {
    throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is unavailable");
  }
  const Anthropic = require("@anthropic-ai/sdk");
  const Ctor = Anthropic.default || Anthropic;
  return new Ctor({
    apiKey,
    timeout: resolveRequestTimeoutMs(env),
  }).messages;
}

function createLlmClient(options = {}) {
  const env = options.env || process.env;
  const provider = resolveProvider(env);
  const messages =
    provider === "anthropic"
      ? createAnthropicMessagesClient({ env })
      : createLocalMessagesClient({ env, fetchImpl: options.fetchImpl });
  return { provider, messages };
}

module.exports = {
  createLlmClient,
  resolveRequestTimeoutMs,
  resolveLocalBaseUrl,
  resolveLocalModel,
  resolveProvider,
};
