// The long videos' craft on the Shorts (owner, 31 Oct 2026), brought over only where it suits a 35-50 s
// vertical at a Short's pace. The Short's own strengths come first and are never touched: the hook and its
// poster, the word-level captions and cards, the word moment and the loop back to the opening frame. Four
// optional layers, each behind its own setting (src/config.ts SHORT_CRAFT_*), each decided here, in Node, by
// pure functions, stored on the plan (`plan.craft`) so a retried render is identical:
//
// 1. cards: each beat's card rotates between the house card, the Numbers and Words packs and the Pulse
//    universe (components/vertical/VPulse.tsx: the era-true phone story, posts, mail and chat when the credit
//    names the medium, the calendar, the store, a console, an old report's TV bulletin or magazine cover, the
//    platforms panel). Never one look twice in a row, at most one full-width Pulse device a Short (it covers
//    the footage), and a memory across Shorts (the settings row `recent_short_craft`, as wordlook.ts keeps
//    `recent_word_looks`) so the channel's last Shorts are not repeated.
// 2. photos: a real-world photo shot of two seconds or more lands as an instant print, taped to a wall,
//    pinned to an evidence board or (a press photo) as newsprint: the four long-form treatments that settle
//    inside a second. At most two a Short, never the same twice running.
// 3. fillers: a line the media-richness measure (src/qa/mediarich.ts) finds bare (no card, nothing chosen for
//    its own words) gets, in order, kinetic type of its key words, a drawn scene or silhouette, or a document,
//    for under three seconds. Never the hook (its poster is the thumbnail) or the loop (it must return to the
//    opening frame). At most two a Short, never the same family twice.
// 4. camera: a push through a cut or a freeze-frame on the word a line is about, at most three moves in a
//    40 s Short, six seconds apart, never under a card, a filler, a word moment or a treated photo.
//
// Left out as unsuited to Shorts: whip pans, rack focus and vertigo dollies, lens and boil textures, two-stage
// Ken Burns, explainer diagrams and in-game reconstructions (a Short has no reconstruction clips and no time
// for a two-stage move), the slow photo treatments (darkroom, camera print, film strip, projector, album,
// scanner, magnifier, folder, light box, drying line) and the long-form packs whose key content lands after
// about three seconds even when joined part-way.

import type { Db } from "../db.ts";
import type { Segment } from "./timeline.ts";
import type { RenderPlan } from "./plan.ts";
import { keyTime } from "./longplan.ts";
import { V_STYLES } from "./components/vertical/index.ts";
import type { VGfxProps } from "./components/vertical/types.ts";
import { storyYearOf } from "./components/vertical/pulse/map.ts";
import { eligible, pressCredit, type PhotoTreatment } from "./photoplan.ts";
import { kineticFor, type KineticData } from "./components/kinetic/choose.ts";
import {
  keyWords,
  wordsIn,
  wordTimes,
  displayWord,
} from "./components/kinetic/words.ts";
import { objectsFor, silhouetteFor } from "./components/objects/choose.ts";
import { documentFor, type DocScene } from "./components/docs/choose.ts";

export const RECENT_CRAFT_KEY = "recent_short_craft";
/** How many looks the channel remembers across Shorts. */
export const RECENT_CRAFT_KEEP = 24;
/** The house fact card (components/Overlays.tsx FactCard) as a look in the rotation. */
export const HOUSE = "House";
/** The photo treatments that settle inside a second, fit for a Short. */
export const SHORT_PHOTO_TREATMENTS: readonly PhotoTreatment[] = [
  "instantDrop",
  "ductTape",
  "evidenceBoard",
  "newsprint",
];
export const PHOTO_MIN_FRAMES = 60;
export const MAX_PHOTOS = 2;
export const MAX_FILLERS = 2;
export const FILLER_MAX_FRAMES = 84;
export const FILLER_MIN_FRAMES = 45;
/** Camera moves: at most this many in a 40 s Short (scaled by length, never more), this far apart. */
export const MOVES_PER_40S = 3;
export const MOVE_GAP_FRAMES = 180;
export const SHORT_TRACK_FRAMES = 8;
export const SHORT_FREEZE_HOLD = 36;
export const SHORT_FREEZE_LEAD = 15;
/** Frames the word moment (components/Stamp.tsx STAMP_FRAMES) holds. */
const STAMP_HOLD = 51;

export type RecentCraft = { look: string; day: string };

export interface CraftCard {
  segment: number;
  /** "House" or a V_STYLES key ("Words/Alert", "Pulse/Phone"). */
  look: string;
}
export interface CraftPhoto {
  shot: number;
  treatment: PhotoTreatment;
  seed: number;
}
export type CraftFiller =
  | {
      segment: number;
      from: number;
      len: number;
      family: "kinetic";
      style: string;
      data: KineticData;
      times: number[];
    }
  | {
      segment: number;
      from: number;
      len: number;
      family: "objects" | "silhouettes";
      style: string;
      year?: number;
      month?: string;
    }
  | {
      segment: number;
      from: number;
      len: number;
      family: "document";
      style: string;
      scene: DocScene;
      words: Array<{ text: string; start: number; end: number }>;
    };
export type CraftMove =
  | { kind: "track"; shot: number; at: number }
  | { kind: "freeze"; shot: number; at: number; hold: number; label: string };

export interface ShortCraft {
  version: 1;
  cards: CraftCard[];
  photos: CraftPhoto[];
  fillers: CraftFiller[];
  moves: CraftMove[];
}

export interface CraftSettings {
  cards: boolean;
  photos: boolean;
  fillers: boolean;
  camera: boolean;
}
export const ALL_ON: CraftSettings = {
  cards: true,
  photos: true,
  fillers: true,
  camera: true,
};

/** A stable 0..1 from a string and a number: the only tie-breaker. */
function hash(s: string, seed: number): number {
  let h = 2166136261 ^ (seed | 0);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

// ---- Card windows ---------------------------------------------------------------------------------

const HOLD_SECONDS = (s: Segment) =>
  s.kind === "take"
    ? 3.5
    : s.visual && ["list", "timeline", "compare"].includes(s.visual.kind)
      ? 3
      : 2.5;

/**
 * When a beat's or the take's card is up: from the word it is about (6 frames early) for 2.5-3.5 s, inside
 * its segment. The Short (src/render/Short.tsx) draws its cards in these windows; the planner keeps its
 * fillers and camera moves clear of them.
 */
export function cardWindow(
  segments: Segment[],
  words: Array<{ text?: string; start: number }>,
  i: number,
  fps: number,
  totalFrames: number,
): { from: number; len: number } {
  const s = segments[i]!;
  const start = i === 0 ? 0 : Math.round(s.start * fps);
  const end =
    i === segments.length - 1
      ? totalFrames
      : Math.round(segments[i + 1]!.start * fps);
  const v = s.visual;
  const hold = Math.round(HOLD_SECONDS(s) * fps);
  let at = start;
  if (v && s.kind !== "take") {
    const lo = Math.max(
      0,
      words.findIndex((w) => w.start >= s.start - 0.05),
    );
    let hi = words.findIndex((w) => w.start >= s.end);
    if (hi < 0) hi = words.length;
    for (const key of [v.primary, ...(v.items ?? []), v.secondary].filter(
      Boolean,
    )) {
      const t = keyTime(words, lo, hi, key);
      if (t !== undefined) {
        at = Math.max(start, Math.round(t * fps) - 6);
        break;
      }
    }
  }
  return { from: at, len: Math.max(1, Math.min(end - at, hold)) };
}

/** A delay beat's two dates as the departures board's rows ("2027-03: Now March"), as the Short draws them. */
export function flapRows(from: string, to: string): string[] {
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const when = (iso: string) => {
    const [, m, d] = iso.split("-").map(Number);
    return m ? `${MONTHS[m - 1]}${d ? ` ${d}` : ""}` : "";
  };
  const a = when(from);
  const b = when(to);
  return [
    `${from}: ${a ? `Was due ${a}` : "Was due"}`,
    `${to}: ${b ? `Now ${b}` : "Now due"}`,
  ];
}

/** A beat's visual as the vertical styles read it. */
export function cardData(s: Segment): VGfxProps["v"] | undefined {
  const v = s.visual;
  if (s.kind !== "beat" || !v || v.kind === "none" || !v.primary.trim())
    return undefined;
  return {
    kind: v.kind,
    primary: v.primary,
    secondary: v.secondary,
    items:
      v.kind === "timeline" && v.date_from && v.date_to
        ? flapRows(v.date_from, v.date_to)
        : (v.items ?? []),
    date_to: v.date_to,
    region: v.region,
  };
}

// ---- 1. Cards -------------------------------------------------------------------------------------

/** Every look that can draw this beat: the house card first, then the vertical styles that fit, by name. */
export function fittingCards(v: VGfxProps["v"], storyYear: number): string[] {
  const out = [HOUSE];
  for (const k of Object.keys(V_STYLES).sort()) {
    const st = V_STYLES[k]!;
    if (st.kind !== v.kind) continue;
    try {
      if (!st.fits || st.fits(v, { storyYear })) out.push(k);
    } catch {
      /* a style that throws on this beat is not offered */
    }
  }
  return out;
}

export const isFull = (look: string) => V_STYLES[look]?.frame === "full";

/**
 * The look of every beat's card. Among the fitting looks: never the look of the card before (the house card
 * included), never a look already used in this Short while another fits, at most one full-width Pulse device,
 * then the looks the channel has not used in its remembered Shorts, then the least recently used; ties break
 * on a hash of the beat's text and the seed.
 */
export function pickCards(
  segments: Segment[],
  ctx: { seed: number; madeYear: number },
  recent: RecentCraft[],
): CraftCard[] {
  const out: CraftCard[] = [];
  const used = new Set<string>();
  let full = 0;
  let previous: string | undefined;
  const lastUse = (id: string) => {
    const i = recent.findIndex((r) => r.look === id);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  segments.forEach((s, i) => {
    const v = cardData(s);
    if (!v) return;
    let cands = fittingCards(v, storyYearOf(v, ctx.madeYear));
    const narrow = (keep: (c: string) => boolean) => {
      const rest = cands.filter(keep);
      if (rest.length) cands = rest;
    };
    narrow((c) => c !== previous);
    narrow((c) => !used.has(c));
    if (full >= 1) narrow((c) => !isFull(c));
    const key = (id: string): number[] => [
      lastUse(id) === Number.POSITIVE_INFINITY ? 1 : 0,
      lastUse(id) === Number.POSITIVE_INFINITY ? 0 : lastUse(id),
      hash(`${v.primary}|${id}`, ctx.seed),
    ];
    const look = [...cands].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let k = 0; k < ka.length; k++)
        if (ka[k] !== kb[k]) return kb[k]! - ka[k]!;
      return a < b ? -1 : 1;
    })[0]!;
    out.push({ segment: i, look });
    used.add(look);
    if (isFull(look)) full++;
    previous = look;
  });
  return out;
}

// ---- Shared inputs ----------------------------------------------------------------------------------

export interface CraftInput {
  segments: Segment[];
  words: Array<{ text: string; start: number; end: number }>;
  plan: Pick<RenderPlan, "shots" | "fps" | "totalFrames" | "turns">;
  images: Array<{ kind: string; credit?: string; beatIndex?: number }>;
  clips: Array<{ durationSeconds: number; beatIndex?: number; role?: string }>;
  /** The word moments' times (seconds). */
  stamps: Array<{ at: number }>;
  /** Per segment, from the media-richness measure: the line has no card and nothing chosen for it. */
  bare: boolean[];
  game: string;
  /** The game's release year, when known. */
  gameYear?: number;
  /** The year the Short is made. */
  madeYear: number;
  seed: number;
}

type Span = { from: number; to: number };
const overlaps = (a: Span, b: Span) => a.from < b.to && b.from < a.to;

function hookEndOf(input: CraftInput): number {
  const i = input.segments.findIndex((s) => s.kind === "hook");
  return i >= 0 && input.segments[i + 1]
    ? Math.round(input.segments[i + 1]!.start * input.plan.fps)
    : Math.round(3 * input.plan.fps);
}
function loopStartOf(input: CraftInput): number {
  const i = input.segments.findIndex((s) => s.kind === "loop");
  return i >= 0
    ? Math.round(input.segments[i]!.start * input.plan.fps)
    : input.plan.totalFrames - 30;
}

// ---- 2. Photos --------------------------------------------------------------------------------------

/** The real-world photo shots and their treatments: long enough, past the opening, before the loop. */
export function pickPhotos(
  input: CraftInput,
  recent: RecentCraft[],
  avoid: Span[],
): CraftPhoto[] {
  const { plan, images } = input;
  const out: CraftPhoto[] = [];
  const last = plan.shots.length - 1;
  const loopStart = loopStartOf(input);
  let previous = recent.find((r) => r.look.startsWith("Photo/"))?.look.slice(6);
  plan.shots.forEach((s, i) => {
    if (out.length >= MAX_PHOTOS || i === 0 || i === last) return;
    if (s.media.type !== "image") return;
    const im = images[s.media.index];
    if (!im || (im.kind !== "photo" && im.kind !== "portrait")) return;
    const len = s.end - s.start;
    if (len < PHOTO_MIN_FRAMES || s.end > loopStart) return;
    if (avoid.some((a) => overlaps(a, { from: s.start, to: s.end }))) return;
    const ctx = {
      kind: im.kind as "photo" | "portrait",
      year: input.madeYear,
      credit: im.credit,
    };
    let pool = SHORT_PHOTO_TREATMENTS.filter((t) => eligible(t, len, ctx));
    // Newsprint is the press photo's look; a press photo gets it when it fits.
    if (pool.includes("newsprint") && !pressCredit(im.credit))
      pool = pool.filter((t) => t !== "newsprint");
    const open = pool.filter((t) => t !== previous);
    const from = open.length ? open : pool;
    if (!from.length) return;
    const seed = (input.seed * 7919 + s.media.index * 131 + s.start) | 0;
    const treatment =
      from[Math.floor(hash(`photo|${s.start}`, input.seed) * from.length)]!;
    out.push({ shot: i, treatment, seed });
    previous = treatment;
  });
  return out;
}

// ---- 3. Fillers -------------------------------------------------------------------------------------

/** The bare lines' fillers: kinetic type first, then a drawn scene or silhouette, then a document. */
export function pickFillers(
  input: CraftInput,
  avoid: Span[],
  recent: RecentCraft[] = [],
): CraftFiller[] {
  const { segments, words, plan } = input;
  // The kinetic style the channel's last filler used, so the next Short's differs.
  let previousStyle = recent
    .find((r) => r.look.startsWith("Filler/"))
    ?.look.slice(7);
  const fps = plan.fps;
  const out: CraftFiller[] = [];
  const families = new Set<string>();
  const chapter = {
    game: input.game,
    year: input.gameYear,
    sentences: segments.map((s) => s.text),
  };
  segments.forEach((s, i) => {
    if (out.length >= MAX_FILLERS) return;
    if (!input.bare[i] || s.kind === "hook" || s.kind === "loop") return;
    const start = Math.round(s.start * fps);
    const end =
      i === segments.length - 1
        ? plan.totalFrames
        : Math.round(segments[i + 1]!.start * fps);
    const from = start + 3;
    const len = Math.min(FILLER_MAX_FRAMES, end - from - 4);
    if (len < FILLER_MIN_FRAMES) return;
    const span = { from, to: from + len };
    if (avoid.some((a) => overlaps(a, span))) return;
    const spoken = wordsIn(words, s.start, s.end);
    const base = { segment: i, from, len };
    const k = families.has("kinetic")
      ? undefined
      : kineticFor(s.text, { emphasis: "" }, chapter, {
          index: i,
          seed: input.seed,
          previous: previousStyle,
        });
    if (k) {
      out.push({
        ...base,
        family: "kinetic",
        style: k.style,
        data: k.data,
        times: wordTimes(k.data.tokens, spoken, from / fps),
      });
      families.add("kinetic");
      previousStyle = k.style;
      return;
    }
    const scene = [
      objectsFor(s.text, { show: "" }, chapter),
      silhouetteFor(s.text, { show: "" }, chapter),
    ]
      .filter((c) => c && !families.has(c.area))
      .sort((a, b) => b!.confidence - a!.confidence)[0];
    if (scene && scene.confidence >= 0.6) {
      out.push({
        ...base,
        family: scene.area,
        style: scene.style,
        year: scene.year,
        month: scene.month,
      });
      families.add(scene.area);
      return;
    }
    const doc = families.has("document")
      ? undefined
      : documentFor(s.text, {}, { game: input.game, year: input.gameYear });
    if (doc && doc.confidence >= 0.6) {
      out.push({
        ...base,
        family: "document",
        style: doc.kind,
        scene: doc.scene,
        words: spoken.map((w) => ({
          text: w.text,
          start: w.start - from / fps,
          end: w.end - from / fps,
        })),
      });
      families.add("document");
    }
  });
  return out;
}

// ---- 4. Camera --------------------------------------------------------------------------------------

/** A freeze label worth pausing on: a name or a figure of 3-18 characters, not a unit or a filler word. */
export function freezeLabelOk(label: string): boolean {
  if (label.length < 3 || label.length > 18) return false;
  if (
    /^(DOLLARS?|POUNDS?|EUROS?|PERCENT|YEARS?|MONTHS?|DAYS?|HOURS?|TODAY|NOW|THIS|THAT|THEN|ALSO|STILL)$/.test(
      label,
    )
  )
    return false;
  return /^[A-Z0-9$£€]/.test(label);
}

/** The most camera moves a Short of this many frames gets: three in 40 s, fewer in a shorter one, never more. */
export function maxMoves(totalFrames: number, fps: number): number {
  return Math.max(
    1,
    Math.min(
      MOVES_PER_40S,
      Math.floor((MOVES_PER_40S * totalFrames) / (40 * fps)),
    ),
  );
}

/**
 * A freeze-frame on the word a beat is about (its key word, said inside one of the beat's own clips with time
 * to hold and play on), then pushes through cuts after the hook, spread out, never near a turn, the loop or
 * anything else that moves.
 */
export function pickMoves(
  input: CraftInput,
  avoid: Span[],
  fixed: Set<number>,
): CraftMove[] {
  const { plan, segments, words } = input;
  const fps = plan.fps;
  const cap = maxMoves(plan.totalFrames, fps);
  const hookEnd = hookEndOf(input);
  const loopStart = loopStartOf(input);
  const free = (span: Span) => !avoid.some((a) => overlaps(a, span));
  const picked: CraftMove[] = [];
  const spaced = (at: number) =>
    picked.every((m) => Math.abs(m.at - at) >= MOVE_GAP_FRAMES);
  // The freeze: at most one.
  for (let i = 1; i < plan.shots.length - 1 && !picked.length; i++) {
    const s = plan.shots[i]!;
    if (s.media.type !== "clip" || fixed.has(i)) continue;
    const seg = segments[s.segment];
    if (!seg || seg.kind !== "beat") continue;
    const kw = keyWords(seg.text);
    if (!kw) continue;
    const clip = input.clips[s.media.index];
    const trim = s.media.trimFrom ?? 0;
    const hold = SHORT_FREEZE_HOLD;
    if (!clip || clip.durationSeconds * fps - trim < s.end - s.start + hold)
      continue;
    const lo = Math.max(
      0,
      words.findIndex((w) => w.start >= seg.start - 0.05),
    );
    let hi = words.findIndex((w) => w.start >= seg.end);
    if (hi < 0) hi = words.length;
    // The line's strongest word first, then its other key words: the first said where the clip can hold.
    for (const k of [kw.hero, ...kw.shown.filter((x) => x !== kw.hero)]) {
      const token = kw.tokens[k]!;
      const label = displayWord(token).toUpperCase();
      if (!freezeLabelOk(label)) continue;
      const t = keyTime(words, lo, hi, token);
      if (t === undefined) continue;
      const at = Math.round(t * fps);
      if (at - s.start < SHORT_FREEZE_LEAD || s.end - at < hold + 8) continue;
      if (at < hookEnd || at + hold > loopStart) continue;
      if (!free({ from: at - 4, to: at + hold + 4 })) continue;
      picked.push({ kind: "freeze", shot: i, at, hold, label });
      break;
    }
  }
  // Pushes through cuts, spread across the Short.
  const cuts = plan.shots
    .map((s, i) => ({ i, at: s.start }))
    .filter(({ i, at }) => {
      if (i < 1) return false;
      const a = plan.shots[i - 1]!;
      const b = plan.shots[i]!;
      if (fixed.has(i) || fixed.has(i - 1)) return false;
      if (a.end - a.start < 30 || b.end - b.start < 30) return false;
      if (at < hookEnd + 6 || at > loopStart - 30) return false;
      if (plan.turns.some((t) => Math.abs(t - at) < 20)) return false;
      return free({
        from: at - SHORT_TRACK_FRAMES - 2,
        to: at + SHORT_TRACK_FRAMES + 2,
      });
    })
    .sort(
      (x, y) =>
        hash(`cut|${x.at}`, input.seed) - hash(`cut|${y.at}`, input.seed),
    );
  for (const c of cuts) {
    if (picked.length >= cap) break;
    if (!spaced(c.at)) continue;
    if (picked.some((m) => m.shot === c.i || m.shot === c.i - 1)) continue;
    picked.push({ kind: "track", shot: c.i, at: c.at });
  }
  return picked.sort((a, b) => a.at - b.at);
}

// ---- The whole plan ---------------------------------------------------------------------------------

/** Everything the craft adds to one Short, each layer only when its setting is on. */
export function planShortCraft(
  input: CraftInput,
  settings: CraftSettings,
  recent: RecentCraft[],
): ShortCraft {
  const { plan, segments, words } = input;
  const fps = plan.fps;
  const cards = settings.cards
    ? pickCards(
        segments,
        { seed: input.seed, madeYear: input.madeYear },
        recent,
      )
    : [];
  // What is already on screen and must not be covered or moved under.
  const windows: Span[] = segments
    .map((s, i) => ({ s, i }))
    .filter(
      ({ s }) =>
        (s.kind === "beat" || s.kind === "take") &&
        s.visual &&
        s.visual.kind !== "none" &&
        s.visual.primary.trim(),
    )
    .map(({ i }) => {
      const w = cardWindow(segments, words, i, fps, plan.totalFrames);
      return { from: w.from, to: w.from + w.len };
    });
  const stamps: Span[] = input.stamps.map((st) => {
    const a = Math.round(st.at * fps);
    return { from: a - 6, to: a + STAMP_HOLD + 6 };
  });
  const fillers = settings.fillers
    ? pickFillers(input, [...windows, ...stamps], recent)
    : [];
  const fillSpans = fillers.map((f) => ({ from: f.from, to: f.from + f.len }));
  const photos = settings.photos ? pickPhotos(input, recent, fillSpans) : [];
  const fixed = new Set(photos.map((p) => p.shot));
  const moves = settings.camera
    ? pickMoves(input, [...windows, ...stamps, ...fillSpans], fixed)
    : [];
  return { version: 1, cards, photos, fillers, moves };
}

/** The filler windows per segment in seconds, for the media-richness measure's "after" reading. */
export function fillSeconds(
  craft: ShortCraft | undefined,
  fps: number,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of craft?.fillers ?? [])
    out.set(f.segment, (out.get(f.segment) ?? 0) + f.len / fps);
  return out;
}

/** The looks the craft used, newest last, as the memory stores them. */
export function craftLooks(craft: ShortCraft): string[] {
  return [
    ...craft.cards.map((c) => c.look).filter((l) => l !== HOUSE),
    ...craft.photos.map((p) => `Photo/${p.treatment}`),
    ...craft.fillers.map((f) => `Filler/${f.style}`),
  ];
}

/** The memory with this Short's looks at its head, kept to RECENT_CRAFT_KEEP. */
export function rememberCraft(
  recent: RecentCraft[],
  craft: ShortCraft,
  day: string,
): RecentCraft[] {
  const now = craftLooks(craft).map((look) => ({ look, day }));
  return [...now, ...recent].slice(0, RECENT_CRAFT_KEEP);
}

/** One line for the log and the owner: what this Short got, in plain English. */
export function craftSummary(craft: ShortCraft): string {
  const parts: string[] = [];
  const looks = craft.cards.filter((c) => c.look !== HOUSE).map((c) => c.look);
  if (looks.length) parts.push(`cards: ${looks.join(", ")}`);
  if (craft.photos.length)
    parts.push(`photos: ${craft.photos.map((p) => p.treatment).join(", ")}`);
  if (craft.fillers.length)
    parts.push(
      `bare lines filled: ${craft.fillers.map((f) => `${f.family} (${f.style})`).join(", ")}`,
    );
  if (craft.moves.length)
    parts.push(
      `camera: ${craft.moves.map((m) => (m.kind === "track" ? "push through a cut" : `freeze on ${m.label}`)).join(", ")}`,
    );
  return parts.join("; ") || "nothing added (house cards only)";
}

// ---- The settings row -------------------------------------------------------------------------------

export async function readRecentCraft(db: Db): Promise<RecentCraft[]> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [RECENT_CRAFT_KEY],
  );
  try {
    const list = row ? (JSON.parse(row.value) as unknown) : [];
    return Array.isArray(list)
      ? list
          .filter((x): x is RecentCraft =>
            Boolean(
              x &&
              typeof x === "object" &&
              typeof (x as RecentCraft).look === "string",
            ),
          )
          .map((x) => ({ look: x.look, day: String(x.day ?? "") }))
          .slice(0, RECENT_CRAFT_KEEP)
      : [];
  } catch {
    return [];
  }
}

export async function writeRecentCraft(
  db: Db,
  recent: RecentCraft[],
): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [RECENT_CRAFT_KEY, JSON.stringify(recent.slice(0, RECENT_CRAFT_KEEP))],
  );
}
