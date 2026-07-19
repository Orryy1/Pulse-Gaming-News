"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  ElevenLabsGenerationEvidenceProviderError,
  createElevenLabsGenerationEvidenceProvider,
  isOfficialElevenLabsUrl,
} = require("../../lib/elevenlabs-generation-evidence-provider");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("captures one governed ElevenLabs generation with sanitised provider evidence", async () => {
  const apiKey = "elevenlabs-secret-that-must-not-escape";
  const voiceId = "pulse-private-voice";
  const modelId = "eleven_multilingual_v2";
  const text = "Black Flag has crossed three million sales.";
  const audio = Buffer.from("raw ElevenLabs audio");
  const calls = [];
  let subscriptionCalls = 0;

  const provider = createElevenLabsGenerationEvidenceProvider({
    apiKey,
    now: () => new Date("2026-07-19T16:00:00.000Z"),
    httpRequest: async (request) => {
      calls.push(request);
      const url = new URL(request.url);

      if (url.pathname === "/v1/user/subscription") {
        subscriptionCalls += 1;
        return {
          status: 200,
          url: request.url,
          headers: { authorization: `Bearer ${apiKey}` },
          data: {
            tier: "pro",
            status: "active",
            billing_period: "annual_period",
            character_refresh_period: "monthly_period",
            user_id: "private-account",
            api_key: apiKey,
            next_invoice: { amount_due: 9999 },
          },
        };
      }

      if (url.pathname === "/v1/models") {
        return {
          status: 200,
          url: request.url,
          data: [
            {
              model_id: modelId,
              name: "Eleven Multilingual v2",
              can_do_text_to_speech: true,
              requires_alpha_access: false,
              requires_beta_access: false,
              owner_id: "private-owner",
              api_key: apiKey,
            },
          ],
        };
      }

      if (url.hostname === "help.elevenlabs.io") {
        return {
          status: 200,
          url: request.url,
          data: Buffer.from("<html>Commercial-use policy</html>"),
          headers: { authorization: `Bearer ${apiKey}` },
        };
      }

      if (url.pathname.endsWith("/with-timestamps")) {
        return {
          status: 200,
          url: request.url,
          headers: {
            "request-id": "request-123",
            authorization: `Bearer ${apiKey}`,
          },
          data: {
            audio_base64: audio.toString("base64"),
            alignment: {
              characters: ["B"],
              character_start_times_seconds: [0],
              character_end_times_seconds: [0.2],
            },
            normalized_alignment: {
              characters: ["B"],
              character_start_times_seconds: [0],
              character_end_times_seconds: [0.2],
            },
            api_key: apiKey,
          },
        };
      }

      if (url.pathname === "/v1/history") {
        return {
          status: 200,
          url: request.url,
          data: {
            history: [
              {
                history_item_id: "history-123",
                request_id: "request-123",
                date_unix: 1784476800,
                model_id: modelId,
                voice_id: voiceId,
                text,
                voice_name: "Private voice name",
                api_key: apiKey,
              },
            ],
          },
        };
      }

      if (url.pathname === "/v1/history/history-123/audio") {
        return {
          status: 200,
          url: request.url,
          data: audio,
          headers: { authorization: `Bearer ${apiKey}` },
        };
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    },
  });
  assert.equal(typeof provider.generateWithTimestamps, "function");

  const result = await provider.captureGeneration({
    voiceId,
    modelId,
    text,
    voiceSettings: {
      stability: 0.5,
      similarity_boost: 0.75,
      api_key: apiKey,
    },
    policyUrls: [
      "https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform",
    ],
  });

  assert.equal(subscriptionCalls, 2);
  assert.equal(
    calls.filter((call) => call.url.includes("/with-timestamps")).length,
    1,
  );
  assert.equal(result.request_id, "request-123");
  assert.equal(result.history_item_id, "history-123");
  assert.equal(result.date_unix, 1784476800);
  assert.deepEqual(result.raw_audio_bytes, audio);
  assert.deepEqual(result.history_audio_bytes, audio);
  assert.equal(result.raw_audio_sha256, sha256(audio));
  assert.equal(result.history_audio_sha256, sha256(audio));
  assert.equal(result.history.request_id, "request-123");
  assert.equal(result.history.history_item_id, "history-123");
  assert.equal(result.history.voice_id_sha256, sha256(Buffer.from(voiceId)));
  assert.equal(result.history.text_sha256, sha256(Buffer.from(text)));
  assert.equal(result.subscription.pre.tier, "pro");
  assert.equal(result.subscription.post.status, "active");
  assert.equal(result.model.model_id, modelId);
  assert.equal(result.policies.length, 1);
  assert.equal(result.safety.credentials_returned, false);
  assert.equal(result.safety.authorization_headers_returned, false);
  assert.equal(result.safety.read_only_evidence_calls_only, false);
  assert.equal(result.safety.credit_consuming_generation, true);
  assert.equal(result.safety.provider_account_mutated, false);

  const serialised = JSON.stringify(result);
  assert.doesNotMatch(
    serialised,
    /elevenlabs-secret|private-account|private-owner|Private voice name|"authorization"\s*:|next_invoice|amount_due/i,
  );
  const policyCall = calls.find((call) =>
    call.url.startsWith("https://help.elevenlabs.io/"),
  );
  assert.deepEqual(policyCall.headers, { accept: "text/html" });
  const generationCalls = calls.filter((call) => call.method !== "GET");
  assert.equal(generationCalls.length, 1);
  assert.match(generationCalls[0].url, /\/with-timestamps\?/);
  assert.doesNotMatch(JSON.stringify(generationCalls[0].body), new RegExp(apiKey));
});

test("accepts only official HTTPS ElevenLabs URLs and rejects unsafe redirects", async () => {
  assert.equal(
    isOfficialElevenLabsUrl("https://api.elevenlabs.io/v1/models"),
    true,
  );
  assert.equal(
    isOfficialElevenLabsUrl("https://help.elevenlabs.io/hc/en-us/articles/1"),
    true,
  );
  assert.equal(
    isOfficialElevenLabsUrl("http://api.elevenlabs.io/v1/models"),
    false,
  );
  assert.equal(
    isOfficialElevenLabsUrl("https://elevenlabs.io.evil.example/policy"),
    false,
  );
  assert.equal(
    isOfficialElevenLabsUrl("https://user@elevenlabs.io/policy"),
    false,
  );

  let calls = 0;
  const provider = createElevenLabsGenerationEvidenceProvider({
    apiKey: "private-key",
    httpRequest: async (request) => {
      calls += 1;
      return {
        status: 200,
        url: "https://attacker.example/redirected-policy",
        data: Buffer.from("unsafe redirect"),
      };
    },
  });

  await assert.rejects(
    provider.retrievePolicy("https://elevenlabs.io.evil.example/policy"),
    (error) =>
      error instanceof ElevenLabsGenerationEvidenceProviderError &&
      error.code === "unofficial_policy_url",
  );
  assert.equal(calls, 0);

  await assert.rejects(
    provider.retrievePolicy("https://elevenlabs.io/terms-of-use-eu"),
    (error) =>
      error instanceof ElevenLabsGenerationEvidenceProviderError &&
      error.code === "unofficial_elevenlabs_response_url",
  );
  assert.equal(calls, 1);
});

function createIdentityScenarioTransport({
  apiKey,
  requestId = "request-identity",
  historyOverrides = {},
  audio = Buffer.from("identity-bound audio"),
}) {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/v1/user/subscription") {
      return {
        status: 200,
        url: request.url,
        data: { tier: "pro", status: "active", api_key: apiKey },
      };
    }
    if (url.pathname === "/v1/models") {
      return {
        status: 200,
        url: request.url,
        data: [
          {
            model_id: "eleven_multilingual_v2",
            can_do_text_to_speech: true,
          },
        ],
      };
    }
    if (url.hostname === "elevenlabs.io") {
      return {
        status: 200,
        url: request.url,
        data: Buffer.from("official policy"),
      };
    }
    if (url.pathname.endsWith("/with-timestamps")) {
      return {
        status: 200,
        url: request.url,
        headers: requestId ? { "request-id": requestId } : {},
        data: { audio_base64: audio.toString("base64") },
      };
    }
    if (url.pathname === "/v1/history") {
      return {
        status: 200,
        url: request.url,
        data: {
          history: [
            {
              history_item_id: "history-identity",
              request_id: requestId,
              date_unix: 1784476800,
              model_id: "eleven_multilingual_v2",
              voice_id: "voice-identity",
              text: "Identity-bound generation.",
              ...historyOverrides,
            },
          ],
        },
      };
    }
    if (url.pathname === "/v1/history/history-identity/audio") {
      return { status: 200, url: request.url, data: audio };
    }
    throw new Error("unexpected transport call");
  };
}

test("fails closed when generation or history identities are missing or mismatched", async (t) => {
  await t.test("missing API key is rejected before transport use", () => {
    assert.throws(
      () =>
        createElevenLabsGenerationEvidenceProvider({
          httpRequest: async () => ({ status: 200 }),
        }),
      (error) =>
        error instanceof ElevenLabsGenerationEvidenceProviderError &&
        error.code === "elevenlabs_api_key_missing",
    );
  });

  await t.test("missing input identity is rejected before any request", async () => {
    let calls = 0;
    const provider = createElevenLabsGenerationEvidenceProvider({
      apiKey: "private-key",
      httpRequest: async () => {
        calls += 1;
        return { status: 200 };
      },
    });
    await assert.rejects(
      provider.captureGeneration({
        modelId: "eleven_multilingual_v2",
        text: "Identity-bound generation.",
        policyUrls: ["https://elevenlabs.io/terms-of-use-eu"],
      }),
      (error) =>
        error instanceof ElevenLabsGenerationEvidenceProviderError &&
        error.code === "voice_id_missing",
    );
    assert.equal(calls, 0);
  });

  await t.test("missing provider request id is terminal", async () => {
    const secret = "key-not-in-error";
    const provider = createElevenLabsGenerationEvidenceProvider({
      apiKey: secret,
      httpRequest: createIdentityScenarioTransport({
        apiKey: secret,
        requestId: "",
      }),
    });
    await assert.rejects(
      provider.captureGeneration({
        voiceId: "voice-identity",
        modelId: "eleven_multilingual_v2",
        text: "Identity-bound generation.",
        policyUrls: ["https://elevenlabs.io/terms-of-use-eu"],
      }),
      (error) => {
        assert.equal(error.code, "tts_request_id_missing");
        assert.doesNotMatch(String(error.stack), new RegExp(secret));
        return true;
      },
    );
  });

  await t.test("history model mismatch is terminal", async () => {
    const provider = createElevenLabsGenerationEvidenceProvider({
      apiKey: "private-key",
      httpRequest: createIdentityScenarioTransport({
        apiKey: "private-key",
        historyOverrides: { model_id: "different-model" },
      }),
    });
    await assert.rejects(
      provider.captureGeneration({
        voiceId: "voice-identity",
        modelId: "eleven_multilingual_v2",
        text: "Identity-bound generation.",
        policyUrls: ["https://elevenlabs.io/terms-of-use-eu"],
      }),
      (error) =>
        error instanceof ElevenLabsGenerationEvidenceProviderError &&
        error.code === "history_model_id_mismatch",
    );
  });
});
