// GAME_SFX_STEMS (src/assets/gamesfx.ts): which stretch of a game-sound stem may be heard, the stem's info file, the
// library lookup by file URL, and the game sound bed's use of it (src/assets/gameaudio.ts hearClips). No network, no
// model, no ffmpeg: the cases below never reach the cut.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  libraryItemByUrl,
  parseSfxStemInfo,
  SFX_GATE_DB,
  SFX_STEM_VERSION,
  stemStretch,
  stemVerdict,
  wantsStem,
  type SfxStemInfo,
} from "../src/assets/gamesfx.ts";
import { hearClips } from "../src/assets/gameaudio.ts";
import { loadConfig } from "../src/config.ts";

const info = (gate: number[], sfx?: number[]): SfxStemInfo => ({
  version: SFX_STEM_VERSION,
  item: "abc123",
  sourceUrl: "https://example.com/trailer.mp4",
  file: "sfxstems/abc123.sfx.m4a",
  step: 0.25,
  sfx: sfx ?? gate.map(() => -30),
  music: gate.map(() => -20),
  gate,
  kept: 0.2,
  gatedShare: 0.5,
  builtAt: "2026-11-20T00:00:00.000Z",
});

test("stemStretch: share clear of the beat gate and share with sound, on the 0.25 s grid", () => {
  // Eight steps (2 s): the first four gated, the last four open.
  const i = info(
    [SFX_GATE_DB, SFX_GATE_DB, -20, -13, -11, -3, 0, 0],
    [-30, -30, -30, -30, -60, -60, -30, -30],
  );
  // -13 dB is past half the gate's depth (-12): gated. -11 is not.
  assert.deepEqual(stemStretch(i, 0, 1), { clear: 0, sound: 1 });
  assert.deepEqual(stemStretch(i, 1, 2), { clear: 1, sound: 0.5 });
  assert.deepEqual(stemStretch(i, 0, 2), { clear: 0.5, sound: 0.75 });
  // Past the stem's end counts as gated and silent.
  assert.deepEqual(stemStretch(i, 1.5, 2.5), { clear: 0.5, sound: 0.5 });
});

test("stemVerdict: under the beat or silent is skipped, with the reason", () => {
  assert.deepEqual(stemVerdict({ clear: 1, sound: 1 }), { ok: true });
  const beat = stemVerdict({ clear: 0.25, sound: 1 });
  assert.ok("skip" in beat && /beat \(75%\)/.test(beat.skip));
  assert.deepEqual(stemVerdict({ clear: 1, sound: 0.1 }), {
    skip: "stem silent there",
  });
});

test("parseSfxStemInfo: only the current version with its lists", () => {
  assert.ok(parseSfxStemInfo(info([0, 0])));
  assert.equal(parseSfxStemInfo({ ...info([0]), version: 99 }), undefined);
  assert.equal(parseSfxStemInfo({ ...info([0]), step: 0 }), undefined);
  assert.equal(parseSfxStemInfo({ ...info([0]), gate: "x" }), undefined);
  assert.equal(parseSfxStemInfo(null), undefined);
});

test("wantsStem: official usable videos, never the owner's own capture or stills", () => {
  assert.equal(wantsStem({ kind: "video", source: "Rockstar Games" }), true);
  assert.equal(wantsStem({ kind: "video", source: "own" }), false);
  assert.equal(wantsStem({ kind: "still", source: "Rockstar Games" }), false);
  assert.equal(
    wantsStem({ kind: "video", source: "Steam", unusable: "lettering" }),
    false,
  );
});

function library(): { dataDir: string; url: string } {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-gamesfx-"));
  const dir = path.join(dataDir, "gamelib", "grand-theft-auto-vi");
  fs.mkdirSync(path.join(dir, "sfxstems"), { recursive: true });
  const url = "https://example.com/GTAVI_Trailer_1.mp4";
  fs.writeFileSync(
    path.join(dir, "library.json"),
    JSON.stringify({
      version: 1,
      game: "Grand Theft Auto VI",
      updatedAt: "",
      items: [
        {
          id: "still1",
          kind: "still",
          file: "stills/a.jpg",
          sourceUrl: url,
          provenance: "",
          source: "Rockstar Games",
          named: [],
          tags: [],
          seen: "",
          addedAt: "",
        },
        {
          id: "abc123",
          kind: "video",
          file: "videos/abc123.mp4",
          sourceUrl: url,
          provenance: 'Official trailer "Trailer 1"',
          source: "Rockstar Games",
          named: ["trailer"],
          tags: [],
          seen: "",
          addedAt: "",
        },
      ],
    }),
  );
  // Gated from 0 to 4 s, open after.
  const gate = Array.from({ length: 40 }, (_, k) => (k < 16 ? SFX_GATE_DB : 0));
  fs.writeFileSync(
    path.join(dir, "sfxstems", "abc123.json"),
    JSON.stringify(info(gate)),
  );
  return { dataDir, url };
}

test("libraryItemByUrl: the video item with that file URL, not a still that shares it", async () => {
  const { dataDir, url } = library();
  const hit = await libraryItemByUrl(path.join(dataDir, "gamelib"), url);
  assert.equal(hit?.item.id, "abc123");
  assert.equal(hit?.game, "Grand Theft Auto VI");
  assert.equal(
    await libraryItemByUrl(path.join(dataDir, "gamelib"), "https://nope"),
    undefined,
  );
});

test("hearClips: a trailer under the score's beat is skipped by the stem rule; off, the old trailer rule", async () => {
  const prev = process.env.GAME_LIBRARY_DIR;
  delete process.env.GAME_LIBRARY_DIR;
  try {
    const { dataDir, url } = library();
    const clip = {
      file: "assets/lib_abc123_10.mp4",
      provenance:
        'Official trailer "Trailer 1" from Rockstar Games\'s own site',
      durationSeconds: 2,
      sourceUrl: url,
      startSeconds: 1,
    };
    const on = await hearClips(dataDir, [clip], {
      dataDir,
      ytdlp: "yt-dlp",
      trailers: false,
      sfxStems: true,
    });
    assert.equal(on.heard.length, 0);
    assert.match(on.skipped[0]!.why, /under the score's beat/);
    const off = await hearClips(dataDir, [clip], {
      dataDir,
      ytdlp: "yt-dlp",
      trailers: false,
    });
    assert.deepEqual(off.skipped, [{ index: 0, why: "trailer music" }]);
    // A trailer no library holds keeps the old rule with the switch on.
    const stranger = { ...clip, sourceUrl: "https://example.com/other.mp4" };
    const other = await hearClips(dataDir, [stranger], {
      dataDir,
      ytdlp: "yt-dlp",
      trailers: false,
      sfxStems: true,
    });
    assert.deepEqual(other.skipped, [{ index: 0, why: "trailer music" }]);
  } finally {
    if (prev === undefined) delete process.env.GAME_LIBRARY_DIR;
    else process.env.GAME_LIBRARY_DIR = prev;
  }
});

test("config: GAME_SFX_STEMS and ACE_BEDS are off by default", () => {
  const saved = { a: process.env.GAME_SFX_STEMS, b: process.env.ACE_BEDS };
  delete process.env.GAME_SFX_STEMS;
  delete process.env.ACE_BEDS;
  try {
    const cfg = loadConfig();
    assert.equal(cfg.gameSfxStems, false);
    assert.equal(cfg.aceBeds, false);
  } finally {
    if (saved.a !== undefined) process.env.GAME_SFX_STEMS = saved.a;
    if (saved.b !== undefined) process.env.ACE_BEDS = saved.b;
  }
});
