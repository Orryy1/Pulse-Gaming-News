// The documentary lane: a 16:9 documentary, 20 to 40 minutes, in one of two shapes. A franchise
// history, one chapter per game in release order ("The Complete History of Grand Theft Auto"); or a
// single story, one event, decision, flop or downfall told in turning points ("How Xbox Spent $69 Billion
// and Ended Up on PlayStation"): the shape that broke out for small channels in a study of 18 gaming
// documentaries (25 Oct 2026; TheCollapseCo's 24-minute Xbox One story drew 100 times its subscriber
// count in views). Every fact comes from the game's Wikipedia article, fetched
// at write time: each chapter is written against its own sources, checked
// against them by a second pass and rewritten when a claim is not supported.
// On-screen quotes and numbers must appear in the source text verbatim.

import { advertiserProblems, voiceFor, withSignOff } from "./voice.ts";
import { z } from "zod";
import type { Llm } from "./llm.ts";
import { FootageSchema, type Script, type BeatVisual } from "./schema.ts";
import type { WikiArticle } from "../discovery/wikipedia.ts";
import { placeFor } from "../render/places.ts";
import { REHOOK_RULE, rehookProblems } from "./rehooks.ts";

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

/**
 * Single stories: one event, decision, flop or downfall, each well documented on Wikipedia (the overview
 * article named here; the outline finds one article per chapter). Chosen from the 25 Oct 2026 study for
 * topics that broke out for small channels and are not already the subject of a big documentary.
 */
export const DOC_STORIES = [
  {
    subject: "Grand Theft Auto VI",
    wiki: "Grand Theft Auto VI",
    angle:
      "Why GTA 6 took thirteen years: GTA Online's money, Red Dead 2, Dan Houser leaving, the 2022 leak and the delays",
  },
  {
    subject: "Xbox under Phil Spencer",
    wiki: "Acquisition of Activision Blizzard by Microsoft",
    angle:
      "How Xbox spent $69 billion on Activision and ended up putting its games on PlayStation",
  },
  {
    subject: "Halo after Bungie",
    wiki: "343 Industries",
    angle:
      "Halo's lost decade: 343 Industries, Halo Infinite, Halo Studios and Halo on PS5",
  },
  {
    subject: "Tango Gameworks",
    wiki: "Tango Gameworks",
    angle: "Hi-Fi Rush won awards, then its studio was closed, then rescued",
  },
  {
    subject: "Embracer Group",
    wiki: "Embracer Group",
    angle:
      "The company that bought everything: a buying spree, a collapsed deal, then the closures",
  },
  {
    subject: "Skull and Bones",
    wiki: "Skull and Bones (video game)",
    angle: "Ubisoft's eleven-year voyage to a 'AAAA' pirate game",
  },
  {
    subject: "Google Stadia",
    wiki: "Google Stadia",
    angle:
      "The console Google could not keep: the promises, the shutdown, the refunds",
  },
  {
    subject: "Duke Nukem Forever",
    wiki: "Duke Nukem Forever",
    angle: "Fifteen years of development hell and what finally shipped",
  },
  {
    subject: "Anthem",
    wiki: "Anthem (video game)",
    angle:
      "BioWare's bet on a live-service shooter and why Anthem Next never came",
  },
  {
    subject: "Cyberpunk 2077",
    wiki: "Cyberpunk 2077",
    angle:
      "The launch that was pulled from the PlayStation Store, and the long road back",
  },
  {
    subject: "No Man's Sky",
    wiki: "No Man's Sky",
    angle: "From the most hated launch to one of gaming's great redemptions",
  },
  {
    subject: "The Wii U",
    wiki: "Wii U",
    angle: "Nintendo's console nobody understood, and how it set up the Switch",
  },
  {
    subject: "Kinect",
    wiki: "Kinect",
    angle: "Microsoft's record-breaking gadget that ended in the bin",
  },
  {
    subject: "The Sega Dreamcast",
    wiki: "Dreamcast",
    angle: "Sega's last console: ahead of its time and out of money",
  },
  {
    subject: "E.T. the Extra-Terrestrial",
    wiki: "E.T. the Extra-Terrestrial (video game)",
    angle:
      "The game made in five weeks, the landfill legend and what was really buried",
  },
  {
    subject: "Daikatana",
    wiki: "Daikatana",
    angle:
      "'John Romero's about to make you his bitch': the ad, the delays and the fall of Ion Storm",
  },
  {
    subject: "Rockstar's Agent",
    wiki: "Agent (video game)",
    angle: "Rockstar's spy game, announced on stage in 2009 and never released",
  },
  {
    subject: "The PlayStation 3 launch",
    wiki: "PlayStation 3",
    angle: "$599, the Cell processor and how Sony nearly lost a generation",
  },
] as const;

const HOUSE = `You write documentaries for Pulse Gaming News, a YouTube channel about video games.

${voiceFor("documentary")}
Describe violence, lawsuits and controversies factually and calmly, with no graphic detail.`;

// ---------------------------------------------------------------- topic

export const DocTopicSchema = z.object({
  kind: z
    .enum(["franchise", "story"])
    .describe("A franchise history, or a single story from the story list"),
  franchise_index: z
    .number()
    .int()
    .describe("Index into the franchise list when kind is franchise, else -1"),
  story_index: z
    .number()
    .int()
    .describe("Index into the story list when kind is story, else -1"),
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
/** franchise: the franchise, or the story's subject; wiki: the story's overview article. */
export type DocTopic = z.infer<typeof DocTopicSchema> & {
  franchise: string;
  wiki?: string;
};

export async function selectDocTopic(
  llm: Llm,
  covered: string[],
  inTheNews: string[],
  franchises: readonly string[] = DOC_FRANCHISES,
  stories: ReadonlyArray<{
    subject: string;
    wiki: string;
    angle: string;
  }> = DOC_STORIES,
  demand = "",
): Promise<DocTopic | undefined> {
  const t = await llm.structured({
    system: `${HOUSE}

You are choosing the next long documentary. Two shapes: a franchise history told game by game (25-40 minutes, needs at least five major games), or a single story told in turning points (20-30 minutes: one event, decision, flop or downfall). Single stories broke out for small channels far more often than franchise histories (a 24-minute story of one Xbox reveal drew 100 times its channel's subscribers), so prefer a single story unless a franchise is in the news right now (a new release, trailer or anniversary) and has a dramatic history. Every pick needs one engine: a person, a hunt or mystery (something unreleased, hidden or lost), one failure moment, a rivalry, or an underdog; in a study of 1,573 long gaming videos those angles carried the strongest, while even-paced surveys of well-covered subjects (a fourth "history of PlayStation") sat with the weakest however well they were made. Pick what will pull the most viewers now. Never repeat anything already covered (listed).`,
    content: `Franchises:\n${franchises.map((f, i) => `${i}. ${f}`).join("\n")}\n\nSingle stories:\n${stories.map((s, i) => `${i}. ${s.subject}: ${s.angle}`).join("\n")}\n\nAlready covered:\n${covered.map((c) => `- ${c}`).join("\n") || "- none"}\n\nIn the news over the last two weeks:\n${
      inTheNews
        .slice(0, 40)
        .map((h) => `- ${h}`)
        .join("\n") || "- nothing notable"
    }${demand ? `\n\n${demand}` : ""}`,
    schema: DocTopicSchema,
    effort: "low",
  });
  if (t.kind === "story") {
    const story = stories[t.story_index];
    if (!story) return undefined;
    return { ...t, franchise: story.subject, wiki: story.wiki };
  }
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
  focus: z
    .string()
    .describe("What this chapter covers and its turning point, 1-2 sentences"),
  photo_searches: z
    .array(z.string())
    .max(4)
    .describe(
      "1-4 searches for real photos a free archive like Wikimedia Commons would hold for this chapter: the studio building, the city, the people, the launch, the real place a game was based on, e.g. 'Rockstar North Edinburgh', 'Ocean Drive Miami Beach'. Never a search for game screenshots or box art",
    ),
});

export const DocOutlineSchema = z.object({
  question: z
    .string()
    .describe(
      "The one question the documentary answers, as a viewer would ask it, e.g. 'How did Xbox lose a generation in one hour?' The outro answers it as a verdict",
    ),
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
        "Under 70 characters: one named subject and its downfall, fight or hidden side, e.g. 'How Xbox Ended Up on PlayStation' or 'When Did Call of Duty Stop Being Call of Duty?'; never 'The Complete History of', years or counts",
      ),
    thumb_text: z
      .string()
      .describe(
        "1-4 words in capitals for the thumbnail that add the hook or the emotion and never repeat the title: 'THE $69B MISTAKE', 'NEVER RELEASED', 'IT WAS A TRAP'. In a study of 1,598 gaming thumbnails, short hook text beat restated titles, dates and 'Top 10' labels",
      )
      .optional(),
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
    system:
      topic.kind === "story"
        ? `${HOUSE}

Plan a single-story documentary told in turning points, in time order, ${DOC_CHAPTERS_MIN + 2}-${DOC_CHAPTERS_MAX} chapters. Each chapter is one beat of the story (a decision, a reveal, a launch, a reversal) and names, in "wiki_title", the English Wikipedia article that best documents it (a game, a console, a company or a person); "game_title" is that chapter's subject. Chapter titles name the turning point in 2-5 words as a mini-headline with a verb or a conflict ("The Reveal That Backfired", "Sony Answers", "The Reversal"), never a topic label ("Market impact", "Early years"); the last may be a question. The title names one subject and its downfall, fight or hidden side: "How X Ruined Y", "The X That Never Was", "What Really Happened to X", "How Xbox Ended Up on PlayStation". In a study of 1,573 long gaming videos the strongest titles did exactly that, while "The History of", "Evolution", "changed gaming forever", years and "top 10" counts belonged to the weakest; keep numbers out of the title unless the number is the story. Never "Part 1". Write the question the documentary answers.`
        : `${HOUSE}

Plan a franchise documentary told game by game in release order, ${DOC_CHAPTERS_MIN}-${DOC_CHAPTERS_MAX} chapters, one per major game. Choose the games whose development stories matter most; fold spin-offs into a neighboring chapter's story. Chapter titles must be searchable on their own and name the game's turning point as a mini-headline ("GTA III and the Leap to 3D", "The Hot Coffee Mess"), never a topic label. The title is one thesis question or claim about the franchise ("When Did Call of Duty Stop Being Call of Duty?"), never "The Complete History of" or "Evolution of". Write the question the documentary answers.`,
    content: `${topic.kind === "story" ? "Story" : "Franchise"}: ${topic.franchise}\nWorking title: ${topic.title_idea}\nAngle: ${topic.angle}\n\n${topic.kind === "story" ? "Overview" : "Franchise overview"} (Wikipedia):\n${franchiseNotes || "(not available)"}`,
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
The first paragraph opens on a scene or a moment that names the year, so the viewer knows where they are. Then the people and the decisions; then what happened and how it landed; end on what it changed.
Hold attention the way the best documentaries do:
- The last sentence of the chapter looks forward: it names what is coming without saying how it ends ("It would not stay that way for long." / "That decision would cost them a generation."). Never "In the next chapter".
- A hard number or a two-sided contrast at least every other paragraph ($399 against $499, 58 million against 117 million), always from the source.
- Name the people who made the decisions, with their roles, and judge decisions, never people; criticism is attributed to whoever made it in the source.
- One dry aside at most per chapter, aimed at a company or a situation, never at players.
- ${REHOOK_RULE} In a chapter that means two or three inside it, besides the forward-looking last line.
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

// ---------------------------------------------------------------- shot list

/**
 * A documentary's shot list, one moment per sentence (the long-form rankings' picture editor, widened):
 * the documentaries ran on a still with a small corner card every two minutes and repeated the same
 * three photos for whole chapters (GTA VI documentary, 27 Oct 2026). Each sentence now names what is on
 * screen and may carry a graphic (including a full-screen quote and a timeline), a kinetic caption, the
 * person it is about, or real-world B-roll from licensed stock.
 */
export const DOC_GRAPHIC_KINDS = [
  "none",
  "stat",
  "date",
  "list",
  "compare",
  "timeline",
  "quote",
  "headline",
  "delay",
  "span",
  "reviews",
  "versus",
  "source",
  "milestone",
  "people",
  // The wider suite (27 Oct 2026): a map, a bar chart, a share of a whole, technical specs, a family line.
  "map",
  "bars",
  "share",
  "specs",
  "lineage",
] as const;

export const DocMomentSchema = z.object({
  show: z
    .string()
    .describe(
      "What is on screen while this sentence is spoken: the game moment, place, person or real-world thing it names, 3-12 words",
    ),
  keywords: z
    .array(z.string())
    .max(4)
    .describe("1-4 short search terms for that picture"),
  broll: z
    .string()
    .describe(
      "Only when the sentence is about the real world rather than a game (a studio, money, a court case, crunch, a leak, a launch event, hardware): 2-4 plain words to search licensed stock footage, e.g. 'office at night', 'counting cash', 'server room', 'people queueing at a shop'. Never a game, a brand, a logo or a named person. Otherwise empty",
    ),
  graphic: z.object({
    kind: z.enum(DOC_GRAPHIC_KINDS),
    primary: z
      .string()
      .describe(
        "stat: the figure as the source writes it, e.g. '17 million'; date: e.g. 'September 2013'; list, compare, timeline: a 2-4 word heading; quote: the quote copied word for word from the SOURCE, 6-30 words; headline: the press story as a newspaper headline, 4-12 words, stating only what the SOURCE says; delay: what was delayed, e.g. 'GTA VI release'; span: e.g. '13 years in the making'; reviews: a 2-5 word heading; versus: a 2-5 word heading; source: a passage copied word for word from the SOURCE, 15-60 words; milestone: the record or first, 3-10 words, e.g. 'Fastest-selling entertainment product ever'; people: a 2-4 word heading; map: a 2-6 word heading, e.g. 'Where Rockstar North works'; bars, share, specs, lineage: a 2-5 word heading; none: empty",
      ),
    secondary: z
      .string()
      .describe(
        "stat/date: what it is, 2-6 words; quote: who said it and their role, e.g. 'Dan Houser, Rockstar co-founder'; headline: the outlet as the SOURCE names it and the year, e.g. 'The Guardian, 2005', or just the year when the source names no outlet; delay: the reason in 2-8 words if the source gives one; milestone: the year; bars: what the figures count, 2-4 words, e.g. 'copies sold'; empty otherwise",
      ),
    items: z
      .array(z.string())
      .max(6)
      .describe(
        "list: 2-5 short items; compare: exactly two or three 'label:value' rows; map: 1-3 real places the SOURCE names (cities, states or countries) in the order the story moves, e.g. 'Edinburgh', 'New York City'; bars: 2-6 'label: figure' rows from the SOURCE, e.g. 'Grand Theft Auto V: 210 million'; share: 2-5 'label: percent' rows from the SOURCE; specs: 2-6 'label: value' technical rows from the SOURCE, e.g. 'RAM: 32 MB'; lineage: 2-5 names in order, each 'Name: year' when the SOURCE gives the year, e.g. 'DMA Design: 1987'; timeline: 2-5 'year: what happened' rows in time order, 2-6 words each, e.g. '2013: GTA V launches'; delay: exactly two dates, the original then the new, e.g. 'Fall 2025', 'May 26, 2026'; span: exactly two years, start then end; reviews: 2-6 'Outlet: score' rows exactly as the SOURCE gives them, e.g. 'IGN: 10/10'; versus: exactly two game titles from this documentary's chapters (listed), older first; source: one 2-8 word phrase of the passage to highlight; people: 1-4 'Full Name: role' rows; empty otherwise",
      ),
  }),
  emphasis: z
    .string()
    .describe(
      "0-4 words from this sentence to land on screen as a kinetic caption (a name or phrase), or empty",
    ),
  person: z
    .string()
    .describe(
      "The real person or character this sentence is mainly about, by full name, or empty",
    ),
});
export type DocMoment = z.infer<typeof DocMomentSchema>;

export function docMomentsSchema(count: number) {
  return z.object({
    moments: z
      .array(DocMomentSchema)
      .min(count)
      .max(count)
      .describe(`Exactly ${count}: moment 1 for sentence 1, and so on`),
  });
}

export const DOC_MOMENTS_PROMPT = `You are the picture editor and motion-graphics designer for a long gaming documentary in the style of the best YouTube documentary channels. You get one chapter's narration as numbered sentences and its SOURCE, and return exactly one moment per sentence, in order.
The viewer should never sit on one picture for long. Every sentence names what is on screen ("show"), with 1-4 search keywords.
Explanatory graphics carry the story. Across the chapter, about four sentences in ten carry a graphic, never two in a row:
- quote: when the SOURCE quotes someone saying something revealing, put it on screen full size. Copy it word for word from the SOURCE (6-30 words) and name the speaker and role. One or two per chapter when the source has them; never invent or reword one.
- timeline: when a sentence moves through time or the chapter spans years, 2-5 "year: what happened" rows from the source, in order.
- compare: two or three "label:value" rows for a contrast the sentence draws ($59 against $69, 11 million against 25 million).
- stat: one striking figure the sentence says, exactly as the source writes it.
- date: the moment something happened.
- list: 2-5 things the sentence names.
- delay: when a release slipped, the original date struck through and the new one, both from the SOURCE.
- span: when the story spans years ("thirteen years after GTA V"), the start and end year.
- reviews: when the SOURCE lists critics' scores, up to six of them as it gives them.
- versus: when a sentence compares this game with another game in the documentary (graphics, map size, sales), the two titles from the chapter list.
- source: once or twice a chapter, the most telling passage of the SOURCE word for word, with the key phrase to highlight; it shows the viewer the record itself.
- milestone: a record or a first ("fastest-selling entertainment product in history"), as a game-style unlock.
- people: when a sentence introduces the people behind a decision, up to four names with their roles.
- map: when the story moves to a real place (the studio's city, a game's real-world setting, a launch abroad), 1-3 places the SOURCE names, cities or countries, in the order the story travels. About once a chapter when places matter.
- bars: when the SOURCE gives figures for two to six comparable things (sales of several games, budgets, team sizes), "label: figure" rows for a bar chart.
- share: when the SOURCE gives parts of a whole (a percentage split), 2-5 "label: percent" rows.
- specs: technical facts the SOURCE gives (hardware, engine, map size, team size, file size) as 2-6 "label: value" rows.
- lineage: when the SOURCE traces a family line (a studio renamed or bought, a series and its spin-offs), 2-5 names in order with their years.
- headline: when a sentence says the press or critics reported or reacted to something (a review, a scandal, a leak, a lawsuit, a launch), restate it as a newspaper headline of 4-12 words that says only what the SOURCE says, with the outlet and year the SOURCE gives. It appears as a recreated clipping, never a real outlet's page.
Every figure, year and quote in a graphic must be in the SOURCE.
B-roll: when a sentence is about the real world (the studio, its staff, money, contracts, a court case, a leak, crunch, a launch queue, a console), give "broll" a plain stock-footage search so a real shot can play; about one sentence in four. Never for something inside a game.
"emphasis" lands a complete name or phrase in about a third of the sentences without a graphic, never a fragment. "person" names the real person or character a sentence is mainly about.`;

/** One moment per sentence of a chapter; a short answer is padded so no sentence goes without one. */
export async function writeDocMoments(
  llm: Llm,
  ctx: {
    game: string;
    chapterTitle: string;
    sentences: string[];
    source: WikiArticle;
    /** Every chapter's game, for a "versus". */
    games?: string[];
    /** What the retention curves taught about graphics (src/analytics.ts visualLessons). */
    lessons?: string;
  },
): Promise<DocMoment[]> {
  const n = Math.max(1, ctx.sentences.length);
  let got: DocMoment[] = [];
  for (let attempt = 0; attempt < 2 && got.length !== n; attempt++) {
    try {
      const r = await llm.structured({
        tier: "mid",
        system: DOC_MOMENTS_PROMPT,
        content: `Chapter: ${ctx.chapterTitle} (${ctx.game})${ctx.games?.length ? `\nGames in this documentary's chapters: ${ctx.games.join("; ")}` : ""}\n\n${ctx.sentences.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\nSOURCE (Wikipedia, "${ctx.source.title}"):\n${ctx.source.text}${ctx.lessons ? `\n\n${ctx.lessons}` : ""}\n\nReturn exactly ${n} moments.`,
        schema: docMomentsSchema(n),
        effort: "low",
        maxTokens: 12000,
      });
      got = r.moments;
    } catch {
      // A list of the wrong length fails the schema; the second try or the padding covers it.
    }
  }
  const pad = (i: number): DocMoment => ({
    show: `${ctx.game}: ${ctx.sentences[i] ?? ctx.game}`.slice(0, 120),
    keywords: [ctx.game],
    broll: "",
    graphic: { kind: "none", primary: "", secondary: "", items: [] },
    emphasis: "",
    person: "",
  });
  return Array.from({ length: n }, (_, i) => got[i] ?? pad(i));
}

/**
 * On-screen facts in the shot list must be in the source as written, the same rule as the callouts:
 * a quote word for word, every number and year in a graphic. A graphic that fails is taken off the
 * screen (the sentence keeps its picture); two graphics in a row lose the second.
 */
export function groundDocMoments(
  moments: DocMoment[],
  source: WikiArticle,
  /** The documentary's chapter games: a "versus" may only name these (their pictures are on hand). */
  games?: string[],
): { moments: DocMoment[]; removed: string[] } {
  const hay = norm(source.text);
  const removed: string[] = [];
  const none = { kind: "none" as const, primary: "", secondary: "", items: [] };
  const digitsOk = (t: string) =>
    (t.match(/\d[\d,.]*/g) ?? []).every((d) => hay.includes(norm(d)));
  // Stricter for the charts: a figure must stand on its own in the source ("20" is not in "2002").
  const figuresOk = (t: string) =>
    (t.match(/\d[\d,.]*/g) ?? []).every((d) => {
      const f = norm(d)
        .replace(/[.]+$/, "")
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^0-9.])${f}($|[^0-9])`).test(hay);
    });
  let prevGraphic = false;
  const out = moments.map((m, i) => {
    const g = m.graphic;
    // The chapter's first sentence plays under its title card.
    let ok = g.kind !== "none" && i > 0;
    if (ok && g.kind === "quote")
      ok =
        wordCount(g.primary) >= 4 &&
        wordCount(g.primary) <= 40 &&
        hay.includes(norm(g.primary.replace(/^["“]|["”]$/g, "")));
    if (ok && g.kind === "stat")
      ok = /\d/.test(g.primary) && digitsOk(g.primary);
    if (ok && g.kind === "date") {
      const year = g.primary.match(/\b(19|20)\d\d\b/)?.[0];
      ok = !year || hay.includes(year);
    }
    if (
      ok &&
      (g.kind === "timeline" || g.kind === "compare" || g.kind === "list")
    )
      ok =
        g.items.length >= 2 &&
        g.items.every((x) => digitsOk(x)) &&
        (g.kind !== "compare" || g.items.every((x) => x.includes(":"))) &&
        (g.kind !== "timeline" ||
          g.items.every((x) => /\b(19|20)\d\d\b/.test(x)));
    if (ok && g.kind === "headline") {
      // A recreated clipping: its figures and year from the source, and an outlet only as the source names it.
      const outlet = g.secondary.split(",")[0]!.trim();
      const year = g.secondary.match(/\b(19|20)\d\d\b/)?.[0];
      ok =
        wordCount(g.primary) >= 3 &&
        wordCount(g.primary) <= 14 &&
        digitsOk(g.primary) &&
        (!year || hay.includes(year)) &&
        (!outlet || /^(19|20)\d\d$/.test(outlet) || hay.includes(norm(outlet)));
    }
    if (ok && g.kind === "delay")
      ok =
        g.items.length === 2 &&
        g.items.every(
          (x) =>
            digitsOk(x) &&
            (!x.match(/\b(19|20)\d\d\b/) ||
              hay.includes(x.match(/\b(19|20)\d\d\b/)![0])),
        );
    if (ok && g.kind === "span") {
      const ys = g.items.map((x) => x.match(/\b(19|20)\d\d\b/)?.[0]);
      ok =
        ys.length === 2 &&
        ys.every((y) => y && hay.includes(y)) &&
        Number(ys[1]) > Number(ys[0]) &&
        (g.primary.match(/\d+/g) ?? []).every(
          (d) => d === String(Number(ys[1]) - Number(ys[0])) || hay.includes(d),
        );
    }
    if (ok && g.kind === "reviews")
      ok =
        g.items.length >= 2 &&
        g.items.every((x) => {
          const i = x.indexOf(":");
          return (
            i > 0 &&
            hay.includes(norm(x.slice(0, i))) &&
            digitsOk(x.slice(i + 1))
          );
        });
    if (ok && g.kind === "versus")
      ok =
        g.items.length === 2 &&
        g.items.every((x) => (games ?? []).some((t) => norm(t) === norm(x)));
    if (ok && g.kind === "source")
      ok =
        wordCount(g.primary) >= 10 &&
        wordCount(g.primary) <= 70 &&
        hay.includes(norm(g.primary)) &&
        (!g.items[0] || norm(g.primary).includes(norm(g.items[0])));
    if (ok && g.kind === "milestone") {
      const year = g.secondary.match(/\b(19|20)\d\d\b/)?.[0];
      ok =
        wordCount(g.primary) >= 2 &&
        wordCount(g.primary) <= 12 &&
        digitsOk(g.primary) &&
        (!year || hay.includes(year));
    }
    if (ok && g.kind === "people")
      ok =
        g.items.length >= 1 &&
        g.items.every((x) => {
          const i = x.indexOf(":");
          return i > 0 && hay.includes(norm(x.slice(0, i)));
        });
    // A map pins only places the source names and the place list knows (src/render/places.ts).
    if (ok && g.kind === "map")
      ok =
        g.items.length >= 1 &&
        g.items.length <= 3 &&
        g.items.every((x) => placeFor(x) && hay.includes(norm(x))) &&
        digitsOk(g.primary);
    if (ok && (g.kind === "bars" || g.kind === "share" || g.kind === "specs")) {
      const rows = g.items.map((x) => {
        const i = x.indexOf(":");
        return i > 0
          ? { a: x.slice(0, i).trim(), b: x.slice(i + 1).trim() }
          : undefined;
      });
      ok =
        rows.length >= 2 &&
        rows.length <= (g.kind === "share" ? 5 : 6) &&
        rows.every(
          (r) =>
            r &&
            r.a &&
            r.b &&
            (g.kind === "specs" || /\d/.test(r.b)) &&
            (/\d/.test(r.b) ? figuresOk(r.b) : hay.includes(norm(r.b))),
        ) &&
        figuresOk(g.primary);
    }
    if (ok && g.kind === "lineage")
      ok =
        g.items.length >= 2 &&
        g.items.length <= 5 &&
        g.items.every((x) => {
          const name = x.split(":")[0]!.trim();
          const year = x.match(/\b(19|20)\d\d\b/)?.[0];
          return (
            name && hay.includes(norm(name)) && (!year || hay.includes(year))
          );
        });
    if (ok && prevGraphic) ok = false;
    if (g.kind !== "none" && !ok)
      removed.push(`${g.kind}: ${g.primary || g.items.join(" | ")}`);
    prevGraphic = ok;
    // The record's own words are credited to their article.
    if (ok && g.kind === "source")
      return {
        ...m,
        graphic: { ...g, secondary: `Wikipedia: ${source.title}` },
      };
    return ok ? m : { ...m, graphic: none };
  });
  return { moments: out, removed };
}

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
  // Advertiser-friendly words in the narration and on screen ("hidden sex minigame" became "hidden adult content").
  p.push(
    ...advertiserProblems(
      c.paragraphs
        .map(
          (x) => `${x.narration} ${x.callout.primary} ${x.callout.secondary}`,
        )
        .join(" "),
    ),
  );
  const callouts = c.paragraphs.filter((x) => x.callout.kind !== "none").length;
  if (callouts > Math.ceil(c.paragraphs.length / 2))
    p.push("Too many callouts: at most half the paragraphs carry one.");
  // A fresh question or tease every 150-300 words; a chapter that goes quiet for too long is sent back.
  p.push(...rehookProblems(c.paragraphs.map((x) => x.narration)));
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
    about_index: z
      .number()
      .int()
      .optional()
      .describe(
        "Weekly recap only: the 0-based index, in the given order, of the story the outro is mostly about, so that story's footage plays behind it",
      ),
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

Write the intro and outro of a finished documentary.
The intro is a cold open, in this order: the first sentence names a date, a place and a named person or an exact figure, inside one true moment from the chapters below; by about word 60 the stakes, as a consequence that tells the viewer how it ends ("it handed a generation to Sony"): give away the outcome, hold back the how, which is what the strongest long videos in our study did; somewhere in the intro one line that leans forward ("and that was only the start of it"); by about word 120 the title line ("This is the story of..." or "This is how..."), then a turn back to the beginning ("But to understand how it got there, we have to go back to..."). Never "In this video", never a greeting.
The outro closes in three moves: the verdict, answering the documentary's question in its first two sentences; where things stand today, with a date; and a last line that calls back to the opening moment or date. Use only facts from the chapter notes and the overview.`,
    content: `Documentary: ${outline.title}\nThe question it answers: ${outline.question ?? outline.title}\n\nChapters and their facts:\n${digest}\n\nOverview (Wikipedia):\n${franchiseNotes.slice(0, 5000)}`,
    schema: DocBookendsSchema,
    effort: "medium",
  });
}

export function validateBookends(b: DocBookends): string[] {
  const p: string[] = [];
  const i = wordCount(b.intro.narration);
  if (i < 90 || i > 230) p.push(`The intro is ${i} words; it must be 110-200.`);
  p.push(...advertiserProblems(`${b.intro.narration} ${b.outro.narration}`));
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
    /** One per sentence across the chapter's paragraphs, in order. */
    moments?: DocMoment[];
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
      narration: withSignOff(d.bookends.outro.narration),
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
    entries: d.chapters.map(({ plan, moments }, ci) => ({
      rank: n - ci,
      game_title: plan.game_title,
      steam_search_term: plan.steam_search_term,
      year: plan.year,
      platforms: plan.platforms,
      photos: plan.photo_searches ?? [],
      ...(moments?.length ? { moments } : {}),
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
    .describe(
      "Indices of the photos that clearly show something this chapter is about (its studio, people, places, launch or the real place the game recreates), best first, at most 5. Empty if none fit",
    ),
});

/** A quick editor pass over archive search results: only photos that belong in this chapter survive. */
export async function pickPhotos(
  llm: Llm,
  chapter: { franchise: string; game: string; title: string; opening: string },
  candidates: Array<{ title: string; description: string }>,
): Promise<number[]> {
  if (!candidates.length) return [];
  const r = await llm.structured({
    tier: "low",
    system:
      "You pick archive photos for a video game documentary chapter. Keep a photo only when it clearly shows something the chapter is about: the studio, its people, the city or real place the game is set in or based on, a launch event, the hardware of the era. Reject anything about an unrelated person, place or thing that merely shares a word.",
    content: `Documentary: ${chapter.franchise}\nChapter: ${chapter.title} (${chapter.game})\nOpening: ${chapter.opening.slice(0, 600)}\n\nPhotos:\n${candidates.map((c, i) => `${i}. ${c.title.replace(/^File:/, "")}: ${c.description.slice(0, 160)}`).join("\n")}`,
    schema: PhotoPickSchema,
    effort: "low",
  });
  return [...new Set(r.keep)]
    .filter((i) => i >= 0 && i < candidates.length)
    .slice(0, 5);
}
