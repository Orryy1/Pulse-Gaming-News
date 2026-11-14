// The hand-made list the living one starts from (docs/streamasks-seed-gta6.md, 12 Nov 2026: every claim from the GTA
// VI previews, with its source and how to test it). Read as asks (pure): each table row and each myth becomes one,
// on its known topic where the topic list has it, with the row's own claim and test kept word for word.

import { RUMOUR, askId, topicOf, type StreamAsk } from "./asks.ts";
import { tokens } from "../sceneindex/lookup.ts";

const strip = (s: string) =>
  s.replace(/\*\*/g, "").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** A row's source in brackets ("(Edge)", "(Game Informer, Aaron Garbut)"), or the list's own sources. */
function rowSource(claim: string): string {
  const m = claim.match(/\(([^)]{2,60})\)\s*$/);
  return m
    ? `Previews: ${m[1]}`
    : "Previews (GTABase, GTA BOOM, GamesRadar roundups)";
}

export function parseSeed(md: string, game: string, at: string): StreamAsk[] {
  const out: StreamAsk[] = [];
  const add = (test: string, claim: string, how: string, myth: boolean) => {
    const text = `${test} ${claim}`;
    const topic = topicOf(text, game);
    const question =
      topic?.question ??
      (myth
        ? `"${test.replace(/^"|"$/g, "").replace(/[.]$/, "")}": true or not?`
        : `${test.replace(/[?.]$/, "")}?`);
    const rumour = RUMOUR.test(text) || /\bmyth\b/i.test(claim);
    const id = askId(game, topic?.id ?? tokens(question).sort().join(" "));
    if (out.some((a) => a.id === id)) return;
    out.push({
      id,
      game,
      ...(topic ? { topic: topic.id } : {}),
      question,
      claim,
      howToTest:
        how || topic?.howToTest || "Try it on stream and show the result.",
      kind: myth ? "myth" : "claim",
      rumour,
      earlyGame:
        topic?.earlyGame ?? !/\b(story|weeks?|later|hours? story)\b/i.test(how),
      spoiler: false,
      cues: topic?.cues ?? {
        said: tokens(test).slice(0, 6),
        seen: [test],
        text: [],
      },
      mentions: [
        {
          source: "seed",
          name: rowSource(claim),
          at,
          text: claim.slice(0, 280),
          engagement: 0,
        },
      ],
      mentionCount: 1,
      engagement: 0,
      firstSeen: at,
      lastSeen: at,
      status: "open",
    });
  };
  for (const line of md.split(/\r?\n/)) {
    const cells = line.split("|").map((c) => strip(c));
    if (
      line.trim().startsWith("|") &&
      cells.length >= 5 &&
      !/^-+$/.test(cells[1] ?? "")
    ) {
      // | Day | Test | Claim | How | or | Test | Claim | How |
      const body = cells.slice(1, -1);
      const [test, claim, how] = body.length >= 4 ? body.slice(1) : body;
      if (
        !test ||
        !claim ||
        /^(test|day)$/i.test(test) ||
        /^the claim$/i.test(claim)
      )
        continue;
      add(test, claim, how ?? "", false);
      continue;
    }
    const myth = line.match(/^\s*-\s+\*\*(.+?)\*\*\s*(.*)$/);
    if (myth) {
      const head = strip(myth[1]!);
      const rest = strip(myth[2] ?? "");
      const name = head
        .replace(/^"([^"]+)"\s*(\(.*\))?\.?$/, "$1")
        .replace(/\.$/, "");
      // The test is the bullet's instructions ("Check the settings menu on day 1."), not its commentary.
      const how = rest
        .split(/(?<=\.)\s+/)
        .filter((x) => /^(check|show|look|track|say|try|drive|open|walk|get|time|count|do|don'?t|keep|go|use)\b/i.test(x))
        .join(" ");
      add(`"${name}"`, `${head} ${rest}`.trim(), how || rest, true);
    }
  }
  return out;
}

/** Seeds folded into the list (pure): a seed already there keeps its history; one not there yet is added. */
export function mergeSeeds(asks: StreamAsk[], seeds: StreamAsk[]): StreamAsk[] {
  const have = new Set(asks.map((a) => a.id));
  return [...asks, ...seeds.filter((s) => !have.has(s.id))];
}
