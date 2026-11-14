import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb, testConfig } from "./helpers.ts";
import type { DiscordMessage } from "../src/approval/discord.ts";
import {
  breakingAllowance,
  breakingHeldLine,
  breakingScore,
  whySlotsAhead,
  whySlotTimes,
} from "../src/storymix.ts";
import { slotList, whySlotsFrom } from "../src/config.ts";
import {
  heldBackLine,
  holdSlotForCap,
  holdWhyForCap,
  whyHeldLine,
} from "../src/cadence.ts";
import { pcWindows, plannedSlots } from "../src/pcschedule.ts";
import { uploadsLeftToday } from "../src/pipeline.ts";

// 3 Nov 2026 is GMT, so London time = UTC.
const why = {
  whyEnabled: true,
  whyDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  whySlots: ["12:00", "18:30"],
  slotGraceMinutes: 30,
  timezone: "Europe/London",
};

test("one breaking Short a day; a second only at the big score; then none", () => {
  assert.deepEqual(breakingAllowance(0, 1, 95), { open: true, minScore: 0 });
  assert.deepEqual(breakingAllowance(1, 1, 95), { open: true, minScore: 95 });
  assert.deepEqual(breakingAllowance(2, 1, 95), { open: false, minScore: 0 });
  // 0 turns the extra off; the old two-a-day still works when set.
  assert.deepEqual(breakingAllowance(1, 1, 0), { open: false, minScore: 0 });
  assert.deepEqual(breakingAllowance(1, 2, 0), { open: true, minScore: 0 });
  // A sprint's extra Shorts are added to the day's allowance by the caller.
  assert.deepEqual(breakingAllowance(3, 1 + 3, 95), {
    open: true,
    minScore: 0,
  });
  assert.equal(breakingScore({ score: 70 }, { max_score: 96 }), 96);
  assert.equal(breakingScore({ score: 80 }), 80);
  const line = breakingHeldLine("Big GTA story", 88.4, 1, 95);
  assert.equal(
    line,
    'Breaking: "Big GTA story" (score 88) was not rushed out, because today\'s breaking Short is already made and a second needs a score of 95 (BREAKING_BIG_SCORE). It can still fill a news slot.',
  );
  assert.ok(!/[\u2014\u2013]/.test(line));
});

test("WHY_SLOTS takes a list; an older WHY_SLOT alone is one slot; the default is two a day", () => {
  assert.deepEqual(whySlotsFrom("18:30, 12:00", "09:00"), ["12:00", "18:30"]);
  assert.deepEqual(whySlotsFrom("", "18:30"), ["18:30"]);
  assert.deepEqual(whySlotsFrom("", ""), ["12:00", "18:30"]);
  assert.deepEqual(whySlotsFrom("noon,12:00,12:00", ""), ["12:00"]);
  assert.deepEqual(slotList("22:00,bad,17:00"), ["17:00", "22:00"]);
});

test("Why slots still to come today: not taken, not past their grace, and only on Why days", () => {
  const cfg = testConfig("", why);
  const noon = new Date("2026-11-03T12:00:00Z");
  const evening = new Date("2026-11-03T18:30:00Z");
  assert.deepEqual(
    whySlotTimes(cfg, "2026-11-03").map((d) => d.toISOString()),
    [noon.toISOString(), evening.toISOString()],
  );
  assert.equal(whySlotsAhead(cfg, new Date("2026-11-03T09:00:00Z"), []), 2);
  assert.equal(whySlotsAhead(cfg, new Date("2026-11-03T09:00:00Z"), [noon]), 1);
  // 15:45: noon's grace ran out with nothing made, so only the evening slot is waited for.
  assert.equal(whySlotsAhead(cfg, new Date("2026-11-03T15:45:00Z"), []), 1);
  assert.equal(whySlotsAhead(cfg, new Date("2026-11-03T20:45:00Z"), []), 0);
  const off = testConfig("", { ...why, whyDays: ["sat"] });
  assert.equal(whySlotsAhead(off, new Date("2026-11-03T09:00:00Z"), []), 0);
});

test("under the cap a news slot gives way to the Why slots still to come, and says so once", async () => {
  const db = await testDb();
  const sent: DiscordMessage[] = [];
  const notify = async (m: DiscordMessage) => void sent.push(m);
  const now = new Date();
  const slot = new Date(now.getTime() + 60 * 60_000);
  const add = async (lane: string, hash: string) =>
    db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane) VALUES ($1, $2, 'scripted', '{"headline":"x","items":[]}', $3)`,
      [`ep_${Math.random().toString(36).slice(2)}`, hash, lane],
    );
  const cap3 = testConfig("", { shortsPerDayMax: 3 });
  await add("news_breaking", "b1");
  await add("news", "why:a-question"); // the noon Why is made in the news lane and counts
  // Two made, one Why to come: the news slot would make four, so it is held.
  assert.equal(await holdSlotForCap(db, cap3, now, slot, [], notify, 1), true);
  // Without a Why to come it goes ahead.
  assert.equal(await holdSlotForCap(db, cap3, now, slot, [], notify, 0), false);
  assert.equal(sent.length, 1);
  assert.match(
    sent[0]!.content!,
    /^Shorts cap: 2 news Shorts already today and 1 Why Short still to come, the SHORTS_PER_DAY_MAX limit of 3, so the \d\d:\d\d slot was held back\./,
  );
  const [ev] = await db.query<{ detail: { why_ahead: number } }>(
    `SELECT detail FROM events WHERE kind = 'news_cap_hold'`,
  );
  assert.equal(ev!.detail.why_ahead, 1);
  // The old wording when nothing is waited for.
  assert.doesNotMatch(heldBackLine(3, 3, "22:00", []), /Why/);
  await db.close();
});

test("a Why slot is held only once the cap itself is reached, reported once a day", async () => {
  const db = await testDb();
  const sent: DiscordMessage[] = [];
  const notify = async (m: DiscordMessage) => void sent.push(m);
  const now = new Date();
  const slot = new Date(now.getTime() + 60 * 60_000);
  const add = async (lane: string) =>
    db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane) VALUES ($1, $1, 'scripted', '{"headline":"x","items":[]}', $2)`,
      [`ep_${Math.random().toString(36).slice(2)}`, lane],
    );
  const cap = testConfig("", { shortsPerDayMax: 3 });
  assert.equal(
    await holdWhyForCap(db, testConfig("", {}), now, slot, notify),
    false,
    "no cap, never held",
  );
  await add("news_breaking");
  await add("news_breaking");
  assert.equal(
    await holdWhyForCap(db, cap, now, slot, notify),
    false,
    "two of three: the Why goes",
  );
  await add("news");
  assert.equal(await holdWhyForCap(db, cap, now, slot, notify), true);
  assert.equal(await holdWhyForCap(db, cap, now, slot, notify), true);
  assert.equal(sent.length, 1, "one line a day");
  assert.equal(sent[0]!.level, "info");
  assert.match(sent[0]!.content!, /Why slot was held back/);
  assert.equal(
    (await db.query(`SELECT 1 FROM events WHERE kind = 'why_cap_hold'`)).length,
    1,
  );
  assert.ok(!/[\u2014\u2013]/.test(whyHeldLine(3, 3, "12:00")));
  await db.close();
});

test("every Why slot is published to the PC orchestrator with its own kept-free window", () => {
  const cfg = testConfig("/tmp", {
    ...why,
    newsSlots: ["17:00", "22:00"],
    slotLeadMinutes: 75,
    evergreenEnabled: false,
    weeklyEnabled: false,
    dealsDays: [],
    cutdownsEnabled: false,
    longformEnabled: false,
    docEnabled: false,
  });
  const now = new Date("2026-11-03T08:00:00Z");
  assert.deepEqual(
    plannedSlots(cfg, now).map((p) => [p.lane, p.at.toISOString()]),
    [
      ["why", "2026-11-03T12:00:00.000Z"],
      ["news", "2026-11-03T17:00:00.000Z"],
      ["why", "2026-11-03T18:30:00.000Z"],
    ],
  );
  const w = pcWindows(cfg, now, []).filter((x) => x.lane === "why");
  assert.deepEqual(
    w.map((x) => [x.from, x.until]),
    [
      ["2026-11-03T10:45:00.000Z", "2026-11-03T12:00:00.000Z"],
      ["2026-11-03T17:15:00.000Z", "2026-11-03T18:30:00.000Z"],
    ],
  );
});

test("the upload budget counts both Why slots", () => {
  const cfg = {
    ...testConfig(".", why),
    newsSlots: ["17:00", "22:00"],
    weeklySlot: "20:00",
    dealsDays: [],
    longformEnabled: false,
  };
  // Tuesday 3 Nov 2026, 09:00 London; YouTube's day resets at 08:00 London, so all of today counts.
  assert.equal(
    uploadsLeftToday(cfg as any, new Date("2026-11-03T09:00:00Z")),
    5,
  );
  assert.equal(
    uploadsLeftToday(
      { ...cfg, whySlots: ["18:30"] } as any,
      new Date("2026-11-03T09:00:00Z"),
    ),
    4,
  );
});
