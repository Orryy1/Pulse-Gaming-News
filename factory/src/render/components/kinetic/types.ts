// The shared contract of the filler-visual families built for bare documentary sentences (31 Oct 2026: one
// sentence in five describes something nothing filmed can show and fell back to the chapter's generic
// footage). Each family has a pure chooser `<family>For(sentence, moment, chapter)` that returns a Candidate
// with a confidence and a reason, so the integration step can rank the families against each other for every
// bare sentence, and a registry of components that draw the candidate's data. Nothing here imports React or
// Remotion: the pipeline imports the choosers from Node.

/** What a chooser needs of one shot-list moment (src/editorial/documentary.ts DocMoment, loosened). */
export interface FillerMoment {
  show?: string;
  emphasis?: string;
  beat?: string;
  person?: string;
  broll?: string;
  graphic?: {
    kind: string;
    primary?: string;
    secondary?: string;
    items?: string[];
  };
}

/** What a chooser needs of the chapter: its game, year, sentences and their moments, index for index. */
export interface FillerChapter {
  game: string;
  year?: number;
  sentences: string[];
  moments?: FillerMoment[];
}

/** Where the sentence sits, and a seed that rotates styles so two sentences never look identical. */
export interface FillerAt {
  /** The sentence's index in chapter.sentences; found by text when left out. */
  index?: number;
  /** Any stable number (the episode's variant, the sentence index): breaks ties the same way on a retry. */
  seed?: number;
  /** The style the previous filler of this family used, so the next one differs. */
  previous?: string;
}

/**
 * One family's offer for one sentence. `confidence` is 0..1 on the same scale for every family: 0.75 and
 * over is a line made for this treatment, 0.5-0.75 a good fit, and below 0.5 the chooser declines (returns
 * undefined) rather than offer a weak one. `reason` is plain English for the logs and the owner.
 */
export interface Candidate<D = unknown> {
  family: "kinetic" | "diagram";
  /** The registry key of the component that draws it. */
  style: string;
  confidence: number;
  reason: string;
  /** What the component draws: every word in it comes from the sentence, the chapter's text or a fixed label. */
  data: D;
}

/** A chooser's full answer, for logs and the hit-rate report: a candidate, or why it declined. */
export type Verdict<D = unknown> =
  { candidate: Candidate<D> } | { declined: string };

/** A stable 0..1 from a string and a number: every choice that rotates comes from here. */
export function hash01(s: string, seed = 0): number {
  let h = 2166136261 ^ (seed | 0);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/** The sentence's index in its chapter: the given one, else found by its text, else -1. */
export function indexIn(
  chapter: FillerChapter,
  sentence: string,
  at?: FillerAt,
): number {
  if (at?.index !== undefined) return at.index;
  return chapter.sentences.findIndex((s) => s.trim() === sentence.trim());
}
