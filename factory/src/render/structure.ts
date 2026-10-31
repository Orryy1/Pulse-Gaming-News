// A documentary's structure on screen, the devices the 31 Oct 2026 creator study found the long-form missing
// (creator_techniques.md, top 25 nos. 8, 14, 15, 20 and 21). Pure planning, kept free of React so the
// pipeline and the tests share it; src/render/components/Structure.tsx draws what this decides.
//  - The title drop (LEMMiNO): the title is not shown at the start; it lands as a designed card on the cold
//    open's last beat, in the breather before the first chapter when there is one.
//  - The chapter index and year counter (Ahoy, Gaming Historian): a slim row of chapter numbers with the
//    current one lit, and the chapter's year in the corner, rolling like an odometer when it changes.
//  - Open-loop callbacks: when the narrator answers a question raised minutes earlier, a small card recalls
//    the shot that was on screen when it was raised (src/editorial/openloops.ts plants and places them).
//  - Cut rhythm (retention guides, MrBeast's memo): tighter cuts in the first three minutes, then a short
//    burst of quicker cuts every two and a half minutes, never over a chapter's opening card.
//  - The bookend ending (LEMMiNO, Fern): the outro's last shot is the cold open's first picture with the
//    camera move reversed.
// Since 31 Oct 2026 every long format uses them (src/longformat.ts): a ranking's chapters are its entries (the
// "rank" beats), the index counts down its ranks and the corner shows the rank where an entry has no year,
// and each entry gets a burst of quicker cuts of its own (entryBursts), the pace a Short keeps.

import type { Segment } from "./timeline.ts";
import type {
  LongMedia,
  LongPlan,
  LongShot,
  MomentWindow,
} from "./longplan.ts";
import type { MovePreset } from "./motion.ts";

const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'‘])/)
    .map((x) => x.trim())
    .filter(Boolean);

type Frames = { from: number; to: number };

/** A segment that opens a chapter: a documentary's or recap's chapter card, or a ranking's entry. */
export const opensChapter = (s: Pick<Segment, "kind" | "visual">): boolean =>
  s.kind === "beat" &&
  (s.visual?.kind === "chapter" || s.visual?.kind === "rank");
type TimedWord = { start: number; end: number; text?: string };

/** Each sentence's first spoken frame in a segment, from the voice's word timings (the hook has no shot list). */
export function sentenceStartFrames(
  seg: Pick<Segment, "text" | "start">,
  segEnd: number,
  words: readonly TimedWord[],
  fps: number,
): number[] {
  const ws = words.filter(
    (w) => w.start >= seg.start - 0.05 && w.start < segEnd,
  );
  const out: number[] = [];
  let idx = 0;
  for (const [j, x] of sentencesOf(seg.text).entries()) {
    out.push(
      Math.round((j === 0 ? seg.start : (ws[idx]?.start ?? seg.start)) * fps),
    );
    idx += x.split(/\s+/).filter(Boolean).length;
  }
  return out;
}

// ---------------------------------------------------------------- title drop

/** The title card holds at least this long, and at most this long when it covers narration. */
export const TITLE_DROP_MIN_SECONDS = 3.5;
export const TITLE_DROP_MAX_SECONDS = 6;
/** Never before this far into the video: the signature opening and the first pictures come first. */
export const TITLE_DROP_EARLIEST_SECONDS = 10;

export interface TitleDrop {
  /** First frame of the card. */
  from: number;
  /** Frames it lasts. */
  len: number;
  /** Frame within the card that the title lands on (the last word of the cold open, or soon after the card opens). */
  landAt: number;
  /** The chapter segment whose breather the card fills (its own interlude is left out then). */
  breakSegment?: number;
}

/**
 * Where the title drops (pure): the hook's last sentence ends and the first chapter's breather follows, so the
 * title lands as the narrator falls silent and holds through the breather (with half a second of lead-in);
 * with no breather, it covers the hook's last sentence, TITLE_DROP_MIN_SECONDS to TITLE_DROP_MAX_SECONDS.
 * Undefined when there is no hook or it is too short to carry a drop after the opening.
 */
export function titleDropWindow(
  segments: readonly Segment[],
  words: readonly TimedWord[],
  fps: number,
  breaks: readonly Frames[] = [],
): TitleDrop | undefined {
  const h = segments.findIndex((s) => s.kind === "hook");
  const next = segments[h + 1];
  if (h < 0 || !next) return undefined;
  const hook = segments[h]!;
  const hookEnd = Math.round(next.start * fps);
  const earliest = Math.round(TITLE_DROP_EARLIEST_SECONDS * fps);
  const min = Math.round(TITLE_DROP_MIN_SECONDS * fps);
  const b = breaks.find(
    (x) => Math.abs(x.from - hookEnd) <= 3 && x.to > x.from,
  );
  if (b) {
    const from = Math.max(
      earliest,
      Math.min(b.from - Math.round(fps * 0.5), b.to - min),
    );
    if (b.to - from < min) return undefined;
    return {
      from,
      len: b.to - from,
      landAt: Math.max(0, b.from - from),
      breakSegment:
        next.kind === "beat" && next.visual?.kind === "chapter"
          ? h + 1
          : undefined,
    };
  }
  const starts = sentenceStartFrames(hook, next.start, words, fps);
  const last = starts.at(-1) ?? hookEnd;
  let from = Math.max(last, hookEnd - Math.round(TITLE_DROP_MAX_SECONDS * fps));
  if (hookEnd - from < min) from = hookEnd - min;
  if (from < earliest) return undefined;
  return {
    from,
    len: hookEnd - from,
    landAt: Math.min(12, hookEnd - from - 1),
  };
}

// ---------------------------------------------------------------- chapter index and year counter

export interface ChapterMark {
  /** The chapter's number as its card shows it. */
  number: number;
  title: string;
  /** Frame the chapter opens (its breather, when it has one). */
  from: number;
  /** Frame its narration starts, after the breather. */
  shownFrom: number;
  /** Frame the next chapter (or the outro) opens. */
  to: number;
  /** The chapter's year, when it is about one period. */
  year?: number;
  /** A ranking's entry: its rank (the index counts down them; the corner shows it when there is no year). */
  rank?: number;
}

/** A year worth showing: four digits from the arcade age to the near future. */
const goodYear = (y: number) => Number.isInteger(y) && y >= 1950 && y <= 2100;

/**
 * The documentary's chapters on the timeline (pure): each chapter card's segment, from its breather to the
 * next chapter or the outro. `starts` are the segments' first frames.
 */
export function chapterMarks(
  segments: readonly Segment[],
  starts: readonly number[],
  durationInFrames: number,
  breaks: readonly Frames[] = [],
): ChapterMark[] {
  const out: ChapterMark[] = [];
  for (const [i, s] of segments.entries()) {
    if (!opensChapter(s) || !s.visual) continue;
    const from = starts[i]!;
    const b = breaks.find((x) => Math.abs(x.from - from) <= 3);
    let to = durationInFrames;
    for (let k = i + 1; k < segments.length; k++) {
      const x = segments[k]!;
      if (x.kind !== "beat" || opensChapter(x)) {
        to = starts[k]!;
        break;
      }
    }
    const year = Number(s.visual.items?.[0]);
    out.push({
      number: s.visual.value_a ?? out.length + 1,
      title: s.visual.primary,
      from,
      shownFrom: b ? Math.max(from, b.to) : from,
      to,
      year: goodYear(year) ? year : undefined,
      rank:
        s.visual.kind === "rank" && typeof s.visual.value_a === "number"
          ? s.visual.value_a
          : undefined,
    });
  }
  return out;
}

/** Frames the index and the counter take to fade in after a breather, and out before the next one. */
export const INDEX_FADE = 12;

/**
 * What the index shows at a frame (pure): the chapter on screen (-1 before the first or after the last) and
 * how visible the strip is. Hidden in every breather (the interlude card says the chapter itself), during
 * the cold open and the outro, and from `endFrom` (the end card) on.
 */
export function indexAt(
  marks: readonly ChapterMark[],
  frame: number,
  endFrom = Number.POSITIVE_INFINITY,
): { current: number; opacity: number } {
  const k = marks.findIndex((m) => frame >= m.from && frame < m.to);
  if (k < 0 || frame >= endFrom) return { current: -1, opacity: 0 };
  const m = marks[k]!;
  if (frame < m.shownFrom) return { current: k, opacity: 0 };
  const fadeIn = Math.min(1, (frame - m.shownFrom) / INDEX_FADE);
  const fadeOut = Math.min(1, (Math.min(m.to, endFrom) - frame) / INDEX_FADE);
  return { current: k, opacity: Math.max(0, Math.min(fadeIn, fadeOut)) };
}

/** Frames the year counter takes to roll from one year to the next. */
export const YEAR_ROLL_FRAMES = 24;

/**
 * The year counter at a frame (pure): the current chapter's year and the year it rolls from (the last
 * chapter that had one), how far the roll has gone (0-1) and how visible it is. Absent when the chapter has
 * no year or the index is hidden.
 */
export function yearAt(
  marks: readonly ChapterMark[],
  frame: number,
  endFrom = Number.POSITIVE_INFINITY,
):
  | {
      year: number;
      from: number;
      roll: number;
      opacity: number;
      /** "#" when the counter shows a ranking entry's rank (it has no year). */
      prefix?: "#";
    }
  | undefined {
  const { current, opacity } = indexAt(marks, frame, endFrom);
  const m = marks[current];
  if (!m || opacity <= 0) return undefined;
  const roll = Math.max(
    0,
    Math.min(1, (frame - m.shownFrom) / YEAR_ROLL_FRAMES),
  );
  if (!m.year) {
    // A ranking entry without a year: its rank, rolling down from the entry before.
    if (m.rank === undefined) return undefined;
    const prev = marks[current - 1]?.rank;
    return { year: m.rank, from: prev ?? m.rank, roll, opacity, prefix: "#" };
  }
  const before = marks
    .slice(0, current)
    .reverse()
    .find((x) => x.year)?.year;
  return { year: m.year, from: before ?? m.year, roll, opacity };
}

/** One digit column of the odometer: the digit leaving and the one arriving, and how far the arriving one has risen. */
export function odometerDigits(
  from: number,
  to: number,
  roll: number,
  /** Digit columns: 4 for a year, 2 for a rank. */
  width = 4,
): Array<{ out: string; in: string; t: number }> {
  const a = String(from).padStart(width, "0");
  const b = String(to).padStart(width, "0");
  // The rightmost digits move first and the leftmost last, as a mechanical counter does.
  return [...b].map((d, i) => {
    const delay = (b.length - 1 - i) * 0.12;
    const t =
      a[i] === d
        ? 1
        : Math.max(0, Math.min(1, (roll - delay) / Math.max(0.01, 1 - delay)));
    return { out: a[i]!, in: d, t };
  });
}

// ---------------------------------------------------------------- open-loop callbacks

/** An open loop placed on the script (src/editorial/openloops.ts LoopPlacement): entry -1 is the cold open. */
export interface LoopCue {
  question: string;
  plant: { entry: number; moment: number };
  payoff: { entry: number; moment: number };
}

/** How long the recall card holds, and the least time between a question and its answer for one to show. */
export const CUE_SECONDS = 4;
export const CUE_MIN_GAP_SECONDS = 90;
/** The recall card's line: the question, cut at a word past this many characters. */
export const CUE_TEXT_MAX = 78;

export interface CallbackCue {
  from: number;
  len: number;
  /** The frame the question was raised: the recall shows what was on screen then. */
  plantFrame: number;
  text: string;
}

/** The question as the recall card prints it: one line of at most CUE_TEXT_MAX characters, cut at a word. */
export function cueText(question: string): string {
  const q = question.replace(/\s+/g, " ").trim();
  if (q.length <= CUE_TEXT_MAX) return q;
  const cut = q.slice(0, CUE_TEXT_MAX);
  const at = cut.lastIndexOf(" ");
  return `${cut.slice(0, at > 30 ? at : CUE_TEXT_MAX).replace(/[\s,;:]+$/, "")}...`;
}

/**
 * When each answered loop's recall card shows (pure): as the narrator says the payoff sentence's subject, for
 * CUE_SECONDS, only when the answer comes at least CUE_MIN_GAP_SECONDS after the question and both sentences
 * are on the timeline. Two cards never overlap (the later one waits out the first or is dropped).
 */
export function callbackCues(
  loops: readonly LoopCue[] | undefined,
  segments: readonly Segment[],
  words: readonly TimedWord[],
  windows: readonly MomentWindow[],
  fps: number,
): CallbackCue[] {
  if (!loops?.length) return [];
  const h = segments.findIndex((s) => s.kind === "hook");
  const hookStarts =
    h >= 0 && segments[h + 1]
      ? sentenceStartFrames(segments[h]!, segments[h + 1]!.start, words, fps)
      : [];
  const at = (p: { entry: number; moment: number }): number | undefined => {
    if (p.entry < 0) return hookStarts[p.moment];
    const w = windows.find((x) => x.entry === p.entry && x.moment === p.moment);
    return w ? Math.round(w.at * fps) : undefined;
  };
  const out: CallbackCue[] = [];
  const len = Math.round(CUE_SECONDS * fps);
  for (const l of [...loops].sort(
    (a, b) => (at(a.payoff) ?? 0) - (at(b.payoff) ?? 0),
  )) {
    const plant = at(l.plant);
    const payoff = at(l.payoff);
    if (plant === undefined || payoff === undefined) continue;
    if (payoff - plant < CUE_MIN_GAP_SECONDS * fps) continue;
    const prev = out.at(-1);
    if (prev && payoff < prev.from + prev.len) continue;
    // The recall shows the picture a beat after the question began, once its shot has landed.
    out.push({
      from: payoff,
      len,
      plantFrame: plant + Math.round(fps * 0.5),
      text: cueText(l.question),
    });
  }
  return out;
}

/** The media the recall card shows: what was on screen at the frame, and how far into its shot (never the plate). */
export function recallMedia(
  plan: Pick<LongPlan, "shots">,
  frame: number,
): { media: LongMedia; offset: number } | undefined {
  const s = plan.shots.find((x) => frame >= x.start && frame < x.end);
  if (!s || s.media.type === "plate") return undefined;
  return { media: s.media, offset: frame - s.start };
}

// ---------------------------------------------------------------- cut rhythm

/** The opening minutes cut tighter: a still holds at most RHYTHM_OPEN_STILL frames, footage RHYTHM_OPEN_CLIP. */
export const RHYTHM_OPEN_SECONDS = 180;
export const RHYTHM_OPEN_STILL = 120; // 4 s
export const RHYTHM_OPEN_CLIP = 150; // 5 s
/** After the opening, a burst of quicker cuts every this many seconds, lasting this long, with this cap. */
export const BURST_EVERY_SECONDS = 150;
export const BURST_SECONDS = 10;
export const BURST_SHOT = 60; // 2 s: five cuts in a burst
/** A burst stays clear of a chapter's opening (breather and card) by this many seconds. */
export const BURST_CLEAR_SECONDS = 12;

/**
 * The bursts of quicker cuts (pure, frames): one every BURST_EVERY_SECONDS after the opening minutes, each
 * BURST_SECONDS long, moved past any chapter opening (`avoid`, frames) it would run into, and none in the
 * last half minute.
 */
export function burstWindows(
  totalFrames: number,
  fps: number,
  avoid: readonly number[] = [],
): Frames[] {
  const out: Frames[] = [];
  const len = Math.round(BURST_SECONDS * fps);
  const clear = Math.round(BURST_CLEAR_SECONDS * fps);
  const stop = totalFrames - Math.round(30 * fps);
  for (let k = 1; ; k++) {
    let from = Math.round(
      (RHYTHM_OPEN_SECONDS + k * BURST_EVERY_SECONDS) * fps,
    );
    if (from >= stop) break;
    for (const c of [...avoid].sort((a, b) => a - b))
      if (from + len > c && from < c + clear) from = c + clear;
    if (from + len > stop) break;
    if (out.length && from < out.at(-1)!.to + len) continue;
    out.push({ from, to: from + len });
  }
  return out;
}

/** A ranking entry shorter than this gets no burst of its own (it is over before the pace could change). */
export const ENTRY_PACE_MIN_SECONDS = 30;

/**
 * A burst of quicker cuts inside every ranking entry (pure, frames), the pace a Short keeps from line to line:
 * at the middle of each entry long enough, clear of its opening card by BURST_CLEAR_SECONDS and of its end,
 * unless one of `existing` (the interval bursts) already falls inside it. `bounds` are the entries' first
 * frames followed by the frame the last one ends (the outro's start). Returns only the new bursts.
 */
export function entryBursts(
  bounds: readonly number[],
  fps: number,
  existing: readonly Frames[] = [],
): Frames[] {
  const out: Frames[] = [];
  const len = Math.round(BURST_SECONDS * fps);
  const clear = Math.round(BURST_CLEAR_SECONDS * fps);
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k]!;
    const b = bounds[k + 1]!;
    if (b - a < ENTRY_PACE_MIN_SECONDS * fps) continue;
    if (existing.some((x) => x.from < b && x.to > a)) continue;
    const from = Math.max(a + clear, Math.round((a + b - len) / 2));
    if (from + len > b - Math.round(fps * 2)) continue;
    out.push({ from, to: from + len });
  }
  return out;
}

/**
 * Every burst of a plan's cut rhythm (pure, frames): the interval ones (burstWindows, clear of every chapter
 * or entry opening), and with `entryPace` one inside each entry that has none (entryBursts). `entry` counts
 * the second kind.
 */
export function rhythmBursts(
  segments: readonly Pick<Segment, "kind" | "visual" | "start">[],
  totalFrames: number,
  fps: number,
  entryPace = false,
): { all: Frames[]; entry: number } {
  const firsts = segments
    .map((s, i) => (opensChapter(s) ? i : -1))
    .filter((i) => i >= 0);
  const opens = firsts
    .filter((i) => i > 0)
    .map((i) => Math.round(segments[i]!.start * fps));
  const base = burstWindows(totalFrames, fps, opens);
  if (!entryPace || !firsts.length) return { all: base, entry: 0 };
  const take = segments.find((s) => s.kind === "take");
  const bounds = [
    ...firsts.map((i) => Math.round(segments[i]!.start * fps)),
    take ? Math.round(take.start * fps) : totalFrames,
  ];
  const extra = entryBursts(bounds, fps, base);
  return {
    all: [...base, ...extra].sort((a, b) => a.from - b.from),
    entry: extra.length,
  };
}

/** The longest a shot starting at this frame may run, still and footage (Infinity: the usual rules alone). */
export function shotCap(
  frame: number,
  fps: number,
  bursts: readonly Frames[],
): { still: number; clip: number } {
  if (bursts.some((b) => frame >= b.from && frame < b.to))
    return { still: BURST_SHOT, clip: BURST_SHOT };
  if (frame < RHYTHM_OPEN_SECONDS * fps)
    return { still: RHYTHM_OPEN_STILL, clip: RHYTHM_OPEN_CLIP };
  return { still: Number.POSITIVE_INFINITY, clip: Number.POSITIVE_INFINITY };
}

// ---------------------------------------------------------------- bookend ending

/** The ending's echo starts this many seconds before the last word and runs to the end of the plan. */
export const ECHO_LEAD_SECONDS = 4;
const REVERSE: Record<MovePreset, MovePreset> = {
  pushIn: "pullBack",
  pullBack: "pushIn",
  twoStage: "pullBack",
  pushPan: "pullBack",
  driftDown: "pullBack",
  settle: "pullBack",
};

/**
 * The bookend ending (pure): the plan's last stretch, from ECHO_LEAD_SECONDS before the outro's last word,
 * shows the cold open's first picture after the signature card (`coldFrames`) with the move reversed. A clip
 * too short to fill the stretch gives way to the cold open's first still; with neither, the plan is unchanged.
 */
export function bookendEcho(
  plan: LongPlan,
  segments: readonly Segment[],
  words: readonly TimedWord[],
  clipFrames: readonly number[],
  coldFrames = 0,
): LongPlan {
  const take = segments.findIndex((s) => s.kind === "take");
  const hook = segments.findIndex((s) => s.kind === "hook");
  if (take < 0 || hook < 0 || !words.length) return plan;
  const fps = plan.fps;
  const takeFrom = Math.round(segments[take]!.start * fps);
  const lastWord = Math.round(words[words.length - 1]!.end * fps);
  let from = Math.max(takeFrom, lastWord - Math.round(ECHO_LEAD_SECONDS * fps));
  const to = plan.totalFrames;
  const hookShots = plan.shots.filter(
    (s) => s.segment === hook && s.media.type !== "plate",
  );
  const first = hookShots.find((s) => s.end > coldFrames) ?? hookShots[0];
  if (!first) return plan;
  const fits = (s: LongShot) =>
    s.media.type !== "clip" || (clipFrames[s.media.index] ?? 0) >= to - from;
  const source = fits(first)
    ? first
    : hookShots.find((s) => s.media.type === "image");
  if (!source || to - from < Math.round(3 * fps)) return plan;
  const shots: LongShot[] = [];
  for (const s of plan.shots) {
    if (s.end <= from) shots.push(s);
    else if (s.start < from) {
      // A sliver left before the echo would flash: the echo starts where that shot did instead.
      if (from - s.start < 30) from = s.start;
      else shots.push({ ...s, end: from });
    }
  }
  shots.push({
    start: from,
    end: to,
    segment: take,
    media: source.media,
    move: REVERSE[source.move],
  });
  return { ...plan, shots };
}

// ---------------------------------------------------------------- the owner's line

export interface StructureSummary {
  titleDrop: boolean;
  chapters: number;
  years: number;
  callbacks: number;
  bursts: number;
  bookend: boolean;
  /** Ranking entries whose corner counter shows the rank (they have no year). */
  ranks: number;
  /** Of `bursts`, the ones inside a ranking's entries (entryBursts, LONG_ENTRY_PACE). */
  entryBursts: number;
}

/**
 * What the structure devices will do in a documentary's render (pure), from the same inputs the composition
 * uses, so the event log and the owner's line say what the video shows. `on` holds the settings.
 */
export function structureSummary(input: {
  segments: readonly Segment[];
  words: readonly TimedWord[];
  windows: readonly MomentWindow[];
  fps: number;
  /** The breathers, in frames. */
  breaks: readonly Frames[];
  loops?: readonly LoopCue[];
  plan: LongPlan;
  on: {
    titleDrop: boolean;
    chapterIndex: boolean;
    loops: boolean;
    rhythm: boolean;
    bookend: boolean;
    /** A ranking's burst inside every entry (LONG_ENTRY_PACE), with the rhythm. */
    entryPace?: boolean;
  };
}): StructureSummary {
  const { segments, fps, plan, on } = input;
  const starts = segments.map((s, i) =>
    i === 0 ? 0 : Math.round(s.start * fps),
  );
  const marks = on.chapterIndex
    ? chapterMarks(segments, starts, plan.totalFrames, input.breaks)
    : [];
  const hook = segments.findIndex((s) => s.kind === "hook");
  const bursts = on.rhythm
    ? rhythmBursts(segments, plan.totalFrames, fps, on.entryPace)
    : { all: [], entry: 0 };
  const last = plan.shots.at(-1);
  const bookend =
    on.bookend &&
    !!last &&
    segments[last.segment]?.kind === "take" &&
    plan.shots.some(
      (s) =>
        s.segment === hook &&
        s.media.type === last.media.type &&
        s.media.index === last.media.index,
    );
  return {
    titleDrop:
      on.titleDrop &&
      !!titleDropWindow(segments, input.words, fps, input.breaks),
    chapters: marks.length,
    years: marks.filter((m) => m.year).length,
    callbacks: on.loops
      ? callbackCues(input.loops, segments, input.words, input.windows, fps)
          .length
      : 0,
    bursts: bursts.all.length,
    bookend,
    ranks: marks.filter((m) => !m.year && m.rank !== undefined).length,
    entryBursts: bursts.entry,
  };
}

/** What the structure devices did in one long video, in plain English for the owner (one line). */
export function structureLine(
  headline: string,
  s: StructureSummary,
  /** The owner's word for the format (src/longformat.ts longKindLabel). */
  kind = "Documentary",
): string {
  const corner = [
    s.years ? `the year in the corner for ${s.years} of them` : "",
    s.ranks ? `the rank for ${s.ranks}` : "",
  ].filter(Boolean);
  const parts = [
    s.titleDrop ? "the title lands after the cold open" : "",
    s.chapters
      ? `a ${s.chapters}-chapter index${corner.length ? ` with ${corner.join(" and ")}` : ""}`
      : "",
    s.callbacks
      ? `${s.callbacks} callback${s.callbacks === 1 ? "" : "s"} when an earlier question is answered`
      : "",
    s.bursts
      ? `quicker cuts in the first 3 minutes and ${s.bursts} short burst${s.bursts === 1 ? "" : "s"} later${s.entryBursts ? ` (${s.entryBursts} inside the entries, a Short's pace)` : ""}`
      : "",
    s.bookend ? "the last shot returns to the opening picture" : "",
  ].filter(Boolean);
  return `${kind} structure for "${headline}":${parts.length ? parts.join("; ") : "none of the structure devices apply"}.`;
}
