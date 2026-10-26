import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb, testConfig, goodScript, tmpDir } from "./helpers.ts";
import {
  hitThreshold,
  hotBlock,
  readHotTopic,
  watchHits,
} from "../src/hits.ts";

test("the take-off bar is a multiple of the usual pace with a floor", () => {
  const cfg = { hitMultiple: 6, hitMinPerHour: 40 };
  assert.equal(hitThreshold(2, cfg), 40);
  assert.equal(hitThreshold(10, cfg), 60);
});

test("a Short far ahead of the usual pace is announced once and becomes the hot topic; a normal one is not", async () => {
  const db = await testDb();
  const cfg = testConfig(await tmpDir());
  const now = new Date("2026-11-01T12:00:00Z");
  const live = new Date(now.getTime() - 5 * 3_600_000);
  // Thirty past Shorts at 48 views in their first day: two views an hour is the usual pace.
  for (let i = 0; i < 30; i++) {
    await db.query(
      `INSERT INTO episodes (id, story_hash, story_json, status, lane, script_json, youtube_video_id, publish_at) VALUES ($1, $2, '{}', 'published', 'news', $3, $4, $5)`,
      [
        `old${i}`,
        `h_old${i}`,
        JSON.stringify(goodScript()),
        `vold${i}`,
        new Date(now.getTime() - (5 + i) * 86_400_000),
      ],
    );
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, '24h', $2, 48, 0, 0, '{}')`,
      [`old${i}`, now],
    );
  }
  for (const [id, vid] of [
    ["hot", "vhot"],
    ["calm", "vcalm"],
  ])
    await db.query(
      `INSERT INTO episodes (id, story_hash, story_json, status, lane, script_json, youtube_video_id, publish_at) VALUES ($1, $2, '{}', 'published', 'news', $3, $4, $5)`,
      [
        id,
        `h_${id}`,
        JSON.stringify(
          goodScript({ game_title: id === "hot" ? "Silksong" : "Starfield" }),
        ),
        vid,
        live,
      ],
    );
  const notes: string[] = [];
  const deps = {
    db,
    cfg,
    now: () => now,
    stats: async () =>
      new Map([
        ["vhot", { views: 1000 }],
        ["vcalm", { views: 20 }],
      ]),
    notify: async (m: { content: string }) => notes.push(m.content),
  };
  assert.deepEqual(await watchHits(deps), ["hot"]);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /Taking off/);
  const hot = await readHotTopic(db, now);
  assert.equal(hot?.game, "Silksong");
  assert.match(hotBlock(hot), /Silksong/);
  // Announced once only.
  assert.deepEqual(await watchHits(deps), []);
  // The hot topic lapses after its window.
  assert.equal(
    await readHotTopic(db, new Date(now.getTime() + 73 * 3_600_000)),
    undefined,
  );
  await db.close();
});
