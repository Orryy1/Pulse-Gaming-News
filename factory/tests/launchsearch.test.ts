import { test } from "node:test";
import assert from "node:assert/strict";
import { launchCandidates } from "../src/sceneindex/build.ts";

const up = (id: string) => ({
  videoId: id,
  title: `t ${id}`,
  uploader: "u",
  duration: 7200,
});

test("launch search: a guard pause on every search is reported, not filed as no source", async () => {
  const skip = new Error(
    "YouTube fetch skipped: YouTube asked for a bot check, so fetching is paused until 22:19 UTC",
  );
  await assert.rejects(
    launchCandidates("Grand Theft Auto VI", "yt-dlp", async () => {
      throw skip;
    }),
    /fetching is paused/,
  );
});

test("launch search: one answered search keeps the results and ignores the skipped ones", async () => {
  let n = 0;
  const found = await launchCandidates(
    "Grand Theft Auto VI",
    "yt-dlp",
    async () => {
      n++;
      if (n === 1) return [up("a"), up("b")];
      throw new Error("YouTube fetch skipped: paused");
    },
  );
  assert.deepEqual(
    found.map((f) => f.videoId),
    ["a", "b"],
  );
});

test("launch search: other errors still count as nothing found", async () => {
  const found = await launchCandidates(
    "Grand Theft Auto VI",
    "yt-dlp",
    async () => {
      throw new Error("network down");
    },
  );
  assert.deepEqual(found, []);
});

import { firstPart, judgeUploads, pickComplete } from "../src/sceneindex/build.ts";

const gta = (id: string, title: string, duration: number) => ({ videoId: id.padEnd(11, "x"), title, uploader: "u", duration, uploadDate: "20261119" });

test("launch picker: GTA 6 titles name Grand Theft Auto VI, and Part 1 of a movie is taken while no whole movie exists", () => {
  const c = [
    gta("a", "GTA 6 All Cutscenes (PART 1) Game Movie 4K PS5 Pro Ultra HD", 8335),
    gta("b", "GTA 6 All Cutscenes (PART 2) Game Movie 4K PS5 Pro Ultra HD", 6217),
    gta("c", "GTA 6 - Full Game Walkthrough (No Commentary) 100% 4K", 39501),
    gta("d", "GTA 5 All Cutscenes Full Movie 4K", 17123),
  ];
  const v = judgeUploads(c, "Grand Theft Auto VI", { recentRelease: true, releasedOn: "2026-11-18" });
  assert.deepEqual(v.map((x) => x.ok), [true, false, true, false]);
  assert.equal(pickComplete(c, "Grand Theft Auto VI", { recentRelease: true, releasedOn: "2026-11-18" })?.videoId, c[0]!.videoId);
});

test("launch picker: a whole movie beats Part 1", () => {
  const c = [
    gta("a", "GTA 6 All Cutscenes (Part 1) Game Movie 4K", 8335),
    gta("b", "GTA 6 All Cutscenes Full Game Movie 4K", 7000),
  ];
  assert.equal(pickComplete(c, "Grand Theft Auto VI", { recentRelease: true })?.videoId, c[1]!.videoId);
});

test("firstPart: only the first of a series", () => {
  assert.equal(firstPart("Movie (Part 1)"), true);
  assert.equal(firstPart("Movie Chapter 1"), true);
  assert.equal(firstPart("Movie Part 2"), false);
  assert.equal(firstPart("Part 1 and Part 2"), false);
  assert.equal(firstPart("Full Movie"), false);
});
