const { test } = require("node:test");
const assert = require("node:assert");

const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");

// Lock the three-windows-a-day cadence Task 3 introduced in place.
// The previous single publish_primary at 19:00 UTC produced one
// Short per day; this suite pins the addition of morning +
// afternoon windows without breaking the long-standing 19:00
// idempotency key.

function byName(name) {
  return DEFAULT_SCHEDULES.find((s) => s.name === name);
}

test("schedules: three produce windows exist (morning / afternoon / primary)", () => {
  const names = ["produce_morning", "produce_afternoon", "produce_primary"];
  for (const n of names) {
    assert.ok(byName(n), `missing schedule: ${n}`);
  }
});

test("schedules: three publish windows exist (morning / afternoon / primary)", () => {
  const names = ["publish_morning", "publish_afternoon", "publish_primary"];
  for (const n of names) {
    assert.ok(byName(n), `missing schedule: ${n}`);
  }
});

test("schedules: each publish window fires 1h AFTER its produce pair", () => {
  const pairs = [
    ["produce_morning", "publish_morning", 8, 9],
    ["produce_afternoon", "publish_afternoon", 13, 14],
    ["produce_primary", "publish_primary", 18, 19],
  ];
  for (const [prodName, pubName, prodHour, pubHour] of pairs) {
    const p = byName(prodName);
    const q = byName(pubName);
    assert.ok(p && q, `pair ${prodName}/${pubName} missing`);
    assert.strictEqual(p.cron_expr, `0 ${prodHour} * * *`);
    assert.strictEqual(q.cron_expr, `0 ${pubHour} * * *`);
  }
});

test("schedules: produce kind is 'produce' and publish kind is 'publish'", () => {
  for (const n of ["produce_morning", "produce_afternoon", "produce_primary"]) {
    assert.strictEqual(byName(n).kind, "produce");
  }
  for (const n of ["publish_morning", "publish_afternoon", "publish_primary"]) {
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
  for (const n of ["produce_morning", "produce_afternoon", "produce_primary"]) {
    assert.strictEqual(byName(n).priority, 30);
  }
  for (const n of ["publish_morning", "publish_afternoon", "publish_primary"]) {
    assert.strictEqual(byName(n).priority, 20);
  }
});
