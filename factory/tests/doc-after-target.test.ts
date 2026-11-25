import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { maybeSelect } from "../src/pipeline.ts";
import type { Services } from "../src/pipeline.ts";
import { getEpisode } from "../src/episodes.ts";
import { testDb, testConfig, tmpDir } from "./helpers.ts";

// 24-25 Nov 2026: the documentary failed in the afternoon; with the day's Shorts already made, the selector stopped at
// the Shorts allowance and never reached the documentary lane, so its 19:00 slot passed empty.
test("the day's Shorts allowance used up still lets a due documentary be picked", async () => {
  const db = await testDb();
  const data = await tmpDir();
  const runFile = path.join(data, "run.json");
  await fs.writeFile(
    runFile,
    JSON.stringify([
      {
        kind: "doc",
        date: "2026-11-21",
        slot: "17:00",
        make_hours_before: 16,
        title: "The Story of a Game",
        franchise: "Grand Theft Auto V",
        wiki: "Grand Theft Auto V",
        angle: "How it was made",
      },
    ]),
  );
  // Today's one allowed Short is already made (created now, so it counts on today's date).
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane)
     VALUES ('ep_short_today', 'h_short_today', 'published', '{"headline":"A Short","items":[]}', 'news')`,
  );
  const cfg = testConfig(data, {
    dailyTarget: 1,
    longformEnabled: true,
    docEnabled: true,
    docBreakoutPicker: false,
    docWeeks: [],
    surplusDocDays: [],
    shortRunFile: runFile,
  });
  const s = {
    db,
    cfg,
    now: () => new Date("2026-11-21T02:00:00Z"),
    notify: async () => true,
    discover: async () => [],
  } as unknown as Services;
  const id = await maybeSelect(s);
  assert.ok(id, "a documentary was picked past the Shorts allowance");
  const ep = (await getEpisode(db, id!))!;
  assert.equal(ep.lane, "longform");
  assert.equal((ep.factcheck_json as { doc?: unknown } | null)?.doc, true);
  await db.close();
});

// Review of the fix: a documentary that fails on the day it was picked must be replaceable that same day (its key was
// the day and franchise, which collided with the failed row, so the replacement was refused).
test("a documentary that failed today is replaced the same day, and a live one is never doubled", async () => {
  const { maybeSelectDocumentary } = await import("../src/pipeline.ts");
  const db = await testDb();
  const data = await tmpDir();
  const runFile = path.join(data, "run.json");
  await fs.writeFile(
    runFile,
    JSON.stringify([
      {
        kind: "doc",
        date: "2026-11-21",
        slot: "17:00",
        make_hours_before: 16,
        title: "The Story of a Game",
        franchise: "Grand Theft Auto V",
        wiki: "Grand Theft Auto V",
        angle: "How it was made",
      },
    ]),
  );
  const cfg = testConfig(data, {
    longformEnabled: true,
    docEnabled: true,
    docBreakoutPicker: false,
    docWeeks: [],
    surplusDocDays: [],
    shortRunFile: runFile,
  });
  const s = {
    db,
    cfg,
    now: () => new Date("2026-11-21T02:00:00Z"),
    notify: async () => true,
  } as unknown as Services;
  const first = await maybeSelectDocumentary(s);
  assert.ok(first);
  assert.equal(await maybeSelectDocumentary(s), undefined, "a live documentary holds its slot");
  await db.query(`UPDATE episodes SET status = 'failed' WHERE id = $1`, [first]);
  const second = await maybeSelectDocumentary(s);
  assert.ok(second, "the failed one is replaced the same day");
  assert.notEqual(second, first);
  assert.equal(await maybeSelectDocumentary(s), undefined, "the replacement is not doubled");
  await db.query(`UPDATE episodes SET status = 'failed' WHERE id = $1`, [second]);
  assert.ok(await maybeSelectDocumentary(s), "and a second failure is replaced too");
  await db.close();
});
