// The render plan for a long-form 16:9 video. Simpler than the Short's: each
// entry of a ranking owns a run of shots that alternate its trailer moments
// with its art on slow moves; the intro uses the topic's own art and the
// outro returns to the winner. Pure, so the same inputs always plan the same.

import type { Segment } from "./timeline.ts";
import type { MovePreset } from "./motion.ts";
import { speakable } from "../voice/speakable.ts";
import { bookendEcho, rhythmBursts, shotCap } from "./structure.ts";
import {
  FILLER_MIN_FRAMES,
  fillerMaxFrames,
  fillerSettle,
  shotWords,
  type KineticFillerData,
  type MomentFiller,
} from "./fillerplan.ts";
import { wordTimes } from "./components/kinetic/words.ts";

export const LONG_FPS = 30;
export const LONG_WIDTH = 1920;
export const LONG_HEIGHT = 1080;
export const LONG_TAIL_SECONDS = 6; // end card after the last word
const STILL_SHOT = 180; // 6 s on a still
const MIN_SHOT = 60; // never a still under 2 s
const MIN_CLIP_SHOT = 39; // footage may cut faster: 1.3 s
const MAX_STILL_SHOT = 240; // 8 s at most on one still

export interface LongImage {
  kind: string;
  aspect: number;
  beatIndex?: number;
  moment?: number; // the sentence of the entry it was picked for
  /** Its path in the episode folder: a picture the sentence top-up fetched (under fill/) may be a real-world one. */
  file?: string;
}

/** Official game art: any line about its game may show it. */
const GAME_ART = new Set(["screenshot", "hero", "header", "capsule"]);

/**
 * A picture of the real world (a Commons photo, a person's portrait, a concept sketch, or anything else the
 * sentence top-up fetched that is not official game art). It shows one particular building, street or person,
 * so it belongs only to the sentence it was picked for: 31 Oct 2026, the owner on the Vice City documentary,
 * "what's with the constant repeated random property photos" (the same scaffolded apartment block and Dundee
 * shopping centre came back as filler under unrelated lines).
 */
export function realWorldImage(img: { kind: string; file?: string }): boolean {
  if (img.kind === "photo" || img.kind === "portrait" || img.kind === "sketch")
    return true;
  return !GAME_ART.has(img.kind) && /(^|[\\/])fill[\\/]/.test(img.file ?? "");
}

/**
 * Whether a real-world picture pinned to sentence `pinned` may be on screen during sentence `now`: on its own
 * sentence, or running on into the next as fillerFor allows. One pinned to nothing is never shown.
 */
export function realWorldMayFill(
  pinned: number | undefined,
  now: number,
): boolean {
  return pinned !== undefined && fillerFor(pinned, now);
}

export interface LongClip {
  durationSeconds: number;
  beatIndex?: number;
  role?: "hook";
  moment?: number;
  /** Where in its source video the clip was cut (seconds), when known: two clips overlapping there are one moment. */
  span?: { source: string; from: number; to: number };
}

/**
 * For each clip, the other clips cut from the same stretch of the same source video: once one plays, they are
 * spent too, so a chapter never shows one moment twice (owner, 31 Oct 2026: no clip segment repeated within a
 * chapter). Clips without a span overlap nothing.
 */
export function overlappingClips(clips: Array<Pick<LongClip, "span">>): number[][] {
  return clips.map((a, i) =>
    a.span
      ? clips.flatMap((b, j) =>
          j !== i &&
          b.span &&
          b.span.source === a.span!.source &&
          b.span.from < a.span!.to - 0.05 &&
          a.span!.from < b.span.to - 0.05
            ? [j]
            : [],
        )
      : [],
  );
}

/** One sentence of a ranking entry on the timeline (seconds). */
export interface MomentWindow {
  entry: number;
  /** The segment (paragraph) the sentence is in: a documentary chapter has many. */
  segment: number;
  /** The sentence's index across its whole entry, matching the entry's shot list. */
  moment: number;
  start: number;
  end: number;
  /** When the narrator says the thing the sentence is about (its figure, name or subject); `start` when unknown. */
  at: number;
}

/** What a sentence lands on screen, as the editor's shot list describes it. */
export interface MomentKeySource {
  show?: string;
  graphic?: {
    kind: string;
    primary: string;
    secondary: string;
    items?: string[];
  };
  emphasis?: string;
  person?: string;
}

/**
 * The phrases a sentence's on-screen moment refers to, most specific first: its graphic's figure
 * (or list items, or compare labels), its kinetic caption, the person it is about, then the
 * proper names in what the picture shows ("Tommy Vercetti", "Vice City").
 */
export function momentKeys(m: MomentKeySource): string[] {
  const keys: string[] = [];
  const g = m.graphic;
  if (g && usefulGraphic(g)) {
    if (g.kind === "list") keys.push(...(g.items ?? []));
    // A quote lands with the sentence it belongs to; a timeline on its first year.
    else if (g.kind === "quote") {
    } else if (g.kind === "timeline")
      keys.push(
        ...(g.items ?? []).map((x) => x.split(":")[0]!.trim()).slice(0, 1),
      );
    // Named things land on their first name: an outlet, a person, a game, a date.
    else if (
      [
        "reviews",
        "people",
        "versus",
        "delay",
        "map",
        "bars",
        "share",
        "specs",
        "lineage",
      ].includes(g.kind)
    )
      keys.push(
        ...(g.items ?? []).map((x) => x.split(":")[0]!.trim()).slice(0, 1),
      );
    else if (g.kind === "span") keys.push(...(g.items ?? []).slice(0, 1));
    else if (g.kind === "source") {
    } else if (g.kind === "compare")
      keys.push(...(g.items ?? []).map((x) => x.split(":")[0]!.trim()));
    else keys.push(g.primary);
  }
  if (m.emphasis && usefulEmphasis(m.emphasis)) keys.push(m.emphasis);
  if (m.person) keys.push(m.person);
  for (const name of (m.show ?? "").match(
    /\b[A-Z0-9][\w'’]*(?:\s+(?:of|the|[A-Z0-9][\w'’]*))*/g,
  ) ?? [])
    if (!/^(The|A|An|This|That|It|His|Her|Their)$/.test(name)) keys.push(name);
  return keys.filter((k) => k.trim());
}

const ANCHOR_STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "to",
  "in",
  "on",
  "for",
  "with",
  "its",
  "it",
  "is",
  "was",
  "that",
  "this",
  "his",
  "her",
  "their",
  "at",
  "by",
  "as",
  "from",
]);
// "gig", "gigs" and "gigabytes" are one word to an anchor (the voice shortens a repeated unit, speakUnits).
const UNIT_SAME: Record<string, string> = {
  gig: "gigabytes",
  gigs: "gigabytes",
  gigabyte: "gigabytes",
  meg: "megabytes",
  megs: "megabytes",
  megabyte: "megabytes",
  pollish: "polish",
};
const anchorToken = (t: string) => {
  const k = t.toLowerCase().replace(/[^a-z0-9]/g, "");
  return UNIT_SAME[k] ?? k;
};

/**
 * The time a key is spoken within words[from, to): where its first two telling words come in a
 * row, else where its longest one does. Keys are put through speakable() first, so "$59.99" finds
 * "fifty-nine dollars ninety-nine" and "GTA V" finds "GTA 5".
 */
export function keyTime(
  words: Array<{ text?: string; start: number }>,
  from: number,
  to: number,
  key: string,
): number | undefined {
  const all = speakable(key).split(/\s+/).map(anchorToken).filter(Boolean);
  const telling = all.filter((t) => !ANCHOR_STOP.has(t));
  const toks = telling.length ? telling : all;
  if (!toks.length) return undefined;
  const at = (k: number) => anchorToken(words[k]?.text ?? "");
  if (toks.length >= 2)
    for (let k = from; k < to - 1; k++) {
      if (at(k) !== toks[0]) continue;
      // Allow one small word between them ("Grand Theft Auto": "grand", "theft").
      if (
        at(k + 1) === toks[1] ||
        (ANCHOR_STOP.has(at(k + 1)) && at(k + 2) === toks[1])
      )
        return words[k]!.start;
    }
  const longest = [...toks].sort((a, b) => b.length - a.length)[0]!;
  if (longest.length < 3 && toks.length > 1) return undefined;
  for (let k = from; k < to; k++)
    if (at(k) === longest || (toks.length === 1 && at(k) === toks[0]))
      return words[k]!.start;
  return undefined;
}

/** Sentences as the script splits them (kept here so the renderer needs no editorial code). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'‘])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Where each sentence of each ranking entry starts and ends, from the voice's
 * word timings: sentence k begins at the word that follows the previous
 * sentences' words. counts[e] is the number of moments entry e has.
 */
export function momentWindows(
  segments: Segment[],
  words: Array<{ start: number; end: number; text?: string }>,
  counts: number[],
  keys?: string[][][],
): MomentWindow[] {
  const out: MomentWindow[] = [];
  // A documentary chapter spans several paragraphs: its shot list runs on across them.
  const offset = new Map<number, number>();
  for (const [i, seg] of segments.entries()) {
    if (seg.kind !== "beat") continue;
    const e = entryOf(segments, i);
    const before = e === undefined ? 0 : (offset.get(e) ?? 0);
    const n = e === undefined ? 0 : Math.max(0, (counts[e] ?? 0) - before);
    const sentences = splitSentences(seg.text);
    if (e !== undefined) offset.set(e, before + sentences.length);
    if (!n || e === undefined) continue;
    const segEnd = i === segments.length - 1 ? seg.end : segments[i + 1]!.start;
    const ws = words.filter(
      (w) => w.start >= seg.start - 0.05 && w.start < segEnd,
    );
    const lens = sentences.map((x) => x.split(/\s+/).filter(Boolean).length);
    const k = Math.min(n, lens.length || 1);
    const starts: number[] = [];
    let idx = 0;
    for (let j = 0; j < k; j++) {
      starts.push(j === 0 ? seg.start : (ws[idx]?.start ?? seg.start));
      idx += lens[j] ?? 0;
    }
    for (let j = 0; j < k; j++) {
      const start = starts[j]!;
      const end = j === k - 1 ? segEnd : starts[j + 1]!;
      // A paragraph's first sentence stays anchored to its start (the entry's opens on its rank card).
      let at = start;
      const m = before + j;
      if (j > 0 && keys?.[e]?.[m]?.length) {
        const lo = words.indexOf(
          ws[lens.slice(0, j).reduce((a, b) => a + b, 0)] ?? words[0]!,
        );
        const hi = Math.max(lo, lo + (lens[j] ?? 0));
        for (const key of keys[e]![m]!) {
          const t = keyTime(words, Math.max(0, lo), hi, key);
          if (t !== undefined) {
            // Within the first half second it is the sentence's opening anyway.
            at = t - start < 0.5 ? start : t;
            break;
          }
        }
      }
      out.push({ entry: e, segment: i, moment: m, start, end, at });
    }
  }
  return out;
}

export interface LongPlanInput {
  segments: Segment[];
  words: Array<{ text: string; start: number; end: number }>;
  durationSeconds: number; // includes the tail
  images: LongImage[];
  clips: LongClip[];
  variant: number;
  /** Moments per ranking entry: when given, each sentence gets its own matched picture. */
  momentCounts?: number[];
  /** Per entry, per sentence: what it lands on screen (momentKeys), so its picture arrives on that word. */
  momentKeys?: string[][][];
  /** The entry whose media plays behind the outro (the weekly recap's "our read" story). */
  takeEntry?: number;
  /** Per entry, per sentence: what its shot shows and who it names, so the cold open can preview them. */
  momentShows?: string[][];
  /**
   * Real-world pictures (realWorldImage) only on their own sentence, never as filler; unpinned ones not at all
   * (REAL_PHOTOS_PINNED_ONLY, default on). Applies only to a plan with shot lists (momentCounts): a video
   * without them has no sentence to pin a photo to and keeps its photos in the rotation.
   */
  realPinnedOnly?: boolean;
  /** A documentary's cut rhythm (src/render/structure.ts shotCap): tighter opening minutes, bursts later. */
  rhythm?: boolean;
  /** With the rhythm, a burst of quicker cuts inside every ranking entry (src/render/structure.ts entryBursts). */
  entryPace?: boolean;
  /** A documentary's bookend ending (src/render/structure.ts bookendEcho): the last shot is the cold open's first. */
  bookend?: boolean;
  /** Frames of the signature opening card, which the bookend's source picture comes after. */
  coldOpenFrames?: number;
  /**
   * Per entry, per sentence: its filler visual (src/assets/fillers.ts), when it has one. The sentence then
   * opens on a filler shot from its first word, up to FILLER_MAX_SECONDS (a reconstruction: what its clip
   * can fill), and its chapter's pictures carry any time left. Muted ones are left out by the caller.
   */
  momentFillers?: Array<Array<MomentFiller | undefined>>;
  /**
   * Footage first (FOOTAGE_FIRST): a chapter with no pictures never loops its own clips once they have all
   * played; it shows the plate instead, which the thin-entry top-up then fills with official screenshots.
   */
  noRepeats?: boolean;
}

const PREVIEW_STOP = new Set(
  "that this with from were what when then they them their there into over after about would could which while have been only just more most first years year game games".split(
    " ",
  ),
);
const previewWords = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !PREVIEW_STOP.has(w)),
  );

/**
 * The matched shot of the chapter sentence a cold-open sentence previews: the most shared words, at least
 * two, or one telling one (a year, or a name of six letters or more). Each chapter sentence is used once.
 */
export function previewShot(
  sentence: string,
  shows: string[][],
  taken: Set<string>,
  images: Array<{
    beatIndex?: number;
    moment?: number;
    kind?: string;
    file?: string;
  }>,
  clips: Array<{ beatIndex?: number; moment?: number }>,
  clipUsed: boolean[],
): LongMedia | undefined {
  const mine = previewWords(sentence);
  if (!mine.size) return undefined;
  let best: { e: number; k: number; score: number } | undefined;
  for (const [e, list] of shows.entries())
    for (const [k, show] of list.entries()) {
      if (taken.has(`${e}:${k}`)) continue;
      const shared = [...previewWords(show)].filter((w) => mine.has(w));
      const telling = shared.some((w) => /^\d{4}$/.test(w) || w.length >= 6);
      const score = shared.length + (telling ? 0.5 : 0);
      if ((shared.length >= 2 || telling) && score > (best?.score ?? 0))
        best = { e, k, score };
    }
  if (!best) return undefined;
  // The matched sentence's own shot, else the nearest pinned one within two sentences of it (the same story
  // beat): a cold-open line restating a fact that carries only a graphic in its chapter still shows its moment.
  for (const d of [0, -1, 1, -2, 2]) {
    const k = best.k + d;
    if (k < 0 || (d !== 0 && taken.has(`${best.e}:${k}`))) continue;
    const clip = clips.findIndex(
      (c, n) => c.beatIndex === best!.e && c.moment === k && !clipUsed[n],
    );
    // A neighbour's photo is of its own person or place; only game footage and art carry over.
    const image = images.findIndex(
      (m) =>
        m.beatIndex === best!.e &&
        m.moment === k &&
        (d === 0 || !realWorldImage({ kind: m.kind ?? "", file: m.file })),
    );
    if (clip < 0 && image < 0) continue;
    taken.add(`${best.e}:${k}`);
    return clip >= 0
      ? { type: "clip", index: clip }
      : { type: "image", index: image };
  }
  return undefined;
}

/**
 * Whether media picked for sentence `pinned` (undefined: picked for none) may fill sentence `now`: unpinned
 * media, the sentence's own, or the one just gone (it usually shows the same thing), never another sentence's.
 */
export function fillerFor(pinned: number | undefined, now: number): boolean {
  return pinned === undefined || pinned === now || pinned === now - 1;
}

/**
 * What a shot shows. A "filler" is a sentence's filler visual (./fillerplan.ts): `index` is the sentence's
 * moment and `entry` its chapter, so the composition draws props.moments[entry][index].filler.
 */
export type LongMedia = {
  type: "image" | "clip" | "plate" | "filler";
  index: number;
  entry?: number;
};

export interface LongShot {
  start: number; // frame
  end: number; // exclusive
  segment: number;
  media: LongMedia;
  move: MovePreset;
  /** A filler shot: the frame (from the shot's start) by which it is fully drawn, where checks look. */
  settle?: number;
}

export interface LongPlan {
  version: 1;
  fps: number;
  totalFrames: number;
  tailFrames: number;
  shots: LongShot[];
}

const toFrame = (s: number) => Math.round(s * LONG_FPS);
const MOVES: MovePreset[] = ["pushIn", "pullBack", "pushPan", "driftDown"];

/**
 * Which entry a segment belongs to: beats count up from zero; the take belongs
 * to the winner (the last beat). In a documentary a chapter spans many beats:
 * each "chapter" card starts the next entry, and the outro belongs to the last.
 */
export function entryOf(
  segments: Segment[],
  i: number,
  /** The weekly recap: the outro is about one story, so its footage plays behind it. */
  takeEntry?: number,
): number | undefined {
  const seg = segments[i]!;
  if (segments.some((s) => s.visual?.kind === "chapter")) {
    const upTo = segments
      .slice(0, i + 1)
      .filter((s) => s.kind === "beat" && s.visual?.kind === "chapter").length;
    if (seg.kind === "beat") return upTo > 0 ? upTo - 1 : undefined;
    if (seg.kind === "take")
      return takeEntry ?? (upTo > 0 ? upTo - 1 : undefined);
    return undefined;
  }
  const beats = segments.filter((s) => s.kind === "beat").length;
  if (seg.kind === "beat")
    return segments.slice(0, i).filter((s) => s.kind === "beat").length;
  if (seg.kind === "take" && beats > 0) return beats - 1;
  return undefined;
}

export function buildLongPlan(input: LongPlanInput): LongPlan {
  const { segments, images, clips, variant } = input;
  const totalFrames = Math.max(
    LONG_FPS * 10,
    Math.ceil(input.durationSeconds * LONG_FPS),
  );
  const tailFrames = toFrame(LONG_TAIL_SECONDS);
  const shots: LongShot[] = [];
  // A clip's real length: one shorter than a shot is skipped by the fill, never stretched past its last frame.
  const clipFrames = clips.map((c) => Math.floor(c.durationSeconds * LONG_FPS));
  const clipUsed = clips.map(() => false);
  const twins = overlappingClips(clips);
  /** Marks a clip played, and every clip cut from the same moment of its source. */
  const spend = (k: number) => {
    clipUsed[k] = true;
    for (const j of twins[k] ?? []) clipUsed[j] = true;
  };
  const previewed = new Set<number>();
  const stillUses = images.map(() => 0);
  // Where each entry's stills left off, so a chapter's paragraphs walk its gallery instead of restarting it.
  const cursors = new Map<number | undefined, number>();
  let shotIndex = 0;
  let last: LongMedia | undefined;
  const same = (a: LongMedia | undefined, b: LongMedia) =>
    !!a && a.type === b.type && a.index === b.index && a.entry === b.entry;

  const windows = input.momentCounts?.length
    ? momentWindows(segments, input.words, input.momentCounts, input.momentKeys)
    : [];
  // With shot lists, a real-world picture is shown only on its own sentence (realWorldImage).
  const strict = (input.realPinnedOnly ?? true) && windows.length > 0;
  const real = (k: number) => strict && realWorldImage(images[k]!);
  // The cut rhythm (src/render/structure.ts): off, every cap is Infinity and nothing below changes.
  // With entryPace (a ranking, LONG_ENTRY_PACE) every entry gets a burst of its own as well.
  const bursts = input.rhythm
    ? rhythmBursts(segments, totalFrames, LONG_FPS, input.entryPace).all
    : [];
  const cap = (at: number) =>
    input.rhythm
      ? shotCap(at, LONG_FPS, bursts)
      : { still: Number.POSITIVE_INFINITY, clip: Number.POSITIVE_INFINITY };
  /** Fills [from, to) with a queue of media, never stretching a clip and never leaving a sliver. */
  const fill = (
    seg: number,
    from: number,
    to: number,
    queue: LongMedia[],
    fallback: () => LongMedia,
    stillFallback?: () => LongMedia,
  ) => {
    let at = from;
    while (at < to) {
      const remaining = to - at;
      if (
        remaining < MIN_SHOT &&
        shots.length &&
        shots[shots.length - 1]!.segment === seg &&
        shots[shots.length - 1]!.media.type !== "clip" &&
        // A filler shot is timed to its sentence (and a reconstruction to its clip): it is not stretched.
        shots[shots.length - 1]!.media.type !== "filler"
      ) {
        shots[shots.length - 1]!.end = to;
        break;
      }
      let media = queue.shift() ?? fallback();
      if (same(last, media) && queue.length) {
        queue.push(media);
        media = queue.shift()!;
      }
      let len: number;
      const most = cap(at);
      if (media.type === "clip") {
        len = Math.min(clipFrames[media.index]!, remaining, most.clip);
        const left = remaining - len;
        if (left > 0 && left < MIN_CLIP_SHOT) len -= MIN_CLIP_SHOT - left;
        if (len < MIN_CLIP_SHOT) {
          // Too short for the gap: take the fallback, but a clip it hands back is still a clip.
          // Stretching it as if it were a still froze it on its last frame and left it free to play again.
          let alt = fallback();
          if (alt.type === "clip") {
            const l = Math.min(clipFrames[alt.index]!, remaining, most.clip);
            const rest = remaining - l;
            if (l >= MIN_CLIP_SHOT && (rest === 0 || rest >= MIN_CLIP_SHOT)) {
              media = alt;
              len = l;
              spend(alt.index);
            } else alt = stillFallback?.() ?? { type: "plate", index: 0 };
          }
          if (alt.type !== "clip") {
            media = alt;
            len = Math.min(MAX_STILL_SHOT, remaining, most.still);
          }
        } else spend(media.index);
      } else {
        len = Math.min(
          STILL_SHOT + ((shotIndex * 37 + variant * 11) % 60) - 30,
          remaining,
          MAX_STILL_SHOT,
          most.still,
        );
        if (remaining - len < MIN_SHOT) len = remaining;
      }
      if (media.type === "image") stillUses[media.index]!++;
      shots.push({
        start: at,
        end: at + len,
        segment: seg,
        media,
        move:
          shotIndex === 0
            ? "pushIn"
            : MOVES[(shotIndex * 7 + variant) % MOVES.length]!,
      });
      last = media;
      at += len;
      shotIndex++;
    }
  };

  /**
   * A sentence's filler shot over [from, to), or undefined when the window is too short for it to land. It
   * runs to the window's end, or to its family's longest (fillerMaxFrames) with the chapter's pictures after;
   * a sliver of under MIN_SHOT left behind joins the filler, except a reconstruction's, which stops short
   * of its clip's last frame instead.
   */
  const fillerShot = (
    fl: MomentFiller | undefined,
    w: MomentWindow,
    from: number,
    to: number,
  ): Omit<LongShot, "segment"> | undefined => {
    if (!fl) return undefined;
    const room = to - from;
    const most = fillerMaxFrames(fl, LONG_FPS);
    if (room < FILLER_MIN_FRAMES || most < FILLER_MIN_FRAMES) return undefined;
    // It shows its own sentence: it ends half a second after the sentence does, not when the next
    // sentence's picture would arrive (the chapter's footage bridges the gap).
    const own = Math.max(FILLER_MIN_FRAMES, toFrame(w.end) - from + 15);
    let len = Math.min(room, most, own);
    const rest = room - len;
    if (rest > 0 && rest < MIN_SHOT) {
      if (fl.family !== "recon") len = room;
      else if (room - MIN_SHOT >= FILLER_MIN_FRAMES) len = room - MIN_SHOT;
      else return undefined;
    }
    const times =
      fl.family === "kinetic"
        ? wordTimes(
            (fl.data as KineticFillerData).card.tokens,
            shotWords(input.words, w.start, w.end, 0),
            from / LONG_FPS,
          )
        : undefined;
    return {
      start: from,
      end: from + len,
      media: { type: "filler", index: w.moment, entry: w.entry },
      move: "settle",
      settle: fillerSettle(fl, len, LONG_FPS, times),
    };
  };

  for (const [i, seg] of segments.entries()) {
    const start = i === 0 ? 0 : toFrame(seg.start);
    const end =
      i === segments.length - 1 ? totalFrames : toFrame(segments[i + 1]!.start);
    if (end - start <= 0) continue;
    const entry = entryOf(segments, i, input.takeEntry);
    // A ranking entry with a shot list: each sentence opens on what it names.
    const mine =
      seg.kind === "beat" ? windows.filter((w) => w.segment === i) : [];
    if (mine.length && entry !== undefined) {
      const allEntry = images
        .map((_, k) => k)
        .filter(
          (k) =>
            images[k]!.beatIndex === entry &&
            images[k]!.kind !== "capsule" &&
            images[k]!.kind !== "portrait" &&
            // A real-world picture pinned to no sentence could be any building: it is not shown.
            !(real(k) && images[k]!.moment === undefined),
        );
      // Key art stays out of the rotation when there is enough else, unless a sentence was given it.
      const noHero = allEntry.filter(
        (k) => images[k]!.kind !== "hero" || images[k]!.moment !== undefined,
      );
      const entryImages = noHero.length >= 4 ? noHero : allEntry;
      const entryClips = clips
        .map((_, k) => k)
        .filter((k) => clips[k]!.beatIndex === entry);
      let reuse = 0;
      // The sentence being filled: filler never shows a picture chosen for another sentence (30 Oct 2026
      // shot audit: 11% of the Vice City documentary showed a sentence's picture two or more lines away from
      // it, such as David Jones's photo while the narrator talked about Keith Hamilton).
      let current = 0;
      const leastUsed = (): LongMedia => {
        // An entry with no picture of its own never borrows the topic's art: for "Grand Theft Auto" that was
        // GTA V's key art under GTA Advance. It replays its own footage, or shows the branded plate.
        // An unplayed clip first: replaying one the chapter already showed repeats a moment (31 Oct 2026).
        const own = (): LongMedia => {
          const fresh = entryClips.find((k) => !clipUsed[k]);
          if (fresh !== undefined) return { type: "clip", index: fresh };
          return entryClips.length && !input.noRepeats
            ? { type: "clip", index: entryClips[reuse++ % entryClips.length]! }
            : { type: "plate", index: 0 };
        };
        if (!entryImages.length) return own();
        const free = entryImages.filter((k) =>
          real(k)
            ? realWorldMayFill(images[k]!.moment, current)
            : fillerFor(images[k]!.moment, current),
        );
        // Out of free pictures, game art may stand in for another sentence's; a real-world picture never does.
        const pool = free.length ? free : entryImages.filter((k) => !real(k));
        if (!pool.length) return own();
        // Least shown first; on a tie, a different kind from the last still (a documentary alternates the
        // game's art with archive photos of the real story instead of three office photos in a row).
        const lastKind =
          last?.type === "image" ? images[last.index]?.kind : undefined;
        const otherKind = (k: number) =>
          lastKind && images[k]!.kind === lastKind ? 1 : 0;
        const pick =
          [...pool]
            .sort(
              (a, b) =>
                stillUses[a]! - stillUses[b]! ||
                otherKind(a) - otherKind(b) ||
                a - b,
            )
            .find((k) => !same(last, { type: "image", index: k })) ?? pool[0]!;
        return { type: "image", index: pick };
      };
      const fillerOf = (k: number) =>
        input.momentFillers?.[entry]?.[mine[k]!.moment];
      // A sentence's picture arrives as the narrator names its subject, not when the sentence starts; a
      // filler visual opens with the sentence's first word (its type and marks land on the words as said).
      // The sentence before keeps at least MIN_SHOT of its own picture, and a filler never opens after the
      // sentence's key word would have brought its picture.
      const opening = (k: number): number =>
        k === 0
          ? start
          : fillerOf(k)
            ? Math.max(
                start,
                Math.min(
                  toFrame(mine[k]!.at),
                  Math.max(toFrame(mine[k]!.start), opening(k - 1) + MIN_SHOT),
                ),
              )
            : Math.max(start, toFrame(mine[k]!.at));
      for (const [j, w] of mine.entries()) {
        current = w.moment;
        const from = opening(j);
        const to = j === mine.length - 1 ? end : Math.min(end, opening(j + 1));
        if (to <= from) continue;
        // Every clip picked for this sentence (a trailer moment and a gameplay moment), then its still.
        const mineClips = entryClips.filter(
          // A clip the cold open previewed still plays on its own sentence (30 Oct 2026 audit: the preview
          // used it up and the sentence it was found for never showed it).
          (k) =>
            clips[k]!.moment === w.moment && (!clipUsed[k] || previewed.has(k)),
        );
        const mineStills = entryImages.filter(
          (k) => images[k]!.moment === w.moment,
        );
        // A real photo picked for the sentence (the person it names, the real place) is what the sentence is
        // about, so it opens the sentence; a sentence's footage usually fills it, and a photo queued behind the
        // footage never played (30 Oct 2026: five people's photos were found and none was shown).
        const photos = mineStills.filter((k) => images[k]!.kind === "photo");
        const stills = mineStills.filter((k) => images[k]!.kind !== "photo");
        const still = mineStills[0];
        const queue: LongMedia[] = [];
        // The entry opens on its art so the rank card lands over a picture; later sentences open on footage.
        // With no picture of its own for the first sentence it borrows the entry's art: a dark clip under the rank card reads as an empty frame.
        if (w.moment === 0) {
          const borrowed =
            still === undefined && entryImages.length ? leastUsed() : undefined;
          const opener =
            still ?? (borrowed?.type === "image" ? borrowed.index : undefined);
          if (opener !== undefined)
            queue.push({ type: "image", index: opener });
        } else for (const k of photos) queue.push({ type: "image", index: k });
        for (const k of mineClips) queue.push({ type: "clip", index: k });
        if (w.moment !== 0)
          for (const k of stills) queue.push({ type: "image", index: k });
        // When the sentence's own media runs out, any unused footage of the entry comes before another still,
        // but never a clip picked for a sentence still to come (a chapter's B-roll would play a minute early).
        // A spare clip of a sentence just gone comes first (it shows the same thing); footage matched to no
        // sentence is spread across the chapter instead of all playing in its first minute and leaving the
        // rest to stills (29 Oct 2026 review).
        const footageFirst = (): LongMedia => {
          const loose = entryClips.filter(
            (k) => clips[k]!.moment === undefined,
          );
          const looseUsed = loose.filter((k) => clipUsed[k]).length;
          const looseOk =
            looseUsed < Math.ceil(((j + 1) / mine.length) * loose.length);
          const spare = entryClips
            .filter(
              (k) =>
                !clipUsed[k] &&
                (clips[k]!.moment === undefined
                  ? looseOk
                  : fillerFor(clips[k]!.moment, w.moment)) &&
                !queue.some((q) => q.type === "clip" && q.index === k),
            )
            .sort(
              (a, b) =>
                w.moment -
                (clips[a]!.moment ?? -999) -
                (w.moment - (clips[b]!.moment ?? -999)),
            )[0];
          return spare !== undefined
            ? { type: "clip", index: spare }
            : leastUsed();
        };
        const shot = fillerShot(fillerOf(j), w, from, to);
        if (shot) {
          shots.push({ ...shot, segment: i });
          last = shot.media;
          shotIndex++;
          // A reconstruction's clip matched to no sentence does not also play as the chapter's footage.
          const fl = fillerOf(j)!;
          if (fl.family === "recon") {
            const c = (fl.data as { clip: number }).clip;
            if (clips[c] && clips[c]!.moment === undefined) spend(c);
          }
          // A sentence given a filler had no own media but a stock clip at most: the filler replaces it, so
          // the stock never plays (not after the filler, nor under the next sentence).
          for (const k of mineClips) spend(k);
          if (shot.end < to)
            fill(
              i,
              shot.end,
              to,
              queue.filter((q) => q.type !== "clip"),
              footageFirst,
              leastUsed,
            );
        } else fill(i, from, to, queue, footageFirst, leastUsed);
      }
      continue;
    }
    // The pool: the entry's own media, or the topic's untagged media for the intro; the outro may reuse the winner's.
    const ownClips = clips
      .map((c, k) => k)
      .filter(
        (k) =>
          (entry === undefined
            ? clips[k]!.beatIndex === undefined
            : clips[k]!.beatIndex === entry) &&
          (seg.kind === "take" || !clipUsed[k]),
      );
    // No sentence plays here (the intro, the outro, a chapter without a shot list): no real-world picture.
    const ownStills = images
      .map((_, k) => k)
      .filter(
        (k) =>
          !real(k) &&
          (entry === undefined
            ? images[k]!.beatIndex === undefined
            : images[k]!.beatIndex === entry),
      );
    // The intro of a ranking is a montage: the topic's own art plus one picture from every entry.
    const montage =
      seg.kind === "hook" && images.some((im) => im.beatIndex !== undefined)
        ? [
            ...new Set(
              images
                .map((im) => im.beatIndex)
                .filter((b): b is number => b !== undefined),
            ),
          ]
            .map((b) =>
              images.findIndex(
                (im, n) =>
                  im.beatIndex === b &&
                  (im.kind === "screenshot" || im.kind === "photo") &&
                  !real(n),
              ),
            )
            .filter((k) => k >= 0)
        : [];
    const stills = ownStills.length
      ? [...ownStills, ...montage]
      : [
          ...images
            .map((_, k) => k)
            .filter((k) => images[k]!.beatIndex === undefined && !real(k)),
          ...montage,
        ];
    // Wide art first on a still shot: hero, screenshots, then the rest; capsules (portrait) come last.
    const sorted = [...stills].sort(
      (a, b) => stillRank(images[a]!) - stillRank(images[b]!) || a - b,
    );
    // A documentary chapter alternates the game's pictures with archive photos of the real story.
    const photos = sorted.filter((k) => images[k]!.kind === "photo");
    const others = sorted.filter((k) => images[k]!.kind !== "photo");
    const order: number[] = [];
    for (let k = 0; k < Math.max(photos.length, others.length); k++) {
      if (others[k] !== undefined) order.push(others[k]!);
      if (photos[k] !== undefined) order.push(photos[k]!);
    }
    // A documentary's cold open previews its chapters: each sentence shows the matched shot of the chapter
    // sentence it shares the most names with ("a small team in Dundee" opens on the Dundee photo), and the
    // montage fills the rest (29 Oct 2026 review: the opening minute was a title over unrelated stock).
    // The closing recap previews them the same way (it was almost all stock footage).
    if (
      (seg.kind === "hook" || seg.kind === "take") &&
      input.momentShows?.length
    ) {
      const sentences = splitSentences(seg.text);
      const segEnd =
        i === segments.length - 1 ? seg.end : segments[i + 1]!.start;
      const ws = input.words.filter(
        (w) => w.start >= seg.start - 0.05 && w.start < segEnd,
      );
      const taken = new Set<string>();
      let idx = 0;
      const plans = sentences.map((x, j) => {
        const from =
          j === 0
            ? start
            : Math.max(start, toFrame(ws[idx]?.start ?? seg.start));
        idx += x.split(/\s+/).filter(Boolean).length;
        return {
          from,
          best: previewShot(
            x,
            input.momentShows!,
            taken,
            images,
            clips,
            clipUsed,
          ),
        };
      });
      if (plans.some((p) => p.best)) {
        let cursor = 0;
        const generic = (): LongMedia => {
          const own = ownClips.find((k) => !clipUsed[k]);
          if (own !== undefined && cursor % 2 === 0) {
            cursor++;
            return { type: "clip", index: own };
          }
          cursor++;
          return order.length
            ? { type: "image", index: order[cursor % order.length]! }
            : { type: "plate", index: 0 };
        };
        const genericStill = (): LongMedia =>
          order.length
            ? { type: "image", index: order[cursor++ % order.length]! }
            : { type: "plate", index: 0 };
        for (const [j, p] of plans.entries()) {
          const to =
            j === plans.length - 1 ? end : Math.min(end, plans[j + 1]!.from);
          if (to <= p.from) continue;
          if (p.best?.type === "clip") previewed.add(p.best.index);
          fill(i, p.from, to, p.best ? [p.best] : [], generic, genericStill);
        }
        continue;
      }
    }
    let at = start;
    let turn = seg.kind === "hook" ? 0 : 1; // the intro opens on a moment; an entry opens on its art so the card lands over a picture
    let stillCursor = cursors.get(entry) ?? 0;
    while (at < end) {
      const remaining = end - at;
      const nextStill = (): LongMedia | undefined => {
        if (!order.length) return undefined;
        let pick = order[stillCursor % order.length]!;
        if (same(last, { type: "image", index: pick }) && order.length > 1)
          pick = order[(stillCursor + 1) % order.length]!;
        stillCursor++;
        stillUses[pick]!++;
        return { type: "image", index: pick };
      };
      // A sliver left by segment rounding joins the previous still, or becomes a brief still of its own:
      // a clip shot is never stretched past its clip, which would play as black.
      if (remaining < MIN_SHOT && shots.length) {
        const prev = shots[shots.length - 1]!;
        if (prev.media.type !== "clip" && prev.segment === i) prev.end = end;
        else {
          const media = nextStill() ?? { type: "plate" as const, index: 0 };
          shots.push({ start: at, end, segment: i, media, move: "settle" });
          last = media;
        }
        at = end;
        break;
      }
      let media: LongMedia | undefined;
      let len = 0;
      // Footage first: a still only when this entry's clips have run out (it once alternated, leaving half the video on stills).
      const wantClip = true;
      const clipIdx = wantClip
        ? ownClips.find((k) => !clipUsed[k] || seg.kind === "take")
        : undefined;
      const most = cap(at);
      if (clipIdx !== undefined) {
        // The clip plays only as long as it lasts; what it would leave behind must be a whole shot.
        let clipLen = Math.min(clipFrames[clipIdx]!, remaining, most.clip);
        const left = remaining - clipLen;
        if (left > 0 && left < MIN_CLIP_SHOT) clipLen -= MIN_CLIP_SHOT - left;
        if (clipLen >= MIN_CLIP_SHOT) {
          media = { type: "clip", index: clipIdx };
          spend(clipIdx);
          if (seg.kind === "take")
            ownClips.splice(ownClips.indexOf(clipIdx), 1);
          len = clipLen;
        }
      }
      if (!media) {
        media = nextStill();
        if (media) {
          len = Math.min(
            STILL_SHOT + ((shotIndex * 37 + variant * 11) % 60) - 30,
            remaining,
            MAX_STILL_SHOT,
            most.still,
          );
        } else {
          media = { type: "plate", index: 0 };
          len = Math.min(MAX_STILL_SHOT, remaining);
        }
        // A short tail is folded into this still rather than left as a flash.
        if (remaining - len < MIN_SHOT) len = remaining;
      }
      shots.push({
        start: at,
        end: at + len,
        segment: i,
        media,
        move:
          shotIndex === 0
            ? "pushIn"
            : MOVES[(shotIndex * 7 + variant) % MOVES.length]!,
      });
      last = media;
      at += len;
      shotIndex++;
      turn++;
    }
    cursors.set(entry, stillCursor);
  }
  // Never the same still twice in a row: the second would restart its move and visibly jump. Hold the first instead.
  const merged: LongShot[] = [];
  for (const sh of shots) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.media.type === "image" &&
      sh.media.type === "image" &&
      prev.media.index === sh.media.index &&
      prev.end === sh.start
    )
      prev.end = sh.end;
    else merged.push({ ...sh });
  }
  const done: LongPlan = {
    version: 1,
    fps: LONG_FPS,
    totalFrames,
    tailFrames,
    shots: merged,
  };
  return input.bookend
    ? bookendEcho(
        done,
        segments,
        input.words,
        clipFrames,
        input.coldOpenFrames ?? 0,
      )
    : done;
}

function stillRank(img: LongImage): number {
  if (img.kind === "hero") return 0;
  if (img.kind === "screenshot") return 1;
  if (img.kind === "header" || img.kind === "article") return 2;
  return 3;
}

/**
 * A documentary's breathers belong to the chapter that follows: its segment opens when the breather
 * does, so the new chapter's title and pictures arrive with the music instead of after it.
 */
export function openChaptersAtBreaks(
  segments: Segment[],
  breaks: Array<{ start: number; end: number }> | undefined,
): Segment[] {
  const out = segments.map((s) => ({ ...s }));
  for (const b of breaks ?? []) {
    const i = out.findIndex(
      (s) =>
        s.kind === "beat" &&
        s.visual?.kind === "chapter" &&
        s.start >= b.start - 0.05 &&
        s.start <= b.end + 1.5,
    );
    if (i <= 0) continue;
    out[i]!.start = b.start;
    out[i - 1]!.end = Math.min(out[i - 1]!.end, b.start);
  }
  return out;
}

/** The shot on screen at a frame. */
export function longShotAt(
  plan: LongPlan,
  frame: number,
): LongShot | undefined {
  return (
    plan.shots.find((s) => frame >= s.start && frame < s.end) ??
    plan.shots.at(-1)
  );
}

/** Chapter marks for the description: the intro at 0:00, then each entry, then the pick. */
export function chapterLines(
  segments: Segment[],
  labels: (seg: Segment, i: number) => string | undefined,
): string[] {
  const out: string[] = [];
  for (const [i, seg] of segments.entries()) {
    const label = labels(seg, i);
    if (!label) continue;
    const t = i === 0 ? 0 : Math.max(0, Math.floor(seg.start));
    // YouTube wants the first chapter at 0:00 and every chapter at least ten seconds long.
    const prev = out.at(-1);
    if (
      prev &&
      t -
        Number(
          prev
            .split(" ")[0]!
            .split(":")
            .reduce((a, b) => a * 60 + Number(b), 0),
        ) <
        10
    )
      continue;
    const m = Math.floor(t / 60);
    const s = String(t % 60).padStart(2, "0");
    out.push(`${m}:${s} ${label}`);
  }
  return out;
}

/**
 * A long game name breaks after its colon, so the series and the subtitle each
 * keep their words together: "CALL OF DUTY 4:" over "MODERN WARFARE".
 */
export function titleLines(text: string): string[] {
  const i = text.indexOf(": ");
  if (i > 0 && text.length > 20)
    return [text.slice(0, i + 1), text.slice(i + 2)];
  // "Call of Duty Campaigns Ranked": the franchise on top, what is ranked underneath.
  const ranked = text.match(/^(\S+(?:\s+\S+)+?)\s+(\S+\s+Ranked\b.*)$/i);
  if (ranked && text.length > 20) return [ranked[1]!, ranked[2]!];
  // Any other long title splits at the word that best balances two lines: kept on one line it ran off the
  // frame (29 Oct 2026: "WHY GRAND THEFT AUTO WENT BACK TO VICE", its "CITY" cut off).
  const words = text.split(/\s+/);
  if (text.length <= 22 || words.length < 2) return [text];
  const worst = (n: number) =>
    Math.max(
      words.slice(0, n).join(" ").length,
      words.slice(n).join(" ").length,
    );
  let best = 1;
  for (let k = 2; k < words.length; k++) if (worst(k) < worst(best)) best = k;
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

/** A graphic worth showing: never the entry's own rank (the rank card already says it). */
export function usefulGraphic<
  G extends { kind: string; primary: string; secondary: string },
>(g: G): boolean {
  if (g.kind === "none") return false;
  // A documentary's quote or timeline never restates a rank ("the best place to work" is not a ranking).
  if (
    [
      "quote",
      "timeline",
      "headline",
      "delay",
      "span",
      "reviews",
      "versus",
      "source",
      "milestone",
      "people",
      "map",
      "bars",
      "share",
      "specs",
      "lineage",
    ].includes(g.kind)
  )
    return Boolean(
      g.primary.trim() || g.kind === "timeline" || g.kind === "map",
    );
  const text = `${g.primary} ${g.secondary}`;
  if (
    /\b(rank(ing)?|position|place[sd]?|spot|on the list|where it lands|entry number)\b/i.test(
      text,
    )
  )
    return false;
  if (
    /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|#?\d{1,2})$/i.test(
      g.primary.trim(),
    )
  )
    return g.kind === "score" && /\d/.test(g.primary);
  return true;
}

const LOOSE_END = new Set([
  "a",
  "an",
  "the",
  "at",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "and",
  "or",
  "but",
  "by",
  "from",
  "as",
  "its",
  "his",
  "her",
  "their",
  "is",
  "was",
  "that",
]);

/** A pop-up phrase that reads as a phrase: not a fragment ending on "at" or "the". */
export function usefulEmphasis(text: string): boolean {
  const words = text
    .trim()
    .replace(/[.,;:!?]+$/, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || words.join(" ").length < 3) return false;
  return (
    !LOOSE_END.has(words[words.length - 1]!.toLowerCase()) &&
    !LOOSE_END.has(words[0]!.toLowerCase())
  );
}

/** Game sound sits well under the narrator and fades in and out at each cut so a cut never pops. */
export const GAME_SOUND_VOLUME = 0.16;
export function gameSoundVolume(
  frame: number,
  frames: number,
  fade = 8,
): number {
  const edge = Math.min(1, frame / fade, (frames - frame) / fade);
  return GAME_SOUND_VOLUME * Math.max(0, edge);
}

/**
 * Entries a plan leaves thin: on the branded plate for more than 15 s, or showing one clip or still more
 * than three times. GTA Advance sat on the plate for 70 s and Liberty City Stories looped its clips
 * (GTA ranking, 23 Oct 2026); the render step tops such entries up before rendering.
 */
export function planGaps(
  plan: LongPlan,
  segments: Segment[],
  takeEntry?: number,
): Array<{ entry: number; plateSeconds: number; maxRepeat: number }> {
  const by = new Map<number, { plate: number; uses: Map<string, number> }>();
  for (const s of plan.shots) {
    if (segments[s.segment]?.kind !== "beat") continue;
    const e = entryOf(segments, s.segment, takeEntry);
    if (e === undefined) continue;
    const g = by.get(e) ?? by.set(e, { plate: 0, uses: new Map() }).get(e)!;
    if (s.media.type === "plate") g.plate += s.end - s.start;
    else {
      const k = `${s.media.type}${s.media.index}`;
      g.uses.set(k, (g.uses.get(k) ?? 0) + 1);
    }
  }
  return [...by]
    .map(([entry, g]) => ({
      entry,
      plateSeconds: Math.round(g.plate / plan.fps),
      maxRepeat: Math.max(0, ...g.uses.values()),
    }))
    .filter((x) => x.plateSeconds > 15 || x.maxRepeat > 3);
}

/**
 * Whether the person a sentence names is actually on screen while its name tag would show: a shot in the span
 * plays a photo or portrait picked for that sentence. 30 Oct 2026 review: "KEITH HAMILTON" was drawn with an
 * arrow onto a road in GTA 1 gameplay; a name tag belongs on the person, as a human editor would place it.
 */
export function personOnScreen(
  shots: LongShot[],
  images: Array<{ kind: string; beatIndex?: number; moment?: number }>,
  entry: number,
  moment: number,
  from: number,
  len: number,
): boolean {
  return shots.some((s) => {
    if (s.media.type !== "image" || s.end <= from || s.start >= from + len)
      return false;
    const im = images[s.media.index];
    return (
      !!im &&
      im.beatIndex === entry &&
      im.moment === moment &&
      (im.kind === "photo" || im.kind === "portrait")
    );
  });
}
