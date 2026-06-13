const { test } = require("node:test");
const assert = require("node:assert");

const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");

// Lock the guarded growth cadence in place. The previous single
// publish_primary at 19:00 UTC produced one Short per day, then Task 3
// added 09/14/19. Growth cadence adds two extra guarded windows without
// breaking the long-standing 19:00 idempotency key.

function byName(name) {
  return DEFAULT_SCHEDULES.find((s) => s.name === name);
}

test("schedules: five produce windows exist for guarded growth cadence", () => {
  const names = [
    "produce_morning",
    "produce_late_morning",
    "produce_afternoon",
    "produce_mid_afternoon",
    "produce_primary",
  ];
  for (const n of names) {
    assert.ok(byName(n), `missing schedule: ${n}`);
  }
});

test("schedules: five publish windows exist for guarded growth cadence", () => {
  const names = [
    "publish_morning",
    "publish_late_morning",
    "publish_afternoon",
    "publish_mid_afternoon",
    "publish_primary",
  ];
  for (const n of names) {
    assert.ok(byName(n), `missing schedule: ${n}`);
  }
});

test("schedules: each growth publish window has a produce lead-in", () => {
  const pairs = [
    ["produce_morning", "publish_morning", "0 8 * * *", "0 9 * * *"],
    ["produce_late_morning", "publish_late_morning", "30 10 * * *", "0 11 * * *"],
    ["produce_afternoon", "publish_afternoon", "0 13 * * *", "0 14 * * *"],
    ["produce_mid_afternoon", "publish_mid_afternoon", "0 15 * * *", "0 16 * * *"],
    ["produce_primary", "publish_primary", "0 18 * * *", "0 19 * * *"],
  ];
  for (const [prodName, pubName, prodCron, pubCron] of pairs) {
    const p = byName(prodName);
    const q = byName(pubName);
    assert.ok(p && q, `pair ${prodName}/${pubName} missing`);
    assert.strictEqual(p.cron_expr, prodCron);
    assert.strictEqual(q.cron_expr, pubCron);
  }
});

test("schedules: produce kind is 'produce' and publish kind is 'publish'", () => {
  for (const n of [
    "produce_morning",
    "produce_late_morning",
    "produce_afternoon",
    "produce_mid_afternoon",
    "produce_primary",
  ]) {
    assert.strictEqual(byName(n).kind, "produce");
  }
  for (const n of [
    "publish_morning",
    "publish_late_morning",
    "publish_afternoon",
    "publish_mid_afternoon",
    "publish_primary",
  ]) {
    assert.strictEqual(byName(n).kind, "publish");
  }
});

test("schedules: idempotency keys are unique per window", () => {
  const templates = DEFAULT_SCHEDULES.filter(
    (s) => s.kind === "produce" || s.kind === "publish",
  ).map((s) => s.idempotencyTemplate);
  const unique = new Set(templates);
  assert.strictEqual(
    unique.size,
    templates.length,
    `idempotency templates must be unique; got ${templates.join(", ")}`,
  );
});

test("schedules: legacy publish_primary idempotency key unchanged (prevents doubling-up today)", () => {
  // 2026-04-21 today's run has already fired a job keyed on
  // publish:{date}:19. If we renamed this template, tomorrow's
  // 19:00 would fire again with a different key — but
  // yesterday's idempotency history still carries 19-keyed rows
  // we don't want to invalidate. Pin the key so a future refactor
  // doesn't accidentally change it.
  assert.strictEqual(byName("publish_primary").cron_expr, "0 19 * * *");
  assert.strictEqual(
    byName("publish_primary").idempotencyTemplate,
    "publish:{date}:19",
  );
  assert.strictEqual(byName("produce_primary").cron_expr, "0 18 * * *");
  assert.strictEqual(
    byName("produce_primary").idempotencyTemplate,
    "produce:{date}:18",
  );
});

test("schedules: no duplicate schedule names", () => {
  const names = DEFAULT_SCHEDULES.map((s) => s.name);
  assert.strictEqual(new Set(names).size, names.length);
});

test("schedules: produce/publish priorities unchanged (regression)", () => {
  // produce has priority 30 (lower urgency than publish 20).
  // If a future reshuffling changes this, the runner could
  // process publish before its prerequisite produce.
  for (const n of [
    "produce_morning",
    "produce_late_morning",
    "produce_afternoon",
    "produce_mid_afternoon",
    "produce_primary",
  ]) {
    assert.strictEqual(byName(n).priority, 30);
  }
  for (const n of [
    "publish_morning",
    "publish_late_morning",
    "publish_afternoon",
    "publish_mid_afternoon",
    "publish_primary",
  ]) {
    assert.strictEqual(byName(n).priority, 20);
  }
});
