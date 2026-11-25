// The scene index queue (src/sceneindex/job.ts): concurrent writers keep every entry, and the turn picker no longer
// lets one launch build and the disk gate starve every other game (12-19 Nov 2026: 493 refusals at 42 GB free and
// "could not queue ... ENOENT" for Assassin's Creed Shadows and twelve more).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "./helpers.ts";
import {
  pickTurn,
  readQueue,
  requestSceneIndex,
  type QueuedGame,
  type SceneQueue,
} from "../src/sceneindex/job.ts";

const now = new Date("2026-11-20T00:00:00Z");

test("many games queued at once are all kept and no temporary file is left behind", async () => {
  const dir = await tmpDir();
  const cfg = { dataDir: dir, sceneIndex: true };
  const games = Array.from({ length: 12 }, (_, i) => `Game Number ${i + 1}`);
  await Promise.all(
    games.map((g) => requestSceneIndex(cfg, g, "a video about it", false, now)),
  );
  const q = await readQueue(dir);
  assert.deepEqual(q.games.map((g) => g.game).sort(), [...games].sort());
  const left = (await fs.readdir(path.join(dir, "sceneindex"))).filter((f) =>
    f.endsWith(".tmp"),
  );
  assert.deepEqual(left, []);
});

const launch: QueuedGame = {
  game: "Grand Theft Auto VI",
  reason: "footage: GAME_FETCH_TITLES",
  requestedAt: "2026-11-12T04:43:55.782Z",
  recentRelease: true,
  state: "building",
  lastTry: "2026-11-19T22:00:00Z",
  fetch: {
    notBefore: "2026-11-18T11:00:00.000Z",
    searchEveryHours: 3,
    recheckEveryHours: 24,
    recheckUntil: "2026-12-18T00:00:00.000Z",
    priority: 50,
  },
};
const asked: QueuedGame = {
  game: "Assassin's Creed Shadows",
  reason: "a video about it",
  requestedAt: "2026-11-19T16:39:01Z",
};
const queue: SceneQueue = { games: [launch, asked] };

test("a light index goes ahead of the launch build: it needs no video and takes a minute", () => {
  const r = pickTurn(queue, now, {
    freeGb: 42,
    floorGb: 40,
    archiveBacklog: true,
    hasIndex: () => false,
    hasProxy: () => false,
  });
  assert.equal(r.job?.game, "Assassin's Creed Shadows");
  assert.equal(r.light, true);
});

test("at 42 GB free a launch build whose proxy is on disk runs; one that must fetch a proxy waits", () => {
  const onDisk = pickTurn({ games: [launch] }, now, {
    freeGb: 42,
    floorGb: 40,
    archiveBacklog: true,
    hasIndex: () => true,
    hasProxy: () => true,
  });
  assert.equal(onDisk.job?.game, "Grand Theft Auto VI");
  assert.equal(onDisk.light, false);
  const fetching = pickTurn({ games: [launch] }, now, {
    freeGb: 42,
    floorGb: 40,
    archiveBacklog: true,
    hasIndex: () => true,
    hasProxy: () => false,
  });
  assert.equal(fetching.job, undefined);
  assert.equal(fetching.blocked?.game, "Grand Theft Auto VI");
});

test("a game the disk refuses no longer blocks the next one that can run", () => {
  const indexed: QueuedGame = {
    ...asked,
    game: "Grand Theft Auto V",
    state: "building",
    lastTry: "2026-11-19T00:00:00Z",
  };
  const r = pickTurn({ games: [launch, indexed] }, now, {
    freeGb: 41,
    floorGb: 40,
    archiveBacklog: true,
    hasIndex: () => true,
    hasProxy: (g) => g.game === "Grand Theft Auto V",
  });
  assert.equal(r.job?.game, "Grand Theft Auto V");
});

test("below the floor nothing runs, not even a light index", () => {
  const r = pickTurn(queue, now, {
    freeGb: 39,
    floorGb: 40,
    archiveBacklog: true,
    hasIndex: () => false,
    hasProxy: () => true,
  });
  assert.equal(r.job, undefined);
  assert.ok(r.blocked);
});
