const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLocalPrimaryReadiness,
  CRITICAL_ENV_KEYS,
  formatLocalPrimaryReadinessMarkdown,
  truthy,
} = require("../../lib/ops/local-primary-readiness");
const { findDuplicateEnvKeys } = require("../../tools/local-primary-readiness");

test("local primary readiness blocks mirror mode even when other flags are set", async () => {
  const report = await buildLocalPrimaryReadiness({
    env: {
      DEPLOYMENT_MODE: "local",
      PULSE_PRIMARY_INSTANCE: "false",
      USE_SQLITE: "true",
      USE_JOB_QUEUE: "true",
      AUTO_PUBLISH: "true",
      LOCAL_PUBLIC_URL: "https://pulse.orryy.com",
      MEDIA_ROOT: "D:/pulse-data/media",
      SQLITE_DB_PATH: "D:/pulse-data/pulse.db",
      PORT: "3001",
    },
    localHealth: { ok: true, status: 200, json: { status: "ok" } },
    publicHealth: {
      ok: true,
      status: 200,
      json: { status: "ok", deployment: { mode: "local", primary: false } },
    },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.checks.primary_enabled, false);
  assert.ok(report.blockers.includes("PULSE_PRIMARY_INSTANCE is not true"));
});

test("local primary readiness blocks duplicate critical env keys", async () => {
  const report = await buildLocalPrimaryReadiness({
    env: {
      DEPLOYMENT_MODE: "local",
      PULSE_PRIMARY_INSTANCE: "true",
      USE_SQLITE: "true",
      USE_JOB_QUEUE: "true",
      AUTO_PUBLISH: "true",
      LOCAL_PUBLIC_URL: "https://pulse.orryy.com",
      MEDIA_ROOT: "D:/pulse-data/media",
      SQLITE_DB_PATH: "D:/pulse-data/pulse.db",
    },
    duplicateEnvKeys: ["AUTO_PUBLISH", "USE_JOB_QUEUE"],
    localHealth: { ok: true, status: 200, json: { status: "ok" } },
    publicHealth: {
      ok: true,
      status: 200,
      json: { status: "ok", deployment: { mode: "local", primary: true } },
    },
  });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.includes("duplicate critical .env keys: AUTO_PUBLISH, USE_JOB_QUEUE"));
});

test("local primary readiness is green only when local and public health agree", async () => {
  const report = await buildLocalPrimaryReadiness({
    env: {
      DEPLOYMENT_MODE: "local",
      PULSE_PRIMARY_INSTANCE: "true",
      USE_SQLITE: "true",
      USE_JOB_QUEUE: "true",
      AUTO_PUBLISH: "true",
      LOCAL_PUBLIC_URL: "https://pulse.orryy.com",
      MEDIA_ROOT: "D:/pulse-data/media",
      SQLITE_DB_PATH: "D:/pulse-data/pulse.db",
      PORT: "3001",
    },
    localHealth: { ok: true, status: 200, json: { status: "ok" } },
    publicHealth: {
      ok: true,
      status: 200,
      json: { status: "ok", deployment: { mode: "local", primary: true } },
    },
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.recommendation, "local_primary_ready_for_controlled_start");
});

test("local primary readiness blocks public localhost URLs", async () => {
  const report = await buildLocalPrimaryReadiness({
    env: {
      DEPLOYMENT_MODE: "local",
      PULSE_PRIMARY_INSTANCE: "true",
      USE_SQLITE: "true",
      USE_JOB_QUEUE: "true",
      AUTO_PUBLISH: "true",
      LOCAL_PUBLIC_URL: "http://localhost:3001",
      MEDIA_ROOT: "D:/pulse-data/media",
      SQLITE_DB_PATH: "D:/pulse-data/pulse.db",
      PORT: "3001",
    },
    localHealth: { ok: true, status: 200, json: { status: "ok" } },
    publicHealth: { ok: true, status: 200, json: { status: "ok" } },
  });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.includes("public URL is localhost"));
});

test("local primary readiness markdown is operator readable", async () => {
  const report = await buildLocalPrimaryReadiness({
    env: {
      DEPLOYMENT_MODE: "local",
      PULSE_PRIMARY_INSTANCE: "false",
      USE_SQLITE: "true",
      USE_JOB_QUEUE: "true",
      AUTO_PUBLISH: "true",
      LOCAL_PUBLIC_URL: "https://pulse.orryy.com",
      MEDIA_ROOT: "D:/pulse-data/media",
      SQLITE_DB_PATH: "D:/pulse-data/pulse.db",
    },
    localHealth: { ok: false, error: "connection refused" },
    publicHealth: { ok: false, status: null, error: "530" },
  });
  const md = formatLocalPrimaryReadinessMarkdown(report);
  assert.match(md, /# Local Primary Readiness/);
  assert.match(md, /PULSE_PRIMARY_INSTANCE is not true/);
  assert.match(md, /Safety: read-only/);
});

test("truthy handles production flag spellings", () => {
  assert.equal(truthy("true"), true);
  assert.equal(truthy("1"), true);
  assert.equal(truthy("yes"), true);
  assert.equal(truthy("false"), false);
  assert.equal(truthy(""), false);
});

test("findDuplicateEnvKeys reports duplicate keys without values", async (t) => {
  const fs = require("fs-extra");
  const path = require("node:path");
  const os = require("node:os");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-env-dupes-"));
  t.after(() => fs.remove(dir));
  const envPath = path.join(dir, ".env");
  await fs.writeFile(
    envPath,
    [
      "AUTO_PUBLISH=true",
      "API_TOKEN=secret",
      "AUTO_PUBLISH=false",
      "# USE_JOB_QUEUE=true",
      "USE_JOB_QUEUE=true",
      "USE_JOB_QUEUE=false",
    ].join("\n"),
  );

  assert.deepEqual(findDuplicateEnvKeys(envPath), [
    "AUTO_PUBLISH",
    "USE_JOB_QUEUE",
  ]);
  assert.ok(CRITICAL_ENV_KEYS.has("AUTO_PUBLISH"));
});
