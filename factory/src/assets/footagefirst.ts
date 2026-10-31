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
  pullSeconds: 420,
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

/** Source windows downloaded at the same time. */
export const DOWNLOADS_AT_ONCE = 3;

/** The shortest segment worth a shot (the planner's shortest clip shot is 1.3 s; a line needs more). */
export const SEGMENT_MIN_SECONDS = 2.4;
/** The longest piece one unbroken take is cut into: a long drive becomes several shots, not one. */
export const SEGMENT_MAX_SECONDS = 7;
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
  rows: Array<{ time: number; luma: number; scene?: number }>,
  totalSeconds: number,
  min = SEGMENT_MIN_SECONDS,
  max = SEGMENT_MAX_SECONDS,
  darkLuma = 30,
): Array<{ from: number; len: number }> {
  const jumps = clipJumps(rows);
  const edges = [0, ...jumps, totalSeconds];
  const out: Array<{ from: number; len: number }> = [];
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
      const all = rows.filter(
        (r) => r.time >= at && r.time <= at + take,
      ).length;
      if (!all || dark / all < 0.1)
        out.push({ from: round(at), len: round(take) });
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
export function condemnedSources(
  verdicts: Array<{ source: string; reason?: string }>,
  share = 0.25,
): Set<string> {
  const by = new Map<string, { bad: number; all: number }>();
  for (const v of verdicts) {
    if (v.reason === "not looked at") continue;
    const m = by.get(v.source) ?? { bad: 0, all: 0 };
    m.all++;
    if (
      v.reason === "mod or kids' content" ||
      v.reason === "facecam or overlay"
    )
      m.bad++;
    by.set(v.source, m);
  }
  return new Set(
    [...by]
      .filter(([, m]) => m.bad >= Math.max(2, m.all * share))
      .map(([s]) => s),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Matching segments to sentences.

const MATCH_STOP = new Set(
  "the a an of and in on to for with at by from is it its this that was were are be been his her their they you your into over under out up down off as or not no but so then than there here which who what when where while game games player players gameplay footage video shot shows showing scene frame view city world".split(
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
  /** One frame of a file at a time, as a jpeg. */
  frame(file: string, at: number, dest: string): Promise<void>;
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

/**
 * One chapter's footage-first gather into `dir` (the chapter's folder): new CC BY clips appended to `out`, with
 * every count added to `report`. Never throws: a failure leaves the chapter with what it had.
 */
export async function gatherChapterFootage(
  deps: FootageFirstDeps,
  ch: FootageChapter,
  clips: Array<{
    beatIndex?: number;
    moment?: number;
    stock?: boolean;
    sourceUrl?: string;
    durationSeconds?: number;
  }>,
  dir: string,
  relDir: string,
  chapterSeconds: number,
  o: FootageFirstOptions,
  report: FootageReport,
  out: FootageClip[],
  deadline: number,
  keepFrames?: string,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const skip = (why: string) => {
    report.skipped.push({ entry: ch.entry, game: ch.game, why });
    log("info", "footage-first: chapter skipped", { game: ch.game, why });
  };
  if (notOutYet(ch.year))
    return skip(
      "the game is not out: uploaded gameplay of it can only be fake",
    );
  const mine = clips.filter((c) => c.beatIndex === ch.entry && !c.stock);
  const haveSeconds = mine.reduce((n, c) => n + (c.durationSeconds ?? 4), 0);
  const need = footageNeed(chapterSeconds, haveSeconds, o.sharePct);
  if (need < 10)
    return skip(`already has ${Math.round(haveSeconds)} s of footage`);
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
    type Picked = SourceHit &
      SourceDetails & { url: string; file: string; from: number; to: number };
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
    // Three windows at a time: one section download runs at about real time (31 Oct 2026 proof: 4 min for 7 min
    // of 720p), so one after the other a chapter's six took 24 minutes.
    const fetched = new Set<Picked>();
    let next = 0;
    const worker = async () => {
      while (next < picked.length) {
        const p = picked[next++]!;
        try {
          const bytes = await deps.download(p.url, p.from, p.to, p.file);
          report.downloads++;
          report.downloadedMb += bytes / 1e6;
          fetched.add(p);
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
    if (!sources.length) return;
    // 2. Segments: each window cut at its own edits.
    const all: Array<{
      id: number;
      src: number;
      at: number;
      len: number;
      frame: string;
    }> = [];
    for (const [i, s] of sources.entries()) {
      const rows = await deps.scan(s.file).catch(() => []);
      const total = rows.at(-1)?.time ?? 0;
      for (const g of segmentsOf(rows, total))
        all.push({
          id: all.length,
          src: i,
          at: g.from,
          len: g.len,
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
      let clean = 0;
      while (
        looked.size < Math.min(o.visionMax, all.length) &&
        clean < need * 1.25
      ) {
        const left = all.filter((g) => !looked.has(g.id));
        const size = Math.min(
          o.visionMax - looked.size,
          Math.max(8, Math.ceil(((need * 1.25 - clean) / 5) * 3)),
        );
        const round = spread(left, size);
        if (!round.length) break;
        // Two frames a segment, a quarter and three quarters in: one in the middle missed a "Mission passed"
        // banner, a kill counter and a vehicle name that came and went around it (31 Oct 2026 proof).
        const late = (f: string) => f.replace(/\.jpg$/, "_b.jpg");
        for (const g of round) {
          looked.add(g.id);
          for (const [f, at] of [
            [g.frame, g.at + g.len * 0.25],
            [late(g.frame), g.at + g.len * 0.75],
          ] as const)
            await deps
              .frame(sources[g.src]!.file, at, f)
              .catch(() => undefined);
        }
        const looks = await deps.look(
          round.flatMap((g) => [g.frame, late(g.frame)]),
        );
        report.looked += looks.filter(Boolean).length;
        for (const [i, g] of round.entries()) {
          const [a, b] = [looks[2 * i], looks[2 * i + 1]];
          const reason = segmentRejectReason(a) ?? segmentRejectReason(b);
          verdicts.push({
            g,
            look: a?.label ? a : (b ?? a),
            reason,
            source: sources[g.src]!.url,
          });
          if (!reason) clean += g.len;
        }
        // Nothing could be looked at (the local model is down): another round would see nothing either.
        if (looks.every((l) => !l)) break;
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
  for (const ch of chapters) {
    if (now() > deadline) {
      report.stoppedEarly = `its ${o.maxMinutes}-minute limit (FOOTAGE_FIRST_MAX_MINUTES) ran out`;
      break;
    }
    const rel = `entry_${ch.entry}`;
    await gatherChapterFootage(
      deps,
      ch,
      clips,
      path.join(episodeDir, rel),
      rel,
      ch.seconds,
      o,
      report,
      out,
      deadline,
      keepFrames,
    );
  }
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
