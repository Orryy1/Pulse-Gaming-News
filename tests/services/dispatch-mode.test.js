/**
 * tests/services/dispatch-mode.test.js
 *
 * Pins the Phase D dispatch-mode resolver. Both server.js and run.js
 * read from this helper, so pinning the matrix here pins the whole
 * cutover:
 *
 *   production -> queue only, strict (no legacy escape, bootstrap
 *                 failure throws).
 *   dev, default -> queue, non-strict (bootstrap failure skips
 *                   scheduler but does not fall through to legacy).
 *   dev, USE_JOB_QUEUE=false -> legacy_dev, non-strict.
 *   USE_JOB_QUEUE=false in prod -> ignored; stays queue+strict.
 *
 * Run: node --test tests/services/dispatch-mode.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveDispatchMode,
  isProduction,
} = require("../../lib/dispatch-mode");

test("isProduction: NODE_ENV=production is prod", () => {
  assert.equal(isProduction({ NODE_ENV: "production" }), true);
});

test("isProduction: RAILWAY_ENVIRONMENT set is prod", () => {
  assert.equal(isProduction({ RAILWAY_ENVIRONMENT: "production" }), true);
});

test("isProduction: RAILWAY_PUBLIC_URL set is prod", () => {
  assert.equal(
    isProduction({ RAILWAY_PUBLIC_URL: "https://pulse.example" }),
    true,
  );
});

test("isProduction: empty env is not prod", () => {
  assert.equal(isProduction({}), false);
});

test("isProduction: NODE_ENV=development is not prod", () => {
  assert.equal(isProduction({ NODE_ENV: "development" }), false);
});

test("resolveDispatchMode: production -> queue, strict", () => {
  const r = resolveDispatchMode({ env: { NODE_ENV: "production" } });
  assert.equal(r.mode, "queue");
  assert.equal(r.strict, true);
  assert.equal(r.reason, "production_queue_only");
});

test("resolveDispatchMode: production + USE_JOB_QUEUE=false still queue+strict", () => {
  // Production has NO escape hatch. The dev opt-out is deliberately
  // ignored so an operator cannot accidentally arm the legacy cron
  // block in Railway by flipping one env var.
  const r = resolveDispatchMode({
    env: { NODE_ENV: "production", USE_JOB_QUEUE: "false" },
  });
  assert.equal(r.mode, "queue");
  assert.equal(r.strict, true);
});

test("resolveDispatchMode: Railway environment is treated as production", () => {
  const r = resolveDispatchMode({
    env: { RAILWAY_ENVIRONMENT: "production", USE_JOB_QUEUE: "false" },
  });
  assert.equal(r.mode, "queue");
  assert.equal(r.strict, true);
});

test("resolveDispatchMode: dev default -> queue, non-strict", () => {
  const r = resolveDispatchMode({ env: {} });
  assert.equal(r.mode, "queue");
  assert.equal(r.strict, false);
  assert.equal(r.reason, "dev_queue_default");
});

test("resolveDispatchMode: dev + USE_JOB_QUEUE=false -> legacy_dev, non-strict", () => {
  const r = resolveDispatchMode({
    env: { NODE_ENV: "development", USE_JOB_QUEUE: "false" },
  });
  assert.equal(r.mode, "legacy_dev");
  assert.equal(r.strict, false);
  assert.equal(r.reason, "dev_explicit_legacy_opt_in");
});

test("resolveDispatchMode: dev + USE_JOB_QUEUE=true -> queue (same as default)", () => {
  // Explicit 'true' is a no-op vs default; the field is write-once opt-out.
  const r = resolveDispatchMode({ env: { USE_JOB_QUEUE: "true" } });
  assert.equal(r.mode, "queue");
  assert.equal(r.strict, false);
});

test("resolveDispatchMode: any other value than literal 'false' keeps queue", () => {
  // Guard against a typo like USE_JOB_QUEUE=0 or USE_JOB_QUEUE=off
  // accidentally reaching the legacy block.
  for (const v of ["0", "off", "no", "FALSE", "False", ""]) {
    const r = resolveDispatchMode({ env: { USE_JOB_QUEUE: v } });
    assert.equal(
      r.mode,
      "queue",
      `USE_JOB_QUEUE=${JSON.stringify(v)} unexpectedly selected legacy`,
    );
  }
});
