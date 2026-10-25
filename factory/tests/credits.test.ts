import { test } from "node:test";
import assert from "node:assert/strict";
import { creditPlan, creditLine } from "../src/voice/credits.ts";

const QUOTA = 500_000;

test("credits that would sit above two months' worth at the reset are flagged, net of the pace still to come", () => {
  // 25 Oct: 248,036 used of a 1.5M ceiling, resetting 4 Nov (21 days into a 31-day cycle).
  const p = creditPlan({ used: 248_036, limit: 1_500_000, resetAt: new Date("2026-11-04T01:44:04Z") }, QUOTA, new Date("2026-10-25T17:00:00Z"));
  assert.equal(p.left, 1_251_964);
  assert.ok(p.pacePerDay > 11_000 && p.pacePerDay < 12_500, `pace ${p.pacePerDay}`);
  assert.ok(p.wasteAtReset > 120_000 && p.wasteAtReset < 150_000, `waste ${p.wasteAtReset}`);
  assert.ok(p.surplusPerDay > 12_000, "about one documentary's worth every three days");
  assert.match(creditLine(p), /would be lost, so extra documentaries are on/);
});

test("a balance that will fall under two months' worth by the reset loses nothing", () => {
  const p = creditPlan({ used: 600_000, limit: 1_500_000, resetAt: new Date("2026-11-04T00:00:00Z") }, QUOTA, new Date("2026-10-25T00:00:00Z"));
  assert.equal(p.wasteAtReset, 0);
  assert.equal(p.surplusPerDay, 0);
  assert.match(creditLine(p), /without losing any/);
});
