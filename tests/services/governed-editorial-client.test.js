"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  DEFAULT_OLLAMA_MODEL,
  boundedLoopbackJsonRequest,
  createGoogleMessagesClient,
  editorialIdentityFor,
  editorialModelFor,
  editorialRuntimeSummary,
  resolveEditorialMessagesClient,
} = require("../../lib/services/governed-editorial-client");
const { generateTitleVariants } = require("../../ab_titles");
const {
  createAnthropicEvergreenDiscoveryJsonGenerator,
} = require("../../lib/services/evergreen-autonomous-discovery");
const {
  createAnthropicEvergreenJsonGenerator,
} = require("../../lib/services/evergreen-verdict-pitch-enrichment");
const {
  createAnthropicWeeklyLongformJsonGenerator,
} = require("../../lib/services/weekly-longform-editorial-enrichment");
const {
  createAnthropicBreakingClaimExtractor,
} = require("../../lib/services/breaking-source-adapters");
const {
  buildBreakingEventEnvelope,
} = require("../../lib/services/breaking-event-ingress");
const { handlers } = require("../../lib/job-handlers");
const {
  buildEffectiveConfigReport,
} = require("../../lib/stabilisation/runtime-config");

test("explicit Ollama routing ignores configured paid-provider credentials and uses the governed local chat contract", async () => {
  const calls = [];
  let anthropicFactoryCalls = 0;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["GREEN"] },
    },
    required: ["verdict"],
  };
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "ollama",
      PULSE_PAID_EDITORIAL_FALLBACK_ENABLED: "false",
      GOOGLE_AI_API_KEY: "must-not-be-used-google",
      ANTHROPIC_API_KEY: "must-not-be-used-anthropic",
    },
    anthropicFactory() {
      anthropicFactoryCalls += 1;
      throw new Error("paid provider must not be constructed");
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify({
          model: DEFAULT_OLLAMA_MODEL,
          created_at: "2026-07-28T09:00:00.000Z",
          message: {
            role: "assistant",
            content: '{"verdict":"GREEN"}',
          },
          done: true,
          done_reason: "stop",
          total_duration: 1_200_000_000,
          load_duration: 100_000_000,
          prompt_eval_count: 42,
          prompt_eval_duration: 200_000_000,
          eval_count: 8,
          eval_duration: 900_000_000,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const response = await client.messages.create({
    model: "a paid model name that must be ignored",
    max_tokens: 400,
    temperature: 1,
    system: "Return JSON only.",
    editorial_response_json_schema: schema,
    messages: [{ role: "user", content: "Assess this story." }],
  });

  assert.equal(anthropicFactoryCalls, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:11434/api/chat");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: DEFAULT_OLLAMA_MODEL,
    messages: [
      { role: "system", content: "Return JSON only." },
      { role: "user", content: "Assess this story." },
    ],
    stream: false,
    format: schema,
    think: false,
    options: {
      temperature: 0,
      num_predict: 400,
    },
  });
  assert.deepEqual(response.content, [
    { type: "text", text: '{"verdict":"GREEN"}' },
  ]);
  assert.deepEqual(response.usage, {
    input_tokens: 42,
    output_tokens: 8,
  });
  assert.deepEqual(response.editorial_identity, {
    provider: "ollama",
    model: DEFAULT_OLLAMA_MODEL,
    adapter: "ollama.api.chat",
  });
});

test("governed editorial generation is local-first when no provider is selected", () => {
  let anthropicFactoryCalls = 0;
  const client = resolveEditorialMessagesClient({
    env: {
      GOOGLE_AI_API_KEY: "configured-but-unselected-google",
      ANTHROPIC_API_KEY: "configured-but-unselected-anthropic",
    },
    anthropicFactory() {
      anthropicFactoryCalls += 1;
      throw new Error("paid provider must not be constructed");
    },
    fetchImpl: async () => {
      throw new Error("no request is needed for provider resolution");
    },
  });

  assert.deepEqual(client.editorial_identity, {
    provider: "ollama",
    model: DEFAULT_OLLAMA_MODEL,
    adapter: "ollama.api.chat",
  });
  assert.equal(anthropicFactoryCalls, 0);
});

test("Ollama base URLs are restricted to literal loopback HTTP origins before any request", () => {
  let fetchCalls = 0;
  const forbiddenOrigins = [
    "https://127.0.0.1:11434",
    "http://localhost:11434",
    "http://169.254.169.254:11434",
    "http://127.0.0.1:11434/proxy",
    "http://user:password@127.0.0.1:11434",
  ];

  for (const baseUrl of forbiddenOrigins) {
    assert.throws(
      () =>
        resolveEditorialMessagesClient({
          env: {
            PULSE_EDITORIAL_PROVIDER: "ollama",
            PULSE_OLLAMA_BASE_URL: baseUrl,
          },
          fetchImpl: async () => {
            fetchCalls += 1;
            throw new Error("fetch must not run");
          },
        }),
      /ollama_editorial_origin_forbidden/,
    );
  }
  assert.equal(fetchCalls, 0);
});

test("Ollama refuses redirects instead of forwarding a governed request", async () => {
  const client = resolveEditorialMessagesClient({
    env: { PULSE_EDITORIAL_PROVIDER: "ollama" },
    fetchImpl: async () =>
      new Response("", {
        status: 307,
        headers: {
          location: "http://127.0.0.1:11435/collect",
        },
      }),
  });

  await assert.rejects(
    client.messages.create({
      messages: [{ role: "user", content: "Return JSON." }],
    }),
    /editorial_redirect_status_forbidden/,
  );
});

test("Ollama failures never trigger an unapproved paid-provider fallback", async () => {
  const requestedUrls = [];
  let anthropicFactoryCalls = 0;
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "ollama",
      PULSE_PAID_EDITORIAL_FALLBACK_ENABLED: "false",
      GOOGLE_AI_API_KEY: "configured-but-forbidden-google",
      ANTHROPIC_API_KEY: "configured-but-forbidden-anthropic",
    },
    anthropicFactory() {
      anthropicFactoryCalls += 1;
      throw new Error("paid provider must not be constructed");
    },
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return new Response("local model unavailable", {
        status: 503,
      });
    },
  });

  await assert.rejects(
    client.messages.create({
      messages: [{ role: "user", content: "Return JSON." }],
    }),
    /editorial_http_status_503/,
  );
  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1:11434/api/chat",
  ]);
  assert.equal(anthropicFactoryCalls, 0);
});

test("Ollama usage provenance normalises invalid or negative provider counters to zero", async () => {
  const client = resolveEditorialMessagesClient({
    env: { PULSE_EDITORIAL_PROVIDER: "ollama" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          model: DEFAULT_OLLAMA_MODEL,
          message: {
            role: "assistant",
            content: '{"ok":true}',
          },
          done: true,
          done_reason: "stop",
          prompt_eval_count: "not-a-number",
          eval_count: -12,
          total_duration: null,
          load_duration: -1,
          prompt_eval_duration: "invalid",
          eval_duration: 10,
        }),
        { status: 200 },
      ),
  });

  const response = await client.messages.create({
    messages: [{ role: "user", content: "Return JSON." }],
  });

  assert.deepEqual(response.usage, {
    input_tokens: 0,
    output_tokens: 0,
  });
  assert.deepEqual(response.editorial_metrics, {
    total_duration_ns: 0,
    load_duration_ns: 0,
    prompt_eval_duration_ns: 0,
    eval_duration_ns: 10,
  });
});

test("unrecognised editorial providers fail closed before paid clients are constructed", () => {
  let anthropicFactoryCalls = 0;
  assert.throws(
    () =>
      resolveEditorialMessagesClient({
        env: {
          PULSE_EDITORIAL_PROVIDER: "auto-paid",
          GOOGLE_AI_API_KEY: "configured-google",
          ANTHROPIC_API_KEY: "configured-anthropic",
        },
        anthropicFactory() {
          anthropicFactoryCalls += 1;
          throw new Error("must not construct");
        },
      }),
    /editorial_provider_invalid/,
  );
  assert.equal(anthropicFactoryCalls, 0);
});

test("editorial runtime observability exposes cost-control state without credentials or local endpoints", () => {
  const secret = "never-expose-paid-provider-secret";
  const local = editorialRuntimeSummary({
    GOOGLE_AI_API_KEY: secret,
    ANTHROPIC_API_KEY: secret,
    PULSE_PAID_EDITORIAL_FALLBACK_ENABLED: "false",
  });
  const paid = editorialRuntimeSummary({
    PULSE_EDITORIAL_PROVIDER: "google",
    PULSE_PAID_AI_ENABLED: "true",
    PULSE_GOOGLE_AI_MODEL: "gemini-attended-test",
    GOOGLE_AI_API_KEY: secret,
    PULSE_PAID_EDITORIAL_FALLBACK_ENABLED: "true",
  });
  const blocked = editorialRuntimeSummary({
    PULSE_EDITORIAL_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: secret,
    PULSE_PAID_AI_ENABLED: "false",
  });

  assert.deepEqual(local, {
    provider: "ollama",
    model: DEFAULT_OLLAMA_MODEL,
    adapter: "ollama.api.chat",
    local_first: true,
    loopback_only: true,
    request_timeout_ms: 300_000,
    paid_fallback_requested: false,
    paid_fallback_active: false,
    paid_ai_enabled: false,
    paid_ai_blocked: false,
  });
  assert.deepEqual(paid, {
    provider: "google",
    model: "gemini-attended-test",
    adapter: "gemini.generateContent",
    local_first: false,
    loopback_only: false,
    paid_fallback_requested: true,
    paid_fallback_active: false,
    paid_ai_enabled: true,
    paid_ai_blocked: false,
  });
  assert.deepEqual(blocked, {
    provider: "anthropic",
    model: "request-selected",
    adapter: "messages.create",
    local_first: false,
    loopback_only: false,
    paid_fallback_requested: false,
    paid_fallback_active: false,
    paid_ai_enabled: false,
    paid_ai_blocked: true,
  });
  assert.doesNotMatch(
    JSON.stringify({ local, paid, blocked }),
    new RegExp(secret),
  );
  assert.doesNotMatch(
    JSON.stringify({ local, paid, blocked }),
    /127\.0\.0\.1/,
  );
});

test("Ollama editorial timeouts are configurable but remain hard-capped at ten minutes", () => {
  const configured = editorialRuntimeSummary({
    PULSE_EDITORIAL_PROVIDER: "ollama",
    PULSE_OLLAMA_EDITORIAL_TIMEOUT_MS: "450000",
  });
  const capped = editorialRuntimeSummary({
    PULSE_EDITORIAL_PROVIDER: "ollama",
    PULSE_OLLAMA_EDITORIAL_TIMEOUT_MS: "900000",
  });
  const invalid = editorialRuntimeSummary({
    PULSE_EDITORIAL_PROVIDER: "ollama",
    PULSE_OLLAMA_EDITORIAL_TIMEOUT_MS: "not-a-timeout",
  });

  assert.equal(configured.request_timeout_ms, 450_000);
  assert.equal(capped.request_timeout_ms, 600_000);
  assert.equal(invalid.request_timeout_ms, 300_000);
});

test("the governed Ollama transport applies the five-minute default and ten-minute hard cap", async (t) => {
  const scheduledTimeouts = [];
  t.mock.method(
    globalThis,
    "setTimeout",
    (_callback, timeoutMs) => {
      scheduledTimeouts.push(timeoutMs);
      return Symbol("governed-ollama-timeout");
    },
  );
  t.mock.method(globalThis, "clearTimeout", () => {});
  const fetchImpl = async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 });
  const request = {
    fetchImpl,
    url: "http://127.0.0.1:11434/api/chat",
    options: { method: "POST" },
  };

  await boundedLoopbackJsonRequest(request);
  await boundedLoopbackJsonRequest({
    ...request,
    timeoutMs: 900_000,
  });

  assert.deepEqual(scheduledTimeouts, [300_000, 600_000]);
});

test("Ollama model selection and generator provenance cannot inherit stale paid-model names", () => {
  const client = resolveEditorialMessagesClient({
    env: { PULSE_EDITORIAL_PROVIDER: "ollama" },
  });
  const requestedPaidModel = "claude-haiku-4-5-20251001";

  assert.equal(
    editorialModelFor(client, requestedPaidModel),
    DEFAULT_OLLAMA_MODEL,
  );
  assert.deepEqual(
    editorialIdentityFor(client, requestedPaidModel),
    {
      provider: "ollama",
      model: DEFAULT_OLLAMA_MODEL,
      adapter: "ollama.api.chat",
    },
  );
  for (const factory of [
    createAnthropicEvergreenDiscoveryJsonGenerator,
    createAnthropicEvergreenJsonGenerator,
    createAnthropicWeeklyLongformJsonGenerator,
  ]) {
    assert.deepEqual(
      factory({
        client,
        model: editorialModelFor(client, requestedPaidModel),
      }).identity,
      {
        provider: "ollama",
        model: DEFAULT_OLLAMA_MODEL,
        adapter: "ollama.api.chat",
      },
    );
  }
});

test("paid editorial providers require an explicit paid-AI opt-in before construction or injected use", () => {
  let anthropicFactoryCalls = 0;
  let fetchCalls = 0;
  for (const paidEnv of [
    {
      PULSE_EDITORIAL_PROVIDER: "google",
      GOOGLE_AI_API_KEY: "configured-google",
    },
    {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "false",
      GOOGLE_AI_API_KEY: "configured-google",
    },
    {
      PULSE_EDITORIAL_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "configured-anthropic",
    },
    {
      PULSE_EDITORIAL_PROVIDER: "anthropic",
      PULSE_PAID_AI_ENABLED: "false",
      ANTHROPIC_API_KEY: "configured-anthropic",
    },
  ]) {
    assert.throws(
      () =>
        resolveEditorialMessagesClient({
          env: paidEnv,
          anthropicFactory() {
            anthropicFactoryCalls += 1;
            throw new Error("must not construct paid client");
          },
          fetchImpl: async () => {
            fetchCalls += 1;
            throw new Error("must not call paid provider");
          },
        }),
      /paid_editorial_ai_not_enabled/,
    );
  }
  assert.throws(
    () =>
      createGoogleMessagesClient({
        apiKey: "direct-google-secret",
        env: {},
      }),
    /paid_editorial_ai_not_enabled/,
  );
  assert.throws(
    () =>
      resolveEditorialMessagesClient({
        env: {},
        injectedClient: {
          editorial_identity: {
            provider: "google",
            model: "paid-injected-model",
            adapter: "injected",
          },
          messages: { async create() {} },
        },
      }),
    /paid_editorial_ai_not_enabled/,
  );
  assert.throws(
    () =>
      resolveEditorialMessagesClient({
        env: {},
        injectedProvider: "anthropic",
        injectedClient: {
          messages: { async create() {} },
        },
      }),
    /paid_editorial_ai_not_enabled/,
  );
  assert.equal(anthropicFactoryCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("Google Gemini is selected first and exposed through the messages.create contract", async () => {
  const calls = [];
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-secret-for-test",
      ANTHROPIC_API_KEY: "anthropic-secret-for-test",
      GOOGLE_AI_MODEL: "gemini-3.1-pro-preview",
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"verdict":"GREEN"}' }],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 7,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  assert.equal(client.editorial_identity.provider, "google");
  assert.equal(
    client.editorial_identity.model,
    "gemini-3.1-pro-preview",
  );

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    temperature: 0,
    system: "Return JSON only.",
    messages: [{ role: "user", content: "Assess this story." }],
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent",
  );
  assert.equal(
    calls[0].options.headers["x-goog-api-key"],
    "google-secret-for-test",
  );
  assert.doesNotMatch(calls[0].url, /google-secret-for-test/);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    systemInstruction: {
      parts: [{ text: "Return JSON only." }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: "Assess this story." }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0,
      responseMimeType: "application/json",
    },
  });
  assert.deepEqual(response.content, [
    { type: "text", text: '{"verdict":"GREEN"}' },
  ]);
  assert.deepEqual(response.usage, {
    input_tokens: 12,
    output_tokens: 7,
  });
  assert.deepEqual(response.editorial_identity, {
    provider: "google",
    model: "gemini-3.1-pro-preview",
    adapter: "gemini.generateContent",
  });
});

test("Gemini output budgets retain the governed upper bound", async () => {
  let requestedBudget = null;
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-max-budget-test",
    },
    fetchImpl: async (_url, options) => {
      requestedBudget = JSON.parse(
        options.body,
      ).generationConfig.maxOutputTokens;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: '{"ok":true}' }] },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  await client.messages.create({
    max_tokens: Number.MAX_SAFE_INTEGER,
    messages: [{ role: "user", content: "Return JSON." }],
  });

  assert.equal(requestedBudget, 65_536);
});

test("Gemini maps an allowlisted governed thinking level to thinkingConfig", async () => {
  let requestBody = null;
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-thinking-level-test",
    },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: '{"ok":true}' }] },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  await client.messages.create({
    editorial_thinking_level: "medium",
    max_tokens: 16_384,
    messages: [{ role: "user", content: "Return JSON." }],
  });

  assert.deepEqual(
    requestBody.generationConfig.thinkingConfig,
    { thinkingLevel: "MEDIUM" },
  );
});

test("Gemini forwards a governed JSON Schema into structured-output generation", async () => {
  let requestBody = null;
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-structured-output-test",
    },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"editorial_frame":{"episode_title":"Verified"}}',
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200 },
      );
    },
  });
  const responseJsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      editorial_frame: {
        type: "object",
        properties: {
          episode_title: { type: "string" },
        },
        required: ["episode_title"],
      },
    },
    required: ["editorial_frame"],
  };

  await client.messages.create({
    editorial_response_json_schema: responseJsonSchema,
    max_tokens: 16_384,
    messages: [{ role: "user", content: "Return JSON." }],
  });

  assert.deepEqual(
    requestBody.generationConfig.responseJsonSchema,
    responseJsonSchema,
  );
});

test("Gemini rejects a non-object structured-output schema before fetch", async () => {
  let fetchCalls = 0;
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-invalid-schema-test",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch must not run");
    },
  });

  await assert.rejects(
    client.messages.create({
      editorial_response_json_schema: ["not", "a", "schema"],
      messages: [{ role: "user", content: "Return JSON." }],
    }),
    (error) => {
      assert.equal(
        error.message,
        "editorial_response_json_schema_invalid",
      );
      return true;
    },
  );
  assert.equal(fetchCalls, 0);
});

test("Gemini counts the structured-output schema against the governed request-size limit", async () => {
  let fetchCalls = 0;
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-schema-size-test",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch must not run");
    },
  });

  await assert.rejects(
    client.messages.create({
      editorial_response_json_schema: {
        type: "object",
        description: "x".repeat(513 * 1024),
      },
      messages: [{ role: "user", content: "Return JSON." }],
    }),
    (error) => {
      assert.equal(error.message, "editorial_request_too_large");
      return true;
    },
  );
  assert.equal(fetchCalls, 0);
});

test("Gemini rejects every thinking level outside the governed allowlist before fetch", async () => {
  let fetchCalls = 0;
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-invalid-thinking-test",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch must not run");
    },
  });

  await assert.rejects(
    client.messages.create({
      editorial_thinking_level: "maximum",
      max_tokens: 16_384,
      messages: [{ role: "user", content: "Return JSON." }],
    }),
    (error) => {
      assert.equal(
        error.message,
        "editorial_thinking_level_invalid",
      );
      return true;
    },
  );
  assert.equal(fetchCalls, 0);
});

test("Gemini rejects partial output when generation did not finish with STOP", async () => {
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-partial-output-test",
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"partial":true}' }],
              },
              finishReason: "MAX_TOKENS",
            },
          ],
        }),
        { status: 200 },
      ),
  });

  await assert.rejects(
    client.messages.create({
      max_tokens: 150,
      messages: [{ role: "user", content: "Return JSON." }],
    }),
    /editorial_finish_reason_max_tokens/,
  );
});

test("Gemini rejects prompt and candidate safety blocks even when text is present", async (t) => {
  const input = {
    max_tokens: 150,
    messages: [{ role: "user", content: "Return JSON." }],
  };

  await t.test("prompt block", async () => {
    const client = resolveEditorialMessagesClient({
      env: {
        PULSE_EDITORIAL_PROVIDER: "google",
        PULSE_PAID_AI_ENABLED: "true",
        GOOGLE_AI_API_KEY: "google-prompt-block-test",
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            promptFeedback: { blockReason: "SAFETY" },
            candidates: [
              {
                content: {
                  parts: [{ text: '{"unsafe":"partial"}' }],
                },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200 },
        ),
    });
    await assert.rejects(
      client.messages.create(input),
      /editorial_prompt_blocked/,
    );
  });

  await t.test("candidate block", async () => {
    const client = resolveEditorialMessagesClient({
      env: {
        PULSE_EDITORIAL_PROVIDER: "google",
        PULSE_PAID_AI_ENABLED: "true",
        GOOGLE_AI_API_KEY: "google-candidate-block-test",
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: '{"unsafe":"partial"}' }],
                },
                finishReason: "STOP",
                safetyRatings: [{ blocked: true }],
              },
            ],
          }),
          { status: 200 },
        ),
    });
    await assert.rejects(
      client.messages.create(input),
      /editorial_candidate_blocked/,
    );
  });
});

test("Gemini retries bounded transient HTTP and network failures without exposing credentials", async () => {
  const secret = "google-retry-secret";
  const delays = [];
  const attempts = [];
  let calls = 0;
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: secret,
      PULSE_EDITORIAL_TIMEOUT_MS: "5000",
    },
    sleepImpl: async (delayMs) => {
      delays.push(delayMs);
    },
    requestAttemptObserver(value) {
      attempts.push(value);
    },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(`rate limit for ${secret}`, {
          status: 429,
        });
      }
      if (calls === 2) {
        throw new Error(`socket reset near ${secret}`);
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"recovered":true}' }],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  const response = await client.messages.create({
    max_tokens: 150,
    messages: [{ role: "user", content: "Return JSON." }],
  });

  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
  assert.equal(attempts.length, 3);
  assert.ok(
    attempts.every(
      (attempt) =>
        attempt.max_attempts === 3 &&
        attempt.timeout_ms <= 30_000 &&
        attempt.total_timeout_ms === 5_000 &&
        attempt.request_profile === "default",
    ),
  );
  assert.equal(response.content[0].text, '{"recovered":true}');
  assert.doesNotMatch(JSON.stringify(response), new RegExp(secret));
});

test("Gemini long-output requests get one 90-second generation attempt plus one bounded retry", async () => {
  let nowMs = 0;
  let calls = 0;
  const attempts = [];
  const delays = [];
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-long-output-test",
    },
    nowImpl: () => nowMs,
    requestAttemptObserver(value) {
      attempts.push(value);
    },
    sleepImpl: async (delayMs) => {
      delays.push(delayMs);
      nowMs += delayMs;
    },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        nowMs += 90_000;
        return new Response("temporary provider failure", {
          status: 503,
        });
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"recovered":true}' }],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  const response = await client.messages.create({
    editorial_request_profile: "long_output",
    max_tokens: 6_144,
    messages: [{ role: "user", content: "Return long JSON." }],
  });

  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
  assert.deepEqual(attempts, [
    {
      attempt: 1,
      max_attempts: 2,
      timeout_ms: 90_000,
      total_timeout_ms: 120_000,
      request_profile: "long_output",
    },
    {
      attempt: 2,
      max_attempts: 2,
      timeout_ms: 29_750,
      total_timeout_ms: 120_000,
      request_profile: "long_output",
    },
  ]);
  assert.equal(response.content[0].text, '{"recovered":true}');
});

test("Gemini stops after three transient attempts and returns a secret-safe error", async () => {
  const secret = "google-exhausted-retry-secret";
  let calls = 0;
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: secret,
      PULSE_EDITORIAL_TIMEOUT_MS: "5000",
    },
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return new Response(`upstream failure mentioning ${secret}`, {
        status: 503,
      });
    },
  });

  await assert.rejects(
    client.messages.create({
      max_tokens: 150,
      messages: [{ role: "user", content: "Return JSON." }],
    }),
    (error) => {
      assert.equal(error.message, "editorial_http_status_503");
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
  assert.equal(calls, 3);
});

test("Anthropic remains available through an explicit attended provider selection", async () => {
  const calls = [];
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "anthropic",
      PULSE_PAID_AI_ENABLED: "true",
      ANTHROPIC_API_KEY: "anthropic-secret-for-test",
      ANTHROPIC_MODEL: "claude-fallback-test",
    },
    anthropicFactory(options) {
      assert.deepEqual(options, {
        apiKey: "anthropic-secret-for-test",
      });
      return {
        messages: {
          async create(input) {
            calls.push(input);
            return {
              content: [{ type: "text", text: '{"ok":true}' }],
            };
          },
        },
      };
    },
  });

  const response = await client.messages.create({
    model: "claude-sonnet-test",
    max_tokens: 100,
    messages: [{ role: "user", content: "test" }],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "claude-sonnet-test");
  assert.deepEqual(response.editorial_identity, {
    provider: "anthropic",
    model: "claude-sonnet-test",
    adapter: "messages.create",
  });
});

test("generic injected clients are not falsely labelled Anthropic while explicit Anthropic injections retain their identity", async () => {
  const injectedClient = {
    messages: {
      async create() {
        return {
          content: [{ type: "text", text: '{"ok":true}' }],
        };
      },
    },
  };
  const generic = resolveEditorialMessagesClient({
    env: {},
    injectedClient,
  });
  const anthropic = resolveEditorialMessagesClient({
    env: { PULSE_PAID_AI_ENABLED: "true" },
    injectedClient,
    injectedProvider: "anthropic",
  });

  assert.deepEqual(generic.editorial_identity, {
    provider: "injected",
    model: "request-selected",
    adapter: "messages.create",
  });
  assert.deepEqual(anthropic.editorial_identity, {
    provider: "anthropic",
    model: "request-selected",
    adapter: "messages.create",
  });
  const genericResponse = await generic.messages.create({
    model: "custom-editorial-model",
    messages: [{ role: "user", content: "test" }],
  });
  assert.deepEqual(genericResponse.editorial_identity, {
    provider: "injected",
    model: "custom-editorial-model",
    adapter: "messages.create",
  });
});

test("Gemini redirects are manual, bounded and may not leave the Google API origin", async () => {
  const secret = "must-never-appear-in-errors";
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: secret,
    },
    fetchImpl: async () =>
      new Response("", {
        status: 307,
        headers: {
          location: "https://attacker.invalid/collect",
        },
      }),
  });

  await assert.rejects(
    client.messages.create({
      max_tokens: 100,
      messages: [{ role: "user", content: "test" }],
    }),
    (error) => {
      assert.equal(error.message, "editorial_origin_forbidden");
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("Gemini transport failures, oversized output and thought parts fail closed without leaking credentials", async (t) => {
  const secret = "sensitive-google-key";
  const input = {
    max_tokens: 100,
    messages: [{ role: "user", content: "test" }],
  };

  await t.test("transport errors are sanitised", async () => {
    const client = resolveEditorialMessagesClient({
      env: {
        PULSE_EDITORIAL_PROVIDER: "google",
        PULSE_PAID_AI_ENABLED: "true",
        GOOGLE_AI_API_KEY: secret,
      },
      fetchImpl: async () => {
        throw new Error(`network failed with ${secret}`);
      },
    });
    await assert.rejects(client.messages.create(input), (error) => {
      assert.equal(error.message, "editorial_transport_failed");
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    });
  });

  await t.test("declared oversized output is rejected before parsing", async () => {
    const client = resolveEditorialMessagesClient({
      env: {
        PULSE_EDITORIAL_PROVIDER: "google",
        PULSE_PAID_AI_ENABLED: "true",
        GOOGLE_AI_API_KEY: secret,
      },
      fetchImpl: async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(2 * 1024 * 1024 + 1) },
        }),
    });
    await assert.rejects(
      client.messages.create(input),
      /editorial_response_too_large/,
    );
  });

  await t.test("thought-only output is never surfaced", async () => {
    const client = resolveEditorialMessagesClient({
      env: {
        PULSE_EDITORIAL_PROVIDER: "google",
        PULSE_PAID_AI_ENABLED: "true",
        GOOGLE_AI_API_KEY: secret,
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      thought: true,
                      text: "private model reasoning",
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200 },
        ),
    });
    await assert.rejects(
      client.messages.create(input),
      /editorial_response_text_missing/,
    );
  });
});

test("A/B title generation reuses the governed client and records the actual Gemini identity", async () => {
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-secret-for-title-test",
      GOOGLE_AI_MODEL: "gemini-3-flash-preview",
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
                content: {
                parts: [
                  {
                    text: JSON.stringify([
                      "Xbox Just Changed Backwards Compatibility",
                      "The Original Xbox Feature Nobody Expected",
                    ]),
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200 },
      ),
  });
  const story = {
    title: "Original Xbox games gain backwards compatibility",
    suggested_title: "Original title",
    classification: "Confirmed Drop",
  };

  await generateTitleVariants(story, { editorialClient: client });

  assert.deepEqual(story.title_variants, [
    "Original title",
    "Xbox Just Changed Backwards Compatibility",
    "The Original Xbox Feature Nobody Expected",
  ]);
  assert.deepEqual(story.title_variant_generator_identity, {
    provider: "google",
    model: "gemini-3-flash-preview",
    adapter: "gemini.generateContent",
  });
});

test("all governed lane generators inherit the actual Gemini provider and model", () => {
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-secret-for-generator-test",
      GOOGLE_AI_MODEL: "gemini-3.1-pro-preview",
    },
    fetchImpl: async () => {
      throw new Error("network must not be called while resolving identity");
    },
  });
  const factories = [
    createAnthropicEvergreenDiscoveryJsonGenerator,
    createAnthropicEvergreenJsonGenerator,
    createAnthropicWeeklyLongformJsonGenerator,
  ];

  for (const factory of factories) {
    const generator = factory({
      client,
      model: "gemini-3.1-pro-preview",
    });
    assert.deepEqual(generator.identity, {
      provider: "google",
      model: "gemini-3.1-pro-preview",
      adapter: "gemini.generateContent",
    });
  }
});

test("breaking evidence identifies Gemini truthfully instead of labelling it Anthropic", async () => {
  const exactClaim =
    "Microsoft confirmed that four original Xbox games will join the backwards compatibility programme this year.";
  const client = resolveEditorialMessagesClient({
    env: {
      PULSE_EDITORIAL_PROVIDER: "google",
      PULSE_PAID_AI_ENABLED: "true",
      GOOGLE_AI_API_KEY: "google-secret-for-evidence-test",
      GOOGLE_AI_MODEL: "gemini-3-flash-preview",
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      claims: [
                        {
                          claim_key:
                            "microsoft.xbox.adds.original-games",
                          text: exactClaim,
                        },
                      ],
                    }),
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200 },
      ),
  });
  const extract = createAnthropicBreakingClaimExtractor({
    client,
    model: "gemini-3-flash-preview",
  });

  const result = await extract({
    story: { id: "xbox-breaking" },
    source: {
      source_id: "xbox-wire",
      source_class: "official_first_party",
      publisher: "Microsoft",
    },
    content_type: "text/html",
    bytes: Buffer.from(
      `<article>${exactClaim} More details will follow from the official platform team.</article>`,
    ),
  });

  assert.deepEqual(result.extractor, {
    id: "google-gemini-evidence-body-v1",
    version: "1.0.0",
    provider: "google",
    model: "gemini-3-flash-preview",
    adapter: "gemini.generateContent",
  });
});

test("breaking evidence identifies the local Ollama model truthfully", async () => {
  const exactClaim =
    "Microsoft confirmed original Xbox games will join the backwards compatibility programme in the next platform update.";
  const client = resolveEditorialMessagesClient({
    env: { PULSE_EDITORIAL_PROVIDER: "ollama" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          model: DEFAULT_OLLAMA_MODEL,
          message: {
            role: "assistant",
            content: JSON.stringify({
              claims: [
                {
                  claim_key:
                    "microsoft.xbox.adds.original-backcompat-games",
                  text: exactClaim,
                },
              ],
            }),
          },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 40,
          eval_count: 20,
        }),
        { status: 200 },
      ),
  });
  const extract = createAnthropicBreakingClaimExtractor({
    client,
    model: editorialModelFor(
      client,
      "claude-haiku-4-5-20251001",
    ),
  });

  const result = await extract({
    story: { id: "xbox-breaking-local" },
    source: {
      source_id: "xbox-wire",
      source_class: "official_first_party",
      publisher: "Microsoft",
    },
    content_type: "text/plain",
    bytes: Buffer.from(
      `${exactClaim} More official details are included in the article body.`,
    ),
  });

  assert.deepEqual(result.extractor, {
    id: "ollama-evidence-body-v1",
    version: "1.0.0",
    provider: "ollama",
    model: DEFAULT_OLLAMA_MODEL,
    adapter: "ollama.api.chat",
  });
});

test("the live breaking handler works in a Google-only environment and persists Gemini provenance", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-google-breaking-handler-"),
  );
  const previous = {
    editorialProvider: process.env.PULSE_EDITORIAL_PROVIDER,
    paidAiEnabled: process.env.PULSE_PAID_AI_ENABLED,
    googleKey: process.env.GOOGLE_AI_API_KEY,
    googleModel: process.env.GOOGLE_AI_MODEL,
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    fetch: globalThis.fetch,
  };
  t.after(async () => {
    await fs.remove(outDir);
    globalThis.fetch = previous.fetch;
    if (previous.editorialProvider === undefined) {
      delete process.env.PULSE_EDITORIAL_PROVIDER;
    } else {
      process.env.PULSE_EDITORIAL_PROVIDER =
        previous.editorialProvider;
    }
    if (previous.googleKey === undefined) {
      delete process.env.GOOGLE_AI_API_KEY;
    } else {
      process.env.GOOGLE_AI_API_KEY = previous.googleKey;
    }
    if (previous.paidAiEnabled === undefined) {
      delete process.env.PULSE_PAID_AI_ENABLED;
    } else {
      process.env.PULSE_PAID_AI_ENABLED = previous.paidAiEnabled;
    }
    if (previous.googleModel === undefined) {
      delete process.env.GOOGLE_AI_MODEL;
    } else {
      process.env.GOOGLE_AI_MODEL = previous.googleModel;
    }
    if (previous.anthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previous.anthropicKey;
    }
  });

  process.env.PULSE_EDITORIAL_PROVIDER = "google";
  process.env.PULSE_PAID_AI_ENABLED = "true";
  process.env.GOOGLE_AI_API_KEY = "google-only-handler-test";
  process.env.GOOGLE_AI_MODEL = "gemini-3-flash-preview";
  delete process.env.ANTHROPIC_API_KEY;

  const exactClaim =
    "Microsoft confirmed original Xbox games will join the backwards compatibility programme during the next platform update.";
  let modelCalls = 0;
  globalThis.fetch = async (url, options) => {
    modelCalls += 1;
    assert.match(
      url,
      /models\/gemini-3-flash-preview:generateContent$/,
    );
    assert.equal(
      options.headers["x-goog-api-key"],
      "google-only-handler-test",
    );
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    claims: [
                      {
                        claim_key:
                          "microsoft.xbox.adds.original-backcompat-games",
                        text: exactClaim,
                      },
                    ],
                  }),
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      }),
      { status: 200 },
    );
  };

  const officialUrl =
    "https://news.xbox.com/en-us/2026/07/28/google-client/";
  const envelope = buildBreakingEventEnvelope({
    story: {
      id: "rss-google-only-breaking",
      title: "Original Xbox games are coming to Game Pass",
      url: officialUrl,
      article_url: officialUrl,
      source_type: "rss",
      subreddit: "Xbox Wire",
      breaking_score: 145,
      breaking_trigger: "rss_threshold",
      timestamp: "2026-07-28T14:03:00.000Z",
    },
    now: "2026-07-28T14:05:00.000Z",
  });
  const queued = [];
  const result = await handlers.breaking_story_discovery(
    {
      payload: {
        ...envelope,
        out_dir: outDir,
      },
    },
    {
      createBreakingFetchCapture() {
        return async ({ url }) => ({
          status: 200,
          final_url: url,
          content_type: "text/html",
          bytes: Buffer.from(`<article>${exactClaim}</article>`),
        });
      },
      breakingSourcePolicy: {
        official_first_party: [
          {
            source_id: "xbox-wire",
            owner: "Microsoft Gaming",
            hosts: ["news.xbox.com"],
            subject_ids: ["xbox"],
          },
        ],
        trusted_editorial: [],
      },
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 901, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(result.verdict, "READY_FOR_PLANNING");
  assert.equal(modelCalls, 1);
  assert.equal(queued.length, 1);
  const report = await fs.readJson(result.report_json);
  assert.deepEqual(
    report.source_evidence.sources[0].provenance.extractor,
    {
      id: "google-gemini-evidence-body-v1",
      version: "1.0.0",
      provider: "google",
      model: "gemini-3-flash-preview",
      adapter: "gemini.generateContent",
    },
  );
});

test("runtime configuration evidence classifies the Google API key as secret", () => {
  const report = buildEffectiveConfigReport({
    env: {
      GOOGLE_AI_API_KEY: "never-print-this-google-secret",
      USE_JOB_QUEUE: "true",
    },
    generatedAt: "2026-07-28T15:00:00.000Z",
  });
  const entry = report.entries.find(
    (candidate) => candidate.key === "GOOGLE_AI_API_KEY",
  );

  assert.equal(entry.secret, true);
  assert.equal(entry.present, true);
  assert.equal("value" in entry, false);
  assert.doesNotMatch(
    JSON.stringify(report),
    /never-print-this-google-secret/,
  );
});
