// No near-identical shot twice (owner's no-reused-stills rule; the 27 Nov GTA guide proof showed one skyline three
// times and one car still twice in its first twenty seconds, from different files: IGDB serves near-identical
// screenshots under different ids, and one clip plays at different offsets). A picture's look is a 64-bit
// difference hash of its 9x8 greyscale thumbnail; looks within LOOK_DISTANCE bits are one shot to the viewer.
// After the plan is made, a shot whose look was on screen within REPEAT_GAP_SECONDS (anywhere in the opening
// OPENING_SECONDS) takes a picture not yet shown, else the shot before it holds longer, else it stays and is counted.
// Pure: the hashes come in from the pipeline (src/assets/lookhash.ts).

import type { LongShot } from "./longplan.ts";

export const LOOK_DISTANCE = 10;
export const REPEAT_GAP_SECONDS = 60;
export const OPENING_SECONDS = 60;

/** The difference hash of a 9x8 greyscale thumbnail (72 bytes, row by row), as 16 hex digits (pure). */
export function dhash(gray: ArrayLike<number>): string | undefined {
  if (gray.length < 72) return undefined;
  let bits = "";
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      bits += gray[y * 9 + x]! > gray[y * 9 + x + 1]! ? "1" : "0";
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

/** Bits that differ between two hashes (pure). */
export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * One look key per hash (pure): every hash within LOOK_DISTANCE of an earlier one takes that one's key, so a set of
 * near-identical pictures is one look. A missing hash is its own look (`fallback`).
 */
export function groupLooks(
  hashes: ReadonlyArray<string | undefined>,
  fallback: (i: number) => string,
): string[] {
  const reps: Array<{ hash: string; key: string }> = [];
  return hashes.map((h, i) => {
    if (!h) return fallback(i);
    const near = reps.find((r) => hamming(r.hash, h) <= LOOK_DISTANCE);
    if (near) return near.key;
    const key = `look:${h}`;
    reps.push({ hash: h, key });
    return key;
  });
}

export interface LookDedupeResult {
  shots: LongShot[];
  /** Shots given a picture not yet shown. */
  swapped: number;
  /** Shots folded into the one before (a longer hold). */
  held: number;
  /** Repeats nothing could replace. */
  left: number;
}

/**
 * The plan's shots with near-identical repeats taken out (pure). `lookOf` names a shot's look (undefined: never a
 * repeat, e.g. a graphic or the plate); `spare(shot)` lists image indexes the shot may take instead, best first, with
 * their looks from `imageLook`. One clip's own later shots (its unseen remainder, or a clip running on across a cut)
 * are never repeats of each other. A hold stays inside its sentence's segment, inside its clip's length
 * (`clipFrames`) and, for a still, within `maxStillFrames`. A clip's repeat holds the shot before first (keeping
 * the picture moving), an image's tries a fresh picture first.
 */
export function dedupeLookalikes(
  shots: readonly LongShot[],
  o: {
    fps: number;
    lookOf: (s: LongShot) => string | undefined;
    imageLook: readonly string[];
    spare: (s: LongShot) => number[];
    clipFrames?: (index: number) => number | undefined;
    maxStillFrames?: number;
    gapSeconds?: number;
    openingSeconds?: number;
  },
): LookDedupeResult {
  const gap = (o.gapSeconds ?? REPEAT_GAP_SECONDS) * o.fps;
  const opening = (o.openingSeconds ?? OPENING_SECONDS) * o.fps;
  const lastEnd = new Map<string, number>();
  const lastClip = new Map<string, number>();
  const out: LongShot[] = [];
  let swapped = 0;
  let held = 0;
  let left = 0;
  const canHold = (prev: LongShot | undefined, s: LongShot): prev is LongShot => {
    if (!prev || prev.end !== s.start || prev.segment !== s.segment) return false;
    const len = s.end - prev.start;
    if (prev.media.type === "clip") {
      const frames = o.clipFrames?.(prev.media.index);
      return frames !== undefined && (prev.media.from ?? 0) + len <= frames;
    }
    if (prev.media.type === "image") return o.maxStillFrames === undefined || len <= o.maxStillFrames;
    return false;
  };
  for (const s0 of [...shots].sort((a, b) => a.start - b.start)) {
    let s = s0;
    let look = o.lookOf(s);
    const sameClip =
      s.media.type === "clip" && look !== undefined && lastClip.get(look) === s.media.index;
    const repeat =
      look !== undefined &&
      lastEnd.has(look) &&
      !sameClip &&
      (s.start < opening || s.start - lastEnd.get(look)! < gap);
    if (repeat) {
      const prev = out[out.length - 1];
      const fresh = () => o.spare(s).find((k) => !lastEnd.has(o.imageLook[k]!));
      const hold = () => {
        out[out.length - 1] = { ...prev!, end: s.end };
        // The held look is on screen until the new end: a later repeat is measured from there.
        const l = o.lookOf(prev!);
        if (l) lastEnd.set(l, s.end);
        held++;
      };
      if (s.media.type === "clip" && canHold(prev, s)) {
        hold();
        continue;
      }
      const k = fresh();
      if (k !== undefined) {
        s = { ...s, media: { ...s.media, type: "image", index: k, from: undefined } };
        look = o.imageLook[k];
        swapped++;
      } else if (canHold(prev, s)) {
        hold();
        continue;
      } else left++;
    }
    if (look) {
      lastEnd.set(look, s.end);
      if (s.media.type === "clip") lastClip.set(look, s.media.index);
      else lastClip.delete(look);
    }
    out.push(s);
  }
  return { shots: out, swapped, held, left };
}
