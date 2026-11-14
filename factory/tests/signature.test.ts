import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RISES,
  RISE_BED_DUCK,
  RISE_GAP_SECONDS,
  riseBedLevel,
  riseCues,
  shortMusic,
  signatureFor,
  signatureSeriesOf,
  withSignatureSting,
  type SignatureLibrary,
} from "../src/render/signature.ts";
import { SIGNATURE_LIBRARY } from "../src/render/signaturelib.ts";
import { bedGridOf, inKey, sfxFile, SFX } from "../src/render/soundscape.ts";
import { loadConfig } from "../src/config.ts";

const LIB: SignatureLibrary = {
  why: {
    name: "The Why",
    key: "D",
    sting: "signature/why",
    bed: "music/signature/why_bed.wav",
    grid: { bar: 2.5, first: 0.02, loop: 120 },
  },
  receipts: { name: "Receipts", key: "E", sting: "signature/receipts" },
  gta_file: {
    name: "The GTA File",
    key: "D",
    bed: "music/signature/gta_file_bed.wav",
  },
  docs: {
    name: "Documentaries",
    key: "D",
    sting: "signature/docs",
    rise: { file: "music/signature/docs_rise.wav", hit: 12, seconds: 15 },
  },
};

test("a documentary plays the docs signature, a tagged Short its series, others none", () => {
  assert.equal(signatureSeriesOf({ documentary: true, series: "why" }), "docs");
  assert.equal(signatureSeriesOf({ series: "gta_daily" }), "gta_daily");
  assert.equal(signatureSeriesOf({ series: "receipts" }), "receipts");
  assert.equal(signatureSeriesOf({ series: "pulse_lab" }), "pulse_lab");
  assert.equal(signatureSeriesOf({ series: "verdict" }), undefined);
  assert.equal(signatureSeriesOf({ series: "news_control" }), undefined);
  assert.equal(
    signatureSeriesOf({ series: "docs" }),
    undefined,
    "only a documentary is docs",
  );
  assert.equal(signatureSeriesOf({}), undefined);
});

test("a series needs a sting that passed to have a signature", () => {
  assert.equal(signatureFor(LIB, "why")?.sting, "signature/why");
  assert.equal(
    signatureFor(LIB, "gta_file"),
    undefined,
    "a bed alone is not a signature",
  );
  assert.equal(signatureFor(LIB, "pulse_lab"), undefined);
  assert.equal(signatureFor(LIB, undefined), undefined);
});

test("a Short plays its series bed, else a house bed in the sting's key", () => {
  const keyOf = (f: string) =>
    f.includes("_2") ? ("D" as const) : ("E" as const);
  const byKey = (k: "D" | "E") =>
    k === "D" ? "music/bed_2.wav" : "music/bed_1.wav";
  assert.equal(
    shortMusic(LIB.why!, "music/bed_1.wav", byKey, keyOf),
    "music/signature/why_bed.wav",
  );
  assert.equal(
    shortMusic(LIB.receipts!, "music/bed_1.wav", byKey, keyOf),
    "music/bed_1.wav",
    "already in E",
  );
  assert.equal(
    shortMusic(LIB.receipts!, "music/bed_2.wav", byKey, keyOf),
    "music/bed_1.wav",
    "moved to an E bed",
  );
  assert.equal(
    shortMusic(LIB.receipts!, null, byKey, keyOf),
    null,
    "no music stays no music",
  );
});

test("the brand sting is swapped at the open and the close, nothing else, idempotently", () => {
  const cues = [
    { file: sfxFile(SFX.sting), frame: 0, volume: 0.436 },
    { file: sfxFile(SFX.air[0]), frame: 90, volume: 0.195 },
    { file: sfxFile(SFX.sting), frame: 900, volume: 0.39 },
  ];
  const once = withSignatureSting(cues, "signature/why");
  assert.deepEqual(
    once.map((c) => c.file),
    ["sfx/signature/why.mp3", "sfx/v3/air-1.mp3", "sfx/signature/why.mp3"],
  );
  assert.deepEqual(
    once.map((c) => c.volume),
    [0.436, 0.195, 0.39 * 0.6],
    "the opening level kept (files are loudness-matched), the close lowered",
  );
  assert.deepEqual(withSignatureSting(once, "signature/why"), once);
  // The series sting is never re-keyed: it is already in its series' key.
  assert.equal(
    inKey("sfx/signature/why.mp3", "music/bed_1.wav"),
    "sfx/signature/why.mp3",
  );
});

test("rises land their downbeat on a chapter, spaced, out of the opening and the beats", () => {
  const fps = 30;
  const chapters = [10, 60, 100, 300, 320, 700, 1000].map((s) => s * fps);
  const cues = riseCues(
    chapters,
    1200 * fps,
    fps,
    LIB.docs!.rise!,
    (f) => f === 700 * fps,
  );
  assert.deepEqual(
    cues.map((c) => c.hit / fps),
    [60, 300, 1000],
  );
  for (const c of cues) {
    assert.equal(
      c.hit - c.from,
      12 * fps,
      "the downbeat is the chapter's first frame",
    );
    assert.equal(c.frames, 15 * fps);
  }
  for (let i = 1; i < cues.length; i++)
    assert.ok(cues[i]!.hit - cues[i - 1]!.hit >= RISE_GAP_SECONDS * fps);
  // Never past the end, never more than MAX_RISES.
  assert.deepEqual(
    riseCues([1199 * fps], 1200 * fps, fps, LIB.docs!.rise!),
    [],
  );
  const many = Array.from({ length: 40 }, (_, i) => (60 + i * 200) * fps);
  assert.equal(
    riseCues(many, 10_000 * fps, fps, LIB.docs!.rise!).length,
    MAX_RISES,
  );
  assert.deepEqual(
    riseCues(chapters, 1200 * fps, fps, { hit: 0, seconds: 10 }),
    [],
    "a rise without a build is refused",
  );
});

test("the bed steps back under a rise and returns after the downbeat", () => {
  const fps = 30;
  const [c] = riseCues([100 * fps], 400 * fps, fps, { hit: 12, seconds: 15 });
  assert.ok(c);
  assert.equal(riseBedLevel(c.from - 1, [c], fps), 1);
  assert.equal(riseBedLevel(c.from, [c], fps), 1);
  assert.ok(
    Math.abs(riseBedLevel(c.from + 3 * fps, [c], fps) - RISE_BED_DUCK) < 1e-9,
  );
  assert.equal(riseBedLevel(c.hit, [c], fps), RISE_BED_DUCK);
  assert.ok(riseBedLevel(c.hit + fps, [c], fps) > RISE_BED_DUCK);
  assert.equal(riseBedLevel(c.hit + 2 * fps + 1, [c], fps), 1);
  // Monotone fall then rise: no step on the way.
  for (let f = c.from; f < c.hit + 2 * fps; f++)
    assert.ok(
      Math.abs(riseBedLevel(f + 1, [c], fps) - riseBedLevel(f, [c], fps)) <
        0.03,
    );
});

test("the shipped library is well formed and the signature beds are keyed and gridded", () => {
  for (const [id, e] of Object.entries(SIGNATURE_LIBRARY)) {
    assert.ok(e, id);
    assert.ok(e.key === "D" || e.key === "E", id);
    if (e.sting) assert.match(e.sting, /^signature\/[a-z_]+$/);
    if (e.bed) {
      assert.match(e.bed, /^music\/signature\/[a-z_]+_bed\.wav$/);
      assert.equal(
        inKey("v3/sting", e.bed),
        `v3/sting-${e.key}`,
        "tuned sounds follow the signature bed's key",
      );
      if (e.grid) assert.deepEqual(bedGridOf(e.bed), e.grid);
    }
    if (e.rise) assert.ok(e.rise.hit > 0 && e.rise.seconds > e.rise.hit, id);
  }
});

test("the settings are off by default", () => {
  const cfg = loadConfig();
  assert.equal(cfg.signatureMusic, false);
  assert.equal(cfg.hookTakes, 0);
  assert.equal(cfg.hookTargetWpm, 175);
});
