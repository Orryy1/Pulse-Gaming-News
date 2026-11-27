// A search-led long video planned by date (GTA VI launch, 14 Nov 2026): "GTA 6: everything you need to know" and "the
// GTA 6 map" are the searches of the launch, and a planned run documentary (src/shortrun.ts "doc") could already take
// a date and slot, but its title was only a working title the outline writer rewrote, its chapters were whatever the
// outline chose and it read no confirmed facts file. A run "doc" entry may now carry:
//   search_query: the search it answers. The written title goes through the search lane's title step
//                 (src/searchq/rank.ts searchTitleProblems, as searchTitleFor does for a search Short): the writer's
//                 title stays only when it keeps every word of the search and the house rules, else the planned one;
//   thumb:        the thumbnail's words, kept as the plan gives them;
//   chapters:     the chapter titles, in order, each with what it covers; the outline is told them and then held to
//                 them (searchable chapter names are the YouTube chapters);
//   facts_file:   a markdown file of confirmed facts with their primary sources, added to every chapter's source.
//                 Lines under a "## Reported" heading stay in, and the writer labels them as reported.
// None of these: the entry runs exactly as before. Pure functions here, apart from reading the facts file.

import fs from "node:fs";
import path from "node:path";
import type { DocOutline } from "./editorial/documentary.ts";
import { searchTitleProblems } from "./searchq/rank.ts";

/** What a planned entry fixes in advance, carried on the documentary topic. */
export interface PlannedDoc {
  /** The planned YouTube title (the run entry's title). */
  title: string;
  search_query?: string;
  thumb?: string;
  chapters?: Array<{ title: string; focus: string }>;
  /** Absolute, or relative to the run file's folder. */
  facts_file?: string;
}

/** An em or en dash used as punctuation: house style says never. */
export const DASH = /[–—]/;
/** A Wikipedia link: Wikipedia is the map, never a source named on air. */
export const WIKIPEDIA = /wikipedia\.org\//i;
/** Leak and datamine wording that has no place in a pre-launch guide unless it is ruled out ("no leaks"). */
export const LEAK_WORDS = /\b(leak(?:s|ed)?|datamin\w*|insider)\b/i;
/** The negations that rule leaks out ("No leaks", "never datamined material"). */
export const LEAK_RULED_OUT =
  /\b(no|never|not|nor|without)\b[^.]{0,40}\b(leak(?:s|ed)?|datamin\w*|insider)/i;

/** The written title, or the planned one when the written one drops the search's words (the search title step). */
export function plannedTitle(
  written: string,
  planned: Pick<PlannedDoc, "title" | "search_query">,
  game: string,
): string {
  if (!planned.search_query) return planned.title;
  return written.trim() &&
    !searchTitleProblems(written, planned.search_query, game).length &&
    !DASH.test(written)
    ? written
    : planned.title;
}

/** The outline's brief for the planned chapters (pure); empty when there are none. */
export function plannedOutlineBrief(planned: PlannedDoc | undefined): string {
  if (!planned?.chapters?.length) return "";
  return `\n\nPlanned chapters: use exactly these ${planned.chapters.length} chapters, in this order, with these titles word for word (they are the YouTube chapters people search). Fill in the other fields for each.\n${planned.chapters
    .map((c, i) => `${i + 1}. ${c.title}: ${c.focus}`)
    .join(
      "\n",
    )}${planned.search_query ? `\nThe video answers the search "${planned.search_query}"; the YouTube title keeps every word of it.` : ""}`;
}

/**
 * The outline held to the planned chapters (pure): planned title and focus at each position; a chapter the outline
 * left out is the first chapter's plan with the planned title and focus, on the topic's own article; extra chapters
 * go. `changed` lists what was put right, for the log.
 */
export function applyPlannedChapters(
  outline: DocOutline,
  planned: PlannedDoc | undefined,
  wiki: string,
): { outline: DocOutline; changed: string[] } {
  const want = planned?.chapters;
  if (!want?.length || !outline.chapters.length)
    return { outline, changed: [] };
  const changed: string[] = [];
  const base = outline.chapters[0]!;
  const chapters = want.map((p, i) => {
    const got = outline.chapters[i];
    if (!got) {
      changed.push(`chapter ${i + 1} "${p.title}" added from the plan`);
      return {
        ...base,
        chapter_title: p.title,
        focus: p.focus,
        wiki_title: wiki,
        photo_searches: [],
      };
    }
    if (got.chapter_title.trim() !== p.title)
      changed.push(
        `chapter ${i + 1} "${got.chapter_title}" renamed "${p.title}"`,
      );
    return {
      ...got,
      chapter_title: p.title,
      focus: got.focus.trim() ? `${p.focus} ${got.focus}` : p.focus,
    };
  });
  if (outline.chapters.length > want.length)
    changed.push(
      `${outline.chapters.length - want.length} unplanned chapter(s) dropped`,
    );
  return { outline: { ...outline, chapters }, changed };
}

/** The facts file's path: as given when absolute, else beside the run file. */
export function factsPath(file: string, runFile: string): string {
  return path.isAbsolute(file)
    ? file
    : path.resolve(path.dirname(runFile || "."), file);
}

/**
 * The facts file as source text under an "[Outlet] title" header (sourceCredit reads those), reported lines kept
 * and marked so the writer labels them. A file that won't open is named, never fatal.
 */
export function plannedFactsText(file: string): {
  text: string;
  missed: string[];
} {
  try {
    const md = fs.readFileSync(file, "utf8").trim();
    return {
      text: `[Rockstar and Take-Two, collected] Confirmed facts with their primary sources (anything under "Reported" is a report, not confirmed: say "reportedly" and who reported it)\n${md.slice(0, 9000)}`,
      missed: [],
    };
  } catch {
    return { text: "", missed: [file] };
  }
}

/** What is wrong with a planned search-led entry, as lines for the owner (pure); run by the tests on the real file. */
export function plannedDocProblems(e: {
  title: string;
  angle: string;
  franchise: string;
  search_query?: string;
  thumb?: string;
  chapters?: Array<{ title: string; focus: string }>;
  sources?: Array<{ url: string; source: string; official?: boolean }>;
}): string[] {
  const out: string[] = [];
  const name = `"${e.title}"`;
  if (e.search_query)
    out.push(
      ...searchTitleProblems(e.title, e.search_query, e.franchise).map(
        (p) => `${name}: ${p}`,
      ),
    );
  for (const [what, text] of [
    ["title", e.title],
    ["angle", e.angle],
    ["thumb", e.thumb ?? ""],
    ...(e.chapters ?? []).flatMap((c, i) => [
      [`chapter ${i + 1}`, c.title],
      [`chapter ${i + 1} focus`, c.focus],
    ]),
  ] as Array<[string, string]>)
    if (DASH.test(text))
      out.push(`${name}: the ${what} has a dash; house style never uses one.`);
  if (e.chapters) {
    if (e.chapters.length < 5 || e.chapters.length > 10)
      out.push(
        `${name}: ${e.chapters.length} chapters planned; a long video has 5 to 10.`,
      );
    for (const c of e.chapters) {
      const words = c.title.trim().split(/\s+/).length;
      if (words < 2 || words > 7)
        out.push(`${name}: chapter "${c.title}" is ${words} words; 2 to 7.`);
    }
  }
  if (e.thumb && e.thumb.trim().split(/\s+/).length > 4)
    out.push(`${name}: thumbnail words "${e.thumb}" are more than 4.`);
  const sources = e.sources ?? [];
  if (sources.some((s) => WIKIPEDIA.test(s.url)))
    out.push(`${name}: a Wikipedia source; primary sources only.`);
  if (e.search_query && !sources.some((s) => s.official))
    out.push(
      `${name}: no official source (Rockstar, Take-Two or a platform holder).`,
    );
  for (const text of [e.angle, ...(e.chapters ?? []).map((c) => c.focus)])
    if (LEAK_WORDS.test(text) && !LEAK_RULED_OUT.test(text))
      out.push(
        `${name}: "${text.slice(0, 80)}" mentions leaks without ruling them out.`,
      );
  return out;
}
