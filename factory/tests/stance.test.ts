// Item 21: rankings that take a side, no parts past 2, and the "complete" cut once enough films exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  completeCut,
  partProblems,
  proposeCompleteCuts,
  seriesOf,
  stanceProblems,
} from "../src/stance.ts";

test("a ranking's title takes a side", () => {
  assert.deepEqual(
    stanceProblems("GTA San Andreas Is Still the One to Beat"),
    [],
  );
  assert.deepEqual(stanceProblems("Why Vice City Beats Every 3D GTA"), []);
  assert.ok(stanceProblems("Every GTA Game Ranked").length, "a list's name");
  assert.ok(stanceProblems("Top 10 GTA Missions").length);
  assert.ok(stanceProblems("The Best GTA Games of 2026").length, "a year");
});

test("no long video past Part 2", () => {
  assert.deepEqual(partProblems("The GTA 6 Map, Part 2"), []);
  assert.equal(partProblems("The GTA 6 Map, Part 3").length, 1);
  assert.equal(partProblems("Leonida Explained Episode 4").length, 1);
});

const film = (n: number, minutes: number) => ({
  videoId: `v${n}`,
  title: `Film ${n}`,
  minutes,
  liveAt: new Date(Date.UTC(2026, 10, n)).toISOString(),
});

test("the complete cut: only once enough films, release order, 60 to 100 minutes", () => {
  assert.equal(
    completeCut("GTA", [film(1, 30), film(2, 30), film(3, 30)], 4),
    undefined,
  );
  const cut = completeCut(
    "GTA",
    [film(4, 30), film(1, 30), film(3, 30), film(2, 30)],
    4,
  )!;
  assert.deepEqual(
    cut.films.map((f) => f.videoId),
    ["v1", "v2", "v3", "v4"],
  );
  assert.equal(cut.minutes, 100);
  assert.equal(cut.trim, 20);
  assert.equal(cut.title, "GTA: The Complete Story");
  assert.equal(
    completeCut("GTA", [film(1, 10), film(2, 10), film(3, 10), film(4, 10)], 4),
    undefined,
    "under an hour",
  );
  assert.equal(seriesOf("Grand Theft Auto VI"), "GTA");
  assert.equal(seriesOf("Halo Infinite"), undefined);
});

test("proposeCompleteCuts: off does nothing; on tells the owner once per series", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "complete-"));
  const rows = [1, 2, 3, 4].map((n) => ({
    video_id: `v${n}`,
    title: `GTA film ${n}`,
    game: "Grand Theft Auto VI",
    seconds: "1800",
    live_at: new Date(Date.UTC(2026, 10, n)).toISOString(),
  }));
  const db = { query: async () => rows } as never;
  const notes: string[] = [];
  const notify = async (m: { content: string }) => notes.push(m.content);
  const cfg = { rankingStance: false, completeCutMin: 4, dataDir: dir };
  assert.deepEqual(await proposeCompleteCuts({ db, cfg, notify }), []);
  const on = { db, cfg: { ...cfg, rankingStance: true }, notify };
  assert.equal((await proposeCompleteCuts(on)).length, 1);
  assert.equal((await proposeCompleteCuts(on)).length, 0, "once only");
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /GTA: The Complete Story/);
});
