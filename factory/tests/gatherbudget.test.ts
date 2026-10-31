import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GatherBudget,
  GatherOutOfTime,
  reportGatherStop,
} from "../src/assets/gatherbudget.ts";
import { testDb } from "./helpers.ts";

test("the budget runs out on the clock and remembers why", async () => {
  let t = 1_000_000;
  const clock = () => t;
  const b = new GatherBudget(45, undefined, clock);
  assert.equal(b.over(), false);
  assert.equal(b.remainingMs(), 45 * 60_000);
  t += 44 * 60_000;
  assert.equal(b.over(), false);
  assert.equal(await b.exhausted(), false);
  t += 61_000;
  assert.equal(b.over(), true);
  assert.equal(b.reason, "time");
  assert.equal(b.remainingMs(), 0);
  assert.equal(b.elapsedMinutes(), 45);
  // No limit at all.
  const none = new GatherBudget(0, undefined, clock);
  t += 10 * 3600_000;
  assert.equal(none.over(), false);
});

test("an urgent video waiting stops the gather early, with its reason", async () => {
  let asked = 0;
  const b = new GatherBudget(
    45,
    async () => (++asked > 1 ? "the recap is due" : undefined),
    () => 0,
  );
  assert.equal(await b.exhausted(), false);
  assert.equal(await b.exhausted(), true);
  assert.equal(b.reason, "the recap is due");
  assert.equal(b.over(), true);
  // Once stopped it stays stopped, without asking again.
  assert.equal(await b.exhausted(), true);
  assert.equal(asked, 2);
  // A preemption check that throws never stops a gather.
  const safe = new GatherBudget(
    45,
    async () => {
      throw new Error("db down");
    },
    () => 0,
  );
  assert.equal(await safe.exhausted(), false);
});

test("work past the budget resolves with the fallback and the gather moves on", async () => {
  let t = 0;
  const b = new GatherBudget(1 / 600, undefined, () => t); // 100 ms
  const slow = new Promise<string>((r) => setTimeout(() => r("late"), 2_000));
  const v = await b.within(slow, "fallback");
  assert.equal(v, "fallback");
  assert.equal(b.reason, "time");
  // A failing fetch resolves with the fallback too, never throws.
  const quick = new GatherBudget(45, undefined, () => t);
  assert.equal(await quick.within(Promise.reject(new Error("no")), "x"), "x");
  assert.equal(await quick.within(Promise.resolve("y"), "x"), "y");
  // Nothing left: the fallback at once.
  t = 46 * 60_000;
  assert.equal(await quick.within(new Promise(() => undefined), "z"), "z");
  assert.ok(new GatherOutOfTime() instanceof Error);
});

test("stopping early is logged as an event and told to the owner once, in plain English", async () => {
  const db = await testDb();
  let t = 0;
  const b = new GatherBudget(45, undefined, () => t);
  t = 46 * 60_000;
  assert.equal(b.over(), true);
  const notices: string[] = [];
  await reportGatherStop(
    db,
    async (m) => void notices.push(m.content),
    { id: "ep1", script_json: { headline: "Halo ranked" } },
    b,
    3,
  );
  assert.match(
    notices[0]!,
    /"Halo ranked": the media gather stopped after 46 minutes because its 45-minute budget \(GATHER_MAX_MINUTES\) ran out\. 3 entries still to come/,
  );
  const [ev] = await db.query<{ detail: any }>(
    `SELECT detail FROM events WHERE kind = 'gather_budget'`,
  );
  assert.deepEqual(ev!.detail, {
    reason: "time",
    minutes: 46,
    entries_left: 3,
  });
  await db.close();
});
