// Plan then render. Every creative decision for a Short (shots, cuts, which
// picture or clip is under which beat, where the turns are, which sound cues
// fire, what sits on the evidence shelf) is computed here, in Node, by pure
// functions into a RenderPlan. The plan is persisted with the episode and
// executed by the composition, so a retried render is identical, planners
// are tested without Chromium, and the rubric can reject a plan before a
// render is spent. No Remotion imports, no randomness, no clock.

import { leadFrames, LEVEL, SFX, sfxFile } from "./soundscape.ts";
import type { Word } from "../voice/elevenlabs.ts";
import type { Segment } from "./timeline.ts";
import { FRAMES, movePreset, type MovePreset } from "./motion.ts";
import { applyCodeScenes, type PlannedScene, type SceneContext } from "./codescene.ts";

export const PLAN_FPS = 30;
export const STING_FRAMES = 12; // frames 0-11: brand sting over the hero still
export const MIN_SHOT = 45;
export const MAX_SHOT = 130;
export const HOLD_SHOT = 150; // the opening and the verdict may hold a shot this long (5 s)
export const TARGET_SHOT = 93; // about 3.1 s
/**
 * Shot length by what is being said: the hook holds on its moment, facts cut quicker, the take holds
 * on its verdict. An even 3.1 s everywhere read as a metronome (24 Oct 2026 review).
 */
export const TARGET_BY_KIND: Record<string, number> = {
  hook: 120,
  beat: 78,
  desk: 90,
  take: 125,
  loop: 93,
};
export const maxShotFor = (kind: string): number =>
  kind === "hook" || kind === "take" ? HOLD_SHOT : MAX_SHOT;
export const FREEZE_TOLERANCE = 6; // a clip may hold its last frame this long (0.2 s) at the end of a shot
export const SNAP_FRAMES = 6; // cuts move up to this far to land on a word end
export const TAIL_SECONDS = 1.0;
export const MAX_SFX = 6;

export interface PlanImage {
  kind: string;
  aspect: number; // width / height
  luma?: number; // 0-255 mean brightness if known
  beatIndex?: number; // tagged for one entry of a ranking Short
  wordy?: boolean; // the local screen saw menu or HUD text on it: used after clean art
  frame?: boolean; // a trailer frame, last-resort: only after published art, once each, never two in a row
  then?: boolean; // the old version of a remade game: kept for the words about the old one (thenWindows)
  forWords?: string; // the words the picture editor chose it for
  role?: "hook"; // the picture editor chose it for the opening line: it is the hero
}

export interface PlanClip {
  durationSeconds: number;
  motion?: number; // 0-1 if scored
  luma?: number;
  beatIndex?: number; // tagged for a beat by the clip ranking step
  cutsceneMatch?: { targetKey?: string; how: "chapter" | "caption" | "scene upload" | "spread" };

  role?: "hook"; // chosen for the opening line
}

export interface PlanSteam {
  currentPlayers?: number;
  positivePercent?: number;
  totalReviews?: number;
  price?: string;
  prices?: { usd?: string; gbp?: string; eur?: string };
  releaseDate?: string;
  metacritic?: number;
}

export interface PlanInput {
  segments: Segment[];
  words: Word[];
  durationSeconds: number; // includes the tail
  images: PlanImage[];
  clips: PlanClip[];
  storyType: string;
  isRumour: boolean;
  attribution: string;
  variant: number;
  steam?: PlanSteam | null;
  /** Open on the hook's moving clip instead of the hero still (most viewers decide at the first frame). */
  openOnClip?: boolean;
  /**
   * Footage first (SHORT_FOOTAGE_FIRST, world-class audit #3 and #4): a shot runs as long as its clip does and what is
   * left of a clip comes back later, a line with no moment of its own takes one nobody else used, stills fill only what
   * footage cannot, and the bare plate is the last resort, after a still has been shown a third time.
   */
  footageFirst?: boolean;
  /** The word on the source chip (src/editorial/shortrules.ts sourceTag); absent, CONFIRMED as it always was. */
  sourceTag?: "CONFIRMED" | "REPORTED" | "ESTIMATE";
  /** Our own work (a ranking, a Why, deals): no "CONFIRMED · PULSE" chip on an opinion (SHORT_LABELS_CLEAN). */
  noSourceChip?: boolean;
  /** A stat chip only under a line that mentions it: price chips nobody said were noise (SHORT_LABELS_CLEAN). */
  statsWhenSpoken?: boolean;
  /** Brightest art first where the choice is free (SHORT_BRIGHT). */
  preferBright?: boolean;
  /** Code scenes (src/render/codescene.ts, CODE_SCENES): absent, the plan is as it always was. */
  codeScenes?: { ctx: SceneContext; stampsAt: number[] };
  /** Frames a beat's shot aims for instead of TARGET_BY_KIND.beat (an every-game Short cuts about every 1.8 s). */
  beatTarget?: number;
}

export type PlanMedia = {
  type: "image" | "clip" | "plate" | "scene";
  index: number;
  trimFrom?: number;
};

export interface Shot {
  start: number; // frame
  end: number; // frame, exclusive
  segment: number; // index into segments
  media: PlanMedia;
  move: MovePreset;
  framed: boolean; // footage in the framed panel over a blurred plate
  luma: number;
  then?: boolean; // the old game's picture on the words about the old game (thenWindows)
}

export interface SfxCue {
  file: string; // under public/sfx
  frame: number;
  volume: number;
}

export type ShelfDevice = "source" | "stat" | "gamecard" | "live" | "rail";

export interface ShelfItem {
  segment: number;
  device: ShelfDevice;
  from: number; // frame
  to: number; // frame, exclusive
  data: Record<string, string>;
}

export interface RenderPlan {
  version: 1;
  fps: number;
  totalFrames: number;
  tailFrames: number;
  heroIndex: number; // image index used at frame 0 and in the loop
  shots: Shot[];
  turns: number[]; // frames of the two accent flashes: hook end, take start
  sfx: SfxCue[];
  shelf: ShelfItem[];
  /** The word moment's look (src/render/wordlook.ts), stored so a retried render is identical. */
  wordLook?: string;
  /** The long videos' craft on the Short (src/render/shortcraft.ts): cards, photos, fillers and camera moves. */
  craft?: import("./shortcraft.ts").ShortCraft;
  /** Code scenes drawn over their shots (src/render/codescene.ts). `media.index` of a "scene" shot points here. */
  scenes?: PlannedScene[];
}

const QUIET_KINDS = new Set([
  "report",
  "versus",
  "specs",
  "milestones",
  "platforms",
  "stat",
  "date",
  "timeline",
  "compare",
  "bar",
  "countdown",
  "price",
  "score",
]);
const STILL_KINDS = new Set(["list", "changelog", "quote", "spec", "title"]);
// Cards that already show a figure: the shelf must not put a second, possibly different, figure under them.
const NUMERIC_KINDS = new Set([
  "versus",
  "specs",
  "milestones",
  "stat",
  "date",
  "timeline",
  "compare",
  "countdown",
  "price",
  "score",
]);

const toFrame = (seconds: number) => Math.round(seconds * PLAN_FPS);

/** Word ends in frames, used to snap cuts onto natural pauses. */
function wordEnds(words: Word[]): number[] {
  return words.map((w) => toFrame(w.end)).sort((a, b) => a - b);
}

/** Ends of words that close a clause (punctuation), where a cut reads as meant rather than placed. */
function clauseEnds(words: Word[]): number[] {
  return words
    .filter((w) => /[,.;:!?]["”')]?$/.test(w.text))
    .map((w) => toFrame(w.end))
    .sort((a, b) => a - b);
}

function nearest(
  frame: number,
  ends: number[],
  lo: number,
  hi: number,
  within: number,
): number | undefined {
  let best: number | undefined;
  let bestD = within + 1;
  for (const e of ends) {
    const d = Math.abs(e - frame);
    if (d < bestD && e > lo && e < hi) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** A clause end within twice the snap window beats a word end within it; failing both, the frame stands. */
function snap(
  frame: number,
  ends: number[],
  lo: number,
  hi: number,
  clauses: number[] = [],
): number {
  return (
    nearest(frame, clauses, lo, hi, SNAP_FRAMES * 2) ??
    nearest(frame, ends, lo, hi, SNAP_FRAMES) ??
    frame
  );
}

/**
 * Cut points: the sting end, every segment start, and inside long segments
 * every 2.6-3.6 s snapped to a word end. Shots are 45-130 frames.
 */
export function planCuts(
  segments: Segment[],
  words: Word[],
  totalFrames: number,
  /** Opening on moving footage: it runs straight through the sting, no cut after 0.4 s. */
  openOnMotion = false,
  /** All stills and plenty of them: each holds about 2.2 s, since nothing in the picture moves. */
  stillPace = false,
  /** A beat's own shot target, in frames; absent, TARGET_BY_KIND's. */
  beatTarget?: number,
): Array<{ start: number; end: number; segment: number }> {
  const ends = wordEnds(words);
  const clauses = clauseEnds(words);
  const out: Array<{ start: number; end: number; segment: number }> = [];
  const segFrames = segments.map((s, i) => ({
    start: i === 0 ? 0 : toFrame(s.start),
    end:
      i === segments.length - 1 ? totalFrames : toFrame(segments[i + 1]!.start),
  }));
  for (const [i, seg] of segFrames.entries()) {
    const len = seg.end - seg.start;
    if (len <= 0) continue;
    let cuts: number[] = [seg.start];
    // A still opening cuts to motion as the sting ends; a moving opening carries on, since two pictures
    // in the first half second read as a flicker (TikTok: 23% of viewers gone by 0:01, 22 Oct 2026).
    if (i === 0 && len >= STING_FRAMES + MIN_SHOT && !openOnMotion)
      cuts.push(seg.start + STING_FRAMES);
    const bodyStart = cuts.at(-1)!;
    const bodyLen = seg.end - bodyStart;
    const kind = segments[i]!.kind;
    const parts = Math.max(
      1,
      Math.round(
        bodyLen /
          (beatTarget && kind === "beat"
            ? Math.max(MIN_SHOT, beatTarget)
            : stillPace && kind !== "hook"
              ? 66
              : (TARGET_BY_KIND[kind] ?? TARGET_SHOT)),
      ),
    );
    for (let p = 1; p < parts; p++) {
      const raw = bodyStart + Math.round((bodyLen * p) / parts);
      cuts.push(
        snap(
          raw,
          ends,
          bodyStart + MIN_SHOT - 1,
          seg.end - MIN_SHOT + 1,
          clauses,
        ),
      );
    }
    cuts = [...new Set(cuts)].sort((a, b) => a - b);
    for (let c = 0; c < cuts.length; c++) {
      const start = cuts[c]!;
      const end = cuts[c + 1] ?? seg.end;
      if (end - start <= 0) continue;
      // Merge a short tail shot into the previous one (never below MIN_SHOT except the sting and tiny segments).
      const prev = out.at(-1);
      const isSting = i === 0 && c === 0 && cuts.length > 1;
      if (!isSting && end - start < MIN_SHOT && prev && prev.segment === i) {
        prev.end = end;
        continue;
      }
      out.push({ start, end, segment: i });
    }
  }
  // Split any shot longer than its kind allows in half, snapping to a clause or word end.
  const split: typeof out = [];
  for (const s of out) {
    let cur = s;
    const limit = maxShotFor(segments[s.segment]!.kind);
    while (cur.end - cur.start > limit) {
      const mid = snap(
        cur.start + Math.round((cur.end - cur.start) / 2),
        ends,
        cur.start + MIN_SHOT - 1,
        cur.end - MIN_SHOT + 1,
        clauses,
      );
      split.push({ start: cur.start, end: mid, segment: cur.segment });
      cur = { start: mid, end: cur.end, segment: cur.segment };
    }
    split.push(cur);
  }
  return split;
}

/**
 * Then and now: a Short about a remake cuts to the original on the words about the original ("first came out in
 * nineteen ninety-eight", "the original's 99"), from that word to the end of its sentence, at least 1.2 s, at most 3 s.
 */
const THEN_WORD = /^(?:nineteen|19\d\d|original(?:'s|’s)?|originals|n64)[.,!?]?$/i;
export function thenWindows(words: Word[]): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (!THEN_WORD.test(w.text.trim())) continue;
    if (out.length && toFrame(w.start) < out.at(-1)!.to) continue;
    let e = i;
    while (e < words.length - 1 && !/[.?!]["”]?$/.test(words[e]!.text.trim()) && words[e + 1]!.start - w.start < 3)
      e++;
    const to = Math.max(toFrame(words[e]!.end), toFrame(w.start) + MIN_SHOT);
    out.push({ from: Math.max(0, toFrame(w.start) - 2), to: Math.min(to, toFrame(w.start) + 90) });
  }
  return out;
}

/** The cuts with each window as a shot of its own, marked `then`. */
export function splitAtThen<T extends { start: number; end: number; segment: number }>(
  cuts: T[],
  windows: Array<{ from: number; to: number }>,
): Array<T & { then?: boolean }> {
  let out: Array<T & { then?: boolean }> = cuts.map((c) => ({ ...c }));
  for (const w of windows) {
    const next: Array<T & { then?: boolean }> = [];
    for (const c of out) {
      if (c.then || w.to <= c.start || w.from >= c.end) {
        next.push(c);
        continue;
      }
      const a = w.from - c.start < 15 ? c.start : w.from;
      const b = c.end - w.to < 15 ? c.end : w.to;
      if (a > c.start) next.push({ ...c, end: a });
      next.push({ ...c, start: a, end: b, then: true });
      if (b < c.end) next.push({ ...c, start: b });
    }
    out = next;
  }
  // The same words across a planned cut are one shot of the old game, not a flicker of two.
  const joined: Array<T & { then?: boolean }> = [];
  for (const c of out) {
    const prev = joined.at(-1);
    if (prev && prev.then && c.then && prev.end === c.start) prev.end = c.end;
    else joined.push({ ...c });
  }
  // What a window leaves too short to stand as a shot joins its neighbour in the same line, never the old game's shot.
  for (let i = 0; i < joined.length; i++) {
    const c = joined[i]!;
    if (c.then || c.end - c.start >= MIN_SHOT) continue;
    const next = joined[i + 1];
    const prev = joined[i - 1];
    if (next && !next.then && next.segment === c.segment) {
      next.start = c.start;
      joined.splice(i--, 1);
    } else if (prev && !prev.then && prev.segment === c.segment) {
      prev.end = c.end;
      joined.splice(i--, 1);
    }
  }
  return joined;
}

/** The still chosen for the words spoken over this cut: at least half of its clause is said here. */
export function pictureForWords(
  images: PlanImage[],
  words: Word[],
  cut: { start: number; end: number },
  uses: number[],
  last?: { type: string; index: number },
): number | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, "").split(/\s+/).filter(Boolean);
  const said = new Set(
    words
      .filter((w) => toFrame(w.start) >= cut.start - 1 && toFrame(w.start) < cut.end)
      .flatMap((w) => norm(w.text)),
  );
  let best: number | undefined;
  let bestScore = 0;
  for (const [i, im] of images.entries()) {
    if (!im.forWords || im.then || uses[i]! >= 1 || (last?.type === "image" && last.index === i)) continue;
    const want = norm(im.forWords);
    if (!want.length) continue;
    const score = want.filter((w) => said.has(w)).length / want.length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 0.5 ? best : undefined;
}

/** The still that opens and closes the Short: a 16:9 shot if there is one, else the first image. */
export function pickHero(images: PlanImage[], preferBright = false): number {
  // The moment matched to the hook's own footage request leads; failing that, the picture the editor chose for the line.
  const hookMoment = images.findIndex((x) => x.role === "hook" && !x.then && !x.forWords);
  if (hookMoment >= 0) return hookMoment;
  const chosen = images.findIndex((x) => x.role === "hook" && !x.then);
  if (chosen >= 0) return chosen;
  // The topic's own art first; art tagged for a ranking entry belongs to that entry.
  const pools = [
    images
      .map((img, i) => ({ img, i }))
      .filter((x) => x.img.beatIndex === undefined && !x.img.then),
    images.map((img, i) => ({ img, i })).filter((x) => !x.img.then),
    images.map((img, i) => ({ img, i })),
  ];
  for (const all of pools) {
    if (!all.length) continue;
    // A trailer frame never opens or closes a Short when published art can.
    const published = all.filter((x) => !x.img.frame);
    const pool = published.length ? published : all;
    // A clean wide still before one with lettering on it: the headline sits over the opening frame.
    const isWide = (x: (typeof pool)[number]) =>
      x.img.aspect >= 1.2 && x.img.aspect <= 2.1;
    const brightest = (xs: typeof pool) =>
      [...xs].sort((a, b) => (b.img.luma ?? 0) - (a.img.luma ?? 0))[0];
    const wide =
      (preferBright
        ? brightest(pool.filter((x) => isWide(x) && !x.img.wordy))
        : pool.find((x) => isWide(x) && !x.img.wordy)) ?? pool.find(isWide);
    if (wide) return wide.i;
    const tall = pool.find((x) => x.img.aspect < 0.9);
    if (tall) return tall.i;
    return pool[0]!.i;
  }
  return -1;
}

/** Store box art, the store header and the logo have the game's name printed large: it fights the captions behind them. */
export const hasPrintedLogo = (img: PlanImage) =>
  /^(capsule|header|logo)$/.test(img.kind);
/** Art order within an entry: clean first, then a screenshot the local screen called wordy (it over-flags in-world lettering), then printed box art. */
const artPenalty = (img: PlanImage) =>
  hasPrintedLogo(img) ? 2 : img.wordy ? 1 : 0;

/** How many times a still may show when the alternative is the bare plate. */
export const RESCUE_STILL_USES = 3;

const isFramedStill = (img: PlanImage) =>
  img.aspect > 2.1 || (img.aspect >= 0.9 && img.aspect < 1.2);

/**
 * Assigns media to every shot: the hook opens on the hero still and cuts to
 * the liveliest clip; quiet beats (numbers, dates, charts) sit on a still or
 * a calm clip in the framed panel; the take and the loop return to the hero.
 * Nothing appears in two adjacent shots, stills are used at most twice,
 * clips once, and a clip is only used where the shot fits inside it.
 */
export function planShots(
  input: PlanInput,
  cuts: Array<ReturnType<typeof planCuts>[number] & { then?: boolean }>,
  heroIndex: number,
): Shot[] {
  const { images, clips, segments, variant } = input;
  // A trailer frame starts one use down, so it shows once where other stills show twice.
  const stillUses = images.map((i) => (i.frame ? 1 : 0));
  const afterFrame = (i: number) =>
    !!images[i]!.frame &&
    last?.type === "image" &&
    !!images[last.index]?.frame;
  const clipUsed = clips.map(() => false);
  const clipFrames = clips.map((c) => Math.floor(c.durationSeconds * PLAN_FPS));
  const footageFirst = !!input.footageFirst;
  // Frames of each clip already shown: under footage first a clip is spent by the frame, not by the shot.
  const clipPos = clips.map(() => 0);
  const clipLeft = (i: number) => clipFrames[i]! - clipPos[i]!;
  const clipOrder = clips
    .map((c, i) => i)
    .sort((a, b) => Number(Boolean(clips[b]!.cutsceneMatch?.targetKey)) - Number(Boolean(clips[a]!.cutsceneMatch?.targetKey)) ||
      (clips[b]!.motion ?? 0.5) - (clips[a]!.motion ?? 0.5));
  const matchesTarget = (i: number, target: number | undefined | "hook" | "take" | "loop") => {
    const key = clips[i]!.cutsceneMatch?.targetKey;
    if (!key) return target === "hook" ? clips[i]!.role === "hook" :
      typeof target === "number" ? clips[i]!.beatIndex === target : false;
    return typeof target === "number" ? key === `beat:${target}` || key.startsWith(`beat:${target}#`) : key === target;
  };
  let last: PlanMedia | undefined;
  const same = (a: PlanMedia | undefined, b: PlanMedia) =>
    !!a && a.type === b.type && a.index === b.index;

  const takeStill = (
    prefer: (i: number) => boolean,
    exclude?: PlanMedia,
    forBeat?: number,
    ownOnly = false, // a ranking entry: its own art or nothing, never another game's
  ): PlanMedia | undefined => {
    // An entry's own art comes first for its line; art tagged for another entry is never borrowed.
    const own =
      forBeat === undefined
        ? []
        : images
            .map((_, i) => i)
            .filter(
              (i) => images[i]!.beatIndex === forBeat && stillUses[i]! < 2,
            );
    if (own.length) {
      // Clean art (hero, screenshots, footage stills) before art with the logo printed on it.
      const logo = (i: number) => artPenalty(images[i]!);
      // A picture kept for other words of this line waits for them; the line's other art goes first.
      const kept = (i: number) => Number(Boolean(images[i]!.forWords));
      const pick = own.sort(
        (a, b) => kept(a) - kept(b) || logo(a) - logo(b) || stillUses[a]! - stillUses[b]! || a - b,
      )[0]!;
      stillUses[pick]!++;
      return { type: "image", index: pick };
    }
    if (ownOnly) {
      // Every piece of this entry's art is already used twice: reuse the least used rather than borrow.
      const any = images
        .map((_, i) => i)
        .filter(
          (i) =>
            images[i]!.beatIndex === forBeat &&
            !same(exclude, { type: "image", index: i }),
        )
        .sort(
          (a, b) =>
            artPenalty(images[a]!) - artPenalty(images[b]!) ||
            stillUses[a]! - stillUses[b]! ||
            a - b,
        )[0];
      if (any === undefined) return undefined;
      stillUses[any]!++;
      return { type: "image", index: any };
    }
    const order = images
      .map((_, i) => i)
      // The hero is reserved for the opening, the take and the loop unless it is the only still.
      .filter(
        (i) =>
          images[i]!.beatIndex === undefined &&
          !images[i]!.then &&
          (i !== heroIndex || images.length === 1) &&
          !afterFrame(i),
      )
      .sort(
        (a, b) =>
          Number(!!images[a]!.frame) - Number(!!images[b]!.frame) ||
          // Box art and logos fill the frame with lettering the cards then collide with: last, under footage first.
          (footageFirst ? artPenalty(images[a]!) - artPenalty(images[b]!) : 0) ||
          stillUses[a]! - stillUses[b]! ||
          (input.preferBright
            ? (images[b]!.luma ?? 0) - (images[a]!.luma ?? 0)
            : 0) ||
          a - b,
      );
    const pick =
      order.find(
        (i) =>
          stillUses[i]! < 2 &&
          prefer(i) &&
          !same(exclude, { type: "image", index: i }),
      ) ??
      order.find(
        (i) => stillUses[i]! < 2 && !same(exclude, { type: "image", index: i }),
      );
    if (pick === undefined) return undefined;
    stillUses[pick]!++;
    return { type: "image", index: pick };
  };
  // A clip that is shorter than its shot (it ends where its trailer shot ends) is
  // still used: the shot is cut at the clip's end and the remainder becomes a shot
  // of its own, or is folded into the next shot of the same line when it is too
  // short to stand alone. A clip never freezes on its last frame for more than
  // FREEZE_TOLERANCE frames.
  // The least-used still of any kind, tagged or not: for the take of a ranking Short once the topic's own art is spent.
  const takeAnyStill = (exclude?: PlanMedia): PlanMedia | undefined => {
    const pick = images
      .map((_, i) => i)
      .filter(
        (i) =>
          i !== heroIndex &&
          !afterFrame(i) &&
          !images[i]!.then &&
          !same(exclude, { type: "image", index: i }),
      )
      .sort(
        (a, b) =>
          artPenalty(images[a]!) - artPenalty(images[b]!) ||
          stillUses[a]! - stillUses[b]! ||
          a - b,
      )[0];
    if (pick === undefined) return undefined;
    stillUses[pick]!++;
    return { type: "image", index: pick };
  };

  const takeClip = (
    n: number,
    c: { start: number; end: number; segment: number },
    forBeat: number | undefined | "hook" | "take" | "loop",
    calm: boolean,
    ownOnly = false,
  ): PlanMedia | undefined => {
    if (footageFirst) return takeFootage(n, c, forBeat, calm, ownOnly);
    const len = c.end - c.start;
    const fits = clipOrder.filter(
      (i) => !clipUsed[i] && clipFrames[i]! >= Math.min(len, MIN_SHOT),
    );
    if (!fits.length) return undefined;
    const tagged = forBeat === undefined ? undefined : fits.find((i) => matchesTarget(i, forBeat));
    // A moment chosen for another line is never borrowed; untagged clips are fair game.
    const free = fits.filter(
      (i) => clips[i]!.beatIndex === undefined && clips[i]!.role === undefined && !clips[i]!.cutsceneMatch?.targetKey,
    );
    const pick =
      tagged ?? (ownOnly ? undefined : calm ? free[free.length - 1] : free[0]);
    if (pick === undefined) return undefined;
    const extra = len - clipFrames[pick]!;
    if (extra > FREEZE_TOLERANCE) {
      const clipEnd = c.start + clipFrames[pick]!;
      const next = cuts[n + 1];
      if (extra >= MIN_SHOT) {
        cuts.splice(n + 1, 0, {
          start: clipEnd,
          end: c.end,
          segment: c.segment,
        });
        c.end = clipEnd;
      } else if (
        next &&
        next.segment === c.segment &&
        next.end - clipEnd <= MAX_SHOT
      ) {
        c.end = clipEnd;
        next.start = clipEnd;
      } else if (
        n > 0 &&
        cuts[n - 1]!.segment === c.segment &&
        shots.at(-1) &&
        c.end - clipFrames[pick]! - cuts[n - 1]!.start <=
          maxShotFor(segments[c.segment]!.kind)
      ) {
        // The clip is a little short for the last shot of its line: the shot before it runs on a little, so
        // the clip ends with the line (24-25 Oct 2026: unused clips left a still repeating four times).
        const newStart = c.end - clipFrames[pick]!;
        cuts[n - 1]!.end = newStart;
        shots.at(-1)!.end = newStart;
        c.start = newStart;
      } else {
        return undefined;
      }
    }
    clipUsed[pick] = true;
    return { type: "clip", index: pick, trimFrom: 0 };
  };

  // Footage first: the clip for this shot, the shot stretched to show all of it (within the line and the kind's longest
  // shot) or, when the clip is shorter, cut at its end. Own moment, then an untagged one, then what is left of a moment
  // whose line has passed. Never another line's moment still to come, and in a ranking never another game's.
  const takeFootage = (
    n: number,
    c: { start: number; end: number; segment: number },
    forBeat: number | undefined | "hook" | "take" | "loop",
    calm: boolean,
    ownOnly: boolean,
  ): PlanMedia | undefined => {
    const open = clipOrder.filter((i) => clipLeft(i) >= MIN_SHOT);
    if (!open.length) return undefined;
    const fresh = (xs: number[]) => {
      const located = xs.filter((i) => clips[i]!.cutsceneMatch?.targetKey);
      const pool = located.length ? located : xs;
      return [...pool].sort((a, b) => clipPos[a]! - clipPos[b]!)[calm ? pool.length - 1 : 0];
    };
    const own = open.filter((i) => forBeat !== undefined && matchesTarget(i, forBeat));
    const free = open.filter(
      (i) => clips[i]!.beatIndex === undefined && clips[i]!.role === undefined && !clips[i]!.cutsceneMatch?.targetKey,
    );
    const beatsBefore = segments
      .slice(0, c.segment)
      .filter((s) => s.kind === "beat").length;
    const passed = open.filter((i) => {
      const cl = clips[i]!;
      return !cl.cutsceneMatch?.targetKey && (
        cl.role === "hook" ||
        (cl.beatIndex !== undefined && cl.beatIndex < beatsBefore)
      );
    });
    const pick = own.length
      ? fresh(own)
      : ownOnly
        ? undefined
        : free.length
          ? fresh(free)
          : !ranking && passed.length
            ? fresh(passed)
            : undefined;
    if (pick === undefined) return undefined;
    const left = clipLeft(pick);
    const limit = maxShotFor(segments[c.segment]!.kind);
    const want = Math.min(left, limit);
    const len = c.end - c.start;
    if (want > len) {
      // The shot grows to show the clip, taking over the line's later cuts; a remainder too short to stand folds in.
      let end = c.start + want;
      for (;;) {
        const next = cuts[n + 1];
        if (!next || next.segment !== c.segment) {
          end = Math.min(end, c.end);
          break;
        }
        if (next.end <= end) {
          c.end = next.end;
          cuts.splice(n + 1, 1);
          continue;
        }
        if (next.end - end < MIN_SHOT) {
          if (
            next.end - c.start <= limit &&
            next.end - c.start <= left + FREEZE_TOLERANCE
          ) {
            end = next.end;
            c.end = next.end;
            cuts.splice(n + 1, 1);
          } else end = Math.max(c.end, next.end - MIN_SHOT);
        }
        break;
      }
      if (end > c.end) {
        const next = cuts[n + 1];
        if (next && next.segment === c.segment) next.start = end;
        c.end = end;
      }
    } else if (len - left > FREEZE_TOLERANCE) {
      const clipEnd = c.start + left;
      const extra = len - left;
      const next = cuts[n + 1];
      if (extra >= MIN_SHOT) {
        cuts.splice(n + 1, 0, { start: clipEnd, end: c.end, segment: c.segment });
        c.end = clipEnd;
      } else if (
        next &&
        next.segment === c.segment &&
        next.end - clipEnd <= MAX_SHOT
      ) {
        c.end = clipEnd;
        next.start = clipEnd;
      } else return undefined;
    }
    const trimFrom = clipPos[pick]!;
    clipPos[pick]! += Math.min(c.end - c.start, left);
    clipUsed[pick] = true;
    return { type: "clip", index: pick, trimFrom };
  };

  const shots: Shot[] = [];
  // A ranking Short: ranks are spoken bottom-up, so the last beat is number one and the take ("our pick") shows it.
  const ranking = segments.some(
    (x) => x.kind === "beat" && x.visual?.kind === "rank",
  );
  const winnerBeat = ranking
    ? segments.filter((x) => x.kind === "beat").length - 1
    : undefined;
  for (const [n, c] of cuts.entries()) {
    const seg = segments[c.segment]!;
    const kind = seg.visual?.kind ?? "none";
    const beatIndex =
      seg.kind === "beat"
        ? segments.slice(0, c.segment).filter((s) => s.kind === "beat").length
        : undefined;
    let media: PlanMedia | undefined;
    let framed = false;
    const isOpening = n === 0;
    // Only the very last shot returns to the hero (it meets the opening frame when the Short loops); the
    // loop line's earlier cuts get their own media, or one hero still filled the last 8 s three times over.
    const isClosing = n === cuts.length - 1;

    const firstTakeShot =
      seg.kind === "take" && (n === 0 || cuts[n - 1]!.segment !== c.segment);
    // Which entry this shot belongs to, when it may only show that entry's own media.
    const ownBeat =
      kind === "rank"
        ? beatIndex
        : ranking && seg.kind === "take"
          ? winnerBeat
          : undefined;
    // A picture the editor chose for these very words comes first, whatever else this line would do.
    const chosen = c.then || isOpening || isClosing ? undefined : pictureForWords(images, input.words, c, stillUses, last);
    if (chosen !== undefined) {
      stillUses[chosen]!++;
      media = { type: "image", index: chosen };
    } else if (c.then) {
      // The words about the old game show the old game, a different picture each time.
      const pick = images
        .map((_, i) => i)
        .filter((i) => images[i]!.then && !same(last, { type: "image", index: i }))
        .sort(
          (a, b) =>
            stillUses[a]! - stillUses[b]! ||
            artPenalty(images[a]!) - artPenalty(images[b]!) ||
            a - b,
        )[0];
      if (pick !== undefined) {
        stillUses[pick]!++;
        media = { type: "image", index: pick };
      }
    } else if (firstTakeShot && ranking && !isClosing) {
      // The pick opens on the winner's art, never on the topic's or another entry's.
      // Straight after the winner's own line its art may carry on under the pick card.
      media =
        (footageFirst ? takeClip(n, c, winnerBeat, true, true) : undefined) ??
        takeStill((i) => true, undefined, winnerBeat, true) ??
        takeClip(n, c, winnerBeat, true, true) ??
        (heroIndex >= 0 ? { type: "image", index: heroIndex } : undefined);
    } else if (
      isOpening &&
      input.openOnClip &&
      (media = takeClip(n, c, "hook", false))
    ) {
      // Motion from the first frame: the hero still waits for the take and the loop.
    } else if (
      footageFirst &&
      isOpening &&
      input.openOnClip &&
      !ranking &&
      (media = takeClip(n, c, undefined, false))
    ) {
      // No moment was chosen for the hook: any free footage still opens better than a still.
    } else if (
      footageFirst &&
      !isOpening &&
      (isClosing || firstTakeShot) &&
      !ranking &&
      (media = takeClip(n, c, seg.kind === "take" || seg.kind === "loop" ? seg.kind : undefined, true))
    ) {
      // The verdict and the last line stay on moving footage while there is any; the hero waits for when there is not.
    } else if ((isOpening || isClosing || firstTakeShot) && heroIndex >= 0) {
      media = { type: "image", index: heroIndex };
      framed = isFramedStill(images[heroIndex]!);
      if (isOpening) stillUses[heroIndex]!++;
    } else if (seg.kind === "hook") {
      media =
        takeClip(n, c, "hook", false) ??
        takeStill((i) => !isFramedStill(images[i]!), last);
    } else if (seg.kind === "beat" && kind === "rank") {
      // A ranking entry shows its own moment or its own art; with neither it sits on the plate.
      media =
        takeClip(n, c, beatIndex, false, true) ??
        takeStill((i) => true, last, beatIndex, true);
    } else if (seg.kind === "beat" && QUIET_KINDS.has(kind)) {
      // A moment chosen for this line beats a still; it sits in the framed panel under the card.
      media =
        takeClip(n, c, beatIndex, true) ??
        takeStill((i) => true, last, beatIndex);
      framed = true;
    } else if (seg.kind === "beat" && STILL_KINDS.has(kind)) {
      media =
        (footageFirst ? takeClip(n, c, beatIndex, true) : undefined) ??
        takeStill((i) => !isFramedStill(images[i]!), last, beatIndex) ??
        takeClip(n, c, beatIndex, true);
    } else if (seg.kind === "beat") {
      media =
        takeClip(n, c, beatIndex, false) ??
        takeStill((i) => true, last, beatIndex);
    } else if (seg.kind === "take" && ranking) {
      media =
        takeClip(n, c, winnerBeat, true, true) ??
        takeStill((i) => true, last, winnerBeat, true);
    } else if (seg.kind === "take" || seg.kind === "loop") {
      media =
        takeClip(n, c, seg.kind, true) ??
        takeStill((i) => true, last) ??
        takeAnyStill(last);
    } else if (seg.kind === "desk") {
      // The desk partner's question: a calm moment, no card.
      media =
        takeClip(n, c, undefined, true) ??
        takeStill((i) => true, last) ??
        takeAnyStill(last);
    } else {
      media = takeStill((i) => true, last);
    }
    if (media?.type === "image" && isFramedStill(images[media.index]!))
      framed = true;
    if (
      !media ||
      (same(last, media) && !isClosing && !isOpening && !firstTakeShot)
    ) {
      // Avoid the same asset twice in a row; fall back to another still, then the brand plate.
      const alt =
        ownBeat !== undefined
          ? takeStill((i) => true, media, ownBeat, true)
          : takeStill((i) => true, media);
      const prevShot = shots.at(-1);
      const hold = alt ?? media;
      if (
        ownBeat !== undefined &&
        hold &&
        prevShot &&
        prevShot.segment === c.segment &&
        same(prevShot.media, hold)
      ) {
        // The entry has nothing else to show: its art holds the rest of the line as one longer shot.
        prevShot.end = c.end;
        continue;
      }
      // Footage first: a still a third time, or a still tagged for a line (never the ranking's winner before its turn),
      // beats an empty panel. A ranking entry with no art of its own stays on the plate, for the gate to see.
      const rescue =
        footageFirst && !alt && !media && ownBeat === undefined
          ? images
              .map((_, i) => i)
              .filter(
                (i) =>
                  stillUses[i]! < RESCUE_STILL_USES &&
                  !same(last, { type: "image", index: i }) &&
                  !afterFrame(i) &&
                  !(ranking && images[i]!.beatIndex === winnerBeat),
              )
              .sort(
                (a, b) =>
                  Number(!!images[a]!.frame) - Number(!!images[b]!.frame) ||
                  artPenalty(images[a]!) - artPenalty(images[b]!) ||
                  stillUses[a]! - stillUses[b]! ||
                  a - b,
              )[0]
          : undefined;
      if (rescue !== undefined) stillUses[rescue]!++;
      media =
        alt ??
        media ??
        (rescue !== undefined
          ? { type: "image", index: rescue }
          : { type: "plate", index: 0 });
      framed =
        media.type === "image" ? isFramedStill(images[media.index]!) : false;
    }
    const luma =
      media.type === "image"
        ? (images[media.index]?.luma ?? 128)
        : media.type === "clip"
          ? (clips[media.index]?.luma ?? 128)
          : 20;
    const move: MovePreset =
      isOpening || isClosing
        ? "settle"
        : seg.kind === "take"
          ? "pushIn"
          : movePreset(n, variant);
    shots.push({
      start: c.start,
      end: c.end,
      segment: c.segment,
      media,
      move,
      framed,
      luma,
      ...(c.then ? { then: true } : {}),
    });
    last = media;
  }
  // Nothing to show at all: the brand plate carries the whole Short.
  if (!images.length && !clips.length)
    for (const s of shots) s.media = { type: "plate", index: 0 };
  return footageFirst ? spendLeftoverClips(shots, input, clipLeft, clipPos) : shots;
}

/**
 * What the first pass left: any clip with footage to spare replaces a still that was not chosen for its line (a still
 * tagged for the line stays). A clip shorter than the shot takes its first part and the still keeps the rest. In a
 * ranking a clip only ever goes under its own entry.
 */
function spendLeftoverClips(
  shots: Shot[],
  input: PlanInput,
  clipLeft: (i: number) => number,
  clipPos: number[],
): Shot[] {
  const { clips, images, segments } = input;
  const ranking = segments.some(
    (x) => x.kind === "beat" && x.visual?.kind === "rank",
  );
  const beatOf = (segment: number) =>
    segments.slice(0, segment).filter((s) => s.kind === "beat").length;
  const out: Shot[] = [];
  for (const [n, s] of shots.entries()) {
    const seg = segments[s.segment]!;
    const beat = seg.kind === "beat" ? beatOf(s.segment) : undefined;
    const im = s.media.type === "image" ? images[s.media.index] : undefined;
    const prev = out.at(-1);
    const isLast = n === shots.length - 1;
    const replaceable =
      s.media.type === "plate" ||
      (im && (im.beatIndex === undefined || im.beatIndex !== beat));
    const len = s.end - s.start;
    const pick =
      replaceable && !(n === 0 && s.media.type === "image") && !isLast
        ? clips
            .map((_, i) => i)
            .filter(
              (i) =>
                clipLeft(i) >= MIN_SHOT &&
                !(prev?.media.type === "clip" && prev.media.index === i) &&
                (!clips[i]!.cutsceneMatch?.targetKey ||
                  (beat !== undefined
                    ? clips[i]!.cutsceneMatch!.targetKey === `beat:${beat}` || clips[i]!.cutsceneMatch!.targetKey!.startsWith(`beat:${beat}#`)
                    : clips[i]!.cutsceneMatch!.targetKey === seg.kind)) &&
                (ranking
                  ? beat !== undefined && clips[i]!.beatIndex === beat
                  : true) &&
                (clipLeft(i) >= len - FREEZE_TOLERANCE ||
                  len - clipLeft(i) >= MIN_SHOT),
            )
            .sort(
              (a, b) => clipPos[a]! - clipPos[b]! || clipLeft(b) - clipLeft(a),
            )[0]
        : undefined;
    if (pick === undefined) {
      out.push(s);
      continue;
    }
    const take = Math.min(len, clipLeft(pick));
    out.push({
      ...s,
      end: s.start + take,
      media: { type: "clip", index: pick, trimFrom: clipPos[pick]! },
      framed: false,
      luma: clips[pick]!.luma ?? 128,
    });
    clipPos[pick]! += take;
    if (take < len) out.push({ ...s, start: s.start + take });
  }
  return out;
}

/**
 * Sound cues from the structure (src/render/soundscape.ts): a soft sting to open and close, a whoosh on
 * at most two card changes, a tick on the first big number, a swell into the verdict. Each starts early
 * by its own peak time, so the loudest moment lands on the cut, the number or the verdict. Never two
 * sounds within 2.5 s, and the closing sting starts early enough to ring out before the end.
 */
export function planSfx(segments: Segment[], totalFrames: number): SfxCue[] {
  const cues: SfxCue[] = [
    { file: sfxFile(SFX.sting), frame: 0, volume: LEVEL.sting },
  ];
  const gap = 75;
  const fits = (frame: number) =>
    cues.every((c) => Math.abs(c.frame - frame) >= gap);
  const on = (name: string, event: number) =>
    Math.max(0, event - leadFrames(name, PLAN_FPS));
  let whooshes = 0;
  let glint = false;
  for (const [i, s] of segments.entries()) {
    const at = i === 0 ? 0 : toFrame(s.start);
    const air = SFX.air[whooshes % SFX.air.length]!;
    if (
      s.kind === "beat" &&
      s.visual &&
      s.visual.kind !== "none" &&
      whooshes < 2 &&
      fits(on(air, at))
    ) {
      cues.push({ file: sfxFile(air), frame: on(air, at), volume: LEVEL.air });
      whooshes++;
    }
    // The tick lands as the first big number settles: a stat's count-up, or a release countdown's
    // chip (frames ruleLead + 24 after the card, then its spin of 18).
    const settle =
      s.visual?.kind === "stat"
        ? at + 18
        : s.visual?.kind === "countdown"
          ? at + FRAMES.ruleLead + 24 + 18
          : undefined;
    if (
      s.kind === "beat" &&
      settle !== undefined &&
      !glint &&
      fits(on(SFX.glint[0], settle))
    ) {
      cues.push({
        file: sfxFile(SFX.glint[0]),
        frame: on(SFX.glint[0], settle),
        volume: LEVEL.glint,
      });
      glint = true;
    }
    if (s.kind === "take" && fits(on(SFX.swell, at)))
      cues.push({
        file: sfxFile(SFX.swell),
        frame: on(SFX.swell, at),
        volume: LEVEL.swell,
      });
  }
  const close = Math.max(0, totalFrames - 60);
  if (fits(close))
    cues.push({
      file: sfxFile(SFX.sting),
      frame: close,
      volume: LEVEL.sting * 0.9,
    });
  return cues.slice(0, MAX_SFX).sort((a, b) => a.frame - b.frame);
}

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Exactly one evidence device per segment, never the same device twice in a
 * row: the source chip under the hook, Steam data under the beats, the live
 * player count under the take when there is one.
 */
export function planShelf(
  input: PlanInput,
  segments: Segment[],
  totalFrames: number,
): ShelfItem[] {
  const items: ShelfItem[] = [];
  const steam = input.steam ?? undefined;
  const hasCapsule = input.images.some((i) => i.kind === "capsule");
  const source = (input.attribution || "").replace(/^source:\s*/i, "").trim();
  // "A / B / C / D" reads as "A / B +2": the chip stays one line.
  const names = source.split(/\s*\/\s*/).filter(Boolean);
  const shortSource =
    names.length > 2
      ? `${names.slice(0, 2).join(" / ")} +${names.length - 2}`
      : source;
  const sourceLabel = input.isRumour
    ? "RUMOR · UNCONFIRMED"
    : shortSource
      ? `${input.sourceTag ?? "CONFIRMED"} · ${shortSource.toUpperCase()}`
      : "PULSE GAMING NEWS";
  const live =
    steam?.currentPlayers && steam.currentPlayers >= 1000
      ? { value: fmt(steam.currentPlayers), label: "PLAYING ON STEAM" }
      : undefined;
  const statTiles: Array<Record<string, string>> = [];
  if (steam?.positivePercent !== undefined && (steam.totalReviews ?? 0) >= 500)
    statTiles.push({
      value: `${steam.positivePercent}%`,
      label: "POSITIVE STEAM REVIEWS",
    });
  if (steam?.price)
    statTiles.push({
      value: steam.prices?.usd ?? steam.price,
      label: ["STEAM", steam.prices?.gbp, steam.prices?.eur]
        .filter(Boolean)
        .join(" · "),
    });
  if (steam?.metacritic)
    statTiles.push({ value: String(steam.metacritic), label: "METACRITIC" });
  let lastDevice: ShelfDevice | undefined;
  let tileIdx = 0;
  // What a line says, for a chip that has to be about it.
  const saidIn = (s: Segment) =>
    input.words
      .filter((w) => w.start >= s.start - 0.05 && w.start < s.end)
      .map((w) => w.text)
      .join(" ");
  const tileSaid = (tile: Record<string, string>, said: string) =>
    /STEAM REVIEWS/.test(tile.label ?? "")
      ? /\b(reviews?|positive|percent)\b|%/i.test(said)
      : /METACRITIC/.test(tile.label ?? "")
        ? /\b(metacritic|scored?|metascore)\b/i.test(said)
        : /\$|\b(dollars?|bucks?|price[ds]?|costs?|cheap|sale|discount)\b/i.test(said);
  const liveSaid = (said: string) =>
    /\b(players?|playing|concurrent|online)\b/i.test(said);
  for (const [i, s] of segments.entries()) {
    const from = i === 0 ? 0 : toFrame(s.start);
    const to =
      i === segments.length - 1 ? totalFrames : toFrame(segments[i + 1]!.start);
    if (to - from < 12) continue;
    const said = input.statsWhenSpoken ? saidIn(s) : "";
    const liveHere = !input.statsWhenSpoken || liveSaid(said) ? live : undefined;
    const tiles = input.statsWhenSpoken
      ? statTiles.filter((t) => tileSaid(t, said))
      : statTiles;
    const chain: Array<[ShelfDevice, Record<string, string> | undefined]> = [];
    // A card that already shows a figure never gets a second, possibly different, figure under it.
    const numeric =
      s.kind === "beat" && NUMERIC_KINDS.has(s.visual?.kind ?? "none");
    // A ranking entry names one game; the topic's own Steam tile would show another.
    const rank =
      (s.kind === "beat" && s.visual?.kind === "rank") ||
      segments.some((x) => x.kind === "beat" && x.visual?.kind === "rank"); // a ranking: no single game owns the topic tiles
    if (s.kind === "hook" && !input.noSourceChip)
      chain.push(["source", { label: sourceLabel }]);
    if (s.kind === "take" && liveHere && !rank) chain.push(["live", liveHere]);
    if (tiles.length && !numeric && !rank)
      chain.push(["stat", tiles[tileIdx % tiles.length]]);
    if (hasCapsule && !rank) chain.push(["gamecard", { title: "" }]);
    if (liveHere && !numeric && !rank) chain.push(["live", liveHere]);
    if (!input.noSourceChip) chain.push(["source", { label: sourceLabel }]);
    chain.push(["rail", {}]);
    let pick = chain.find(([d]) => d !== lastDevice) ?? chain[0]!;
    // The rail is never worth an empty shelf: when nothing else is available the source chip simply stays.
    if (pick[0] === "rail") {
      // Our own work has no source to name: the shelf stays empty.
      if (input.noSourceChip) {
        lastDevice = undefined;
        continue;
      }
      pick = ["source", { label: sourceLabel }];
    }
    if (pick[0] === "stat") tileIdx++;
    const prev = items.at(-1);
    if (
      prev &&
      prev.device === "source" &&
      pick[0] === "source" &&
      prev.to === from
    )
      prev.to = to;
    else
      items.push({
        segment: i,
        device: pick[0],
        from,
        to,
        data: pick[1] ?? {},
      });
    lastDevice = pick[0];
  }
  return items;
}

export function buildPlan(input: PlanInput): RenderPlan {
  const totalFrames = Math.max(
    PLAN_FPS * 5,
    Math.ceil(input.durationSeconds * PLAN_FPS),
  );
  const heroIndex = pickHero(input.images, input.preferBright);
  const hasThen = input.images.some((i) => i.then);
  const cuts = planCuts(
    input.segments,
    input.words,
    totalFrames,
    hasThen ||
      (!!input.openOnClip &&
        input.clips.some(
          (c) =>
            c.role === "hook" ||
            (!!input.footageFirst &&
              c.beatIndex === undefined &&
              !input.segments.some((s) => s.visual?.kind === "rank")),
        )),
    !input.clips.length && input.images.length >= 16,
    input.beatTarget,
  );
  const shots = planShots(
    input,
    hasThen ? splitAtThen(cuts, thenWindows(input.words)) : cuts,
    heroIndex,
  );
  const hook = input.segments.find((s) => s.kind === "hook");
  const take = input.segments.find((s) => s.kind === "take");
  const turns = [
    hook ? toFrame(hook.end) : 0,
    take ? toFrame(take.start) : 0,
  ].filter((f) => f > 0 && f < totalFrames);
  const plan: RenderPlan = {
    version: 1,
    fps: PLAN_FPS,
    totalFrames,
    tailFrames: toFrame(TAIL_SECONDS),
    heroIndex,
    shots,
    turns,
    sfx: planSfx(input.segments, totalFrames),
    shelf: planShelf(input, input.segments, totalFrames),
  };
  return input.codeScenes
    ? applyCodeScenes(plan, input.segments, input.words, input.codeScenes.ctx, input.codeScenes.stampsAt, input.images)
    : plan;
}

/** The shot on screen at a frame. */
export function shotAt(
  plan: RenderPlan,
  frame: number,
): { shot: Shot; index: number } {
  let i = 0;
  while (i + 1 < plan.shots.length && frame >= plan.shots[i + 1]!.start) i++;
  return { shot: plan.shots[i]!, index: i };
}
