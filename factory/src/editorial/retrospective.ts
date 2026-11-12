// Full game retrospectives (upgrade queue item 26, owner 12 Nov 2026: "massive retrospectives with full game
// histories, the making of, its innovations, its best features, the story beats, the reviews, best moments, full
// spoilers, plenty of game footage, audio, quotes, big moments"). One game, 40 to 90 minutes, a chapter every three
// to four minutes, in a fixed order of sections: where the studio came from, the making of, what it changed, the
// whole story told beat by beat, the best moments, how it was received and what it left behind. It opens with a
// spoiler warning and says so in its title.
//
// What this module adds to the documentary lane (src/editorial/documentary.ts), all pure:
//   - the sections and how many chapters each gets for a target length (retroChapterBudget);
//   - the story's acts, cut from the game's scene index at its scene breaks (storyActs), and each act's own
//     dialogue as a transcript the story chapter is written and fact-checked against (actTranscript): the story
//     chapters are the game's real scenes, beat by beat, and their footage is picked from the same stretch;
//   - the outline (outlineRetro, one "retro.outline" call), its checks and its conversion into the documentary
//     lane's outline, so the chapter writer, the fact check, the friend pass and the shot list run unchanged;
//   - the review rule: a quoted review is word for word from the source and names who said it (reviewQuoteProblems);
//   - the footage allowance per chapter, scaled from the publisher's per-Short cap (retroChapterFootageSeconds);
//   - every model call of a retrospective under its own "retro." site (retroSites), so CODEX_CALLS=retro routes
//     the whole strand to Codex without moving the other documentaries.

import { z } from "zod";
import type { Llm } from "./llm.ts";
import { writerNoteProblems } from "./writernotes.ts";
import type { DocChapterPlan, DocOutline } from "./documentary.ts";
import type { DialogueLine, SceneIndex } from "../sceneindex/schema.ts";

// ---------------------------------------------------------------- sections

export const RETRO_SECTIONS = [
  "history",
  "making",
  "innovations",
  "story",
  "moments",
  "reception",
  "legacy",
] as const;
export type RetroSection = (typeof RETRO_SECTIONS)[number];

interface SectionInfo {
  label: string;
  /** Share of the chapters (the story takes the most). */
  share: number;
  /** Fewest chapters at any length. */
  min: number;
  /** What a chapter of this section covers, for its brief. */
  brief: string;
  /** What the chapter's Wikipedia research looks for first. */
  research: string;
}

export const RETRO_SECTION_INFO: Record<RetroSection, SectionInfo> = {
  history: {
    label: "Development and studio history",
    share: 0.09,
    min: 1,
    brief:
      "Where the studio and the series stood before this game: the people, the earlier games and the bet this one was. Real people and dates from the source.",
    research: "development history studio founding earlier games",
  },
  making: {
    label: "The making of",
    share: 0.12,
    min: 1,
    brief:
      "How the game was made: the team, the research trips, the technology, the cast and the music, the cuts and the crunch, in the order it happened. Name who decided what.",
    research: "development production design technology cast music soundtrack",
  },
  innovations: {
    label: "What it changed",
    share: 0.1,
    min: 1,
    brief:
      "What the game did that games had not done before, and the features players remember: each one shown, said plainly, with what came before it as the contrast.",
    research: "gameplay features innovations mechanics",
  },
  story: {
    label: "The full story",
    share: 0.4,
    min: 3,
    brief:
      "The story of the game, beat by beat, full spoilers, told from the game's own scenes: who wants what, what they do, what it costs. The transcript below is this stretch of the game's own cutscenes; quote real lines from it word for word and say who says them. Present tense for the story, past tense for how it was made.",
    research: "plot story synopsis characters",
  },
  moments: {
    label: "The best moments",
    share: 0.1,
    min: 1,
    brief:
      "The moments players remember most, missions, scenes and lines, each one placed in the story and said why it lands. Name each moment so it can be shown.",
    research: "missions reception memorable soundtrack",
  },
  reception: {
    label: "Reception and reviews",
    share: 0.09,
    min: 1,
    brief:
      "How critics and players received it: review scores and quoted verdicts, each quote word for word from the source and credited to its outlet or critic, the praise and the complaints both, then the sales and the awards. Fair to both sides.",
    research: "reception reviews critics sales awards controversy",
  },
  legacy: {
    label: "Legacy",
    share: 0.1,
    min: 1,
    brief:
      "What it left behind: the re-releases and remasters, what the series and other games took from it, and where it stands now. End on the verdict the whole retrospective has been building to.",
    research: "legacy remaster re-release influence",
  },
};

/** Narration pace used for planning (Pulse's documentary voice runs about 140 words a minute). */
export const RETRO_WPM = 140;
/** Words per chapter the plan aims at: about three and three quarter minutes, inside the lane's 380 to 780. */
export const RETRO_CHAPTER_WORDS = 520;
export const RETRO_MINUTES_MIN = 40;
export const RETRO_MINUTES_MAX = 90;
/** Minutes the opening and the ending take between them. */
export const RETRO_BOOKEND_MINUTES = 2.5;

/** A target length inside the format's 40 to 90 minutes. */
export function retroMinutes(minutes: number): number {
  return Math.min(
    RETRO_MINUTES_MAX,
    Math.max(RETRO_MINUTES_MIN, Math.round(minutes || 60)),
  );
}

/** Chapters per section for a target length (pure): every section at least its minimum, the rest by share. */
export function retroChapterBudget(
  minutes: number,
): Record<RetroSection, number> {
  const m = retroMinutes(minutes);
  const total = Math.max(
    RETRO_SECTIONS.reduce((n, s) => n + RETRO_SECTION_INFO[s].min, 0),
    Math.round(((m - RETRO_BOOKEND_MINUTES) * RETRO_WPM) / RETRO_CHAPTER_WORDS),
  );
  const out = Object.fromEntries(
    RETRO_SECTIONS.map((s) => [
      s,
      Math.max(
        RETRO_SECTION_INFO[s].min,
        Math.floor(total * RETRO_SECTION_INFO[s].share),
      ),
    ]),
  ) as Record<RetroSection, number>;
  // What rounding left over goes to the story first, then to the sections furthest under their share.
  let left = total - RETRO_SECTIONS.reduce((n, s) => n + out[s], 0);
  const order: RetroSection[] = [
    "story",
    "making",
    "innovations",
    "moments",
    "legacy",
    "history",
    "reception",
  ];
  for (let i = 0; left > 0; i++, left--) out[order[i % order.length]!]++;
  return out;
}

export function budgetTotal(b: Record<RetroSection, number>): number {
  return RETRO_SECTIONS.reduce((n, s) => n + b[s], 0);
}

// ---------------------------------------------------------------- the story's acts

export interface StoryAct {
  /** 1-based. */
  act: number;
  /** Seconds into the scene index's source. */
  from: number;
  to: number;
  /** Heard lines inside it. */
  lines: number;
  /** The speakers it hears most, best first. */
  speakers: string[];
  /** The game's places its lines name. */
  places: string[];
  /** Its first and last few heard lines, for the outline. */
  opening: string[];
  closing: string[];
  /** The share of the act the index has covered so far (0 to 1). */
  indexed: number;
}

const heardLine = (l: DialogueLine) => l.via !== "textbox";

/** The heard lines in [from, to), near-repeats dropped (the text reader reads one subtitle several times). */
export function heardLinesIn(
  index: SceneIndex,
  from: number,
  to: number,
): DialogueLine[] {
  const out: DialogueLine[] = [];
  for (const l of index.lines) {
    if (!heardLine(l) || l.start < from || l.start >= to) continue;
    const prev = out.at(-1);
    if (prev && l.start - prev.start < 2 && similar(prev.text, l.text))
      continue;
    out.push(l);
  }
  return out;
}

const plain = (t: string) =>
  t
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

function similar(a: string, b: string): boolean {
  const x = new Set(plain(a));
  const y = plain(b);
  if (!x.size || !y.length) return false;
  return y.filter((w) => x.has(w)).length / Math.max(x.size, y.length) >= 0.6;
}

function covered(index: SceneIndex, from: number, to: number): number {
  let s = 0;
  for (const c of index.coverage)
    s += Math.max(0, Math.min(to, c.to) - Math.max(from, c.from));
  return to > from ? Math.min(1, s / (to - from)) : 0;
}

/**
 * The story cut into `n` acts at its scene breaks (pure): each boundary is the longest pause between heard lines
 * near an even split of the source, so an act starts where a scene does. Where the index has no lines yet the split
 * is even. A cutscene movie is all story, so its running order is the story's.
 */
export function storyActs(index: SceneIndex, n: number): StoryAct[] {
  const count = Math.max(1, Math.round(n));
  const duration = Math.max(
    index.source.duration || 0,
    ...index.coverage.map((c) => c.to),
    ...index.lines.map((l) => l.end),
  );
  if (duration <= 0) return [];
  const heard = index.lines.filter(heardLine).sort((a, b) => a.start - b.start);
  const step = duration / count;
  const cuts: number[] = [0];
  for (let k = 1; k < count; k++) {
    const target = k * step;
    const lo = Math.max(cuts.at(-1)! + step * 0.5, target - step * 0.15);
    const hi = target + step * 0.15;
    let best: { at: number; gap: number } | undefined;
    for (let i = 0; i + 1 < heard.length; i++) {
      const a = heard[i]!;
      const b = heard[i + 1]!;
      const mid = (a.end + b.start) / 2;
      if (mid < lo || mid > hi) continue;
      const gap = b.start - a.end;
      if (!best || gap > best.gap)
        best = { at: Math.round(b.start * 10) / 10 - 0.5, gap };
    }
    cuts.push(
      best && best.gap >= 2 ? Math.max(lo, best.at) : Math.round(target),
    );
  }
  cuts.push(duration);
  const placeNames = index.places.filter((p) => p.trim().length > 2);
  return cuts.slice(0, -1).map((from, i) => {
    const to = cuts[i + 1]!;
    const lines = heardLinesIn(index, from, to);
    const speakers = new Map<string, number>();
    for (const l of lines)
      if (l.speaker)
        speakers.set(l.speaker, (speakers.get(l.speaker) ?? 0) + 1);
    const text = lines
      .map((l) => l.text)
      .join(" ")
      .toLowerCase();
    return {
      act: i + 1,
      from: Math.round(from * 10) / 10,
      to: Math.round(to * 10) / 10,
      lines: lines.length,
      speakers: [...speakers.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([s]) => s)
        .slice(0, 6),
      places: placeNames
        .filter((p) => text.includes(p.toLowerCase()))
        .slice(0, 6),
      opening: lines.slice(0, 3).map((l) => l.text),
      closing: lines.slice(-2).map((l) => l.text),
      indexed: Math.round(covered(index, from, to) * 100) / 100,
    };
  });
}

/** "1:02:03" or "4:05". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * One act's dialogue as a transcript (pure), "[1:02:03] Speaker: line", in order, thinned evenly to fit `maxChars`.
 * This is the game's own script for that stretch: the story chapter is written from it and checked against it.
 */
export function actTranscript(
  index: SceneIndex,
  act: Pick<StoryAct, "from" | "to">,
  maxChars = 9000,
): string {
  const rows = heardLinesIn(index, act.from, act.to).map(
    (l) =>
      `[${clock(l.start)}] ${l.speaker && !l.speakerGuessed ? `${l.speaker}: ` : ""}${l.text.trim()}`,
  );
  let kept = rows;
  let total = rows.reduce((n, r) => n + r.length + 1, 0);
  if (total > maxChars) {
    const keep = Math.max(1, Math.floor((rows.length * maxChars) / total));
    kept = Array.from(
      { length: keep },
      (_, i) => rows[Math.floor((i * rows.length) / keep)]!,
    );
    total = kept.reduce((n, r) => n + r.length + 1, 0);
  }
  return kept.join("\n");
}

/** The act's transcript under a "[Outlet] title" header, as a chapter's source carries its other parts. */
export function actSourceText(
  game: string,
  index: SceneIndex,
  act: StoryAct,
  maxChars = 9000,
): string {
  const t = actTranscript(index, act, maxChars);
  if (!t) return "";
  return `[${game}, the game's own cutscenes] Transcript of act ${act.act} (${clock(act.from)} to ${clock(act.to)} of the full-story movie; heard lines, speakers where known)\n${t}`;
}

// ---------------------------------------------------------------- the outline

export const RetroChapterSchema = z.object({
  section: z
    .enum(RETRO_SECTIONS)
    .describe("Which part of the retrospective this chapter belongs to"),
  chapter_title: z
    .string()
    .describe(
      "2-7 words a viewer would search for, naming this chapter's turning point, e.g. 'Grove Street, Home Again'. Never 'Part 3'",
    ),
  wiki_title: z
    .string()
    .describe(
      "The English Wikipedia article that best documents this chapter: usually the game's own, else the studio's, a person's or a related article",
    ),
  focus: z
    .string()
    .describe("What this chapter covers and its turning point, 1-3 sentences"),
  act: z
    .number()
    .int()
    .describe(
      "Story chapters only: the act of the story this chapter tells, from the act list; 0 for every other section",
    ),
  moments: z
    .array(z.string())
    .max(6)
    .describe(
      "Best-moments and story chapters: the scenes, missions or lines to show, named as a player would say them; else empty",
    ),
  photo_searches: z
    .array(z.string())
    .max(4)
    .describe(
      "1-4 searches for real photos a free archive like Wikimedia Commons would hold: the studio, its people, the real cities the game recreates, the launch. Never game screenshots",
    ),
});
export type RetroChapter = z.infer<typeof RetroChapterSchema>;

export const RetroOutlineSchema = z.object({
  question: z
    .string()
    .describe(
      "The one question the retrospective answers, as a viewer would ask it; the ending answers it as a verdict",
    ),
  kicker: z.string().describe("3-8 word line under the title"),
  chapters: z.array(RetroChapterSchema),
  youtube: z.object({
    description: z
      .string()
      .describe(
        "3-5 sentences spoken to the viewer about the video itself: what it covers, that it spoils the whole story, and its angle. Never about this plan, its sources or what is missing from them. No hashtags, no timestamps",
      ),
    tags: z.array(z.string()).max(15),
  }),
});
export type RetroOutline = z.infer<typeof RetroOutlineSchema>;

export interface RetroOutlineInput {
  game: string;
  short: string;
  title: string;
  angle: string;
  minutes: number;
  /** The game's Wikipedia overview (development, plot, reception). */
  overview: string;
  acts: StoryAct[];
  /** Other Wikipedia articles a chapter may name as its source (the studio, a controversy, a remaster). */
  also?: string[];
  feedback?: string[];
}

const HOUSE = `You plan long retrospectives for Pulse Gaming News, a YouTube channel about video games. British English, no serial comma. The narrator is the viewer's friend who knows this game inside out: warm, sure of his takes, a little dry; he says "I" rarely.`;

/** The outline brief (pure, exported for the dry run and the tests). */
export function retroOutlineSystem(
  budget: Record<RetroSection, number>,
): string {
  const total = budgetTotal(budget);
  const sections = RETRO_SECTIONS.map(
    (s, i) =>
      `${i + 1}. ${s} (${RETRO_SECTION_INFO[s].label}): exactly ${budget[s]} chapter${budget[s] === 1 ? "" : "s"}. ${RETRO_SECTION_INFO[s].brief}`,
  ).join("\n");
  return `${HOUSE}

Plan a full retrospective of one game in ${total} chapters, each about ${Math.round(RETRO_CHAPTER_WORDS / RETRO_WPM)} minutes of narration, in this order of sections:
${sections}

The story section tells the whole story with full spoilers, ending included: story chapter k tells act k of the act list, in order, so "act" is 1, 2, 3 ... across the story chapters and every act is told once. Its title names that act's turning point. The other sections have act 0. An act with few or no lines listed is planned from the overview's plot, in story order, as if it were complete: the list is only a guide to where the game's scenes fall, and nothing in the plan ever mentions what the list lacks.
Chapter titles are mini-headlines with a verb or a conflict, each searchable on its own ("The Riot That Ended It", "How Rockstar Built a State"), never a topic label ("Reception", "Gameplay") and never "Part 2". No two alike.
Plan only what the overview or an act's lines document: a chapter built on something neither mentions can't be written. "wiki_title" is the article that documents the chapter (usually the game's own).
Write the question the retrospective answers.`;
}

export async function outlineRetro(
  llm: Llm,
  input: RetroOutlineInput,
): Promise<RetroOutline> {
  const budget = retroChapterBudget(input.minutes);
  const acts = input.acts
    .map(
      (a) =>
        `Act ${a.act} (${clock(a.from)} to ${clock(a.to)}${a.indexed < 0.95 ? `, ${Math.round(a.indexed * 100)}% indexed so far` : ""}): ${a.lines} lines${a.speakers.length ? `; speakers ${a.speakers.join(", ")}` : ""}${a.places.length ? `; places ${a.places.join(", ")}` : ""}${a.opening.length ? `\n  opens: ${a.opening.map((l) => `"${l}"`).join(" ")}` : ""}${a.closing.length ? `\n  ends: ${a.closing.map((l) => `"${l}"`).join(" ")}` : ""}`,
    )
    .join("\n");
  const fb = input.feedback?.length
    ? `\n\nA previous outline was rejected. Fix every one of these problems:\n${input.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    site: "retro.outline",
    system: retroOutlineSystem(budget),
    content: `Game: ${input.game} (people call it ${input.short})\nTitle: ${input.title}\nAngle: ${input.angle}\nTarget length: ${retroMinutes(input.minutes)} minutes${input.also?.length ? `\nOther articles a chapter may name as its wiki_title: ${input.also.join("; ")}` : ""}\n\nThe story's acts, cut from the full-story movie at its scene breaks (the game's own lines):\n${acts || "(none)"}\n\nOverview (Wikipedia):\n${input.overview || "(not available)"}${fb}`,
    schema: RetroOutlineSchema,
    effort: "medium",
    maxTokens: 12000,
  });
}

/** What is wrong with an outline, as lines for the planner; empty when it holds (pure). */
export function validateRetroOutline(
  outline: RetroOutline,
  budget: Record<RetroSection, number>,
  acts: number,
): string[] {
  const out: string[] = [];
  // Notes to the factory in a title, a focus or the description ("is missing", "the excerpts supplied") are never
  // the video: the description goes out as it stands, and a title is what the chapter is written to.
  const notes = writerNoteProblems(
    [outline.youtube.description, ...outline.chapters.flatMap((c) => [c.chapter_title, c.focus])].join("\n"),
  );
  if (notes.length) out.push(...notes.slice(0, 3).map((n) => `Not for the viewer: ${n}`));
  for (const c of outline.chapters)
    if (/\b(missing|not indexed|excerpts?|unavailable|incomplete)\b/i.test(c.chapter_title))
      out.push(`"${c.chapter_title}" talks about the material, not the game; name the act's turning point from the overview's plot.`);
  const order = outline.chapters.map((c) => RETRO_SECTIONS.indexOf(c.section));
  for (let i = 1; i < order.length; i++)
    if (order[i]! < order[i - 1]!) {
      out.push(
        `Chapter ${i + 1} ("${outline.chapters[i]!.chapter_title}") is a ${outline.chapters[i]!.section} chapter after a ${outline.chapters[i - 1]!.section} chapter; keep the sections in order: ${RETRO_SECTIONS.join(", ")}.`,
      );
      break;
    }
  for (const s of RETRO_SECTIONS) {
    const n = outline.chapters.filter((c) => c.section === s).length;
    if (n < RETRO_SECTION_INFO[s].min)
      out.push(
        `The ${s} section has ${n} chapters; it needs at least ${RETRO_SECTION_INFO[s].min}.`,
      );
    else if (
      Math.abs(n - budget[s]) > Math.max(1, Math.round(budget[s] * 0.25))
    )
      out.push(`The ${s} section has ${n} chapters; plan ${budget[s]}.`);
  }
  const story = outline.chapters.filter((c) => c.section === "story");
  const told = story.map((c) => c.act);
  if (
    acts > 0 &&
    told.join(",") !== Array.from({ length: acts }, (_, i) => i + 1).join(",")
  )
    out.push(
      `The story chapters tell acts ${told.join(", ") || "none"}; they must tell acts 1 to ${acts}, one each, in order.`,
    );
  const seen = new Set<string>();
  for (const c of outline.chapters) {
    const t = c.chapter_title.trim().toLowerCase();
    if (/\bpart\s+\d+\b|^chapter\s+\d+/i.test(t))
      out.push(`"${c.chapter_title}" is a number, not a headline.`);
    if (seen.has(t)) out.push(`"${c.chapter_title}" is used twice.`);
    seen.add(t);
    if (!c.wiki_title.trim())
      out.push(`"${c.chapter_title}" names no source article.`);
  }
  return out;
}

export interface RetroChapterInfo {
  section: RetroSection;
  act?: number;
  moments?: string[];
}

/** The game's facts a chapter plan carries (the year and platforms of its first release). */
export interface RetroGameFacts {
  game: string;
  wiki: string;
  year: number;
  platforms: string;
  steam: string;
}

/** The brief a chapter is written to: its section's job, its own focus and the moments to name (pure). */
export function retroFocus(
  c: Pick<RetroChapter, "section" | "focus" | "moments" | "act">,
  act?: StoryAct,
): string {
  const info = RETRO_SECTION_INFO[c.section];
  const moments = c.moments?.length
    ? ` Name these so they can be shown: ${c.moments.join("; ")}.`
    : "";
  const span = act
    ? ` This is act ${act.act} of the story, ${clock(act.from)} to ${clock(act.to)} of the game's cutscenes; tell only what happens in it.`
    : "";
  return `${info.label}. ${c.focus.trim()}${span}${moments} ${info.brief}`;
}

/**
 * The retrospective's outline as the documentary lane's (pure): every chapter about the one game, its focus the
 * section's brief, its title the plan's fixed title. `info` keeps each chapter's section and act, in order.
 */
export function retroDocOutline(
  outline: RetroOutline,
  facts: RetroGameFacts,
  frame: { title: string; thumb: string },
  acts: StoryAct[],
): { outline: DocOutline; info: RetroChapterInfo[] } {
  const chapters: DocChapterPlan[] = outline.chapters.map((c) => ({
    chapter_title: c.chapter_title.trim(),
    game_title: facts.game,
    wiki_title: c.wiki_title.trim() || facts.wiki,
    steam_search_term: facts.steam,
    year: facts.year,
    platforms: facts.platforms,
    focus: retroFocus(
      c,
      c.section === "story" ? acts.find((a) => a.act === c.act) : undefined,
    ),
    photo_searches: c.photo_searches.slice(0, 4),
  }));
  return {
    outline: {
      question: outline.question,
      title: frame.title,
      kicker: outline.kicker,
      franchise_wiki_title: facts.wiki,
      chapters,
      youtube: {
        title: frame.title,
        ...(frame.thumb ? { thumb_text: frame.thumb } : {}),
        description: outline.youtube.description,
        tags: outline.youtube.tags,
      },
    },
    info: outline.chapters.map((c) => ({
      section: c.section,
      ...(c.section === "story" && c.act ? { act: c.act } : {}),
      ...(c.moments.length ? { moments: c.moments } : {}),
    })),
  };
}

// ---------------------------------------------------------------- spoilers and reviews

/** The warning a retrospective opens on: its very first line. */
export function retroSpoilerLine(short: string): string {
  return `Spoiler warning: this is the whole story of ${short}, ending and all, so if you haven't finished it, this is your stop.`;
}

/** The opening with the warning first, unless it already starts with one (pure). */
export function withRetroWarning(hook: string, short: string): string {
  const h = hook.trim();
  if (/^[^.!?]*\bspoilers?\b/i.test(h)) return h;
  return `${retroSpoilerLine(short)} ${h}`;
}

/** A title says it spoils (pure): "Full Story", "Spoilers" or "Ending" in it. */
export function titleWarnsSpoilers(title: string): boolean {
  return /\bspoilers?\b|\bfull story\b|\bending\b|\bwhole story\b/i.test(title);
}

const QUOTED = /["“]([^"”]{12,400})["”]/g;
const normText = (t: string) =>
  t
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A quoted verdict in the narration (pure): word for word in the source, and its sentence names someone the source
 * names near that quote (the outlet or the critic). Lines quoted from the game's own transcript only need the first.
 * Returns the problems, for the writer.
 */
export function reviewQuoteProblems(
  narration: string,
  source: string,
  game = "",
): string[] {
  const out: string[] = [];
  const hay = normText(source);
  const own = new Set(plain(game));
  const sentences = narration.match(/[^.!?]+[.!?]+["”]?|[^.!?]+$/g) ?? [
    narration,
  ];
  for (const sentence of sentences) {
    for (const m of sentence.matchAll(QUOTED)) {
      const q = normText(m[1]!);
      if (q.split(" ").length < 4) continue;
      const at = hay.indexOf(q);
      if (at < 0) {
        out.push(
          `The quote "${m[1]!.trim()}" is not word for word in the source; copy it exactly or say it in your own words without quote marks.`,
        );
        continue;
      }
      // A line from the game's own cutscenes is credited by the story around it, not by an outlet.
      const where = sourceIndexNear(source, m[1]!);
      if (/cutscenes\]/.test(lastHeader(source, where))) continue;
      const near = source.slice(
        Math.max(0, where - 320),
        where + m[1]!.length + 200,
      );
      const names = [
        ...near.matchAll(
          /\b([A-Z][\p{L}&.'-]{2,}(?:\s+[A-Z][\p{L}&.'-]{2,})*)/gu,
        ),
      ]
        .map((x) => x[1]!)
        .filter(
          (n) =>
            !plain(n).every((w) => own.has(w)) &&
            !/^(The|This|That|It|In|On|At|He|She|They|His|Her|Its)$/.test(n),
        );
      const said = sentence.replace(QUOTED, " ");
      if (
        !names.some(
          (n) =>
            said.includes(n) ||
            plain(n).some(
              (w) => w.length > 3 && !own.has(w) && plain(said).includes(w),
            ),
        )
      )
        out.push(
          `The quote "${m[1]!.trim()}" does not say who said it; name the outlet or critic the source gives.`,
        );
    }
  }
  return out;
}

/** The last "[Outlet] title" header line before `at` (transcript rows start "[1:02:03]" and are not headers). */
function lastHeader(source: string, at: number): string {
  let found = "";
  for (const m of source.slice(0, at).matchAll(/^\[[^\]\d][^\]]*\][^\n]*/gm))
    found = m[0];
  return found;
}

/** Where a quote sits in the original source text (case and punctuation aside), for the look around it. */
function sourceIndexNear(source: string, quote: string): number {
  const words = plain(quote).slice(0, 4);
  if (!words.length) return 0;
  const re = new RegExp(
    words
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^\\p{L}\\p{N}]+"),
    "iu",
  );
  const m = re.exec(source.replace(/[‘’]/g, "'"));
  return m ? m.index : 0;
}

// ---------------------------------------------------------------- footage and quotes

/**
 * Seconds of a publisher's footage one chapter may carry (pure): its per-Short cap (PUBLISHER_FOOTAGE_SECONDS,
 * which sits on a one-minute Short) scaled to the chapter's own length, times `scale`, never above `max` nor the
 * chapter's own length. A Short cap of 0 (stills only) stays 0.
 */
export function retroChapterFootageSeconds(
  shortCap: number,
  chapterSeconds: number,
  scale = 1,
  max = 150,
): number {
  if (shortCap <= 0 || chapterSeconds <= 0) return 0;
  return Math.max(
    0,
    Math.min(
      max,
      chapterSeconds * 0.9,
      Math.round(shortCap * (chapterSeconds / 60) * scale),
    ),
  );
}

/** Chapter seconds from its words at the planning pace. */
export function chapterSecondsOf(words: number, wpm = RETRO_WPM): number {
  return Math.round((words / wpm) * 60);
}

/** The most character quotes each chapter takes (pure): story and best-moments chapters more, the rest one. */
export function retroQuotesPerChapter(
  info: readonly Pick<RetroChapterInfo, "section">[],
  storyQuotes: number,
  otherQuotes = 1,
): number[] {
  return info.map((c) =>
    c.section === "story" || c.section === "moments"
      ? Math.max(0, storyQuotes)
      : Math.max(0, otherQuotes),
  );
}

// ---------------------------------------------------------------- model calls

/** The documentary lane's sites as a retrospective's own (pure): "doc.chapter" -> "retro.chapter". */
export function retroSite(site: string | undefined): string {
  if (!site) return "retro.other";
  if (site.startsWith("retro.")) return site;
  const map: Record<string, string> = {
    "friend.doc": "retro.friend",
    "quote.long": "retro.quote",
    "titles.long": "retro.titles",
  };
  if (map[site]) return map[site]!;
  const m = site.match(/^doc\.(.+)$/);
  return m ? `retro.${m[1]}` : `retro.${site.replace(/\./g, "-")}`;
}

/**
 * The model with every call renamed to a retrospective's site, so CODEX_CALLS=retro (or retro.chapter, ...) routes
 * the strand without touching the documentary lane's own routing. The router reads the site it is given.
 */
export function retroSites(llm: Llm): Llm {
  return {
    structured(opts) {
      return llm.structured({ ...opts, site: retroSite(opts.site) });
    },
  };
}

/** The sites a retrospective uses, for .env.example and the switch-on note. */
export const RETRO_CODEX_SITES = [
  "retro.outline",
  "retro.chapter",
  "retro.check",
  "retro.shots",
  "retro.photos",
  "retro.bookends",
  "retro.friend",
  "retro.quote",
  "sceneindex.speakers",
] as const;
