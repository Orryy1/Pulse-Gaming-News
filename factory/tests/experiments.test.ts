import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb, testConfig } from "./helpers.ts";
import type { Db } from "../src/db.ts";
import {
  deskShareNow,
  experimentVerdicts,
  judgeDesk,
  judgeLeaks,
  mascotFor,
  mascotShareNow,
  narratorGroup,
  narratorReport,
  readVerdicts,
  rumoursPerDayNow,
  shortStats,
  type ShortStat,
} from "../src/experiments.ts";
import { formatLessons } from "../src/analytics.ts";
import type { DiscordMessage } from "../src/approval/discord.ts";

const LIVE = new Date("2026-11-01T12:00:00Z");

/** n Shorts on one side, all with the same stayed-to-watch share and percentage viewed. */
const side = (n: number, o: Partial<ShortStat>): ShortStat[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${o.desk ? "d" : "n"}${o.rumour ? "r" : ""}${i}`,
    lane: "news",
    liveAt: LIVE,
    views: 500,
    viewsPerDay: 100,
    stay: 60,
    pct: 70,
    desk: false,
    rumour: false,
    ...o,
  }));

test("desk verdict: keep, drop and extend thresholds", () => {
  const without = side(5, { stay: 60, pct: 70 });
  assert.equal(
    judgeDesk([...side(5, { desk: true, stay: 63, pct: 70 }), ...without])
      .decision,
    "keep",
  );
  // Better on stayed to watch but a worse average percentage watched: not a keep.
  assert.equal(
    judgeDesk([...side(5, { desk: true, stay: 65, pct: 69.5 }), ...without])
      .decision,
    "extend",
  );
  assert.equal(
    judgeDesk([...side(5, { desk: true, stay: 62.9, pct: 75 }), ...without])
      .decision,
    "extend",
  );
  assert.equal(
    judgeDesk([...side(5, { desk: true, stay: 57, pct: 70 }), ...without])
      .decision,
    "drop",
  );
  assert.equal(
    judgeDesk([...side(5, { desk: true, stay: 57.1, pct: 70 }), ...without])
      .decision,
    "extend",
  );
});

test("desk verdict: five Shorts a side with retention, news lanes since the test began", () => {
  const without = side(5, { stay: 60 });
  const four = judgeDesk([...side(4, { desk: true, stay: 70 }), ...without]);
  assert.equal(four.decision, "extend");
  assert.equal(four.enough, false);
  // A fifth desk Short without its retention numbers yet does not count.
  assert.equal(
    judgeDesk([
      ...side(4, { desk: true, stay: 70 }),
      { ...side(1, { desk: true })[0]!, id: "late", stay: undefined },
      ...without,
    ]).decision,
    "extend",
  );
  // Evergreen Shorts and Shorts from before 25 Oct are on neither side.
  assert.equal(
    judgeDesk([
      ...side(5, { desk: true, stay: 70 }),
      ...side(5, { stay: 60, lane: "evergreen" }),
    ]).decision,
    "extend",
  );
  assert.equal(
    judgeDesk([
      ...side(5, { desk: true, stay: 70 }),
      ...side(5, { stay: 60, liveAt: new Date("2026-10-20T12:00:00Z") }),
    ]).decision,
    "extend",
  );
});

test("leak verdict: worse by five points or under half the views a day cuts the allowance", () => {
  const others = side(6, { stay: 60, viewsPerDay: 200 });
  assert.equal(
    judgeLeaks([
      ...side(3, { rumour: true, stay: 55, viewsPerDay: 200 }),
      ...others,
    ]).decision,
    "cut",
  );
  assert.equal(
    judgeLeaks([
      ...side(3, { rumour: true, stay: 60, viewsPerDay: 99 }),
      ...others,
    ]).decision,
    "cut",
  );
  assert.equal(
    judgeLeaks([
      ...side(3, { rumour: true, stay: 55.1, viewsPerDay: 150 }),
      ...others,
    ]).decision,
    "hold",
  );
  assert.equal(
    judgeLeaks([
      ...side(3, { rumour: true, stay: 64, viewsPerDay: 250 }),
      ...others,
    ]).decision,
    "keep",
  );
  assert.equal(
    judgeLeaks([
      ...side(2, { rumour: true, stay: 30, viewsPerDay: 10 }),
      ...others,
    ]).decision,
    "too_few",
  );
  // Views a day count before retention arrives.
  assert.equal(
    judgeLeaks([
      ...side(3, {
        rumour: true,
        stay: undefined,
        pct: undefined,
        viewsPerDay: 50,
      }),
      ...others,
    ]).decision,
    "cut",
  );
});

test("narrator report: groups the stored names and says which way it went", () => {
  assert.equal(narratorGroup("TX3LPaxmHKxFdv7VOQHJ"), "Liam");
  assert.equal(narratorGroup("Liam (local clone)"), "Liam");
  assert.equal(narratorGroup("Pulse narrator"), "Pulse narrator");
  assert.equal(narratorGroup("Pulse Narrator (local clone)"), "Pulse narrator");
  assert.equal(narratorGroup("Alice"), "Alice");
  const r = narratorReport([
    ...side(5, { narrator: "Pulse narrator", stay: 66 }),
    ...side(3, { narrator: "Liam", stay: 60 }),
    ...side(3, { narrator: "Alice", stay: 60 }),
  ]);
  assert.equal(r.enough, true);
  assert.equal(r.direction, "better");
  assert.equal(
    narratorReport(side(4, { narrator: "Pulse narrator" })).direction,
    undefined,
  );
});

test("overrides: the setting wins when there is one, else the config", async () => {
  const db = await testDb();
  const cfg = testConfig("", {
    deskShare: 0.5,
    rumoursPerDay: 2,
    mascotShare: 0,
  });
  assert.equal(await deskShareNow(db, cfg), 0.5);
  assert.equal(await rumoursPerDayNow(db, cfg), 2);
  assert.equal(await mascotShareNow(db, cfg), 0);
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('override:desk_share', '1'), ('override:rumours_per_day', '1'), ('override:mascot_share', '0.5')`,
  );
  assert.equal(await deskShareNow(db, cfg), 1);
  assert.equal(await rumoursPerDayNow(db, cfg), 1);
  assert.equal(await mascotShareNow(db, cfg), 0.5);
  await db.close();
});

test("Pip: chosen per episode by a stable hash, never on the twin", () => {
  assert.equal(mascotFor(0, { id: "ep_1", lane: "news" }), false);
  assert.equal(mascotFor(1, { id: "ep_1", lane: "news" }), true);
  assert.equal(mascotFor(1, { id: "ep_1", lane: "twin" }), false);
  const ids = Array.from(
    { length: 1000 },
    (_, i) => `ep_${i}_${(i * 7919).toString(36)}`,
  );
  const picked = ids.filter((id) => mascotFor(0.5, { id, lane: "news" }));
  assert.ok(
    picked.length > 400 && picked.length < 600,
    `about half, got ${picked.length}`,
  );
  // The same episode always gets the same answer.
  for (const id of ids.slice(0, 50))
    assert.equal(
      mascotFor(0.5, { id, lane: "news" }),
      mascotFor(0.5, { id, lane: "news" }),
    );
  assert.deepEqual(
    formatLessons([
      ...Array.from({ length: 3 }, () => ({ pct: 70, stay: 64, mascot: true })),
      ...Array.from({ length: 3 }, () => ({
        pct: 70,
        stay: 60,
        mascot: false,
      })),
    ]),
    [
      "Mascot (Pip beside the logo): with him kept 64% (3 Shorts), without 60% (3 Shorts).",
    ],
  );
});

let n = 0;
async function addShort(
  db: Db,
  o: {
    desk?: boolean;
    stay?: number;
    pct?: number;
    views?: number;
    rumour?: boolean;
    lane?: string;
    narrator?: string;
    liveAt?: Date;
  },
): Promise<void> {
  const id = `ep_${++n}`;
  const views = o.views ?? 400;
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, assets_json, youtube_video_id, publish_at)
     VALUES ($1, $1, 'published', '{"headline":"x","items":[]}', $2, $3, $4, $5, $6)`,
    [
      id,
      o.lane ?? "news",
      JSON.stringify({ is_rumour: o.rumour ?? false }),
      JSON.stringify({
        voice: {
          provider: "elevenlabs",
          id: "v",
          name: o.narrator ?? "Pulse narrator",
        },
        ...(o.desk
          ? {
              desk: {
                voice: { id: "d", name: "Pulse co-host" },
                question: "Why?",
              },
            }
          : {}),
      }),
      `vid_${id}`,
      o.liveAt ?? new Date("2026-11-01T12:00:00Z"),
    ],
  );
  await db.query(
    `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, '72h', $2, $3, 0, 0, '{}')`,
    [id, new Date("2026-11-04T12:00:00Z"), views],
  );
  if (o.stay !== undefined)
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, 'retention', $2, $3, 0, 0, $4)`,
      [
        id,
        new Date("2026-11-06T12:00:00Z"),
        views,
        JSON.stringify({
          views,
          engagedViews: Math.round((views * o.stay) / 100),
          avgViewPercent: o.pct ?? 70,
          subscribersGained: 0,
        }),
      ],
    );
}

test("verdict run: waits for the UK day, decides once, applies the overrides and reports in plain English", async () => {
  const db = await testDb();
  const cfg = testConfig("", { deskShare: 0.5, rumoursPerDay: 2 });
  for (let i = 0; i < 5; i++) await addShort(db, { desk: true, stay: 66 });
  for (let i = 0; i < 5; i++) await addShort(db, { stay: 60 });
  for (let i = 0; i < 3; i++) await addShort(db, { rumour: true, stay: 50 });
  // Never counted: the twin, a Short under 30 views, one live under two days.
  await addShort(db, { lane: "twin", stay: 10 });
  await addShort(db, { views: 29, stay: 10 });
  await addShort(db, { stay: 10, liveAt: new Date("2026-11-07T00:00:00Z") });
  const stats = await shortStats(db, new Date("2026-11-08T12:00:00Z"));
  assert.equal(stats.length, 13);
  assert.equal(Math.round(stats.find((s) => s.desk)!.stay!), 66);
  assert.equal(stats.find((s) => s.desk)!.pct, 70);

  const sent: DiscordMessage[] = [];
  const notify = async (m: DiscordMessage) => void sent.push(m);
  // 23:30 GMT on 7 Nov is still 7 Nov in the UK.
  assert.equal(
    await experimentVerdicts(db, cfg, new Date("2026-11-07T23:30:00Z"), notify),
    undefined,
  );
  const run = await experimentVerdicts(
    db,
    cfg,
    new Date("2026-11-08T00:30:00Z"),
    notify,
  );
  assert.equal(run?.desk, "keep");
  assert.equal(run?.leaks, "cut");
  assert.equal(await deskShareNow(db, cfg), 1);
  assert.equal(await rumoursPerDayNow(db, cfg), 1);
  assert.equal(await mascotShareNow(db, cfg), 0.5);
  assert.equal(sent.length, 1);
  const text = sent[0]!.content!;
  assert.match(text, /keep it/);
  assert.match(text, /one leak a day from now/);
  assert.match(text, /Pip the mascot/);
  assert.ok(!text.includes("—") && !text.includes("–"), "no em or en dashes");
  assert.ok(text.length < 2000, `fits one Discord message (${text.length})`);
  assert.equal(sent[0]!.level, undefined);
  // Not again: the desk test has its verdict.
  assert.equal(
    await experimentVerdicts(db, cfg, new Date("2026-11-15T12:00:00Z"), notify),
    undefined,
  );
  assert.equal((await readVerdicts(db)).next, null);
  await db.close();
});

test("verdict run: too few Shorts extends the desk test a week, and Pip waits", async () => {
  const db = await testDb();
  const cfg = testConfig("", { deskShare: 0.5, rumoursPerDay: 2 });
  for (let i = 0; i < 4; i++) await addShort(db, { desk: true, stay: 70 });
  for (let i = 0; i < 5; i++) await addShort(db, { stay: 60 });
  const sent: DiscordMessage[] = [];
  const notify = async (m: DiscordMessage) => void sent.push(m);
  const run = await experimentVerdicts(
    db,
    cfg,
    new Date("2026-11-08T12:00:00Z"),
    notify,
  );
  assert.equal(run?.desk, "extend");
  assert.equal(run?.leaks, "too_few");
  assert.equal((await readVerdicts(db)).next, "2026-11-15");
  assert.equal(await deskShareNow(db, cfg), 0.5);
  assert.equal(await rumoursPerDayNow(db, cfg), 2);
  assert.equal(await mascotShareNow(db, cfg), 0);
  assert.match(sent[0]!.content!, /another week/);
  assert.match(sent[0]!.content!, /15 Nov/);
  assert.equal(
    await experimentVerdicts(db, cfg, new Date("2026-11-14T12:00:00Z"), notify),
    undefined,
  );
  // A week on, more desk Shorts are in and they clearly lose viewers.
  for (let i = 0; i < 5; i++) await addShort(db, { desk: true, stay: 40 });
  const second = await experimentVerdicts(
    db,
    cfg,
    new Date("2026-11-15T12:00:00Z"),
    notify,
  );
  assert.equal(second?.desk, "drop");
  assert.equal(await deskShareNow(db, cfg), 0);
  assert.equal(await mascotShareNow(db, cfg), 0.5);
  assert.equal((await readVerdicts(db)).runs.length, 2);
  await db.close();
});
