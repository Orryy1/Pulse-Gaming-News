"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  assertValidRuntimeConfig,
  buildEffectiveConfigReport,
  parseRuntimeConfig,
  loadDotenvOnce,
  resetRuntimeConfigForTests,
} = require("../../lib/stabilisation/runtime-config");

test("runtime config is typed and rejects contradictory production values", () => {
  const parsed = parseRuntimeConfig({
    NODE_ENV: "production",
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    USE_SQLITE: "true",
    USE_JOB_QUEUE: "false",
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    PULSE_PRIMARY_INSTANCE: "true",
  });

  assert.equal(parsed.values.USE_SQLITE, true);
  assert.equal(parsed.values.USE_JOB_QUEUE, false);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.errors.includes("production_requires_durable_job_queue"));
});

test("runtime config rejects the legacy scheduler in every environment", () => {
  const parsed = parseRuntimeConfig({
    NODE_ENV: "development",
    PULSE_OPERATING_MODE: "LOCAL_PROOF",
    USE_SQLITE: "true",
    USE_JOB_QUEUE: "false",
    AUTO_PUBLISH: "false",
  });

  assert.equal(parsed.valid, false);
  assert.ok(parsed.errors.includes("durable_job_queue_required"));
});

test("runtime config exposes one standard and one optional experimental renderer", () => {
  const parsed = parseRuntimeConfig({
    NODE_ENV: "test",
    PULSE_OPERATING_MODE: "LOCAL_PROOF",
    USE_JOB_QUEUE: "true",
  });

  assert.equal(parsed.values.PULSE_STANDARD_RENDERER, "studio-v21");
  assert.equal(
    parsed.values.PULSE_EXPERIMENTAL_RENDERER,
    "hyperframes-next",
  );
  assert.equal(parsed.valid, true);

  const disabledExperiment = parseRuntimeConfig({
    NODE_ENV: "test",
    PULSE_OPERATING_MODE: "LOCAL_PROOF",
    USE_JOB_QUEUE: "true",
    PULSE_EXPERIMENTAL_RENDERER: "disabled",
  });
  assert.equal(disabledExperiment.valid, true);
});

test("runtime config accepts the reviewed governed multi-lane scheduler profile", () => {
  const parsed = parseRuntimeConfig({
    NODE_ENV: "production",
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    USE_SQLITE: "true",
    USE_JOB_QUEUE: "true",
    AUTO_PUBLISH: "false",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
    PULSE_EMERGENCY_KILL_SWITCH: "true",
    PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
    PULSE_MULTI_LANE_WORKERS: "true",
    PULSE_MULTI_LANE_STARTUP_PRIME: "true",
    BREAKING_WATCHER_ENABLED: "true",
  });

  assert.equal(parsed.valid, true);
  assert.equal(
    parsed.values.PULSE_SCHEDULER_PROFILE,
    "governed_multi_lane",
  );
  assert.equal(parsed.values.PULSE_MULTI_LANE_WORKERS, true);
  assert.equal(parsed.values.PULSE_MULTI_LANE_STARTUP_PRIME, true);
  assert.equal(parsed.values.BREAKING_WATCHER_ENABLED, true);
  assert.equal(parsed.operating_contract.live_mutation_allowed, false);
});

test("runtime config carries one normalised non-secret OAuth client binding only when LIVE_GUARDED is fully armed", () => {
  const parsed = parseRuntimeConfig({
    NODE_ENV: "production",
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    USE_SQLITE: "true",
    USE_JOB_QUEUE: "true",
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "A".repeat(64),
  });

  assert.equal(parsed.valid, true);
  assert.equal(
    parsed.values.PULSE_YOUTUBE_OAUTH_CLIENT_SHA256,
    "a".repeat(64),
  );
  assert.equal(
    parsed.operating_contract.youtube_account_binding
      .expected_oauth_client_sha256,
    "a".repeat(64),
  );

  const report = buildEffectiveConfigReport({
    env: {
      NODE_ENV: "production",
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      USE_SQLITE: "true",
      USE_JOB_QUEUE: "true",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "A".repeat(64),
    },
  });
  const binding = report.entries.find(
    (entry) => entry.key === "PULSE_YOUTUBE_OAUTH_CLIENT_SHA256",
  );
  assert.equal(binding.present, true);
  assert.equal(binding.secret, false);
  assert.equal(binding.value, "a".repeat(64));
});

test("runtime config rejects legacy or invented active renderer generations", () => {
  for (const renderer of ["legacy", "studio-v2", "studio-v4"]) {
    const parsed = parseRuntimeConfig({
      NODE_ENV: "test",
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      USE_JOB_QUEUE: "true",
      PULSE_STANDARD_RENDERER: renderer,
    });
    assert.equal(parsed.valid, false);
    assert.ok(parsed.errors.includes("invalid_enum:PULSE_STANDARD_RENDERER"));
  }

  const duplicate = parseRuntimeConfig({
    NODE_ENV: "test",
    PULSE_OPERATING_MODE: "LOCAL_PROOF",
    USE_JOB_QUEUE: "true",
    PULSE_EXPERIMENTAL_RENDERER: "studio-v21",
  });
  assert.equal(duplicate.valid, false);
  assert.ok(
    duplicate.errors.includes("invalid_enum:PULSE_EXPERIMENTAL_RENDERER"),
  );
});

test("startup validation fails closed with structured production errors", () => {
  assert.throws(
    () =>
      assertValidRuntimeConfig({
        NODE_ENV: "production",
        PULSE_OPERATING_MODE: "LOCAL_PROOF",
        USE_SQLITE: "false",
        USE_JOB_QUEUE: "false",
        AUTO_PUBLISH: "true",
      }),
    (error) => {
      assert.equal(error.code, "PULSE_RUNTIME_CONFIG_INVALID");
      assert.ok(error.validationErrors.includes("production_requires_sqlite"));
      assert.ok(
        error.validationErrors.includes("production_requires_durable_job_queue"),
      );
      assert.ok(
        error.validationErrors.includes(
          "auto_publish_requires_live_guarded_mode",
        ),
      );
      return true;
    },
  );
});

test("startup validation enforces the secondary-platform automation freeze", () => {
  assert.throws(
    () =>
      assertValidRuntimeConfig({
        NODE_ENV: "test",
        PULSE_OPERATING_MODE: "LOCAL_PROOF",
        USE_JOB_QUEUE: "true",
        INSTAGRAM_AUTO_PUBLISH: "true",
      }),
    (error) => {
      assert.equal(error.code, "PULSE_RUNTIME_CONFIG_INVALID");
      assert.ok(
        error.validationErrors.includes(
          "operating_contract:secondary_platform_automation_frozen",
        ),
      );
      return true;
    },
  );
});

test("effective config report never exposes secret values", () => {
  const report = buildEffectiveConfigReport({
    env: {
      NODE_ENV: "production",
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      USE_SQLITE: "true",
      USE_JOB_QUEUE: "true",
      ELEVENLABS_API_KEY: "do-not-leak-this",
      YOUTUBE_CLIENT_SECRET: "also-secret",
    },
    sourceClasses: {
      NODE_ENV: "inherited",
      ELEVENLABS_API_KEY: "inherited",
    },
  });

  const serialised = JSON.stringify(report);
  assert.doesNotMatch(serialised, /do-not-leak-this|also-secret/);
  const apiKey = report.entries.find(
    (entry) => entry.key === "ELEVENLABS_API_KEY",
  );
  assert.equal(apiKey.present, true);
  assert.equal(apiKey.value, undefined);
  assert.match(apiKey.value_hash, /^sha256:/);
  assert.equal(apiKey.source_class, "inherited");
});

test("dotenv bootstrap is one-shot and never overrides an inherited value", () => {
  resetRuntimeConfigForTests();
  const env = {
    AUTO_PUBLISH: "false",
    TTS_PROVIDER: "elevenlabs",
  };
  let calls = 0;
  let options = null;
  const dotenv = {
    config(received) {
      calls += 1;
      options = received;
      env.AUTO_PUBLISH = "true";
      env.TTS_PROVIDER = "local";
      return {
        parsed: {
          AUTO_PUBLISH: "true",
          TTS_PROVIDER: "local",
        },
      };
    },
  };

  const first = loadDotenvOnce({ dotenv, env });
  const second = loadDotenvOnce({ dotenv, env });
  const legacyModuleCall = dotenv.config({ override: true });

  assert.equal(calls, 1);
  assert.equal(options.override, false);
  assert.equal(first.loaded, true);
  assert.equal(second.cached, true);
  assert.equal(legacyModuleCall.pulse_cached, true);
  assert.equal(env.AUTO_PUBLISH, "false");
  assert.equal(env.TTS_PROVIDER, "elevenlabs");
  resetRuntimeConfigForTests();
});

test("managed bootstrap suppresses cloud AI credentials unless paid AI is explicitly enabled", () => {
  resetRuntimeConfigForTests();
  const env = {
    PULSE_PAID_AI_ENABLED: "false",
  };
  const dotenv = {
    config() {
      env.ANTHROPIC_API_KEY = "anthropic-paid-secret";
      env.GOOGLE_AI_API_KEY = "google-paid-secret";
      env.ELEVENLABS_API_KEY = "metered-voice-secret";
      return {
        parsed: {
          ANTHROPIC_API_KEY: "anthropic-paid-secret",
          GOOGLE_AI_API_KEY: "google-paid-secret",
          ELEVENLABS_API_KEY: "metered-voice-secret",
        },
      };
    },
  };

  loadDotenvOnce({ dotenv, env });

  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.GOOGLE_AI_API_KEY, undefined);
  assert.equal(env.ELEVENLABS_API_KEY, "metered-voice-secret");
  resetRuntimeConfigForTests();

  const explicitlyPaidEnv = {
    PULSE_PAID_AI_ENABLED: "true",
  };
  const explicitlyPaidDotenv = {
    config() {
      explicitlyPaidEnv.ANTHROPIC_API_KEY = "attended-anthropic";
      explicitlyPaidEnv.GOOGLE_AI_API_KEY = "attended-google";
      return {
        parsed: {
          ANTHROPIC_API_KEY: "attended-anthropic",
          GOOGLE_AI_API_KEY: "attended-google",
        },
      };
    },
  };
  loadDotenvOnce({
    dotenv: explicitlyPaidDotenv,
    env: explicitlyPaidEnv,
  });
  assert.equal(
    explicitlyPaidEnv.ANTHROPIC_API_KEY,
    "attended-anthropic",
  );
  assert.equal(
    explicitlyPaidEnv.GOOGLE_AI_API_KEY,
    "attended-google",
  );
  resetRuntimeConfigForTests();
});

test("production entrypoints use the one-shot non-overriding environment loader", () => {
  const root = path.resolve(__dirname, "..", "..");
  for (const file of [
    "server.js",
    "run.js",
    "publisher.js",
    "processor.js",
    "audio.js",
  ]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /loadDotenvOnce/);
    assert.doesNotMatch(source, /dotenv\.config\(\{\s*override:\s*true/);
  }
});
