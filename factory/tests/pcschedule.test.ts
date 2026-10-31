import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  longRenderMinutes,
  pcWindows,
  plannedSlots,
  publishPcSchedule,
  shortWindows,
} from "../src/pcschedule.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";

// 27 Oct 2026 is GMT (clocks went back on the 25th), so local time = UTC.
const base = {
  newsSlots: ["17:00", "22:00"],
  slotLeadMinutes: 75,
  whyEnabled: false,
  evergreenEnabled: false,
  weeklyEnabled: false,
  dealsDays: [],
  cutdownsEnabled: false,
  longformEnabled: false,
  docEnabled: false,
};
const at = (iso: string) => new Date(iso);

test("each news slot keeps the PC free for its lead time", () => {
  const cfg = testConfig("/tmp", base);
  const w = pcWindows(cfg, at("2026-10-27T14:00:00Z"), []);
  assert.deepEqual(
    w.map((x) => [x.lane, x.from, x.until, x.done]),
    [
      ["news", "2026-10-27T15:45:00.000Z", "2026-10-27T17:00:00.000Z", false],
      ["news", "2026-10-27T20:45:00.000Z", "2026-10-27T22:00:00.000Z", false],
    ],
  );
});

test("a window is let go once its episode has rendered, or when no episode took the slot", () => {
  const cfg = testConfig("/tmp", base);
  const slot = "2026-10-27T17:00:00.000Z";
  const making = pcWindows(cfg, at("2026-10-27T16:00:00Z"), [
    { lane: "news", status: "voiced", slot_at: slot },
  ]);
  assert.equal(making[0]!.done, false);
  assert.match(making[0]!.note, /in production \(voiced\)/);
  const rendered = pcWindows(cfg, at("2026-10-27T16:00:00Z"), [
    { lane: "news", status: "rendered", slot_at: slot },
  ]);
  assert.equal(rendered[0]!.done, true);
  // nothing picked 20 min into the lead time: the lane had no story
  assert.equal(pcWindows(cfg, at("2026-10-27T15:50:00Z"), [])[0]!.done, false);
  assert.equal(
    pcWindows(cfg, at("2026-10-27T16:10:00Z"), [])[0]!.note,
    "no episode took the slot",
  );
  // a failed episode doesn't hold its slot
  assert.equal(
    pcWindows(cfg, at("2026-10-27T16:10:00Z"), [
      { lane: "news", status: "failed", slot_at: slot },
    ])[0]!.done,
    true,
  );
});

test("a long video keeps the PC free longer, but not for its whole lead time", () => {
  const cfg = testConfig("/tmp", {
    ...base,
    newsSlots: [],
    longformEnabled: true,
    longformDays: ["sun"],
    longformSlot: "19:00",
  });
  const [w] = plannedSlots(cfg, at("2026-11-01T09:00:00Z"));
  assert.equal(w!.lane, "longform");
  const [win] = pcWindows(cfg, at("2026-11-01T09:00:00Z"), []);
  assert.equal(win!.from, "2026-11-01T16:30:00.000Z"); // 150 min, not the 8 h lead
});

test("breaking Shorts and episodes with their own slots reserve the PC while they're made", () => {
  const cfg = testConfig("/tmp", { ...base, newsSlots: [] });
  const now = at("2026-10-27T10:00:00Z");
  const w = pcWindows(cfg, now, [
    { lane: "news_breaking", status: "scripted", slot_at: null },
    { lane: "gameplay", status: "selected", slot_at: "2026-10-27T21:00:00Z" },
    { lane: "gameplay", status: "published", slot_at: "2026-10-27T11:00:00Z" },
  ]);
  assert.deepEqual(
    w.map((x) => [x.lane, x.from, x.until]),
    [
      ["breaking", "2026-10-27T10:00:00.000Z", "2026-10-27T11:00:00.000Z"],
      ["gameplay", "2026-10-27T19:45:00.000Z", "2026-10-27T21:00:00.000Z"],
    ],
  );
});

test("the schedule is written where the orchestrator reads it, from the episodes table", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  fs.mkdirSync(path.join(dir, "state"));
  process.env.ORCH_RESERVATIONS_DIR = path.join(dir, "state", "reservations");
  try {
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane, priority, slot_at)
       VALUES ('e1', 'h1', 'voiced', '{}', 'news', 50, '2026-10-27T17:00:00Z')`,
    );
    await publishPcSchedule(db, testConfig(dir, base), at("2026-10-27T16:00:00Z"));
    const doc = JSON.parse(fs.readFileSync(path.join(dir, "state", "reservations", "pulse.json"), "utf8"));
    assert.equal(doc.project, "pulse");
    assert.equal(doc.windows[0].until, "2026-10-27T17:00:00.000Z");
    assert.equal(doc.windows[0].done, false);
    assert.match(doc.windows[0].note, /voiced/);
  } finally {
    delete process.env.ORCH_RESERVATIONS_DIR;
    await db.close?.();
  }
});

test("a long render waits for the Shorts' windows and goes in a gap long enough for it", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  process.env.ORCH_RESERVATIONS_DIR = path.join(dir, "state", "reservations");
  try {
    // 27 Oct 2026 is a Tuesday: Shorts at 17:00 and 22:00, a long video at 19:00.
    const cfg = testConfig(dir, {
      ...base,
      longformEnabled: true,
      longformDays: ["tue"],
      longformSlot: "19:00",
    });
    const own = at("2026-10-27T19:00:00Z");
    // What the long render would run into: the first Short window opening before a two-hour render is done.
    const clash = async (iso: string) =>
      (await shortWindows(db, cfg, at(iso), own)).find(
        (w) => Date.parse(w.from) < at(iso).getTime() + 120 * 60_000,
      );
    // 13:00: a two-hour render is done before the 17:00 Short's window opens at 15:45.
    assert.equal(await clash("2026-10-27T13:00:00Z"), undefined);
    // 14:00: it would still be running then.
    assert.equal((await clash("2026-10-27T14:00:00Z"))?.until, "2026-10-27T17:00:00.000Z");
    // Once that Short has rendered its window is let go, and the long video's own window never holds it back.
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane, priority, slot_at) VALUES
         ('s1', 'h1', 'rendered', '{}', 'news', 50, '2026-10-27T17:00:00Z'),
         ('l1', 'h2', 'voiced', '{}', 'longform', 40, '2026-10-27T19:00:00Z')`,
    );
    assert.equal(await clash("2026-10-27T16:30:00Z"), undefined);
    // A breaking Short being made holds it back at once.
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane, priority) VALUES ('b1', 'h3', 'scripted', '{}', 'news_breaking', 90)`,
    );
    assert.equal((await clash("2026-10-27T16:30:00Z"))?.lane, "breaking");
  } finally {
    delete process.env.ORCH_RESERVATIONS_DIR;
    await db.close?.();
  }
});

test("a long render is planned from the orchestrator's history, two hours without it", async () => {
  const dir = await tmpDir();
  const state = path.join(dir, "state");
  process.env.ORCH_RESERVATIONS_DIR = path.join(state, "reservations");
  try {
    assert.equal(longRenderMinutes(), 120);
    fs.mkdirSync(state, { recursive: true });
    const line = (kind: string, seconds: number, outcome = "done") =>
      JSON.stringify({ kind, seconds, outcome, project: "pulse" });
    fs.writeFileSync(
      path.join(state, "history.jsonl"),
      [line("pulse:long", 3000), line("pulse:short", 9000), line("pulse:long", 9000, "failed"), line("pulse:long", 5400)].join("\n"),
    );
    // The slowest finished long render (90 min) and 20 for the work around it.
    assert.equal(longRenderMinutes(), 110);
    // A preview excerpt alone never plans a full video at a few minutes.
    fs.writeFileSync(path.join(state, "history.jsonl"), line("pulse:long", 120));
    assert.equal(longRenderMinutes(), 80);
  } finally {
    delete process.env.ORCH_RESERVATIONS_DIR;
  }
});
