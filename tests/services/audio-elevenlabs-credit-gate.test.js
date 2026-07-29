"use strict";

process.env.PULSE_SKIP_DOTENV = "true";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { generateTTS } = require("../../audio");
const {
  createElevenLabsCreditGovernor,
} = require("../../lib/services/elevenlabs-credit-governor");

function envSnapshot(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("cloud narration is credit-preflighted, committed and given a safe machine-readable receipt", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-elevenlabs-credit-audio-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = envSnapshot([
    "TTS_PROVIDER",
    "ELEVENLABS_API_KEY",
  ]);
  t.after(() => restoreEnv(previous));
  process.env.TTS_PROVIDER = "elevenlabs";
  process.env.ELEVENLABS_API_KEY = "test-key";

  const calls = [];
  let completed = 0;
  let released = 0;
  const creditGovernor = {
    async preflight(input) {
      calls.push(["preflight", input]);
      return {
        report: {
          schema_version: "pulse-elevenlabs-credit-preflight-v1",
          remaining_percent: 43.18,
          hard_reserve_credits: 184350,
          estimated_request_credits: 24,
          warnings: [],
          verdict: "ALLOW",
        },
        async markProviderCallStarted() {
          calls.push(["provider_call_started"]);
        },
        async recordProviderSuccess(result) {
          calls.push(["provider_result_recorded", result]);
        },
        async complete() {
          completed += 1;
        },
        async markProviderCallAmbiguous() {
          throw new Error("successful_call_must_not_be_ambiguous");
        },
        async release() {
          released += 1;
        },
      };
    },
  };
  const outputPath = path.join(root, "narration.mp3");
  const script = "Pulse ships exact narration.";
  const alignment = {
    characters: Array.from(script),
    character_start_times_seconds: Array.from(script).map(
      (_, index) => index * 0.04,
    ),
    character_end_times_seconds: Array.from(script).map(
      (_, index) => (index + 1) * 0.04,
    ),
  };

  await generateTTS(script, outputPath, 1, {
    purpose: "test_narration",
    creditGovernor,
    async httpClient(input) {
      calls.push(["tts", input]);
      return {
        status: 200,
        data: {
          audio_base64: Buffer.from("paid-provider-audio").toString("base64"),
          alignment,
        },
      };
    },
  });

  assert.deepEqual(
    calls.map(([kind]) => kind),
    [
      "preflight",
      "provider_call_started",
      "tts",
      "provider_result_recorded",
    ],
  );
  assert.equal(completed, 1);
  assert.equal(released, 0);
  assert.deepEqual(
    fs.readFileSync(outputPath),
    Buffer.from("paid-provider-audio"),
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        outputPath.replace(/\.mp3$/, "_timestamps.json"),
        "utf8",
      ),
    ),
    alignment,
  );
  const receipt = JSON.parse(
    fs.readFileSync(
      outputPath.replace(/\.mp3$/, "_credit.json"),
      "utf8",
    ),
  );
  assert.equal(receipt.committed, true);
  assert.equal(receipt.remaining_percent, 43.18);
  assert.match(receipt.committed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(receipt), /test-key/);
  assert.equal(calls[0][1].purpose, "test_narration");
  assert.match(
    calls[0][1].idempotencyKey,
    /^pulse-elevenlabs-tts-v1:[a-f0-9]{64}$/,
  );
  assert.match(
    calls.find(([kind]) => kind === "tts")[1].url,
    /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\//,
  );
  assert.equal(
    calls.find(([kind]) => kind === "tts")[1].maxRedirects,
    0,
  );
});

test("a failed provider request is durably ambiguous and writes no receipt", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-elevenlabs-credit-failure-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = envSnapshot([
    "TTS_PROVIDER",
    "ELEVENLABS_API_KEY",
  ]);
  t.after(() => restoreEnv(previous));
  process.env.TTS_PROVIDER = "elevenlabs";
  process.env.ELEVENLABS_API_KEY = "test-key";

  let completed = 0;
  let released = 0;
  let ambiguous = 0;
  const outputPath = path.join(root, "narration.mp3");
  await assert.rejects(
    () =>
      generateTTS("Pulse narration.", outputPath, 1, {
        creditGovernor: {
          async preflight() {
            return {
              report: { warnings: [] },
              async markProviderCallStarted() {},
              async recordProviderSuccess() {
                throw new Error("failed_call_has_no_success");
              },
              async complete() {
                completed += 1;
              },
              async markProviderCallAmbiguous() {
                ambiguous += 1;
              },
              async release() {
                released += 1;
              },
            };
          },
        },
        async httpClient() {
          throw new Error("provider_unavailable");
        },
      }),
    /provider_unavailable/,
  );

  assert.equal(completed, 0);
  assert.equal(released, 0);
  assert.equal(ambiguous, 1);
  assert.equal(fs.existsSync(outputPath), false);
  assert.equal(
    fs.existsSync(outputPath.replace(/\.mp3$/, "_credit.json")),
    false,
  );
});

test("local TTS never invokes the paid credit governor", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-local-credit-bypass-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = envSnapshot(["TTS_PROVIDER", "LOCAL_TTS_URL"]);
  t.after(() => restoreEnv(previous));
  process.env.TTS_PROVIDER = "local";
  process.env.LOCAL_TTS_URL = "http://127.0.0.1:8765";

  const outputPath = path.join(root, "narration.mp3");
  await generateTTS("Local Pulse narration.", outputPath, 1, {
    creditGovernor: {
      async preflight() {
        throw new Error("paid_guard_must_not_run");
      },
    },
    async httpClient() {
      return {
        status: 200,
        data: {
          audio_base64: Buffer.from("local-audio").toString("base64"),
          alignment: {},
        },
      };
    },
  });

  assert.deepEqual(fs.readFileSync(outputPath), Buffer.from("local-audio"));
  assert.equal(
    fs.existsSync(outputPath.replace(/\.mp3$/, "_credit.json")),
    false,
  );
});

test("a post-provider output failure cannot cause a second paid request after restart", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-elevenlabs-crash-safe-audio-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = envSnapshot([
    "TTS_PROVIDER",
    "ELEVENLABS_API_KEY",
    "PULSE_STATE_ROOT",
  ]);
  t.after(() => restoreEnv(previous));
  process.env.TTS_PROVIDER = "elevenlabs";
  process.env.ELEVENLABS_API_KEY = "test-key";
  process.env.PULSE_STATE_ROOT = path.join(root, "state");

  const governor = () =>
    createElevenLabsCreditGovernor({
      env: {
        ELEVENLABS_API_KEY: "test-key",
        ELEVENLABS_CREDIT_ESTIMATE_MULTIPLIER: "1",
        ELEVENLABS_CREDIT_RESERVE_PERCENT: "20",
        PULSE_STATE_ROOT: process.env.PULSE_STATE_ROOT,
      },
      request: async () => ({
        status: 200,
        data: {
          tier: "pro",
          status: "active",
          character_count: 100,
          character_limit: 10000,
          next_character_count_reset_unix: 1785799831,
          max_credit_limit_extension: 0,
        },
      }),
    });
  const blockedParent = path.join(root, "not-a-directory");
  fs.writeFileSync(blockedParent, "file", "utf8");
  const outputPath = path.join(blockedParent, "narration.mp3");
  let paidPostCalls = 0;
  const httpClient = async () => {
    paidPostCalls += 1;
    return {
      status: 200,
      data: {
        audio_base64: Buffer.from("charged-audio").toString("base64"),
        alignment: {},
      },
    };
  };

  await assert.rejects(
    () =>
      generateTTS("Crash-safe narration.", outputPath, 1, {
        creditGovernor: governor(),
        httpClient,
      }),
    /EEXIST|ENOTDIR|not a directory/i,
  );
  fs.rmSync(blockedParent, { force: true });
  fs.mkdirSync(blockedParent);
  await generateTTS("Crash-safe narration.", outputPath, 1, {
    creditGovernor: governor(),
    httpClient,
  });

  assert.equal(paidPostCalls, 1);
  assert.deepEqual(
    fs.readFileSync(outputPath),
    Buffer.from("charged-audio"),
  );
  const replayReceipt = JSON.parse(
    fs.readFileSync(
      outputPath.replace(/\.mp3$/, "_credit.json"),
      "utf8",
    ),
  );
  assert.equal(replayReceipt.verdict, "REPLAY");
  assert.equal(replayReceipt.requires_provider_call, false);
  const resultFiles = fs.readdirSync(
    path.join(
      process.env.PULSE_STATE_ROOT,
      "elevenlabs-credit-governor",
      "provider-results",
    ),
  );
  assert.equal(resultFiles.length, 1);
});

test("an ambiguous provider failure cannot issue a second paid request after restart", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-elevenlabs-ambiguous-audio-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = envSnapshot([
    "TTS_PROVIDER",
    "ELEVENLABS_API_KEY",
    "PULSE_STATE_ROOT",
  ]);
  t.after(() => restoreEnv(previous));
  process.env.TTS_PROVIDER = "elevenlabs";
  process.env.ELEVENLABS_API_KEY = "test-key";
  process.env.PULSE_STATE_ROOT = path.join(root, "state");

  const governor = () =>
    createElevenLabsCreditGovernor({
      env: {
        ELEVENLABS_API_KEY: "test-key",
        PULSE_STATE_ROOT: process.env.PULSE_STATE_ROOT,
      },
      request: async () => ({
        status: 200,
        data: {
          tier: "pro",
          status: "active",
          character_count: 100,
          character_limit: 10000,
          next_character_count_reset_unix: 1785799831,
          max_credit_limit_extension: 0,
        },
      }),
    });
  const outputPath = path.join(root, "narration.mp3");
  let paidPostCalls = 0;
  const failedHttpClient = async () => {
    paidPostCalls += 1;
    throw new Error("connection_reset_after_request");
  };

  await assert.rejects(
    () =>
      generateTTS("Ambiguous narration.", outputPath, 1, {
        creditGovernor: governor(),
        httpClient: failedHttpClient,
      }),
    /connection_reset_after_request/,
  );
  await assert.rejects(
    () =>
      generateTTS("Ambiguous narration.", outputPath, 1, {
        creditGovernor: governor(),
        async httpClient() {
          paidPostCalls += 1;
          return {
            status: 200,
            data: {
              audio_base64:
                Buffer.from("must-not-run").toString("base64"),
              alignment: {},
            },
          };
        },
      }),
    /elevenlabs_paid_synthesis_retry_ambiguous_forbidden/,
  );
  assert.equal(paidPostCalls, 1);
});
