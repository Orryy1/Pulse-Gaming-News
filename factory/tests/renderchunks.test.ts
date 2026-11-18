import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "./helpers.ts";
import {
  CHUNK_FILE,
  MANIFEST,
  chunkKey,
  concatList,
  fileStamps,
  joinArgs,
  planChunks,
  readManifest,
  renderChunked,
  servedFiles,
  type ChunkedRenderDeps,
} from "../src/render/chunked.ts";
import { masterEncoder, renderSpeedFrom } from "../src/render/renderspeed.ts";
import { chunkSetupFor } from "../src/render/render.ts";

test("planChunks covers the range exactly, folding a sliver into the chunk before", () => {
  assert.deepEqual(planChunks(0, 5999, 1800), [
    { index: 0, from: 0, to: 1799 },
    { index: 1, from: 1800, to: 3599 },
    { index: 2, from: 3600, to: 5399 },
    { index: 3, from: 5400, to: 5999 },
  ]);
  // 100 frames left over is under a quarter of 1800: it joins chunk 2.
  assert.deepEqual(planChunks(0, 5499, 1800).at(-1), {
    index: 2,
    from: 3600,
    to: 5499,
  });
  assert.deepEqual(planChunks(900, 1000, 1800), [
    { index: 0, from: 900, to: 1000 },
  ]);
  assert.throws(() => planChunks(10, 5, 100));
  for (const [a, b, s] of [
    [0, 99, 7],
    [3, 12_345, 1800],
    [0, 0, 60],
  ] as const) {
    const c = planChunks(a, b, s);
    assert.equal(c[0]!.from, a);
    assert.equal(c.at(-1)!.to, b);
    for (let i = 1; i < c.length; i++)
      assert.equal(c[i]!.from, c[i - 1]!.to + 1);
  }
});

test("chunkKey ignores key order and changes with any input", () => {
  assert.equal(
    chunkKey({ a: 1, b: [1, { c: 2, d: 3 }] }),
    chunkKey({ b: [1, { d: 3, c: 2 }], a: 1 }),
  );
  assert.notEqual(chunkKey({ a: 1 }), chunkKey({ a: 2 }));
  assert.equal(chunkKey({ a: 1, b: undefined }), chunkKey({ a: 1 }));
});

test("servedFiles lists the episode files the props name, and fileStamps notices a change", async () => {
  const url = "http://127.0.0.1:5123";
  const json = JSON.stringify({
    a: `${url}/clips/c%201.mp4`,
    b: [`${url}/voice.mp3`, `${url}/voice.mp3`],
    logo: "logo.png",
  });
  assert.deepEqual(servedFiles(json, url), ["clips/c 1.mp4", "voice.mp3"]);
  const dir = await tmpDir();
  await fs.writeFile(path.join(dir, "voice.mp3"), "aaaa");
  const before = fileStamps(dir, ["voice.mp3", "gone.mp4"]);
  assert.equal(before["gone.mp4"], "missing");
  await fs.writeFile(path.join(dir, "voice.mp3"), "aaaaaaaa");
  assert.notEqual(
    fileStamps(dir, ["voice.mp3"])["voice.mp3"],
    before["voice.mp3"],
  );
});

test("concatList quotes paths and joinArgs copies both streams", () => {
  assert.equal(
    concatList(["/a/c0000.mp4", "C:\\x\\it's.mp4"]),
    "file '/a/c0000.mp4'\nfile 'C:/x/it'\\''s.mp4'\n",
  );
  const args = joinArgs("l.txt", "a.m4a", "o.mp4");
  assert.deepEqual(args.slice(args.indexOf("-c"), args.indexOf("-c") + 2), [
    "-c",
    "copy",
  ]);
  assert.ok(args.includes("concat"));
});

/** A fake renderer: a "video" file is its frame numbers, one per line; it can be told to die at a frame. */
function fakeDeps(log: string[], dieAt?: { frame: number }): ChunkedRenderDeps {
  return {
    renderVideo: async (from, to, file) => {
      log.push(`video ${from}-${to}`);
      const lines: string[] = [];
      for (let f = from; f <= to; f++) {
        if (dieAt && f === dieAt.frame) {
          await fs.writeFile(file, lines.join("\n")); // half a chunk on disk, as a killed render leaves
          throw new Error("killed");
        }
        lines.push(String(f));
      }
      await fs.writeFile(file, lines.join("\n") + "\n");
    },
    renderAudio: async (file) => {
      log.push("audio");
      await fs.writeFile(file, "sound");
    },
    countFrames: async (file) =>
      (await fs.readFile(file, "utf8")).split("\n").filter(Boolean).length,
    join: async (files, audio, out) => {
      log.push(`join ${files.length}`);
      const parts = await Promise.all(files.map((f) => fs.readFile(f, "utf8")));
      await fs.writeFile(out, parts.join(""));
      assert.equal(await fs.readFile(audio, "utf8"), "sound");
    },
  };
}

test("a killed chunked render resumes at the first unfinished chunk and joins to the same output", async () => {
  const dir = await tmpDir();
  const out = path.join(dir, "render_raw.mp4");
  const chunkDir = `${out}.chunks`;
  const input = {
    dir: chunkDir,
    key: "k1",
    range: [0, 99] as [number, number],
    chunkFrames: 25,
    outFile: out,
  };

  const first: string[] = [];
  await assert.rejects(
    renderChunked(input, fakeDeps(first, { frame: 70 })),
    /killed/,
  );
  assert.deepEqual(first, ["video 0-24", "video 25-49", "video 50-74"]);
  const m = await readManifest(chunkDir);
  assert.deepEqual(Object.keys(m!.done).sort(), ["0", "1"]);

  const second: string[] = [];
  const res = await renderChunked(input, fakeDeps(second));
  assert.deepEqual(second, ["video 50-74", "video 75-99", "audio", "join 4"]);
  assert.deepEqual(res, {
    chunks: 4,
    rendered: 2,
    reused: 2,
    audioReused: false,
  });
  const frames = (await fs.readFile(out, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map(Number);
  assert.deepEqual(
    frames,
    Array.from({ length: 100 }, (_, i) => i),
  );
  await assert.rejects(fs.stat(chunkDir)); // removed after a good join

  // The same render uninterrupted gives the same file.
  const dir2 = await tmpDir();
  const out2 = path.join(dir2, "render_raw.mp4");
  await renderChunked(
    { ...input, dir: `${out2}.chunks`, outFile: out2 },
    fakeDeps([]),
  );
  assert.equal(await fs.readFile(out2, "utf8"), await fs.readFile(out, "utf8"));
});

test("a different key, a tampered chunk or a short chunk is never trusted", async () => {
  const dir = await tmpDir();
  const out = path.join(dir, "o.mp4");
  const input = {
    dir: `${out}.chunks`,
    key: "k1",
    range: [0, 59] as [number, number],
    chunkFrames: 30,
    outFile: out,
    keepChunks: true,
  };
  await renderChunked(input, fakeDeps([]));

  // Same key, everything kept: nothing drawn again.
  const again: string[] = [];
  assert.deepEqual(await renderChunked(input, fakeDeps(again)), {
    chunks: 2,
    rendered: 0,
    reused: 2,
    audioReused: true,
  });
  assert.deepEqual(again, ["join 2"]);

  // A chunk whose size changed is drawn again.
  await fs.appendFile(path.join(input.dir, CHUNK_FILE(1)), "x\n");
  const tampered: string[] = [];
  await renderChunked(input, fakeDeps(tampered));
  assert.deepEqual(tampered, ["video 30-59", "join 2"]);

  // New key: the folder starts afresh.
  const fresh: string[] = [];
  await renderChunked({ ...input, key: "k2" }, fakeDeps(fresh));
  assert.deepEqual(fresh, ["video 0-29", "video 30-59", "audio", "join 2"]);
  assert.equal((await readManifest(input.dir))!.key, "k2");

  // A renderer that drops frames fails the chunk rather than recording it.
  const dropping = fakeDeps([]);
  const bad = {
    ...dropping,
    renderVideo: async (_f: number, _t: number, file: string) =>
      fs.writeFile(file, "1\n2\n"),
  };
  await assert.rejects(
    renderChunked({ ...input, key: "k3" }, bad),
    /2 frames, expected 30/,
  );
  assert.deepEqual((await readManifest(input.dir))!.done, {});
  // An unreadable manifest is a fresh start, not a crash.
  await fs.writeFile(path.join(input.dir, MANIFEST), "{half");
  assert.equal(await readManifest(input.dir), undefined);
});

test("render-speed settings default off and parse safely", () => {
  assert.deepEqual(renderSpeedFrom({}), {
    chunkedLong: false,
    chunkedShorts: false,
    chunkSeconds: 60,
    keepChunks: false,
    hwMaster: false,
    hwBitrate: "16M",
  });
  const on = renderSpeedFrom({
    RENDER_CHUNKED: "true",
    RENDER_CHUNKED_SHORTS: "1",
    RENDER_CHUNK_SECONDS: "5",
    RENDER_HW_MASTER: "on",
    RENDER_HW_BITRATE: "24M",
  });
  assert.equal(on.chunkedLong && on.chunkedShorts, true);
  assert.equal(on.chunkSeconds, 10); // floor
  assert.equal(
    renderSpeedFrom({ RENDER_CHUNK_SECONDS: "9999" }).chunkSeconds,
    600,
  );
  assert.equal(renderSpeedFrom({ RENDER_HW_BITRATE: "lots" }).hwBitrate, "16M");
  assert.deepEqual(masterEncoder(on, 20, "darwin"), {
    hardwareAcceleration: "if-possible",
    videoBitrate: "24M",
  });
  assert.deepEqual(masterEncoder(on, 20, "win32"), { crf: 20 });
  assert.deepEqual(masterEncoder(renderSpeedFrom({}), 19, "darwin"), {
    crf: 19,
  });
  assert.equal(chunkSetupFor(undefined, "long", "u", "d"), undefined);
  assert.equal(
    chunkSetupFor(renderSpeedFrom({ RENDER_CHUNKED: "1" }), "short", "u", "d"),
    undefined,
  );
  assert.deepEqual(chunkSetupFor(on, "long", "u", "d"), {
    seconds: 10,
    keep: false,
    filesUrl: "u",
    episodeDir: "d",
  });
});
