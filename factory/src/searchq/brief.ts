// The search Short's brief and title rule (SEARCH_SHORTS), apart from the lane so the writer (src/editorial/editorial.ts)
// can read them without importing the lane. Pure.

import { displayName, searchTitleProblems } from "./rank.ts";
import type { Fact, PlayNote } from "./facts.ts";

/** What a search Short carries on its story: the query it answers and everything it may say. */
export interface SearchStory {
  query: string;
  title: string;
  key: string;
  intent: string;
  facts: Fact[];
  playNotes: PlayNote[];
  rumour: boolean;
  /** The owner's gameplay inbox holds a clip of the game: the Short opens on it. */
  ownFootage: boolean;
  score: number;
}

/** The writer's brief for a search Short (pure). */
export function searchBrief(s: SearchStory, game: string): string {
  return `This Short answers one search, in the searcher's own words: "${s.query}". Someone typed exactly that into YouTube or Google; give them the answer.
Structure for this Short (it replaces the news hook and beat rules where they differ):
- hook: the answer itself inside the first three seconds, plainly, with the date, price, size or yes/no that settles it. Never hold the answer back for later.
- beats: two to four confirmed facts from the sources that complete the answer, each with its hard specific, in the order a searcher needs them.
- pulse_take: one honest line in the Pulse voice on what it means for the viewer.
- loop_line: hand back to the search so a replay starts on the answer.
- Say only what the sources below say. Where they do not settle part of the question, say plainly that it is not confirmed yet; never guess.${s.rumour ? " The answer rests on a report, not an official statement: set is_rumour true and attribute it (reportedly, according to)." : ""}${s.playNotes.length ? ' Lines marked as Pulse\'s own play are what we found playing it: say so ("we tried it").' : ""}
- No story spoilers: no endings, deaths, twists or late missions.
- The YouTube title is "${s.title}", or a sharper version that keeps every word of the search and names the game as "${displayName(game)}", under 60 characters, no colon template.`;
}

/** The title a search Short goes out with (pure): the writer's when it keeps the searcher's words, else the planned one. */
export function searchTitleFor(
  written: string,
  s: SearchStory,
  game: string,
): string {
  return searchTitleProblems(written, s.query, game).length ? s.title : written;
}

