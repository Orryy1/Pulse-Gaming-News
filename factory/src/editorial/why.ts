// The "Why" Short: one question about a well-known game, answered in the Pulse voice in 25-40
// seconds (thesis, evidence, the fair counterpoint, a verdict, and a last line that hands back to
// the question so the Short loops). The format that travels for small gaming channels: "Why Rockstar
// IGNORES GTA 4" took 177k views on a 3.3k-subscriber channel. Old games and fan grievances beat
// today's headline. The answer is grounded in the game's Wikipedia article (development, reception,
// legacy, re-releases), fetched by the factory, and fact-checked like any news Short.
import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { EvergreenCandidate } from "./evergreen.ts";
import { voiceFor } from "./voice.ts";

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

A "Why" Short answers one question about a well-known game in 25-40 seconds. The questions that travel are the ones fans already argue about, with a named company or game and a grievance, a mystery or a surprise: "Why has Rockstar never remastered GTA 4?", "Why did Nintendo stop making F-Zero?", "Why does Call of Duty 4 still feel modern?", "Why did Konami walk away from Silent Hill for a decade?". Old games and nostalgia beat today's headline.
Rules:
- The game is famous enough that a cold viewer knows it, and its English Wikipedia article (development, reception, legacy, re-releases, sequels) can honestly answer the question. Never pick a question only rumor or speculation could answer.
- Advertiser-friendly: no tragedies, lawsuits about people, violence or politics as the subject.
- Never repeat a question already covered (listed below), and avoid the same game twice in a row.
Return candidate_index -1 if nothing makes a strong question today.`;
}

export async function selectWhyTopic(
  llm: Llm,
  candidates: EvergreenCandidate[],
  covered: string[],
  demand = "",
): Promise<WhyTopic> {
  return llm.structured({
    system: whyTopicPrompt(),
    content: `Candidates:\n${candidates.map((c, i) => `${i}. ${c.name} (${c.source}${c.note ? `: ${c.note}` : ""})`).join("\n")}\n\nQuestions covered recently:\n${covered.map((c) => `- ${c}`).join("\n") || "- none"}${demand ? `\n\n${demand}` : ""}`,
    schema: WhyTopicSchema,
    effort: "low",
  });
}

/** What the script writer is told on top of the news rules when the Short answers a question. */
export function whyBrief(question: string, angle: string): string {
  return `This Short is not breaking news: it answers one question about a game, using the sources (its Wikipedia article) as the evidence.
Question: ${question}
Likely answer to test against the sources: ${angle}
Structure for this Short (it replaces the news hook and beat rules where they differ):
- hook: the question as tension, in under 3 seconds, ideally with a contrast fact: "Rockstar has re-released GTA 5 three times. GTA 4? Not once." The hook may be or contain the question itself.
- beats: two to four pieces of evidence from the sources, each with a hard specific (a year, a number, a named person or a quote).
- pulse_take: the verdict in the Pulse voice, with the fair counterpoint ("in fairness... but...").
- loop_line: hand back to the question so the end runs into the start ("So why does it still get ignored?" style), never a call to comment.
- story_type is "explainer". If the sources do not support an answer, say what is known and what is not, never guess.
The YouTube title is the question or a claim with a named company or game and a verb, under 60 characters.`;
}
