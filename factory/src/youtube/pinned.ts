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

/**
 * The documentary's question. A documentary is about one game, so it never asks "which X game was the one
 * for you" (that is the every-game ranking's question and read as a broken template on the San Andreas and
 * GTA VI documentaries). The wording rotates by title so the pins do not all open the same way.
 */
export function docQuestion(game: string, seed: string): string {
  const qs = [
    `When did you first play ${game}, and what stuck with you?`,
    `What is the one moment from ${game} you still think about?`,
    `Did you know how ${game} came together before this?`,
    `Where were you when ${game} came out?`,
    `What would you have changed about ${game}?`,
  ];
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return qs[h % qs.length]!;
}

/** The documentary's pinned comment; without a usable chapter it asks the question without the timestamp. */
export function docPinnedComment(script: Script, chapters: string[]): string {
  const game = script.game_title || "this game";
  const moment = pinnedMoment(chapters);
  const at = moment
    ? ` The bit that surprised me most is at ${moment.stamp} (${moment.title}).`
    : "";
  return `${docQuestion(game, script.headline || game)}${at} Sources for every chapter are in the description.`;
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
