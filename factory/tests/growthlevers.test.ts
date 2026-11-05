import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abQueueView,
  packagingLines,
  parseReachCsv,
  videoReach,
  worstLongs,
  type CtrRow,
} from "../src/reach.ts";
import {
  searchLine,
  searchSeeds,
  searchTermsFor,
  suggestions,
  usableTerms,
} from "../src/searchterms.ts";
import {
  pickThumbImage,
  shortThumbArm,
  thumbWords,
} from "../src/shortthumb.ts";

test("reach report: parses the columns by name and drops what it can't read", () => {
  const rows = parseReachCsv(
    "date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n20261101,UC1,abc,1000,0.015\n20261102,UC1,abc,500,oops\n20261102,UC1,def,200,0.05\n",
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    date: "20261101",
    videoId: "abc",
    impressions: 1000,
    ctr: 0.015,
  });
  assert.deepEqual(parseReachCsv("date,video_id\n20261101,abc\n"), []);
});

test("reach report: a restated day replaces the earlier row, days add up, click-through is weighted", () => {
  const m = videoReach([
    { date: "1", videoId: "a", impressions: 1000, ctr: 0.01 },
    { date: "1", videoId: "a", impressions: 2000, ctr: 0.01 },
    { date: "2", videoId: "a", impressions: 2000, ctr: 0.03 },
  ]);
  const a = m.get("a")!;
  assert.equal(a.impressions, 4000);
  assert.equal(a.days, 2);
  assert.ok(Math.abs(a.ctr - 0.02) < 1e-9);
});

const row = (o: Partial<CtrRow>): CtrRow => ({
  videoId: "v",
  title: "T",
  format: "news",
  long: false,
  impressions: 1000,
  clicks: 10,
  ...o,
});

test("packaging lines: nothing without data; small samples say so; the worst long video is named", () => {
  assert.deepEqual(packagingLines([]), []);
  const lines = packagingLines([
    row({ impressions: 5000, clicks: 100 }),
    row({ format: "why", impressions: 100, clicks: 9 }),
    row({
      long: true,
      format: "ranking",
      title: "GTA ranked",
      impressions: 3577,
      clicks: 21,
    }),
  ]).join("\n");
  assert.match(lines, /Short: news: \*\*2\.0%\*\*/);
  assert.match(lines, /Short: why: not enough data/);
  assert.match(lines, /Losing the most clicks: GTA ranked \(0\.6%/);
});

test("packaging lines: the thumbnail test only calls it with 3,000 impressions a side", () => {
  const early = packagingLines([
    row({ thumbArm: "designed", impressions: 2000, clicks: 80 }),
    row({ thumbArm: "frame", impressions: 4000, clicks: 40 }),
  ]).join("\n");
  assert.match(early, /not enough data yet/);
  const ready = packagingLines([
    row({ thumbArm: "designed", impressions: 3000, clicks: 120 }),
    row({ thumbArm: "frame", impressions: 4000, clicks: 40 }),
  ]).join("\n");
  assert.match(ready, /designed 4\.0% \(1 Shorts\), first frame 1\.0%/);
});

test("worst long videos: only long, only judged, only under the floor, most lost first", () => {
  const w = worstLongs([
    row({ long: true, videoId: "a", impressions: 400, clicks: 0 }),
    row({ long: true, videoId: "b", impressions: 1000, clicks: 50 }),
    row({ long: true, videoId: "c", impressions: 3000, clicks: 20 }),
    row({ long: true, videoId: "d", impressions: 1300, clicks: 4 }),
    row({ long: false, videoId: "e", impressions: 9000, clicks: 1 }),
  ]);
  assert.deepEqual(
    w.map((x) => x.videoId),
    ["c", "d"],
  );
});

test("test queue: a replaced upload goes, the most clicks lost go first, ties keep their order", () => {
  const q = abQueueView(
    [
      { videoId: "old", episode: "e1" },
      { videoId: "a", episode: "e2" },
      { videoId: "b", episode: "e3" },
      { videoId: "c", episode: "e4" },
    ],
    new Map([
      ["e1", "new"],
      ["e2", "a"],
      ["e3", "b"],
      ["e4", "c"],
    ]),
    new Map([["c", 50]]),
  );
  assert.deepEqual(
    q.map((x) => x.videoId),
    ["c", "a", "b"],
  );
});

test("search seeds: the short forms people type", () => {
  assert.ok(searchSeeds("Grand Theft Auto VI").includes("gta 6"));
  assert.ok(searchSeeds("Attack on Titan 3").includes("aot 3"));
  assert.ok(
    searchSeeds("Call of Duty: Modern Warfare 4").includes("modern warfare 4"),
  );
  assert.deepEqual(searchSeeds(""), []);
});

test("search terms: every word beyond the game's name must be in the script", () => {
  const script =
    "GTA 6 pre-load starts November 10 and the download size is 212 GB on Xbox.";
  assert.deepEqual(
    usableTerms(
      [
        "gta 6 download size",
        "gta 6 trailer 3",
        "gta 6 pre load",
        "gta 6",
        "gta 6 download size",
      ],
      "Grand Theft Auto VI",
      script,
    ),
    ["gta 6 download size", "gta 6 pre load"],
  );
});

test("search terms: never cheats, piracy or leaks, even when the script says the word", () => {
  assert.deepEqual(
    usableTerms(
      [
        "gta 6 leak",
        "gta 6 money glitch",
        "gta 6 crack download",
        "gta 6 leaks map",
      ],
      "Grand Theft Auto VI",
      "the leak, the map, the money glitch, the crack and the download",
    ),
    [],
  );
});

test("search terms: a term about another game doesn't pass and the cap holds", () => {
  const out = usableTerms(
    [
      "elden ring map",
      "saros map",
      "saros zenith",
      "saros review",
      "saros ng",
      "saros boss",
    ],
    "Saros",
    "map zenith review ng boss update",
    3,
  );
  assert.deepEqual(out, ["saros map", "saros zenith", "saros review"]);
});

test("autocomplete trouble means no terms, never an error", async () => {
  assert.deepEqual(
    await suggestions("x", async () => {
      throw new Error("offline");
    }),
    [],
  );
  assert.deepEqual(
    await suggestions("x", async () => new Response("not json")),
    [],
  );
  assert.deepEqual(
    await searchTermsFor(
      "Saros",
      "zenith",
      async () => new Response(JSON.stringify(["saros", ["saros zenith"]])),
    ),
    ["saros zenith"],
  );
  assert.equal(searchLine([]), "");
  assert.equal(searchLine(["saros zenith"]), "Covers: saros zenith.");
});

test("thumbnail arm: fixed for an episode, about half each way, off at 0 and all at 1", () => {
  assert.equal(shortThumbArm("ep_1", 0), "frame");
  assert.equal(shortThumbArm("ep_1", 1), "designed");
  assert.equal(shortThumbArm("ep_x", 0.5), shortThumbArm("ep_x", 0.5));
  let designed = 0;
  for (let i = 0; i < 2000; i++)
    if (shortThumbArm(`ep_${i}`, 0.5) === "designed") designed++;
  assert.ok(designed > 900 && designed < 1100, String(designed));
});

test("thumbnail picture: no screen text, the hero if it's game art, a person's photo only as a last resort", () => {
  const art = { file: "a.jpg", kind: "hero", aspect: 1.7 };
  const person = { file: "p.jpg", kind: "photo", aspect: 1 };
  const menu = { file: "m.jpg", kind: "screenshot", aspect: 1.7, wordy: true };
  const shot = { file: "s.jpg", kind: "screenshot", aspect: 1.7 };
  assert.equal(pickThumbImage([person, art], 0), art);
  assert.equal(pickThumbImage([menu, shot], 0), shot);
  assert.equal(pickThumbImage([shot, art], 0), shot);
  assert.equal(pickThumbImage([person]), person);
  assert.equal(pickThumbImage([menu]), undefined);
  assert.equal(pickThumbImage(undefined), undefined);
});

test("thumbnail words: the writer's hook, or nothing", () => {
  assert.equal(thumbWords(" servers  down "), "SERVERS DOWN");
  assert.equal(thumbWords(undefined), undefined);
  assert.equal(thumbWords("one two three four five"), undefined);
  assert.equal(
    thumbWords("a very long hook that will not fit a tile"),
    undefined,
  );
});
