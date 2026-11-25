// The game's own sound without its score (GAME_SFX_STEMS, off by default until a listening check and a private test
// upload). Measured 20 Nov 2026: with GAME_AUDIO_BED on, 0 of 35 Shorts (15-19 Nov) got a game sound bed, because
// nearly every clip on screen was an official trailer (167 of 223 skipped clips: "trailer music") or a library clip
// kept as picture only (55: "nothing to hear"). A trailer's sound is the game (gunfire, engines, crowds, wind) mixed
// with a score or a licensed song, and the song is the Content ID risk; this keeps the first and drops the second.
//
// Each library video is processed once on the PC (src/tools/gamesfx.ts, through the orchestrator): its sound is read
// from the publisher's own file, Demucs splits off the vocals, the tonal part of what is left (chords, melody, pads,
// the bass line) is taken out, and wherever the rest still repeats on a steady beat the stem is taken down 24 dB
// (src/tools/gamesfx.py). Beside the library item go:
//   <library>/<game>/sfxstems/<item>.sfx.m4a   the game's sound, time-aligned with the library's picture;
//   <library>/<game>/sfxstems/<item>.json      its level, the removed music's level and the beat gate every 0.25 s.
// The Mac reads both from the PC's library server (GAMELIB_REMOTE) like any library media, or locally when it holds
// them. A clip on screen whose stretch is mostly free of the beat gate is then heard in the game sound bed through
// its stem (src/assets/gameaudio.ts hearClips), ducked under the voice and up in the gaps like a cutscene's sound;
// on the Mac, Apple's sound classifier still hears each stretch and the usual music rules apply on top.
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "../lib/bin.ts";
import { runCapped } from "../lib/child.ts";
import { fetchWithTimeout } from "../lib/util.ts";
import { libraryRoot, type GameLibrary, type LibItem } from "./gamelib.ts";

export const SFX_STEM_VERSION = 1;
export const SFX_STEMS_DIR = "sfxstems";
/** The beat gate's depth in the stem (src/tools/gamesfx.py GATE_DB); a step at half of it or lower counts as gated. */
export const SFX_GATE_DB = -24;
/** A clip is heard through its stem only when at least this share of its stretch is clear of the beat gate ... */
export const SFX_MIN_CLEAR = 0.6;
/** ... and the stem has something to hear there: at least this share of steps above SFX_QUIET_DB. */
export const SFX_MIN_SOUND = 0.4;
export const SFX_QUIET_DB = -50;

export const sfxStemFile = (item: string): string =>
  path.join(SFX_STEMS_DIR, `${item}.sfx.m4a`);
export const sfxStemInfoFile = (item: string): string =>
  path.join(SFX_STEMS_DIR, `${item}.json`);

export interface SfxStemInfo {
  version: number;
  item: string;
  sourceUrl: string;
  /** The stem, relative to the game's library folder. */
  file: string;
  /** The grid of the lists below, seconds. */
  step: number;
  /** The stem's level, the removed music's level and the beat gate (dB, 0 = open), every `step`. */
  sfx: number[];
  music: number[];
  gate: number[];
  /** Share of the original energy kept, and share of the time under the beat gate. */
  kept: number;
  gatedShare: number;
  builtAt: string;
}

/** A library video worth a stem (pure): an official video, usable, not the owner's own capture. */
export const wantsStem = (
  i: Pick<LibItem, "kind" | "source" | "unusable">,
): boolean => i.kind === "video" && i.source !== "own" && !i.unusable;

/** A stem's info file, or undefined when it is not one (pure). */
export function parseSfxStemInfo(raw: unknown): SfxStemInfo | undefined {
  const o = raw as Partial<SfxStemInfo> | null;
  if (
    !o ||
    o.version !== SFX_STEM_VERSION ||
    typeof o.item !== "string" ||
    typeof o.file !== "string" ||
    typeof o.step !== "number" ||
    !(o.step > 0) ||
    !Array.isArray(o.sfx) ||
    !Array.isArray(o.gate)
  )
    return undefined;
  return o as SfxStemInfo;
}

/**
 * How a stretch [from, to) of a stem can be heard (pure): the share of its steps clear of the beat gate and the
 * share with sound above SFX_QUIET_DB. A stretch outside the stem counts as gated and silent.
 */
export function stemStretch(
  info: Pick<SfxStemInfo, "step" | "sfx" | "gate">,
  from: number,
  to: number,
): { clear: number; sound: number } {
  const a = Math.max(0, Math.floor(from / info.step));
  const b = Math.max(a + 1, Math.ceil(to / info.step));
  let clear = 0;
  let sound = 0;
  for (let i = a; i < b; i++) {
    const g = info.gate[i];
    const s = info.sfx[i];
    if (typeof g === "number" && g > SFX_GATE_DB / 2) clear++;
    if (typeof s === "number" && s > SFX_QUIET_DB) sound++;
  }
  const n = b - a;
  return { clear: clear / n, sound: sound / n };
}

/** Whether a stretch is heard through its stem (pure), or why not. */
export function stemVerdict(s: {
  clear: number;
  sound: number;
}): { ok: true } | { skip: string } {
  if (s.clear < SFX_MIN_CLEAR)
    return {
      skip: `under the score's beat (${Math.round((1 - s.clear) * 100)}%)`,
    };
  if (s.sound < SFX_MIN_SOUND) return { skip: "stem silent there" };
  return { ok: true };
}

/** The library item (and its game folder) whose file URL is this, found in any game's library.json. Never throws. */
export async function libraryItemByUrl(
  root: string,
  sourceUrl: string,
): Promise<{ game: string; item: LibItem } | undefined> {
  for (const slug of await fs.readdir(root).catch(() => [] as string[])) {
    try {
      const lib = JSON.parse(
        await fs.readFile(path.join(root, slug, "library.json"), "utf8"),
      ) as GameLibrary;
      const item = lib?.items?.find(
        (i) => i.kind === "video" && i.sourceUrl === sourceUrl,
      );
      if (item) return { game: lib.game, item };
    } catch {
      // not a library
    }
  }
  return undefined;
}

/** A library file as something ffmpeg or fetch can read: the local copy, else the PC's library server. */
async function libraryFile(
  root: string,
  game: string,
  file: string,
): Promise<{ local?: string; url?: string } | undefined> {
  const { sourceOf, storeSettings } = await import("./gamelibstore.ts");
  return sourceOf(root, game, file, storeSettings());
}

async function readInfo(
  root: string,
  game: string,
  item: string,
): Promise<SfxStemInfo | undefined> {
  const at = await libraryFile(root, game, sfxStemInfoFile(item));
  if (!at) return undefined;
  if (at.local)
    return parseSfxStemInfo(JSON.parse(await fs.readFile(at.local, "utf8")));
  const res = await fetchWithTimeout(at.url!, {}, 15_000);
  // Not processed yet (the PC's server answers 404): no stem.
  return res.ok ? parseSfxStemInfo(await res.json()) : undefined;
}

/**
 * The game sound of a clip on screen, through its library video's stem: that stretch written beside the clip
 * (`clip_3.sfx.m4a`), time 0 the clip's first frame. Undefined when the clip is not a processed library video;
 * `{ skip }` when it is but its stretch is under the score's beat or silent. Never throws.
 */
export async function gameSfxFor(
  dir: string,
  c: {
    file: string;
    sourceUrl?: string;
    startSeconds?: number;
    /** A located section's clip: its startSeconds count from the section, not the whole file. */
    sourceSectionId?: string;
    durationSeconds: number;
  },
  dataDir: string,
): Promise<
  { file: string; clear: number; sound: number } | { skip: string } | undefined
> {
  try {
    if (!c.sourceUrl || typeof c.startSeconds !== "number" || c.sourceSectionId)
      return undefined;
    const root = libraryRoot(dataDir);
    const hit = await libraryItemByUrl(root, c.sourceUrl);
    if (!hit) return undefined;
    const info = await readInfo(root, hit.game, hit.item.id);
    if (!info) return undefined;
    const seconds = Math.max(0.5, c.durationSeconds);
    const s = stemStretch(info, c.startSeconds, c.startSeconds + seconds);
    const v = stemVerdict(s);
    if ("skip" in v) return v;
    const at = await libraryFile(root, hit.game, info.file);
    const input = at?.local ?? at?.url;
    if (!input) return undefined;
    const rel = c.file.replace(/\.[a-z0-9]+$/i, "") + ".sfx.m4a";
    await runCapped(
      FFMPEG,
      [
        "-v",
        "error",
        "-y",
        "-ss",
        c.startSeconds.toFixed(3),
        "-i",
        input,
        "-t",
        (seconds + 0.3).toFixed(3),
        "-vn",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        path.join(dir, rel),
      ],
      { timeout: 120_000 },
    );
    return { file: rel, ...s };
  } catch {
    return undefined;
  }
}
