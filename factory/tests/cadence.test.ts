import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb, testConfig } from "./helpers.ts";
import type { DiscordMessage } from "../src/approval/discord.ts";
import {
  capNoticeDue,
  heldBackLine,
  holdSlotForCap,
  newsCapReached,
  newsMadeToday,
  slotLabel,
} from "../src/cadence.ts";

test("the cap: 0 means none; reached at the cap, not before", () => {
  assert.equal(newsCapReached(0, 9), false);
  assert.equal(newsCapReached(3, 2), false);
  assert.equal(newsCapReached(3, 3), true);
  assert.equal(newsCapReached(3, 5), true);
});

test("the evening-summary line names the cap, the slot and the best three stories left on the shelf", () => {
  const line = heldBackLine(3, 3, "22:00", [
    { headline: "Switch 2 price rises in Japan", score: 48 },
    { headline: "GTA 6 trailer three lands", score: 91 },
    { headline: "Elden Ring patch 1.16", score: 30 },
    { headline: "Halo studio layoffs reported", score: 61 },
  ]);
  assert.equal(
    line,
    'Shorts cap: 3 news Shorts already today, the SHORTS_PER_DAY_MAX limit of 3, so the 22:00 slot was held back. 4 stories stayed on the shelf: "GTA 6 trailer three lands" (score 91), "Halo studio layoffs reported" (score 61), "Switch 2 price rises in Japan" (score 48) and 1 more. Raise SHORTS_PER_DAY_MAX (or set it to 0) to allow more.',
  );
  assert.match(
    heldBackLine(1, 1, "17:00", []),
    /1 news Short already today.*No other story was waiting for it\./,
  );
  assert.match(
    heldBackLine(2, 2, "17:00", [{ headline: "x", score: 5 }]),
    /1 story stayed on the shelf: "x" \(score 5\)\./,
  );
  assert.ok(!line.includes("—") && !line.includes("–"));
  assert.equal(
    slotLabel(new Date("2026-11-02T22:00:00Z"), "Europe/London"),
    "22:00",
  );
  assert.equal(
    slotLabel(new Date("2026-07-02T21:00:00Z"), "Europe/London"),
    "22:00",
  );
});

test("holding a slot: only with a cap, only once the day's news Shorts reach it, reported once a day", async () => {
  const db = await testDb();
  const sent: DiscordMessage[] = [];
  const notify = async (m: DiscordMessage) => void sent.push(m);
  const now = new Date();
  const slot = new Date(now.getTime() + 60 * 60_000);
  const add = async (lane: string, status = "scripted") =>
    db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane) VALUES ($1, $1, $2, '{"headline":"x","items":[]}', $3)`,
      [`ep_${lane}_${Math.random().toString(36).slice(2)}`, status, lane],
    );
  await add("news");
  await add("news_breaking");
  await add("evergreen");
  await add("news", "rejected");
  assert.equal(
    await newsMadeToday(db, "Europe/London"),
    2,
    "news and breaking count, evergreen and rejected do not",
  );

  const none = testConfig("", { shortsPerDayMax: 0 });
  assert.equal(await holdSlotForCap(db, none, now, slot, [], notify), false);
  const three = testConfig("", { shortsPerDayMax: 3 });
  assert.equal(await holdSlotForCap(db, three, now, slot, [], notify), false);
  await add("news");
  const waiting = [{ headline: "Left behind", score: 40 }];
  assert.equal(
    await holdSlotForCap(db, three, now, slot, waiting, notify),
    true,
  );
  assert.equal(sent.length, 1);
  assert.equal(
    sent[0]!.level,
    "info",
    "a line for the evening summary, not a ping",
  );
  assert.match(
    sent[0]!.content!,
    /3 news Shorts already today, the SHORTS_PER_DAY_MAX limit of 3/,
  );
  assert.match(sent[0]!.content!, /"Left behind" \(score 40\)/);
  // The next tick that day holds the slot again but stays quiet.
  assert.equal(
    await holdSlotForCap(db, three, now, slot, waiting, notify),
    true,
  );
  assert.equal(sent.length, 1);
  const events = await db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE kind = 'news_cap_hold'`,
  );
  assert.equal(events.length, 1);
  // A new day is reported again.
  assert.equal(await capNoticeDue(db, "2099-01-01"), true);
  assert.equal(await capNoticeDue(db, "2099-01-01"), false);
  await db.close();
});
