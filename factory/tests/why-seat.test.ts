import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { maybeSelect } from "../src/pipeline.ts";
import type { Services } from "../src/pipeline.ts";
import { getEpisode, listEpisodes } from "../src/episodes.ts";
import { whySeatOpen } from "../src/whyseat.ts";
import type { Db } from "../src/db.ts";
import { testDb, testConfig, tmpDir } from "./helpers.ts";

// WHY_SLOT_SEAT (26 Nov 2026): on 25 Nov two slow Shorts filled both production seats from 17:16 to 19:01, every tick
// waited, and the 18:30 Why Short never started. A Why slot that is due now gets one seat past MAX_PRODUCING.

async function producing(db: Db, n: number) {
  for (let i = 0; i < n; i++)
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane) VALUES ($1, $1, 'scripted', $2, 'news')`,
      [
        `ep_busy_${i}`,
        JSON.stringify({ headline: `Busy Short ${i}`, items: [] }),
      ],
    );
}

async function setup(opts: {
  busy: number;
  at: string;
  seat?: boolean;
  dailyTarget?: number;
}) {
  const db = await testDb();
  const dir = await tmpDir();
  const runFile = path.join(dir, "run.json");
  await fs.writeFile(
    runFile,
    JSON.stringify([
      {
        kind: "why",
        date: "2026-11-26",
        slot: "18:30",
        question: "Why did Respawn never make Titanfall 3?",
        title: "Why Respawn never made Titanfall 3",
        game: "Titanfall 2",
        arc: "Loved; sold badly; the studio moved on.",
        angle: "What the studio said, in its own words.",
        sources: [
          {
            url: "https://www.ea.com/news/respawn",
            source: "EA",
            official: true,
          },
        ],
      },
    ]),
  );
  const cfg = testConfig(dir, {
    whyEnabled: true,
    whyDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    whySlots: ["12:00", "18:30", "22:00"],
    whySlot: "12:00",
    shortRunFile: runFile,
    maxProducing: 2,
    whySlotSeat: opts.seat ?? true,
    dailyTarget: opts.dailyTarget ?? 5,
  });
  await producing(db, opts.busy);
  const s = {
    db,
    cfg,
    now: () => new Date(opts.at),
    notify: async () => true,
    discover: async () => [],
    discoverEvergreen: async () => [],
    fetchArticle: async (url: string) => ({
      url,
      title: "Respawn",
      text: "Respawn moved on to Apex Legends.",
    }),
  } as unknown as Services;
  return { db, s };
}

const whys = async (db: Db) =>
  (await listEpisodes(db)).filter((e) => e.story_hash.startsWith("why:"));

test("a due Why slot takes the spare seat when both production seats are full", async () => {
  // Thursday 26 Nov, 17:16 London: inside the 18:30 slot's window, two Shorts mid-production.
  const { db, s } = await setup({ busy: 2, at: "2026-11-26T17:16:00Z" });
  const id = await maybeSelect(s);
  assert.ok(id, "the Why Short started");
  const ep = (await getEpisode(db, id!))!;
  assert.equal(
    ep.story_json.why?.question,
    "Why did Respawn never make Titanfall 3?",
  );
  assert.equal(new Date(ep.slot_at!).toISOString(), "2026-11-26T18:30:00.000Z");
  const seat = await db.query<{ detail: { producing: number; max: number } }>(
    `SELECT detail FROM events WHERE kind = 'why_seat' AND episode_id = $1`,
    [id],
  );
  assert.deepEqual(
    seat.map((r) => r.detail),
    [{ producing: 2, max: 2 }],
  );
  // The seat is one seat: with the Why in production too, the next tick waits.
  assert.equal(await maybeSelect(s), undefined);
  assert.equal((await whys(db)).length, 1);
  await db.close();
});

test("WHY_SLOT_SEAT=false keeps the old wait", async () => {
  const { db, s } = await setup({
    busy: 2,
    at: "2026-11-26T17:16:00Z",
    seat: false,
  });
  assert.equal(await maybeSelect(s), undefined);
  assert.equal((await whys(db)).length, 0);
  await db.close();
});

test("past the one seat nothing starts", async () => {
  const { db, s } = await setup({ busy: 3, at: "2026-11-26T17:16:00Z" });
  assert.equal(await maybeSelect(s), undefined);
  assert.equal((await whys(db)).length, 0);
  await db.close();
});

test("with no Why slot open the seat starts nothing, of any lane", async () => {
  // 14:00: the 12:00 slot's grace is over and the 18:30 window has not opened.
  const { db, s } = await setup({ busy: 2, at: "2026-11-26T14:00:00Z" });
  assert.equal(await maybeSelect(s), undefined);
  assert.equal((await listEpisodes(db)).length, 2, "only the two busy Shorts");
  await db.close();
});

test("the seat respects the day's Shorts allowance", async () => {
  // The two busy Shorts were made today, so an allowance of 2 is used up.
  const { db, s } = await setup({
    busy: 2,
    at: "2026-11-26T17:16:00Z",
    dailyTarget: 2,
  });
  assert.equal(await maybeSelect(s), undefined);
  assert.equal((await whys(db)).length, 0);
  await db.close();
});

test("whySeatOpen: one seat exactly at the limit, never with the setting off or no limit", () => {
  assert.equal(whySeatOpen(true, 2, 2), true);
  assert.equal(
    whySeatOpen(true, 1, 2),
    false,
    "under the limit the usual path runs",
  );
  assert.equal(whySeatOpen(true, 3, 2), false);
  assert.equal(whySeatOpen(false, 2, 2), false);
  assert.equal(whySeatOpen(true, 0, 0), false);
});
