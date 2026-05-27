"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  describeAnthropicKeyState,
  describeLlmState,
  hasUsableAnthropicKey,
  skipAnthropicDependentJob,
} = require("../../lib/llm-key");

test("describeAnthropicKeyState treats missing key as unavailable", () => {
  const state = describeAnthropicKeyState({});

  assert.equal(state.ok, false);
  assert.equal(state.state, "missing");
  assert.equal(state.reason, "ANTHROPIC_API_KEY_missing");
  assert.equal(hasUsableAnthropicKey({}), false);
});

test("describeAnthropicKeyState treats placeholder key as unavailable", () => {
  const state = describeAnthropicKeyState({ ANTHROPIC_API_KEY: "placeholder" });

  assert.equal(state.ok, false);
  assert.equal(state.state, "placeholder");
  assert.equal(state.reason, "ANTHROPIC_API_KEY_placeholder");
  assert.equal(hasUsableAnthropicKey({ ANTHROPIC_API_KEY: "placeholder" }), false);
});

test("describeAnthropicKeyState accepts configured keys without exposing them", () => {
  const state = describeAnthropicKeyState({ ANTHROPIC_API_KEY: "sk-ant-test" });

  assert.deepEqual(state, {
    ok: true,
    state: "configured",
    reason: "ANTHROPIC_API_KEY_configured",
  });
});

test("skipAnthropicDependentJob returns a safe skip payload", () => {
  const skipped = skipAnthropicDependentJob("hunt", {
    ANTHROPIC_API_KEY: "placeholder",
  });

  assert.deepEqual(skipped, {
    skipped: "anthropic_key_unavailable",
    kind: "hunt",
    key_state: "placeholder",
    reason: "ANTHROPIC_API_KEY_placeholder",
  });
});

test("skipAnthropicDependentJob returns null for usable key", () => {
  const skipped = skipAnthropicDependentJob("hunt", {
    ANTHROPIC_API_KEY: "sk-ant-test",
  });

  assert.equal(skipped, null);
});

test("describeLlmState accepts local provider without Anthropic key", () => {
  const state = describeLlmState({
    LLM_PROVIDER: "local",
    LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
    LOCAL_LLM_MODEL: "gemma3:4b",
    ANTHROPIC_API_KEY: "placeholder",
  });

  assert.deepEqual(state, {
    ok: true,
    provider: "local",
    state: "configured",
    reason: "LOCAL_LLM_configured",
  });
});

test("skipAnthropicDependentJob allows local LLM provider", () => {
  const skipped = skipAnthropicDependentJob("hunt", {
    LLM_PROVIDER: "local",
    LOCAL_LLM_MODEL: "gemma3:4b",
    ANTHROPIC_API_KEY: "placeholder",
  });

  assert.equal(skipped, null);
});
