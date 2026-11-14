// The finished-video critic's pure core (CRITIC, src/criticstep.ts). After the render and before any upload, the
// critic watches the final MP4 the way a lead editor would: a frame at every cut and every two seconds, each paired
// with the line spoken over it and the graphic meant to be on screen, plus full-frame-rate measurements of the
// picture and the sound. This file holds everything that needs no ffmpeg and no model: the timeline queries, the
// sample plan, the post-filters on the model's answers, the scoring, the verdict and the one timeline fix pass
// (swap a shot by dropping its media, hold a card longer, mute a graphic nobody can read). Unit tested.
//
// Thresholds live in CriticSettings (src/config.ts reads them from the CRITIC_* settings).

import { READ_PER_WORD_MIN, readNeed } from "./gfxaudit.ts";

export * from "./criticsettings.ts";
import { type CriticMode, type CriticSettings } from "./criticsettings.ts";

// ---------------------------------------------------------------- the timeline

export interface CriticWord {
  text: string;
  start: number;
  end: number;
}

export interface CriticShot {
  index: number;
  start: number; // seconds
  end: number;
  /** "clip" | "image" | "plate" | "filler" | "scene": only clips and images can be swapped by dropping them. */
  media: { type: string; index: number };
  /** What the plan says it shows (the clip's label or provenance), for the report. */
  label: string;
  file?: string;
}

export interface CriticLine {
  start: number;
  end: number;
  text: string;
}

export interface CriticGraphic {
  key: string; // "card3" on a Short, "2:5" (entry:moment) on a long video
  kind: string;
  from: number; // seconds as drawn
  to: number;
  text: string;
  words: number;
}

export interface CriticTimeline {
  kind: "short" | "long";
  duration: number;
  fps: number;
  headline: string;
  /** The game the video is about. */
  game: string;
  /** Chapters of a long video and the game each is about. */
  chapters: Array<{ start: number; end: number; game: string }>;
  /** Every game, place or name the script mentions: a picture of one of them is never a "wrong game". */
  mentions: string;
  shots: CriticShot[];
  lines: CriticLine[];
  graphics: CriticGraphic[];
  /** Planned pauses (chapter breaks): dead air, darkness and stillness inside them are meant. */
  breaks: Array<{ start: number; end: number }>;
  /** Planned freeze-frames (seconds). */
  freezes: Array<{ start: number; end: number }>;
  /** Where the end card begins (seconds). */
  tailFrom: number;
}

/** A word ends a sentence when it ends in . ! or ? (quotes and brackets after it allowed). */
const SENTENCE_END = /[.!?]["'’”)\]]*$/;
/** A pause this long between words also ends a sentence (seconds). */
const SENTENCE_GAP = 0.9;

/** The narration's sentences with their times (pure). */
export function sentencesOf(words: readonly CriticWord[]): CriticLine[] {
  const out: CriticLine[] = [];
  let cur: CriticWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({
      start: cur[0]!.start,
      end: cur[cur.length - 1]!.end,
      text: cur
        .map((w) => w.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && cur.length && w.start - prev.end > SENTENCE_GAP) flush();
    cur.push(w);
    if (SENTENCE_END.test(w.text.trim())) flush();
  });
  flush();
  return out;
}

/** The line in force at `t` (pure): the one being spoken, else the one just finished (pictures run past it), else the next. */
export function lineAt(
  lines: readonly CriticLine[],
  t: number,
): CriticLine | undefined {
  const now = lines.find((l) => t >= l.start - 0.05 && t <= l.end + 0.05);
  if (now) return now;
  const before = [...lines].reverse().find((l) => l.end < t);
  if (before && t - before.end <= 1.5) return before;
  const after = lines.find((l) => l.start > t);
  if (after && after.start - t <= 0.6) return after;
  return before && !after ? before : undefined;
}

export function shotAt(
  shots: readonly CriticShot[],
  t: number,
): CriticShot | undefined {
  return (
    shots.find((s) => t >= s.start && t < s.end) ??
    (t >= (shots[shots.length - 1]?.end ?? 0)
      ? shots[shots.length - 1]
      : undefined)
  );
}

export function graphicAt(
  graphics: readonly CriticGraphic[],
  t: number,
): CriticGraphic | undefined {
  return graphics.find((g) => t >= g.from && t < g.to && g.text.trim());
}

export function chapterGameAt(
  tl: Pick<CriticTimeline, "chapters" | "game">,
  t: number,
): string {
  return tl.chapters.find((c) => t >= c.start && t < c.end)?.game || tl.game;
}

const inside = (
  t: number,
  spans: ReadonlyArray<{ start: number; end: number }>,
  pad = 0,
) => spans.some((s) => t >= s.start - pad && t <= s.end + pad);

// ---------------------------------------------------------------- the sample plan

export interface Sample {
  t: number;
  kind: "cut" | "tick";
  shot: number; // index into tl.shots, -1 for none
}

/**
 * The frames to judge (pure): one just after every cut (a quarter second in, or the middle of a shorter shot) and
 * one every `every` seconds, a tick dropped when a cut frame is within half a second of it. Nothing in the end card.
 * Over `max` frames the grid widens; cut frames always stay.
 */
export function sampleTimes(
  tl: Pick<CriticTimeline, "shots" | "duration" | "tailFrom">,
  every: number,
  max: number,
): Sample[] {
  const end =
    Math.min(tl.duration, tl.tailFrom > 0 ? tl.tailFrom : tl.duration) - 0.1;
  const cuts: Sample[] = tl.shots
    .filter((s) => s.start < end)
    .map((s) => {
      const len = s.end - s.start;
      const t = len < 0.5 ? s.start + len / 2 : s.start + 0.25;
      return {
        t: round2(Math.min(t, end)),
        kind: "cut" as const,
        shot: s.index,
      };
    });
  let step = Math.max(0.5, every);
  const ticksFor = (st: number) => {
    const out: Sample[] = [];
    for (let t = 1; t < end; t += st) {
      if (cuts.some((c) => Math.abs(c.t - t) < 0.5)) continue;
      const shot = tl.shots.find((s) => t >= s.start && t < s.end);
      out.push({ t: round2(t), kind: "tick", shot: shot?.index ?? -1 });
    }
    return out;
  };
  let ticks = ticksFor(step);
  while (cuts.length + ticks.length > max && step < 60) {
    step *= 1.25;
    ticks = ticksFor(step);
  }
  return [...cuts, ...ticks].sort((a, b) => a.t - b.t);
}

/** The first seconds the ad-safety screen looks at, four frames a second up to second 8 (pure). */
export function openingTimes(
  duration: number,
  until = 8,
  perSecond = 4,
): number[] {
  const out: number[] = [];
  const last = Math.min(until, duration - 0.05);
  for (let t = 0; t <= last; t += 1 / perSecond) out.push(round2(t));
  return out;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- the model's answers

export type GameCall = "named" | "other" | "none" | "unsure";

export interface FrameJudgement {
  seen: string;
  match: number; // 0-3
  game: GameCall;
  otherGame: string;
  fanMod: boolean;
  watermark: boolean;
  watermarkText: string;
}

/** The frame question's answer (pure); undefined when it is unusable. */
export function frameJudgement(parsed: any): FrameJudgement | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const m = Number(parsed.match);
  if (!Number.isFinite(m)) return undefined;
  const game = ["named", "other", "none", "unsure"].includes(parsed.game)
    ? (parsed.game as GameCall)
    : "unsure";
  return {
    seen: typeof parsed.seen === "string" ? parsed.seen.slice(0, 160) : "",
    match: Math.max(0, Math.min(3, Math.round(m))),
    game,
    otherGame:
      typeof parsed.other_game === "string"
        ? parsed.other_game.slice(0, 80)
        : "",
    fanMod: parsed.fan_mod === true,
    watermark: parsed.watermark === true,
    watermarkText:
      typeof parsed.watermark_text === "string"
        ? parsed.watermark_text.slice(0, 80)
        : "",
  };
}

/**
 * Pulse's own marks, never another channel's watermark: its name and site, the credit lines it draws, the tags on
 * reconstructions and illustrations, captions and the platforms' own furniture.
 */
const OWN_MARKS =
  /\b(pulse|pulsegmg|pulse ?gaming|footage:?|official trailers?|reconstruction|illustration|in-game|captions?|subtitles?|chapter|igdb|steam|wikimedia|commons|press kit)\b/i;

/** Whether a reported watermark is really someone else's (pure). */
export function foreignWatermark(
  j: Pick<FrameJudgement, "watermark" | "watermarkText">,
): boolean {
  if (!j.watermark) return false;
  const text = j.watermarkText.trim();
  if (!text) return true;
  return !OWN_MARKS.test(text);
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const NAME_STOP = new Set([
  "the",
  "of",
  "a",
  "an",
  "and",
  "game",
  "video",
  "series",
  "edition",
  "remastered",
  "definitive",
]);
const ROMAN: Record<string, string> = {
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
/** Words a graphic's text is never matched on. */
const TEXT_STOP = new Set([...NAME_STOP, "on", "in", "to", "for", "with", "at", "by", "from", "is", "its", "it", "or", "as", "vs"]);
const nameTokens = (s: string) =>
  normName(s)
    .split(" ")
    .filter((w) => w && !NAME_STOP.has(w))
    .map((w) => ROMAN[w] ?? w);

/**
 * Whether the game the model named is one the video talks about (pure): every distinctive word of its name appears in
 * the script's mentions, the headline or the expected game ("Grand Theft Auto V" counts in a GTA doc that says
 * "Grand Theft Auto V"; "Spider-Man" in a GTA Short does not).
 */
export function gameMentioned(other: string, mentions: string): boolean {
  const toks = nameTokens(other);
  if (!toks.length) return true; // nothing named: not a claim of a wrong game
  const mt = nameTokens(mentions);
  const hay = new Set([...mt, ...acronyms(mt)]);
  if (toks.every((t) => hay.has(t))) return true;
  // "Grand Theft Auto V" against a script that only says "GTA 5": its initials and its numbers.
  const words = toks.filter((t) => !/^\d+$/.test(t));
  const nums = toks.filter((t) => /^\d+$/.test(t));
  return words.length > 1 && hay.has(words.map((w) => w[0]).join("")) && nums.every((n) => hay.has(n));
}

/** The initials of every run of two to four words (pure): "grand theft auto" gives "gta". */
function acronyms(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++)
    for (let n = 2; n <= 4 && i + n <= tokens.length; n++) {
      const run = tokens.slice(i, i + n);
      if (run.some((w) => /^\d+$/.test(w))) break;
      out.push(run.map((w) => w[0]).join(""));
    }
  return out;
}

/** Whether a judged frame shows a different game than the video is about (pure). */
export function wrongGame(
  j: Pick<FrameJudgement, "game" | "otherGame" | "fanMod">,
  mentions: string,
): boolean {
  if (j.fanMod) return true;
  return j.game === "other" && !gameMentioned(j.otherGame, mentions);
}

// ---------------------------------------------------------------- measurements (filled by src/qa/criticmeasure.ts)

export interface Span {
  start: number;
  end: number;
  /** A black stretch at the bottom of a fade (the picture dims into it and brightens out of it): a dip, not a flash. */
  dip?: boolean;
}

export interface Measurements {
  /** Black stretches (blackdetect), seconds. */
  black: Span[];
  /** Near-white stretches (frame brightness over 235 of 255). */
  white: Span[];
  /** Frozen stretches (freezedetect). */
  frozen: Span[];
  /** True silence in the mix (silencedetect). */
  silence: Span[];
  /** Cuts measured in the picture (scene change over the threshold), seconds. */
  cuts: number[];
}

// ---------------------------------------------------------------- the report

export type FindingLevel = "block" | "fix" | "warn";
export type FindingCheck =
  | "match"
  | "graphics"
  | "dead_air"
  | "frozen"
  | "black"
  | "white"
  | "watermark"
  | "wrong_game"
  | "ad_safety"
  | "flash_cut";

export interface CriticFinding {
  check: FindingCheck;
  level: FindingLevel;
  t: number; // seconds
  end?: number;
  detail: string;
  /** The shot to swap (index into tl.shots), when the fault is its picture. */
  shot?: number;
  /** The graphic to hold longer or mute. */
  graphic?: string;
  /** What the fix pass can do about it. */
  action?: "swap" | "hold" | "mute";
  /** The frame that shows it, for the report (a file name in the report folder). */
  frame?: string;
}

export interface JudgedSample extends Sample {
  line: string;
  graphic?: string;
  frame?: string;
  judgement?: FrameJudgement;
}

export interface GraphicCheck {
  key: string;
  /** "card", "hook", "loop", "stamp", "shelf", "entry"... on a Short; the moment's graphic kind on a long video. */
  kind?: string;
  from: number;
  to: number;
  text: string;
  shown: number;
  need: number;
  /** Share of its words read off the finished frame (OCR), undefined when not read. */
  read?: number;
  /** The vision model's second opinion when OCR did not find it: true when it says the text is fully readable. */
  visible?: boolean;
  frame?: string;
}

export interface OpeningCheck {
  t: number;
  problem?: string;
  screened: boolean;
  frame?: string;
}

export interface CriticScores {
  /** Time-weighted mean picture-to-line score of the judged frames, 0-3. */
  match: number;
  /** Share of judged screen time scored 0. */
  zeroShare: number;
  /** Share of judged screen time scored 3. */
  exactShare: number;
  judged: number;
  frames: number;
  /** Graphics with text that are on screen long enough and readable on the finished frame. */
  graphicsOk: number;
  graphics: number;
  /** 0-100 overall, for trends. */
  overall: number;
}

export interface CriticReport {
  version: 1;
  episode: string;
  kind: "short" | "long";
  model: string;
  mode: CriticMode;
  pass: number;
  verdict: "pass" | "fix" | "block";
  scores: CriticScores;
  findings: CriticFinding[];
  samples: JudgedSample[];
  graphics: GraphicCheck[];
  opening: OpeningCheck[];
  measured: Measurements;
  /** Why the video is blocked, in plain words, for Discord and the shot picker. */
  reasons: string[];
  notes: string[];
  seconds: number;
  checkedAt: string;
}

/** Each judged sample's weight: the screen time it stands for (pure). */
export function sampleWeights(
  samples: ReadonlyArray<{ t: number }>,
  duration: number,
): number[] {
  return samples.map((s, i) => {
    const prev = i ? (samples[i - 1]!.t + s.t) / 2 : 0;
    const next =
      i < samples.length - 1 ? (s.t + samples[i + 1]!.t) / 2 : duration;
    return Math.max(0.05, next - prev);
  });
}

/** The picture scores over the judged samples (pure). */
export function matchScores(
  samples: readonly JudgedSample[],
  duration: number,
): Pick<
  CriticScores,
  "match" | "zeroShare" | "exactShare" | "judged" | "frames"
> {
  const judged = samples.filter((s) => s.judgement && s.line);
  const w = sampleWeights(judged, duration);
  const total = w.reduce((a, b) => a + b, 0);
  let sum = 0;
  let zero = 0;
  let exact = 0;
  judged.forEach((s, i) => {
    const m = s.judgement!.match;
    sum += m * w[i]!;
    if (m === 0) zero += w[i]!;
    if (m === 3) exact += w[i]!;
  });
  return {
    match: total ? round2(sum / total) : 0,
    zeroShare: total ? round2(zero / total) : 0,
    exactShare: total ? round2(exact / total) : 0,
    judged: judged.length,
    frames: samples.length,
  };
}

/** Graphic reading time on the finished timeline (pure): seconds shown against the reading rule. */
export function graphicTiming(g: CriticGraphic): {
  shown: number;
  need: number;
  hardNeed: number;
} {
  const shown = round2(Math.max(0, g.to - g.from));
  return {
    shown,
    need: round2(readNeed(g.words)),
    hardNeed: round2(readNeed(g.words, READ_PER_WORD_MIN)),
  };
}

/** Content words of a graphic's text, for matching against what OCR read (pure). */
export function graphicTokens(text: string): string[] {
  return normName(text)
    .split(" ")
    .filter((w) => w.length > 1 && !TEXT_STOP.has(w));
}

/** Share of a graphic's words found in the OCR'd words of its frame (pure). */
export function ocrShare(text: string, read: readonly string[]): number {
  const want = graphicTokens(text);
  if (!want.length) return 1;
  const have = new Set(read.flatMap((r) => graphicTokens(r)));
  const joined = [...have].join("");
  const hit = want.filter(
    (w) => have.has(w) || (w.length >= 4 && joined.includes(w)),
  ).length;
  return round2(hit / want.length);
}

export interface FindingsInput {
  tl: CriticTimeline;
  samples: JudgedSample[];
  graphics: GraphicCheck[];
  opening: OpeningCheck[];
  measured: Measurements;
  settings: Pick<
    CriticSettings,
    "minMatch" | "maxZeroShare" | "maxSilence" | "maxNarrationGap" | "maxFrozen"
  >;
  words: readonly CriticWord[];
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};
export { fmt as clock };

/** Every finding from the judged samples and the measurements (pure). */
export function findingsOf(input: FindingsInput): CriticFinding[] {
  const { tl, samples, measured, settings } = input;
  const long = tl.kind === "long";
  const out: CriticFinding[] = [];
  const planned = (s: Span, pad = 0.3) =>
    s.start < 0.2 ||
    s.start >= tl.tailFrom - 0.05 ||
    tl.breaks.some((b) => s.start >= b.start - pad && s.end <= b.end + pad);

  // ---- per shot: the picture against the line, another game, a watermark
  const byShot = new Map<number, JudgedSample[]>();
  for (const s of samples)
    if (s.shot >= 0) byShot.set(s.shot, [...(byShot.get(s.shot) ?? []), s]);
  for (const [index, list] of byShot) {
    const shot = tl.shots[index];
    if (!shot) continue;
    const judged = list.filter((s) => s.judgement);
    if (!judged.length) continue;
    const seconds = shot.end - shot.start;
    const swappable = shot.media.type === "clip" || shot.media.type === "image";
    const action = swappable ? ("swap" as const) : undefined;
    const level: FindingLevel = swappable ? "fix" : "block";
    const where = `${fmt(shot.start)}-${fmt(shot.end)}`;
    const wrong = judged.filter((s) => wrongGame(s.judgement!, tl.mentions));
    if (wrong.length && wrong.length * 2 >= judged.length) {
      const j = wrong[0]!.judgement!;
      out.push({
        check: "wrong_game",
        level,
        t: shot.start,
        end: shot.end,
        shot: index,
        action,
        frame: wrong[0]!.frame,
        detail: `${where} ${j.fanMod ? "looks like a fan mod or fake" : `shows ${j.otherGame || "another game"}`}, not ${chapterGameAt(tl, shot.start)} (${j.seen || shot.label})`,
      });
    }
    const marked = judged.filter((s) => foreignWatermark(s.judgement!));
    if (marked.length >= Math.min(2, judged.length)) {
      const j = marked[0]!.judgement!;
      out.push({
        check: "watermark",
        level,
        t: shot.start,
        end: shot.end,
        shot: index,
        action,
        frame: marked[0]!.frame,
        detail: `${where} carries someone else's mark${j.watermarkText ? ` ("${j.watermarkText}")` : ""} (${shot.label || j.seen})`,
      });
    }
    const spoken = judged.filter((s) => s.line);
    const mean = spoken.length
      ? spoken.reduce((a, s) => a + s.judgement!.match, 0) / spoken.length
      : 3;
    if (
      spoken.length &&
      mean < 0.5 &&
      seconds >= 1 &&
      !out.some((f) => f.shot === index)
    ) {
      const s = spoken[0]!;
      out.push({
        check: "match",
        level: swappable ? "fix" : "warn",
        t: shot.start,
        end: shot.end,
        shot: index,
        action,
        frame: s.frame,
        detail: `${where} shows ${s.judgement!.seen || shot.label || "something else"} under "${clip(s.line, 90)}"`,
      });
    }
  }

  // ---- the whole film: do the pictures follow the words? Shots already down for a swap are left out: the fix pass
  // mends those; only what would still be wrong after it blocks.
  const sc = matchScores(samples, tl.duration);
  const swapping = new Set(out.filter((f) => f.action === "swap").map((f) => f.shot));
  const rest = matchScores(
    samples.filter((x) => !swapping.has(x.shot)),
    tl.duration,
  );
  if (
    rest.judged >= 3 &&
    (rest.match < settings.minMatch || rest.zeroShare > settings.maxZeroShare)
  )
    out.push({
      check: "match",
      level: "block",
      t: 0,
      detail: `the pictures do not follow the words: mean ${sc.match.toFixed(2)} of 3 (needs ${settings.minMatch}), ${Math.round(sc.zeroShare * 100)}% of the time on a wrong or unrelated picture (limit ${Math.round(settings.maxZeroShare * 100)}%)`,
    });

  // ---- graphics: long enough to read, and readable on the finished frame
  for (const g of input.graphics) {
    // The house reading rule (src/qa/gfxaudit.ts): the hook's headline is also the loop and the cover, measured but
    // never changed here (a warning), the loop's repeat is not counted, a ranked entry card stays for its entry.
    if (g.key === "loop") continue;
    const measuredOnly = g.kind === "hook" || g.kind === "entry";
    const holdable = !long && /^card\d+$/.test(g.key);
    const tooShort = long
      ? g.shown < g.need / 2 - 0.05
      : g.shown < readNeed(wordsIn(g.text), READ_PER_WORD_MIN) - 0.05;
    if (tooShort)
      out.push({
        check: "graphics",
        level: measuredOnly ? "warn" : "fix",
        t: g.from,
        end: g.to,
        graphic: g.key,
        action: measuredOnly ? undefined : holdable ? "hold" : "mute",
        frame: g.frame,
        detail: `"${clip(g.text, 60)}" is up ${g.shown.toFixed(1)} s, ${g.need.toFixed(1)} s needed to read it`,
      });
    else if (g.read !== undefined && g.read < 0.5 && g.visible === false && !measuredOnly)
      out.push({
        check: "graphics",
        level: "fix",
        t: g.from,
        end: g.to,
        graphic: g.key,
        action: "mute",
        frame: g.frame,
        detail: `"${clip(g.text, 60)}" is not readable on the finished frame (${Math.round(g.read * 100)}% of its words found)`,
      });
  }

  // ---- the picture
  for (const b of measured.black) {
    if (planned(b)) continue;
    const len = b.end - b.start;
    // A designed dip through black (a fade out and in) reads as a transition; only a long one is worth a note.
    if (b.dip) {
      if (len >= 0.5)
        out.push({ check: "black", level: "warn", t: b.start, end: b.end, detail: `a ${len.toFixed(1)} s dip to black at ${fmt(b.start)}` });
      continue;
    }
    out.push({
      check: "black",
      level: "block",
      t: b.start,
      end: b.end,
      detail:
        len < 0.5
          ? `black flash at ${fmt(b.start)} (${len.toFixed(2)} s)`
          : `black screen ${fmt(b.start)}-${fmt(b.end)} (${len.toFixed(1)} s)`,
    });
  }
  for (const w of measured.white) {
    if (planned(w)) continue;
    out.push({
      check: "white",
      level: "warn",
      t: w.start,
      end: w.end,
      detail: `white flash at ${fmt(w.start)} (${(w.end - w.start).toFixed(2)} s)`,
    });
  }
  for (const f of measured.frozen) {
    const len = f.end - f.start;
    const meant =
      inside(f.start + 0.05, tl.freezes, 0.2) &&
      inside(f.end - 0.05, tl.freezes, 0.4);
    if (planned(f, 0.5) || meant || len < settings.maxFrozen) continue;
    const shot = tl.shots.find(
      (s) => f.start + 0.05 >= s.start && f.start + 0.05 < s.end,
    );
    const still = shot?.media.type === "image" || shot?.media.type === "plate";
    out.push({
      check: "frozen",
      level: len >= settings.maxFrozen * 1.5 && !still ? "block" : "warn",
      t: f.start,
      end: f.end,
      shot: shot?.index,
      detail: `the picture stands still ${fmt(f.start)}-${fmt(f.end)} (${len.toFixed(1)} s)${still ? " on a still with no camera move" : ""}`,
    });
  }
  // ---- the sound: true silence in the mix, and the narration pausing
  const silenceLimit = settings.maxSilence * (long ? 2 : 1);
  for (const s of measured.silence) {
    if (planned(s) || s.end - s.start < silenceLimit) continue;
    out.push({
      check: "dead_air",
      level: "block",
      t: s.start,
      end: s.end,
      detail: `dead air ${fmt(s.start)}-${fmt(s.end)}: ${(s.end - s.start).toFixed(1)} s with no sound at all`,
    });
  }
  const gapLimit = settings.maxNarrationGap * (long ? 2 : 1);
  for (let i = 1; i < input.words.length; i++) {
    const a = input.words[i - 1]!;
    const b = input.words[i]!;
    const gap = { start: a.end, end: b.start };
    if (gap.end - gap.start < gapLimit || planned(gap, 0.6)) continue;
    out.push({
      check: "dead_air",
      level: "warn",
      t: gap.start,
      end: gap.end,
      detail: `the narration stops ${fmt(gap.start)}-${fmt(gap.end)} (${(gap.end - gap.start).toFixed(1)} s) under music only`,
    });
  }
  // ---- flash cuts: two measured cuts closer than 0.4 s, outside the planned stings
  const cuts = [...measured.cuts].sort((x, y) => x - y);
  for (let i = 1; i < cuts.length; i++)
    if (
      cuts[i]! - cuts[i - 1]! < 0.4 &&
      !inside(cuts[i]!, tl.breaks, 0.5) &&
      cuts[i]! < tl.tailFrom
    )
      out.push({
        check: "flash_cut",
        level: "warn",
        t: cuts[i - 1]!,
        end: cuts[i]!,
        detail: `a ${(cuts[i]! - cuts[i - 1]!).toFixed(2)} s flash between cuts at ${fmt(cuts[i - 1]!)}`,
      });

  // ---- the first seven seconds, for advertisers
  for (const o of input.opening)
    if (o.problem)
      out.push({
        check: "ad_safety",
        level: "block",
        t: o.t,
        frame: o.frame,
        detail: `the first 7 seconds show ${o.problem} at ${fmt(o.t)}`,
      });

  return mergeAdjacent(out).sort(
    (a, b) => a.t - b.t || rank(a.level) - rank(b.level),
  );
}

const rank = (l: FindingLevel) => (l === "block" ? 0 : l === "fix" ? 1 : 2);
const wordsIn = (t: string) => t.split(/\s+/).filter(Boolean).length;
const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** Ad-safety frames in a row become one finding; warn-level dead air or flashes in a row too (pure). */
function mergeAdjacent(list: CriticFinding[]): CriticFinding[] {
  const out: CriticFinding[] = [];
  for (const f of [...list].sort((a, b) => a.t - b.t)) {
    const last = [...out]
      .reverse()
      .find(
        (o) =>
          o.check === f.check && o.shot === undefined && f.shot === undefined,
      );
    if (f.check === "ad_safety" && last && f.t - (last.end ?? last.t) <= 0.6) {
      last.end = f.t;
      continue;
    }
    out.push(f);
  }
  return out;
}

/** The scores (pure). */
export function scoresOf(
  input: Pick<FindingsInput, "tl" | "samples" | "graphics">,
  findings: readonly CriticFinding[],
): CriticScores {
  const m = matchScores(input.samples, input.tl.duration);
  const faulted = new Set(
    findings.filter((f) => f.check === "graphics").map((f) => f.graphic),
  );
  const graphics = input.graphics.length;
  const graphicsOk = input.graphics.filter((g) => !faulted.has(g.key)).length;
  const tech = findings.filter((f) =>
    ["black", "white", "frozen", "dead_air", "flash_cut"].includes(f.check),
  );
  const techPenalty = tech.reduce(
    (a, f) => a + (f.level === "block" ? 6 : 2),
    0,
  );
  const shots = findings.filter(
    (f) => f.check === "wrong_game" || f.check === "watermark",
  ).length;
  const safety = findings.some((f) => f.check === "ad_safety") ? 0 : 15;
  const overall =
    (m.judged ? (m.match / 3) * 50 : 25) +
    (graphics ? (graphicsOk / graphics) * 15 : 15) +
    Math.max(0, 20 - techPenalty - shots * 4) +
    safety;
  return {
    ...m,
    graphics,
    graphicsOk,
    overall: Math.round(Math.max(0, Math.min(100, overall))),
  };
}

// ---------------------------------------------------------------- the verdict and the fix pass

export interface CriticFixPlan {
  /** Clip and still indexes (assets.clips / assets.images) to take out so the re-plan picks other pictures. */
  dropClips: number[];
  dropImages: number[];
  /** Short cards to hold longer: their span [from, to) in seconds (visual.span, src/render/shortcraft.ts). */
  holds: Array<{ key: string; from: number; to: number }>;
  /** Graphics to stop drawing: Short card keys ("card3") or long moment keys ("2:5"). */
  mutes: string[];
  /** What the fix pass does, line by line, for the log and Discord. */
  steps: string[];
}

/**
 * The verdict (pure): pass with no block or fix findings; fix when every finding the fix pass must handle has an
 * action and this is the first pass; block otherwise, with each reason in plain words. The fix plan holds what the
 * pass changes; on a block it still lists the faulted pictures, so they leave the episode's media (the shot picker
 * never offers them again) whatever the owner decides.
 */
export function verdictOf(
  tl: CriticTimeline,
  findings: readonly CriticFinding[],
  o: {
    pass: number;
    maxPasses?: number;
    mediaLeft?: { clips: number; images: number };
  },
): {
  verdict: "pass" | "fix" | "block";
  reasons: string[];
  plan: CriticFixPlan;
} {
  const serious = findings.filter((f) => f.level !== "warn");
  const plan: CriticFixPlan = {
    dropClips: [],
    dropImages: [],
    holds: [],
    mutes: [],
    steps: [],
  };
  for (const f of serious) {
    if (f.action === "swap" && f.shot !== undefined) {
      const shot = tl.shots[f.shot];
      if (!shot) continue;
      const list =
        shot.media.type === "clip" ? plan.dropClips : plan.dropImages;
      if (!list.includes(shot.media.index)) {
        list.push(shot.media.index);
        plan.steps.push(
          `swap the shot at ${fmt(shot.start)} (${shot.media.type} ${shot.media.index}${shot.label ? `, ${clip(shot.label, 50)}` : ""}): ${f.check.replace("_", " ")}`,
        );
      }
    } else if (f.action === "hold" && f.graphic) {
      const g = tl.graphics.find((x) => x.key === f.graphic);
      if (!g) continue;
      const need = readNeed(g.words);
      const to = Math.min(
        Math.max(g.to, g.from + need),
        tl.tailFrom > 0 ? tl.tailFrom : tl.duration,
      );
      if (
        to - g.from >= readNeed(g.words, READ_PER_WORD_MIN) &&
        !plan.holds.some((h) => h.key === g.key)
      ) {
        plan.holds.push({ key: g.key, from: round2(g.from), to: round2(to) });
        plan.steps.push(
          `hold "${clip(g.text, 40)}" for ${(to - g.from).toFixed(1)} s (was ${(g.to - g.from).toFixed(1)} s)`,
        );
      } else if (!plan.mutes.includes(g.key)) {
        plan.mutes.push(g.key);
        plan.steps.push(
          `drop "${clip(g.text, 40)}": there is no room to hold it long enough`,
        );
      }
    } else if (
      f.action === "mute" &&
      f.graphic &&
      !plan.mutes.includes(f.graphic)
    ) {
      plan.mutes.push(f.graphic);
      const g = tl.graphics.find((x) => x.key === f.graphic);
      plan.steps.push(`drop "${clip(g?.text ?? f.graphic, 40)}": ${f.detail}`);
    }
  }
  // Never strip a video of its pictures: past half of them, the fix pass would starve the re-plan.
  const left = o.mediaLeft;
  const starving =
    !!left &&
    ((left.clips > 0 && plan.dropClips.length > left.clips / 2) ||
      (left.images > 0 && plan.dropImages.length >= left.images));
  const unfixable = serious.filter((f) => !f.action);
  const maxPasses = o.maxPasses ?? 1;
  const reasons = unfixable.map((f) => f.detail);
  if (!serious.length) return { verdict: "pass", reasons: [], plan };
  if (!unfixable.length && o.pass < maxPasses && !starving)
    return { verdict: "fix", reasons: [], plan };
  if (o.pass >= maxPasses && !unfixable.length)
    reasons.push(
      ...serious.map((f) => `still after the fix pass: ${f.detail}`),
    );
  if (starving)
    reasons.push(
      `the fix would take out ${plan.dropClips.length} clips and ${plan.dropImages.length} stills, too many to re-plan from: the shot picker needs new pictures`,
    );
  return {
    verdict: "block",
    reasons: [...new Set(reasons)].slice(0, 12),
    plan,
  };
}

// ---------------------------------------------------------------- the report in words

/** The report as Markdown, frames linked relative to the report folder (pure). */
export function reportMarkdown(r: CriticReport, title: string): string {
  const s = r.scores;
  const lines = [
    `# Critic: ${title}`,
    "",
    `Episode ${r.episode} (${r.kind}), model ${r.model}, pass ${r.pass}, verdict **${r.verdict.toUpperCase()}**, overall ${s.overall}/100.`,
    "",
    `- Picture to line: mean ${s.match.toFixed(2)} of 3, exact ${Math.round(s.exactShare * 100)}%, wrong ${Math.round(s.zeroShare * 100)}% (${s.judged} of ${s.frames} frames judged).`,
    `- Graphics readable in time and on the frame: ${s.graphicsOk} of ${s.graphics}.`,
    `- Measured: ${r.measured.black.length} black, ${r.measured.white.length} white, ${r.measured.frozen.length} frozen, ${r.measured.silence.length} silent stretches, ${r.measured.cuts.length} cuts.`,
    `- First 7 seconds: ${r.opening.filter((o) => o.screened).length} frames screened, ${r.opening.filter((o) => o.problem).length} failed.`,
    `- ${r.seconds.toFixed(0)} s of checking.`,
    "",
  ];
  if (r.reasons.length)
    lines.push(
      "## Why it is blocked",
      "",
      ...r.reasons.map((x) => `- ${x}`),
      "",
    );
  lines.push("## Findings", "");
  if (!r.findings.length) lines.push("None.");
  for (const f of r.findings)
    lines.push(
      `- **${f.level}** ${f.check.replace("_", " ")} at ${fmt(f.t)}: ${f.detail}${f.action ? ` (fix: ${f.action})` : ""}${f.frame ? `  \n  ![](${f.frame})` : ""}`,
    );
  if (r.notes.length)
    lines.push("", "## Notes", "", ...r.notes.map((n) => `- ${n}`));
  return lines.join("\n") + "\n";
}
