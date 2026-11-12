// GAME_AUDIO_BED (src/assets/gameaudio.ts): which clips may be heard, the bed's pieces, envelope and mix, the music
// dip, the split and the weekly report's line. Pure: no network, no ffmpeg.
import test from "node:test";
import assert from "node:assert/strict";
import {
  bedLevels,
  bedPieces,
  clipSoundKind,
  cutsceneSource,
  heardSpans,
  labelShare,
  mixBed,
  musicDipAt,
  RATE,
  CONTROL_HZ,
  soundPolicy,
} from "../src/assets/gameaudio.ts";
import { gameAudioOn } from "../src/pipeline.ts";
import { gameAudioLine } from "../src/growthreport.ts";
import { loadConfig } from "../src/config.ts";
import type { ShortStat } from "../src/experiments.ts";

const CUTSCENE =
  'Cutscenes for "The Legend of Zelda: Ocarina of Time" from YouTube video "All Cutscenes" by Someone, video ID: L45cq1H2d1s (https://www.youtube.com/watch?v=L45cq1H2d1s), 3s, section start: 98.00s, source time: 100.00s, muted';

test("GAME_AUDIO_BED is off by default, half the videos on its side once on, split by episode", () => {
  const saved = {
    bed: process.env.GAME_AUDIO_BED,
    share: process.env.GAME_AUDIO_SHARE,
  };
  delete process.env.GAME_AUDIO_BED;
  delete process.env.GAME_AUDIO_SHARE;
  try {
    const cfg = loadConfig();
    assert.equal(cfg.gameAudioBed, false);
    assert.equal(cfg.gameAudioShare, 0.5);
    assert.equal(cfg.gameAudioUnderLufs, -30);
    assert.equal(cfg.gameAudioGapLufs, -24);
    assert.equal(cfg.gameAudioTrailers, false);
  } finally {
    if (saved.bed !== undefined) process.env.GAME_AUDIO_BED = saved.bed;
    if (saved.share !== undefined) process.env.GAME_AUDIO_SHARE = saved.share;
  }
  const ids = Array.from(
    { length: 400 },
    (_, i) => `ep_20261112_${i.toString(16).padStart(8, "0")}`,
  );
  assert.equal(
    ids.filter((id) =>
      gameAudioOn({ gameAudioBed: false, gameAudioShare: 1 }, id),
    ).length,
    0,
  );
  const on = ids.filter((id) =>
    gameAudioOn({ gameAudioBed: true, gameAudioShare: 0.5 }, id),
  ).length;
  assert.ok(on > 150 && on < 250, `${on} of 400 on`);
  assert.equal(
    gameAudioOn({ gameAudioBed: true, gameAudioShare: 0.5 }, ids[7]!),
    gameAudioOn({ gameAudioBed: true, gameAudioShare: 0.5 }, ids[7]!),
  );
  assert.equal(
    ids.filter((id) =>
      gameAudioOn({ gameAudioBed: true, gameAudioShare: 0 }, id),
    ).length,
    0,
  );
});

test("cutscenes and the owner's own capture are heard; trailers, stock and muted gameplay are not", () => {
  assert.equal(clipSoundKind({ provenance: CUTSCENE }), "cutscene");
  assert.equal(
    clipSoundKind({
      provenance:
        "Pulse's own gameplay capture of GTA (a.mp4), 8s at 3.0s, with game sound",
      audio: true,
    }),
    "own",
  );
  assert.equal(
    clipSoundKind({
      provenance:
        "Pulse's own gameplay capture of GTA (a.mp4), 8s at 3.0s, muted",
      audio: false,
    }),
    "none",
  );
  assert.equal(
    clipSoundKind({
      provenance:
        'Official trailer "Trailer 3" from the Rockstar Games YouTube channel, publisher: Rockstar Games (u), 4s at 2.0s, muted',
    }),
    "trailer",
  );
  assert.equal(
    clipSoundKind({
      provenance:
        'Official Steam trailer "Launch" for "X" (app 1), 4s at 2.0s, muted',
    }),
    "trailer",
  );
  assert.equal(
    clipSoundKind({
      provenance:
        'Gameplay "x" by Y, Creative Commons Attribution licence (CC BY) (u), 4s at 1.0s of the downloaded section, with game sound',
      audio: true,
    }),
    "gameplay",
  );
  assert.equal(
    clipSoundKind({ provenance: 'Gameplay "x" by Y, CC BY (u), 4s, muted' }),
    "none",
  );
  assert.equal(clipSoundKind({ provenance: CUTSCENE, stock: true }), "none");
  assert.deepEqual(
    cutsceneSource({ file: "a.mp4", provenance: CUTSCENE, durationSeconds: 3 }),
    { videoId: "L45cq1H2d1s", from: 100 },
  );
  assert.deepEqual(
    cutsceneSource({
      file: "a.mp4",
      provenance: CUTSCENE,
      durationSeconds: 3,
      span: {
        source: "https://www.youtube.com/watch?v=L45cq1H2d1s",
        from: 101.5,
        to: 104.5,
      },
    }),
    { videoId: "L45cq1H2d1s", from: 101.5 },
  );
  assert.equal(
    cutsceneSource({ file: "a.mp4", provenance: "Stock", durationSeconds: 3 }),
    undefined,
  );
});

test("trailer music stays out, music-heavy clips are skipped or lowered, dialogue sits lower", () => {
  assert.deepEqual(soundPolicy("trailer", { lufs: -20 }, { trailers: false }), {
    skip: "trailer music",
  });
  assert.deepEqual(soundPolicy("trailer", { lufs: -20 }, { trailers: true }), {
    trimDb: -8,
    swell: false,
  });
  assert.deepEqual(
    soundPolicy("cutscene", { lufs: -20 }, { trailers: false }),
    { trimDb: 0, swell: true },
  );
  assert.deepEqual(
    soundPolicy("cutscene", { lufs: -70 }, { trailers: false }),
    { skip: "silent" },
  );
  assert.match(
    (
      soundPolicy(
        "cutscene",
        { lufs: -20, music: 0.9 },
        { trailers: false },
      ) as { skip: string }
    ).skip,
    /music/,
  );
  assert.deepEqual(
    soundPolicy("cutscene", { lufs: -20, music: 0.5 }, { trailers: false }),
    { trimDb: -8, swell: false },
  );
  assert.deepEqual(
    soundPolicy("cutscene", { lufs: -20, speech: 0.6 }, { trailers: false }),
    { trimDb: -4, swell: true },
  );
  assert.equal(
    labelShare(
      [
        { top: [["music", 0.8]] },
        { top: [["speech", 0.9]] },
        { top: [["music", 0.2]] },
        { top: [] },
      ],
      ["music"],
    ),
    0.25,
  );
});

test("the bed's pieces follow the plan's cuts, joining a shot that carries straight on", () => {
  const shots = [
    { start: 0, end: 12, media: { type: "image", index: 0 } },
    { start: 12, end: 42, media: { type: "clip", index: 0, trimFrom: 0 } },
    { start: 42, end: 60, media: { type: "clip", index: 0, trimFrom: 30 } }, // carries on
    { start: 60, end: 90, media: { type: "clip", index: 1, trimFrom: 15 } },
    { start: 90, end: 120, media: { type: "clip", index: 0, trimFrom: 48 } }, // back to clip 0: a cut
  ];
  assert.deepEqual(bedPieces(shots, 30), [
    { clip: 0, at: 0.4, from: 0, seconds: 1.6 },
    { clip: 1, at: 2, from: 0.5, seconds: 1 },
    { clip: 0, at: 3, from: 1.6, seconds: 1 },
  ]);
  assert.deepEqual(heardSpans(bedPieces(shots, 30), new Set([0])), [
    { from: 0.4, to: 2 },
    { from: 3, to: 4 },
  ]);
});

test("the envelope is under the voice, up in a real gap, silent through a quote", () => {
  const words = [
    { start: 0.5, end: 1.0 },
    { start: 1.1, end: 1.6 }, // a 0.1 s pause: stays under
    { start: 3.0, end: 3.5 }, // after a 1.4 s gap: up between
    { start: 6.0, end: 6.4 },
  ];
  const lv = bedLevels(words, [{ start: 4.5, seconds: 1 }], 7, -6);
  const at = (t: number) => lv[Math.round(t * CONTROL_HZ)]!;
  assert.equal(at(0.8), -6);
  assert.equal(at(1.05), -6, "a short pause stays under");
  assert.equal(at(2.3), 0, "a real gap comes up");
  assert.equal(at(2.92), -6, "down before the next word starts");
  assert.equal(at(5), -Infinity, "silent through the quote");
  assert.ok(
    at(4.49) < -10 && at(4.49) > -Infinity && at(4.46) < 0,
    "faded just before the quote",
  );
  assert.ok(Number.isFinite(at(5.7)), "back after the quote");
});

test("the mix fades every cut over two frames, holds a non-swelling clip under, and never clips", () => {
  const second = RATE;
  const tone = new Float32Array(second * 2 * 2).fill(0.5); // 2 s of loud stereo
  const pieces = [
    { clip: 0, at: 0, from: 0, seconds: 1 },
    { clip: 1, at: 1, from: 0, seconds: 1 },
  ];
  const levels = new Float32Array(2 * CONTROL_HZ + 1).fill(0);
  const sources = new Map([
    [0, { samples: tone, gainDb: 6, swell: true }],
    [1, { samples: tone, gainDb: 0, swell: false }],
  ]);
  const out = mixBed(pieces, sources, levels, -12, 2, 2 / 30);
  assert.equal(out[0], 0, "the first sample of a piece is silent");
  // Across the cut at 1 s the level steps down only through the fades: no sample-to-sample jump.
  let jump = 0;
  for (let i = 2; i < out.length; i += 2)
    jump = Math.max(jump, Math.abs(out[i]! - out[i - 2]!));
  assert.ok(jump < 0.01, `largest step ${jump}`);
  assert.ok(
    Math.max(...out.subarray(0, second * 2)) <= 0.89,
    "held under the ceiling",
  );
  const mid = out[Math.round(1.5 * second) * 2]!;
  assert.ok(
    Math.abs(mid - 0.5 * Math.pow(10, -12 / 20)) < 1e-4,
    `a non-swelling clip sits at the under level (${mid})`,
  );
});

test("the music steps back where the game is heard, easing in and out", () => {
  const spans = [{ from: 1, to: 2 }];
  assert.equal(musicDipAt(spans, 0, 30, 0.6), 1);
  assert.ok(Math.abs(musicDipAt(spans, 45, 30, 0.6) - 0.6) < 1e-9);
  const easing = musicDipAt(spans, 26, 30, 0.6);
  assert.ok(easing < 1 && easing > 0.6);
  assert.equal(musicDipAt([], 45, 30, 0.6), 1);
});

test("the weekly report's game audio line compares like with like, and says when it is too early", () => {
  const stat = (id: string, pct: number, vpd: number): ShortStat => ({
    id,
    lane: "news",
    liveAt: new Date("2026-11-20"),
    views: 1000,
    viewsPerDay: vpd,
    pct,
    stay: 70,
    desk: false,
    rumour: false,
  });
  const stats = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) =>
    stat(id, 50 + i, 100 * (i + 1)),
  );
  const sides = new Map([
    ["a", { on: true, heard: true, hearable: 2 }],
    ["b", { on: true, heard: true, hearable: 2 }],
    ["c", { on: true, heard: false, hearable: 0 }], // nothing could be heard: not counted
    ["d", { on: false, heard: false, hearable: 3 }],
    ["e", { on: false, heard: false, hearable: 0 }], // no footage to hear: not counted
  ]);
  assert.match(
    gameAudioLine(stats, sides),
    /2 Shorts with the game's sound and 1 without so far; too few/,
  );
  sides.set("f", { on: true, heard: true, hearable: 1 });
  sides.set("g", { on: false, heard: false, hearable: 1 });
  sides.set("c", { on: false, heard: false, hearable: 1 });
  const line = gameAudioLine(stats, sides);
  assert.match(
    line,
    /with the game's own sound 3 Shorts, 52\.0% viewed, 300 views a day/,
  );
  assert.match(line, /without 3 Shorts, 53\.7% viewed, 467 views a day/);
});

test("the plan's heard clips: cutscenes, the owner's capture and vetted gameplay, never a trailer unless asked", async () => {
  const { heardInBed } = await import("../src/assets/gameaudio.ts");
  assert.equal(heardInBed({ provenance: 'Cutscenes for "GTA San Andreas" from YouTube video "x"' }), true);
  assert.equal(heardInBed({ provenance: "Pulse's own gameplay capture of GTA V", audio: true }), true);
  assert.equal(heardInBed({ provenance: "Pulse's own gameplay capture of GTA V" }), false);
  assert.equal(heardInBed({ provenance: "Gameplay from the library", audio: true }), true);
  assert.equal(heardInBed({ provenance: 'Official trailer "Launch Trailer" from the Nintendo channel' }), false);
  assert.equal(heardInBed({ provenance: 'Official trailer "Launch Trailer" from the Nintendo channel' }, true), true);
  assert.equal(heardInBed({ provenance: 'Cutscenes for "X"', stock: true }), false);
});
