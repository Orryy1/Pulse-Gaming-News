// What a search Short may say (SEARCH_SHORTS): only what a confirmed source says or the owner found in his own play.
//   - the confirmed-facts file of each game (SEARCH_FACTS; for GTA VI the Leonida Intel list of 11 Nov, every line
//     with its official link): "## Confirmed" lines are facts, "## Reported" lines are rumours and keep that label;
//   - after launch, the owner's play: the weekly guide plan's play notes (guides.json) and the stream asks his
//     recordings proved or disproved (src/streamasks), each with the recording it came from.
// Nothing is guessed: a query no line answers is not answerable, whatever its demand.

import fs from "node:fs";
import path from "node:path";

export interface Fact {
  text: string;
  urls: string[];
  /** Under "Reported": a rumour, said only with its label. */
  rumour: boolean;
  /** Who says it, for the writer's credit ("Rockstar Support", "Take-Two"). */
  source: string;
}

/** A line from the owner's own play: what he found, and where (a stream, a test). */
export interface PlayNote {
  game: string;
  text: string;
  /** The recording or plan it came from. */
  from: string;
}

const URL_RE = /https?:\/\/[^\s;,)]+/g;

/** The outlet a link belongs to, for credits (pure). */
export function outletOf(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Official source";
  }
  if (host === "support.rockstargames.com") return "Rockstar Support";
  if (host === "store.rockstargames.com") return "Rockstar Store";
  if (host.endsWith("rockstargames.com")) return "Rockstar Newswire";
  if (host.endsWith("take2games.com")) return "Take-Two";
  if (host.endsWith("playstation.com")) return "PlayStation";
  if (host.endsWith("xbox.com")) return "Xbox";
  if (host.endsWith("nintendo.com")) return "Nintendo";
  if (host.endsWith("wikipedia.org")) return "Wikipedia";
  return host;
}

/**
 * The facts in a confirmed-facts markdown file (pure): one per "- " line, its links pulled out, rumours from the
 * "Reported" section on. A line with no link keeps the outlet it names in brackets ("Rockstar quote in press").
 */
export function parseFacts(md: string): Fact[] {
  const out: Fact[] = [];
  let rumour = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^##\s/.test(line)) {
      rumour = /reported|rumou?r|unconfirmed|label/i.test(line);
      continue;
    }
    if (!line.startsWith("- ")) continue;
    const urls = [...line.matchAll(URL_RE)].map((m) =>
      m[0].replace(/[.:]+$/, ""),
    );
    // "(same post; ...)": the post on the line above says it too, so its link comes first.
    const above = out[out.length - 1]?.urls[0];
    if (/same post/i.test(line) && above && !urls.includes(above))
      urls.unshift(above);
    const text = line
      .slice(2)
      .replace(URL_RE, "")
      .replace(/\(same post;\s*\)/i, "")
      .replace(/\s*;\s*(?=$|;)/g, "")
      .replace(/[\s:;,]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (text.length < 8) continue;
    const named = text.match(
      /\(([^()]*?(?:Game Informer|IGN|GamesBeat|Bloomberg|press)[^()]*)\)/i,
    )?.[1];
    out.push({
      text,
      urls,
      rumour,
      source: urls[0]
        ? outletOf(urls[0])
        : named
          ? named.split(",")[0]!.trim()
          : "Press",
    });
  }
  return out;
}

/** A game's facts from SEARCH_FACTS, or none (a missing file is named in the log by the caller). */
export function readFacts(file: string | undefined): Fact[] {
  if (!file) return [];
  try {
    return parseFacts(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/** The facts file for a game, by name or any of its usual spellings. */
export function factsFileFor(
  facts: Record<string, string>,
  game: string,
  same: (a: string, b: string) => boolean,
): string | undefined {
  const key = Object.keys(facts).find((k) => same(k, game));
  return key ? facts[key] : undefined;
}

/** The weekly guide plan's play notes for a game (pure input: the plan JSON). */
export function guidePlayNotes(
  plan: unknown,
  game: string,
  same: (a: string, b: string) => boolean,
): PlayNote[] {
  const p = plan as
    | { game?: string; guides?: Array<{ key?: string; play_notes?: string[] }> }
    | undefined;
  if (!p?.game || !same(p.game, game)) return [];
  return (p.guides ?? []).flatMap((g) =>
    (g.play_notes ?? []).map((text) => ({
      game: p.game!,
      text,
      from: `weekly guide plan (${g.key ?? "guide"})`,
    })),
  );
}

/** Stream asks the owner's recordings settled, as play notes (pure input: the asks store). */
export function askPlayNotes(
  store: unknown,
  game: string,
  same: (a: string, b: string) => boolean,
): PlayNote[] {
  const asks =
    (store as { asks?: Array<Record<string, any>> } | undefined)?.asks ?? [];
  return asks
    .filter(
      (a) =>
        a?.verdict &&
        (a.status === "proved" || a.status === "disproved") &&
        same(String(a.game ?? ""), game),
    )
    .map((a) => ({
      game,
      text: `${a.question} ${a.verdict.result === "proved" ? "Yes" : "No"}: ${a.verdict.reason}`,
      from: `owner's stream ${a.verdict.recordedOn ?? a.verdict.vodId} at ${Math.round(Number(a.verdict.at ?? 0))} s`,
    }));
}

/** Every play note on file for a game: the guide plan beside package.json and the stream asks in the data folder. */
export function readPlayNotes(
  game: string,
  o: {
    guideFile: string;
    dataDir: string;
    same: (a: string, b: string) => boolean;
  },
): PlayNote[] {
  const json = (f: string) => {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8")) as unknown;
    } catch {
      return undefined;
    }
  };
  return [
    ...guidePlayNotes(json(o.guideFile), game, o.same),
    ...askPlayNotes(
      json(path.join(o.dataDir, "streamasks", "asks.json")),
      game,
      o.same,
    ),
  ];
}
