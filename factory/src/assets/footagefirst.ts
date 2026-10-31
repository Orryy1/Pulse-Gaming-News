// Footage first for long videos (owner, 31 Oct 2026, watching the Vice City documentary: "instead of constant
// stills why can't we have loads of gameplay footage, there must be tons out there on the Internet by now").
// Measured on that video's plan: 75% of the narrated time was stills and 20% moving footage, and 125 of its 142
// clips were used, so supply was the limit, not the planner. The chapter gather asks for one clip per sentence
// from the first 300 seconds of four videos; this pass, run once per long video before the per-sentence picture
// top-up (src/assets/fill.ts), gathers a chapter's worth more:
//   1. Creative Commons (CC BY) gameplay of the chapter's game, found by YouTube's free search page with its
//      licence filter, the licence read from each video itself (yt-dlp, no API quota), several videos per game.
//   2. Junk is refused before anything is downloaded, by title and channel: mods, kids' videos (Spider-Man on
//      ramps), reactions and facecams, remasters and fan remakes (another look than the game the chapter is
//      about), videos naming another entry of the series. A game not out yet gets none at all: uploaded
//      "gameplay" of it can only be fake (the GTA VI chapter's mods, 30 Oct 2026).
//   3. A longer window of each video is downloaded and cut at its own edits into many segments; one frame of
//      each is looked at on this PC's GPU (free, src/assets/localvision.ts lookFrames) for a label and for
//      junk: mods and cartoon characters, menus, facecams, burned-in text, gore, darkness. A video whose
//      segments are mostly mods or facecams loses every segment.
//   4. Each in-game sentence still without footage of its own gets the segments whose labels share its words;
//      the rest stay as the chapter's footage with their labels, for the picture editor's bin pass to pin
//      (fill.ts assignFromBin) and the planner to play ahead of stills. Real-world sentences (a person, B-roll)
//      are left to photos and stock.
// Everything is credited on screen ("GAMEPLAY: <CHANNEL> / CC BY"), counted (downloads, megabytes, frames looked
// at, model calls) and reported. Settings: FOOTAGE_FIRST, FOOTAGE_SHARE_TARGET and the FOOTAGE_* limits.

import path from "node:path";
import fs from "node:fs/promises";
import { log, errorMessage } from "../lib/util.ts";
import type { SegmentLook } from "./localvision.ts";
import { clipJumps, gameplayCredit, wrongEntry } from "./gameplay.ts";
import { trailerMatchesGame } from "./commons.ts";
import { normTitle } from "./igdb.ts";
import { junkTitleReason, notOutYet } from "./junk.ts";

export { junkTitleReason, notOutYet };

/** One long video's footage-first tunables (from the settings). */
export interface FootageFirstOptions {
  /** Moving footage wanted, as a share of a game chapter's narrated time (FOOTAGE_SHARE_TARGET, percent). */
  sharePct: number;
  /** CC BY videos per chapter at most (FOOTAGE_SOURCES). */
  sources: number;
  /** Seconds downloaded from each video (FOOTAGE_PULL_SECONDS). */
  pullSeconds: number;
  /** Segment frames looked at per chapter at most (FOOTAGE_VISION_MAX). */
  visionMax: number;
  /** Segments pinned to one sentence at most. */
  perSentence: number;
  /** The whole pass stops starting new work after this long (FOOTAGE_FIRST_MAX_MINUTES); 0 = no limit. */
  maxMinutes: number;
}

export const FOOTAGE_FIRST_DEFAULTS: FootageFirstOptions = {
  sharePct: 60,
  sources: 6,
  pullSeconds: 240,
  visionMax: 120,
  perSentence: 2,
  maxMinutes: 40,
};

/** The pass's options from the settings. */
export function footageOptions(cfg: {
  footageShareTarget: number;
  footageSources: number;
  footagePullSeconds: number;
  footageVisionMax: number;
  footageFirstMaxMinutes: number;
}): FootageFirstOptions {
  return {
    sharePct: cfg.footageShareTarget,
    sources: cfg.footageSources,
    pullSeconds: cfg.footagePullSeconds,
    visionMax: cfg.footageVisionMax,
    perSentence: FOOTAGE_FIRST_DEFAULTS.perSentence,
    maxMinutes: cfg.footageFirstMaxMinutes,
  };
}

/** Seconds one look on the local model takes, near enough (31 Oct 2026: 4.7-5.1 s). */
export const LOOK_SECONDS = 5;

/** This chapter's end: an even share of the time left among the released chapters still to come. */
export function fairDeadline(now: number, deadline: number, chaptersLeft: number): number {
  if (!Number.isFinite(deadline)) return deadline;
  return now + Math.max(0, deadline - now) / Math.max(1, chaptersLeft);
}

/** Source windows downloaded at the same time. */
export const DOWNLOADS_AT_ONCE = 6;

/** The shortest segment worth a shot (the planner's shortest clip shot is 1.3 s; a line needs more). */
export const SEGMENT_MIN_SECONDS = 2.4;
/** The longest piece one unbroken take is cut into: a long drive becomes several shots, not one. */
export const SEGMENT_MAX_SECONDS = 7;
/** Below this mean brightness a segment is too dim to show. */
export const DIM_LUMA = 45;
/** Narration speed used to size a chapter before its words are timed. */
export const WORDS_PER_SECOND = 2.6;

// ---------------------------------------------------------------------------------------------------------
// Refusing junk before anything is downloaded.

/** The words a plain gameplay upload's title carries. */
const GAMEPLAY_WORD =
  /\b(gameplay|walkthrough|playthrough|longplay|let'?s play|missions?|no commentary|full game|part \d+|episode \d+|free ?roam)\b|#\d+/i;

/**
 * Why a video should not be downloaded as footage of this game, or undefined when it may be. Its title must
 * name the game (and no other entry of its series), and nothing in the title or channel may mark it as a mod,
 * kids' content, a reaction, a remaster or fan build, or something other than plain gameplay.
 */
export function junkSourceReason(
  title: string,
  channel: string,
  game: string,
  franchise: string,
  year?: number,
): string | undefined {
  const junk = junkTitleReason(title, channel, game);
  if (junk) return junk;
  // Plain gameplay says so: essays, sketches and "what happens if" videos are edited, with overlays and effects.
  if (!GAMEPLAY_WORD.test(title)) return "not plain gameplay";
  if (!namesGame(title, game, franchise, year))
    return "title does not name this game";
  // A video's own numbering ("#12", "Walkthrough #2", "Part 3") is not an entry number of the series.
  const bare = title.replace(
    /#\s*\d+|\b(walkthrough|part|episode|ep|mission|chapter|day)\s*#?\s*\d+/gi,
    " ",
  );
  if (wrongEntry(game, bare) || otherEntry(bare, game))
    return "names another entry of the series";
  return undefined;
}

/** Fans' short forms of series names, so "GTA Vice City" names "Grand Theft Auto: Vice City". */
const SHORT_FORMS: Array<[RegExp, string]> = [
  [/\bgrand theft auto\b/gi, "gta"],
  [/\bcall of duty\b/gi, "cod"],
  [/\bfinal fantasy\b/gi, "ff"],
  [/\bresident evil\b/gi, "re"],
];
const shortForm = (t: string) =>
  SHORT_FORMS.reduce((x, [re, s]) => x.replace(re, s), t.toLowerCase());

/**
 * True when a title names the game: its distinguishing words ("Vice City", "III"), in full or the fans' short
 * form. The first game of a series shares the series name with every sequel ("GTA Vice City gameplay" names
 * "GTA" too), so for it the title must also give its year or call it the original.
 */
export function namesGame(
  title: string,
  game: string,
  franchise: string,
  year?: number,
): boolean {
  if (trailerMatchesGame(title, game, franchise)) return true;
  if (
    trailerMatchesGame(shortForm(title), shortForm(game), shortForm(franchise))
  )
    return true;
  const t = ` ${normTitle(shortForm(title))} `;
  const g = normTitle(shortForm(game));
  if (g.length < 3 || !t.includes(` ${g} `)) return false;
  // A first game: only with its year, or "original", "classic", "DOS" or the number 1.
  return (
    (year !== undefined && t.includes(` ${year} `)) ||
    new RegExp(` ${g} (1|i) |\\b(original|classic|dos)\\b`).test(t)
  );
}

/** The entry numbers a title gives a series ("GTA Vice City in GTA 5" gives 5), as digits. */
function entryNumbers(text: string, series: string): Set<string> {
  const nums = new Set<string>();
  if (series.length < 2) return nums;
  const re = new RegExp(
    `\\b${series.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(\\d{1,2}|viii|vii|vi|iv|v|ix|x|iii|ii|i)\\b`,
    "gi",
  );
  for (const m of shortForm(text).matchAll(re))
    nums.add(romanToNumber(m[1]!.toLowerCase()));
  return nums;
}

/**
 * A title naming a numbered entry of the series other than this game ("GTA 6 in GTA 5" for GTA V, "GTA VI:
 * Vice City map" for Vice City, which has no number of its own).
 */
export function otherEntry(title: string, game: string): boolean {
  const series = shortForm(game).split(/[:\s]+/)[0] ?? "";
  const mine = [...entryNumbers(game, series)][0] ?? "1";
  return [...entryNumbers(title, series)].some((n) => n !== mine);
}

function romanToNumber(x: string): string {
  const r: Record<string, string> = {
    i: "1",
    ii: "2",
    iii: "3",
    iv: "4",
    v: "5",
    vi: "6",
    vii: "7",
    viii: "8",
    ix: "9",
    x: "10",
  };
  return r[x] ?? String(Number(x));
}

/** True when a yt-dlp licence line is a Creative Commons Attribution licence. */
export function ccBy(license: string | undefined): boolean {
  return (
    /creative commons/i.test(license ?? "") &&
    !/non-?commercial|no ?deriv|\bnc\b|\bnd\b/i.test(license ?? "")
  );
}

// ---------------------------------------------------------------------------------------------------------
// Cutting a downloaded window into segments.

/** The window of a video to download: a different part of each video, clear of intros and outros. */
export function pullWindow(
  durationSeconds: number,
  k: number,
  pullSeconds: number,
): { from: number; to: number } {
  const lead = Math.min(45, durationSeconds * 0.08);
  const tail = Math.min(30, durationSeconds * 0.05);
  if (durationSeconds - lead - tail <= pullSeconds)
    return { from: Math.round(lead), to: Math.round(durationSeconds - tail) };
  // Successive videos start at different depths (0.12, 0.41, 0.70, 0.29, ...), so a channel's series of
  // mission videos or one long playthrough is not always sampled at its opening missions.
  const frac = 0.12 + ((k * 0.29) % 0.7);
  const from = Math.max(
    lead,
    Math.min(durationSeconds - tail - pullSeconds, durationSeconds * frac),
  );
  return { from: Math.round(from), to: Math.round(from + pullSeconds) };
}

/**
 * Segments of a downloaded window between its edits (clipJumps), each at most SEGMENT_MAX_SECONDS: a long take
 * is cut into consecutive pieces. Dark stretches (below the luma floor) are left out, as is a frame either side
 * of each edit.
 */
export function segmentsOf(
  rows: Array<{ time: number; luma: number; motion?: number; scene?: number }>,
  totalSeconds: number,
  min = SEGMENT_MIN_SECONDS,
  max = SEGMENT_MAX_SECONDS,
  darkLuma = 30,
): Array<{ from: number; len: number; motion: number }> {
  const jumps = clipJumps(rows);
  const edges = [0, ...jumps, totalSeconds];
  const out: Array<{ from: number; len: number; motion: number }> = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const a = k === 0 ? 0 : edges[k]! + 1 / 15;
    const b =
      k + 1 === edges.length - 1 ? totalSeconds : edges[k + 1]! - 1 / 15;
    let at = a;
    while (b - at >= min) {
      const len = Math.min(max, b - at);
      // A piece that would leave a sliver behind shares it out instead.
      const rest = b - at - len;
      const take = rest > 0 && rest < min ? (b - at) / 2 : len;
      const dark = rows.filter(
        (r) => r.time >= at && r.time <= at + take && r.luma < darkLuma,
      ).length;
      const inside = rows.filter((r) => r.time >= at && r.time <= at + take);
      const all = inside.length;
      // A dim stretch reads as black on a phone even with no single black frame (31 Oct 2026 proof: a night
      // warehouse in San Andreas): the segment's mean brightness must clear DIM_LUMA too.
      const mean = all ? inside.reduce((n, r) => n + r.luma, 0) / all : 255;
      // How much the picture moves: a paused game or a held menu reads as a frozen video.
      const motion = all ? inside.reduce((n, r) => n + (r.motion ?? 0), 0) / all : 0;
      if (!all || (dark / all < 0.1 && mean >= DIM_LUMA))
        out.push({ from: round(at), len: round(take), motion: Math.round(motion * 100) / 100 });
      at += take;
    }
  }
  return out;
}

const round = (x: number) => Math.round(x * 30) / 30;

/** Up to n items spread evenly across a list. */
export function spread<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from(
    { length: n },
    (_, i) => xs[Math.floor((i * xs.length) / n)]!,
  );
}

/** Items in turns from each group (the first of every group, then the second, ...), groups in first-seen order. */
export function roundRobin<T>(xs: T[], group: (x: T) => unknown): T[] {
  const groups = new Map<unknown, T[]>();
  for (const x of xs)
    groups.set(group(x), [...(groups.get(group(x)) ?? []), x]);
  const out: T[] = [];
  for (let r = 0; out.length < xs.length; r++)
    for (const g of groups.values()) if (g[r] !== undefined) out.push(g[r]!);
  return out;
}

/** Below this mean frame difference (0-255, at 320 px) a segment is a frozen picture: a pause, a held menu. */
export const FROZEN_MOTION = 0.3;
/** Two segments of one video whose middle frames' hashes differ in at most this many of 64 bits look the same. */
export const SAME_PICTURE_BITS = 6;

/** Videos with at least `min` segments judged and under `rate` of them passing: their other segments are skipped. */
export function poorSources(
  verdicts: Array<{ source: number; ok: boolean }>,
  min = 6,
  rate = 0.15,
): Set<number> {
  const by = new Map<number, { all: number; ok: number }>();
  for (const v of verdicts) {
    const m = by.get(v.source) ?? { all: 0, ok: 0 };
    m.all++;
    if (v.ok) m.ok++;
    by.set(v.source, m);
  }
  return new Set([...by].filter(([, m]) => m.all >= min && m.ok / m.all < rate).map(([k]) => k));
}

/**
 * Black bars over a third of the frame, from a 9x8 greyscale thumbnail: the top and bottom rows (an eighth of the
 * height each) near black while the middle is not. Cutscenes letterboxed in a 16:9 recording read so.
 */
export function letterboxed(gray: Uint8Array | number[]): boolean {
  const row = (y: number) => Array.from({ length: 9 }, (_, x) => gray[y * 9 + x]!).reduce((n, v) => n + v, 0) / 9;
  const mid = (row(3) + row(4)) / 2;
  return row(0) < 14 && row(7) < 14 && mid > 30;
}

/** A 64-bit difference hash from a 9x8 greyscale thumbnail (row by row): each bit is "brighter than its right neighbour". */
export function dHash(gray: Uint8Array | number[]): string {
  let bits = "";
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) bits += gray[y * 9 + x]! > gray[y * 9 + x + 1]! ? "1" : "0";
  return bits;
}

/** How many bits two hashes differ in (64 when either is missing). */
export function hamming(a: string | undefined, b: string | undefined): number {
  if (!a || !b || a.length !== b.length) return 64;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/**
 * Readable words in a frame the OCR found, outside the game's own HUD corners (the minimap bottom left, money
 * and clock top right). Subtitles, tutorial prompts and mission lines are words; HUD digits and the scraps the
 * engine makes of stylised numbers are not (31 Oct 2026: 60 frames read in 1.2 s, subtitles read cleanly).
 */
export function captionWords(page: { width: number; height: number; words: Array<{ text: string; x: number; y: number; w: number; h: number }> } | undefined): number {
  if (!page || !page.width || !page.height) return 0;
  return page.words.filter((w) => {
    const letters = (w.text.match(/[a-z]/gi) ?? []).length;
    if (letters < 3 || letters / w.text.length < 0.75) return false;
    // Lower-case letters after the first: a real word, not a run of digits read as capitals.
    if (!/^[A-Za-z][a-z'.,!?:-]+$/.test(w.text) && !/^[A-Z]{3,}[.,!?]?$/.test(w.text)) return false;
    const cx = (w.x + w.w / 2) / page.width;
    const cy = (w.y + w.h / 2) / page.height;
    if (cx > 0.6 && cy < 0.35) return false; // money, clock, health, wanted stars
    if (cx < 0.25 && cy > 0.65) return false; // the minimap
    return true;
  }).length;
}

// ---------------------------------------------------------------------------------------------------------
// The look at each segment.

/** Why a segment is junk, from the local model's look at its frame; undefined for a usable one. */
export function segmentRejectReason(
  look: SegmentLook | undefined,
): string | undefined {
  if (!look) return "not looked at";
  if (look.mod) return "mod or kids' content";
  if (look.webcam) return "facecam or overlay";
  if (look.live) return "real camera footage";
  if (look.menu) return "menu or loading screen";
  if (look.gore) return "gore";
  if (look.text) return "text on screen";
  if (look.letterbox) return "letterboxed";
  if (look.dark) return "too dark";
  if (look.blurry) return "blurred";
  if (!look.label) return "no label";
  return undefined;
}

/** Sources whose looked-at segments are mostly mods or facecams: every segment of theirs is refused. */
/** The refusal reason for a filmed screen. */
export const FILMED = "filmed screen (bezel or tilted picture)";

/** Width and height of the greyscale thumbnails the border check reads. */
export const BORDER_W = 160;
export const BORDER_H = 90;

/**
 * A screen filmed with a camera (31 Oct 2026: "Grand Theft Auto Online - PS3 Playthrough 1.2", a TV with its
 * bezel at both sides), from three greyscale thumbnails of one segment (BORDER_W x BORDER_H, row by row). A
 * border is the run of pixels from an edge that stay dark (under 50) and still (moving under 12) in every
 * thumbnail; it is measured across the middle 60% of the picture. Refused:
 *   - borders at both sides, at least one straight (its widths within 3 pixels) and at least one grey rather
 *     than black (a bezel or a wall, mean over 12): a capture card's pillarbox is pure black and stays allowed;
 *   - straight borders on all four sides with any of them grey (a screen in a room);
 *   - a side border straight in each half of the picture but shifted 3 pixels or more between them (a picture
 *     filmed at an angle).
 * Dark game scenes have no straight edge-to-edge run, so night footage passes (checked on run 8's 155 kept
 * clips: only the filmed TV's clips trip it; 4:3 PS2 captures with black bars on all sides do not).
 */
export function filmedScreen(frames: Array<Uint8Array | number[]>, W = BORDER_W, H = BORDER_H): boolean {
  if (frames.length < 2 || frames.some((f) => f.length < W * H)) return false;
  const still = (x: number, y: number) => {
    let lo = 255;
    let hi = 0;
    for (const f of frames) {
      const v = f[y * W + x]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi < 50 && hi - lo < 12;
  };
  const ys = range(Math.floor(H * 0.2), Math.floor(H * 0.8));
  const xs = range(Math.floor(W * 0.2), Math.floor(W * 0.8));
  const run = (n: number, at: (k: number) => boolean) => {
    let k = 0;
    while (k < n && at(k)) k++;
    return k;
  };
  const L = ys.map((y) => run(Math.floor(W / 3), (k) => still(k, y)));
  const R = ys.map((y) => run(Math.floor(W / 3), (k) => still(W - 1 - k, y)));
  const T = xs.map((x) => run(Math.floor(H / 3), (k) => still(x, k)));
  const B = xs.map((x) => run(Math.floor(H / 3), (k) => still(x, H - 1 - k)));
  const first = frames[0]!;
  const luma = (pts: Array<[number, number]>) =>
    pts.length ? pts.reduce((n, [x, y]) => n + first[y * W + x]!, 0) / pts.length : 0;
  const side = (w: number[], pts: Array<[number, number]>) => ({
    has: quantile(w, 0.5) >= 3,
    straight: quantile(w, 0.75) - quantile(w, 0.25) <= 3,
    grey: luma(pts) > 12,
  });
  const l = side(L, ys.flatMap((y, i) => range(0, L[i]!).map((x) => [x, y] as [number, number])));
  const r = side(R, ys.flatMap((y, i) => range(0, R[i]!).map((x) => [W - 1 - x, y] as [number, number])));
  const t = side(T, xs.flatMap((x, i) => range(0, T[i]!).map((y) => [x, y] as [number, number])));
  const b = side(B, xs.flatMap((x, i) => range(0, B[i]!).map((y) => [x, H - 1 - y] as [number, number])));
  const pair = l.has && r.has && (l.straight || r.straight) && (l.grey || r.grey);
  const four = l.has && r.has && t.has && b.has && l.straight && r.straight && t.straight && b.straight && (l.grey || r.grey || t.grey || b.grey);
  const half = Math.floor(ys.length / 2);
  const tilted = (w: number[]) => {
    const a = w.slice(0, half);
    const c = w.slice(half);
    const iqr = (v: number[]) => quantile(v, 0.75) - quantile(v, 0.25);
    return (quantile(a, 0.5) >= 3 || quantile(c, 0.5) >= 3) && iqr(a) <= 2 && iqr(c) <= 2 && Math.abs(quantile(a, 0.5) - quantile(c, 0.5)) >= 3;
  };
  return pair || four || tilted(L) || tilted(R);
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
function quantile(v: number[], q: number): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(q * (s.length - 1))]!;
}

export function condemnedSources(
  verdicts: Array<{ source: string; reason?: string }>,
  share = 0.25,
): Set<string> {
  const by = new Map<string, { bad: number; all: number; filmed: number }>();
  for (const v of verdicts) {
    if (v.reason === "not looked at") continue;
    const m = by.get(v.source) ?? { bad: 0, all: 0, filmed: 0 };
    m.all++;
    if (
      v.reason === "mod or kids' content" ||
      v.reason === "facecam or overlay"
    )
      m.bad++;
    if (v.reason === FILMED) m.filmed++;
    by.set(v.source, m);
  }
  return new Set(
    [...by]
      // A video whose segments are mostly a filmed screen is a filmed screen throughout (the coordinator's rule).
      .filter(([, m]) => m.bad >= Math.max(2, m.all * share) || m.filmed > m.all / 2)
      .map(([s]) => s),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Matching segments to sentences.

const MATCH_STOP = new Set(
  "the a an of and in on to for with at by from is it its this that was were are be been his her their they you your into over under out up down off as or not no but so then than there here which who what when where while game games player players gameplay footage video shot shows showing scene frame view city world character characters person man men woman building buildings hud element elements ui area".split(
    " ",
  ),
);
/** Word families the labels and the narration name things by. */
const FAMILY: Record<string, string> = {
  vehicle: "car",
  vehicles: "car",
  cars: "car",
  driving: "car",
  drive: "car",
  drives: "car",
  drove: "car",
  sedan: "car",
  taxi: "car",
  sportscar: "car",
  motorbike: "bike",
  motorcycle: "bike",
  bikes: "bike",
  bicycle: "bike",
  cycling: "bike",
  boat: "boat",
  boats: "boat",
  speedboat: "boat",
  yacht: "boat",
  helicopter: "heli",
  chopper: "heli",
  plane: "plane",
  airplane: "plane",
  aircraft: "plane",
  jet: "plane",
  cop: "police",
  cops: "police",
  officer: "police",
  wanted: "police",
  sirens: "police",
  swat: "police",
  gun: "shoot",
  guns: "shoot",
  shooting: "shoot",
  shootout: "shoot",
  firefight: "shoot",
  pistol: "shoot",
  rifle: "shoot",
  weapon: "shoot",
  weapons: "shoot",
  beach: "beach",
  ocean: "beach",
  sea: "beach",
  shore: "beach",
  coast: "beach",
  waterfront: "beach",
  night: "night",
  neon: "night",
  dusk: "night",
  sunset: "night",
  evening: "night",
  mansion: "mansion",
  estate: "mansion",
  villa: "mansion",
  club: "club",
  nightclub: "club",
  bar: "club",
  disco: "club",
  street: "street",
  streets: "street",
  road: "street",
  roads: "street",
  highway: "street",
  avenue: "street",
  alley: "street",
  explosion: "explode",
  explodes: "explode",
  exploding: "explode",
  blast: "explode",
  fire: "explode",
  crowd: "people",
  pedestrians: "people",
  pedestrian: "people",
  people: "people",
  rain: "rain",
  rainy: "rain",
  storm: "rain",
  chase: "chase",
  chasing: "chase",
  pursuit: "chase",
  fleeing: "chase",
  map: "open",
  openworld: "open",
  roam: "open",
  explore: "open",
  exploring: "open",
  freeroam: "open",
};

/** The matching words of a text: lower case, stop words out, families folded, plurals trimmed. */
export function matchWords(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)) {
    if (raw.length < 3 || MATCH_STOP.has(raw)) continue;
    const w =
      FAMILY[raw] ??
      (raw.endsWith("s") && raw.length > 4 ? raw.slice(0, -1) : raw);
    out.add(FAMILY[w] ?? w);
  }
  return [...out];
}

export interface Want {
  moment: number;
  /** The sentence, its shot note and its keywords. */
  text: string;
}
export interface Seg {
  id: number;
  source: string;
  label: string;
  len: number;
}

/**
 * Segments pinned to sentences by shared words between the segment's label and the sentence, its shot note and
 * keywords (the game's own name does not count): the best pairs first, at most perSentence segments a sentence,
 * from different videos where it can, never one segment twice. Returns segment id to sentence.
 */
export function assignSegments(
  wants: Want[],
  segs: Seg[],
  gameWords: string[],
  perSentence = 2,
  minScore = 1,
): Map<number, number> {
  const skip = new Set(gameWords.flatMap((g) => matchWords(g)));
  const pairs: Array<{ seg: Seg; want: Want; score: number }> = [];
  for (const w of wants) {
    const ww = new Set(matchWords(w.text).filter((x) => !skip.has(x)));
    for (const s of segs) {
      const score = matchWords(s.label).filter(
        (x) => !skip.has(x) && ww.has(x),
      ).length;
      if (score >= minScore) pairs.push({ seg: s, want: w, score });
    }
  }
  pairs.sort(
    (a, b) => b.score - a.score || b.seg.len - a.seg.len || a.seg.id - b.seg.id,
  );
  const out = new Map<number, number>();
  const per = new Map<number, Seg[]>();
  // Two rounds: first one segment a sentence, from any video; then a second, from another video where it can.
  for (const round of [0, 1])
    for (const p of pairs) {
      if (out.has(p.seg.id)) continue;
      const have = per.get(p.want.moment) ?? [];
      if (have.length > round || have.length >= perSentence) continue;
      if (
        round === 1 &&
        have.some((h) => h.source === p.seg.source) &&
        pairs.some(
          (q) =>
            q.want === p.want &&
            !out.has(q.seg.id) &&
            q.seg.source !== p.seg.source &&
            have.every((h) => h.source !== q.seg.source),
        )
      )
        continue;
      out.set(p.seg.id, p.want.moment);
      per.set(p.want.moment, [...have, p.seg]);
    }
  return out;
}

/**
 * The share of a chapter's gathered clip time that reaches its plan: on the Vice City documentary 65% of the
 * existing clips' seconds played (sentence windows end, a clip waits for its own line), and 55% of the first
 * footage-first proof's new segments (31 Oct 2026).
 */
export const PLAYED_SHARE = 0.6;

/**
 * Seconds of new footage to gather so the chapter's plan can reach the share: what is missing on screen, given
 * what its clips already play, grossed up for the part of any clip that never plays.
 */
export function footageNeed(
  chapterSeconds: number,
  haveSeconds: number,
  sharePct: number,
): number {
  const missing = (chapterSeconds * sharePct) / 100 - haveSeconds * PLAYED_SHARE;
  return Math.max(0, missing / PLAYED_SHARE);
}

// ---------------------------------------------------------------------------------------------------------
// The measure on the finished plan.

export interface ShareShot {
  start: number;
  end: number;
  segment: number;
  media: { type: string; index: number; entry?: number };
}

/**
 * Moving footage as a share of the narrated time in game chapters (the beats of entries with a game), from a
 * built plan: clip shots count, stills, plates and filler visuals do not. Per chapter as well, by entry.
 */
export function footageShare(
  shots: ShareShot[],
  fps: number,
  chapterOf: (segment: number) => number | undefined,
  stockClip: (index: number) => boolean = () => false,
): {
  share: number;
  seconds: number;
  footage: number;
  stock: number;
  perChapter: Map<number, number>;
} {
  let seconds = 0;
  let footage = 0;
  let stock = 0;
  const per = new Map<number, { all: number; moving: number }>();
  for (const s of shots) {
    const c = chapterOf(s.segment);
    if (c === undefined) continue;
    const len = (s.end - s.start) / fps;
    seconds += len;
    const p = per.get(c) ?? { all: 0, moving: 0 };
    p.all += len;
    if (s.media.type === "clip") {
      // Stock is moving but not the game: counted apart, not as footage of the game's world.
      if (stockClip(s.media.index)) stock += len;
      else {
        footage += len;
        p.moving += len;
      }
    }
    per.set(c, p);
  }
  return {
    share: seconds ? footage / seconds : 0,
    seconds,
    footage,
    stock,
    perChapter: new Map(
      [...per].map(([c, p]) => [c, p.all ? p.moving / p.all : 0]),
    ),
  };
}

// ---------------------------------------------------------------------------------------------------------
// The pass itself, with every outside call injected so the flow is tested without a network or a GPU.

export interface SourceHit {
  videoId: string;
  title: string;
  channel: string;
}
export interface SourceDetails {
  license: string;
  seconds: number;
  title: string;
  channel: string;
}

export interface FootageFirstDeps {
  /** YouTube's search page with the Creative Commons filter (no quota). */
  search(query: string): Promise<SourceHit[]>;
  /** The licence and length read from the video itself (yt-dlp, no quota). */
  details(videoId: string): Promise<SourceDetails | undefined>;
  /** Optional title check by a model (the existing judgeGameplay, low tier): indices to keep. */
  judge?(
    game: string,
    year: number | undefined,
    items: SourceHit[],
  ): Promise<number[]>;
  /** Downloads [from, to] of a video into dest; returns bytes written. */
  download(
    url: string,
    from: number,
    to: number,
    dest: string,
  ): Promise<number>;
  /** Per-frame brightness and scene score of a file (ffmpeg). */
  scan(
    file: string,
  ): Promise<
    Array<{ time: number; luma: number; motion: number; scene?: number }>
  >;
  /** Frames across [at, at+seconds] of a file, about one a second and at least three, as jpegs named from prefix. */
  frames(file: string, at: number, seconds: number, prefix: string): Promise<string[]>;
  /** One image of these frames side by side. */
  compose(files: string[], dest: string): Promise<void>;
  /** Greyscale thumbnails (BORDER_W x BORDER_H, row by row) of frames, for the filmed-screen check; absent, not checked. */
  grays?(files: string[]): Promise<Uint8Array[]>;
  /** True when a frame has black bars over a third of its height (a cutscene); absent, not checked. */
  bars?(file: string): Promise<boolean>;
  /** A frame's difference hash (dHash), or undefined. */
  hash(file: string): Promise<string | undefined>;
  /** The words the Windows OCR reads in each frame (empty where there is no OCR). */
  ocr(files: string[]): Promise<Map<string, { width: number; height: number; words: Array<{ text: string; x: number; y: number; w: number; h: number }> }>>;
  /** The local model's look at each frame. */
  look(files: string[]): Promise<Array<SegmentLook | undefined>>;
  /** Cuts [at, at+seconds] of a file into dest; returns the real length, or undefined when it failed or went dark. */
  cut(
    file: string,
    at: number,
    seconds: number,
    dest: string,
  ): Promise<number | undefined>;
  /** A GPU turn from the PC orchestrator around the looks; absent, none is taken. */
  lease?(job: string, estMinutes: number): Promise<() => void>;
  now?: () => number;
}

export interface FootageChapter {
  entry: number;
  game: string;
  franchise: string;
  year?: number;
  moments: Array<{
    show: string;
    person?: string;
    broll?: string;
    keywords?: string[];
  }>;
  sentences: string[];
}

export interface FootageClip {
  file: string;
  sourceUrl: string;
  provenance: string;
  durationSeconds: number;
  beatIndex: number;
  moment?: number;
  credit: string;
  label: string;
  startSeconds: number;
  motion: number;
  /** Where in its source video the clip comes from, so no two shots of one chapter repeat a moment. */
  span: { source: string; from: number; to: number };
}

export interface FootageReport {
  chapters: number;
  skipped: Array<{ entry: number; game: string; why: string }>;
  searches: number;
  sourcesSeen: number;
  sourcesRejected: Array<{
    entry: number;
    title: string;
    channel: string;
    why: string;
  }>;
  downloads: number;
  downloadedMb: number;
  segments: number;
  looked: number;
  segmentsRejected: Array<{
    entry: number;
    source: string;
    at: number;
    why: string;
    frame?: string;
    label?: string;
  }>;
  kept: number;
  pinned: number;
  keptSeconds: number;
  keptMb: number;
  modelCalls: number;
  minutes: number;
  stoppedEarly?: string;
  /** Seconds spent in each outside call (summed: the three downloads at a time overlap). */
  phases?: Record<string, number>;
  /** Each gathered chapter: its minutes, clips kept and seconds kept. */
  perChapter?: Array<{ entry: number; minutes: number; kept: number; seconds: number }>;
}

export function emptyReport(): FootageReport {
  return {
    chapters: 0,
    skipped: [],
    searches: 0,
    sourcesSeen: 0,
    sourcesRejected: [],
    downloads: 0,
    downloadedMb: 0,
    segments: 0,
    looked: 0,
    segmentsRejected: [],
    kept: 0,
    pinned: 0,
    keptSeconds: 0,
    keptMb: 0,
    modelCalls: 0,
    minutes: 0,
  };
}

/** The sentences of a chapter that want game footage: not a person's, not real-world B-roll, none of their own yet. */
export function footageWants(
  ch: FootageChapter,
  clips: Array<{ beatIndex?: number; moment?: number; stock?: boolean }>,
): Want[] {
  const have = new Set(
    clips
      .filter(
        (c) => c.beatIndex === ch.entry && c.moment !== undefined && !c.stock,
      )
      .map((c) => c.moment!),
  );
  return ch.moments.flatMap((m, k) =>
    m.broll?.trim() || m.person?.trim() || have.has(k)
      ? []
      : [
          {
            moment: k,
            text: `${ch.sentences[k] ?? ""} ${m.show} ${(m.keywords ?? []).join(" ")}`,
          },
        ],
  );
}

/** Search phrasings for one game: plain gameplay first, then the forms uploaders use for whole playthroughs. */
export function footageQueries(game: string, year?: number): string[] {
  const g = game.replace(/[:®™]/g, " ").replace(/\s+/g, " ").trim();
  return [
    `${g} gameplay`,
    `${g} gameplay no commentary`,
    `${g} walkthrough`,
    `${g}${year ? ` ${year}` : ""} full game`,
  ];
}

/** A chapter's sources, downloaded and scanned, ready for the looks. */
type Picked = SourceHit &
  SourceDetails & { url: string; file: string; from: number; to: number };
export interface Prefetched {
  need: number;
  work: string;
  sources: Picked[];
  scans: Map<Picked, Array<{ time: number; luma: number; motion: number; scene?: number }>>;
}

type Have = Array<{
  beatIndex?: number;
  moment?: number;
  stock?: boolean;
  sourceUrl?: string;
  durationSeconds?: number;
}>;

/**
 * One chapter's footage-first gather into `dir` (the chapter's folder): new CC BY clips appended to `out`, with
 * every count added to `report`. Never throws: a failure leaves the chapter with what it had.
 */
export async function gatherChapterFootage(
  deps: FootageFirstDeps,
  ch: FootageChapter,
  clips: Have,
  dir: string,
  relDir: string,
  chapterSeconds: number,
  o: FootageFirstOptions,
  report: FootageReport,
  out: FootageClip[],
  deadline: number,
  keepFrames?: string,
): Promise<void> {
  const pre = await prefetchChapter(deps, ch, clips, dir, chapterSeconds, o, report, deadline);
  if (pre) await finishChapter(deps, ch, clips, relDir, dir, o, report, out, deadline, pre, keepFrames);
}

/**
 * The first half: the skip checks, the search, the title and licence checks, the downloads and their scans.
 * Undefined when the chapter is skipped or nothing could be downloaded (its work folder is then gone).
 */
export async function prefetchChapter(
  deps: FootageFirstDeps,
  ch: FootageChapter,
  clips: Have,
  dir: string,
  chapterSeconds: number,
  o: FootageFirstOptions,
  report: FootageReport,
  deadline: number,
): Promise<Prefetched | undefined> {
  const now = deps.now ?? Date.now;
  const skip = (why: string) => {
    report.skipped.push({ entry: ch.entry, game: ch.game, why });
    log("info", "footage-first: chapter skipped", { game: ch.game, why });
  };
  if (notOutYet(ch.year)) {
    skip("the game is not out: uploaded gameplay of it can only be fake");
    return undefined;
  }
  const mine = clips.filter((c) => c.beatIndex === ch.entry && !c.stock);
  const haveSeconds = mine.reduce((n, c) => n + (c.durationSeconds ?? 4), 0);
  const need = footageNeed(chapterSeconds, haveSeconds, o.sharePct);
  if (need < 10) {
    skip(`already has ${Math.round(haveSeconds)} s of footage`);
    return undefined;
  }
  report.chapters++;
  const work = path.join(dir, "ff_work");
  await fs.mkdir(work, { recursive: true });
  try {
    // 1. Sources: search, refuse junk by title and channel, confirm the licence on the video itself.
    const used = new Set(mine.map((c) => c.sourceUrl).filter(Boolean));
    const seen = new Set<string>();
    const hits: SourceHit[] = [];
    for (const q of footageQueries(ch.game, ch.year)) {
      if (now() > deadline) break;
      report.searches++;
      for (const h of await deps.search(q).catch(() => [] as SourceHit[])) {
        if (seen.has(h.videoId)) continue;
        seen.add(h.videoId);
        report.sourcesSeen++;
        const why = used.has(`https://www.youtube.com/watch?v=${h.videoId}`)
          ? "already used by this chapter"
          : junkSourceReason(
              h.title,
              h.channel,
              ch.game,
              ch.franchise,
              ch.year,
            );
        if (why)
          report.sourcesRejected.push({
            entry: ch.entry,
            title: h.title,
            channel: h.channel,
            why,
          });
        else hits.push(h);
      }
    }
    let kept = hits;
    if (deps.judge && hits.length) {
      report.modelCalls++;
      const keep = new Set(
        await deps
          .judge(ch.game, ch.year, hits)
          .catch(() => hits.map((_, i) => i)),
      );
      kept = hits.filter((h, i) => {
        if (keep.has(i)) return true;
        report.sourcesRejected.push({
          entry: ch.entry,
          title: h.title,
          channel: h.channel,
          why: "the title check says it is not this game",
        });
        return false;
      });
    }
    // One video per channel first, so one uploader's habits (an overlay, a mod) cannot fill the chapter.
    const ordered = roundRobin(kept, (h) => h.channel);
    const picked: Picked[] = [];
    for (const h of ordered) {
      if (picked.length >= o.sources || now() > deadline) break;
      const d = await deps.details(h.videoId).catch(() => undefined);
      if (!d) continue;
      if (!ccBy(d.license)) {
        report.sourcesRejected.push({
          entry: ch.entry,
          title: h.title,
          channel: h.channel,
          why: `licence is "${d.license || "standard YouTube"}", not CC BY`,
        });
        continue;
      }
      if (d.seconds < 90) {
        report.sourcesRejected.push({
          entry: ch.entry,
          title: h.title,
          channel: h.channel,
          why: "under 90 seconds",
        });
        continue;
      }
      const win = pullWindow(d.seconds, picked.length, o.pullSeconds);
      picked.push({
        ...h,
        ...d,
        title: h.title,
        channel: d.channel || h.channel,
        url: `https://www.youtube.com/watch?v=${h.videoId}`,
        file: path.join(work, `src_${picked.length}.mp4`),
        from: win.from,
        to: win.to,
      });
    }
    // All six windows at once: one section download runs at under twice real time however fast the line is
    // (31 Oct 2026 proof: 4 min for 7 min of 720p), so one after the other a chapter's six took 24 minutes.
    const fetched = new Set<Picked>();
    // Each window is scanned for its edits as soon as it lands, while the others still download.
    const scans: Prefetched["scans"] = new Map();
    let next = 0;
    const worker = async () => {
      while (next < picked.length) {
        const p = picked[next++]!;
        try {
          const bytes = await deps.download(p.url, p.from, p.to, p.file);
          report.downloads++;
          report.downloadedMb += bytes / 1e6;
          fetched.add(p);
          scans.set(p, await deps.scan(p.file).catch(() => []));
        } catch (err) {
          log("warn", "footage-first: download failed", {
            video: p.videoId,
            error: errorMessage(err).split(/\r?\n/).pop(),
          });
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(DOWNLOADS_AT_ONCE, picked.length) },
        worker,
      ),
    );
    const sources = picked.filter((p) => fetched.has(p));
    if (sources.length) return { need, work, sources, scans };
  } catch (err) {
    log("warn", "footage-first: chapter failed", { game: ch.game, error: errorMessage(err) });
  }
  await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  return undefined;
}

/** The second half: segments, the cheap tests and the looks, the pins, the cuts; the work folder is removed. */
export async function finishChapter(
  deps: FootageFirstDeps,
  ch: FootageChapter,
  clips: Have,
  relDir: string,
  dir: string,
  o: FootageFirstOptions,
  report: FootageReport,
  out: FootageClip[],
  deadline: number,
  pre: Prefetched,
  keepFrames?: string,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const { need, work, sources, scans } = pre;
  try {
    // 2. Segments: each window cut at its own edits.
    const all: Array<{
      id: number;
      src: number;
      at: number;
      len: number;
      motion: number;
      frame: string;
    }> = [];
    for (const [i, s] of sources.entries()) {
      const rows = scans.get(s) ?? [];
      const total = rows.at(-1)?.time ?? 0;
      for (const g of segmentsOf(rows, total))
        all.push({
          id: all.length,
          src: i,
          at: g.from,
          len: g.len,
          motion: g.motion,
          frame: path.join(work, `seg_${all.length}.jpg`),
        });
    }
    report.segments += all.length;
    // 3. The look, in rounds: an even spread of the segments not yet looked at, sized to what is still
    // missing, until the clean ones could fill the need with room to spare or the frame cap is reached. Only a
    // third or so pass (31 Oct 2026 proof: subtitles, prompts and district names on screen), so one round sized
    // for the need left the Vice City chapter short.
    const release = deps.lease
      ? await deps
          .lease(
            "Pulse footage-first: labelling gameplay segments",
            Math.ceil(Math.min(o.visionMax, all.length) / 10) + 1,
          )
          .catch(() => undefined)
      : undefined;
    const verdicts: Array<{
      g: (typeof all)[number];
      look: SegmentLook | undefined;
      reason: string | undefined;
      source: string;
    }> = [];
    try {
      const looked = new Set<number>();
      // Middle-frame hashes of each video's segments already sent to the model.
      const seenHash = new Map<number, string[]>();
      let modelLooks = 0;
      let clean = 0;
      while (modelLooks < o.visionMax && clean < need * 1.25 && now() <= deadline) {
        // A video whose segments keep failing (subtitles on every line, a streamer's overlay) is not worth more
        // looks: the rounds go to the videos that pass (31 Oct 2026: text refused 288 of 347 segments).
        const poor = poorSources(verdicts.map((v) => ({ source: v.g.src, ok: !v.reason })));
        const left = all.filter((g) => !looked.has(g.id) && !poor.has(g.src));
        const size = Math.min(
          o.visionMax - modelLooks,
          Math.max(8, Math.ceil(((need * 1.25 - clean) / 5) * 3)),
          // No round runs far past the chapter's time: one could take six minutes (31 Oct 2026 proof).
          Math.max(4, Math.floor((deadline - now()) / (LOOK_SECONDS * 1000))),
        );
        const round = spread(left, size);
        if (!round.length) break;
        const refuse = (g: (typeof all)[number], reason: string) =>
          verdicts.push({ g, look: undefined, reason, source: sources[g.src]!.url });
        // The cheap tests first, on this PC's CPU: a frozen picture, frames across the segment, a picture the
        // video already showed, words the Windows OCR can read.
        const pending: Array<{ g: (typeof all)[number]; frames: string[] }> = [];
        for (const g of round) {
          looked.add(g.id);
          if (g.motion < FROZEN_MOTION) {
            refuse(g, "frozen picture");
            continue;
          }
          const frames = await deps
            .frames(sources[g.src]!.file, g.at, g.len, g.frame.replace(/\.jpg$/, ""))
            .catch(() => [] as string[]);
          if (frames.length < 3) {
            refuse(g, "no frames");
            continue;
          }
          const middle = frames[Math.floor(frames.length / 2)]!;
          const thumbs = deps.grays
            ? await deps.grays([frames[0]!, middle, frames[frames.length - 1]!]).catch(() => [])
            : [];
          if (filmedScreen(thumbs)) {
            refuse(g, FILMED);
            continue;
          }
          if (await deps.bars?.(middle).catch(() => false)) {
            refuse(g, "letterboxed");
            continue;
          }
          const h = await deps.hash(middle).catch(() => undefined);
          const same = seenHash.get(g.src) ?? [];
          if (h && same.some((x) => hamming(x, h) <= SAME_PICTURE_BITS)) {
            refuse(g, "same picture as another segment");
            continue;
          }
          if (h) seenHash.set(g.src, [...same, h]);
          pending.push({ g, frames });
        }
        const pages = await deps.ocr(pending.flatMap((x) => x.frames)).catch(() => new Map());
        const ask: typeof pending = [];
        for (const x of pending)
          if (x.frames.some((f) => captionWords(pages.get(f)) >= 2)) refuse(x.g, "text on screen (read)");
          else ask.push(x);
        // One look a segment: its first, middle and last frames side by side (31 Oct 2026: two separate looks a
        // segment cost 44 of a 64-minute run, and the middle frame alone missed banners that came and went).
        for (const x of ask) {
          const f = x.frames;
          await deps
            .compose([f[0]!, f[Math.floor(f.length / 2)]!, f[f.length - 1]!], x.g.frame)
            .catch(() => undefined);
        }
        const looks = ask.length ? await deps.look(ask.map((x) => x.g.frame)) : [];
        modelLooks += ask.length;
        report.looked += looks.filter(Boolean).length;
        for (const [i, x] of ask.entries()) {
          const reason = segmentRejectReason(looks[i]);
          verdicts.push({ g: x.g, look: looks[i], reason, source: sources[x.g.src]!.url });
          if (!reason) clean += x.g.len;
        }
        // Nothing could be looked at (the local model is down): another round would see nothing either.
        if (ask.length && looks.every((l) => !l)) break;
      }
    } finally {
      release?.();
    }
    const condemned = condemnedSources(verdicts);
    const good: Array<{ g: (typeof all)[number]; label: string }> = [];
    for (const v of verdicts) {
      const why =
        condemned.has(v.source) && !v.reason
          ? "its video is mostly mods or facecams"
          : v.reason;
      if (why) {
        let frame: string | undefined;
        if (keepFrames && why !== "not looked at") {
          frame = path.join(
            keepFrames,
            `reject_e${ch.entry}_${report.segmentsRejected.length}.jpg`,
          );
          await fs.mkdir(keepFrames, { recursive: true });
          await fs.copyFile(v.g.frame, frame).catch(() => (frame = undefined));
        }
        report.segmentsRejected.push({
          entry: ch.entry,
          source: sources[v.g.src]!.title,
          at: Math.round(sources[v.g.src]!.from + v.g.at),
          why,
          frame,
          label: v.look?.label,
        });
      } else good.push({ g: v.g, label: v.look!.label });
    }
    if (!good.length) return;
    // 4. Pinned where a label shares the sentence's words; the rest by need, spread across the videos.
    const pins = assignSegments(
      footageWants(ch, clips),
      good.map(({ g, label }) => ({
        id: g.id,
        source: sources[g.src]!.url,
        label,
        len: g.len,
      })),
      [ch.game, ch.franchise],
      o.perSentence,
    );
    // The rest in turns from each video, so the chapter's loose footage is not all one uploader's.
    const loose = roundRobin(
      good.filter(({ g }) => !pins.has(g.id)),
      (x) => x.g.src,
    );
    const chosen = [...good.filter(({ g }) => pins.has(g.id)), ...loose];
    let added = 0;
    const before = out.length;
    for (const { g, label } of chosen) {
      if (added >= need && !pins.has(g.id)) continue;
      const s = sources[g.src]!;
      const name = `ff_${ch.entry}_${out.length}.mp4`;
      const dest = path.join(dir, "assets", name);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const len = await deps
        .cut(s.file, g.at, g.len, dest)
        .catch(() => undefined);
      if (!len || len < SEGMENT_MIN_SECONDS - 0.1) {
        report.segmentsRejected.push({
          entry: ch.entry,
          source: s.title,
          at: Math.round(s.from + g.at),
          why: "went dark or failed to cut",
          label,
        });
        continue;
      }
      const abs = s.from + g.at;
      const moment = pins.get(g.id);
      out.push({
        file: path.join(relDir, "assets", name),
        sourceUrl: s.url,
        provenance: `Gameplay "${s.title.slice(0, 80)}" by ${s.channel}, Creative Commons Attribution licence (CC BY) (${s.url}), ${len.toFixed(1)}s at ${abs.toFixed(1)}s of the video, muted; footage-first segment: ${label}`,
        durationSeconds: Math.min(len, SEGMENT_MAX_SECONDS + 1),
        beatIndex: ch.entry,
        moment,
        credit: gameplayCredit({ channelTitle: s.channel, kind: "cc" }),
        label,
        startSeconds: abs,
        motion: 0.5,
        span: { source: s.url, from: abs, to: abs + len },
      });
      report.kept++;
      report.keptSeconds += len;
      report.keptMb +=
        ((await fs.stat(dest).catch(() => ({ size: 0 }))).size as number) / 1e6;
      if (moment !== undefined) report.pinned++;
      added += len;
    }
    log("info", "footage-first: chapter gathered", {
      game: ch.game,
      sources: sources.length,
      segments: all.length,
      looked: verdicts.length,
      kept: out.length - before,
      seconds: Math.round(added),
    });
  } catch (err) {
    log("warn", "footage-first: chapter failed", {
      game: ch.game,
      error: errorMessage(err),
    });
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The same calls, each one's seconds added to `phases` under its name, so a slow step shows in the report. */
export function timedDeps(
  deps: FootageFirstDeps,
  phases: Record<string, number>,
  now: () => number = Date.now,
): FootageFirstDeps {
  const out: Record<string, unknown> = { ...deps };
  for (const [k, f] of Object.entries(deps))
    if (typeof f === "function" && k !== "now" && k !== "lease")
      out[k] = async (...args: unknown[]) => {
        const t = now();
        try {
          return await (f as (...a: unknown[]) => Promise<unknown>)(...args);
        } finally {
          phases[k] = Math.round(((phases[k] ?? 0) + (now() - t) / 1000) * 10) / 10;
        }
      };
  return out as unknown as FootageFirstDeps;
}

/** Every game chapter of a long video in turn, within the pass's time limit. */
export async function gatherFootageFirst(
  deps: FootageFirstDeps,
  chapters: Array<FootageChapter & { seconds: number }>,
  clips: Parameters<typeof gatherChapterFootage>[2],
  episodeDir: string,
  o: FootageFirstOptions,
  keepFrames?: string,
): Promise<{ clips: FootageClip[]; report: FootageReport }> {
  const now = deps.now ?? Date.now;
  const started = now();
  const deadline =
    o.maxMinutes > 0
      ? started + o.maxMinutes * 60_000
      : Number.POSITIVE_INFINITY;
  const report = emptyReport();
  const out: FootageClip[] = [];
  deps = timedDeps(deps, (report.phases = {}), now);
  // The next chapter's search and downloads run while this one is looked at on the GPU: the network and the
  // model are each busy all the time (31 Oct 2026 proof: downloads were a third of a chapter's minutes).
  const prefetch = (k: number) => {
    const ch = chapters[k];
    if (!ch || now() > deadline) return Promise.resolve(undefined);
    return prefetchChapter(deps, ch, clips, path.join(episodeDir, `entry_${ch.entry}`), ch.seconds, o, report, deadline);
  };
  let ahead = prefetch(0);
  let started0 = now();
  for (const [k, ch] of chapters.entries()) {
    const pre = await ahead;
    if (now() > deadline) {
      report.stoppedEarly = `its ${o.maxMinutes}-minute limit (FOOTAGE_FIRST_MAX_MINUTES) ran out`;
      if (pre) await fs.rm(pre.work, { recursive: true, force: true }).catch(() => undefined);
      break;
    }
    ahead = prefetch(k + 1);
    const rel = `entry_${ch.entry}`;
    const k0 = out.length;
    // Every released chapter gets its share of the time left: the first ones took 10-12 minutes each and the
    // limit ran out with three chapters untouched (31 Oct 2026 proof).
    const own = fairDeadline(now(), deadline, chapters.slice(k).filter((c) => !notOutYet(c.year)).length);
    if (pre) await finishChapter(deps, ch, clips, rel, path.join(episodeDir, rel), o, report, out, own, pre, keepFrames);
    if (!report.skipped.some((x) => x.entry === ch.entry))
      (report.perChapter ??= []).push({
        entry: ch.entry,
        // From when this chapter's own work began to the end of its looks (its download overlapped the last one).
        minutes: Math.round((now() - started0) / 6_000) / 10,
        kept: out.length - k0,
        seconds: Math.round(out.slice(k0).reduce((n, c) => n + c.durationSeconds, 0)),
      });
    started0 = now();
  }
  // A download left running past the limit: its folder goes too.
  const left = await ahead;
  if (left && report.stoppedEarly) await fs.rm(left.work, { recursive: true, force: true }).catch(() => undefined);
  report.minutes = Math.round((now() - started) / 6_000) / 10;
  report.downloadedMb = Math.round(report.downloadedMb);
  report.keptMb = Math.round(report.keptMb);
  report.keptSeconds = Math.round(report.keptSeconds);
  return { clips: out, report };
}

/** The owner's line for Discord: what was gathered, what was refused and why, what it cost. */
export function footageNotice(
  headline: string,
  r: FootageReport,
  share?: { before?: number; after: number; target: number },
): string {
  const why = new Map<string, number>();
  for (const x of [...r.sourcesRejected, ...r.segmentsRejected])
    why.set(x.why, (why.get(x.why) ?? 0) + 1);
  const top = [...why]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([w, n]) => `${n} ${w}`)
    .join(", ");
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const shareLine = share
    ? ` Moving game footage now fills ${pct(share.after)} of the narrated game chapters${share.before !== undefined ? ` (was ${pct(share.before)})` : ""}; target ${share.target}% (FOOTAGE_SHARE_TARGET).`
    : "";
  const skipped = r.skipped
    .filter((s) => /not out/.test(s.why))
    .map((s) => s.game);
  return `🎮 "${headline}": footage first. ${r.kept} new Creative Commons gameplay clips (${r.keptSeconds}s, ${r.pinned} on the sentence they show) from ${r.downloads} videos; refused ${r.sourcesRejected.length} videos and ${r.segmentsRejected.length} segments${top ? ` (${top})` : ""}.${shareLine}${skipped.length ? ` No uploaded gameplay for ${skipped.join(", ")}: not out yet, so it can only be fake.` : ""} Cost: ${r.downloadedMb} MB downloaded, ${r.looked} frames checked on this PC, ${r.modelCalls} Claude calls, ${r.minutes} min. Each clip is credited on screen (CC BY). Setting: FOOTAGE_FIRST.${r.stoppedEarly ? ` Stopped early: ${r.stoppedEarly}.` : ""}`;
}
