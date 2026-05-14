"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  describeAnthropicKeyState,
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
