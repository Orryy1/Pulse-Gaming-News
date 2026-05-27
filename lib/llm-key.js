"use strict";

const PLACEHOLDER_VALUES = new Set(["", "placeholder", "changeme", "todo"]);

function normalise(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function describeAnthropicKeyState(env = process.env) {
  const raw = normalise(env.ANTHROPIC_API_KEY);
  if (!raw) {
    return {
      ok: false,
      state: "missing",
      reason: "ANTHROPIC_API_KEY_missing",
    };
  }
  if (PLACEHOLDER_VALUES.has(raw.toLowerCase())) {
    return {
      ok: false,
      state: "placeholder",
      reason: "ANTHROPIC_API_KEY_placeholder",
    };
  }
  return {
    ok: true,
    state: "configured",
    reason: "ANTHROPIC_API_KEY_configured",
  };
}

function hasUsableAnthropicKey(env = process.env) {
  return describeAnthropicKeyState(env).ok;
}

function normaliseProvider(value) {
  return normalise(value).toLowerCase();
}

function describeLlmState(env = process.env) {
  const provider = normaliseProvider(env.LLM_PROVIDER || env.AI_PROVIDER);
  const hasLocalConfig =
    provider === "local" ||
    provider === "ollama" ||
    provider === "openai-compatible" ||
    env.LOCAL_LLM_ENABLED === "true" ||
    Boolean(normalise(env.LOCAL_LLM_BASE_URL)) ||
    Boolean(normalise(env.LOCAL_LLM_MODEL));

  if (hasLocalConfig) {
    return {
      ok: true,
      provider: "local",
      state: "configured",
      reason: "LOCAL_LLM_configured",
    };
  }

  const anthropic = describeAnthropicKeyState(env);
  if (anthropic.ok) {
    return {
      ok: true,
      provider: "anthropic",
      state: anthropic.state,
      reason: anthropic.reason,
    };
  }

  return {
    ok: false,
    provider: "none",
    state: anthropic.state,
    reason: anthropic.reason,
  };
}

function skipAnthropicDependentJob(kind, env = process.env) {
  const state = describeLlmState(env);
  if (state.ok) return null;
  return {
    skipped: "anthropic_key_unavailable",
    kind,
    key_state: state.state,
    reason: state.reason,
  };
}

module.exports = {
  describeAnthropicKeyState,
  describeLlmState,
  hasUsableAnthropicKey,
  skipAnthropicDependentJob,
};
