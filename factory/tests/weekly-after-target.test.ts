import { test } from "node:test";
import assert from "node:assert/strict";
import { maybeSelect, maybeSelectWeekly } from "../src/pipeline.ts";
import type { Services } from "../src/pipeline.ts";
import { countToday, getEpisode, listEpisodes } from "../src/episodes.ts";
import type { Db } from "../src/db.ts";
import { testDb, testConfig, tmpDir } from "./helpers.ts";

// Queue item 54 (25 Nov 2026): once the day's Shorts allowance was used, maybeSelect only reached the documentary and
// the long ranking, never Friday's long round-up or explainer. Shorts made ahead for a Friday count on Friday from
// midnight, so the allowance can be used before the weekly window opens and the slot would pass empty.

async function weekShort(db: Db, id: string, game: string) {
  const headline = `${game} gets a patch`;
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, youtube_video_id, publish_at)
     VALUES ($1, $1, 'published', $2, 'news', $3, $4, '2026-11-25T17:00:00Z')`,
    [
      id,
      JSON.stringify({ headline, items: [] }),
      JSON.stringify({ game_title: game, headline }),
      `vid_${id}`,
    ],
  );
}

async function friday(overrides: Record<string, unknown> = {}) {
  const db = await testDb();
  const data = await tmpDir();
  // The week's published Shorts: enough for the round-up. They were created today on the database clock, so they also
  // use up today's Shorts allowance (dailyTarget 1) before the weekly window opens.
  for (const [i, g] of [
    "Alpha",
    "Bravo",
    "Charlie",
    "Delta",
    "Echo",
    "Foxtrot",
  ].entries())
    await weekShort(db, `ep_week_${i}`, g);
  const cfg = testConfig(data, {
    dailyTarget: 1,
    weeklyEnabled: true,
    recapLong: true,
    longformEnabled: true,
    weeklyExplainedTest: false,
    recapDays: ["fri"],
    climbersDays: [],
    radarDays: [],
    freeDays: [],
    achievementDays: [],
    dealsDays: [],
    docEnabled: false,
    ...overrides,
  });
  const s = {
    db,
    cfg,
    // Friday 27 Nov, 16:00 London: inside the round-up's 300-minute lead before the 20:00 slot.
    now: () => new Date("2026-11-27T16:00:00Z"),
    notify: async () => true,
    discover: async () => [],
  } as unknown as Services;
  return { db, s };
}

test("Friday's long round-up is still picked once the day's Shorts allowance is used", async () => {
  const { db, s } = await friday();
  // Precondition: the allowance really is used, so maybeSelect takes the after-target path, not maybeSelectWeekly.
  assert.ok((await countToday(db, s.cfg.timezone)) >= s.cfg.dailyTarget, "the day's Shorts allowance is used");
  const id = await maybeSelect(s);
  assert.ok(id, "the weekly long video was picked past the Shorts allowance");
  const ep = (await getEpisode(db, id!))!;
  assert.equal(ep.lane, "longform");
  assert.equal((ep.factcheck_json as { recap?: unknown } | null)?.recap, true);
  assert.equal(new Date(ep.slot_at!).toISOString(), "2026-11-27T20:00:00.000Z");
  // Tried once a day: the next tick does not make a second one.
  await maybeSelect(s);
  assert.equal(
    (await listEpisodes(db)).filter((e) => e.lane === "longform").length,
    1,
    "only one weekly long video",
  );
  await db.close();
});

test("LONG_WEEKLY_AFTER_TARGET=false keeps the old behaviour: no weekly long video past the allowance", async () => {
  const { db, s } = await friday({ longWeeklyAfterTarget: false });
  assert.ok((await countToday(db, s.cfg.timezone)) >= s.cfg.dailyTarget, "the day's Shorts allowance is used");
  await maybeSelect(s);
  assert.equal(
    (await listEpisodes(db)).filter((e) => e.lane === "longform").length,
    0,
  );
  await db.close();
});

test("the weekly lane still makes its long video in its usual place, and only on its day", async () => {
  {
    const { db, s } = await friday();
    const id = await maybeSelectWeekly(s);
    assert.ok(id);
    assert.equal((await getEpisode(db, id!))!.lane, "longform");
    await db.close();
  }
  {
    const { db, s } = await friday();
    (s as { now: () => Date }).now = () => new Date("2026-11-26T16:00:00Z"); // Thursday
    await maybeSelect(s);
    assert.equal(
      (await listEpisodes(db)).filter((e) => e.lane === "longform").length,
      0,
      "no weekly long video on a Thursday",
    );
    await db.close();
  }
});
