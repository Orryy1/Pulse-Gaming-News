import { test } from "node:test";
import assert from "node:assert/strict";
import { longReslot, whenLabel } from "../src/longreslot.ts";

const TZ = "Europe/London";

test("a documentary that missed Wed 19:00 and is ready at 03:00 goes out Thu 19:00, not at once", () => {
  const to = longReslot(new Date("2026-11-25T19:00:00Z"), new Date("2026-11-26T03:00:00Z"), TZ, 3);
  assert.equal(to?.toISOString(), "2026-11-26T19:00:00.000Z");
});

test("a slot still ahead, or only just missed, is left alone", () => {
  const slot = new Date("2026-11-26T19:00:00Z");
  assert.equal(longReslot(slot, new Date("2026-11-26T12:00:00Z"), TZ, 3), undefined);
  assert.equal(longReslot(slot, new Date("2026-11-26T20:30:00Z"), TZ, 3), undefined);
});

test("today's hour already too close rolls to tomorrow", () => {
  const to = longReslot(new Date("2026-11-24T19:00:00Z"), new Date("2026-11-26T18:30:00Z"), TZ, 3);
  assert.equal(to?.toISOString(), "2026-11-27T19:00:00.000Z");
});

test("keeps the local wall-clock hour across a clock change", () => {
  // 17:00 BST on 24 Oct is 16:00Z; after the change on 25 Oct, 17:00 GMT is 17:00Z.
  const to = longReslot(new Date("2026-10-24T16:00:00Z"), new Date("2026-10-25T08:00:00Z"), TZ, 3);
  assert.equal(to?.toISOString(), "2026-10-25T17:00:00.000Z");
});

test("the notice names the day", () => {
  assert.equal(whenLabel(new Date("2026-11-26T19:00:00Z"), TZ), "Thu 26 Nov 19:00");
});
