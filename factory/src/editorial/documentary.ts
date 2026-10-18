// The documentary lane: a monthly 16:9 franchise history, 25 to 40 minutes,
// one chapter per game in release order ("The Complete History of Grand
// Theft Auto"). Every fact comes from the game's Wikipedia article, fetched
// at write time: each chapter is written against its own sources, checked
// against them by a second pass and rewritten when a claim is not supported.
// On-screen quotes and numbers must appear in the source text verbatim.

import { z } from "zod";
import type { Llm } from "./llm.ts";
import { FootageSchema, type Script, type BeatVisual } from "./schema.ts";
import type { WikiArticle } from "../discovery/wikipedia.ts";

export const DOC_CHAPTERS_MIN = 5;
export const DOC_CHAPTERS_MAX = 10;
export const DOC_PARAGRAPHS_MIN = 4;
export const DOC_PARAGRAPHS_MAX = 8;
export const DOC_PARAGRAPH_WORDS_MIN = 45;
export const DOC_PARAGRAPH_WORDS_MAX = 140;
export const DOC_CHAPTER_WORDS_MIN = 380;
export const DOC_CHAPTER_WORDS_MAX = 780;
export const DOC_WORDS_MIN = 3200;
export const DOC_WORDS_MAX = 6400;

/** Franchises with a long, well-documented history and official footage on Steam or the publisher's channel. */
export const DOC_FRANCHISES = [
  "Grand Theft Auto",
  "Resident Evil",
  "Call of Duty",
  "Fallout",
  "The Elder Scrolls",
  "Halo",
  "Assassin's Creed",
  "Doom",
  "Half-Life",
  "Battlefield",
  "Far Cry",
  "Tomb Raider",
  "Mass Effect",
  "Red Dead",
  "Metal Gear",
  "Silent Hill",
  "Final Fantasy",
  "Street Fighter",
  "Mortal Kombat",
  "Diablo",
  "BioShock",
  "Hitman",
  "Dark Souls and the Soulsborne games",
  "The Witcher",
  "Need for Speed",
  "Tony Hawk's Pro Skater",
  "Sonic the Hedgehog",
  "Crash Bandicoot",
  "God of War",
  "Uncharted",
  "Gears of War",
  "Borderlands",
  "Civilization",
  "The Sims",
  "Monster Hunter",
  "Devil May Cry",
  "Saints Row",
  "Max Payne",
  "Dead Space",
  "Command & Conquer",
] as const;

const HOUSE = `You write documentaries for Pulse Gaming News, a credible, entertaining YouTube channel about video games.
American English spelling for a US-first audience, AP style (no serial comma). The voice is a great documentary narrator: story-led, specific, warm, quietly funny, never breathless. Scenes before summaries: put the viewer in the studio, the year, the moment. Real names, real places, real numbers.
Advertiser-friendly: describe violence, lawsuits and controversies factually and calmly, with no graphic detail. No "like and subscribe", no "let me know in the comments", no "without further ado", no "buckle up".
The channel speaks as "Pulse" only rarely; mostly the story speaks for itself.`;

// ---------------------------------------------------------------- topic

export const DocTopicSchema = z.object({
  franchise_index: z
    .number()
    .int()
    .describe(
      "Index into the franchise list, or -1 if none is strong enough right now",
    ),
  title_idea: z
    .string()
    .describe("Working title, e.g. 'The Complete History of Grand Theft Auto'"),
  angle: z
    .string()
    .describe(
      "The through-line that makes this history worth watching, one sentence",
    ),
  reason: z
    .string()
    .describe("Why this franchise now: timing, interest, depth of story"),
});
export type DocTopic = z.infer<typeof DocTopicSchema> & { franchise: string };

export async function selectDocTopic(
  llm: Llm,
  covered: string[],
  inTheNews: string[],
  franchises: readonly string[] = DOC_FRANCHISES,
): Promise<DocTopic | undefined> {
  const t = await llm.structured({
    system: `${HOUSE}

You are choosing this month's long documentary: a franchise history told game by game, 25 to 40 minutes. Pick the franchise that will pull the most viewers right now: a new release, trailer or anniversary in the news beats a quiet franchise; a big, dramatic development story beats a thin one. It needs at least five major games. Never repeat a franchise already covered (listed).`,
    content: `Franchises:\n${franchises.map((f, i) => `${i}. ${f}`).join("\n")}\n\nAlready covered:\n${covered.map((c) => `- ${c}`).join("\n") || "- none"}\n\nIn the news over the last two weeks:\n${
      inTheNews
        .slice(0, 40)
        .map((h) => `- ${h}`)
        .join("\n") || "- nothing notable"
    }`,
    schema: DocTopicSchema,
    effort: "low",
  });
  const franchise = franchises[t.franchise_index];
  if (!franchise) return undefined;
  return { ...t, franchise };
}

// ---------------------------------------------------------------- outline

export const DocChapterPlanSchema = z.object({
  chapter_title: z
    .string()
    .describe(
      "2-7 words a viewer would search for, e.g. 'GTA III and the Leap to 3D'. Never 'Part 3'",
    ),
  game_title: z
    .string()
    .describe("Exact official title of the game this chapter is about"),
  wiki_title: z
    .string()
    .describe(
      "The English Wikipedia article title for that game, e.g. 'Grand Theft Auto: Vice City'",
    ),
  steam_search_term: z
    .string()
    .describe(
      "Steam store search term for this game or its current re-release; empty if it has never been on Steam",
    ),
  year: z.number().int().describe("Original release year"),
  platforms: z
    .string()
    .describe("Original platforms, short, e.g. 'PS2, PC, Xbox'"),
  focus: z.string().describe("What this chapter covers and its turning point, 1-2 sentences"),
  photo_searches: z
    .array(z.string())
    .max(4)
    .describe("1-4 searches for real photos a free archive like Wikimedia Commons would hold for this chapter: the studio building, the city, the people, the launch, the real place a game was based on, e.g. 'Rockstar North Edinburgh', 'Ocean Drive Miami Beach'. Never a search for game screenshots or box art"),
});

export const DocOutlineSchema = z.object({
  title: z
    .string()
    .describe(
      "On-screen title, 3-8 words, e.g. 'The Complete History of Grand Theft Auto'",
    ),
  kicker: z
    .string()
    .describe("3-8 word line under the title, e.g. 'From Dundee to Leonida'"),
  franchise_wiki_title: z
    .string()
    .describe(
      "The franchise's English Wikipedia article title, e.g. 'Grand Theft Auto'",
    ),
  chapters: z
    .array(DocChapterPlanSchema)
    .min(DOC_CHAPTERS_MIN)
    .max(DOC_CHAPTERS_MAX)
    .describe(
      "The mainline games in release order, one chapter each; fold minor spin-offs into the nearest chapter's story",
    ),
  youtube: z.object({
    title: z
      .string()
      .describe(
        "Under 70 characters, front-loads the franchise and ends with '| Documentary' or similar, e.g. 'The Complete History of Grand Theft Auto | Documentary'",
      ),
    description: z
      .string()
      .describe(
        "3-5 sentences: what the documentary covers and its angle. No hashtags, no timestamps",
      ),
    tags: z.array(z.string()).max(15),
  }),
});
export type DocOutline = z.infer<typeof DocOutlineSchema>;

export async function outlineDoc(
  llm: Llm,
  topic: DocTopic,
  franchiseNotes: string,
): Promise<DocOutline> {
  return llm.structured({
    system: `${HOUSE}

Plan a franchise documentary told game by game in release order, ${DOC_CHAPTERS_MIN}-${DOC_CHAPTERS_MAX} chapters, one per major game. Choose the games whose development stories matter most; fold spin-offs into a neighboring chapter's story. Chapter titles must be searchable on their own.`,
    content: `Franchise: ${topic.franchise}\nWorking title: ${topic.title_idea}\nAngle: ${topic.angle}\n\nFranchise overview (Wikipedia):\n${franchiseNotes || "(not available)"}`,
    schema: DocOutlineSchema,
    effort: "medium",
  });
}

// ---------------------------------------------------------------- chapters

export const CALLOUT_KINDS = ["none", "quote", "stat", "date"] as const;

export const DocParagraphSchema = z.object({
  narration: z
    .string()
    .describe(
      `${DOC_PARAGRAPH_WORDS_MIN}-${DOC_PARAGRAPH_WORDS_MAX} spoken words`,
    ),
  callout: z.object({
    kind: z.enum(CALLOUT_KINDS),
    primary: z
      .string()
      .describe(
        "quote: a short quote copied word for word from the source, under 20 words. stat: the number exactly as the source writes it, e.g. '17 million'. date: the date, e.g. 'October 2002'. none: empty",
      ),
    secondary: z
      .string()
      .describe(
        "quote: who said it. stat: what the number counts, 2-6 words. date: what happened, 2-6 words. none: empty",
      ),
  }),
  footage: FootageSchema,
});

export const DocChapterSchema = z.object({
  paragraphs: z
    .array(DocParagraphSchema)
    .min(DOC_PARAGRAPHS_MIN)
    .max(DOC_PARAGRAPHS_MAX),
  claims: z.array(
    z.object({
      claim: z.string(),
      section: z.string().describe("The source section it comes from"),
    }),
  ),
});
export type DocChapter = z.infer<typeof DocChapterSchema>;
export type DocChapterPlan = z.infer<typeof DocChapterPlanSchema>;

export function chapterPrompt(): string {
  return `${HOUSE}

Write one chapter of a game-by-game franchise documentary, ${DOC_CHAPTER_WORDS_MIN}-${DOC_CHAPTER_WORDS_MAX} spoken words in ${DOC_PARAGRAPHS_MIN}-${DOC_PARAGRAPHS_MAX} paragraphs of ${DOC_PARAGRAPH_WORDS_MIN}-${DOC_PARAGRAPH_WORDS_MAX} words.
The first paragraph opens on a scene or a moment that names the year, so the viewer knows where they are. Then the development story, the people and the decisions; then the launch and how it landed; end on what it changed and a line that leads into the next game.
Every fact, number, date, name and quote must come from the SOURCE text provided. If the source does not say it, do not say it. Do not repeat what earlier chapters covered.
Callouts put a real fact on screen: at most half the paragraphs carry one, and a quote must be copied word for word from the source. Most paragraphs use "none".
footage names what the picture should show for that paragraph, with 1-4 keywords.
List every factual claim in "claims" with the source section it came from.`;
}

export async function writeChapter(
  llm: Llm,
  ctx: {
    franchise: string;
    plan: DocChapterPlan;
    index: number;
    outline: DocOutline;
    source: WikiArticle;
    previousEnding?: string;
    feedback?: string[];
  },
): Promise<DocChapter> {
  const others = ctx.outline.chapters
    .map(
      (c, i) =>
        `${i + 1}. ${c.chapter_title} (${c.game_title}, ${c.year})${i === ctx.index ? "  <- this chapter" : ""}`,
    )
    .join("\n");
  const fb = ctx.feedback?.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${ctx.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    system: chapterPrompt(),
    content: `Documentary: ${ctx.outline.title}\nChapters:\n${others}\n\nThis chapter: ${ctx.plan.chapter_title}\nGame: ${ctx.plan.game_title} (${ctx.plan.year}, ${ctx.plan.platforms})\nFocus: ${ctx.plan.focus}${ctx.previousEnding ? `\n\nThe previous chapter ended: "${ctx.previousEnding}"` : ""}\n\nSOURCE (Wikipedia, "${ctx.source.title}"):\n${ctx.source.text}${fb}`,
    schema: DocChapterSchema,
    effort: "medium",
    maxTokens: 12000,
  });
}

export const DocCheckSchema = z.object({
  unsupported: z.array(
    z.object({
      quote: z.string().describe("The exact narration text with the problem"),
      problem: z
        .string()
        .describe(
          "What the source says instead, or that it says nothing about this",
        ),
    }),
  ),
});

/** A second reader checks the chapter against its own source: specific facts only, not framing or opinion. */
export async function checkChapter(
  llm: Llm,
  chapter: DocChapter,
  source: WikiArticle,
): Promise<string[]> {
  const r = await llm.structured({
    system: `You are a documentary fact-checker. Compare the narration with the SOURCE. List every specific factual statement (a date, number, name, quote, ranking, sales figure, event or cause) that the source does not support or that contradicts it. Framing, scene-setting description, transitions and clearly marked opinion are fine. Be strict about numbers and quotes. Return an empty list when everything checks out.`,
    content: `NARRATION:\n${chapter.paragraphs.map((p) => p.narration).join("\n\n")}\n\nSOURCE (Wikipedia, "${source.title}"):\n${source.text}`,
    schema: DocCheckSchema,
    effort: "medium",
  });
  return r.unsupported.map((u) => `"${u.quote}": ${u.problem}`);
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[‘’“”"']/g, "")
    .replace(/[^a-z0-9%$£€.]+/g, " ")
    .trim();

/**
 * On-screen facts must be in the source as written: a quote word for word, a
 * number's digits as the source writes them. Anything else is taken off the
 * screen (the narration keeps its wording; the checker has already read it).
 */
export function groundCallouts(
  chapter: DocChapter,
  source: WikiArticle,
): { chapter: DocChapter; removed: string[] } {
  const hay = norm(source.text);
  const removed: string[] = [];
  const paragraphs = chapter.paragraphs.map((p) => {
    const c = p.callout;
    if (c.kind === "none")
      return {
        ...p,
        callout: { kind: "none" as const, primary: "", secondary: "" },
      };
    let ok = Boolean(c.primary.trim());
    if (ok && c.kind === "quote") ok = hay.includes(norm(c.primary));
    if (ok && c.kind === "stat") {
      const digits = c.primary.match(/\d[\d,.]*/g) ?? [];
      ok = digits.length > 0 && digits.every((d) => hay.includes(norm(d)));
    }
    if (ok && c.kind === "date") {
      const year = c.primary.match(/\b(19|20)\d\d\b/)?.[0];
      ok = !year || hay.includes(year);
    }
    if (ok && c.primary.length > 140) ok = false;
    if (ok) return p;
    removed.push(`${c.kind}: ${c.primary}`);
    return {
      ...p,
      callout: { kind: "none" as const, primary: "", secondary: "" },
    };
  });
  return { chapter: { ...chapter, paragraphs }, removed };
}

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export function validateChapter(c: DocChapter): string[] {
  const p: string[] = [];
  const words = c.paragraphs.reduce((n, x) => n + wordCount(x.narration), 0);
  if (words < DOC_CHAPTER_WORDS_MIN || words > DOC_CHAPTER_WORDS_MAX)
    p.push(
      `The chapter is ${words} words; it must be ${DOC_CHAPTER_WORDS_MIN}-${DOC_CHAPTER_WORDS_MAX}.`,
    );
  for (const [i, x] of c.paragraphs.entries()) {
    const n = wordCount(x.narration);
    if (n < DOC_PARAGRAPH_WORDS_MIN - 10 || n > DOC_PARAGRAPH_WORDS_MAX + 20)
      p.push(
        `Paragraph ${i + 1} is ${n} words; keep paragraphs ${DOC_PARAGRAPH_WORDS_MIN}-${DOC_PARAGRAPH_WORDS_MAX}.`,
      );
  }
  const callouts = c.paragraphs.filter((x) => x.callout.kind !== "none").length;
  if (callouts > Math.ceil(c.paragraphs.length / 2))
    p.push("Too many callouts: at most half the paragraphs carry one.");
  if (
    /let me know in the comments|like and subscribe|without further ado|buckle up/i.test(
      c.paragraphs.map((x) => x.narration).join(" "),
    )
  )
    p.push("Banned phrase.");
  return p;
}

// ---------------------------------------------------------------- bookends

export const DocBookendsSchema = z.object({
  intro: z.object({
    narration: z
      .string()
      .describe(
        "110-200 spoken words: a cold open on one vivid moment from the story, then what this documentary covers and why it matters",
      ),
    on_screen: z.string().describe("3-8 word kicker under the title"),
  }),
  outro: z.object({
    label: z
      .string()
      .describe("2-4 word card label, e.g. 'WHAT COMES NEXT' or 'THE LEGACY'"),
    narration: z
      .string()
      .describe(
        "90-180 spoken words: what the whole run adds up to and where the franchise stands now",
      ),
    on_screen: z.string().describe("3-8 word summary line"),
  }),
});
export type DocBookends = z.infer<typeof DocBookendsSchema>;

export async function writeBookends(
  llm: Llm,
  outline: DocOutline,
  chapters: Array<{ plan: DocChapterPlan; chapter: DocChapter }>,
  franchiseNotes: string,
): Promise<DocBookends> {
  const digest = chapters
    .map(
      ({ plan, chapter }, i) =>
        `${i + 1}. ${plan.chapter_title} (${plan.game_title}, ${plan.year}): ${chapter.claims
          .slice(0, 6)
          .map((c) => c.claim)
          .join("; ")}`,
    )
    .join("\n");
  return llm.structured({
    system: `${HOUSE}

Write the intro and outro of a finished franchise documentary. The intro is a cold open: start inside one vivid, true moment from the chapters below (no "In this video"), then say what the documentary covers. The outro ties the run together and says where the franchise stands now. Use only facts from the chapter notes and the overview.`,
    content: `Documentary: ${outline.title}\n\nChapters and their facts:\n${digest}\n\nFranchise overview (Wikipedia):\n${franchiseNotes.slice(0, 5000)}`,
    schema: DocBookendsSchema,
    effort: "medium",
  });
}

export function validateBookends(b: DocBookends): string[] {
  const p: string[] = [];
  const i = wordCount(b.intro.narration);
  if (i < 90 || i > 230) p.push(`The intro is ${i} words; it must be 110-200.`);
  const o = wordCount(b.outro.narration);
  if (o < 70 || o > 210) p.push(`The outro is ${o} words; it must be 90-180.`);
  return p;
}

// ---------------------------------------------------------------- assembly

export interface DocDraft {
  topic: DocTopic;
  outline: DocOutline;
  chapters: Array<{
    plan: DocChapterPlan;
    chapter: DocChapter;
    source: WikiArticle;
  }>;
  bookends: DocBookends;
}

export function narrationOfDoc(d: DocDraft): string {
  return [
    d.bookends.intro.narration,
    ...d.chapters.flatMap((c) => c.chapter.paragraphs.map((p) => p.narration)),
    d.bookends.outro.narration,
  ].join(" ");
}

export function docWordCount(d: DocDraft): number {
  return wordCount(narrationOfDoc(d));
}

/**
 * The common Script shape. Each paragraph is a beat; a chapter's first beat
 * carries the "chapter" card (number, title, game, year). Entries are the
 * chapters, ranked so that the highest rank is the first chapter: media is
 * gathered per entry in descending rank order, so entry i is chapter i.
 */
export function docToScript(d: DocDraft): Script {
  const n = d.chapters.length;
  const beats = d.chapters.flatMap(({ plan, chapter }, ci) =>
    chapter.paragraphs.map((p, pi) => ({
      narration: p.narration,
      footage: p.footage,
      visual: (pi === 0
        ? {
            kind: "chapter",
            primary: plan.chapter_title,
            secondary: plan.game_title,
            value_a: ci + 1,
            items: [String(plan.year), plan.platforms],
          }
        : p.callout.kind === "none"
          ? { kind: "none", primary: "", secondary: "" }
          : {
              kind: p.callout.kind,
              primary: p.callout.primary,
              secondary: p.callout.secondary,
            }) as BeatVisual,
    })),
  );
  const sources = [...new Set(d.chapters.map((c) => c.source.url))];
  return {
    story_type: "other",
    game_title: d.topic.franchise,
    steam_search_term: "",
    headline: d.outline.title,
    hook: d.bookends.intro.narration,
    hook_footage: { want: "cinematic", keywords: [d.topic.franchise] },
    beats,
    pulse_take: {
      label: d.bookends.outro.label.toUpperCase(),
      narration: d.bookends.outro.narration,
      on_screen: d.bookends.outro.on_screen,
    },
    loop_line: "",
    is_rumour: false,
    attribution: "Sources: Wikipedia / Pulse",
    youtube: d.outline.youtube,
    claims: d.chapters.flatMap((c) =>
      c.chapter.claims.map((x) => ({
        claim: x.claim,
        source_url: c.source.url,
      })),
    ),
    entries: d.chapters.map(({ plan }, ci) => ({
      rank: n - ci,
      game_title: plan.game_title,
      steam_search_term: plan.steam_search_term,
      year: plan.year,
      platforms: plan.platforms,
      photos: plan.photo_searches ?? [],
    })),
    evergreen_format: "documentary",
    runtime: "long",
    criterion: "",
    kicker: d.bookends.intro.on_screen || d.outline.kicker,
    sources,
  } as Script;
}

export const PhotoPickSchema = z.object({
  keep: z
    .array(z.number().int())
    .describe("Indices of the photos that clearly show something this chapter is about (its studio, people, places, launch or the real place the game recreates), best first, at most 5. Empty if none fit"),
});

/** A quick editor pass over archive search results: only photos that belong in this chapter survive. */
export async function pickPhotos(
  llm: Llm,
  chapter: { franchise: string; game: string; title: string; opening: string },
  candidates: Array<{ title: string; description: string }>,
): Promise<number[]> {
  if (!candidates.length) return [];
  const r = await llm.structured({
    system:
      "You pick archive photos for a video game documentary chapter. Keep a photo only when it clearly shows something the chapter is about: the studio, its people, the city or real place the game is set in or based on, a launch event, the hardware of the era. Reject anything about an unrelated person, place or thing that merely shares a word.",
    content: `Documentary: ${chapter.franchise}\nChapter: ${chapter.title} (${chapter.game})\nOpening: ${chapter.opening.slice(0, 600)}\n\nPhotos:\n${candidates.map((c, i) => `${i}. ${c.title.replace(/^File:/, "")}: ${c.description.slice(0, 160)}`).join("\n")}`,
    schema: PhotoPickSchema,
    effort: "low",
  });
  return [...new Set(r.keep)].filter((i) => i >= 0 && i < candidates.length).slice(0, 5);
}
