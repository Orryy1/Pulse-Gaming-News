import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findWinners,
  rankingSequels,
  sequelWinners,
  shortKind,
  type ShortResult,
} from "../src/sequels.ts";
import { pickBreakoutDoc } from "../src/docpick.ts";
import { goodScript, testDb } from "./helpers.ts";

const short = (over: Partial<ShortResult>): ShortResult => ({
  id: "x",
  kind: "news",
  title: "t",
  subject: "s",
  views: 150,
  watched: 45,
  subs: 0,
  ...over,
});
// A channel like ours: most Shorts near 150 views and 45% watched.
const usual = Array.from({ length: 20 }, (_, i) =>
  short({ id: `n${i}`, views: 140 + i, watched: 40 + i / 2 }),
);

test("a winner must beat the channel's own norm on both reach and hold", () => {
  const { norm, winners } = findWinners([
    ...usual,
    short({ id: "both", kind: "why", views: 1078, watched: 82, subs: 3 }),
    short({ id: "reachOnly", views: 1311, watched: 39 }),
    short({ id: "holdOnly", views: 88, watched: 73 }),
    short({ id: "tiny", views: 7, watched: 89 }),
  ]);
  assert.ok(norm.views > 140 && norm.views < 160);
  assert.deepEqual(
    winners.map((w) => w.id),
    ["both"],
  );
  assert.ok(winners[0]!.viewsX > 6);
});

test("the bar moves with the channel: the same numbers are no win on a bigger channel", () => {
  const bigger = usual.map((u) => ({ ...u, views: u.views * 10 }));
  assert.deepEqual(
    findWinners([...bigger, short({ views: 1078, watched: 82 })]).winners,
    [],
  );
});

test("too few Shorts means no norm and no winner", () => {
  assert.deepEqual(
    findWinners([...usual.slice(0, 5), short({ views: 5000, watched: 90 })])
      .winners,
    [],
  );
});

test("a Short's kind comes from how it was made", () => {
  assert.equal(shortKind({ lane: "news", story_hash: "why:x" }), "why");
  assert.equal(shortKind({ lane: "cutdown" }), "ranking");
  assert.equal(
    shortKind({ lane: "evergreen", evergreen_format: "ranking" }),
    "ranking",
  );
  assert.equal(shortKind({ lane: "news_breaking" }), "news");
  assert.equal(
    shortKind({ lane: "evergreen", evergreen_format: "steam_deals" }),
    "other",
  );
});

test("a ranking winner with no long ranking becomes a candidate and its Short stops counting as covered", () => {
  const { norm, winners } = findWinners([
    ...usual,
    short({
      id: "fallout",
      kind: "ranking",
      title: "Fallout: Ranking EVERY Mainline Fallout Game",
      subject: "Fallout",
      views: 1028,
      watched: 74,
    }),
  ]);
  const open = rankingSequels(winners, norm, ["Call of Duty"]);
  assert.equal(open.candidates[0]!.name, "Fallout");
  assert.deepEqual(open.headlines, [
    "Fallout: Ranking EVERY Mainline Fallout Game",
  ]);
  assert.match(open.block, /Fallout/);
  const done = rankingSequels(winners, norm, ["FALLOUT"]);
  assert.deepEqual(done.candidates, []);
  assert.equal(done.block, "");
});

async function channel() {
  const db = await testDb();
  const now = new Date("2026-11-04T12:00:00Z");
  const put = async (
    id: string,
    hash: string,
    views: number,
    pct: number,
    story: object = {},
  ) => {
    await db.query(
      `INSERT INTO episodes (id, story_hash, lane, status, story_json, script_json, publish_at) VALUES ($1, $2, 'news', 'published', $3, $4, $5)`,
      [
        id,
        hash,
        JSON.stringify(story),
        JSON.stringify(goodScript({ game_title: "A Game" })),
        new Date(now.getTime() - 10 * 86_400_000),
      ],
    );
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, views, raw) VALUES ($1, 'retention', $2, $3)`,
      [
        id,
        views,
        JSON.stringify({ views, avgViewPercent: pct, subscribersGained: 3 }),
      ],
    );
  };
  for (let i = 0; i < 14; i++) await put(`n${i}`, `n${i}`, 150, 45);
  await put("win", "why:san-andreas", 1078, 82, {
    gameHint: "Grand Theft Auto: San Andreas",
    why: { question: "Why did Rockstar never make a sequel to San Andreas?" },
  });
  return { db, now };
}

const services = (db: any, now: Date, sequelWinners: boolean) =>
  ({
    db,
    now: () => now,
    cfg: { docPickLookups: 0, sequelWinners },
    findGame: async () => undefined,
    gameFacts: async () => ({}),
    research: async () => undefined,
  }) as any;

test("with SEQUEL_WINNERS on, the Why winner's long version is the next documentary; off, the score decides", async () => {
  const { db, now } = await channel();
  const found = await sequelWinners(db, now);
  assert.deepEqual(
    found.winners.map((w) => w.id),
    ["win"],
  );
  const on = await pickBreakoutDoc(services(db, now, true));
  assert.equal(on!.topic.franchise, "Grand Theft Auto: San Andreas");
  assert.equal(on!.topic.wiki, "Grand Theft Auto: San Andreas");
  assert.equal(
    on!.topic.title_idea,
    "Why did Rockstar never make a sequel to San Andreas?",
  );
  assert.match(on!.line, /long version of our Short/);
  assert.match(on!.topic.reason, /1,078 views/);
  const off = await pickBreakoutDoc(services(db, now, false));
  assert.notEqual(off!.topic.franchise, "Grand Theft Auto: San Andreas");
  await db.close();
});

test("once the documentary exists the winner triggers nothing more", async () => {
  const { db, now } = await channel();
  await db.query(
    `INSERT INTO episodes (id, story_hash, lane, status, story_json, factcheck_json, created_at) VALUES ('doc', 'documentary:x', 'longform', 'published', '{}', $1, $2)`,
    [
      JSON.stringify({
        doc: true,
        topic: { franchise: "Grand Theft Auto: San Andreas" },
      }),
      now,
    ],
  );
  const pick = await pickBreakoutDoc(services(db, now, true));
  assert.notEqual(pick!.topic.franchise, "Grand Theft Auto: San Andreas");
  await db.close();
});
