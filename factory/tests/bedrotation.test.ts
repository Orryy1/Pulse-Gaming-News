import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BED_LOG_FILE,
  BED_REPEAT_WINDOW,
  bedSeed,
  chooseBed,
  pickBed,
  readBedLog,
  recordBed,
  type BedUse,
} from "../src/render/bedrotation.ts";
import { BEDS, MOOD_BEDS } from "../src/render/soundscape.ts";
import { LIBRARY_BEDS, LIBRARY_GRID, LIBRARY_MOODS } from "../src/render/bedlibrary.ts";
import { MOODS } from "../src/render/musicplan.ts";

const pool = Array.from({ length: 16 }, (_, i) => `music/bed_${i + 1}.wav`);
const use = (
  ep: string,
  file: string,
  lane: BedUse["lane"] = "short",
): BedUse => ({
  ep,
  file,
  lane,
  at: "2026-11-15T00:00:00Z",
});

test("no bed comes back within the last eight Shorts, over a long run of them", () => {
  const log: BedUse[] = [];
  for (let i = 0; i < 200; i++) {
    const ep = `ep_${i}`;
    const f = pickBed(pool, log, { ep, lane: "short", seed: bedSeed(ep) })!;
    const recent = log.slice(-BED_REPEAT_WINDOW).map((u) => u.file);
    assert.ok(
      !recent.includes(f),
      `${f} repeated within ${BED_REPEAT_WINDOW} at Short ${i}`,
    );
    log.push(use(ep, f));
  }
  // Every bed gets played: the rotation does not settle on a few.
  assert.equal(new Set(log.map((u) => u.file)).size, pool.length);
});

test("with a small pool the bed heard longest ago plays, and never the last one", () => {
  const small = pool.slice(0, 3);
  const log: BedUse[] = [];
  for (let i = 0; i < 30; i++) {
    const f = pickBed(small, log, { ep: `e${i}`, lane: "short", seed: i * 7 })!;
    if (log.length) assert.notEqual(f, log.at(-1)!.file);
    if (log.length >= 2)
      assert.notEqual(f, log.at(-2)!.file, "three beds: a strict cycle");
    log.push(use(`e${i}`, f));
  }
  assert.equal(pickBed([], log, { ep: "x", lane: "short", seed: 1 }), null);
});

test("a re-render keeps its bed; long videos keep their own record", () => {
  const log = [
    use("a", pool[3]!),
    use("b", pool[5]!),
    use("L", pool[0]!, "long"),
  ];
  assert.equal(
    pickBed(pool, log, { ep: "a", lane: "short", seed: 99 }),
    pool[3],
  );
  // A long video does not stop a Short from using a bed, nor the other way round.
  const longPick = pickBed(pool.slice(0, 2), log, {
    ep: "L2",
    lane: "long",
    seed: 0,
  });
  assert.equal(longPick, pool[1]);
  // A kept bed that left the library is replaced.
  assert.ok(
    pickBed(pool.slice(8), log, {
      ep: "a",
      lane: "short",
      seed: 0,
    })!.startsWith("music/bed_"),
  );
});

test("the record lives in the data folder, survives a bad file and is written once per video", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-test-beds-"));
  assert.deepEqual(readBedLog(dir), []);
  fs.writeFileSync(path.join(dir, BED_LOG_FILE), "not json");
  assert.deepEqual(readBedLog(dir), []);
  const now = new Date("2026-11-15T12:00:00Z");
  const first = chooseBed(dir, pool, {
    ep: "ep1",
    lane: "short",
    seed: 3,
    now,
  })!;
  assert.equal(
    chooseBed(dir, pool, { ep: "ep1", lane: "short", seed: 4, now }),
    first,
  );
  const second = chooseBed(dir, pool, {
    ep: "ep2",
    lane: "short",
    seed: 3,
    now,
  })!;
  assert.notEqual(second, first);
  const log = readBedLog(dir);
  assert.deepEqual(
    log.map((u) => u.ep),
    ["ep1", "ep2"],
  );
  assert.equal(log[0]!.at, now.toISOString());
  recordBed(path.join(dir, "missing", "deeper"), use("x", pool[0]!));
  assert.equal(readBedLog(path.join(dir, "missing", "deeper")).length, 1);
});

test("every bed is listed once, in D or E, with its rights record, and every mood has a list", () => {
  const rights = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, "..", "public", "music", "rights.json"), "utf8"),
  ) as { beds: Array<{ file: string; key: string }>; moods: Array<{ file: string; key: string; mood: string }> };
  const all = [...BEDS, ...Object.values(MOOD_BEDS).flat()];
  const files = all.map((b) => b.file);
  assert.equal(new Set(files).size, files.length, "a bed listed twice");
  for (const m of MOODS) assert.ok(Object.hasOwn(MOOD_BEDS, m), m);
  for (const b of all) {
    assert.ok(b.key === "D" || b.key === "E", b.file);
    const r = [...rights.beds, ...rights.moods].find((x) => x.file === b.file);
    assert.ok(r, `${b.file} has no rights.json entry`);
    assert.equal(r.key, b.key, b.file);
  }
  for (const [m, list] of Object.entries(MOOD_BEDS))
    for (const b of list)
      assert.equal(rights.moods.find((x) => x.file === b.file)?.mood, m, b.file);
});

test("the 15 Nov library is in the lists and every listed bed's file is in public/music", () => {
  const pub = path.join(import.meta.dirname, "..", "public");
  assert.ok(LIBRARY_BEDS.length >= 10, `only ${LIBRARY_BEDS.length} library house beds`);
  assert.ok(LIBRARY_MOODS.length >= 10, `only ${LIBRARY_MOODS.length} library mood beds`);
  const house = BEDS.map((b) => b.file);
  for (const b of LIBRARY_BEDS) assert.ok(house.includes(b.file), `${b.file} missing from BEDS`);
  for (const b of LIBRARY_MOODS)
    assert.ok(MOOD_BEDS[b.mood].some((x) => x.file === b.file), `${b.file} missing from MOOD_BEDS.${b.mood}`);
  const all = [...BEDS, ...Object.values(MOOD_BEDS).flat()];
  for (const b of all) {
    const file = path.join(pub, b.file);
    assert.ok(fs.existsSync(file), `${b.file} is listed but not in public/`);
    assert.ok(fs.statSync(file).size > 1_000_000, `${b.file} is too small to be a bed`);
  }
  const names = new Set(all.map((b) => b.file.split("/").pop()));
  for (const name of Object.keys(LIBRARY_GRID)) assert.ok(names.has(name), `grid for unlisted bed ${name}`);
});
