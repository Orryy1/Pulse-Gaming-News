const test = require("node:test");
const assert = require("node:assert/strict");

const sendDiscord = require("../../notify");

test("sendDiscord returns a skipped receipt without a configured webhook", async () => {
  const receipt = await sendDiscord("No webhook", {
    env: {},
    fetchImpl: async () => {
      throw new Error("fetch must not be called");
    },
  });

  assert.deepEqual(receipt, {
    attempted: false,
    status: "skipped",
    attempts: 0,
    http: null,
    error: {
      code: "webhook_not_configured",
      message: "Discord webhook is not configured.",
    },
    message_id: null,
  });
});

test("sendDiscord returns an auditable delivery receipt without exposing the webhook", async () => {
  const webhookUrl = "https://discord.example/webhooks/secret-token";
  const requests = [];

  const receipt = await sendDiscord("Publish succeeded", {
    env: { DISCORD_WEBHOOK_URL: webhookUrl },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ id: "discord-message-123" }),
      };
    },
  });

  assert.deepEqual(receipt, {
    attempted: true,
    status: "delivered",
    attempts: 1,
    http: {
      status: 200,
      ok: true,
    },
    error: null,
    message_id: "discord-message-123",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, webhookUrl);
  assert.equal(requests[0].options.method, "POST");
  assert.equal(
    JSON.parse(requests[0].options.body).content,
    "Publish succeeded",
  );
  assert.equal(JSON.stringify(receipt).includes(webhookUrl), false);
  assert.equal(JSON.stringify(receipt).includes("secret-token"), false);
});

test("sendDiscord honours Retry-After on 429 with bounded injectable backoff", async () => {
  const responses = [
    {
      ok: false,
      status: 429,
      headers: new Headers({
        "content-type": "application/json",
        "retry-after": "1",
      }),
      json: async () => ({ retry_after: 1 }),
    },
    {
      ok: true,
      status: 204,
      headers: new Headers(),
    },
  ];
  const delays = [];
  let fetchCalls = 0;

  const receipt = await sendDiscord("Retry this alert", {
    env: {
      DISCORD_WEBHOOK_URL: "https://discord.example/webhooks/redacted",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return responses.shift();
    },
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    maxAttempts: 2,
    maxRetryDelayMs: 1500,
  });

  assert.equal(fetchCalls, 2);
  assert.deepEqual(delays, [1000]);
  assert.deepEqual(receipt, {
    attempted: true,
    status: "delivered",
    attempts: 2,
    http: {
      status: 204,
      ok: true,
    },
    error: null,
    message_id: null,
  });
});

test("sendDiscord does not retry before a Retry-After delay that exceeds its safe bound", async () => {
  const delays = [];
  let fetchCalls = 0;

  const receipt = await sendDiscord("Long rate limit", {
    env: {
      DISCORD_WEBHOOK_URL: "https://discord.example/webhooks/redacted",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: false,
        status: 429,
        headers: new Headers({
          "content-type": "application/json",
          "retry-after": "10",
        }),
        json: async () => ({ retry_after: 10 }),
      };
    },
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    maxAttempts: 3,
    maxRetryDelayMs: 250,
  });

  assert.equal(fetchCalls, 1);
  assert.deepEqual(delays, []);
  assert.deepEqual(receipt, {
    attempted: true,
    status: "failed",
    attempts: 1,
    http: {
      status: 429,
      ok: false,
    },
    error: {
      code: "discord_retry_after_exceeds_limit",
      message:
        "Discord requested a Retry-After delay beyond the configured limit.",
    },
    message_id: null,
  });
});

test("sendDiscord returns terminal rate-limit failure after the bounded attempt budget", async () => {
  const delays = [];
  let fetchCalls = 0;

  const receipt = await sendDiscord("Persistent rate limit", {
    env: {
      DISCORD_WEBHOOK_URL: "https://discord.example/webhooks/redacted",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: false,
        status: 429,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ retry_after: 0.1 }),
      };
    },
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    maxAttempts: 3,
    maxRetryDelayMs: 250,
  });

  assert.equal(fetchCalls, 3);
  assert.deepEqual(delays, [100, 100]);
  assert.deepEqual(receipt, {
    attempted: true,
    status: "failed",
    attempts: 3,
    http: {
      status: 429,
      ok: false,
    },
    error: {
      code: "discord_rate_limit_exhausted",
      message: "Discord webhook returned HTTP 429.",
    },
    message_id: null,
  });
});

test("sendDiscord remains non-throwing and redacts webhook details from network failures", async () => {
  const webhookUrl = "https://discord.example/webhooks/secret-token";

  const receipt = await sendDiscord("Network failure", {
    env: { DISCORD_WEBHOOK_URL: webhookUrl },
    fetchImpl: async () => {
      throw new Error(`request to ${webhookUrl} failed`);
    },
  });

  assert.deepEqual(receipt, {
    attempted: true,
    status: "failed",
    attempts: 1,
    http: null,
    error: {
      code: "discord_delivery_error",
      message: "Discord webhook delivery failed.",
    },
    message_id: null,
  });
  assert.equal(JSON.stringify(receipt).includes(webhookUrl), false);
  assert.equal(JSON.stringify(receipt).includes("secret-token"), false);
});
