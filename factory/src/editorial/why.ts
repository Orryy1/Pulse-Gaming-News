// The "Why" Short: one question about a well-known game, answered in the Pulse voice in 25-40
// seconds (thesis, evidence, the fair counterpoint, a verdict, and a last line that hands back to
// the question so the Short loops). The format that travels for small gaming channels: "Why Rockstar
// IGNORES GTA 4" took 177k views on a 3.3k-subscriber channel. Old games and fan grievances beat
// today's headline. The answer is grounded in the game's Wikipedia article (development, reception,
// legacy, re-releases), fetched by the factory, and fact-checked like any news Short.
//
// Story-first (owner, 1 Nov 2026): our own "Why Rockstar Never Made a San Andreas Sequel" was watched 83%
// and brought the most subscribers of any Short, against 39-46% and 0-1 for big-game news. What it had, and
// what the niche study (26 Oct, 2,918 transcripts) found in the hits: a game people love, one story engine
// (a person, a failure, a rivalry, a comeback, a road not taken) and a turning point the viewer half
// remembers. So the editor sees a list of well-loved games with arcs (WHY_SEEDS) beside the store's top
// sellers, names the arc it sees, and two freshness rules hold for WHY_FRESH_DAYS (14): no game or topic
// twice, and no hook opening the same way (src/pipeline.ts maybeSelectWhy, stepScript). The last line points
// the viewer at a reason to follow (the full documentary or ranking on the same game, else the daily series)
// without breaking the loop.
import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { EvergreenCandidate } from "./evergreen.ts";
import { voiceFor } from "./voice.ts";

/**
 * Well-loved games whose history has a turning point a Why Short can answer from Wikipedia: a sequel that
 * never came, a studio's change of course, a comeback, a remake after a long silence. Rotated by the day.
 */
export const WHY_SEEDS: string[] = [
  "Grand Theft Auto: San Andreas",
  "Grand Theft Auto IV",
  "Red Dead Redemption",
  "Bully",
  "Max Payne 3",
  "Half-Life 2",
  "Portal 2",
  "Left 4 Dead 2",
  "Fallout: New Vegas",
  "The Elder Scrolls V: Skyrim",
  "BioShock",
  "Mass Effect 2",
  "Halo 3",
  "Call of Duty 4: Modern Warfare",
  "Star Wars: Battlefront II",
  "Titanfall 2",
  "Super Mario 64",
  "The Legend of Zelda: Ocarina of Time",
  "The Legend of Zelda: Majora's Mask",
  "F-Zero GX",
  "Metroid Prime",
  "GoldenEye 007",
  "Banjo-Kazooie",
  "Pokemon Red and Blue",
  "Final Fantasy VII",
  "Metal Gear Solid",
  "Silent Hill 2",
  "Resident Evil 4",
  "Diablo II",
  "StarCraft",
  "World of Warcraft",
  "Shenmue",
  "Crash Bandicoot",
  "Spyro the Dragon",
  "Jak and Daxter: The Precursor Legacy",
  "Sly Cooper and the Thievius Raccoonus",
  "Burnout 3: Takedown",
  "Need for Speed: Most Wanted",
  "SSX Tricky",
  "Splinter Cell: Chaos Theory",
  "Prince of Persia: The Sands of Time",
  "Cyberpunk 2077",
  "No Man's Sky",
  "Minecraft",
];

/** The Why editor's list: today's well-loved seeds first, then the evergreen candidates (top sellers, franchises). */
export function whyCandidates(
  base: EvergreenCandidate[],
  dayKey: string,
  take = 12,
): EvergreenCandidate[] {
  const rotate = Number(dayKey.replace(/-/g, "")) % WHY_SEEDS.length;
  const seeds = [...WHY_SEEDS.slice(rotate), ...WHY_SEEDS.slice(0, rotate)]
    .slice(0, take)
    .map((name) => ({
      name,
      source: "well-loved game",
      note: "a turning point fans remember",
    }));
  const have = new Set(seeds.map((s) => s.name.toLowerCase()));
  return [...seeds, ...base.filter((b) => !have.has(b.name.toLowerCase()))];
}

export const WhyTopicSchema = z.object({
  candidate_index: z
    .number()
    .describe(
      "Index of the candidate the question is about, or -1 if none gives a strong question",
    ),
  question: z
    .string()
    .describe(
      "The question the Short answers, as a viewer would ask it, e.g. 'Why has Rockstar never remastered GTA 4?'",
    ),
  title: z
    .string()
    .describe(
      "The YouTube title: the question or a claim with a named company or game and a verb, under 60 characters, e.g. 'Why Rockstar Keeps Ignoring GTA 4'",
    ),
  game: z
    .string()
    .describe("The game the question is about, its exact official title"),
  wikipedia_title: z
    .string()
    .describe(
      "The exact English Wikipedia article title for that game, e.g. 'Grand Theft Auto IV'",
    ),
  arc: z
    .string()
    .describe(
      "The story in three short beats: what fans loved, the turn, where it stands now",
    ),
  angle: z
    .string()
    .describe(
      "One sentence: the likely answer the article supports, which the writer will test against the sources",
    ),
  reason: z.string(),
});
export type WhyTopic = z.infer<typeof WhyTopicSchema>;

export function whyTopicPrompt(): string {
  return `You are the editor of Pulse Gaming News choosing today's "Why" Short.

${voiceFor("news")}

A "Why" Short answers one question about a well-known game in 25-40 seconds. The questions that travel are the ones fans already argue about, with a named company or game and a grievance, a mystery or a surprise: "Why has Rockstar never remastered GTA 4?", "Why did Nintendo stop making F-Zero?", "Why does Call of Duty 4 still feel modern?", "Why did Konami walk away from Silent Hill for a decade?". Old games and nostalgia beat today's headline: our best Short of all, watched 83% of the way, asked why Rockstar never made a San Andreas sequel.
Pick for the story, not the news:
- A game people love and remember fondly, famous enough that a cold viewer knows it. The candidates marked "well-loved game" are a starting list; a top seller only when its own history has a turn worth telling (a broken launch and a comeback, say).
- One story engine with a turning point: a sequel that never came, a studio that changed course, a person who left, a rivalry, a comeback, a remake after years of silence. Name it in "arc" as three beats (what fans loved, the turn, where it stands now). A question with no turn ("Why is Minecraft popular?") is weak.
- Its English Wikipedia article (development, reception, legacy, re-releases, sequels) can honestly answer the question. Never pick a question only rumor or speculation could answer.
- Advertiser-friendly: no tragedies, lawsuits about people, violence or politics as the subject.
- Never repeat a question already covered, and never a game listed under "Games used recently" (the channel keeps every game off limits for two weeks after its Why Short).
Return candidate_index -1 if nothing makes a strong question today.`;
}

export interface WhyRecent {
  /** Questions covered in the last 120 days. */
  covered: string[];
  /** Games of the Why Shorts in the last WHY_FRESH_DAYS. */
  games: string[];
  /** Topic slugs (story hashes without "why:") in the last WHY_FRESH_DAYS. */
  slugs: string[];
}

export async function selectWhyTopic(
  llm: Llm,
  candidates: EvergreenCandidate[],
  covered: string[],
  demand = "",
  recentGames: string[] = [],
  feedback: string[] = [],
): Promise<WhyTopic> {
  const games = recentGames.length
    ? `\n\nGames used recently (never pick these):\n${recentGames.map((g) => `- ${g}`).join("\n")}`
    : "";
  const fix = feedback.length
    ? `\n\nYour last pick was refused:\n${feedback.map((f) => `- ${f}`).join("\n")}\nPick again.`
    : "";
  return llm.structured({
    system: whyTopicPrompt(),
    content: `Candidates:\n${candidates.map((c, i) => `${i}. ${c.name} (${c.source}${c.note ? `: ${c.note}` : ""})`).join("\n")}\n\nQuestions covered recently:\n${covered.map((c) => `- ${c}`).join("\n") || "- none"}${games}${demand ? `\n\n${demand}` : ""}${fix}`,
    schema: WhyTopicSchema,
    effort: "low",
  });
}

/** The URL slug of a Why question: its story hash is "why:<slug>". */
export function whySlug(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** A game's franchise words: lowercased, the subtitle after a colon, numbers and roman numerals dropped. */
export function franchiseWords(game: string): string {
  return game
    .toLowerCase()
    .replace(/(:| - | – |\().*$/, "")
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(\d+|[ivx]+|the)$/.test(w))
    .join(" ");
}

/** The same game (not just the same franchise): exact match once punctuation and case are set aside. */
export function sameGame(a: string, b: string): boolean {
  const n = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return !!n(a) && n(a) === n(b);
}

/** One franchise: "Grand Theft Auto: San Andreas" and "Grand Theft Auto VI" both read "grand theft auto". */
export function sameFranchise(a: string, b: string): boolean {
  const x = franchiseWords(a);
  const y = franchiseWords(b);
  if (!x || !y) return false;
  const has = (long: string, short: string) =>
    ` ${long} `.includes(` ${short} `);
  return has(x, y) || has(y, x);
}

/** Why a pick breaks the freshness rules (same game or topic within WHY_FRESH_DAYS); empty when it is fresh. */
export function whyFreshProblems(
  topic: Pick<WhyTopic, "game" | "question">,
  recent: Pick<WhyRecent, "games" | "slugs">,
  days: number,
): string[] {
  const out: string[] = [];
  if (recent.games.some((g) => sameGame(g, topic.game)))
    out.push(
      `${topic.game} already had a Why Short in the last ${days} days; pick another game.`,
    );
  if (recent.slugs.includes(whySlug(topic.question)))
    out.push(
      `"${topic.question}" was answered in the last ${days} days; pick another question.`,
    );
  return out;
}

/** The first three words of a hook, lowercased and without punctuation: its opening. */
export function hookOpening(hook: string): string {
  return hook
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, "");
}

/**
 * The shape a hook opens with, coarse enough that three in a row read as a template: a question, a quote, a
 * figure first, a contrast (a fact, then a short turn: "Rockstar never made a sequel."), or a plain claim.
 */
export function hookShape(hook: string): string {
  const h = hook.trim();
  const first = h.split(/(?<=[.?!])\s+/)[0] ?? h;
  if (/^["“']/.test(h)) return "quote";
  if (/\?$/.test(first)) return "question";
  if (/^(\$?\d|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(h))
    return "figure";
  const sentences = h.split(/(?<=[.?!])\s+/).filter(Boolean);
  if (
    sentences.length >= 2 &&
    (sentences[sentences.length - 1]!.split(/\s+/).length <= 6 ||
      /\b(never|not once|still|then|yet|but)\b/i.test(
        sentences.slice(1).join(" "),
      ))
  )
    return "contrast";
  if (/,\s*(then|but|yet)\b/i.test(h)) return "contrast";
  return "claim";
}

/**
 * Why a Why Short's hook repeats an opening: the same first three words as any Why Short in WHY_FRESH_DAYS,
 * or the same shape as each of the last two (newest first), which would make three in a row.
 */
export function whyHookProblems(hook: string, recentHooks: string[]): string[] {
  const out: string[] = [];
  const open = hookOpening(hook);
  if (open && recentHooks.some((h) => hookOpening(h) === open))
    out.push(
      `The hook opens "${hook.trim().split(/\s+/).slice(0, 3).join(" ")}" like a recent Why Short; open it another way.`,
    );
  const shape = hookShape(hook);
  const last = recentHooks.slice(0, 2).map(hookShape);
  if (last.length === 2 && last.every((s) => s === shape))
    out.push(
      `The last two Why Shorts also opened with a ${shape} hook; use another shape (a question, a contrast, a figure, a quote or a claim).`,
    );
  return out;
}

/** What the viewer is pointed to at the end: our long video on the same game, or the daily series. */
export interface WhyFollow {
  kind: "documentary" | "ranking" | "series";
  /** The long video's title, when there is one. */
  title?: string;
  videoId?: string;
  /** The franchise as the viewer says it, for the line ("our GTA documentary"). */
  franchise?: string;
}

/** The writer's instruction for the last line's reason to follow. */
export function followRule(follow: WhyFollow | undefined): string {
  const f = follow ?? { kind: "series" as const };
  const what =
    f.kind === "documentary"
      ? `our full documentary on ${f.franchise ?? "this game"} ("${f.title}"), with the word "documentary"`
      : f.kind === "ranking"
        ? `our full ${f.franchise ?? "series"} ranking ("${f.title}"), with the word "ranking"`
        : `the series: a new Why question lands every day (say "every day", "tomorrow" or "the next Why")`;
  return `- the loop_line also gives the viewer a specific reason to follow: it points to ${what}, in a few words, and still hands back to the question so the end runs into the start ("The rest is in our GTA documentary, so why did Rockstar never go back?" style). Never "like and subscribe", "hit subscribe" or "follow for more": the reason is the next story, not the button. Keep it one sentence of at most 22 words.`;
}

/** Spoken cues that the loop line names the follow reason. */
const FOLLOW_CUE: Record<WhyFollow["kind"], RegExp> = {
  documentary: /\bdocumentar(y|ies)\b/i,
  ranking: /\b(ranking|ranked)\b/i,
  series:
    /\b(every day|each day|daily|tomorrow|next why|the why|this series|the series)\b/i,
};
/** A generic call to action: the reason must be the next story, never the button. */
const GENERIC_CTA =
  /\b(subscribe|smash (that|the)|hit (the )?(like|bell)|like (and|&) (sub|follow)|follow for more|don'?t forget to)\b/i;

/** Why a Why Short's loop line misses its reason to follow, or turns it into a generic plea; empty when it is fine. */
/**
 * A Why Short has to answer its question. 2 Nov 2026: the Silent Hill Short asked why Konami went to casinos, then
 * said "Konami's reasons aren't in the record, and we won't guess". Honest, but a question with no payoff; a pick
 * like that should be rewritten around what the sources do explain, or dropped for a game whose story they tell.
 */
export function whyAnswerProblems(narration: string): string[] {
  return /\b(?:reasons?|motives?)\b[^.?!]{0,40}\b(?:aren't|are not|isn't|is not|unknown|never)\b|won't guess|will not guess|no one knows|nobody knows|never explained|hasn't said why|has not said why/i.test(
    narration,
  )
    ? [
        "A Why Short must answer its question with a sourced reason, but this one says the reason is unknown. Rewrite around a cause the sources state; if they state none, the question is wrong for this format.",
      ]
    : [];
}

export function whyFollowProblems(
  loopLine: string,
  follow: WhyFollow | undefined,
): string[] {
  const f = follow ?? { kind: "series" as const };
  const out: string[] = [];
  if (GENERIC_CTA.test(loopLine))
    out.push(
      `The loop line asks for a subscribe or a like; give the specific reason to follow instead (${f.kind === "series" ? "a new Why every day" : `our ${f.kind}`}).`,
    );
  if (!FOLLOW_CUE[f.kind].test(loopLine))
    out.push(
      f.kind === "series"
        ? `The loop line must point to the series (a new Why every day, or tomorrow's Why) while handing back to the question.`
        : `The loop line must point to our ${f.kind} on ${f.franchise ?? "this game"} ("${f.title}") while handing back to the question.`,
    );
  return out;
}

/** What the script writer is told on top of the news rules when the Short answers a question. */
export function whyBrief(
  question: string,
  angle: string,
  follow?: WhyFollow,
): string {
  return `This Short is not breaking news: it answers one question about a game, using the sources (its Wikipedia article) as the evidence.
Question: ${question}
Likely answer to test against the sources: ${angle}
Structure for this Short (it replaces the news hook and beat rules where they differ):
- hook: the question as tension, in under 3 seconds, ideally with a contrast fact: "Rockstar has re-released GTA 5 three times. GTA 4? Not once." The hook may be or contain the question itself.
- beats: two to four pieces of evidence from the sources, each with a hard specific (a year, a number, a named person or a quote), told as a story with a turn: what fans loved, what changed, where it stands now.
- pulse_take: the verdict in the Pulse voice, with the fair counterpoint in your own words (never a stock "in fairness" opener).
- loop_line: hand back to the question so the end runs into the start ("So why does it still get ignored?" style), never a call to comment.
${followRule(follow)}
- story_type is "explainer". If the sources do not support an answer, say what is known and what is not, never guess.
The YouTube title is the question or a claim with a named company or game and a verb, under 60 characters.`;
}

/** The pinned comment's last line on a Why Short: where the whole story is (comment links are plain text on Shorts). */
export function whyPinnedLine(follow: WhyFollow | undefined): string {
  if (follow?.videoId && follow.title)
    return ` The whole story, in our ${follow.kind}: ${follow.title} https://youtu.be/${follow.videoId}`;
  return " A new Why question every day: tell us which one we should answer next.";
}

/** The hooks of the Why Shorts written in the last `days`, newest first (the episode being written left out). */
export async function recentWhyHooks(
  db: import("../db.ts").Db,
  exceptId: string,
  now: Date,
  days: number,
): Promise<string[]> {
  const rows = await db.query<{ hook: string | null }>(
    `SELECT script_json->>'hook' AS hook FROM episodes
      WHERE story_hash LIKE 'why:%' AND id <> $1 AND script_json IS NOT NULL AND status NOT IN ('failed','rejected')
        AND created_at > $2::timestamptz - ($3 || ' days')::interval
      ORDER BY created_at DESC`,
    [exceptId, now, String(days)],
  );
  return rows.map((r) => r.hook ?? "").filter(Boolean);
}
