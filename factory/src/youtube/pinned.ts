// The channel's first comment under a documentary. The owner's rule for every pinned comment: one warm,
// direct question to the viewer, no "let me know in the comments", American spelling (the audience is
// US-first); on a documentary it also points at one specific moment with its timestamp, which YouTube turns
// into a seek link, so a viewer who taps it lands on the part worth talking about. The Short and ranking
// comments come from pinnedComment in src/editorial/seo.ts; this one adds the moment, which is only known
// once the video is timed (the chapter list in the description).

import type { Script } from "../editorial/schema.ts";
import { markSeconds } from "./chapters.ts";

/**
 * The chapter the comment points at: the one nearest the middle of the story, never the intro at 0:00 and
 * never the outro (the last line), so the link lands inside a chapter rather than on the title card.
 */
export function pinnedMoment(
  chapters: string[],
): { stamp: string; title: string } | undefined {
  const inner = chapters
    .map((l) => l.trim().match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .filter((m) => markSeconds(m[0]!) > 0)
    .slice(0, -1);
  const pick = inner[Math.floor((inner.length - 1) / 2)];
  return pick ? { stamp: pick[1]!, title: pick[2]! } : undefined;
}

/** The documentary's pinned comment; without a usable chapter it asks the question without the timestamp. */
export function docPinnedComment(script: Script, chapters: string[]): string {
  const game = script.game_title || "this";
  const moment = pinnedMoment(chapters);
  const at = moment
    ? ` For us the whole story turns at ${moment.stamp} (${moment.title}): that is the part that surprised us most.`
    : "";
  return `Which ${game} game was the one for you?${at} Sources for every chapter are in the description.`;
}

/** Spellings the comment must not use (American on, British off). */
const BRITISH = [
  /\bfavourite/i,
  /\bcolour/i,
  /\brumour/i,
  /\brealis(e|ed|es|ing)\b/i,
  /\bcentre\b/i,
  /\bprogramme\b/i,
  /\borganis(e|ed|es|ing)\b/i,
  /\bbehaviour/i,
  /\bhonour/i,
  /\blicence\b/i,
  /\bdefence\b/i,
];

/** What is wrong with a pinned comment against the owner's rule; empty when it passes. */
export function pinnedCommentProblems(text: string): string[] {
  const out: string[] = [];
  if (!/\?/.test(text)) out.push("asks the viewer nothing");
  if (/let (me|us) know in the comments/i.test(text))
    out.push('says "let us know in the comments"');
  if (/—/.test(text)) out.push("uses an em dash");
  for (const re of BRITISH)
    if (re.test(text)) out.push(`British spelling: ${text.match(re)![0]}`);
  return out;
}
