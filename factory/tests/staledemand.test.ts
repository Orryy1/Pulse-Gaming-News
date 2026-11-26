// DEMAND_STALE_DAYS (improvement engine, 20 Nov 2026): when no fresh demand reading can be had (YouTube's bot check
// paused searching, the search failed or the pick's lookups ran out), an older cached reading stands in, marked stale.
// 20 of 26 picks from 12 to 19 Nov went out with "demand not checked" though most topics had been measured days before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.ts";
import {
  dbDemandCache,
  demandFor,
  demandLine,
  demandYoungerThan,
  rankByDemand,
  scoreDemand,
  type SearchRow,
} from "../src/discovery/searchdemand.ts";
import { loadConfig } from "../src/config.ts";

const day = 86_400_000;
const t0 = new Date("2026-11-14T20:00:00Z");
const row = (title: string, views: number): SearchRow => ({ videoId: "abcdefghijk", views, channel: "c", title });
const PAUSED = "YouTube fetch skipped: YouTube asked for a bot check, so fetching is paused until 22:19 UTC";

async function seeded() {
  const db = await testDb();
  let clock = t0;
  // A day's cache, as before DEMAND_CACHE_DAYS (26 Nov 2026), so the stale fallback is what these tests reach.
  const cache = dbDemandCache(db, () => clock, 24);
  // 14 Nov: the search works and measures two topics.
  const good = async (url: string) =>
    url.includes("Grand%20Theft%20Auto%20III")
      ? [row("GTA 3 Definitive Edition retrospective", 13_200_000)]
      : url.includes("Bully")
        ? [row("unrelated video", 900_000)]
        : [];
  await demandFor(
    [
      { name: "Grand Theft Auto III", source: "seed" },
      { name: "Bully", source: "seed" },
    ],
    { search: good, cache, lookups: 12, minViews: 20_000, now: t0 },
  );
  return { db, cache, setClock: (d: Date) => (clock = d) };
}

test("a paused search falls back to a reading from the last few days, marked stale", async () => {
  const { db, cache, setClock } = await seeded();
  const later = new Date(t0.getTime() + 3 * day);
  setClock(later);
  const paused = async () => {
    throw new Error(PAUSED);
  };
  const cands = [
    { name: "Grand Theft Auto III", source: "seed" },
    { name: "Grand Theft Auto Online", source: "seed" },
  ];
  const off = await demandFor(cands, { search: paused, cache, lookups: 12, minViews: 20_000, now: later });
  assert.equal(off.size, 0, "without the setting nothing stands in (the old behaviour)");
  const on = await demandFor(cands, { search: paused, cache, lookups: 12, minViews: 20_000, now: later, staleDays: 7 });
  const d = on.get("Grand Theft Auto III");
  assert.equal(d?.views, 13_200_000);
  assert.equal(d?.stale, true);
  assert.equal(on.has("Grand Theft Auto Online"), false, "a topic never measured stays unknown");
  // The stand-in is never written back: the stored reading keeps its own date and no stale mark.
  const [stored] = await db.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'demand:grand theft auto iii'`);
  const kept = JSON.parse(stored!.value);
  assert.equal(kept.at, t0.toISOString());
  assert.equal("stale" in kept, false);
  assert.equal(await cache.get("Grand Theft Auto III"), undefined, "still not fresh");
  await db.close();
});

test("readings older than the limit never stand in, and a fresh reading always wins", async () => {
  const { db, cache, setClock } = await seeded();
  const tooLate = new Date(t0.getTime() + 8 * day);
  setClock(tooLate);
  const paused = async () => {
    throw new Error(PAUSED);
  };
  const cands = [{ name: "Grand Theft Auto III", source: "seed" }];
  const old = await demandFor(cands, { search: paused, cache, lookups: 12, minViews: 20_000, now: tooLate, staleDays: 7 });
  assert.equal(old.size, 0);
  const fresh = await demandFor(cands, {
    search: async () => [row("GTA III twenty five years on", 2_000_000)],
    cache,
    lookups: 12,
    minViews: 20_000,
    now: tooLate,
    staleDays: 7,
  });
  assert.equal(fresh.get("Grand Theft Auto III")?.views, 2_000_000);
  assert.equal(fresh.get("Grand Theft Auto III")?.stale, undefined);
  await db.close();
});

test("lookups spent: the rest use their older readings rather than going blind", async () => {
  const { db, cache, setClock } = await seeded();
  const later = new Date(t0.getTime() + 2 * day);
  setClock(later);
  const searched: string[] = [];
  const search = async (url: string) => {
    searched.push(url);
    return [row("Halo Infinite news", 500_000)];
  };
  const cands = [
    { name: "Halo", source: "seed" },
    { name: "Grand Theft Auto III", source: "seed" },
  ];
  const got = await demandFor(cands, { search, cache, lookups: 1, minViews: 20_000, now: later, staleDays: 7 });
  assert.equal(searched.length, 1, "the lookup cap still holds");
  assert.equal(got.get("Halo")?.stale, undefined);
  assert.equal(got.get("Grand Theft Auto III")?.stale, true);
  await db.close();
});

test("an older 'no demand' reading ranks a topic low but never skips it; a fresh one still skips", () => {
  const now = new Date(t0.getTime() + 2 * day);
  const freshNone = scoreDemand("Bully", [], 20_000, now);
  const staleNone = { ...scoreDemand("Okami", [], 20_000, t0), stale: true };
  const staleHigh = { ...scoreDemand("Grand Theft Auto III", [row("GTA 3 retrospective", 13_200_000)], 20_000, t0), stale: true };
  const cands = [
    { name: "Okami", source: "seed" },
    { name: "Bully", source: "seed" },
    { name: "Grand Theft Auto III", source: "seed" },
    { name: "Unknown", source: "seed" },
  ];
  const demand = new Map([
    ["Bully", freshNone],
    ["Okami", staleNone],
    ["Grand Theft Auto III", staleHigh],
  ]);
  const { kept, skipped } = rankByDemand(cands, demand, 20_000);
  assert.deepEqual(skipped.map((c) => c.name), ["Bully"]);
  assert.deepEqual(kept.map((c) => c.name), ["Grand Theft Auto III", "Unknown", "Okami"]);
  assert.match(kept[0]!.note!, /YouTube, last measured 2026-11-14: 13\.2M views on its top videos that week/);
});

test("the Discord line says the figure is older and why", () => {
  const now = new Date(t0.getTime() + 3 * day);
  const d = { ...scoreDemand("Grand Theft Auto III", [row("GTA 3 retrospective", 13_200_000)], 20_000, t0), stale: true };
  const line = demandLine("Why Short at 22:00", "Grand Theft Auto III", d, 0, now);
  assert.equal(
    line,
    'Demand check, Why Short at 22:00: "Grand Theft Auto III" has 13.2M views on its top YouTube videos when last measured 3 days ago (high demand; a fresh search was not possible).',
  );
  assert.ok(!line.includes("—"));
  assert.match(demandLine("x", "y", d, 0), /when last measured on 2026-11-14/);
});

test("an older reading counts half against a fresh one", () => {
  const now = new Date(t0.getTime() + 2 * day);
  const fresh = scoreDemand("Halo", [row("Halo news", 4_000_000)], 20_000, now);
  const old = { ...scoreDemand("Grand Theft Auto III", [row("GTA 3 retrospective", 6_000_000)], 20_000, t0), stale: true };
  const cands = [{ name: "Grand Theft Auto III", source: "seed" }, { name: "Halo", source: "seed" }];
  const { kept } = rankByDemand(cands, new Map([["Halo", fresh], ["Grand Theft Auto III", old]]), 20_000);
  assert.deepEqual(kept.map((c) => c.name), ["Halo", "Grand Theft Auto III"]);
});

test("age check and the setting's default", () => {
  const d = scoreDemand("Halo", [], 20_000, t0);
  assert.equal(demandYoungerThan(d, 24, new Date(t0.getTime() + 23 * 3600_000)), true);
  assert.equal(demandYoungerThan(d, 24, new Date(t0.getTime() + 25 * 3600_000)), false);
  assert.equal(demandYoungerThan({ ...d, at: "garbage" }, 24, t0), false);
  assert.equal(demandYoungerThan(d, 24, new Date(t0.getTime() - 3600_000)), true, "a row stamped ahead still counts, as before");
  const saved = process.env.DEMAND_STALE_DAYS;
  try {
    delete process.env.DEMAND_STALE_DAYS;
    assert.equal(loadConfig().demandStaleDays, 21);
    process.env.DEMAND_STALE_DAYS = "0";
    assert.equal(loadConfig().demandStaleDays, 0);
  } finally {
    if (saved === undefined) delete process.env.DEMAND_STALE_DAYS;
    else process.env.DEMAND_STALE_DAYS = saved;
  }
});
