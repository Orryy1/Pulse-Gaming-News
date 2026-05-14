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

function skipAnthropicDependentJob(kind, env = process.env) {
  const state = describeAnthropicKeyState(env);
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
  hasUsableAnthropicKey,
  skipAnthropicDependentJob,
};
