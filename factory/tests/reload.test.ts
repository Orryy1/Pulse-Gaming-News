import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  RELOAD_EXIT_CODE,
  factoryIdle,
  inFlightCount,
  maybeReload,
  nextSlotWithin,
  pulseJobsIn,
  reloadFlag,
  slotTimes,
  type FactoryActivity,
} from "../src/reload.ts";
import { createEpisode, transition } from "../src/episodes.ts";
import { clusterItems } from "../src/discovery/cluster.ts";
import { item, testConfig, testDb, tmpDir } from "./helpers.ts";

const quiet: FactoryActivity = {
  ticking: false,
  longTicking: false,
  uploadsActive: 0,
  inFlight: 0,
  holdRestart: false,
  orchPulseJobs: 0,
};
const at = (iso: string) => new Date(iso);

test("the factory is idle only when nothing runs, nothing is about to, and no slot is near", () => {
  const now = at("2026-10-30T14:00:00Z");
  const slots = [at("2026-10-30T17:00:00Z"), at("2026-10-30T13:00:00Z")];
  assert.deepEqual(factoryIdle(quiet, slots, now, 30), {
    idle: true,
    why: "idle",
  });
  const blocked = (a: Partial<FactoryActivity>) =>
    factoryIdle({ ...quiet, ...a }, slots, now, 30);
  assert.match(blocked({ holdRestart: true }).why, /hold-restart/);
  assert.match(blocked({ ticking: true }).why, /Shorts tick/);
  assert.match(blocked({ longTicking: true }).why, /long-form tick/);
  assert.match(blocked({ uploadsActive: 1 }).why, /1 upload/);
  assert.match(blocked({ inFlight: 2 }).why, /2 episode/);
  assert.match(blocked({ orchPulseJobs: 1 }).why, /orchestrator/);
  for (const a of [
    blocked({ holdRestart: true }),
    blocked({ ticking: true }),
    blocked({ inFlight: 1 }),
  ])
    assert.equal(a.idle, false);
});

test("a slot inside the window blocks a reload; one just past or further off does not", () => {
  const slots = [at("2026-10-30T17:00:00Z")];
  assert.equal(
    factoryIdle(quiet, slots, at("2026-10-30T16:29:00Z"), 30).idle,
    true,
  );
  assert.equal(
    factoryIdle(quiet, slots, at("2026-10-30T16:30:00Z"), 30).idle,
    false,
  );
  assert.equal(
    factoryIdle(quiet, slots, at("2026-10-30T16:59:59Z"), 30).idle,
    false,
  );
  assert.equal(
    factoryIdle(quiet, slots, at("2026-10-30T17:00:01Z"), 30).idle,
    true,
  );
  assert.equal(
    nextSlotWithin(slots, at("2026-10-30T16:45:00Z"), 30)?.toISOString(),
    "2026-10-30T17:00:00.000Z",
  );
  assert.equal(
    nextSlotWithin(slots, at("2026-10-30T16:00:00Z"), 30),
    undefined,
  );
});

test("Pulse's jobs are counted from the orchestrator's leases and queue; bad JSON counts none", () => {
  const json = JSON.stringify({
    leases: [{ project: "orryy" }, { project: "pulse" }],
    waiting: [{ project: "pulse" }, { project: "explainer" }],
  });
  assert.equal(pulseJobsIn(json), 2);
  assert.equal(pulseJobsIn("{}"), 0);
  assert.equal(pulseJobsIn("not json"), 0);
});

test("episodes about to upload, mid-upload or breaking count as in flight; waiting ones do not", async () => {
  const db = await testDb();
  const now = at("2026-10-30T14:00:00Z");
  const make = async (
    id: string,
    lane: string,
    status: string,
    fields: Record<string, unknown> = {},
  ) => {
    const cluster = clusterItems([item(`Story ${id}`, "IGN")])[0]!;
    await createEpisode(db, id, cluster, { lane, priority: 50 });
    await transition(db, id, "selected", status as never, fields);
  };
  await make("waiting", "news", "rendered");
  await make("manual", "news", "awaiting_approval");
  await make("held", "news", "uploading", {
    next_attempt_at: at("2026-10-30T18:00:00Z"),
  }); // private hold until its slot
  assert.equal(await inFlightCount(db, now), 0);
  await make("soon", "news", "uploading", {
    next_attempt_at: at("2026-10-30T14:03:00Z"),
  });
  await make("mid", "news", "uploading");
  await make("ok", "news", "approved");
  await make("proc", "longform", "uploaded");
  await make("brk", "news_breaking", "scripted");
  assert.equal(await inFlightCount(db, now), 5);
  await db.close();
});

test("the slots ahead are the lanes' planned times plus live episodes' own slots and publish times", async () => {
  const db = await testDb();
  const cfg = testConfig("/tmp", {
    newsSlots: ["17:00"],
    whyEnabled: false,
    evergreenEnabled: false,
    weeklyEnabled: false,
    dealsDays: [],
    cutdownsEnabled: false,
    longformEnabled: false,
    docEnabled: false,
  });
  const now = at("2026-10-30T14:00:00Z"); // GMT: 17:00 London is 17:00Z
  const cluster = clusterItems([item("Story", "IGN")])[0]!;
  await createEpisode(db, "e1", cluster, {
    lane: "gameplay",
    priority: 35,
    slotAt: at("2026-10-30T15:30:00Z"),
  });
  const c2 = clusterItems([item("Other", "IGN")])[0]!;
  await createEpisode(db, "e2", c2, { lane: "news", priority: 50 });
  await transition(db, "e2", "selected", "uploading", {
    publish_at: at("2026-10-30T16:10:00Z"),
  });
  const c3 = clusterItems([item("Gone", "IGN")])[0]!;
  await createEpisode(db, "e3", c3, {
    lane: "news",
    priority: 50,
    slotAt: at("2026-10-30T14:30:00Z"),
  });
  await transition(db, "e3", "selected", "failed", {});
  const slots = (await slotTimes(db, cfg, now))
    .map((d) => d.toISOString())
    .sort();
  assert.deepEqual(slots, [
    "2026-10-30T15:30:00.000Z",
    "2026-10-30T16:10:00.000Z",
    "2026-10-30T17:00:00.000Z",
  ]);
  await db.close();
});

test("with the flag and an idle factory the process logs, tells Discord, drops the flag and exits 75; otherwise it waits", async () => {
  const dir = await tmpDir();
  const db = await testDb();
  const cfg = testConfig(dir, {
    newsSlots: ["17:00"],
    whyEnabled: false,
    evergreenEnabled: false,
    weeklyEnabled: false,
    dealsDays: [],
    cutdownsEnabled: false,
    longformEnabled: false,
    docEnabled: false,
  });
  const exits: number[] = [];
  const notices: string[] = [];
  const leasesFile = path.join(dir, "leases.json");
  await fs.writeFile(leasesFile, JSON.stringify({ leases: [], waiting: [] }));
  const deps = (
    now: Date,
    act = { ticking: false, longTicking: false, uploadsActive: 0 },
  ) => ({
    db,
    cfg,
    now,
    activity: () => act,
    notify: async (m: { content?: string }) =>
      void notices.push(m.content ?? ""),
    exit: (code: number) => void exits.push(code),
    leasesFile,
    state: {},
  });
  // No flag: nothing happens, however idle.
  assert.equal(await maybeReload(deps(at("2026-10-30T14:00:00Z"))), false);
  await fs.mkdir(path.dirname(reloadFlag(cfg)), { recursive: true });
  await fs.writeFile(reloadFlag(cfg), "");
  // Flag, but the long tick is running: wait.
  assert.equal(
    await maybeReload(
      deps(at("2026-10-30T14:00:00Z"), {
        ticking: false,
        longTicking: true,
        uploadsActive: 0,
      }),
    ),
    false,
  );
  // Flag, idle, but 20 minutes before the 17:00 slot: wait.
  assert.equal(await maybeReload(deps(at("2026-10-30T16:40:00Z"))), false);
  // Flag, idle, but a Pulse job in the orchestrator: wait.
  await fs.writeFile(
    leasesFile,
    JSON.stringify({ leases: [{ project: "pulse" }], waiting: [] }),
  );
  assert.equal(await maybeReload(deps(at("2026-10-30T14:00:00Z"))), false);
  await fs.writeFile(leasesFile, JSON.stringify({ leases: [], waiting: [] }));
  assert.deepEqual(exits, []);
  assert.ok(
    await fs.access(reloadFlag(cfg)).then(
      () => true,
      () => false,
    ),
    "the flag stays while waiting",
  );
  // Flag and truly idle: out we go.
  const events = async () =>
    db.query<{ kind: string; detail: any }>(
      `SELECT kind, detail FROM events WHERE kind = 'reload'`,
    );
  assert.equal((await events()).length, 0);
  const d = deps(at("2026-10-30T14:00:00Z"));
  // The real exit never returns; the test's db.close() happens inside maybeReload, so reopen for the check.
  let closed = false;
  const realClose = db.close;
  const e = await events();
  d.db = { ...db, close: async () => void (closed = true) } as typeof db;
  assert.equal(await maybeReload(d), true);
  assert.deepEqual(exits, [RELOAD_EXIT_CODE]);
  assert.equal(closed, true);
  assert.equal(
    await fs.access(reloadFlag(cfg)).then(
      () => true,
      () => false,
    ),
    false,
    "the flag is removed",
  );
  const after = await events();
  assert.equal(after.length - e.length, 1);
  assert.equal(after[0]!.detail.next_slot, "2026-10-30T17:00:00.000Z");
  assert.match(notices[0]!, /restarting to load new code/);
  await realClose();
});
