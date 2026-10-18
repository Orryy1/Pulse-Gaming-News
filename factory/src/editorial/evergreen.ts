// The evergreen lane: ranking Shorts in the Epix-Gaming style (75-160 s,
// six to ten entries, a stated criterion, box art and a trailer moment per
// entry), chosen from what people are playing and buying rather than from
// the news. Written against live Steam facts per entry and fact-checked
// against them, then adapted into the common Script shape so voice, render,
// SEO and upload stay unchanged.

import { z } from "zod";
import type { Llm } from "./llm.ts";
import { FootageSchema, type Script, type BeatVisual } from "./schema.ts";
import type { SteamFacts } from "../assets/steam.ts";
import { factsText } from "../assets/steam.ts";

export const EVERGREEN_WORDS_MIN = 165;
export const EVERGREEN_WORDS_MAX = 300;
export const EVERGREEN_ENTRIES_MIN = 6;
export const EVERGREEN_ENTRIES_MAX = 10;

export const EVERGREEN_FORMATS = [
  "ranking",
  "best_per_year",
  "versus",
  "years_later",
  "still_good",
  "release_radar",
  "weekly_recap",
  "rarest_achievements",
  "hardest_achievements",
  "steam_climbers",
] as const;

/** Weekly formats built from data the factory hands the writer; they run shorter lists. */
export const WEEKLY_FORMATS = new Set<string>(["release_radar", "weekly_recap", "rarest_achievements", "hardest_achievements", "steam_climbers"]);
export const ACHIEVEMENT_FORMATS = new Set<string>(["rarest_achievements", "hardest_achievements"]);
export const entriesMin = (format: string) => (WEEKLY_FORMATS.has(format) ? 4 : EVERGREEN_ENTRIES_MIN);

/** What the writer is told for each data-driven format. */
export const FORMAT_RULES: Record<string, string> = {
  rarest_achievements:
    "Rarest Achievements rules: the entries are exactly the achievements in the data, game_title written exactly as the achievement's name in the data, ranked by rarity: rank 1 is the rarest (lowest percentage), spoken from the most common of them up to the rarest. steam_search_term is the game's name, platforms is the game's name, year is the game's release year. one_line says what the achievement asks and why so few players have it, under 18 words, and may quote its percentage exactly as in the data; never invent a percentage. verdict_chip is 1-4 words such as \"PURE PAIN\" or \"SKILL CHECK\". Do not spoil story twists from hidden achievements beyond what the description says. Hook names the game and the stakes, e.g. \"Fewer than one in fifty players have these Elden Ring achievements.\" The take says which one is the real test and why.",
  hardest_achievements:
    "Hardest Achievements rules: the entries are exactly the achievements in the data, one per game, game_title written exactly as the achievement's name in the data, ranked by rarity: rank 1 is the rarest, spoken from the least rare up to the rarest. steam_search_term is that achievement's game, platforms is that game's name, year is that game's release year. one_line says what it asks and why so few players have it, under 18 words; quote percentages exactly as in the data, never invent one. verdict_chip is 1-4 words. Hook: \"These are the hardest achievements in today's biggest games, and almost nobody has them.\" style. The take names the one that is truly the hardest and why.",
  release_radar:
    "Release Radar rules: the entries are the games in the data and nothing else, spoken in release order, earliest first, so the earliest release has the highest rank number and the last release is rank 1. Set each entry's date to its release date exactly as in the data (YYYY-MM-DD) and steam_search_term to its name. platforms is \"PC (Steam)\" unless the data says more. one_line says what the game is and one reason to care, under 18 words; never invent a price or a platform. verdict_chip is a 1-4 word hook such as \"SOULSLIKE WITH GUNS\". The take names the one to watch. Hook: the week and how many games, e.g. \"Five big games land this week, and one could eat your weekend.\"",
  steam_climbers:
    "Steam Climbers rules: the entries are exactly the games in the data, ranked by places climbed: rank 1 climbed the most, spoken from the smallest climb up to the biggest. game_title and steam_search_term are the game's name exactly as in the data; year is its release year from the data; platforms is \"PC (Steam)\". one_line says what the game is and why it climbed, under 18 words, using only the Steam news given for it (an update, an event, a sale, a launch); if its news gives no reason, say what it is and that players are flooding back, and never invent a reason. Peak player numbers may be quoted exactly as in the data. verdict_chip is 1-4 words such as \"HUGE UPDATE\" or \"FREE WEEKEND\". Hook: \"These games just exploded on Steam.\" style, naming the week. The take names the climb that matters most and why.",
  weekly_recap:
    "Weekly Recap rules: the entries are the five biggest stories in the data, spoken from fifth to the biggest. game_title is the game or company the story is about; steam_search_term finds that game on Steam or is empty; year is that game's release year, or this year for a company story; platforms lists the outlets that reported it, e.g. \"IGN, Xbox Wire\". one_line says what happened and why it matters, under 18 words. verdict_chip is 1-4 words such as \"DELAYED AGAIN\". Only stories in the data, never a rumour as fact. Hook: \"Five stories ran gaming this week. Here is what actually mattered.\" style.",
};
export type EvergreenFormat = (typeof EVERGREEN_FORMATS)[number];

export const FORMAT_TITLES: Record<EvergreenFormat, string> = {
  ranking: "Ranking EVERY [franchise] game",
  best_per_year: "The BEST [genre or franchise] game for every year",
  versus: "[A] vs [B]: which holds up in 2026",
  years_later: "[Game]: N years later",
  still_good: "Is [Game] still good in 2026",
  release_radar: "N Big Games Out This Week",
  weekly_recap: "The 5 Biggest Gaming Stories This Week",
  rarest_achievements: "The Rarest Achievements in [Game]",
  hardest_achievements: "The Hardest Achievements in Gaming Right Now",
  steam_climbers: "The Games That Exploded on Steam This Week",
};

export interface EvergreenCandidate {
  name: string; // a franchise, a game or a theme
  source: string; // "steam top sellers", "franchise seed", "channel"
  note?: string;
}

export const EvergreenTopicSchema = z.object({
  candidate_index: z
    .number()
    .describe(
      "Index of the chosen candidate, or -1 if none makes a strong ranking Short",
    ),
  format: z.enum(EVERGREEN_FORMATS),
  theme: z
    .string()
    .describe(
      "The franchise, genre or pairing the Short ranks, e.g. 'Resident Evil' or 'open-world RPGs of the 2010s'",
    ),
  title_idea: z
    .string()
    .describe("Working title in the format's template, under 60 characters"),
  criterion: z
    .string()
    .describe("The single stated criterion the ranking uses, one sentence"),
  reason: z.string(),
});
export type EvergreenTopic = z.infer<typeof EvergreenTopicSchema>;

export const EvergreenEntrySchema = z.object({
  rank: z
    .number()
    .describe("1 is the best; ranks are spoken from the bottom up"),
  game_title: z.string().describe("Exact official title"),
  steam_search_term: z
    .string()
    .describe("Term to find it on Steam, or empty if it is not on Steam"),
  year: z.number().describe("Original release year"),
  platforms: z.string().describe("Short platform list, e.g. 'PC, PS5, Xbox'"),
  one_line: z
    .string()
    .describe(
      "The spoken line for this entry, under 18 words, factual with one opinion",
    ),
  verdict_chip: z
    .string()
    .describe("On-screen verdict, 1-4 words, e.g. 'PEAK CHAOS' or 'SKIP IT'"),
  footage: FootageSchema,
  percent: z.number().optional().describe("achievement formats only: the unlock percentage exactly as in the data"),
  icon: z.string().optional().describe("leave empty; filled in by the factory"),
  date: z.string().optional().describe("release_radar only: the release date as YYYY-MM-DD, exactly as in the data"),
  peak: z.number().optional().describe("steam_climbers only: peak players this week, exactly as in the data"),
});

export const EvergreenScriptSchema = z.object({
  format: z.enum(EVERGREEN_FORMATS),
  theme: z.string(),
  title: z.string().describe("On-screen title, 3-8 words"),
  hook: z
    .string()
    .describe("First spoken line: the premise and the criterion, 8-16 words"),
  entries: z
    .array(EvergreenEntrySchema)
    .min(4)
    .max(EVERGREEN_ENTRIES_MAX)
    .describe("Spoken from the lowest rank to number one"),
  pulse_take: z.object({
    label: z.string().describe("Card label, e.g. THE CRITERION or OUR PICK"),
    narration: z
      .string()
      .describe("Why number one wins by the stated criterion, 1-2 sentences, at most 32 words"),
    on_screen: z.string().describe("3-8 word on-screen summary"),
  }),
  loop_line: z.string().describe("Final line that ties back to the hook"),
  youtube: z.object({
    title: z
      .string()
      .describe("Title in the format's template, under 60 characters"),
    description: z.string().describe("2-4 sentences. No hashtags"),
    tags: z.array(z.string()),
  }),
  claims: z.array(
    z.object({
      claim: z.string(),
      source: z.string().describe("'steam facts' or 'public knowledge'"),
    }),
  ),
});
export type EvergreenScript = z.infer<typeof EvergreenScriptSchema>;

const HOUSE = `You write for Pulse Gaming News, a fast, credible YouTube Shorts channel about video games.
American English spelling for a US-first audience, AP style (no serial comma). Brisk, confident, lightly opinionated. Advertiser-friendly. No "like and subscribe", no "let me know in the comments". The channel speaks as "Pulse".
Never invent release years, scores, prices or player counts: use the Steam facts provided or long-established public knowledge. Opinions are framed as opinion.`;

export function topicPrompt(): string {
  return `${HOUSE}

You are planning an evergreen ranking Short, the kind that keeps earning views for months: "Ranking EVERY Resident Evil game", "The BEST open-world game for every year of the 2010s", "Skyrim: 15 years later", "Is The Witcher 3 still good in 2026".
Pick the candidate that gives the strongest 75-160 second ranking for cold viewers: a franchise or theme with six to ten well-known entries, strong feelings, box art people recognise and a clear criterion to rank by.
Avoid topics the channel covered in the last six months (listed). Return candidate_index -1 if nothing is strong enough.`;
}

export function evergreenScriptPrompt(): string {
  return `${HOUSE}

Write an evergreen ranking Short of ${EVERGREEN_WORDS_MIN}-${EVERGREEN_WORDS_MAX} spoken words in total (hook, entries, take, loop line), 75-160 seconds when read.
Structure:
1. hook: the premise and the criterion in one breath, 8-16 words, no question that withholds the point.
2. entries: ${EVERGREEN_ENTRIES_MIN}-${EVERGREEN_ENTRIES_MAX}, spoken from the lowest rank to number one. Each one_line is under 18 words: one fact (year, what it did, how it was received) and one opinion by the criterion. verdict_chip is 1-4 words of punch. footage says what the trailer moment should show for that entry, with 1-4 keywords.
3. pulse_take: why number one wins by the stated criterion, at most 32 words.
4. loop_line: flows back into the hook.
The on-screen title is 3-8 words. The YouTube title follows the format template and front-loads the franchise. List every factual claim in "claims".`;
}

export async function selectEvergreenTopic(
  llm: Llm,
  candidates: EvergreenCandidate[],
  covered: string[],
): Promise<EvergreenTopic> {
  return llm.structured({
    system: topicPrompt(),
    content: `Candidates:\n${candidates.map((c, i) => `${i}. ${c.name} (${c.source}${c.note ? `: ${c.note}` : ""})`).join("\n")}\n\nCovered in the last six months:\n${covered.map((c) => `- ${c}`).join("\n") || "- none"}\n\nFormats: ${EVERGREEN_FORMATS.filter((f) => !WEEKLY_FORMATS.has(f)).map((f) => `${f} ("${FORMAT_TITLES[f]}")`).join("; ")}`,
    schema: EvergreenTopicSchema,
    effort: "low",
  });
}

export async function writeEvergreen(
  llm: Llm,
  topic: EvergreenTopic,
  facts: Array<{ title: string; facts: SteamFacts }>,
  feedback: string[] = [],
  brief = "",
): Promise<EvergreenScript> {
  const dataBlock = brief ? `\n\nThis week's data (use these and nothing else):\n${brief}\n\n${FORMAT_RULES[topic.format] ?? ""}` : "";
  const factBlock = facts.length
    ? `\n\nSteam facts for entries (use these numbers, never others):\n${facts.map((f) => `- ${f.title}: ${factsText(f.facts)}`).join("\n")}`
    : "";
  const fb = feedback.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    system: evergreenScriptPrompt(),
    content: `Format: ${topic.format} ("${FORMAT_TITLES[topic.format]}")\nTheme: ${topic.theme}\nWorking title: ${topic.title_idea}\nCriterion: ${topic.criterion}${dataBlock}${factBlock}${fb}`,
    schema: EvergreenScriptSchema,
    effort: "medium",
  });
}

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export function narrationOfEvergreen(e: EvergreenScript): string {
  const entries = [...e.entries].sort((a, b) => b.rank - a.rank);
  return [
    e.hook,
    ...entries.map((x) => x.one_line),
    e.pulse_take.narration,
    e.loop_line,
  ].join(" ");
}

/** House rules for the lane: word band, entry count, ranks, line lengths. */
export function validateEvergreen(e: EvergreenScript): string[] {
  const p: string[] = [];
  const words = wordCount(narrationOfEvergreen(e));
  const wordsMin = WEEKLY_FORMATS.has(e.format) ? 110 : EVERGREEN_WORDS_MIN;
  if (words < wordsMin || words > EVERGREEN_WORDS_MAX)
    p.push(
      `Spoken word count is ${words}; it must be ${wordsMin}-${EVERGREEN_WORDS_MAX}.`,
    );
  if (
    e.entries.length < entriesMin(e.format) ||
    e.entries.length > EVERGREEN_ENTRIES_MAX
  )
    p.push(
      `There must be ${entriesMin(e.format)}-${EVERGREEN_ENTRIES_MAX} entries.`,
    );
  if (e.format === "release_radar")
    for (const x of e.entries)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date ?? "")) p.push(`Entry "${x.game_title}" needs its release date as YYYY-MM-DD.`);
  const ranks = e.entries.map((x) => x.rank).sort((a, b) => a - b);
  if (ranks.some((r, i) => r !== i + 1))
    p.push("Ranks must be 1..N with no gaps or repeats.");
  for (const x of e.entries) {
    if (wordCount(x.one_line) > 18)
      p.push(`Entry "${x.game_title}" line is over 18 words.`);
    if (wordCount(x.verdict_chip) > 4 || !x.verdict_chip.trim())
      p.push(`Entry "${x.game_title}" verdict chip must be 1-4 words.`);
    if (x.year < 1970 || x.year > 2030)
      p.push(`Entry "${x.game_title}" has an implausible year.`);
  }
  if (wordCount(e.hook) > 18) p.push("The hook is longer than 18 words.");
  // A long take holds one card on screen for 15+ seconds, the slowest part of the Short.
  if (wordCount(e.pulse_take.narration) > 32)
    p.push("The take is longer than 32 words; keep it to one or two short sentences.");
  if (
    /let me know in the comments|like and subscribe/i.test(
      narrationOfEvergreen(e),
    )
  )
    p.push("Banned call to action.");
  return p;
}

/**
 * Adapts an evergreen script into the common Script shape: one "rank" beat
 * per entry (lowest rank first), the take and loop as usual. Entries ride
 * along so media can be gathered per entry.
 */
export function evergreenToScript(e: EvergreenScript): Script {
  const entries = [...e.entries].sort((a, b) => b.rank - a.rank);
  const beats = entries.map((x) => ({
    narration: x.one_line,
    footage: x.footage,
    visual: {
      kind: "rank",
      primary: x.game_title,
      secondary: x.verdict_chip,
      value_a: x.rank,
      items:
        ACHIEVEMENT_FORMATS.has(e.format) && typeof x.percent === "number"
          ? [`${x.percent}% of players`, x.platforms]
          : e.format === "steam_climbers" && typeof x.peak === "number"
            ? [x.platforms, `${x.peak.toLocaleString("en-US")} peak players`]
            : [String(x.year), x.platforms],
      ...(x.date ? { date_to: x.date } : {}),
    } satisfies BeatVisual,
  }));
  return {
    story_type: "other",
    game_title: e.theme,
    steam_search_term: "",
    headline: e.title,
    hook: e.hook,
    hook_footage: { want: "gameplay", keywords: [e.theme] },
    beats,
    pulse_take: e.pulse_take,
    loop_line: e.loop_line,
    is_rumour: false,
    attribution: "Source: Steam / Pulse",
    youtube: e.youtube,
    evergreen_format: e.format,
    claims: e.claims.map((c) => ({ claim: c.claim, source_url: c.source })),
    entries: entries.map((x) => ({
      rank: x.rank,
      game_title: x.game_title,
      steam_search_term: x.steam_search_term,
      year: x.year,
      platforms: x.platforms,
      ...(x.icon ? { icon: x.icon } : {}),
    })),
  };
}
