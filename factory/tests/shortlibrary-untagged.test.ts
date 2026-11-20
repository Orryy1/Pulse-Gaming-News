// The untagged fallback (15 Nov 2026): a game library whose trailers are on disk but not yet tagged still gives a
// Short moving footage, spread across videos, never dark, still or lettered, and not what recent Shorts showed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../src/lib/bin.ts";
import {
  libraryDir,
  writeLibrary,
  assetKey,
  type LibItem,
} from "../src/assets/gamelib.ts";
import {
  libraryHasFootage,
  segmentUsable,
  shortLibraryMedia,
  untaggedSpots,
  untaggedVideo,
} from "../src/assets/shortlibrary.ts";

const exec = promisify(execFile);

const video = (
  id: string,
  seconds: number,
  extra: Partial<LibItem> = {},
): LibItem => ({
  id,
  kind: "video",
  file: `videos/${id}.mp4`,
  sourceUrl: id,
  provenance: `Official trailer "${id}"`,
  source: "Rockstar Games",
  named: ["trailer"],
  tags: [],
  seen: "",
  durationSeconds: seconds,
  addedAt: "",
  ...extra,
});

test("untagged spots come from the middle of each video, a different video each turn, recent ones last", () => {
  const items = [
    video("a", 90),
    video("b", 160),
    video("clip", 1.5),
    video("tagged", 90, {
      scenes: [{ at: 5, end: 9, tags: ["road"], seen: "a road" }],
    }),
  ];
  assert.equal(untaggedVideo(items[2]!), false); // a one-second site loop
  assert.equal(untaggedVideo(items[3]!), false); // already tagged: the tags serve it
  const spots = untaggedSpots(items, 6);
  assert.deepEqual(
    spots.slice(0, 4).map((s) => s.item.id),
    ["b", "a", "b", "a"],
  );
  for (const s of spots) {
    const d = s.item.durationSeconds!;
    assert.ok(
      s.at >= d * 0.1 - 0.01 && s.end <= d * 0.9 + 0.01,
      `${s.item.id} ${s.at}-${s.end} inside the middle`,
    );
  }
  const recent = new Map([[assetKey(spots[0]!.item, { at: spots[0]!.at }), 1]]);
  const again = untaggedSpots(items, 40, recent);
  assert.notDeepEqual(
    [again[0]!.item.id, again[0]!.at],
    [spots[0]!.item.id, spots[0]!.at],
  );
  assert.deepEqual(
    [again.at(-1)!.item.id, again.at(-1)!.at],
    [spots[0]!.item.id, spots[0]!.at],
  );
});

test("a dark or still segment is refused; moving footage is kept", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "seg-"));
  try {
    const make = async (name: string, src: string) => {
      const f = path.join(dir, name);
      await exec(FFMPEG, [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        src,
        "-t",
        "3",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        f,
      ]);
      return f;
    };
    assert.equal(
      await segmentUsable(
        await make("black.mp4", "color=c=black:s=320x180:r=30"),
      ),
      false,
    );
    assert.equal(
      await segmentUsable(
        await make("still.mp4", "color=c=0x507090:s=320x180:r=30"),
      ),
      false,
    );
    assert.equal(
      await segmentUsable(
        await make(
          "life.mp4",
          "life=s=320x180:mold=10:r=30:ratio=0.3:death_color=#203040:life_color=#e0c080",
        ),
      ),
      true,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a Short gets clips from an untagged library, and the gate counts that footage", async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "data-"));
  const ep = await fs.mkdtemp(path.join(os.tmpdir(), "ep-"));
  const prev = {
    dir: process.env.GAME_LIBRARY_DIR,
    remote: process.env.GAMELIB_REMOTE,
  };
  delete process.env.GAME_LIBRARY_DIR;
  delete process.env.GAMELIB_REMOTE;
  try {
    const root = path.join(data, "gamelib");
    const game = "Grand Theft Auto VI";
    const dir = libraryDir(root, game);
    await fs.mkdir(path.join(dir, "videos"), { recursive: true });
    for (const id of ["t1", "t2"])
      await exec(FFMPEG, [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "life=s=320x180:mold=10:r=30:ratio=0.3:death_color=#203040:life_color=#e0c080",
        "-t",
        "24",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        path.join(dir, "videos", `${id}.mp4`),
      ]);
    await writeLibrary(root, {
      version: 1,
      game,
      updatedAt: "",
      items: [video("t1", 24), video("t2", 24)],
    });
    assert.equal(await libraryHasFootage(data, game), true);
    const got = await shortLibraryMedia({
      dataDir: data,
      episodeId: "ep_test",
      episodeDir: ep,
      maxClipSeconds: 40,
      script: {
        game_title: game,
        headline: "Can you play GTA 6 on PS4?",
        hook: "Can you play GTA 6 on a PS4?",
        beats: [
          { narration: "Rockstar lists PS5 and Xbox Series X and S only." },
          { narration: "The old consoles miss out." },
        ],
        pulse_take: { narration: "Time to upgrade." },
        loop_line: "",
      },
    });
    assert.equal(got.footageExists, true);
    assert.ok(got.untagged >= 3, `untagged clips: ${got.untagged}`);
    assert.ok(
      got.clips.every(
        (c) =>
          c.reason === "library (untagged)" &&
          c.durationSeconds >= 3 &&
          c.provenance.includes("publisher: Rockstar Games"),
      ),
    );
    assert.ok(
      new Set(got.clips.slice(0, 2).map((c) => c.sourceUrl)).size === 2,
      "consecutive lines come from different videos",
    );
    assert.equal(
      new Set(got.clips.map((c) => c.libKey)).size,
      got.clips.length,
      "no segment twice in one Short",
    );
  } finally {
    if (prev.dir !== undefined) process.env.GAME_LIBRARY_DIR = prev.dir;
    if (prev.remote !== undefined) process.env.GAMELIB_REMOTE = prev.remote;
    await fs.rm(data, { recursive: true, force: true });
    await fs.rm(ep, { recursive: true, force: true });
  }
});
