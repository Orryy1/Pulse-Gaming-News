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
  const env = { AUTO_PUBLISH: "false" };
  let calls = 0;
  let options = null;
  const dotenv = {
    config(received) {
      calls += 1;
      options = received;
      env.AUTO_PUBLISH = "true";
      return { parsed: { AUTO_PUBLISH: "true" } };
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
