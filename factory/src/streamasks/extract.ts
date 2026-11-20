// From what people wrote to asks (the rules first, a cheap model second). The rules (src/streamasks/asks.ts) find
// every sentence that asks, claims or wants something a stream can show; a press headline about a known topic
// counts as a claim. Spam and self-promotion are dropped. Then, only for the asks the topic list does not know,
// one small-model call a refresh (site "streamasks.extract", tier low, routable to Codex with CODEX_CALLS) tidies
// each into a plain question with a one-line test and the words and pictures that would show it, and drops the
// noise. The rules keep the last word on rumours and spoilers: the model can add either label, never remove it.

import { z } from "zod";
import type { Llm } from "../editorial/llm.ts";
import { errorMessage, log } from "../lib/util.ts";
import {
  extractAsks,
  isNewsy,
  sentences,
  spoilsStory,
  tidyText,
  topicOf,
  RUMOUR,
  type RawAsk,
  type Sighting,
  type StreamAsk,
} from "./asks.ts";
import type { RawPost } from "./sources.ts";

const SPAM =
  /\b(giveaway|follow (me|us|for)|subscribe|link in (my )?bio|free download|mod menu|download (now|free)|promo code|discount|use code|onlyfans|crypto|airdrop|pre-?order (now|today) at|buy now|shop now)\b/i;

/** Sightings in a batch of posts (pure). */
export function sightingsOf(posts: RawPost[]): Sighting[] {
  const out: Sighting[] = [];
  for (const p of posts) {
    if (SPAM.test(p.text)) continue;
    let raws: RawAsk[] = extractAsks(p.text);
    if (!raws.length && p.source === "press") {
      const title = tidyText(p.text.split(/\.\s/)[0] ?? p.text);
      if (topicOf(title, p.game) && !isNewsy(title))
        raws = [
          {
            kind: "claim",
            question: title,
            claim: `${title} (${p.name})`,
            rumour: RUMOUR.test(p.text),
            text: title,
          },
        ];
    }
    // Talk about a known topic counts as buzz for it even when it is not phrased as a question ("running at native
    // 720p and targeting 30fps").
    if (!raws.length)
      raws = sentences(p.text)
        .filter((x) => topicOf(x, p.game) && !isNewsy(x))
        .slice(0, 1)
        .map((x) => ({
          kind: "claim" as const,
          question: x,
          claim: x,
          rumour: RUMOUR.test(x),
          text: x,
        }));
    for (const raw of raws.slice(0, 3))
      out.push({
        game: p.game,
        raw,
        mention: {
          source: p.source,
          name: p.name,
          ...(p.url ? { url: p.url } : {}),
          at: p.at,
          text: raw.text.slice(0, 280),
          engagement: p.engagement,
        },
      });
  }
  return out;
}

export const ExtractSchema = z.object({
  asks: z.array(
    z.object({
      n: z.number().int(),
      keep: z.boolean(),
      question: z.string(),
      howToTest: z.string(),
      rumour: z.boolean(),
      spoiler: z.boolean(),
      earlyGame: z.boolean(),
      said: z.array(z.string()),
      seen: z.array(z.string()),
    }),
  ),
});

export const EXTRACT_PROMPT = `You tidy a list of things people asked or claimed about a video game into tests a streamer can do on stream.
For each numbered item answer:
- keep: false for anything that is not a question about how the game works, a claim about a system, or a request to see something tried (opinions, jokes, release dates, prices, story speculation, spam); true otherwise.
- question: one plain question under 15 words that the test answers ("Can you lose the cops by changing clothes?"). Never state a leak or rumour as fact.
- howToTest: one line under 25 words: what to do on stream and what result to show.
- rumour: true when it rests on a leak, a datamine, an insider or an unofficial source.
- spoiler: true when it is about the story: endings, deaths, twists, late missions, who betrays whom.
- earlyGame: true when it can be tried in the first few hours of play.
- said: up to 6 short phrases the streamer would likely say while trying it ("out of gas", "lost them").
- seen: up to 3 short descriptions of what the screen would show ("a car stopped on an empty road").
British English. No story spoilers in any field.`;

/**
 * Tidies the new asks the topic list does not know (one model call, at most 40 asks). An ask the model drops is
 * marked stale (kept in the file, off the list); a failed call leaves every ask as the rules wrote it.
 */
export async function refineAsks(
  llm: Llm | undefined,
  asks: StreamAsk[],
  ids: Set<string>,
): Promise<StreamAsk[]> {
  const todo = asks
    .filter((a) => ids.has(a.id) && !a.topic && a.status === "open")
    .slice(0, 40);
  if (!llm || !todo.length) return asks;
  try {
    const out = await llm.structured({
      system: EXTRACT_PROMPT,
      content: todo
        .map(
          (a, i) =>
            `${i + 1}. [${a.game}] ${a.question}${a.mentions[0] ? ` (as written: "${a.mentions[0].text.slice(0, 200)}")` : ""}`,
        )
        .join("\n"),
      schema: ExtractSchema,
      tier: "low",
      effort: "low",
      maxTokens: 6000,
      site: "streamasks.extract",
    });
    const byN = new Map(out.asks.map((x) => [x.n, x]));
    const fixed = new Map<string, StreamAsk>();
    todo.forEach((a, i) => {
      const x = byN.get(i + 1);
      if (!x) return;
      if (!x.keep) {
        fixed.set(a.id, { ...a, status: "stale", why: ["not a testable ask"] });
        return;
      }
      const spoiler = a.spoiler || x.spoiler || spoilsStory(x.question);
      fixed.set(a.id, {
        ...a,
        question: x.question.trim() || a.question,
        howToTest: x.howToTest.trim() || a.howToTest,
        rumour: a.rumour || x.rumour,
        spoiler,
        earlyGame: a.earlyGame && x.earlyGame,
        status: spoiler ? "held" : a.status,
        cues: {
          said: [...new Set([...x.said.slice(0, 6), ...a.cues.said])].slice(
            0,
            10,
          ),
          seen: [...new Set([...x.seen.slice(0, 3), ...a.cues.seen])].slice(
            0,
            4,
          ),
          text: a.cues.text,
        },
      });
    });
    return asks.map((a) => fixed.get(a.id) ?? a);
  } catch (err) {
    log("warn", "stream asks: tidying pass failed; the rules' wording stays", {
      error: errorMessage(err),
    });
    return asks;
  }
}
