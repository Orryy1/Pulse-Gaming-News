import { test } from "node:test";
import assert from "node:assert/strict";
import { testConfig, testDb, tmpDir } from "./helpers.ts";
import {
  creditForecastAlert,
  creditLine,
  creditPeriod,
  forecastCredit,
  warnStep,
} from "../src/claudecredit.ts";
import { alertKind } from "../src/alertlog.ts";

test("the credit period runs from the renewal day to the next", () => {
  const a = creditPeriod(new Date("2026-11-05T12:00:00Z"), 1);
  assert.equal(a.start.toISOString().slice(0, 10), "2026-11-01");
  assert.equal(a.renews.toISOString().slice(0, 10), "2026-12-01");
  const b = creditPeriod(new Date("2026-11-05T12:00:00Z"), 15);
  assert.equal(b.start.toISOString().slice(0, 10), "2026-10-15");
  assert.equal(b.renews.toISOString().slice(0, 10), "2026-11-15");
  const c = creditPeriod(new Date("2026-01-05T12:00:00Z"), 15);
  assert.equal(c.start.toISOString().slice(0, 10), "2025-12-15");
});

test("the forecast: month to date, the recent pace, the date it runs out", () => {
  // $5 a day since the 1st of November; today (the 11th) half done.
  const spend = (d: string) =>
    d === "2026-11-11" ? 2 : d >= "2026-11-01" && d < "2026-11-11" ? 5 : 3;
  const f = forecastCredit(spend, new Date("2026-11-11T20:00:00Z"), 100, 1);
  assert.equal(f.spent, 52);
  assert.equal(f.pace, 5, "the last seven full days, not today");
  assert.equal(f.left, 48);
  assert.equal(f.daysLeft, 9);
  assert.equal(f.runsOut, "2026-11-20");
  const line = creditLine(f);
  assert.match(
    line,
    /^Claude credit: \$52\.00 of \$100\.00 spent since 2026-11-01, about \$5\.00 a day/,
  );
  assert.match(
    line,
    /runs out on 2026-11-20, 9 days from now and before it renews on 2026-12-01/,
  );
  assert.equal(alertKind(line), "claude_credit");
  assert.ok(!/[–—]/.test(line));
});

test("a pace that lasts past the renewal has no run-out date; a day without a log says nothing about the pace", () => {
  const f = forecastCredit(() => 2, new Date("2026-11-11T20:00:00Z"), 100, 1);
  assert.equal(f.runsOut, undefined);
  const gaps = forecastCredit(
    (d) => (d === "2026-11-10" ? 10 : 0),
    new Date("2026-11-11T20:00:00Z"),
    100,
    1,
  );
  assert.equal(gaps.pace, 10);
});

test("warning steps tighten as the date nears", () => {
  assert.equal(warnStep(10, 10), 0);
  assert.equal(warnStep(9, 10), 1);
  assert.equal(warnStep(4, 10), 2);
  assert.equal(warnStep(2, 10), 3);
});

test("the alert: first when the date is under 10 days away, again only as it nears, and a new period starts over", async () => {
  const db = await testDb();
  const c = testConfig(await tmpDir(), { claudeMonthlyCredit: 100 });
  const sent: Array<{ content?: string; ping?: boolean }> = [];
  const notify = async (m: { content?: string; ping?: boolean }) =>
    void sent.push(m);
  const at = (d: string) => new Date(`${d}T20:30:00Z`);
  // $6 a day is the working target: fine for the month's start.
  const six = () => 6;
  await creditForecastAlert(c, at("2026-11-03"), db, notify, six);
  assert.equal(sent.length, 0, "over 10 days left");
  // On the 7th: $42 spent, $58 left, 9 days left, the 16th.
  await creditForecastAlert(c, at("2026-11-07"), db, notify, six);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.ping, true);
  assert.match(sent[0]!.content!, /runs out on 2026-11-16/);
  await creditForecastAlert(c, at("2026-11-08"), db, notify, six);
  assert.equal(sent.length, 1, "a steady month says it once");
  await creditForecastAlert(c, at("2026-11-12"), db, notify, six);
  assert.equal(sent.length, 2, "closer: said again");
  await creditForecastAlert(c, at("2026-12-07"), db, notify, six);
  assert.equal(sent.length, 3, "a new period starts over");
  await creditForecastAlert(
    { ...c, claudeMonthlyCredit: 0 },
    at("2026-11-29"),
    db,
    notify,
    six,
  );
  assert.equal(sent.length, 3, "a credit of 0 turns it off");
  await db.close();
});
