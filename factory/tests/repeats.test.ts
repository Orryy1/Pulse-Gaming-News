import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  capStockClips,
  capStockTargets,
  duplicateFiles,
  freeName,
  keepLatestPerFile,
  sameStockTheme,
  shortHash,
  stockTheme,
  themeWord,
} from "../src/assets/repeats.ts";
import { fillSentencePictures, type FillDeps } from "../src/assets/fill.ts";
import type { FootageTarget } from "../src/assets/clipscore.ts";

test("a stock theme is its telling words, singular and with -ing folded", () => {
  assert.equal(themeWord("Desks"), "desk");
  assert.equal(themeWord("counting"), "count");
  assert.equal(themeWord("queueing"), "queue");
  assert.equal(themeWord("factories"), "factory");
  assert.equal(themeWord("glass"), "glass");
  assert.deepEqual(stockTheme("Game developers at desks"), [
    "game",
    "developer",
    "desk",
  ]);
});

test("near-duplicate stock searches are one theme; different subjects are not", () => {
  assert.ok(
    sameStockTheme("game developers at desks", "game developers working"),
  );
  assert.ok(
    sameStockTheme("game developers working at", "Game Developers at desk"),
  );
  assert.ok(sameStockTheme("office at night", "empty office at night"));
  assert.ok(sameStockTheme("Los Angeles street", "Los Angeles streets"));
  assert.ok(sameStockTheme("counting cash", "cash"));
  assert.ok(!sameStockTheme("office at night", "office building windows"));
  assert.ok(!sameStockTheme("office at night", "Miami street at night"));
  assert.ok(!sameStockTheme("counting cash", "business handshake"));
  assert.ok(!sameStockTheme("", "office"));
});

test("at most two stock clips per theme in a video, counting the clips it already has", () => {
  const existing = [
    { stock: true, label: "office at night" },
    { stock: true, label: "empty office at night" },
    { stock: true, label: "counting cash" },
    { label: "office at night" }, // game footage with a similar label is not stock
  ];
  const targets = [
    "office at night",
    "counting cash",
    "people counting cash",
    "counting cash",
    "business meeting",
  ];
  const r = capStockTargets(targets, existing, (t) => t, 2);
  assert.deepEqual(r.kept, ["counting cash", "business meeting"]);
  assert.deepEqual(r.dropped, [
    "office at night",
    "people counting cash",
    "counting cash",
  ]);
  // 0 is no cap.
  assert.equal(capStockTargets(targets, existing, (t) => t, 0).kept.length, 5);
});

test("the cap applied to an existing list keeps the first two of each theme", () => {
  const clips = [
    { stock: true, label: "office at night", n: 0 },
    { label: "Tommy on Ocean Drive", n: 1 },
    { stock: true, label: "office at night", n: 2 },
    { stock: true, label: "empty office at night", n: 3 },
    { stock: true, label: "counting cash", n: 4 },
  ];
  assert.deepEqual(
    capStockClips(clips, 2).map((c) => c.n),
    [0, 1, 2, 4],
  );
});

test("a download's name never takes one already in the folder", () => {
  const taken = new Set(["stock-12.mp4", "stock-12-2.mp4"]);
  assert.equal(freeName("stock-12", ".mp4", taken), "stock-12-3.mp4");
  assert.equal(freeName("stock-13", ".mp4", taken), "stock-13.mp4");
  assert.equal(
    freeName("STOCK-12", ".MP4", new Set(["stock-12.mp4"])),
    "STOCK-12-2.MP4",
    "Windows names ignore case",
  );
  assert.equal(
    shortHash("https://commons.wikimedia.org/wiki/File:A.jpg").length,
    10,
  );
  assert.equal(shortHash("a"), shortHash("a"));
  assert.notEqual(shortHash("a"), shortHash("b"));
});

test("a second top-up run named from 0 again collided; naming by the next free name does not", () => {
  // The Vice City failure, on fake lists: each run of the old naming restarted at stock_0.
  const oldRun = (n: number) =>
    Array.from({ length: n }, (_, k) => ({
      file: `entry_0/fill/stock/assets/stock_${k}.mp4`,
    }));
  const before = [...oldRun(2), ...oldRun(1)];
  assert.deepEqual(duplicateFiles(before), [
    "entry_0/fill/stock/assets/stock_0.mp4",
  ]);
  // The new naming: Pexels id first, then the next free name against the files already there.
  const folder = new Set<string>();
  const run = (ids: number[]) =>
    ids.map((id) => {
      const name = freeName(`stock-${id}`, ".mp4", folder);
      folder.add(name.toLowerCase());
      return { file: `entry_0/fill/stock/assets/${name}` };
    });
  const after = [...run([101, 102]), ...run([101, 103])];
  assert.deepEqual(duplicateFiles(after), []);
});

test("the repair keeps the later entry of a file listed twice and everything else in place", () => {
  const clips = [
    {
      file: "entry_0\\fill\\stock\\assets\\stock_0.mp4",
      label: "people queueing at shop",
    },
    { file: "entry_0/assets/clip_1.mp4", label: "trailer" },
    {
      file: "entry_0/fill/stock/assets/stock_0.mp4",
      label: "calendar pages turning",
    },
    { label: "no file" },
  ];
  assert.deepEqual(duplicateFiles(clips), [
    "entry_0\\fill\\stock\\assets\\stock_0.mp4",
  ]);
  assert.deepEqual(
    keepLatestPerFile(clips).map((c) => c.label),
    ["trailer", "calendar pages turning", "no file"],
  );
});

/** A top-up with every network step faked: stock only (no art, no photos, the editor picks nothing). */
async function topUp(
  clips: Array<Record<string, unknown>>,
  returned: (t: FootageTarget[]) => Array<Record<string, unknown>>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repeats-"));
  const asked: { targets: FootageTarget[]; avoid?: string[] }[] = [];
  const deps: FillDeps = {
    llm: { structured: async () => ({ picks: [], graphics: [] }) } as never,
    igdbArt: async () => [],
    searchPhotos: async () => [],
    downloadPhoto: async () => false,
    fetchStock: async (_d, targets, _g, _m, avoid) => {
      asked.push({ targets, avoid });
      return returned(targets) as never;
    },
  };
  const moments = [
    { show: "the office", broll: "office at night" },
    { show: "money", broll: "counting cash" },
    { show: "the team", broll: "business meeting" },
  ];
  const r = await fillSentencePictures(
    deps,
    dir,
    [{ entry: 1, game: "Vice City", moments, sentences: ["a.", "b.", "c."] }],
    [],
    clips as never,
    "Grand Theft Auto",
    undefined,
    undefined,
    { stockThemeMax: 2 },
  );
  await fs.rm(dir, { recursive: true, force: true });
  return { asked, r };
}

test("the top-up asks no stock for a theme the video already has twice, and never reuses a Pexels video", async () => {
  const clips = [
    {
      file: "entry_0/fill/stock/assets/stock_0.mp4",
      stock: true,
      label: "office at night",
      sourceUrl: "https://pexels.com/v/1",
      beatIndex: 0,
      moment: 3,
    },
    {
      file: "entry_0/fill/stock/assets/stock_1.mp4",
      stock: true,
      label: "office at night",
      sourceUrl: "https://pexels.com/v/2",
      beatIndex: 0,
      moment: 5,
    },
  ];
  const { asked, r } = await topUp(clips, () => []);
  assert.deepEqual(
    asked[0]!.targets.map((t) => t.keywords[0]),
    ["counting cash", "business meeting"],
  );
  assert.deepEqual(asked[0]!.avoid, [
    "https://pexels.com/v/1",
    "https://pexels.com/v/2",
  ]);
  assert.equal(r.stockCapped, 1);
});

test("the top-up never lists a second clip for a file another clip already points to", async () => {
  const clips = [
    {
      file: path.join("entry_1", "fill", "stock", "assets", "stock_0.mp4"),
      stock: true,
      label: "nightclub lights",
      beatIndex: 1,
      moment: 7,
    },
  ];
  // A stock fetcher that still names from 0 (the old behaviour) hands back a file that is already listed.
  const { asked } = await topUp(clips, (targets) =>
    targets.map((t, k) => ({
      kind: "clip",
      file: path.join("assets", `stock_${k}.mp4`),
      moment: Number(t.key.split("#m")[1]),
      stock: true,
      label: t.keywords[0],
    })),
  );
  assert.equal(asked.length, 1);
  assert.deepEqual(duplicateFiles(clips), []);
  assert.equal(
    clips.length,
    3,
    "stock_1 and stock_2 are added, stock_0 is refused",
  );
});

import { fetchIgdbArt } from "../src/assets/igdb.ts";

test("IGDB art is named by its picture id, so a second fetch never puts another picture under a placed name", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "igdbnames-"));
  const fake = (async (url: string) => new Response(String(url))) as unknown as typeof fetch;
  const game = (shots: string[]) => ({ id: 1, name: "Vice City", screenshots: shots, artworks: [] });
  const first = await fetchIgdbArt(game(["sc1", "sc2"]), dir, 10, fake);
  // IGDB now lists another screenshot first: the old igdb_<k> naming wrote it over the first run's igdb_0.
  const second = await fetchIgdbArt(game(["sc9", "sc1"]), dir, 10, fake);
  const placed = path.join(dir, first[0]!.file);
  assert.match(await fs.readFile(placed, "utf8"), /sc1\.jpg$/);
  assert.notEqual(second[0]!.file, first[0]!.file);
  assert.equal(second[1]!.file, first[0]!.file, "the same picture keeps its name");
  await fs.rm(dir, { recursive: true, force: true });
});

import { trimStockThemes } from "../src/assets/repeats.ts";

test("trimming a theme keeps the clips that are their sentence's only media, then the earliest", () => {
  const clips = [
    { n: 0, stock: true, label: "office at night", beatIndex: 2, moment: 4 }, // the line also has a screenshot
    { n: 1, stock: true, label: "office at night", beatIndex: 3, moment: 1 }, // its only media
    { n: 2, label: "trailer", beatIndex: 0, moment: 2 },
    { n: 3, stock: true, label: "empty office at night", beatIndex: 0, moment: 9 }, // the earliest
    { n: 4, stock: true, label: "office at night", beatIndex: 0, moment: 2 }, // shares its line with the trailer
    { n: 5, stock: true, label: "counting cash", beatIndex: 1, moment: 0 },
  ];
  const images = [{ beatIndex: 2, moment: 4 }];
  const r = trimStockThemes(clips, images, 2);
  // Sole media: 1 and 3 (3 is also the earliest); 0 and 4 share their line with other media.
  assert.deepEqual(r.kept.map((c) => c.n), [1, 2, 3, 5]);
  assert.deepEqual(r.dropped.map((c) => c.n).sort(), [0, 4]);
  // A second run drops nothing; 0 is off.
  assert.equal(trimStockThemes(r.kept, images, 2).dropped.length, 0);
  assert.equal(trimStockThemes(clips, images, 0).dropped.length, 0);
});
