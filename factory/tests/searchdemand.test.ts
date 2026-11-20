import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.ts";
import {
  dbDemandCache,
  demandFor,
  demandLine,
  demandUrl,
  namesTopic,
  parseDemandRows,
  rankByDemand,
  scoreDemand,
  type SearchRow,
} from "../src/discovery/searchdemand.ts";

const now = new Date("2026-11-01T12:00:00Z");
const row = (title: string, views: number): SearchRow => ({
  videoId: "abcdefghijk",
  views,
  channel: "c",
  title,
});

test("the search page is this week's uploads by view count, read from yt-dlp's listing", () => {
  assert.equal(
    demandUrl("Grand Theft Auto: San Andreas"),
    "https://www.youtube.com/results?search_query=Grand%20Theft%20Auto%3A%20San%20Andreas&sp=CAMSAggD",
  );
  assert.deepEqual(
    parseDemandRows(
      "3vogupLqMh8\t113267\tKesto\tMe Pase GTA San Andreas\nbad line\nbR6Mif8x9t0\tNA\tNA\tA\ttabbed title\n",
    ),
    [
      {
        videoId: "3vogupLqMh8",
        views: 113267,
        channel: "Kesto",
        title: "Me Pase GTA San Andreas",
      },
      {
        videoId: "bR6Mif8x9t0",
        views: 0,
        channel: "",
        title: "A\ttabbed title",
      },
    ],
  );
});

test("a video counts only when it names the topic; GTA stands for Grand Theft Auto", () => {
  assert.equal(
    namesTopic("GTA San Andreas PSP Port!", "Grand Theft Auto: San Andreas"),
    true,
  );
  assert.equal(
    namesTopic(
      "Playing San Andreas at 240 FPS",
      "Grand Theft Auto: San Andreas",
    ),
    false,
  );
  assert.equal(namesTopic("Ranking every Halo campaign", "Halo"), true);
  assert.equal(namesTopic("Minecraft but hardcore", "Halo"), false);
  assert.equal(
    namesTopic("Elden Ring Nightreign tips", "Dark Souls and Elden Ring"),
    true,
  );
});

test("demand is the views of the top five videos naming the topic, with a level against the bar", () => {
  const rows = [
    row("GTA San Andreas mods", 900_000),
    row("GTA San Andreas speedrun", 300_000),
    row("Minecraft 1.22", 5_000_000),
    row("GTA San Andreas PSP", 40_000),
  ];
  const d = scoreDemand("Grand Theft Auto: San Andreas", rows, 20_000, now);
  assert.equal(d.views, 1_240_000);
  assert.equal(d.hits, 3);
  assert.equal(d.level, "high");
  assert.equal(d.top?.title, "GTA San Andreas mods");
  assert.equal(
    scoreDemand("Halo", [row("Halo 3 clip", 9_000)], 20_000, now).level,
    "none",
  );
  assert.equal(
    scoreDemand("Halo", [row("Halo 3 clip", 30_000)], 20_000, now).level,
    "low",
  );
  assert.equal(
    scoreDemand("Halo", [row("Halo 3 clip", 300_000)], 20_000, now).level,
    "medium",
  );
});

test("lookups are capped per pick, cached for a day, and a failed search is unknown, never no demand", async () => {
  const db = await testDb();
  let clock = now;
  const cache = dbDemandCache(db, () => clock);
  const searched: string[] = [];
  const search = async (url: string) => {
    searched.push(url);
    if (url.includes("Broken")) throw new Error("HTTP 429");
    if (url.includes("Halo")) return [row("Halo Infinite news", 500_000)];
    return [row("something else", 1_000_000)];
  };
  const cands = [
    { name: "Halo", source: "seed" },
    { name: "Bully", source: "seed" },
    { name: "Broken", source: "seed" },
    { name: "Forza", source: "seed" },
  ];
  const opts = { search, cache, lookups: 3, minViews: 20_000, now };
  const first = await demandFor(cands, opts);
  assert.equal(searched.length, 3, "three pages at most");
  assert.equal(first.get("Halo")?.views, 500_000);
  assert.equal(first.get("Bully")?.level, "none");
  assert.equal(first.has("Broken"), false, "a failed search is unknown");
  assert.equal(first.has("Forza"), false, "over the limit: unknown");
  // The next pick the same day reads the cache and spends its lookups on the rest.
  const second = await demandFor(cands, opts);
  assert.deepEqual(
    searched
      .slice(3)
      .map((u) => decodeURIComponent(u.split("=")[1]!.split("&")[0]!)),
    ["Broken", "Forza"],
  );
  assert.equal(second.get("Halo")?.views, 500_000);
  // A day later the cache has run out.
  clock = new Date(now.getTime() + 25 * 3600_000);
  assert.equal(await cache.get("Halo"), undefined);

  const { kept, skipped } = rankByDemand(cands, second, 20_000);
  assert.deepEqual(
    skipped.map((c) => c.name),
    ["Bully", "Forza"],
  );
  assert.deepEqual(
    kept.map((c) => c.name),
    ["Halo", "Broken"],
  );
  assert.match(
    kept[0]!.note!,
    /YouTube this week: 500K views on its top videos/,
  );
  assert.equal(kept[1]!.note, undefined, "an unknown topic keeps its note");
  await db.close();
});

test("one Discord line per pick, in plain words", () => {
  const d = scoreDemand("Halo", [row("Halo 3 clip", 1_234_567)], 20_000, now);
  assert.equal(
    demandLine("Why Short at 12:00", "Halo 3", d, 2),
    'Demand check, Why Short at 12:00: "Halo 3" has 1.2M views on its top YouTube videos this week (1 recent video names it, high demand). 2 candidates skipped for no recent demand.',
  );
  assert.match(
    demandLine("long ranking", "Halo", undefined, 0),
    /demand not checked/,
  );
  assert.ok(!demandLine("x", "y", d, 1).includes("—"));
});
