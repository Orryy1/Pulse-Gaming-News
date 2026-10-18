// The long-form lane: a weekly 16:9 "top ten" video in the gameranx and IGN
// mould, five to seven minutes, built from the same ranking machinery as the
// evergreen Short but with a paragraph per entry, an intro, an outro and
// chapters. Topics come from the evergreen candidate pool.

import { z } from "zod";
import type { Llm } from "./llm.ts";
import { FootageSchema, type Script, type BeatVisual } from "./schema.ts";
import type { SteamFacts } from "../assets/steam.ts";
import { factsText } from "../assets/steam.ts";
import {
  EvergreenTopicSchema,
  type EvergreenTopic,
  type EvergreenCandidate,
  FORMAT_TITLES,
} from "./evergreen.ts";

export const LONG_WORDS_MIN = 650;
export const LONG_WORDS_MAX = 1150;
export const LONG_ENTRIES_MIN = 8;
export const LONG_ENTRIES_MAX = 12;
export const LONG_ENTRY_WORDS_MIN = 45;
export const LONG_ENTRY_WORDS_MAX = 100;

const HOUSE = `You write for Pulse Gaming News, a fast, credible YouTube channel about video games.
American English spelling for a US-first audience, AP style (no serial comma). Brisk, confident, lightly opinionated, warm. Advertiser-friendly. No "like and subscribe", no "let me know in the comments", no "without further ado". The channel speaks as "Pulse".
Never invent release years, scores, prices or player counts: use the Steam facts provided or long-established public knowledge. Opinions are framed as opinion.`;

export const LongformEntrySchema = z.object({
  rank: z
    .number()
    .int()
    .min(1)
    .describe("1 is the best; ranks are spoken from the bottom up"),
  game_title: z.string().describe("Exact official title"),
  steam_search_term: z
    .string()
    .describe("Steam store search term, or empty if the game is not on Steam"),
  year: z.number().describe("Original release year"),
  platforms: z.string().describe("Short platform list, e.g. 'PC, PS5, Xbox'"),
  narration: z
    .string()
    .describe(
      `${LONG_ENTRY_WORDS_MIN}-${LONG_ENTRY_WORDS_MAX} spoken words, three to five sentences: what the game is and when it landed, one specific detail a fan would nod at, why it sits at this rank by the criterion`,
    ),
  verdict_chip: z.string().describe("1-4 words of punch, shown on the card"),
  footage: FootageSchema,
});

export const LongformScriptSchema = z.object({
  theme: z.string(),
  title: z.string().describe("On-screen title, 3-8 words"),
  criterion: z
    .string()
    .describe("The one criterion the ranking uses, as a short on-screen line"),
  intro: z.object({
    narration: z
      .string()
      .describe(
        "35-80 spoken words: the premise, the criterion, and one reason the ranking will annoy somebody",
      ),
    on_screen: z.string().describe("3-8 word kicker under the title"),
  }),
  entries: z
    .array(LongformEntrySchema)
    .min(LONG_ENTRIES_MIN)
    .max(LONG_ENTRIES_MAX)
    .describe("Spoken from the lowest rank to number one"),
  outro: z.object({
    narration: z
      .string()
      .describe(
        "35-90 spoken words: why number one wins by the criterion, then one honest line about the ranking's hardest call",
      ),
    on_screen: z.string().describe("3-8 word summary of the pick"),
  }),
  youtube: z.object({
    title: z
      .string()
      .describe(
        "Under 60 characters, front-loads the franchise, e.g. 'Every Resident Evil Game Ranked Worst to Best'",
      ),
    description: z
      .string()
      .describe(
        "3-5 sentences. No hashtags, no timestamps (chapters are added automatically)",
      ),
    tags: z.array(z.string()),
  }),
  claims: z.array(
    z.object({
      claim: z.string(),
      source: z.string().describe("'steam facts' or 'public knowledge'"),
    }),
  ),
});
export type LongformScript = z.infer<typeof LongformScriptSchema>;

export function longformPrompt(): string {
  return `${HOUSE}

Write a long-form ranking video of ${LONG_WORDS_MIN}-${LONG_WORDS_MAX} spoken words in total, five to seven minutes when read at a natural pace.
Structure:
1. intro.narration: 35-80 words. State the premise and the single criterion straight away, then one line on why the order will annoy somebody. No throat-clearing.
2. entries: ${LONG_ENTRIES_MIN}-${LONG_ENTRIES_MAX}, spoken from the lowest rank to number one. Each narration is ${LONG_ENTRY_WORDS_MIN}-${LONG_ENTRY_WORDS_MAX} words, three to five sentences: what the game is and when it landed, one specific detail a fan would nod at (a mechanic, a level, a moment, a reception fact), and why it sits here by the criterion. Vary the sentence openings; never start two entries the same way. verdict_chip is 1-4 words. footage names the trailer moment to show, with 1-4 keywords.
3. outro.narration: 35-90 words. Why number one wins by the criterion, then the ranking's hardest call, honestly.
Keep every number to the Steam facts provided or long-established knowledge. List every factual claim in "claims".`;
}

export function longformTopicPrompt(): string {
  return `${HOUSE}

You are planning a weekly long-form ranking video, five to seven minutes: "Every Resident Evil game ranked worst to best", "Top 10 open-world games of the 2010s". Pick the candidate that gives the strongest ten-entry ranking for cold viewers: a franchise or theme with eight to twelve well-known entries, strong feelings, recognisable box art and a clear criterion. Always choose the "ranking" format.
Avoid topics the channel covered in the last six months (listed). Return candidate_index -1 if nothing is strong enough.`;
}

export async function selectLongformTopic(
  llm: Llm,
  candidates: EvergreenCandidate[],
  covered: string[],
): Promise<EvergreenTopic> {
  const topic = await llm.structured({
    system: longformTopicPrompt(),
    content: `Candidates:\n${candidates.map((c, i) => `${i}. ${c.name} (${c.source}${c.note ? `: ${c.note}` : ""})`).join("\n")}\n\nCovered in the last six months:\n${covered.map((c) => `- ${c}`).join("\n") || "- none"}\n\nFormat: ranking ("${FORMAT_TITLES.ranking}")`,
    schema: EvergreenTopicSchema,
    effort: "low",
  });
  return { ...topic, format: "ranking" };
}

export async function writeLongform(
  llm: Llm,
  topic: EvergreenTopic,
  facts: Array<{ title: string; facts: SteamFacts }>,
  feedback: string[] = [],
): Promise<LongformScript> {
  const factBlock = facts.length
    ? `\n\nSteam facts for entries (use these numbers, never others):\n${facts.map((f) => `- ${f.title}: ${factsText(f.facts)}`).join("\n")}`
    : "";
  const fb = feedback.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    system: longformPrompt(),
    content: `Theme: ${topic.theme}\nWorking title: ${topic.title_idea}\nCriterion: ${topic.criterion}${factBlock}${fb}`,
    schema: LongformScriptSchema,
    effort: "medium",
  });
}

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export function narrationOfLongform(e: LongformScript): string {
  const entries = [...e.entries].sort((a, b) => b.rank - a.rank);
  return [
    e.intro.narration,
    ...entries.map((x) => x.narration),
    e.outro.narration,
  ].join(" ");
}

export function validateLongform(e: LongformScript): string[] {
  const p: string[] = [];
  const words = wordCount(narrationOfLongform(e));
  if (words < LONG_WORDS_MIN || words > LONG_WORDS_MAX)
    p.push(
      `Spoken word count is ${words}; it must be ${LONG_WORDS_MIN}-${LONG_WORDS_MAX}.`,
    );
  if (
    e.entries.length < LONG_ENTRIES_MIN ||
    e.entries.length > LONG_ENTRIES_MAX
  )
    p.push(`There must be ${LONG_ENTRIES_MIN}-${LONG_ENTRIES_MAX} entries.`);
  const ranks = e.entries.map((x) => x.rank).sort((a, b) => a - b);
  if (ranks.some((r, i) => r !== i + 1))
    p.push("Ranks must be 1..N with no gaps or repeats.");
  for (const x of e.entries) {
    const n = wordCount(x.narration);
    if (n < LONG_ENTRY_WORDS_MIN || n > LONG_ENTRY_WORDS_MAX)
      p.push(
        `Entry "${x.game_title}" has ${n} words; it must be ${LONG_ENTRY_WORDS_MIN}-${LONG_ENTRY_WORDS_MAX}.`,
      );
    if (wordCount(x.verdict_chip) > 4 || !x.verdict_chip.trim())
      p.push(`Entry "${x.game_title}" verdict chip must be 1-4 words.`);
    if (x.year < 1970 || x.year > 2030)
      p.push(`Entry "${x.game_title}" has an implausible year.`);
  }
  const intro = wordCount(e.intro.narration);
  if (intro < 35 || intro > 80)
    p.push(`The intro is ${intro} words; it must be 35-80.`);
  const outro = wordCount(e.outro.narration);
  if (outro < 35 || outro > 90)
    p.push(`The outro is ${outro} words; it must be 35-90.`);
  // Two entries opening with the same three words read as a template.
  const openings = e.entries.map((x) =>
    x.narration.toLowerCase().split(/\s+/).slice(0, 3).join(" "),
  );
  if (new Set(openings).size < openings.length)
    p.push("Two entries open with the same words; vary the openings.");
  if (
    /let me know in the comments|like and subscribe|without further ado/i.test(
      narrationOfLongform(e),
    )
  )
    p.push("Banned phrase.");
  return p;
}

/** The common Script shape: intro as the hook, one rank beat per entry (lowest first), the outro as the take, no loop line. */
export function longformToScript(e: LongformScript): Script {
  const entries = [...e.entries].sort((a, b) => b.rank - a.rank);
  const beats = entries.map((x) => ({
    narration: x.narration,
    footage: x.footage,
    visual: {
      kind: "rank",
      primary: x.game_title,
      secondary: x.verdict_chip,
      value_a: x.rank,
      items: [String(x.year), x.platforms],
    } satisfies BeatVisual,
  }));
  return {
    story_type: "other",
    game_title: e.theme,
    steam_search_term: "",
    headline: e.title,
    hook: e.intro.narration,
    hook_footage: { want: "gameplay", keywords: [e.theme] },
    beats,
    pulse_take: {
      label: "OUR PICK",
      narration: e.outro.narration,
      on_screen: e.outro.on_screen,
    },
    loop_line: "",
    is_rumour: false,
    attribution: "Source: Steam / Pulse",
    youtube: e.youtube,
    claims: e.claims.map((c) => ({ claim: c.claim, source_url: c.source })),
    entries: entries.map((x) => ({
      rank: x.rank,
      game_title: x.game_title,
      steam_search_term: x.steam_search_term,
      year: x.year,
      platforms: x.platforms,
    })),
    evergreen_format: "ranking",
    runtime: "long",
    criterion: e.criterion,
    kicker: e.intro.on_screen,
  };
}
