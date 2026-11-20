import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb, testConfig } from "./helpers.ts";
import type { Db } from "../src/db.ts";
import type { DiscordMessage } from "../src/approval/discord.ts";
import {
  VIEWS_MARGIN,
  WEEKLY_MAX_EACH,
  WEEKLY_MIN_EACH,
  judgeWeekly,
  nextArm,
  readWeeklyState,
  recordWeeklyArm,
  weeklyArm,
  weeklyResults,
  weeklyVerdict,
  type WeeklyResult,
} from "../src/weeklytest.ts";
import { plannedSlots } from "../src/pcschedule.ts";

test("the arms take turns, the explainer first; a short side catches up; a winner takes every week", () => {
  assert.equal(nextArm([]), "explained");
  assert.equal(nextArm([{ arm: "explained" }]), "roundup");
  assert.equal(
    nextArm([{ arm: "explained" }, { arm: "roundup" }]),
    "explained",
  );
  // A fallback week (the explainer had no story, the round-up ran) leaves the explainer behind: it goes next.
  assert.equal(nextArm([{ arm: "roundup" }]), "explained");
  assert.equal(
    nextArm([{ arm: "explained" }, { arm: "roundup" }, { arm: "roundup" }]),
    "explained",
  );
  assert.equal(
    nextArm([{ arm: "roundup" }, { arm: "explained" }]),
    "roundup",
    "a tie goes to the one that did not run last",
  );
  assert.equal(nextArm([], "roundup"), "roundup");
});

const r = (
  arm: WeeklyResult["arm"],
  views7d: number,
  avdSeconds = 200,
  subsPer1k = 2,
): WeeklyResult => ({
  id: `${arm}_${views7d}_${Math.random()}`,
  arm,
  title: "x",
  views7d,
  avdSeconds,
  avgPercent: 30,
  subsPer1k,
});
const many = (n: number, f: () => WeeklyResult) => Array.from({ length: n }, f);

test("the judge needs three a side, a 15% lead on 7-day views, and not trailing on both other numbers", () => {
  assert.equal(
    judgeWeekly([
      ...many(2, () => r("roundup", 500)),
      ...many(3, () => r("explained", 900)),
    ]).reason,
    "too_few",
  );
  const win = judgeWeekly([
    ...many(WEEKLY_MIN_EACH, () => r("roundup", 500)),
    ...many(WEEKLY_MIN_EACH, () => r("explained", 600)),
  ]);
  assert.equal(win.winner, "explained");
  assert.ok(600 / 500 - 1 >= VIEWS_MARGIN);
  assert.equal(
    judgeWeekly([
      ...many(3, () => r("roundup", 500)),
      ...many(3, () => r("explained", 560)),
    ]).reason,
    "too_close",
    "12% is not enough",
  );
  // More views but less watched and fewer subscribers: not called.
  assert.equal(
    judgeWeekly([
      ...many(3, () => r("roundup", 500, 300, 3)),
      ...many(3, () => r("explained", 700, 250, 2)),
    ]).reason,
    "mixed",
  );
  assert.equal(
    judgeWeekly([
      ...many(3, () => r("roundup", 900)),
      ...many(3, () => r("explained", 500)),
    ]).winner,
    "roundup",
  );
  const closed = judgeWeekly([
    ...many(WEEKLY_MAX_EACH, () => r("roundup", 500)),
    ...many(WEEKLY_MAX_EACH, () => r("explained", 520)),
  ]);
  assert.equal(closed.closed, true);
  assert.equal(closed.winner, undefined);
  // A video still missing its watch-time row does not count yet.
  const partial = judgeWeekly([
    ...many(3, () => r("roundup", 500)),
    ...many(3, () => ({ ...r("explained", 900), avdSeconds: undefined })),
  ]);
  assert.equal(partial.reason, "too_few");
});

async function published(
  db: Db,
  id: string,
  title: string,
  v7?: number,
  ret?: Record<string, number>,
): Promise<void> {
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, youtube_video_id, publish_at)
     VALUES ($1, $1, 'published', '{"headline":"x","items":[]}', 'longform', $2, $3, '2026-11-06T20:00:00Z')`,
    [id, JSON.stringify({ youtube: { title } }), `vid_${id}`],
  );
  if (v7 !== undefined)
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, views) VALUES ($1, '7d', $2)`,
      [id, v7],
    );
  if (ret)
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, views, raw) VALUES ($1, 'retention', $2, $3)`,
      [id, ret.views ?? 0, JSON.stringify(ret)],
    );
}

test("the test starts with one notice, records each week's arm once, and a failed week does not count", async () => {
  const db = await testDb();
  const cfg = testConfig("/tmp", { weeklyExplainedTest: true });
  const posts: DiscordMessage[] = [];
  const notify = async (m: DiscordMessage) => void posts.push(m);
  const now = new Date("2026-11-06T12:00:00Z");
  assert.equal(
    await weeklyArm(db, { ...cfg, weeklyExplainedTest: false }, now, notify),
    "roundup",
    "off: always the round-up",
  );
  assert.equal(posts.length, 0);
  assert.equal(await weeklyArm(db, cfg, now, notify), "explained");
  assert.equal(posts.length, 1);
  assert.match(String(posts[0]!.content), /Weekly growth test started today/);
  assert.match(
    String(posts[0]!.content),
    /views at 7 days, its average view duration and the subscribers it brings per 1,000 views/,
  );
  await published(db, "w1", "Why Dark Souls Went Dark");
  await recordWeeklyArm(db, cfg, "w1", "explained", now);
  await recordWeeklyArm(db, cfg, "w1", "explained", now);
  assert.equal(
    (await readWeeklyState(db)).entries.length,
    1,
    "once per episode",
  );
  assert.equal(await weeklyArm(db, cfg, now, notify), "roundup");
  assert.equal(posts.length, 1, "the notice is posted once");
  await db.query(`UPDATE episodes SET status = 'failed' WHERE id = 'w1'`);
  assert.equal(
    await weeklyArm(db, cfg, now, notify),
    "explained",
    "a failed week is made again by the same arm",
  );
  await db.close();
});

test("each finished week is reported once with its numbers, and the verdict ends the test", async () => {
  const db = await testDb();
  const cfg = testConfig("/tmp", { weeklyExplainedTest: true });
  const posts: DiscordMessage[] = [];
  const notify = async (m: DiscordMessage) => void posts.push(m);
  const now = new Date("2026-11-20T12:00:00Z");
  await weeklyArm(db, cfg, now, notify);
  posts.length = 0;
  await published(db, "e1", "Why Dark Souls Went Dark", 1200, {
    views: 1300,
    avgViewSeconds: 400,
    avgViewPercent: 38,
    subscribersGained: 6,
  });
  await recordWeeklyArm(db, cfg, "e1", "explained", now);
  await weeklyVerdict(db, cfg, now, notify);
  assert.equal(posts.length, 1);
  assert.match(
    String(posts[0]!.content),
    /"Why Dark Souls Went Dark" \(the week's biggest story, explained\) finished its first week: 1,200 views at 7 days, 6:40 watched on average, 4\.6 subscribers per 1,000 views/,
  );
  await weeklyVerdict(db, cfg, now, notify);
  assert.equal(posts.length, 1, "not twice");
  const res = await weeklyResults(db, (await readWeeklyState(db)).entries);
  assert.equal(res[0]!.subsPer1k?.toFixed(2), "4.62");
  for (let i = 2; i <= 3; i++) {
    await published(db, `e${i}`, `E${i}`, 1200, {
      views: 1300,
      avgViewSeconds: 400,
      avgViewPercent: 38,
      subscribersGained: 6,
    });
    await recordWeeklyArm(db, cfg, `e${i}`, "explained", now);
  }
  for (let i = 1; i <= 3; i++) {
    await published(db, `r${i}`, `R${i}`, 600, {
      views: 650,
      avgViewSeconds: 250,
      avgViewPercent: 40,
      subscribersGained: 2,
    });
    await recordWeeklyArm(db, cfg, `r${i}`, "roundup", now);
  }
  await weeklyVerdict(db, cfg, now, notify);
  const verdict = String(posts.at(-1)!.content);
  assert.match(
    verdict,
    /\*\*the week's biggest story, explained wins\*\*, with 100% more views at 7 days/,
  );
  assert.equal((await readWeeklyState(db)).done?.winner, "explained");
  assert.equal(
    await weeklyArm(db, cfg, now, notify),
    "explained",
    "the winner takes every later week",
  );
  await recordWeeklyArm(db, cfg, "late", "explained", now);
  assert.equal(
    (await readWeeklyState(db)).entries.some((e) => e.id === "late"),
    false,
    "nothing is recorded once it is over",
  );
  await db.close();
});

test("an explainer week keeps the PC free for the documentary's window before the weekly slot", () => {
  const base = testConfig("/tmp", {
    weeklyEnabled: true,
    recapLong: true,
    recapDays: ["fri"],
    newsSlots: [],
    whyEnabled: false,
    evergreenEnabled: false,
    longformEnabled: false,
    dealsDays: [],
    cutdownsEnabled: false,
    timezone: "Europe/London",
  });
  const at = new Date("2026-11-06T10:00:00Z"); // Friday
  const keep = (cfg: typeof base) =>
    plannedSlots(cfg, at, 12).find((w) => w.lane === "weekly")?.keep;
  assert.equal(keep(base), 150);
  assert.equal(keep({ ...base, weeklyExplainedTest: true }), 180);
});
