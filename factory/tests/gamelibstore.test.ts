// The game library's storage (15 Nov 2026): the PC holds the master copy and serves it with byte ranges, the Mac keeps a
// capped cache and reads a missing scene's segment from the PC, and never waits when the PC is away.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import { FFMPEG } from "../src/lib/bin.ts";
import {
  createLibraryServer,
  parseRange,
  resolveInRoot,
} from "../src/assets/gamelibserve.ts";
import {
  planEviction,
  readableLibrary,
  remoteUrl,
  resetRemoteCheck,
  sourceOf,
  storeSettings,
  wantedOnMac,
} from "../src/assets/gamelibstore.ts";
import {
  libraryDir,
  materialise,
  type GameLibrary,
  type LibItem,
} from "../src/assets/gamelib.ts";

const exec = promisify(execFile);

test("byte ranges are read the way ffmpeg and browsers ask for them", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=0-5000", 1000), { start: 0, end: 999 });
  assert.equal(parseRange("bytes=1000-", 1000), "bad");
  assert.equal(parseRange("items=1-2", 1000), "bad");
  assert.equal(parseRange(undefined, 1000), undefined);
});

test("the server never serves a file outside the library", () => {
  const root = path.resolve("/lib");
  assert.equal(
    resolveInRoot(root, "/grand-theft-auto-vi/videos/a.mp4"),
    path.join(root, "grand-theft-auto-vi", "videos", "a.mp4"),
  );
  assert.equal(
    resolveInRoot(root, "/../secrets.txt"),
    path.join(root, "secrets.txt"),
  ); // normalised inside the root
  assert.equal(
    resolveInRoot(root, "/%2e%2e/%2e%2e/etc/passwd"),
    path.join(root, "etc", "passwd"),
  );
  assert.equal(resolveInRoot(root, "/"), undefined);
  assert.equal(resolveInRoot(root, "/%E0%A4%A"), undefined);
});

const item = (o: Partial<LibItem> & Pick<LibItem, "id" | "file">): LibItem => ({
  kind: "still",
  sourceUrl: o.id,
  provenance: o.id,
  source: "Rockstar Games",
  named: [],
  tags: [],
  seen: "",
  addedAt: "2026-11-01T00:00:00Z",
  ...o,
});

test("the Mac's cache drops the least recently used media of inactive games first and keeps active games", () => {
  const now = new Date("2026-11-20T00:00:00Z");
  const e = (game: string, file: string, gb: number, lastUsed: string) => ({
    game,
    file,
    bytes: gb * 1e9,
    lastUsed,
  });
  const entries = [
    e("Grand Theft Auto VI", "videos/t1.mp4", 20, "2026-10-01T00:00:00Z"),
    e("Grand Theft Auto V", "videos/stream.mp4", 15, "2026-10-01T00:00:00Z"),
    e("Elden Ring", "videos/old.mp4", 6, "2026-09-01T00:00:00Z"),
    e("Elden Ring", "videos/older.mp4", 5, "2026-08-01T00:00:00Z"),
    e("Cyberpunk 2077", "videos/recent.mp4", 4, "2026-11-18T00:00:00Z"),
  ];
  const plan = planEviction(entries, {
    capBytes: 40e9,
    activeGames: ["GTA 6", "GTA 5"],
    recentDays: 14,
    now,
  });
  assert.deepEqual(
    plan.map((p) => p.file),
    ["videos/older.mp4", "videos/old.mp4"],
  );
  // Under the cap: nothing goes.
  assert.deepEqual(
    planEviction(entries.slice(0, 2), {
      capBytes: 40e9,
      activeGames: [],
      recentDays: 14,
      now,
    }),
    [],
  );
  // The disk floor counts too: 3 GB short of it removes the oldest file even under the cap.
  assert.deepEqual(
    planEviction(entries.slice(2), {
      capBytes: 40e9,
      activeGames: [],
      recentDays: 14,
      now,
      freeBytes: 37e9,
      floorBytes: 40e9,
    }).map((p) => p.file),
    ["videos/older.mp4"],
  );
});

test("the Mac wants every file of an active game and only the recently used files of another", () => {
  const lib = (game: string): GameLibrary => ({
    version: 1,
    game,
    updatedAt: "",
    items: [
      item({ id: "a", file: "stills/a.jpg" }),
      item({ id: "b", file: "stills/b.jpg" }),
      item({ id: "c", file: "stills/c.jpg", unusable: "large lettering" }),
    ],
  });
  const s = { activeGames: ["Grand Theft Auto VI"], recentDays: 14 };
  const now = new Date("2026-11-20T00:00:00Z");
  assert.deepEqual(
    wantedOnMac(lib("Grand Theft Auto VI"), s, [], now).map((i) => i.id),
    ["a", "b"],
  );
  assert.deepEqual(
    wantedOnMac(
      lib("Elden Ring"),
      s,
      [
        {
          episode: "e",
          game: "Elden Ring",
          at: "2026-11-15T00:00:00Z",
          keys: ["b@3.1"],
        },
      ],
      now,
    ).map((i) => i.id),
    ["b"],
  );
  assert.deepEqual(
    wantedOnMac(
      lib("Elden Ring"),
      s,
      [
        {
          episode: "e",
          game: "Elden Ring",
          at: "2026-10-01T00:00:00Z",
          keys: ["b@3.1"],
        },
      ],
      now,
    ).map((i) => i.id),
    [],
  );
});

test("a scene the Mac does not hold is cut from the PC's copy over HTTP; with the PC away the Short goes on without it", async () => {
  const pc = await fs.mkdtemp(path.join(os.tmpdir(), "pc-lib-"));
  const mac = await fs.mkdtemp(path.join(os.tmpdir(), "mac-lib-"));
  const ep = await fs.mkdtemp(path.join(os.tmpdir(), "ep-"));
  const game = "Grand Theft Auto VI";
  const pcDir = libraryDir(pc, game);
  await fs.mkdir(path.join(pcDir, "videos"), { recursive: true });
  await exec(FFMPEG, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x180:rate=30:duration=8",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    path.join(pcDir, "videos", "t.mp4"),
  ]);
  const server = createLibraryServer(pc);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  const prev = process.env.GAMELIB_REMOTE;
  try {
    process.env.GAMELIB_REMOTE = `http://127.0.0.1:${port}`;
    resetRemoteCheck();
    const lib: GameLibrary = {
      version: 1,
      game,
      updatedAt: "",
      items: [
        item({
          id: "t",
          kind: "video",
          file: "videos/t.mp4",
          scenes: [{ at: 2, end: 5, tags: ["road"], seen: "a road" }],
        }),
      ],
    };
    const s = storeSettings();
    assert.equal(
      remoteUrl(s.remote, libraryDir(mac, game), "videos/t.mp4"),
      `http://127.0.0.1:${port}/grand-theft-auto-vi/videos/t.mp4`,
    );
    assert.ok((await sourceOf(mac, game, "videos/t.mp4", s))?.url);
    assert.equal((await readableLibrary(mac, lib, s)).items.length, 1);
    const made = await materialise(
      mac,
      {
        key: "beat:0",
        sentence: "x",
        game,
        item: lib.items[0]!,
        scene: lib.items[0]!.scenes![0],
        score: 1,
      },
      ep,
      2,
    );
    assert.ok(made, "the segment was read from the PC");
    assert.ok((await fs.stat(path.join(ep, made!.file))).size > 1000);
    // The PC goes away: nothing to read, no wait, and the library offers nothing it cannot deliver.
    await new Promise<void>((r) => server.close(() => r()));
    resetRemoteCheck();
    const t0 = Date.now();
    assert.equal(
      await sourceOf(mac, game, "videos/t.mp4", storeSettings()),
      undefined,
    );
    assert.equal(
      (await readableLibrary(mac, lib, storeSettings())).items.length,
      0,
    );
    assert.ok(Date.now() - t0 < 8000);
  } finally {
    if (prev === undefined) delete process.env.GAMELIB_REMOTE;
    else process.env.GAMELIB_REMOTE = prev;
    resetRemoteCheck();
    server.close();
    for (const d of [pc, mac, ep])
      await fs.rm(d, { recursive: true, force: true });
  }
});
