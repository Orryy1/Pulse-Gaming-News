// Series-signature music (SIGNATURE_MUSIC, off by default; research 14 Nov 2026, tech.md item 3.8): each named
// series opens on its own short sting and plays its own bed, the same every time, so a repeat viewer knows
// the series by ear before the first word. Documentaries also get a rise that builds into a chapter and lands
// its downbeat on the chapter's first frame, so the music is cut to the edit instead of looping past it.
//
// The music is made locally with ACE-Step 1.5 (MIT; generated music cleared for commercial use by its model
// card, public/music/signature/LICENCE.md), chosen and finished by measurement (src/tools/musiclab/picksig.py)
// to the soundscape v3 rules: stings loudness-matched like every sound file (so LEVEL.sting means the same),
// beds at the house beds' -12.7 LUFS, everything in D or E major so the tuned sounds stay in key. A series
// with nothing that passed keeps the house music. Pure and free of node imports: the Remotion bundle uses it.

import { SFX, sfxFile } from "./soundscape.ts";

export const SIGNATURE_SERIES = [
  "gta_daily",
  "why",
  "gta_file",
  "pulse_lab",
  "receipts",
  "docs",
] as const;
export type SignatureSeries = (typeof SIGNATURE_SERIES)[number];

export interface SignatureEntry {
  name: string;
  key: "D" | "E";
  /** The sting, a file under public/sfx without .mp3 ("signature/why"). */
  sting?: string;
  /** Seconds from the sting's start to its loudest moment. */
  stingPeak?: number;
  /** The bed, a file under public ("music/signature/why_bed.wav"). */
  bed?: string;
  /** The bed's bar grid (seconds), as src/render/soundscape.ts BED_GRID. */
  grid?: { bar: number; first: number; loop: number };
  /** The documentary rise: its file, where its downbeat lands and how long it lasts (seconds). */
  rise?: { file: string; hit: number; seconds: number };
}
export type SignatureLibrary = Partial<Record<SignatureSeries, SignatureEntry>>;

const isSignature = (x: unknown): x is SignatureSeries =>
  typeof x === "string" && (SIGNATURE_SERIES as readonly string[]).includes(x);

/**
 * The signature a video plays (pure): a documentary is "docs"; otherwise the series tag on the script or the
 * story (src/series.ts, plus "pulse_lab" and "receipts", the named segments of the 14 Nov formats research,
 * which have no tag of their own yet). Buy, Wait or Skip, the control and untagged Shorts have none.
 */
export function signatureSeriesOf(o: {
  series?: unknown;
  documentary?: boolean;
}): SignatureSeries | undefined {
  if (o.documentary) return "docs";
  return isSignature(o.series) && o.series !== "docs" ? o.series : undefined;
}

/** A series' entry when it has a sting that passed (a bed alone is not a signature). */
export function signatureFor(
  lib: SignatureLibrary,
  id: SignatureSeries | undefined,
): SignatureEntry | undefined {
  const e = id ? lib[id] : undefined;
  return e?.sting ? e : undefined;
}

/**
 * A Short's music with its series' signature (pure): the series bed when one passed, else the house bed the
 * Short would have played anyway (`houseBed`, already in D or E, so a sting tuned to the series key may sit a
 * tone off it: then the house bed of the sting's key is used, from `houseByKey`).
 */
export function shortMusic(
  entry: SignatureEntry,
  houseBed: string | null,
  houseByKey: (key: "D" | "E") => string | null,
  houseKey: (file: string) => "D" | "E" | undefined,
): string | null {
  if (entry.bed) return entry.bed;
  if (!houseBed) return null;
  return houseKey(houseBed) === entry.key
    ? houseBed
    : (houseByKey(entry.key) ?? houseBed);
}

/**
 * The sound cues with the brand sting swapped for the series sting (pure, idempotent): the opening and the
 * closing sting. Their volumes stay: every sting file is matched to the same loudness.
 */
export function withSignatureSting<C extends { file: string }>(
  cues: C[],
  sting: string,
): C[] {
  const brand = sfxFile(SFX.sting);
  return cues.map((c) =>
    c.file === brand ? { ...c, file: sfxFile(sting) } : c,
  );
}

// ---------------------------------------------------------------- the documentary rise

/** Rises at least this far apart: one into every chapter would turn a signature into a habit. */
export const RISE_GAP_SECONDS = 150;
/** No rise into a chapter that opens this early (the opening sting owns the start). */
export const RISE_OPENING_SECONDS = 45;
/** At most this many rises in one documentary. */
export const MAX_RISES = 6;
/** The bed sits at this share of its level under a rise (-9 dB), so the build is heard and not stacked. */
export const RISE_BED_DUCK = 0.35;
/** The bed eases down over this long as the rise starts, and back up over RISE_BED_BACK after the hit. */
export const RISE_BED_FALL_SECONDS = 3;
export const RISE_BED_BACK_SECONDS = 2;

export interface RiseCue {
  /** First frame of the rise file. */
  from: number;
  /** Frames it plays. */
  frames: number;
  /** The frame its downbeat lands on: the chapter's first frame. */
  hit: number;
}

/**
 * Where the documentary's rises play (pure): into a chapter whose start leaves room for the whole build, at
 * least RISE_GAP_SECONDS after the last rise's downbeat, never in the opening, never into a chapter the
 * `avoid` test refuses (a key line, a breather), at most MAX_RISES. The downbeat lands on the chapter's frame.
 */
export function riseCues(
  chapterFrames: number[],
  total: number,
  fps: number,
  rise: { hit: number; seconds: number },
  avoid: (frame: number) => boolean = () => false,
): RiseCue[] {
  const out: RiseCue[] = [];
  const lead = Math.round(rise.hit * fps);
  const frames = Math.round(rise.seconds * fps);
  if (lead <= 0 || frames <= lead) return out;
  for (const c of [...chapterFrames].sort((a, b) => a - b)) {
    if (out.length >= MAX_RISES) break;
    if (c < RISE_OPENING_SECONDS * fps || c - lead < 0) continue;
    if (c - lead + frames > total) continue;
    const last = out.at(-1);
    if (last && c - last.hit < RISE_GAP_SECONDS * fps) continue;
    if (last && c - lead < last.from + last.frames) continue;
    if (avoid(c)) continue;
    out.push({ from: c - lead, frames, hit: c });
  }
  return out;
}

/** The bed's level under the rises (pure, 0-1): down to RISE_BED_DUCK over the build, back after the downbeat. */
export function riseBedLevel(f: number, cues: RiseCue[], fps: number): number {
  let level = 1;
  for (const c of cues) {
    const fall = Math.round(RISE_BED_FALL_SECONDS * fps);
    const back = Math.round(RISE_BED_BACK_SECONDS * fps);
    if (f < c.from || f > c.hit + back) continue;
    const v =
      f < c.from + fall
        ? 1 - (1 - RISE_BED_DUCK) * ((f - c.from) / fall)
        : f <= c.hit
          ? RISE_BED_DUCK
          : RISE_BED_DUCK + (1 - RISE_BED_DUCK) * ((f - c.hit) / back);
    level = Math.min(level, v);
  }
  return level;
}
