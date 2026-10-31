// Music scored to the edit (owner, 28 Oct 2026): a long video's music follows its story instead of rotating
// one family of beds. Each chapter or entry gets a mood from its era and its words (an old game's chapter
// plays the retro bed, a chapter about a delay or a crunch the tense one, a launch or a record the
// triumphant one, a documentary's last chapter the reflective one); the hook keeps the house beds' energy.
// Once a section, on its key line, the music drops out for a beat and comes back, the editor's oldest trick.
import { OLD_YEAR } from "./retroplan.ts";

export type Mood = "tense" | "retro" | "triumph" | "reflective";

const TENSE =
  /\b(delay(?:s|ed)?|crunch|cancel(?:s|led|ed)?|lawsuits?|sued|leak(?:s|ed)?|hack(?:s|ed)?|crisis|trouble|struggl\w*|fail(?:s|ed|ure)?|problems?|controvers\w*|backlash|layoffs?|laid off|bankrupt\w*|banned|scrapped|rebooted|disaster|broken|bugs?|rushed|mystery|secret\w*|warning|pressure|risk\w*)\b/gi;
const TRIUMPH =
  /\b(launch(?:es|ed)?|record(?:s|-breaking)?|best-selling|bestselling|sold|sales|million|billion|biggest|fastest|award\w*|won|wins|game of the year|acclaim\w*|masterpiece|success\w*|triumph\w*|phenomenon|smash|hit|comeback|beloved|perfect)\b/gi;

const count = (re: RegExp, text: string) => (text.match(re) ?? []).length;

/** A section's mood, or undefined for the house beds. */
export function moodOf(o: {
  text: string;
  year?: number;
  first: boolean;
  last: boolean;
  documentary: boolean;
}): Mood | undefined {
  if (o.first) return undefined;
  if (o.year && o.year <= OLD_YEAR) return "retro";
  const tense = count(TENSE, o.text);
  const triumph = count(TRIUMPH, o.text);
  if (o.last) return o.documentary ? "reflective" : "triumph";
  if (tense >= 3 && tense > triumph * 1.5) return "tense";
  if (triumph >= 3 && triumph > tense * 1.5) return "triumph";
  return undefined;
}

export interface MusicChapter {
  frame: number; // where the chapter or entry opens
  text: string; // its narration
  year?: number;
}

export interface MusicSection {
  from: number;
  to: number;
  mood?: Mood;
}

/**
 * The music's sections: a new one at a chapter whose mood differs from the music playing (once that has
 * played at least minMood frames), and on the house beds at least every maxHouse frames, as before.
 */
export function musicSections(
  chapters: MusicChapter[],
  total: number,
  documentary: boolean,
  minMood: number,
  maxHouse: number,
  has: (m: Mood) => boolean,
): MusicSection[] {
  const out: MusicSection[] = [];
  let from = 0;
  let mood: Mood | undefined;
  chapters.forEach((c, i) => {
    if (c.frame <= 0) return;
    const m = moodOf({
      text: c.text,
      year: c.year,
      first: false,
      last: i === chapters.length - 1,
      documentary,
    });
    const want = m && has(m) ? m : undefined;
    const ran = c.frame - from;
    if (
      (want !== mood && ran >= minMood) ||
      (!want && !mood && ran >= maxHouse)
    ) {
      out.push({ from, to: c.frame, mood });
      from = c.frame;
      mood = want;
    }
  });
  out.push({ from, to: total, mood });
  return out;
}

/**
 * Where the music drops out: once a section of at least a minute, on the key word nearest 60% of the way
 * through (from the punch-ins on key words), at least a minute after the last, never where avoid() says.
 */
export function dropOuts(
  sections: Array<{ from: number; to: number }>,
  keyWords: number[],
  fps: number,
  avoid: (f: number) => boolean,
): number[] {
  const out: number[] = [];
  const words = [...keyWords].sort((a, b) => a - b);
  for (const s of sections) {
    const len = s.to - s.from;
    if (len < 60 * fps) continue;
    const aim = s.from + 0.6 * len;
    const fits = words.filter(
      (f) =>
        f >= s.from + 0.35 * len &&
        f <= s.to - 10 * fps &&
        f - (out.at(-1) ?? -Infinity) >= 60 * fps &&
        !avoid(f),
    );
    if (!fits.length) continue;
    out.push(
      fits.reduce((a, b) => (Math.abs(b - aim) < Math.abs(a - aim) ? b : a)),
    );
  }
  return out;
}

/** The music's level around the drop-outs: down to nothing just before the word, back over two seconds. */
export function dropLevel(f: number, drops: number[]): number {
  let level = 1;
  for (const w of drops) {
    if (f < w - 36 || f > w + 66) continue;
    const v =
      f < w - 21 ? (w - 21 - f) / 15 : f <= w + 12 ? 0 : (f - (w + 12)) / 54;
    level = Math.min(level, Math.max(0, Math.min(1, v)));
  }
  return level;
}

// ---------------------------------------------------------------- the writer's beats (30 Oct 2026)
// The documentary writer marks a few sentences a chapter (src/editorial/documentary.ts DOC_BEAT_KINDS) and
// the mix reacts: the music ducks before a reveal, leaves entirely under the key line, a sting marks a
// record, the bed changes on a turn, and the narrator leaves a breath after a quiet line (that one is put
// into the voice file when it is voiced, src/voice/pauses.ts quietGaps). Everything here is in frames.

export type Beat = "reveal" | "key" | "record" | "turn" | "quiet";

export interface BeatCue {
  kind: Beat;
  /** The frame the sentence lands on: its key word when the shot list found one, else its first word. */
  at: number;
  /** The frame the sentence starts. */
  start: number;
  /** The frame the sentence ends (the next one starts). */
  end: number;
}

/** A reveal: the music sits at this share of its level (-14 dB) ... */
export const REVEAL_DUCK = 0.2;
/** ... from this long before the sentence lands ... */
export const REVEAL_LEAD_SECONDS = 1.5;
/** ... reaching the floor over this long ... */
export const REVEAL_FALL_SECONDS = 0.6;
/** ... and rising back softly over this long after the sentence lands. */
export const REVEAL_RISE_SECONDS = 2.5;
/** A key line: the music fades to nothing over this long before the sentence starts ... */
export const KEY_OUT_SECONDS = 0.5;
/** ... stays out under the whole sentence, and comes back over this long after it ends. */
export const KEY_BACK_SECONDS = 2;
/** A turn moves the nearest bed change (within this long) onto the sentence's first word. */
export const TURN_REACH_SECONDS = 20;
/** A section the turn leaves shorter than this keeps its old boundary. */
export const TURN_MIN_SECTION_SECONDS = 20;
/** No automatic drop-out within this long of a written beat: the two would stack. */
export const BEAT_CLEAR_SECONDS = 30;
/** No beat in the opening (the hook keeps the house energy). */
export const BEAT_OPENING_SECONDS = 20;

/**
 * The cues from the shot list (pure): one per sentence with a beat, never a chapter's first sentence,
 * never in the opening, never inside a breather. `windows` are the moment windows in seconds.
 */
export function beatCuesFrom(
  windows: Array<{
    entry: number;
    moment: number;
    start: number;
    end: number;
    at: number;
  }>,
  moments: Array<Array<{ beat?: string } | undefined>> | undefined,
  fps: number,
  breaks: Array<{ from: number; to: number }> = [],
): BeatCue[] {
  const out: BeatCue[] = [];
  for (const w of windows) {
    const b = moments?.[w.entry]?.[w.moment]?.beat;
    if (!b || b === "none" || w.moment === 0) continue;
    const start = Math.round(w.start * fps);
    const at = Math.round(Math.max(w.start, w.at) * fps);
    const end = Math.round(w.end * fps);
    if (start < BEAT_OPENING_SECONDS * fps || end <= start) continue;
    if (breaks.some((x) => start < x.to + fps && end > x.from - fps)) continue;
    out.push({ kind: b as Beat, at, start, end });
  }
  return out;
}

/** Whether frame f lies within `frames` of a reveal or key cue (the automatic drop-outs keep clear). */
export function nearBeat(f: number, cues: BeatCue[], frames: number): boolean {
  return cues.some(
    (c) =>
      (c.kind === "key" || c.kind === "reveal") &&
      f >= c.start - frames &&
      f <= c.end + frames,
  );
}

const ramp = (f: number, from: number, to: number) =>
  to <= from
    ? f < from
      ? 0
      : 1
    : Math.max(0, Math.min(1, (f - from) / (to - from)));

/**
 * The music's level from the beats (pure, 0-1, multiplied into the bed's volume): a reveal ducks to
 * REVEAL_DUCK before the sentence lands and rises back softly after; a key line takes the music out from
 * just before its first word until KEY_BACK_SECONDS after its last. Where cues overlap the lower wins.
 */
export function beatLevel(f: number, cues: BeatCue[], fps: number): number {
  let level = 1;
  for (const c of cues) {
    if (c.kind === "reveal") {
      const lead = c.at - Math.round(REVEAL_LEAD_SECONDS * fps);
      const floor = lead + Math.round(REVEAL_FALL_SECONDS * fps);
      const back = c.at + Math.round(REVEAL_RISE_SECONDS * fps);
      if (f < lead || f > back) continue;
      const v =
        f < floor
          ? 1 - (1 - REVEAL_DUCK) * ramp(f, lead, floor)
          : f < c.at
            ? REVEAL_DUCK
            : REVEAL_DUCK + (1 - REVEAL_DUCK) * ramp(f, c.at, back);
      level = Math.min(level, v);
    } else if (c.kind === "key") {
      const lead = c.start - Math.round(KEY_OUT_SECONDS * fps);
      const back = c.end + Math.round(KEY_BACK_SECONDS * fps);
      if (f < lead || f > back) continue;
      const v =
        f < c.start
          ? 1 - ramp(f, lead, c.start)
          : f <= c.end
            ? 0
            : ramp(f, c.end, back);
      level = Math.min(level, v);
    }
  }
  return level;
}

/**
 * A turn moves the nearest section boundary (within reach) onto the sentence's first word, so the bed
 * changes as the story does; a boundary that would leave either section under minLen stays put, and
 * each boundary moves once. Pure; sections stay contiguous.
 */
export function turnSections<S extends { from: number; to: number }>(
  sections: S[],
  turns: number[],
  reach: number,
  minLen: number,
): S[] {
  const out = sections.map((s) => ({ ...s }));
  const moved = new Set<number>();
  for (const t of [...turns].sort((a, b) => a - b)) {
    let best = -1;
    for (let i = 1; i < out.length; i++) {
      if (moved.has(i)) continue;
      const d = Math.abs(out[i]!.from - t);
      if (d <= reach && (best < 0 || d < Math.abs(out[best]!.from - t)))
        best = i;
    }
    if (best < 0) continue;
    if (t - out[best - 1]!.from < minLen || out[best]!.to - t < minLen)
      continue;
    out[best - 1]!.to = t;
    out[best]!.from = t;
    moved.add(best);
  }
  return out;
}

// ---------------------------------------------------------------- the bed under the voice (31 Oct 2026)
// The music sat at 7% under speech and jumped to 22% within a fifth of a second in every pause, so it pumped
// up and down between sentences (+10 dB) and the voice seemed to change level line to line (owner: "the
// voice seems to change from sentence to sentence ... in volume"). Now it stays under the voice, rises only
// in a pause long enough to carry, by about 4 dB, slowly, and is back down before the next word starts.

/** A pause shorter than this is part of the delivery: the music stays down. */
export const BED_PAUSE_SECONDS = 0.9;
/** Seconds the music takes to rise in a long pause. */
export const BED_RISE_SECONDS = 0.8;
/** Seconds before the next word that the music starts to come back down. */
export const BED_FALL_SECONDS = 0.3;

/**
 * The bed's level on every frame (pure): `under` while the voice speaks or in a short pause, easing up to
 * `pause` over BED_RISE_SECONDS in a pause of BED_PAUSE_SECONDS or more, and down again to reach `under`
 * as the next word starts. `speaking[f]` is 1 on frames with a word (with its lead-in and tail).
 */
export function bedEnvelope(
  speaking: Uint8Array,
  fps: number,
  under: number,
  pause: number,
): Float32Array {
  const n = speaking.length;
  const target = new Float32Array(n).fill(under);
  const minPause = Math.round(BED_PAUSE_SECONDS * fps);
  for (let f = 0; f < n; ) {
    if (speaking[f]) {
      f++;
      continue;
    }
    let g = f;
    while (g < n && !speaking[g]) g++;
    // The silence before the first word and after the last is the intro and outro: the music carries those.
    if (g - f >= minPause || f === 0 || g === n) target.fill(pause, f, g);
    f = g;
  }
  const out = new Float32Array(n);
  const up = (pause - under) / Math.max(1, BED_RISE_SECONDS * fps);
  const down = (pause - under) / Math.max(1, BED_FALL_SECONDS * fps);
  let level = target[0] ?? under;
  for (let f = 0; f < n; f++) {
    level = target[f]! > level ? Math.min(target[f]!, level + up) : target[f]!;
    out[f] = level;
  }
  // Back down before the word, not on it: no frame may sit higher than a straight fall to the next low frame.
  for (let f = n - 2; f >= 0; f--) out[f] = Math.min(out[f]!, out[f + 1]! + down);
  return out;
}
