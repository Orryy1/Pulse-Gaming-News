// The retrospective strand's steps inside the pipeline (upgrade queue item 26): the outline from the scene index's
// acts, each chapter's own source (its section's Wikipedia reading, the plan's press for that section and, for a
// story chapter, its act's transcript), the extra checks, the quotes and the footage allowance per chapter. The
// planning and the pure rules are in src/retrospective.ts and src/editorial/retrospective.ts.

import type { Config } from "./config.ts";
import type { Episode } from "./episodes.ts";
import { logEvent } from "./episodes.ts";
import { log } from "./lib/util.ts";
import type { Services } from "./pipeline.ts";
import type { DocOutline, DocTopic } from "./editorial/documentary.ts";
import type { Script } from "./editorial/schema.ts";
import type { WikiArticle } from "./discovery/wikipedia.ts";
import {
  actSourceText,
  budgetTotal,
  chapterSecondsOf,
  outlineRetro,
  RETRO_CHAPTER_WORDS,
  RETRO_SECTION_INFO,
  RETRO_SECTIONS,
  retroChapterBudget,
  retroChapterFootageSeconds,
  retroDocOutline,
  retroQuotesPerChapter,
  retroSites,
  reviewQuoteProblems,
  storyActs,
  validateRetroOutline,
  type RetroChapterInfo,
  type RetroSection,
  type StoryAct,
} from "./editorial/retrospective.ts";
import { sourcesForSection } from "./retrospective.ts";
import { writerNoteProblems } from "./editorial/writernotes.ts";
import { quoteIndexFor } from "./charquotestep.ts";
import { cutscenePublisher } from "./assets/cutscenes.ts";
import type { SceneIndex } from "./sceneindex/schema.ts";

type Retro = NonNullable<DocTopic["retro"]>;

/** The services with every model call under a retrospective's own site (retro.chapter, retro.check, ...). */
export function retroServices<S extends { llm: Services["llm"] }>(s: S): S {
  return Object.assign(Object.create(s) as S, { llm: retroSites(s.llm) });
}

/** The game's scene index, for the outline's acts, the story's sources and the quotes. */
export async function retroIndex(
  cfg: Pick<Config, "dataDir">,
  game: string,
): Promise<SceneIndex | undefined> {
  return quoteIndexFor(cfg.dataDir, game);
}

/**
 * The outline: the story's acts cut from the scene index, one "retro.outline" call, sent back once with its problems;
 * an outline that still breaks the section order or leaves an act untold stops the step. The chapters' sections and
 * acts are written onto the topic, which the episode keeps.
 */
export async function retroOutlineFor(
  s: Pick<Services, "llm" | "db" | "cfg">,
  ep: Pick<Episode, "id">,
  topic: DocTopic,
  overview: string,
): Promise<DocOutline> {
  const retro = topic.retro!;
  const budget = retroChapterBudget(retro.minutes);
  const index = await retroIndex(s.cfg, topic.franchise);
  const acts = index ? storyActs(index, budget.story) : [];
  const input = {
    game: topic.franchise,
    short: retro.short,
    title: retro.title,
    angle: topic.angle,
    minutes: retro.minutes,
    overview,
    acts,
    also: retro.also_wiki,
  };
  let outline = await outlineRetro(s.llm, input);
  let problems = validateRetroOutline(outline, budget, acts.length);
  if (problems.length) {
    outline = await outlineRetro(s.llm, { ...input, feedback: problems });
    problems = validateRetroOutline(outline, budget, acts.length);
  }
  await logEvent(s.db, ep.id, "retro_outline", {
    budget,
    chapters: outline.chapters.map((c) => ({
      section: c.section,
      title: c.chapter_title,
      act: c.act || undefined,
    })),
    acts: acts.map((a) => ({
      act: a.act,
      from: a.from,
      to: a.to,
      lines: a.lines,
      indexed: a.indexed,
    })),
    problems,
  }).catch(() => undefined);
  // A description that still talks to the factory is replaced by a plain one from the plan: it goes out as it stands.
  if (writerNoteProblems(outline.youtube.description).length) {
    outline = {
      ...outline,
      youtube: {
        ...outline.youtube,
        description: `${topic.angle} Full spoilers: this covers the whole story of ${retro.short}, ending included.`,
      },
    };
    problems = validateRetroOutline(outline, budget, acts.length);
  }
  // Counts a chapter or so off the budget are a style matter; the order, the story's acts and notes are not.
  const must = problems.filter((p) =>
    /in order|must tell|needs at least|names no source|Not for the viewer|talks about the material/.test(p),
  );
  if (must.length)
    throw new Error(`retrospective outline not fit to write: ${must[0]}`);
  const doc = retroDocOutline(
    outline,
    {
      game: topic.franchise,
      wiki: topic.wiki ?? topic.franchise,
      year: retro.year,
      platforms: retro.platforms,
      steam: retro.steam,
    },
    { title: retro.title, thumb: retro.thumb },
    acts,
  );
  retro.chapters = doc.info;
  retro.acts = acts;
  log("info", "retrospective outlined", {
    episode: ep.id,
    chapters: doc.outline.chapters.length,
    planned: budgetTotal(budget),
    acts: acts.length,
  });
  return doc.outline;
}

/** What a chapter's Wikipedia reading looks for: its section's words, then its own title and focus. */
export function retroResearchFocus(
  retro: Retro,
  i: number,
  plan: { chapter_title: string; focus: string },
): string {
  const section = retro.chapters?.[i]?.section;
  return `${section ? RETRO_SECTION_INFO[section].research : ""} ${plan.chapter_title} ${plan.focus}`.trim();
}

/**
 * A chapter's source (pure apart from its inputs): its Wikipedia reading, the plan's press for its section and, for a
 * story chapter, its act's transcript from the game's own cutscenes, each under its own header.
 */
export function retroChapterSource(
  retro: Retro,
  i: number,
  article: WikiArticle,
  press: ReadonlyArray<{ url: string; text: string }>,
  index: SceneIndex | undefined,
): WikiArticle {
  const info = retro.chapters?.[i];
  const section: RetroSection = info?.section ?? "history";
  const parts = [article.text];
  for (const p of sourcesForSection(press, section, retro.source_sections))
    parts.push(p.text);
  const act = info?.act
    ? retro.acts?.find((a) => a.act === info.act)
    : undefined;
  if (act && index) {
    const t = actSourceText(index.game, index, act);
    if (t) parts.push(t);
  }
  return { ...article, text: parts.filter(Boolean).join("\n\n") };
}

/** The retrospective's own checks on a chapter draft: quoted reviews and lines word for word and credited. */
export function retroChapterProblems(
  narration: string,
  source: WikiArticle,
  game: string,
): string[] {
  return reviewQuoteProblems(narration, source.text, game);
}

/**
 * RETRO_SANDBOX_CHAPTERS: which chapters a sandbox writes, "1,story:1" (chapter numbers, or a section and its
 * k-th chapter), as 0-based indexes in outline order; undefined when unset.
 */
export function retroSandboxChapters(
  spec: string,
  info: readonly RetroChapterInfo[],
): number[] | undefined {
  const parts = spec
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  const out = new Set<number>();
  for (const p of parts) {
    const m = p.match(/^([a-z]+):(\d+)$/);
    if (m) {
      const at = info
        .map((c, i) => ({ c, i }))
        .filter((x) => x.c.section === m[1])[Number(m[2]) - 1];
      if (at) out.add(at.i);
    } else if (/^\d+$/.test(p) && Number(p) >= 1 && Number(p) <= info.length)
      out.add(Number(p) - 1);
  }
  return [...out].sort((a, b) => a - b);
}

/** Each written chapter's act span, in on-screen order (for its footage and its quotes). */
export function retroChapterSpans(
  retro: Retro,
  written: readonly number[],
): Array<{ from: number; to: number } | undefined> {
  return written.map((i) => {
    const act = retro.chapters?.[i]?.act
      ? retro.acts?.find((a) => a.act === retro.chapters![i]!.act)
      : undefined;
    return act ? { from: act.from, to: act.to } : undefined;
  });
}

/**
 * Where each written chapter's footage comes from in the scene index's movie (pure): a story chapter from its own act;
 * a chapter before the story (history, making of, innovations) from the first act, so its pictures spoil nothing the
 * story has not reached; a chapter after it (moments, reception, legacy) from the whole movie. Each sentence then
 * gets the movie's scene at its own place in that stretch when its words match nothing more exact (the 13 Nov proof:
 * with shot descriptions paused, a history chapter matched no scene and fell to a watermarked upload).
 */
export function retroFootageSpans(
  retro: Retro,
  written: readonly number[],
): Array<{ from: number; to: number } | undefined> {
  const acts = retro.acts ?? [];
  const story = retroChapterSpans(retro, written);
  if (!acts.length) return story;
  const whole = { from: acts[0]!.from, to: acts.at(-1)!.to };
  const first = { from: acts[0]!.from, to: acts[0]!.to };
  return written.map((i, k) => {
    const section = retro.chapters?.[i]?.section;
    if (!section) return undefined;
    if (section === "story") return story[k];
    return RETRO_SECTIONS.indexOf(section) < RETRO_SECTIONS.indexOf("story") ? first : whole;
  });
}

/** The quote options for a retrospective's script (story and best-moments chapters take more). */
export function retroQuoteOptions(
  cfg: Pick<
    Config,
    | "retroQuotesStory"
    | "retroQuotesOther"
    | "retroQuotesMax"
    | "retroFootageScale"
    | "retroChapterFootageMax"
  >,
  retro: Retro,
  game: string,
  written: readonly number[] = retro.written ?? (retro.chapters ?? []).map((_, i) => i),
): {
  perChapter: number[];
  ranges: Array<{ from: number; to: number } | undefined>;
  max: number;
  footageCap: { key: string; seconds: number };
} {
  const info = written.map(
    (i) => retro.chapters?.[i] ?? { section: "history" as const },
  );
  const perChapter = retroQuotesPerChapter(
    info,
    cfg.retroQuotesStory,
    cfg.retroQuotesOther,
  );
  const owner = cutscenePublisher(game);
  // The quotes' own seconds share the publisher's footage across the video: every chapter's allowance together.
  const seconds =
    written.length *
    retroChapterFootageSeconds(
      owner.seconds,
      chapterSecondsOf(RETRO_CHAPTER_WORDS),
      cfg.retroFootageScale,
      cfg.retroChapterFootageMax,
    );
  return {
    perChapter,
    ranges: retroChapterSpans(retro, written),
    max: Math.max(0, cfg.retroQuotesMax),
    footageCap: { key: owner.key, seconds },
  };
}

/** The chapters as written, in on-screen order: their indexes in the outline. */
export function retroWrittenChapters(
  retro: Retro,
  written?: readonly number[],
): number[] {
  return written ? [...written] : (retro.chapters ?? []).map((_, i) => i);
}

/** Seconds of a script's chapter at the planning pace, from its own words. */
export function chapterWords(
  script: Pick<Script, "beats">,
  chapter: number,
): number {
  let c = -1;
  let n = 0;
  for (const b of script.beats) {
    if (b.visual?.kind === "chapter") c++;
    if (c === chapter)
      n += b.narration.trim().split(/\s+/).filter(Boolean).length;
  }
  return n;
}

/** Each chapter's footage allowance in seconds, from its own length and the game publisher's per-Short cap. */
export function retroFootageCaps(
  cfg: Pick<Config, "retroFootageScale" | "retroChapterFootageMax">,
  script: Pick<Script, "beats" | "entries">,
  game: string,
): number[] {
  const owner = cutscenePublisher(game);
  return (script.entries ?? []).map((_, k) =>
    retroChapterFootageSeconds(
      owner.seconds,
      chapterSecondsOf(chapterWords(script, k)),
      cfg.retroFootageScale,
      cfg.retroChapterFootageMax,
    ),
  );
}

export type { StoryAct };
