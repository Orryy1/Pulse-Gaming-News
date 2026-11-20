// The pronunciation safety net (owner, 12 Nov 2026: the Resident Evil Short read "GOTY" as G-O-T-Y; "find and fix
// absolutely every possible case of that"). After every voicing, Short or long video, the narration check's letter
// watch (src/qa/narration.ts letterReadings) lists the capitals the voice spelled out that are not said as letters.
// For each one this decides what to do:
//   - a spoken form the tables know (speakable.ts, or LOOSE_FORMS below): the episode says it that way from now on;
//   - a spoken form the script itself gives (a name in brackets after it, or a capitalised name or the game's
//     title whose initials spell it, "RE4" in a Short about Resident Evil 4): the same;
//   - a garbled reading of an unknown token (letters heard that are not its own): spelled out letter by letter,
//     so the second take reads the letters cleanly;
//   - an unknown token read cleanly as letters: kept, and logged in data/admin/pronunciation_unknown.json with a
//     line in the daily alert digest, so the tables grow.
// The forms go in script_json.say_as, which every speakable() caller applies (speakContext), and the narration step
// voices once more. Pure, apart from the log file.
import fs from "node:fs/promises";
import path from "node:path";
import type { LetterReading } from "../qa/narration.ts";
import { knownSpokenForm, romanValue, SAID_AS_LETTERS } from "./speakable.ts";

/**
 * Tokens whose spoken form the voice-time tables only use in context (AA before "games"), or that are rare enough
 * to be safe only once the voice has already spelled them: when the letter watch catches one, this is the word.
 */
export const LOOSE_FORMS: Record<string, string> = {
  AA: "double-A",
  COD: "Call of Duty",
  RAGE: "Rage",
  MOBA: "Moba",
  NASA: "Nasa",
  SEGA: "Sega",
  GOTY: "Game of the Year",
};

export interface PronunciationPlan {
  /** Token to the form the next take says (goes into script_json.say_as). */
  sayAs: Record<string, string>;
  /** Unknown tokens read cleanly as letters: logged, not changed. */
  unknown: LetterReading[];
  /** Where each form came from, for the log line. */
  why: Record<string, "table" | "script" | "spelled">;
}

const SMALL = new Set(["of", "the", "and", "a", "an", "for", "to", "in", "on"]);

/** "RE4" against "Resident Evil 4", "GDC" against "Game Developers Conference" (pure). */
export function initialsMatch(token: string, phrase: string): boolean {
  const want = token.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const words = phrase.split(/[\s:–—-]+/).filter(Boolean);
  const number = (w: string) =>
    /^\d+$/.test(w)
      ? w
      : romanValue(w) !== undefined
        ? String(romanValue(w))
        : undefined;
  const forms = [words, words.filter((w) => !SMALL.has(w.toLowerCase()))].map(
    (ws) =>
      ws
        .map(
          (w) => number(w) ?? (/^[A-Za-z]/.test(w) ? w[0]!.toUpperCase() : ""),
        )
        .join(""),
  );
  // Token's own roman numeral as a figure too ("FFVII" for "Final Fantasy 7").
  const tail = /^([A-Z]+?)([IVX]{1,5})$/.exec(want);
  const alt =
    tail && romanValue(tail[2]!) !== undefined
      ? `${tail[1]}${romanValue(tail[2]!)}`
      : undefined;
  return (
    want.length >= 2 &&
    forms.some((f) => f === want || (alt !== undefined && f === alt))
  );
}

/** Capitalised runs of words in a text ("Resident Evil 4", "Game Developers Conference"), with small joiners. */
function capitalisedPhrases(text: string): string[] {
  const out: string[] = [];
  const re =
    /\b[A-Z][\w'’]*(?:\s+(?:of|the|and|for|[A-Z][\w'’]*|\d{1,3}|[IVX]{1,5}))+/g;
  for (const m of text.matchAll(re)) {
    const words = m[0].split(/\s+/);
    // Every run that starts at a capital and ends on a capital or a number inside the match, so "In Resident Evil 4
    // the RE4 team" also offers "Resident Evil 4".
    for (let i = 0; i < words.length - 1; i++)
      for (let j = i + 2; j <= words.length; j++)
        if (/^[A-Z]/.test(words[i]!) && /^[A-Z0-9]/.test(words[j - 1]!))
          out.push(words.slice(i, j).join(" "));
  }
  return out;
}

export interface ScriptText {
  hook?: string;
  beats?: Array<{ narration?: string }>;
  pulse_take?: { narration?: string };
  loop_line?: string;
  headline?: string;
  game_title?: string;
  entries?: Array<{ game_title?: string }>;
}

/** The spoken form the script itself gives a token, or undefined (pure). */
export function contextExpansion(
  token: string,
  script: ScriptText,
): string | undefined {
  const texts = [
    script.game_title,
    ...(script.entries ?? []).map((e) => e.game_title),
    script.headline,
    script.hook,
    ...(script.beats ?? []).map((b) => b.narration),
    script.pulse_take?.narration,
    script.loop_line,
  ].filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  // "the Game Developers Conference (GDC)": the name in front of the brackets.
  const bare = token.replace(/[^A-Za-z0-9]/g, "");
  for (const t of texts) {
    const m = new RegExp(
      `([A-Z][\\w'’ -]{2,80}?)\\s*\\(\\s*${bare}\\s*\\)`,
    ).exec(t);
    if (m) {
      const words = m[1]!.trim().split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        const phrase = words.slice(i).join(" ");
        if (initialsMatch(bare, phrase)) return trimSmall(bare, phrase);
      }
    }
  }
  for (const t of texts)
    for (const p of capitalisedPhrases(t))
      if (initialsMatch(bare, p)) return trimSmall(bare, p);
  return undefined;
}

/** What to do about each token the voice spelled out (pure). */
export function pronunciationPlan(
  readings: LetterReading[],
  script: ScriptText,
): PronunciationPlan {
  const plan: PronunciationPlan = { sayAs: {}, unknown: [], why: {} };
  const seen = new Set<string>();
  for (const r of readings) {
    if (seen.has(r.token)) continue;
    seen.add(r.token);
    const upper = r.token.toUpperCase();
    if (SAID_AS_LETTERS.has(upper)) continue;
    const table =
      knownSpokenForm(r.token) ?? LOOSE_FORMS[r.token] ?? LOOSE_FORMS[upper];
    if (table) {
      plan.sayAs[r.token] = table;
      plan.why[r.token] = "table";
      continue;
    }
    const fromScript = contextExpansion(r.token, script);
    if (fromScript) {
      plan.sayAs[r.token] = fromScript;
      plan.why[r.token] = "script";
      continue;
    }
    if (!r.clean) {
      // Letters said wrongly: spell them out so the next take reads each one ("TR30" is "T R 30").
      plan.sayAs[r.token] = r.token
        .replace(/(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/g, " ")
        .replace(/[A-Za-z]{2,}/g, (l) => l.toUpperCase().split("").join(" "));
      plan.why[r.token] = "spelled";
      continue;
    }
    plan.unknown.push(r);
  }
  return plan;
}

export interface UnknownEntry {
  count: number;
  first: string;
  last: string;
  episodes: string[];
  heard: string;
}
export type UnknownList = Record<string, UnknownEntry>;

/** The running list of tokens the voice spelled that the tables do not know (data/admin/pronunciation_unknown.json). */
export const unknownFile = (dataDir: string) =>
  path.join(dataDir, "admin", "pronunciation_unknown.json");

export async function readUnknown(file: string): Promise<UnknownList> {
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    return raw && typeof raw === "object" ? (raw as UnknownList) : {};
  } catch {
    return {};
  }
}

/** Adds this episode's unknown tokens to the running list (one count per episode per token). */
export async function recordUnknown(
  file: string,
  readings: LetterReading[],
  episode: string,
  now: Date,
): Promise<UnknownList> {
  const list = await readUnknown(file);
  for (const r of readings) {
    const e = list[r.token] ?? {
      count: 0,
      first: now.toISOString(),
      last: now.toISOString(),
      episodes: [],
      heard: r.heard,
    };
    if (e.episodes.includes(episode)) continue;
    e.count++;
    e.last = now.toISOString();
    e.heard = r.heard;
    e.episodes = [...e.episodes, episode].slice(-10);
    list[r.token] = e;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(list, null, 2)}\n`, "utf8");
  return list;
}

/**
 * The alert digest's line about the running list (pure): tokens still unknown to the tables, most frequent first.
 * A token since added to SAID_AS_LETTERS or given a spoken form drops out on its own.
 */
export function unknownDigestLine(list: UnknownList): string | undefined {
  const open = Object.entries(list)
    .filter(
      ([t]) =>
        !SAID_AS_LETTERS.has(t.toUpperCase()) &&
        !knownSpokenForm(t) &&
        !LOOSE_FORMS[t],
    )
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  if (!open.length) return undefined;
  const names = open
    .slice(0, 12)
    .map(([t, e]) => `${t} (${e.count})`)
    .join(", ");
  return `Pronunciation: the voice spelled out ${open.length} abbreviation${open.length === 1 ? "" : "s"} the tables do not know yet: ${names}. Add each to SAID_AS_LETTERS or SAID_AS_WORDS in src/voice/speakable.ts (data/admin/pronunciation_unknown.json).`;
}

/** "The Game Developers Conference" for "GDC" is said "Game Developers Conference": a leading small word goes when the initials still match. */
function trimSmall(token: string, phrase: string): string {
  let words = phrase.split(/\s+/);
  while (
    words.length > 1 &&
    SMALL.has(words[0]!.toLowerCase()) &&
    initialsMatch(token, words.slice(1).join(" "))
  )
    words = words.slice(1);
  return words.join(" ");
}
