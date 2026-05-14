"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createLlmClient } = require("../../lib/llm-client");

test("local client maps Anthropic-style messages to an OpenAI-compatible endpoint", async () => {
  const requests = [];
  const client = createLlmClient({
    env: {
      LLM_PROVIDER: "local",
      LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
      LOCAL_LLM_MODEL: "gemma3:4b",
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      };
    },
  });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: "Write JSON only.",
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.content[0].text, '{"ok":true}');
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "http://127.0.0.1:11434/v1/chat/completions",
  );
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, "gemma3:4b");
  assert.equal(body.max_tokens, 300);
  assert.deepEqual(body.messages, [
    { role: "system", content: "Write JSON only." },
    { role: "user", content: "Hello" },
  ]);
});

test("local client uses strong local model for former Sonnet/editor calls", async () => {
  let body;
  const client = createLlmClient({
    env: {
      LLM_PROVIDER: "local",
      LOCAL_LLM_MODEL: "gemma3:4b",
      LOCAL_LLM_STRONG_MODEL: "gemma3:12b",
    },
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "done" } }] }),
      };
    },
  });

  await client.messages.create({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "Edit this." }],
  });

  assert.equal(body.model, "gemma3:12b");
});

test("local client throws a clear error when the local endpoint is unavailable", async () => {
  const client = createLlmClient({
    env: { LLM_PROVIDER: "local" },
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });

  await assert.rejects(
    () =>
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "Hello" }],
      }),
    /Local LLM request failed.*ECONNREFUSED/,
  );
});
