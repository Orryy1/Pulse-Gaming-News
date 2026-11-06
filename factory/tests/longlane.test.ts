import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LONG_LEASE,
  isUrgentLong,
  longDueAt,
  longLaneStalled,
  orderLongEpisodes,
  releaseLongLease,
  watchLongLane,
} from "../src/longlane.ts";
import { withLease } from "../src/db.ts";
import { testDb } from "./helpers.ts";

const at = (iso: string) => new Date(iso);
const now = at("2026-10-30T15:10:00Z");
const row = (id: string, status: string, slot?: string, publish?: string) => ({
  id,
  status,
  slot_at: slot ?? null,
  publish_at: publish ?? null,
});

test("an unscripted long video due within three hours is urgent; a voiced or slotless one is not", () => {
  assert.equal(
    isUrgentLong(row("recap", "selected", "2026-10-30T18:00:00Z"), now),
    true,
  );
  assert.equal(
    isUrgentLong(row("recap", "scripted", "2026-10-30T18:09:00Z"), now),
    true,
  );
  assert.equal(
    isUrgentLong(row("missed", "selected", "2026-10-30T14:00:00Z"), now),
    true,
    "a slot just missed is most urgent",
  );
  assert.equal(
    isUrgentLong(row("later", "selected", "2026-10-30T18:11:00Z"), now),
    false,
  );
  assert.equal(
    isUrgentLong(row("voiced", "voiced", "2026-10-30T16:00:00Z"), now),
    false,
  );
  assert.equal(isUrgentLong(row("none", "selected"), now), false);
  assert.equal(
    longDueAt(
      row("p", "selected", "2026-10-31T19:00:00Z", "2026-10-30T20:00:00Z"),
    ),
    at("2026-10-30T20:00:00Z").getTime(),
    "the publish time wins over the slot",
  );
});

test("the lane's order: urgent first, then nearest slot, a made episode before an unmade one, slotless last", () => {
  const eps = [
    row("halo-render", "voiced", "2026-11-01T19:00:00Z"), // nearest slot, but the recap is urgent
    row("none", "selected"),
    row("recap", "selected", "2026-10-30T20:00:00Z"),
    row("doc-upload", "approved", "2026-11-01T19:00:00Z"), // made: ahead of the render at the same time
    row("bank", "scripted", "2026-11-07T19:00:00Z"),
  ];
  assert.deepEqual(
    orderLongEpisodes(eps, now).map((e) => e.id),
    ["recap", "doc-upload", "halo-render", "bank", "none"],
  );
  // Stable among equals: the order they came in (oldest first) holds.
  assert.deepEqual(
    orderLongEpisodes([row("a", "selected"), row("b", "selected")], now).map(
      (e) => e.id,
    ),
    ["a", "b"],
  );
});

test("the lane is stalled only when no pass completed for the limit and nothing long-running is in progress", () => {
  const base = {
    startedAt: "2026-10-30T12:00:00Z",
    lastLongTick: "2026-10-30T12:30:00Z",
    longTicking: true,
    rendering: false,
    uploading: false,
  };
  assert.equal(
    longLaneStalled(base, at("2026-10-30T15:01:00Z"), 150).stalled,
    true,
  );
  assert.equal(
    longLaneStalled(base, at("2026-10-30T15:00:00Z"), 150).stalled,
    false,
  );
  assert.equal(
    longLaneStalled(
      { ...base, rendering: true },
      at("2026-10-30T16:00:00Z"),
      150,
    ).stalled,
    false,
  );
  assert.equal(
    longLaneStalled(
      { ...base, uploading: true },
      at("2026-10-30T16:00:00Z"),
      150,
    ).stalled,
    false,
  );
  // Before the first completed pass the process start counts.
  assert.equal(
    longLaneStalled(
      { ...base, lastLongTick: undefined },
      at("2026-10-30T13:00:00Z"),
      150,
    ).stalled,
    false,
  );
  assert.equal(
    longLaneStalled(
      { ...base, lastLongTick: undefined },
      at("2026-10-30T14:31:00Z"),
      150,
    ).stalled,
    true,
  );
  assert.match(
    longLaneStalled(base, at("2026-10-30T15:01:00Z"), 150).why,
    /151 minutes and one is still running/,
  );
});

test("the watchdog releases the stuck lease, logs, warns once per stall and resets the running flag; a render is left alone", async () => {
  const db = await testDb();
  // A pass that holds the lease for hours: its holder sees held() flip to false once the watchdog acts.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let heldBefore: boolean | undefined;
  let heldAfter: boolean | undefined;
  const stuck = withLease(db, LONG_LEASE, 6 * 3600, async (lease) => {
    heldBefore = await lease.held();
    await gate;
    heldAfter = await lease.held();
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(heldBefore, true);
  const notices: string[] = [];
  let resets = 0;
  const state = {
    startedAt: "2026-10-30T12:00:00Z",
    lastLongTick: "2026-10-30T12:30:00Z",
    longTicking: true,
    rendering: true,
    uploading: false,
    stallReported: undefined as string | undefined,
  };
  const deps = (rendering: boolean) => ({
    db,
    now: at("2026-10-30T15:30:00Z"),
    stallMinutes: 150,
    state: Object.assign(state, { rendering }),
    notify: async (m: { content: string }) => void notices.push(m.content),
    reset: () => void resets++,
  });
  assert.equal(
    await watchLongLane(deps(true)),
    false,
    "a render in progress is never interrupted",
  );
  assert.equal(await watchLongLane(deps(false)), true);
  assert.equal(resets, 1);
  assert.match(notices[0]!, /has not finished a pass for 180 minutes/);
  const events = await db.query<{ kind: string; detail: any }>(
    `SELECT kind, detail FROM events WHERE kind = 'long_lane_stalled'`,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]!.detail.minutes, 180);
  assert.ok(events[0]!.detail.holder, "the released holder is recorded");
  // Once per stall: the same stale pass is not reported again, and another holder may now take the lane.
  assert.equal(await watchLongLane(deps(false)), false);
  assert.equal(notices.length, 1);
  const next = await withLease(db, LONG_LEASE, 60, async () => "took it");
  assert.equal(next, "took it");
  release();
  await stuck;
  assert.equal(heldAfter, false, "the stuck holder learns its lease is gone");
  assert.equal(
    await releaseLongLease(db),
    undefined,
    "nothing left to release",
  );
  await db.close();
});
