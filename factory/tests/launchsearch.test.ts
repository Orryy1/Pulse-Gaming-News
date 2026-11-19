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
