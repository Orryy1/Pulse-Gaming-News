// The weekly news recap: an 8-11 minute long video of the week's biggest stories, one chapter each,
// written from the same articles the Shorts were written from. It replaces Friday's Weekly Recap
// Short: same week, room to explain, and the watch hours a channel needs for the Partner Program.
// It reuses the documentary's shape (chapters of paragraphs with callouts) so it renders, voices
// and passes QA through the documentary path.
import {
  advertiserProblems,
  phraseProblems,
  stockSegueProblems,
  voiceFor,
  writingProblems,
} from "./voice.ts";
import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { Script } from "./schema.ts";
import {
  type DocMoment,
  DocBookendsSchema,
  DocChapterSchema,
  docToScript,
  type DocBookends,
  type DocChapter,
  type DocChapterPlan,
  type DocDraft,
  type DocOutline,
} from "./documentary.ts";
import type { WikiArticle } from "../discovery/wikipedia.ts";

export const RECAP_STORIES_MIN = 5;
export const RECAP_STORIES_MAX = 6;
export const RECAP_CHAPTER_WORDS_MIN = 150;
export const RECAP_CHAPTER_WORDS_MAX = 300;
export const RECAP_PARAGRAPHS_MIN = 3;
export const RECAP_PARAGRAPHS_MAX = 4;

const HOUSE = `You write for Pulse Gaming News, a YouTube channel about video games.

${voiceFor("recap")}`;

/** One of the week's Shorts as the recap sees it. */
export interface RecapStory {
  episodeId: string;
  headline: string;
  game: string;
  steamTerm: string;
  views: number;
  /** The Short's own narration (already fact-checked) and the articles it was written from. */
  source: WikiArticle;
}

export const RecapPackagingSchema = z.object({
  title: z
    .string()
    .describe("On-screen title, 3-7 words, e.g. 'This Week in Gaming'"),
  kicker: z
    .string()
    .describe("3-8 word line under the title naming the week's biggest story"),
  chapter_titles: z
    .array(z.string())
    .describe(
      "One per story, in the given order: 2-7 searchable words naming the game and the news, e.g. 'GTA 6 Launch Trailer Breaks Records'",
    ),
  youtube: z.object({
    title: z
      .string()
      .describe(
        "Under 70 characters, leads with the week's biggest story and its game, e.g. 'GTA 6 Trailer, Switch 2 Price and More: Gaming News This Week'",
      ),
    description: z
      .string()
      .describe("3-5 sentences naming every story. No hashtags, no timestamps"),
    tags: z.array(z.string()).max(15),
  }),
});
export type RecapPackaging = z.infer<typeof RecapPackagingSchema>;

export async function packageRecap(
  llm: Llm,
  stories: RecapStory[],
  weekOf: string,
): Promise<RecapPackaging> {
  return llm.structured({
    site: "recap.package",
    system: `${HOUSE}

Package this week's gaming news recap video: its title, a chapter title for each story (in the order given, biggest first) and the YouTube metadata. Titles must be accurate to the stories; no clickbait.`,
    content: `Week of ${weekOf}. Stories, biggest first:\n${stories.map((s, i) => `${i + 1}. ${s.headline} (${s.game})`).join("\n")}`,
    schema: RecapPackagingSchema,
    effort: "low",
    tier: "mid",
  });
}

export function recapChapterPrompt(): string {
  return `${HOUSE}

Write one story of this week's gaming news recap, ${RECAP_CHAPTER_WORDS_MIN}-${RECAP_CHAPTER_WORDS_MAX} spoken words in ${RECAP_PARAGRAPHS_MIN}-${RECAP_PARAGRAPHS_MAX} paragraphs of 40-90 words.
Open on the news itself, with the game's name, in the first sentence. Then the details a fan would want (dates, prices, platforms, what was shown); then the context the sources give (the last game, earlier delays, how it compares); then what it means for players. End on this story's own consequence or the next date to watch; the next story's title card does the handover, so never a stock segue ("speaking of...", "our next story...", "meanwhile...").
In the whole recap, "we think" comes at most twice, and "in fairness" and "which, fair" once each at most: find other words for the rest. A game's full title and a person's role once, then the short form and the surname.
Every fact, number, date, name and quote must come from the SOURCES text provided. If the sources do not say it, do not say it. A rumor stays a rumor: say who reported it.
Callouts put a real fact on screen: at most half the paragraphs carry one, and a quote must be copied word for word from the sources. Most paragraphs use "none".
footage names what the picture should show for that paragraph, with 1-4 keywords.
List every factual claim in "claims" with the outlet it came from as the section.`;
}

export async function writeRecapChapter(
  llm: Llm,
  ctx: {
    story: RecapStory;
    title: string;
    index: number;
    titles: string[];
    previousEnding?: string;
    feedback?: string[];
  },
): Promise<DocChapter> {
  const list = ctx.titles
    .map((t, i) => `${i + 1}. ${t}${i === ctx.index ? "  <- this story" : ""}`)
    .join("\n");
  const fb = ctx.feedback?.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${ctx.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    site: "recap.chapter",
    system: recapChapterPrompt(),
    content: `This week's stories:\n${list}\n\nThis story: ${ctx.title}\nGame: ${ctx.story.game}${ctx.previousEnding ? `\n\nThe previous story ended: "${ctx.previousEnding}"` : ""}\n\nSOURCES:\n${ctx.story.source.text}${fb}`,
    schema: DocChapterSchema,
    effort: "medium",
    maxTokens: 8000,
  });
}

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export function validateRecapChapter(
  c: DocChapter,
  /** The stories written before this one: the stock lines are counted across the whole recap. */
  earlier: DocChapter[] = [],
): string[] {
  const p: string[] = [];
  const text = c.paragraphs.map((x) => x.narration).join(" ");
  // Stock segues ("speaking of"), a possessive year, copied example lines and how it sounds aloud.
  p.push(...phraseProblems(text), ...writingProblems(text, { long: true }));
  p.push(
    ...stockSegueProblems(
      [
        ...earlier.flatMap((x) => x.paragraphs.map((y) => y.narration)),
        text,
      ].join(" "),
    ),
  );
  const words = c.paragraphs.reduce((n, x) => n + wordCount(x.narration), 0);
  if (words < RECAP_CHAPTER_WORDS_MIN || words > RECAP_CHAPTER_WORDS_MAX)
    p.push(
      `The story is ${words} words; it must be ${RECAP_CHAPTER_WORDS_MIN}-${RECAP_CHAPTER_WORDS_MAX}.`,
    );
  if (
    c.paragraphs.length < RECAP_PARAGRAPHS_MIN ||
    c.paragraphs.length > RECAP_PARAGRAPHS_MAX
  )
    p.push(`Use ${RECAP_PARAGRAPHS_MIN}-${RECAP_PARAGRAPHS_MAX} paragraphs.`);
  const callouts = c.paragraphs.filter((x) => x.callout.kind !== "none").length;
  if (callouts > Math.ceil(c.paragraphs.length / 2))
    p.push("Too many callouts: at most half the paragraphs carry one.");
  if (
    /let me know in the comments|like and subscribe|without further ado|buckle up/i.test(
      c.paragraphs.map((x) => x.narration).join(" "),
    )
  )
    p.push("Banned phrase.");
  p.push(
    ...advertiserProblems(
      c.paragraphs
        .map(
          (x) => `${x.narration} ${x.callout.primary} ${x.callout.secondary}`,
        )
        .join(" "),
    ),
  );
  return p;
}

export async function writeRecapBookends(
  llm: Llm,
  packaging: RecapPackaging,
  chapters: Array<{ title: string; chapter: DocChapter }>,
): Promise<DocBookends> {
  const digest = chapters
    .map(
      ({ title, chapter }, i) =>
        `${i + 1}. ${title}: ${chapter.claims
          .slice(0, 5)
          .map((c) => c.claim)
          .join("; ")}`,
    )
    .join("\n");
  return llm.structured({
    site: "recap.bookends",
    system: `${HOUSE}

Write the intro and outro of this week's finished gaming news recap. The intro opens on the week's single biggest fact (no "In this video", no "Welcome"), then says in one sentence what else is coming up. The outro picks the story that matters most and says what to watch for next; it may close with one question to the viewer. Set about_index to that story's number (0-based, in the given order): its footage plays behind the outro. Use only facts from the story notes. The outro label is 2-4 words, e.g. "THE TAKEAWAY". Never a stock segue such as "speaking of".`,
    content: `Recap: ${packaging.title}\n\nStories and their facts:\n${digest}`,
    schema: DocBookendsSchema,
    effort: "medium",
  });
}

/**
 * The recap in the common Script shape, through the documentary's converter: chapters keep their
 * order, each entry points back at its Short so the recap reuses that Short's checked media.
 */
export function recapToScript(
  packaging: RecapPackaging,
  stories: RecapStory[],
  chapters: DocChapter[],
  bookends: DocBookends,
  year: number,
  /** Each story's shot list (one moment per sentence), as the documentaries have. */
  moments?: Array<DocMoment[] | undefined>,
): Script {
  const plans: DocChapterPlan[] = stories.map((s, i) => ({
    chapter_title: packaging.chapter_titles[i] ?? s.headline,
    game_title: s.game,
    wiki_title: "",
    steam_search_term: s.steamTerm,
    year,
    platforms: "",
    focus: s.headline,
    photo_searches: [],
  }));
  const outline: DocOutline = {
    question: packaging.title,
    title: packaging.title,
    kicker: packaging.kicker,
    franchise_wiki_title: "",
    chapters: plans,
    youtube: packaging.youtube,
  };
  const draft: DocDraft = {
    topic: {
      kind: "franchise",
      franchise_index: 0,
      story_index: -1,
      title_idea: packaging.title,
      angle: "",
      reason: "weekly recap",
      franchise: "Gaming news",
    },
    outline,
    chapters: plans.map((plan, i) => ({
      plan,
      chapter: chapters[i]!,
      source: stories[i]!.source,
      moments: moments?.[i],
    })),
    bookends,
  };
  const script = docToScript(draft);
  const beats = script.beats.map((b) =>
    b.visual.kind === "chapter"
      ? { ...b, visual: { ...b.visual, items: [] } }
      : b,
  );
  return {
    ...script,
    beats,
    game_title: "Gaming news",
    attribution: "Sources: the publishers and outlets credited below / Pulse",
    hook_footage: {
      want: "cinematic",
      keywords: [stories[0]?.game ?? "gaming"],
    },
    entries: script.entries?.map((e, i) => ({
      ...e,
      from_episode: stories[i]!.episodeId,
      year: 0,
      platforms: "",
    })),
    recap: true,
    take_entry:
      typeof bookends.outro.about_index === "number" &&
      bookends.outro.about_index >= 0 &&
      bookends.outro.about_index < stories.length
        ? bookends.outro.about_index
        : 0,
  } as Script;
}
