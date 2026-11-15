// Music-bed rotation (15 Nov 2026, owner: "Shouldn't we have way more than 4 beds?"). A video's bed used to be
// its id's hash over four files, so viewers heard the same music Short after Short and could hear two in a row.
// Now the house library is much larger and each video takes a bed none of the last BED_REPEAT_WINDOW videos of
// its kind played (or, with a small library, the one heard longest ago), so a bed never plays twice running.
// The record is data/bed_usage.json, one line per video, newest last; a re-render of a video keeps its bed.
import fs from "node:fs";
import path from "node:path";

/** The usage record under the data folder. */
export const BED_LOG_FILE = "bed_usage.json";
/** No bed comes back within this many videos of the same kind when the library allows it. */
export const BED_REPEAT_WINDOW = 8;
/** The record keeps this many lines (the newest). */
export const BED_LOG_KEEP = 200;

export type BedLane = "short" | "long";

export interface BedUse {
  /** The episode that played it. */
  ep: string;
  /** The bed ("music/bed_7.wav"). */
  file: string;
  lane: BedLane;
  /** ISO time it was chosen. */
  at: string;
}

/**
 * The bed for a video (pure). The same episode keeps the bed it had (a retry renders the same music). Otherwise
 * the beds the last `window` videos of this lane played are left out; if that leaves none, the bed heard longest
 * ago (never heard counts as longest) is taken, which still never repeats the last one while the pool has two.
 * Among the beds left, `seed` (the video's own number) chooses, so two factories never march in step.
 */
export function pickBed(
  pool: readonly string[],
  log: readonly BedUse[],
  o: { ep: string; lane: BedLane; seed: number; window?: number },
): string | null {
  if (!pool.length) return null;
  const mine = log.filter((u) => u.lane === o.lane);
  const had = [...mine].reverse().find((u) => u.ep === o.ep);
  if (had && pool.includes(had.file)) return had.file;
  const others = mine.filter((u) => u.ep !== o.ep);
  const window = o.window ?? BED_REPEAT_WINDOW;
  const recent = new Set(others.slice(-window).map((u) => u.file));
  let left = pool.filter((f) => !recent.has(f));
  if (!left.length) {
    // Each bed's last play, as a position in the record (-1: never).
    const last = (f: string) => {
      for (let i = others.length - 1; i >= 0; i--)
        if (others[i]!.file === f) return i;
      return -1;
    };
    const oldest = Math.min(...pool.map(last));
    left = pool.filter((f) => last(f) === oldest);
  }
  const n = Math.abs(Math.trunc(o.seed));
  return left[n % left.length]!;
}

/** The usage record; empty when missing or unreadable. */
export function readBedLog(dataDir: string): BedUse[] {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, BED_LOG_FILE), "utf8"),
    );
    return Array.isArray(raw)
      ? raw.filter(
          (u): u is BedUse =>
            u &&
            typeof u.ep === "string" &&
            typeof u.file === "string" &&
            (u.lane === "short" || u.lane === "long"),
        )
      : [];
  } catch {
    return [];
  }
}

/** Adds a video's bed to the record (once per episode and lane; the newest BED_LOG_KEEP kept). Never throws. */
export function recordBed(dataDir: string, use: BedUse): void {
  try {
    const log = readBedLog(dataDir).filter(
      (u) => !(u.ep === use.ep && u.lane === use.lane),
    );
    log.push(use);
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, BED_LOG_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmp,
      `${JSON.stringify(log.slice(-BED_LOG_KEEP), null, 1)}\n`,
    );
    fs.renameSync(tmp, file);
  } catch {
    // The record must never stop a render.
  }
}

/** Chooses a video's bed from `pool` and writes it to the record: the one call the pipeline makes. */
export function chooseBed(
  dataDir: string,
  pool: readonly string[],
  o: { ep: string; lane: BedLane; seed: number; now?: Date },
): string | null {
  const file = pickBed(pool, readBedLog(dataDir), o);
  if (file)
    recordBed(dataDir, {
      ep: o.ep,
      file,
      lane: o.lane,
      at: (o.now ?? new Date()).toISOString(),
    });
  return file;
}

/** A video's own number for the choice (its id's hash, as pipeline.ts variantOf before the modulo). */
export function bedSeed(id: string): number {
  return [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
}
