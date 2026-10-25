"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { promisify } = require("node:util");

const {
  createElevenLabsCreditGovernor,
  ElevenLabsCreditGuardError,
} = require("../../lib/services/elevenlabs-credit-governor");

const execFileAsync = promisify(execFile);

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function fixture(t, overrides = {}) {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-elevenlabs-ledger-"),
  );
  t.after(() =>
    fs.rmSync(stateRoot, { recursive: true, force: true }),
  );
  const calls = [];
  const env = {
    ELEVENLABS_API_KEY: "must-not-leak",
    ELEVENLABS_CREDIT_ESTIMATE_MULTIPLIER: "1",
    ELEVENLABS_CREDIT_RESERVE_PERCENT: "20",
    ELEVENLABS_CREDIT_SNAPSHOT_TTL_MS: "60000",
    PULSE_STATE_ROOT: stateRoot,
    ...overrides,
  };
  const request = async (input) => {
    calls.push(input);
    return {
      status: 200,
      data: {
        tier: "pro",
        status: "active",
        character_count: 500,
        character_limit: 1000,
        next_character_count_reset_unix: 1785799831,
        max_credit_limit_extension: "unlimited",
        current_overage: { amount: "0", currency: "usd" },
      },
    };
  };
  return { stateRoot, env, request, calls };
}

test("two governor instances atomically share reservations and cannot overspend the reserve", async (t) => {
  const values = fixture(t);
  const firstGovernor = createElevenLabsCreditGovernor({
    env: values.env,
    request: values.request,
  });
  const secondGovernor = createElevenLabsCreditGovernor({
    env: values.env,
    request: values.request,
  });

  const outcomes = await Promise.allSettled([
    firstGovernor.preflight({
      text: "x".repeat(250),
      purpose: "breaking_short_narration",
      idempotencyKey: "lane-a",
    }),
    secondGovernor.preflight({
      text: "x".repeat(250),
      purpose: "weekly_longform_narration",
      idempotencyKey: "lane-b",
    }),
  ]);

  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  const rejected = outcomes.find(
    (outcome) => outcome.status === "rejected",
  );
  assert.ok(rejected.reason instanceof ElevenLabsCreditGuardError);
  assert.equal(
    rejected.reason.code,
    "elevenlabs_credit_reserve_would_be_crossed",
  );
  const ledgerPath = path.join(
    values.stateRoot,
    "elevenlabs-credit-governor",
    "ledger.json",
  );
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  assert.equal(ledger.schema_version, "pulse-elevenlabs-credit-ledger-v1");
  assert.equal(
    Object.values(ledger.entries).filter(
      (entry) => entry.state === "reserved",
    ).length,
    1,
  );
  assert.doesNotMatch(
    fs.readFileSync(ledgerPath, "utf8"),
    /must-not-leak|xi-api-key/i,
  );
});

test("separate Node processes share the same atomic reservation ledger", async (t) => {
  const values = fixture(t);
  const governorPath = path.resolve(
    __dirname,
    "..",
    "..",
    "lib",
    "services",
    "elevenlabs-credit-governor.js",
  );
  const script = [
    `const {createElevenLabsCreditGovernor}=require(${JSON.stringify(governorPath)});`,
    `const stateRoot=${JSON.stringify(values.stateRoot)};`,
    "const governor=createElevenLabsCreditGovernor({",
    "env:{ELEVENLABS_API_KEY:'fixture',ELEVENLABS_CREDIT_ESTIMATE_MULTIPLIER:'1',ELEVENLABS_CREDIT_RESERVE_PERCENT:'20',PULSE_STATE_ROOT:stateRoot},",
    "request:async()=>({status:200,data:{tier:'pro',status:'active',character_count:500,character_limit:1000,next_character_count_reset_unix:1785799831,max_credit_limit_extension:0}})",
    "});",
    "governor.preflight({text:'x'.repeat(250),purpose:'child',idempotencyKey:process.argv[1]})",
    ".then(()=>process.stdout.write('ALLOW'))",
    ".catch(error=>process.stdout.write(String(error.code||error.message)));",
  ].join("");
  const outcomes = await Promise.all([
    execFileAsync(process.execPath, ["-e", script, "child-a"]),
    execFileAsync(process.execPath, ["-e", script, "child-b"]),
  ]);
  const states = outcomes.map((outcome) => outcome.stdout.trim()).sort();

  assert.deepEqual(states, [
    "ALLOW",
    "elevenlabs_credit_reserve_would_be_crossed",
  ]);
});

test("a restart refuses an idempotency key once the provider call was durably started", async (t) => {
  const values = fixture(t);
  const firstGovernor = createElevenLabsCreditGovernor({
    env: values.env,
    request: values.request,
  });
  const lease = await firstGovernor.preflight({
    text: "Narration that must never be charged twice.",
    purpose: "breaking_short_narration",
    idempotencyKey: "same-paid-render",
  });
  await lease.markProviderCallStarted();

  const restartedGovernor = createElevenLabsCreditGovernor({
    env: values.env,
    request: values.request,
  });
  await assert.rejects(
    () =>
      restartedGovernor.preflight({
        text: "Narration that must never be charged twice.",
        purpose: "breaking_short_narration",
        idempotencyKey: "same-paid-render",
      }),
    (error) =>
      error instanceof ElevenLabsCreditGuardError &&
      error.code ===
        "elevenlabs_paid_synthesis_retry_ambiguous_forbidden",
  );

  const ledger = JSON.parse(
    fs.readFileSync(
      path.join(
        values.stateRoot,
        "elevenlabs-credit-governor",
        "ledger.json",
      ),
      "utf8",
    ),
  );
  const entries = Object.values(ledger.entries);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, "provider_call_started");
  assert.equal(
    ledger.unobserved_committed_credits,
    "Narration that must never be charged twice.".length,
  );
  assert.doesNotMatch(
    JSON.stringify(ledger),
    /same-paid-render|Narration that must never/i,
  );
});

test("provider success is durably journalled with its recoverable result before output completion", async (t) => {
  const values = fixture(t);
  const governor = createElevenLabsCreditGovernor({
    env: values.env,
    request: values.request,
  });
  const input = {
    text: "Durable Pulse narration.",
    purpose: "weekly_longform_narration",
    idempotencyKey: "weekly-W31-final",
  };
  const lease = await governor.preflight(input);
  await lease.markProviderCallStarted();
  const stored = await lease.recordProviderSuccess({
    audio_base64: Buffer.from("provider-audio").toString("base64"),
    alignment: { characters: Array.from(input.text) },
  });

  assert.match(stored.relative_path, /^provider-results\/[a-f0-9]{64}\.json$/);
  assert.match(stored.sha256, /^[a-f0-9]{64}$/);
  const resultPath = path.join(
    values.stateRoot,
    "elevenlabs-credit-governor",
    ...stored.relative_path.split("/"),
  );
  assert.equal(fs.existsSync(resultPath), true);
  const recoveredResult = JSON.parse(
    fs.readFileSync(resultPath, "utf8"),
  );
  assert.equal(
    Buffer.from(recoveredResult.audio_base64, "base64").toString(
      "utf8",
    ),
    "provider-audio",
  );

  const restartedGovernor = createElevenLabsCreditGovernor({
    env: values.env,
    request: values.request,
  });
  const replay = await restartedGovernor.preflight(input);
  assert.equal(replay.replayAvailable, true);
  assert.equal(replay.requiresProviderCall, false);
  assert.deepEqual(
    await replay.readRecordedProviderResult(),
    recoveredResult,
  );

  await lease.complete({ outputSha256: "a".repeat(64) });
  const ledger = JSON.parse(
    fs.readFileSync(
      path.join(
        values.stateRoot,
        "elevenlabs-credit-governor",
        "ledger.json",
      ),
      "utf8",
    ),
  );
  assert.equal(Object.values(ledger.entries)[0].state, "completed");
  assert.equal(
    Object.values(ledger.entries)[0].output_sha256,
    "a".repeat(64),
  );
});

test("a completed pre-change path-bound narration key migrates to the stable key and replays without a provider call", async (t) => {
  const values = fixture(t);
  const narration =
    "Xbox just confirmed four classics are returning with achievement support.";
  const storyId = "official_legacy-key";
  const scriptSha256 = sha256(narration);
  const identity = {
    story_id: storyId,
    script_sha256: scriptSha256,
    voice_id: "pulse-approved",
    model_id: "eleven_multilingual_v2",
    speed: 1,
  };
  const oldAudioPath = path
    .join(values.stateRoot, "old-candidate", "voice.mp3")
    .replaceAll("\\", "/");
  const keyPrefix =
    "pulse-governed-autonomous-narration-v1:";
  const legacyKey =
    keyPrefix +
    sha256(
      JSON.stringify({
        ...identity,
        audio_path: oldAudioPath,
      }),
    );
  const stableKey =
    keyPrefix + sha256(JSON.stringify(identity));
  const purpose =
    "governed_autonomous_breaking_short_narration";
  const firstGovernor = createElevenLabsCreditGovernor({
    env: values.env,
    request: values.request,
  });
  const legacyLease = await firstGovernor.preflight({
    text: narration,
    purpose,
    idempotencyKey: legacyKey,
  });
  await legacyLease.markProviderCallStarted();
  const providerResult = {
    audio_base64: Buffer.from("legacy-provider-audio").toString(
      "base64",
    ),
    alignment: { characters: Array.from(narration) },
  };
  await legacyLease.recordProviderSuccess(providerResult);
  await legacyLease.complete({
    outputSha256: sha256("legacy-provider-audio"),
  });
  const ledgerPath = path.join(
    values.stateRoot,
    "elevenlabs-credit-governor",
    "ledger.json",
  );
  const legacyKeyHash = sha256(legacyKey);
  const stableKeyHash = sha256(stableKey);
  const before = JSON.parse(
    fs.readFileSync(ledgerPath, "utf8"),
  );
  const exactLegacyEntry = structuredClone(
    before.entries[legacyKeyHash],
  );

  const restartedGovernor = createElevenLabsCreditGovernor({
    env: values.env,
    request: values.request,
  });
  const replay = await restartedGovernor.preflight({
    text: narration,
    purpose,
    idempotencyKey: stableKey,
    legacyIdempotencyKeyHashes: [legacyKeyHash],
  });

  assert.equal(replay.replayAvailable, true);
  assert.equal(replay.requiresProviderCall, false);
  assert.deepEqual(
    await replay.readRecordedProviderResult(),
    providerResult,
  );
  const after = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  assert.deepEqual(
    after.entries[legacyKeyHash],
    exactLegacyEntry,
  );
  assert.deepEqual(
    after.entries[stableKeyHash].provider_result,
    exactLegacyEntry.provider_result,
  );
  assert.equal(
    after.entries[stableKeyHash].migrated_from_key_hash,
    legacyKeyHash,
  );
  assert.equal(after.entries[stableKeyHash].state, "completed");
  assert.equal(after.entries[stableKeyHash].estimated_credits, 0);
  assert.equal(
    after.unobserved_committed_credits,
    before.unobserved_committed_credits,
  );

  const orphanedAlias = structuredClone(after);
  delete orphanedAlias.entries[legacyKeyHash];
  fs.writeFileSync(
    ledgerPath,
    `${JSON.stringify(orphanedAlias, null, 2)}\n`,
    "utf8",
  );
  const failClosedGovernor =
    createElevenLabsCreditGovernor({
      env: values.env,
      request: values.request,
    });
  await assert.rejects(
    () =>
      failClosedGovernor.preflight({
        text: narration,
        purpose,
        idempotencyKey: stableKey,
        legacyIdempotencyKeyHashes: [legacyKeyHash],
      }),
    (error) =>
      error instanceof ElevenLabsCreditGuardError &&
      error.code === "elevenlabs_credit_ledger_invalid",
  );
});

test("an arbitrary configured ElevenLabs origin is rejected before the API key can reach transport", (t) => {
  const values = fixture(t, {
    ELEVENLABS_BASE_URL: "https://collector.example",
  });
  let called = false;
  assert.throws(
    () =>
      createElevenLabsCreditGovernor({
        env: values.env,
        request: async () => {
          called = true;
        },
      }),
    (error) =>
      error instanceof ElevenLabsCreditGuardError &&
      error.code ===
        "elevenlabs_credit_guard_base_url_invalid",
  );
  assert.equal(called, false);
});

test("durable paid synthesis refuses to initialise without an explicit shared state root", () => {
  assert.throws(
    () =>
      createElevenLabsCreditGovernor({
        env: { ELEVENLABS_API_KEY: "fixture" },
        request: async () => {
          throw new Error("must_not_call");
        },
      }),
    (error) =>
      error instanceof ElevenLabsCreditGuardError &&
      error.code === "elevenlabs_credit_state_root_required",
  );
});

test("a stale lock is recovered only when its same-host owner is provably dead", async (t) => {
  const values = fixture(t, {
    ELEVENLABS_CREDIT_LOCK_STALE_MS: "100",
  });
  const lockPath = path.join(
    values.stateRoot,
    "elevenlabs-credit-governor",
    ".ledger.lock",
  );
  fs.mkdirSync(lockPath, { recursive: true });
  fs.writeFileSync(
    path.join(lockPath, "owner.json"),
    `${JSON.stringify({
      schema_version:
        "pulse-elevenlabs-credit-ledger-lock-owner-v1",
      token: "12345678-1234-1234-1234-123456789abc",
      pid: 987654,
      hostname: "pulse-test-host",
      acquired_at: "2026-07-28T08:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const wallNow = Date.parse("2026-07-28T09:00:00.000Z");
  const staleAt = new Date(wallNow - 60_000);
  fs.utimesSync(lockPath, staleAt, staleAt);

  const governor = createElevenLabsCreditGovernor({
    env: values.env,
    request: values.request,
    now: () => wallNow,
    wallNow: () => wallNow,
    hostname: "pulse-test-host",
    isProcessAlive: () => false,
  });
  const lease = await governor.preflight({
    text: "Recovered safely.",
    purpose: "narration",
    idempotencyKey: "after-dead-owner",
  });

  assert.equal(lease.report.verdict, "ALLOW");
  assert.equal(fs.existsSync(lockPath), false);
});

test("a stale-looking lock with a live owner is never recovered", async (t) => {
  const values = fixture(t, {
    ELEVENLABS_CREDIT_LOCK_STALE_MS: "100",
    ELEVENLABS_CREDIT_LOCK_TIMEOUT_MS: "100",
  });
  const lockPath = path.join(
    values.stateRoot,
    "elevenlabs-credit-governor",
    ".ledger.lock",
  );
  fs.mkdirSync(lockPath, { recursive: true });
  fs.writeFileSync(
    path.join(lockPath, "owner.json"),
    `${JSON.stringify({
      schema_version:
        "pulse-elevenlabs-credit-ledger-lock-owner-v1",
      token: "12345678-1234-1234-1234-123456789abc",
      pid: 12345,
      hostname: "pulse-live-host",
      acquired_at: "2026-07-28T08:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const staleAt = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, staleAt, staleAt);
  const governor = createElevenLabsCreditGovernor({
    env: values.env,
    request: values.request,
    hostname: "pulse-live-host",
    isProcessAlive: () => true,
  });

  await assert.rejects(
    () =>
      governor.preflight({
        text: "Must wait.",
        purpose: "narration",
        idempotencyKey: "live-owner",
      }),
    (error) =>
      error instanceof ElevenLabsCreditGuardError &&
      error.code === "elevenlabs_credit_ledger_lock_timeout",
  );
  assert.equal(fs.existsSync(lockPath), true);
});
