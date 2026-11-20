import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb, goodScript } from "./helpers.ts";
import {
  formatOf,
  formatOpen,
  inSeason,
  readPauses,
  reviewFormats,
  verdict,
  MIN_SAMPLES,
} from "../src/formats.ts";

test("formats: news lanes are one format, evergreen formats by name, achievements as one", () => {
  assert.equal(formatOf("news", null), "news");
  assert.equal(formatOf("news_breaking", null), "news");
  assert.equal(
    formatOf("evergreen", { evergreen_format: "steam_deals" }),
    "steam_deals",
  );
  assert.equal(
    formatOf("evergreen", { evergreen_format: "rarest_achievements" }),
    "achievements",
  );
  assert.equal(formatOf("evergreen", {}), "ranking");
  assert.equal(formatOf("free", null), "free");
});

test("a format is judged only after six videos, and paused under 40% of news", () => {
  assert.equal(verdict({ format: "news", n: 30, median: 400 }, 400), "core");
  assert.equal(
    verdict({ format: "steam_deals", n: MIN_SAMPLES - 1, median: 10 }, 400),
    "trial",
  );
  assert.equal(
    verdict({ format: "steam_deals", n: MIN_SAMPLES, median: 150 }, 400),
    "pause",
  );
  assert.equal(
    verdict({ format: "steam_deals", n: MIN_SAMPLES, median: 170 }, 400),
    "keep",
  );
});

test("Steam deals run in a Steam sale whatever their score", () => {
  assert.ok(inSeason("steam_deals", new Date("2026-11-27T12:00:00Z")));
  assert.ok(!inSeason("steam_deals", new Date("2026-11-10T12:00:00Z")));
  assert.ok(!inSeason("release_radar", new Date("2026-11-27T12:00:00Z")));
});

test("the weekly review pauses a weak format, frees its slot, and reopens it in season and after four weeks", async () => {
  const db = await testDb();
  const now = new Date("2026-11-09T10:00:00Z");
  let k = 0;
  const publish = async (
    lane: string,
    format: string | undefined,
    views: number,
  ) => {
    const id = `ep_${k++}`;
    const script = { ...goodScript(), evergreen_format: format };
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, script_json, youtube_video_id, publish_at, lane) VALUES ($1, $2, 'published', $3, $4, $5, $6, $7)`,
      [
        id,
        `h_${id}`,
        JSON.stringify({ headline: id, items: [] }),
        JSON.stringify(script),
        `v_${id}`,
        new Date(now.getTime() - 3 * 86_400_000),
        lane,
      ],
    );
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, '24h', $2, $3, 0, 0, '{}')`,
      [id, new Date(now.getTime() - 2 * 86_400_000), views],
    );
  };
  for (const v of [380, 420, 500, 300, 450])
    await publish("news", undefined, v);
  for (const v of [40, 60, 30, 90, 50, 70])
    await publish("evergreen", "steam_deals", v);
  for (const v of [300, 260]) await publish("evergreen", "release_radar", v);

  const lines = await reviewFormats(db, now);
  assert.ok(
    lines.some((l) => /Steam deals: \*\*paused until 2026-12-07/.test(l)),
    lines.join("\n"),
  );
  assert.ok(
    lines.some((l) => /Release Radar: on trial, 2 of 6/.test(l)),
    lines.join("\n"),
  );
  assert.equal(
    await formatOpen(db, "steam_deals", now),
    false,
    "the deals slot is closed",
  );
  assert.equal(await formatOpen(db, "release_radar", now), true);
  assert.equal(
    await formatOpen(db, "steam_deals", new Date("2026-11-26T12:00:00Z")),
    true,
    "open in the Autumn Sale",
  );
  assert.equal(
    await formatOpen(db, "steam_deals", new Date("2026-12-08T12:00:00Z")),
    true,
    "open again after four weeks",
  );

  // A second review the same week keeps the existing pause rather than restarting it.
  await reviewFormats(db, new Date(now.getTime() + 86_400_000));
  assert.equal(
    (await readPauses(db)).steam_deals?.until.slice(0, 10),
    "2026-12-07",
  );
});
