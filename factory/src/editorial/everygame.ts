// "The Story of Every [series] Game" (reports/Pulse upgrade queue.md, items 1 and 17): a franchise told in strict
// release order, as a 60-second Short (one game per beat, a year stamp at each change of era, ending on the newest
// game) and as a long video with one named chapter per game. What the owner rated in the format he studied
// (7 Nov 2026): every beat shows that game's own era, handheld games sit on their hardware, a cut about every
// 1.8 s, a word or two of caption at a time.
//
// Three things here are rules, not taste:
//  - The roster is IGDB's, filtered by code (rosterFromIgdb): the writer never adds, drops or reorders a game, and
//    the years on screen come from the roster, never from the writer.
//  - Honest framing: Pulse never claims to have played them all. Titles say "The Story of Every X Game" or
//    "Every X Game, Explained"; the narration's "I" is opinion, never experience (honestyProblems).
//  - Era-true pictures: a beat shows that game's own pictures (same title, same release, within a year), or its box
//    art on the hardware of its day, never a later game's or a remaster's (eraTrue, eraAudit). The publisher caps
//    (Rockstar: 10 s a video) are the factory's own (src/assets/officialTrailer.ts) and apply unchanged.
//
// The Short rides the evergreen lane as its own format ("every_game"): its beats are "rank" beats, so the render
// plan's rule that an entry shows only its own media holds for it too. The long video rides the documentary lane
// with its own outline (outlineEveryGame): one chapter per game, every roster entry covered.

import { z } from "zod";
import type { Llm } from "./llm.ts";
import { FootageSchema, type Script, type BeatVisual } from "./schema.ts";
import {
  voiceFor,
  voiceProblems,
  writingProblems,
  sentencesIn,
  outsideQuotes,
} from "./voice.ts";
import { fragments } from "./evergreen.ts";
import { voiceTagsField } from "../voice/tags.ts";
import { stripVoiceTags } from "../voice/tags.ts";
import type { IgdbSeriesRow } from "../assets/igdb.ts";
import type { DocOutline, DocTopic } from "./documentary.ts";
import { OpenLoopSchema } from "./openloops.ts";

// ---------------------------------------------------------------- roster

/** The hardware a game's beat is shown on (src/render/EraFrame.tsx draws each; none carries a real brand). */
export const ERA_DEVICES = [
  "handheld-brick",
  "handheld-wide",
  "handheld-dual",
  "crt-tv",
  "flat-tv",
  "crt-monitor",
  "flat-monitor",
] as const;
export type EraDevice = (typeof ERA_DEVICES)[number];

export interface SeriesEntry {
  /** Exact official title, as IGDB files it. */
  title: string;
  year: number;
  /** First release, ISO date, when known. */
  date?: string;
  /** The platforms it first came out on, as people say them, earliest first. */
  platforms: string[];
  kind: "main" | "expansion" | "remake";
  handheld: boolean;
  device: EraDevice;
  igdbId?: number;
}

export interface SeriesRoster {
  series: string;
  /** What people call it aloud ("GTA"); the series name when it has no short form. */
  short: string;
  entries: SeriesEntry[];
  /** What the filter left out and why, for the log and the owner's note. */
  dropped: Array<{ title: string; why: string }>;
}

/** An expansion needs this many IGDB ratings to count as its own entry (London 1961 has 30, a re-split Story Mode 16). */
export const EXPANSION_MIN_RATINGS = 25;
/** The most beats a 60-second Short carries: past it the Short keeps the main games only. */
export const SHORT_ENTRIES_MAX = 18;
export const SHORT_ENTRIES_MIN = 6;

const PLATFORM_NAMES: Record<string, string> = {
  PS1: "PlayStation",
  PS2: "PS2",
  PS3: "PS3",
  PS4: "PS4",
  PS5: "PS5",
  PSP: "PSP",
  Vita: "PS Vita",
  XBOX: "Xbox",
  X360: "Xbox 360",
  XONE: "Xbox One",
  "Series X|S": "Xbox Series X|S",
  NDS: "DS",
  "3DS": "3DS",
  GBA: "Game Boy Advance",
  GBC: "Game Boy Color",
  GB: "Game Boy",
  DC: "Dreamcast",
  N64: "N64",
  NGC: "GameCube",
  PC: "PC",
  DOS: "PC",
  Mac: "Mac",
  Switch: "Switch",
  "Switch 2": "Switch 2",
  Wii: "Wii",
  WiiU: "Wii U",
  SNES: "SNES",
  NES: "NES",
  Arcade: "Arcade",
  iOS: "iOS",
  Android: "Android",
};

const HANDHELDS =
  /^(GB|GBC|GBA|NDS|3DS|PSP|Vita|Game Gear|Lynx|WonderSwan|N-Gage|NGP|NGPC)$/i;
const DUAL_SCREEN = /^(NDS|3DS)$/i;
const BRICKS = /^(GB|GBC|Game Gear|Lynx|WonderSwan|NGP|NGPC)$/i;
const COMPUTERS = /^(PC|DOS|Mac|Amiga|C64|Linux|ZXS|Atari-ST|MSX)$/i;
const MOBILE =
  /^(iOS|Android|Win Phone|Meta Quest 2|Meta Quest 3|Oculus Quest|Stadia|Plug & Play)$/i;

/** The hardware of a game's day: its first platform decides, then its year. */
export function deviceOf(platforms: string[], year: number): EraDevice {
  const lead = platforms.find((p) => !MOBILE.test(p)) ?? platforms[0] ?? "";
  if (DUAL_SCREEN.test(lead)) return "handheld-dual";
  if (BRICKS.test(lead)) return "handheld-brick";
  if (HANDHELDS.test(lead)) return "handheld-wide";
  if (COMPUTERS.test(lead))
    return year <= 2003 ? "crt-monitor" : "flat-monitor";
  return year <= 2005 ? "crt-tv" : "flat-tv";
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface RosterTweaks {
  /** Titles to leave out (a companion app IGDB files as a main game). */
  drop?: string[];
  /** A year to show instead of IGDB's (IGDB dates GTA Online by its PS4 release). */
  years?: Record<string, number>;
  /** The short form people say ("GTA"). */
  short?: string;
}

/**
 * The roster from IGDB's rows (pure): main games, remakes, and the expansions enough people rated; never an edition,
 * a bundle, a port, a remaster, a pack or an update. One entry per title, oldest first. `now` decides what counts as
 * obscure: a main game with no ratings a year after release is a companion app or a cancelled listing.
 */
export function rosterFromIgdb(
  series: string,
  rows: IgdbSeriesRow[],
  now: Date,
  tweaks: RosterTweaks = {},
): SeriesRoster {
  const dropped: SeriesRoster["dropped"] = [];
  const dropSet = new Set((tweaks.drop ?? []).map(norm));
  const years = new Map(
    Object.entries(tweaks.years ?? {}).map(([k, v]) => [norm(k), v]),
  );
  const seen = new Set<string>();
  const entries: SeriesEntry[] = [];
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const r of rows) {
    const key = norm(r.name);
    const out = (why: string) => dropped.push({ title: r.name, why });
    if (!key) continue;
    if (dropSet.has(key)) {
      out("left out by the plan");
      continue;
    }
    if (r.edition) {
      out("an edition of another entry");
      continue;
    }
    const kind =
      r.type === 0
        ? "main"
        : r.type === 8
          ? "remake"
          : r.type === 2 || r.type === 4
            ? "expansion"
            : undefined;
    if (!kind) {
      out(
        r.type === 3
          ? "a bundle"
          : r.type === 9 || r.type === 10
            ? "a remaster"
            : r.type === 11
              ? "a port"
              : "DLC, a pack or an update",
      );
      continue;
    }
    if (!r.date || !r.year) {
      out("no release date");
      continue;
    }
    if (kind === "expansion" && r.ratings < EXPANSION_MIN_RATINGS) {
      out("a minor expansion");
      continue;
    }
    if (kind !== "expansion" && r.ratings === 0 && r.date < yearAgo) {
      out("nobody rated it: a companion app or a listing");
      continue;
    }
    if (seen.has(key)) {
      out("a second listing of the same title");
      continue;
    }
    seen.add(key);
    const year = years.get(key) ?? r.year;
    const lead = r.platforms.filter((p) => !MOBILE.test(p));
    const platforms = [
      ...new Set(
        (lead.length ? lead : r.platforms).map((p) => PLATFORM_NAMES[p] ?? p),
      ),
    ].slice(0, 3);
    const first = (lead.length ? lead : r.platforms)[0] ?? "";
    entries.push({
      title: r.name,
      year,
      date: r.date,
      platforms,
      kind,
      handheld: HANDHELDS.test(first),
      device: deviceOf(lead.length ? lead : r.platforms, year),
      igdbId: r.id,
    });
  }
  entries.sort(
    (a, b) => a.year - b.year || (a.date ?? "").localeCompare(b.date ?? ""),
  );
  return { series, short: tweaks.short?.trim() || series, entries, dropped };
}

/** What a 60-second Short can carry: every entry, or the main games when there are too many, or nothing. */
export function shortEntries(roster: SeriesRoster): {
  entries: SeriesEntry[];
  scope: "every" | "mainline" | "too_many" | "too_few";
} {
  if (roster.entries.length < SHORT_ENTRIES_MIN)
    return { entries: roster.entries, scope: "too_few" };
  if (roster.entries.length <= SHORT_ENTRIES_MAX)
    return { entries: roster.entries, scope: "every" };
  const main = roster.entries.filter((e) => e.kind !== "expansion");
  if (main.length <= SHORT_ENTRIES_MAX && main.length >= SHORT_ENTRIES_MIN)
    return { entries: main, scope: "mainline" };
  return { entries: main, scope: "too_many" };
}

// ---------------------------------------------------------------- eras

/**
 * The Pulse consoles' generations (src/render/components/packs/pulse/PulseConsole.tsx): Tempo to 1993, Prism
 * 1994-99, Basalt 2000-05, Comet 2006-12, Facet 2013-19, Spire from 2020. An era is a generation: handhelds and
 * computers belong to the generation of their year, so one handheld game between two console games is not an era.
 */
export const ERAS: ReadonlyArray<{ name: string; from: number }> = [
  { name: "Tempo", from: 0 },
  { name: "Prism", from: 1994 },
  { name: "Basalt", from: 2000 },
  { name: "Comet", from: 2006 },
  { name: "Facet", from: 2013 },
  { name: "Spire", from: 2020 },
];
export const eraOf = (year: number): string =>
  [...ERAS].reverse().find((e) => year >= e.from)!.name;

/**
 * Which beats carry the year stamp: the first, and each one that opens a new era. A handheld game never opens an
 * era (Vice City Stories on PSP in 2006 belongs with the PS2 games around it): the stamp waits for the first
 * console or computer game of the new generation.
 */
export function eraStampBeats(
  entries: Array<Pick<SeriesEntry, "year"> & { handheld?: boolean }>,
): number[] {
  const out: number[] = [];
  let era = "";
  entries.forEach((e, i) => {
    if (i === 0) {
      era = eraOf(e.year);
      out.push(i);
    } else if (!e.handheld && eraOf(e.year) !== era) {
      era = eraOf(e.year);
      out.push(i);
    }
  });
  return out;
}

// ---------------------------------------------------------------- honest framing

const PLAY_CLAIM =
  /\b(?:i|we)(?:'ve| have|'d| had)?\s+(?:\w+\s+){0,2}?(?:played|replayed|finished|beat|beaten|completed|platinumed|100%ed|bought|owned|rented|grew up (?:on|with|playing)|spent \w+ (?:hours|weeks|summers?))\b|\b(?:my|our) (?:first|childhood|save|copy|playthrough)\b|\bwhen i was (?:a kid|young|little|\d+)\b/i;

/** An invented experience in the narration: the narrator's "I" is opinion, feeling and doubt, never play. */
export function honestyProblems(spoken: string): string[] {
  const hit = outsideQuotes(spoken).match(PLAY_CLAIM);
  return hit
    ? [
        `"${hit[0]}" claims an experience. Pulse never says it played, owned or grew up with a game: give the take as an opinion ("I'd argue", "I think", "for me").`,
      ]
    : [];
}

/** The titles the format may wear, in the owner's words (queue item 1). */
export const everyGameTitles = (short: string) => [
  `The Story of Every ${short} Game`,
  `Every ${short} Game, Explained`,
];

/** A title that claims play or a ranking, or loses the honest frame. */
export function titleProblems(
  title: string,
  roster: Pick<SeriesRoster, "series" | "short">,
): string[] {
  const p: string[] = [];
  const t = title.toLowerCase();
  if (
    /\b(i|we) (played|beat|finished|tried|ranked)\b|\bplaying every\b|\bplayed every\b|\bbeat every\b/.test(
      t,
    )
  )
    p.push(
      `The title "${title}" claims Pulse played them: say "The Story of Every ${roster.short} Game".`,
    );
  if (/\brank(ed|ing|s)?\b|\bworst to best\b|\btier list\b/.test(t))
    p.push(
      `The title "${title}" promises a ranking; this is the series in release order, not a ranking.`,
    );
  if (
    !/\bevery\b/.test(t) ||
    !(
      t.includes(roster.short.toLowerCase()) ||
      t.includes(roster.series.toLowerCase())
    )
  )
    p.push(
      `The title must say "Every ${roster.short} Game" ("${everyGameTitles(roster.short).join('" or "')}").`,
    );
  if (title.length > 70) p.push("The title is over 70 characters.");
  return p;
}

// ---------------------------------------------------------------- the Short

export const EVERY_WORDS_MIN = 110;
/** The fewest words for a roster of this many games: a short series cannot fill 110 words at 11 a line. */
export const everyWordsMin = (games: number) =>
  Math.min(EVERY_WORDS_MIN, 30 + games * 6);
/** About 59 s at the voice's Short pace; the narration cap of the lane still applies. */
export const EVERY_WORDS_MAX = 168;
export const EVERY_LINE_WORDS_MAX = 11;
export const EVERY_HOOK_WORDS_MAX = 10;
export const EVERY_PAYOFF_WORDS_MAX = 26;
/** Frames a shot aims for in an every-game Short: a cut about every 1.8 s (src/render/plan.ts planCuts). */
export const EVERY_SHOT_TARGET = 54;

export const EveryGameEntrySchema = z.object({
  game_title: z
    .string()
    .describe("The game's title exactly as the roster gives it"),
  line: z
    .string()
    .describe(
      "The spoken line for this game: one full sentence with a verb, 5-11 words, naming the game the way people say it and giving the one thing it did or the narrator's honest take on it",
    ),
  caption: z
    .string()
    .describe(
      "One or two words in capitals for the screen: the game's one idea, e.g. 'TOP-DOWN CHAOS', 'HOT COFFEE'",
    ),
  footage: FootageSchema,
});

export const EveryGameShortSchema = z.object({
  hook: z
    .string()
    .describe(
      "First spoken line, 5-10 words: what this is (every game of the series, in order) with an attitude or a number in it",
    ),
  entries: z
    .array(EveryGameEntrySchema)
    .min(SHORT_ENTRIES_MIN - 1)
    .max(SHORT_ENTRIES_MAX),
  payoff: z.object({
    label: z.string().describe("Card label, 1-3 words, e.g. THE TAKE"),
    narration: z
      .string()
      .describe(
        "After the newest game's line: the narrator's owned verdict on the whole run, 1-2 sentences, at most 26 words, with one 'I' line",
      ),
    on_screen: z.string().describe("2-6 word on-screen summary of the verdict"),
  }),
  loop_line: z
    .string()
    .describe(
      "One short closing sentence that hands back to the first line, at most 12 words",
    ),
  youtube: z.object({
    title: z
      .string()
      .describe("Under 70 characters, in the honest frame the brief gives"),
    description: z.string().describe("2-4 sentences. No hashtags"),
    tags: z.array(z.string()),
  }),
  claims: z.array(
    z.object({
      claim: z.string(),
      source: z
        .string()
        .describe("'roster', 'wikipedia' or 'public knowledge'"),
    }),
  ),
});
export type EveryGameShort = z.infer<typeof EveryGameShortSchema>;

const HOUSE = `You write for Pulse Gaming News, a YouTube Shorts channel about video games.

${voiceFor("ranking")}`;

export function everyGameShortPrompt(games = SHORT_ENTRIES_MAX): string {
  return `${HOUSE}

This Short is not a ranking. It is "the story of every game" in a series, in strict release order, oldest first, one game per line, ending on the newest. The rules above about ranks, criteria and keeping number one for last do not apply: there is no order to argue about, the order is history. What stays from the ranking voice is that this is the most personal thing Pulse makes. Every line is the narrator's own read of that game.
Write ${everyWordsMin(games)}-${EVERY_WORDS_MAX} spoken words in total (hook, one line per game, payoff, loop line): under 60 seconds read aloud, so every word earns its place.
1. hook: 5-10 words. Say what this is, with a number or an attitude in it, and talk to "you". Never a greeting, never "So".
2. entries: exactly the games in the roster, in the roster's order, one line each, none added, none dropped, none merged. Each line is one full sentence with a verb, 5-${EVERY_LINE_WORDS_MAX} words. It names the game the way people say it ("GTA 3", "Vice City", "Chinatown Wars") and says the one thing that game did, or your honest take on it. A viewer who joined on this line must understand it. Vary the shape from line to line: a fact, a verdict, a dry aside, a comparison with a named game. Never start two lines running with the same word, never "Then came", never "Next up". Do not say the year in every line: the year is on screen. Say a year aloud at most three times in the whole Short, where the gap itself is the point.
3. The take is spread, not saved: at least three lines carry an owned opinion ("I'd argue", "for me", "I still think"), and one of them disagrees with the usual view and says so. "I" is opinion, feeling or doubt, never experience: never say or imply that you played, owned, finished or grew up with any of these games.
4. caption: one or two words in capitals for that game, its one idea. Never the game's title, never a year.
5. footage: what that game's own picture should show, with 1-4 keywords. It is always that game, in the look of its own year.
6. payoff: spoken straight after the newest game's line. The owned verdict on the whole run in at most ${EVERY_PAYOFF_WORDS_MAX} words: a flat claim and one "I" line.
7. loop_line: one complete closing sentence of at most 12 words that hands back to the hook, a kicker or a one-word question. Never a request.
Facts: release years, platforms and the order come from the roster and nothing else. Anything else you state (what a game introduced, what it sold, what was controversial) comes from the background given or long-established public knowledge, and goes in "claims". If you are not sure of a fact, give the take instead.
youtube.title uses the frame the brief gives, word for word where it gives one. The description says plainly that this is the series in release order and never claims the games were played for it.`;
}

export function rosterBrief(
  roster: SeriesRoster,
  entries: SeriesEntry[],
): string {
  return `Series: ${roster.series} (people say "${roster.short}")\nRoster, in release order (use exactly these titles, in this order):\n${entries
    .map(
      (e, i) =>
        `${i + 1}. ${e.title} | ${e.year} | ${e.platforms.join(", ")}${e.kind === "expansion" ? " | expansion" : e.kind === "remake" ? " | remake" : ""}${e.handheld ? " | handheld" : ""}`,
    )
    .join("\n")}`;
}

export async function writeEveryGameShort(
  llm: Llm,
  roster: SeriesRoster,
  entries: SeriesEntry[],
  opts: {
    title?: string;
    background?: string;
    feedback?: string[];
    scope?: "every" | "mainline";
  } = {},
): Promise<EveryGameShort> {
  const fb = opts.feedback?.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${opts.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  const frame = opts.title
    ? `Title (use it word for word as youtube.title): ${opts.title}`
    : `Title frame: one of ${everyGameTitles(roster.short)
        .map((t) => `"${t}"`)
        .join(" or ")}, with "in 60 Seconds" if it fits.`;
  const scope =
    opts.scope === "mainline"
      ? '\nThis Short covers the main games only (the series has too many entries for 60 seconds): say "every main" game, never just "every".'
      : "";
  return llm.structured({
    site: "everygame.short",
    system: everyGameShortPrompt(entries.length),
    content: `${rosterBrief(roster, entries)}${scope}\n\n${frame}${opts.background ? `\n\nBackground on the series (Wikipedia):\n${opts.background}` : ""}${fb}`,
    schema: EveryGameShortSchema,
    effort: "medium",
  });
}

const wordsOf = (t: string) =>
  stripVoiceTags(t).trim().split(/\s+/).filter(Boolean).length;

export function narrationOfEveryGame(e: EveryGameShort): string {
  return [
    e.hook,
    ...e.entries.map((x) => x.line),
    e.payoff.narration,
    e.loop_line,
  ].join(" ");
}

const ROMAN: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
};
const digits = (t: string) =>
  norm(t)
    .split(" ")
    .map((w) => ROMAN[w] ?? w)
    .join(" ");

/**
 * The words that say this game aloud: its title without the series name ("3", "vice city", "lost and damned"), or
 * the series' short name for the game that is only the series name.
 */
export function spokenNames(
  entry: Pick<SeriesEntry, "title">,
  roster: Pick<SeriesRoster, "series" | "short">,
): string[] {
  const full = digits(entry.title);
  const series = digits(roster.series);
  const short = digits(roster.short);
  const rest = full.replace(series, " ").replace(/\s+/g, " ").trim();
  if (!rest) return [short, series];
  const parts = rest.split(" ").filter((w) => w.length > 1 || /\d/.test(w));
  // "4 the lost and damned" is said "the Lost and Damned": any distinctive word of the subtitle will do.
  const distinctive = parts.filter(
    (w) => !/^(the|and|of|a|an|from|in|to)$/.test(w),
  );
  return distinctive.length ? distinctive : [short, series];
}

const OWNED = /\b(?:i(?:'d|'ll|'m|'ve)?|for me|my)\b/gi;
const YOU = /\b(?:you(?:'re|'ve|'ll|'d)?|your|yours)\b/gi;

/** House rules for the Short (pure): the roster kept exactly, the lengths, the honest frame, the friend's voice. */
export function validateEveryGameShort(
  e: EveryGameShort,
  roster: SeriesRoster,
  entries: SeriesEntry[],
  opts: { title?: string } = {},
): string[] {
  const p: string[] = [];
  const spoken = narrationOfEveryGame(e);
  p.push(
    ...voiceProblems(spoken),
    ...writingProblems(spoken),
    ...honestyProblems(spoken),
  );
  const want = entries.map((x) => norm(x.title));
  const got = e.entries.map((x) => norm(x.game_title));
  if (want.join("|") !== got.join("|")) {
    const missing = entries
      .filter((x) => !got.includes(norm(x.title)))
      .map((x) => x.title);
    const extra = e.entries
      .filter((x) => !want.includes(norm(x.game_title)))
      .map((x) => x.game_title);
    p.push(
      missing.length || extra.length
        ? `The entries must be exactly the roster's games.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${extra.length ? ` Not in the roster: ${extra.join(", ")}.` : ""}`
        : "The entries are out of order: strict release order, exactly as the roster lists them.",
    );
  }
  const words = wordsOf(spoken);
  const wordsMin = everyWordsMin(entries.length);
  if (words < wordsMin || words > EVERY_WORDS_MAX)
    p.push(
      `Spoken word count is ${words}; it must be ${wordsMin}-${EVERY_WORDS_MAX}.`,
    );
  if (wordsOf(e.hook) > EVERY_HOOK_WORDS_MAX)
    p.push(`The hook is over ${EVERY_HOOK_WORDS_MAX} words.`);
  if (wordsOf(e.payoff.narration) > EVERY_PAYOFF_WORDS_MAX)
    p.push(`The payoff is over ${EVERY_PAYOFF_WORDS_MAX} words.`);
  if (wordsOf(e.loop_line) > 12) p.push("The loop line is over 12 words.");
  const bits = fragments(spoken);
  if (bits.length)
    p.push(
      `"${bits[0]}" is a fragment; make every spoken line a full sentence with a verb.`,
    );
  let lastFirst = "";
  for (const [i, x] of e.entries.entries()) {
    const entry = entries.find((r) => norm(r.title) === norm(x.game_title));
    const n = wordsOf(x.line);
    if (n > EVERY_LINE_WORDS_MAX)
      p.push(
        `"${x.game_title}": the line is ${n} words; at most ${EVERY_LINE_WORDS_MAX}.`,
      );
    if (sentencesIn(stripVoiceTags(x.line)).length > 1)
      p.push(`"${x.game_title}": one sentence per game.`);
    if (entry) {
      const line = ` ${digits(stripVoiceTags(x.line))} `;
      if (!spokenNames(entry, roster).some((w) => line.includes(` ${w} `)))
        p.push(
          `"${x.game_title}": the line never names the game. Say it the way people do (e.g. "${spokenNames(entry, roster).join(" ")}").`,
        );
    }
    const cap = x.caption.trim().split(/\s+/).filter(Boolean);
    if (!cap.length || cap.length > 2 || x.caption.length > 18)
      p.push(`"${x.game_title}": the caption must be one or two short words.`);
    else if (/\b(19|20)\d\d\b/.test(x.caption))
      p.push(`"${x.game_title}": the caption is never a year.`);
    const first = norm(stripVoiceTags(x.line)).split(" ")[0] ?? "";
    if (i > 0 && first && first === lastFirst)
      p.push(
        `"${x.game_title}": two lines running start with "${first}"; vary the shape.`,
      );
    lastFirst = first;
  }
  const years = (
    stripVoiceTags(e.entries.map((x) => x.line).join(" ")).match(
      /\b(19|20)\d\d\b/g,
    ) ?? []
  ).length;
  if (years > 3)
    p.push(
      `A year is said aloud ${years} times; at most three (the year is on screen).`,
    );
  const owned = (stripVoiceTags(spoken).match(OWNED) ?? []).length;
  if (owned < 3)
    p.push(
      `The narrator owns a take ${owned} time${owned === 1 ? "" : "s"}; at least three "I" or "for me" lines, as opinion.`,
    );
  const you = (stripVoiceTags(spoken).match(YOU) ?? []).length;
  if (you < 2)
    p.push(
      `"You" is said ${you} time${you === 1 ? "" : "s"}; talk to the viewer at least twice, once in the hook or the first line.`,
    );
  p.push(...titleProblems(e.youtube.title, roster));
  if (opts.title && e.youtube.title.trim() !== opts.title.trim())
    p.push(`youtube.title must be "${opts.title}" word for word.`);
  if (
    /\b(played|finished|beat) (them|every|all)\b/i.test(e.youtube.description)
  )
    p.push(
      "The description claims the games were played; say it is the series in release order.",
    );
  return [...new Set(p)];
}

/**
 * The title as the card shows it: the series' short name in place of its full one ("GTA: Vice City", "GTA IV: The
 * Lost and Damned"), so seventeen cards do not each open on the same three words.
 */
export function displayTitle(title: string, roster: Pick<SeriesRoster, "series" | "short">): string {
  if (!roster.short || roster.short === roster.series) return title;
  return title.toLowerCase().startsWith(roster.series.toLowerCase())
    ? `${roster.short}${title.slice(roster.series.length)}`
    : title;
}

/** What rides along in the Script for the gather, the render and the audit. */
export interface EveryGameMeta {
  series: string;
  short: string;
  /** One per beat, in beat order. */
  beats: Array<{
    title: string;
    year: number;
    platforms: string[];
    device: EraDevice;
    handheld: boolean;
    /** The year stamp lands on this beat (the first, and each change of era). */
    stamp: boolean;
  }>;
}

/**
 * Adapts the Short into the common Script shape: one "rank" beat per game in release order (so the render plan
 * gives a beat only its own game's pictures), the payoff as the take over the newest game, the years from the
 * roster. Entries carry rank N..1 so the newest game is "number one": the plan shows it behind the take.
 */
export function everyGameToScript(
  e: EveryGameShort,
  roster: SeriesRoster,
  entries: SeriesEntry[],
): Script {
  const byTitle = new Map(entries.map((x) => [norm(x.title), x]));
  const rows = e.entries
    .map((x) => ({ x, entry: byTitle.get(norm(x.game_title)) }))
    .filter((r): r is { x: (typeof e.entries)[number]; entry: SeriesEntry } =>
      Boolean(r.entry),
    );
  const total = rows.length;
  const stamps = new Set(eraStampBeats(rows.map((r) => r.entry)));
  const beats = rows.map(({ x, entry }, i) => ({
    narration: x.line,
    footage: x.footage,
    visual: {
      kind: "rank",
      primary: displayTitle(entry.title, roster),
      secondary: x.caption.toUpperCase(),
      value_a: total - i,
      items: [String(entry.year), entry.platforms.join(", ")],
    } satisfies BeatVisual,
  }));
  const meta: EveryGameMeta = {
    series: roster.series,
    short: roster.short,
    beats: rows.map(({ entry }, i) => ({
      title: entry.title,
      year: entry.year,
      platforms: entry.platforms,
      device: entry.device,
      handheld: entry.handheld,
      stamp: stamps.has(i),
    })),
  };
  const newest = rows.at(-1)?.entry;
  return {
    story_type: "other",
    game_title: roster.series,
    steam_search_term: "",
    headline: e.youtube.title,
    hook: e.hook,
    hook_footage: {
      want: "gameplay",
      keywords: [newest?.title ?? roster.series],
    },
    beats,
    pulse_take: e.payoff,
    loop_line: e.loop_line,
    is_rumour: false,
    attribution: "Source: IGDB / Pulse",
    youtube: e.youtube,
    evergreen_format: "every_game",
    every_game: meta,
    claims: e.claims.map((c) => ({ claim: c.claim, source_url: c.source })),
    entries: rows.map(({ entry }, i) => ({
      rank: total - i,
      game_title: entry.title,
      // Never the store: a series' old games sit on Steam as their remasters. The gather goes to IGDB by title and year.
      steam_search_term: "",
      year: entry.year,
      platforms: entry.platforms.join(", "),
    })),
    ...voiceTagsField(e),
  };
}

/** The year stamps of a Short, timed to the start of their beats (seconds), for the render's stamp layer. */
export function eraStampsFor(
  script: Pick<Script, "every_game">,
  beatStarts: number[],
  colour: string,
): Array<{
  at: number;
  text: string;
  sub?: string;
  colour: string;
  tone?: string;
}> {
  const meta = script.every_game;
  if (!meta) return [];
  return meta.beats.flatMap((b, i) =>
    b.stamp && beatStarts[i] !== undefined
      ? [
          {
            at: beatStarts[i]! + 0.05,
            text: String(b.year),
            colour,
            tone: "neutral",
          },
        ]
      : [],
  );
}

// ---------------------------------------------------------------- era-true pictures

export const REMASTER_WORDS =
  /\b(definitive|remaster(ed)?|remake|anniversary|enhanced|expanded|hd|collection|trilogy|complete edition|special edition|director'?s cut|redux|reloaded|next[- ]gen|mobile|netflix)\b/i;

export interface PictureSource {
  /** The game the picture is of, as its source names it. */
  game: string;
  /** That release's year, when the source gives one. */
  year?: number;
}

/**
 * Whether a picture is of this entry's own release: the same title, the same release within a year, and not a
 * remaster's unless the entry is that remaster. A picture with no year passes on its title alone only when the
 * title carries no remaster word.
 */
export function eraTrue(
  src: PictureSource,
  entry: Pick<SeriesEntry, "title" | "year">,
): boolean {
  if (digits(src.game) !== digits(entry.title)) return false;
  if (REMASTER_WORDS.test(src.game) && !REMASTER_WORDS.test(entry.title)) return false;
  if (src.year === undefined) return true;
  return Math.abs(src.year - entry.year) <= 1;
}

/** The game and year a factory provenance line names ('IGDB screenshot for "Grand Theft Auto 2" (1999), ...'). */
export function provenanceSource(
  provenance: string,
): PictureSource | undefined {
  const m = provenance.match(/"([^"]+)"(?:\s*\((\d{4})\))?/);
  return m
    ? { game: m[1]!, ...(m[2] ? { year: Number(m[2]) } : {}) }
    : undefined;
}

export interface AuditMedia {
  file: string;
  provenance: string;
  beatIndex?: number;
  kind?: string;
}

export interface BeatAudit {
  beat: number;
  title: string;
  year: number;
  device: EraDevice;
  /** What the beat can show: its own era-true pictures and clips. */
  pictures: string[];
  clips: string[];
  /** Media tagged for the beat that is not of this game's own release. */
  wrong: string[];
  /** "footage", "pictures", "hardware" (its box art or a screen on the hardware of its day) or "empty". */
  shows: "footage" | "pictures" | "hardware" | "empty";
}

/** A picture the factory made on the era's hardware (src/render/EraFrame.tsx) says so in its provenance. */
export const HARDWARE_PROVENANCE = "on the hardware of its day";

/**
 * The era audit (pure): for every beat, the media tagged for it must be of that game's own release. Anything
 * else is listed as wrong, and a beat with nothing of its own is empty. The gather drops what is wrong; the gate
 * before the render refuses a Short with a wrong or an empty beat.
 */
export function eraAudit(
  meta: EveryGameMeta,
  images: AuditMedia[],
  clips: AuditMedia[],
): BeatAudit[] {
  return meta.beats.map((b, beat) => {
    const mine = (m: AuditMedia) => m.beatIndex === beat;
    const ok = (m: AuditMedia) => {
      const src = provenanceSource(m.provenance);
      return Boolean(src && eraTrue(src, b));
    };
    const pics = images.filter(mine);
    const vids = clips.filter(mine);
    const wrong = [...pics, ...vids].filter((m) => !ok(m)).map((m) => m.file);
    const goodPics = pics.filter(ok);
    const goodClips = vids.filter(ok);
    const shown = goodPics.filter((m) => m.kind !== "capsule");
    return {
      beat,
      title: b.title,
      year: b.year,
      device: b.device,
      pictures: goodPics.map((m) => m.file),
      clips: goodClips.map((m) => m.file),
      wrong,
      shows: goodClips.length
        ? "footage"
        : shown.some((m) => !m.provenance.includes(HARDWARE_PROVENANCE))
          ? "pictures"
          : shown.length
            ? "hardware"
            : "empty",
    };
  });
}

/** Why a Short's pictures are not fit to render: a beat showing another release, or a beat with nothing. */
export function eraProblems(audit: BeatAudit[]): string[] {
  const p: string[] = [];
  for (const a of audit) {
    if (a.wrong.length)
      p.push(
        `${a.title} (${a.year}) has ${a.wrong.length} picture${a.wrong.length === 1 ? "" : "s"} of another release: ${a.wrong.slice(0, 3).join(", ")}`,
      );
    if (a.shows === "empty")
      p.push(
        `${a.title} (${a.year}) has no picture of its own, not even its box art`,
      );
  }
  return p;
}

// ---------------------------------------------------------------- the long video

export const EVERY_CHAPTERS_MAX = 24;

export const EveryGameChapterSchema = z.object({
  chapter_title: z
    .string()
    .describe(
      "2-7 words a viewer would search for, naming the game and its turning point as a mini-headline: 'GTA 3 and the Leap to 3D', 'The Hot Coffee Mess'. Never 'Part 3', never a bare title",
    ),
  game_title: z
    .string()
    .describe(
      "The roster title this chapter is about, exactly as the roster gives it",
    ),
  covers: z
    .array(z.string())
    .describe(
      "Every roster title this chapter tells, exactly as the roster gives them: the chapter's own game first. More than one only for expansions told with their parent or with each other",
    ),
  wiki_title: z
    .string()
    .describe("The English Wikipedia article title for that game"),
  focus: z
    .string()
    .describe(
      "What this chapter covers, its turning point, and the one honest take the narrator lands on this game, 2-3 sentences",
    ),
  photo_searches: z
    .array(z.string())
    .max(4)
    .describe(
      "1-4 searches for real photos a free archive would hold for this chapter: the studio, the city a game copied, the people. Never game screenshots or box art",
    ),
});

export const EveryGameOutlineSchema = z.object({
  question: z
    .string()
    .describe("The one question the video answers, as a viewer would ask it"),
  kicker: z.string().describe("3-8 word line under the title"),
  franchise_wiki_title: z
    .string()
    .describe("The series' English Wikipedia article title"),
  chapters: z.array(EveryGameChapterSchema).min(4).max(EVERY_CHAPTERS_MAX),
  open_loops: z.array(OpenLoopSchema).max(14).optional(),
  youtube: z.object({
    thumb_text: z
      .string()
      .describe(
        "1-4 words in capitals for the thumbnail: the hook, not the title",
      ),
    description: z
      .string()
      .describe(
        "3-5 sentences: the series told game by game in release order, and the angle. Never claims the games were played for it. No hashtags, no timestamps",
      ),
    tags: z.array(z.string()).max(15),
  }),
});
export type EveryGameOutline = z.infer<typeof EveryGameOutlineSchema>;

export function everyGameOutlinePrompt(): string {
  return `You plan long videos for Pulse Gaming News, a YouTube channel about video games.

${voiceFor("documentary")}

Plan "the story of every game" in one series: a long video of about 50 minutes told game by game in strict release order, one named chapter per game, so each chapter can be found and watched on its own.
- The games are the roster's and nothing else. Every roster title is told in exactly one chapter. A chapter is one game. Two entries share a chapter only when they are expansions of the same game or of each other and one article documents them; then "covers" lists them all and the chapter title names them both ("The London Packs", "The Lost and Damned and Gay Tony").
- Chapters run in release order by their first game.
- Chapter titles are searchable on their own: the game the way people say it, plus its turning point, as a mini-headline with a verb or a conflict ("GTA 3 and the Leap to 3D", "The Hot Coffee Mess", "Vice City Stories Says Goodbye to PSP"). Never a topic label, never "Part".
- focus says what the chapter covers and names the one honest take the narrator lands on that game. This format is more personal than a documentary: every chapter has a take a viewer could argue with, said as opinion. The narrator never claims to have played, owned or grown up with a game.
- wiki_title is the English Wikipedia article for that game (an expansion without its own article uses its parent's).
- The question is one a viewer would ask about the whole run ("How did a top-down game about stealing cars become the biggest launch in entertainment?"); the last chapter answers it.
- Never invent a game, a year or a platform: those come from the roster.`;
}

export async function outlineEveryGame(
  llm: Llm,
  roster: SeriesRoster,
  title: string,
  angle: string,
  seriesNotes: string,
  opts: { openLoops?: string; feedback?: string[] } = {},
): Promise<EveryGameOutline> {
  const fb = opts.feedback?.length
    ? `\n\nA previous outline was rejected. Fix every one of these problems:\n${opts.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    site: "everygame.outline",
    system: `${everyGameOutlinePrompt()}${opts.openLoops ? `\n\n${opts.openLoops}` : ""}`,
    content: `${rosterBrief(roster, roster.entries)}\n\nTitle: ${title}\nAngle: ${angle}\n\nSeries overview (Wikipedia):\n${seriesNotes || "(not available)"}${fb}`,
    schema: EveryGameOutlineSchema,
    effort: "medium",
  });
}

/** House rules for the outline (pure): every roster game told once, in release order, by a named chapter. */
export function validateEveryGameOutline(
  o: EveryGameOutline,
  roster: SeriesRoster,
): string[] {
  const p: string[] = [];
  const order = new Map(roster.entries.map((e, i) => [norm(e.title), i]));
  const told = new Map<string, number>();
  let last = -1;
  for (const [i, c] of o.chapters.entries()) {
    const own = norm(c.game_title);
    if (!order.has(own)) {
      p.push(
        `Chapter ${i + 1} ("${c.chapter_title}") is about "${c.game_title}", which is not in the roster.`,
      );
      continue;
    }
    const covers = [...new Set([own, ...c.covers.map(norm)])];
    for (const t of covers) {
      if (!order.has(t))
        p.push(`Chapter ${i + 1} covers "${t}", which is not in the roster.`);
      else told.set(t, (told.get(t) ?? 0) + 1);
    }
    const extras = covers.filter((t) => t !== own && order.has(t));
    if (extras.some((t) => roster.entries[order.get(t)!]!.kind !== "expansion"))
      p.push(
        `Chapter ${i + 1} ("${c.chapter_title}") folds a main game into another chapter; a main game gets its own.`,
      );
    const at = Math.min(
      ...covers.filter((t) => order.has(t)).map((t) => order.get(t)!),
    );
    if (at < last)
      p.push(
        `Chapter ${i + 1} ("${c.chapter_title}") is out of release order.`,
      );
    last = Math.max(last, at);
    const words = c.chapter_title.trim().split(/\s+/).length;
    if (words < 2 || words > 8)
      p.push(`Chapter ${i + 1}'s title must be 2-7 words.`);
    if (/^part\s+\d+/i.test(c.chapter_title) || norm(c.chapter_title) === own)
      p.push(
        `Chapter ${i + 1}'s title ("${c.chapter_title}") must name the game's turning point, not just the game.`,
      );
  }
  for (const e of roster.entries) {
    const n = told.get(norm(e.title)) ?? 0;
    if (n === 0) p.push(`"${e.title}" (${e.year}) has no chapter.`);
    else if (n > 1)
      p.push(`"${e.title}" is told in ${n} chapters; exactly one.`);
  }
  return [...new Set(p)];
}

/**
 * The outline in the documentary lane's own shape (src/editorial/documentary.ts DocOutline): years and platforms
 * from the roster, never the store's search term (an old game's Steam page is its remaster), the title as planned.
 */
export function everyGameDocOutline(
  o: EveryGameOutline,
  roster: SeriesRoster,
  title: string,
): DocOutline {
  const byTitle = new Map(roster.entries.map((e) => [norm(e.title), e]));
  return {
    question: o.question,
    title,
    kicker: o.kicker,
    franchise_wiki_title: o.franchise_wiki_title,
    chapters: o.chapters
      .filter((c) => byTitle.has(norm(c.game_title)))
      .map((c) => {
        const e = byTitle.get(norm(c.game_title))!;
        return {
          chapter_title: c.chapter_title,
          game_title: e.title,
          wiki_title: c.wiki_title,
          steam_search_term: "",
          year: e.year,
          platforms: e.platforms.join(", "),
          focus: c.focus,
          photo_searches: c.photo_searches,
        };
      }),
    ...(o.open_loops ? { open_loops: o.open_loops } : {}),
    youtube: {
      title,
      thumb_text: o.youtube.thumb_text,
      description: o.youtube.description,
      tags: o.youtube.tags,
    },
  };
}

/** The YouTube chapter list the outline gives ("The Story of Every GTA Game": one line per chapter, in order). */
export function chapterList(
  o: Pick<EveryGameOutline, "chapters">,
  roster: SeriesRoster,
): string[] {
  const byTitle = new Map(roster.entries.map((e) => [norm(e.title), e]));
  return o.chapters.map(
    (c, i) =>
      `${i + 1}. ${c.chapter_title} (${byTitle.get(norm(c.game_title))?.year ?? "?"})`,
  );
}

/** The documentary lane's topic for the long video. */
export function everyGameDocTopic(
  roster: SeriesRoster,
  title: string,
  angle: string,
  wiki?: string,
): DocTopic {
  return {
    kind: "franchise",
    franchise_index: -1,
    story_index: -1,
    title_idea: title,
    angle,
    reason: "Planned in the every-game schedule",
    franchise: roster.series,
    ...(wiki ? { wiki } : {}),
    format: "everygame",
    roster,
  };
}

/**
 * What may never ship, whatever else is let through as a style warning (pure): a roster that is not the
 * roster's, an invented experience, a title outside the honest frame.
 */
export function mustFixEveryGame(
  e: EveryGameShort,
  roster: SeriesRoster,
  entries: SeriesEntry[],
  opts: { title?: string } = {},
): string[] {
  const hard = new Set([
    ...honestyProblems(narrationOfEveryGame(e)),
    ...titleProblems(e.youtube.title, roster),
  ]);
  return validateEveryGameShort(e, roster, entries, opts).filter(
    (p) =>
      hard.has(p) ||
      p.startsWith("The entries ") ||
      p.startsWith("youtube.title must be") ||
      p.startsWith("The description claims"),
  );
}
