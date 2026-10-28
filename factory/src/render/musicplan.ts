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
