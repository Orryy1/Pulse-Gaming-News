// The story-spoiler guard (SPOILER_GUARD, owner, 12 Nov 2026: "don't spoil huge moments for people early either as
// they will hate me if you did"). Every big release gets a spoiler window, from its release until SPOILER_WINDOW_DAYS
// after (4 weeks by default; GTA VI from 18 Nov 2026 until 3 Dec 2026, set by GAME_FETCH_TITLES). During a game's window:
//   - footage from beyond the opening of its story (the first SPOILER_OPENING_SHARE of the scene index's movie or
//     playthrough) is never used in a Short, a title, a thumbnail, a cover or a first frame; a long video may use it
//     only after a spoiler warning at its start, never in its first minute or its thumbnail;
//   - no writer mentions plot twists, character deaths, endings, late missions, or the characters and places the
//     scene index first meets after the opening: the writers' validators send such drafts back and the door after
//     each writer stops anything that got through;
//   - the owner's own stream clips that look like story cutscenes (the reviewer said so, letterboxed, or dialogue
//     over a letterboxed picture, or the words match a line of the scene index) are held from Shorts unless the
//     index places them in the opening. Gameplay moments (chases, stunts, crashes, physics, exploring) go on.
// "Early story free" (owner, 26 Nov 2026, for the games in SPOILER_EARLY_FREE, GTA VI by default): the hold above was
// too safe. In such a game's window chapter 1 of the story (its own index, "Chapter 1" of a cutscene series) is free
// footage everywhere and its late names are no longer held; later chapters, playthroughs and anything past the opening
// may go in Shorts and long videos wherever the reveal classifier (src/sceneindex/reveals.ts) found the moment safe.
// A big reveal (a death, a twist, a betrayal, the ending, an identity reveal), or a moment not checked yet, stays
// blocked until the window closes, and never goes in a title, a thumbnail, a cover or a video's opening.
// The rules are pure. The live windows are registered here by the server each pass (from the launch calendar,
// GAME_FETCH_TITLES and the filed games), so a validator deep inside a writer can ask without new plumbing.

import { findQuote } from "./lookup.ts";
import { baseGameOf, partNumber, sceneSlug, type SceneIndex } from "./schema.ts";
import { liveRevealBook, revealAt, revealSceneAt, type RevealBook } from "./revealbook.ts";

export interface SpoilerWindow {
  game: string;
  /** What else the game is called in a title or a line ("GTA VI", "GTA 6"). */
  aliases: string[];
  /** ISO instants: the first release anywhere, and the end of the window. */
  from: string;
  until: string;
  /** The share of the story, from its start, that counts as the opening. */
  openingShare: number;
  /** Names (characters, places) the scene index first meets after the opening: never said during the window. */
  lateTerms: string[];
  /**
   * "Early story free" (SPOILER_EARLY_FREE): chapter 1 is free and later moments the reveal classifier found safe may
   * be used; big reveals stay blocked. Unset: the whole hold as before.
   */
  earlyFree?: boolean;
}

const DAY = 86_400_000;
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

/** Other names for a game (pure): its numeral either way and its initials ("Grand Theft Auto VI" -> "GTA VI", "GTA 6", "GTA6"). */
export function gameAliases(game: string): string[] {
  const words = game
    .replace(/[:\-–]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>([game]);
  const last = words[words.length - 1]?.toLowerCase() ?? "";
  const swap = (w: string) =>
    ROMAN[w.toLowerCase()] ??
    Object.entries(ROMAN)
      .find(([, d]) => d === w)?.[0]
      ?.toUpperCase();
  const numeral =
    ROMAN[last] || /^\d+$/.test(last) ? words[words.length - 1]! : "";
  const body = numeral ? words.slice(0, -1) : words;
  if (numeral && swap(numeral)) out.add([...body, swap(numeral)!].join(" "));
  const caps = body.filter(
    (w) => /^[A-Z]/.test(w) && !/^(of|the|and)$/i.test(w),
  );
  if (caps.length >= 3) {
    const initials = caps.map((w) => w[0]).join("");
    if (numeral) {
      for (const n of [numeral, swap(numeral)].filter(Boolean) as string[]) {
        out.add(`${initials} ${n}`);
        out.add(`${initials}${n}`);
      }
    } else out.add(initials);
  }
  return [...out];
}

/**
 * A game's window (pure): from its release until `days` later. A date-only end ("2026-12-17") runs to the end of
 * that day; a date-only release starts the day before (a game is out in New Zealand while it is still the day
 * before in UTC).
 */
export function spoilerWindow(
  game: string,
  release: string,
  o: {
    days: number;
    openingShare: number;
    until?: string;
    lateTerms?: string[];
    earlyFree?: boolean;
  },
): SpoilerWindow | undefined {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(release);
  const start = Date.parse(dateOnly ? `${release}T00:00:00Z` : release);
  if (!Number.isFinite(start)) return undefined;
  const from = dateOnly ? start - DAY : start;
  let until = (dateOnly ? start + DAY : start) + o.days * DAY;
  if (o.until) {
    const u = /^\d{4}-\d{2}-\d{2}$/.test(o.until)
      ? Date.parse(`${o.until}T00:00:00Z`) + DAY
      : Date.parse(o.until);
    if (Number.isFinite(u)) until = u;
  }
  return {
    game,
    aliases: gameAliases(game),
    from: new Date(from).toISOString(),
    until: new Date(until).toISOString(),
    openingShare: Math.min(0.9, Math.max(0.01, o.openingShare)),
    lateTerms: o.lateTerms ?? [],
    ...(o.earlyFree ? { earlyFree: true } : {}),
  };
}

/** True when a game is one of SPOILER_EARLY_FREE's (pure), however it is spelt ("GTA 6" matches Grand Theft Auto VI). */
export function isEarlyFree(game: string, list: readonly string[]): boolean {
  const slugs = new Set(gameAliases(baseGameOf(game.trim())).map(sceneSlug));
  return list.some((g) => g.trim() && gameAliases(g.trim()).some((a) => slugs.has(sceneSlug(a))));
}

export function windowOpen(w: SpoilerWindow, now: Date): boolean {
  const t = now.getTime();
  return t >= Date.parse(w.from) && t < Date.parse(w.until);
}

/** The open window for a game however it is spelt ("GTA 6" finds Grand Theft Auto VI), or undefined. */
export function windowFor(
  windows: readonly SpoilerWindow[],
  game: string | undefined,
  now: Date,
): SpoilerWindow | undefined {
  if (!game?.trim()) return undefined;
  // A gameplay index or a later chapter's index ("Grand Theft Auto VI (movie 2)") is under its game's window.
  const slug = sceneSlug(baseGameOf(game.trim()));
  return windows.find(
    (w) => windowOpen(w, now) && w.aliases.some((a) => sceneSlug(a) === slug),
  );
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (term: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${esc(term)}(?![\\p{L}\\p{N}])`, "iu");

/** True when a text names the game by any of its names. */
export function mentionsGame(w: SpoilerWindow, text: string): boolean {
  return w.aliases.some((a) => wordRe(a).test(text));
}

// ---------------------------------------------------------------- the story position of footage

/**
 * True when a moment of the index's source is in the opening of the story. A source tagged as past the opening (a later
 * chapter's movie or part, src/sceneindex/movieplan.ts) has no opening at all: the whole upload is held.
 */
export function inOpening(
  index: Pick<SceneIndex, "source">,
  at: number,
  share: number,
): boolean {
  if (index.source.spoiler) return false;
  return index.source.duration > 0 && at <= index.source.duration * share;
}

/**
 * The story chapter an index's upload is (pure): its own tag, its part number ("<game> (movie 2)"), or "Chapter N" /
 * "Part N" in a movie's title. Undefined for a playthrough or a movie that is not split.
 */
export function storyChapter(index: Pick<SceneIndex, "game" | "source">): number | undefined {
  if (index.source.kind !== "movie") return undefined;
  if (index.source.chapter && index.source.chapter > 0) return index.source.chapter;
  const part = partNumber(index.game);
  if (part > 1) return part;
  const m = /\b(?:chapter|part|pt\.?)\s*#?\s*(\d{1,2})\b/i.exec(index.source.title);
  return m ? Number(m[1]) : undefined;
}

/** True when the whole index is free story footage (pure): chapter 1 of a split story, in an early-free window. */
export function freeChapter(w: SpoilerWindow | undefined, index: Pick<SceneIndex, "game" | "source">): boolean {
  return Boolean(w?.earlyFree) && !index.source.spoiler && storyChapter(index) === 1;
}

/**
 * The names the index first meets after the opening (pure): cast and places (and the names its shots carry) whose
 * earliest appearance, in a shot's people, place, description or writing or in a line's words or speaker, is past
 * the opening. A name seen in the opening is not late; a name never seen is unknown and left out; the game's own
 * name never counts.
 */
/** One-word names never treated as late-story spoilers: words of other games' titles and everyday words. */
const COMMON_WORDS = new Set("breath wild kingdom tears world light dark shadow time ocean sword shield link master temple forest fire water spirit sky king queen princess lord dawn night".split(" "));

export function lateTerms(index: SceneIndex, share: number, o: { earlyFree?: boolean } = {}): string[] {
  // Early story free: chapter 1 is all free, so nothing in it is a late name.
  if (o.earlyFree && freeChapter({ earlyFree: true } as SpoilerWindow, index)) return [];
  const cut = index.source.duration * share;
  const names = new Set<string>([...index.cast, ...index.places]);
  for (const s of index.shots) {
    s.who.forEach((n) => names.add(n));
    if (s.where) names.add(s.where);
  }
  const game = gameAliases(index.game).map((a) => a.toLowerCase());
  // Ordinary words the index took for names ("Breath", "Wild" from Breath of the Wild): a one-word name the game's own
  // dialogue also uses in lower case is a common word, not a late-story name (12 Nov 2026: they blocked an Ocarina Short).
  const lower = new Set<string>();
  for (const l of index.lines)
    for (const w of l.text.match(/\b[a-z][a-z'-]+\b/g) ?? []) lower.add(w);
  const out: string[] = [];
  for (const name of names) {
    const n = name.trim();
    if (n.length < 3 || game.some((g) => g.includes(n.toLowerCase()))) continue;
    if (!/s/.test(n) && (lower.has(n.toLowerCase()) || COMMON_WORDS.has(n.toLowerCase()))) continue;
    const re = wordRe(n);
    let first = Infinity;
    for (const s of index.shots) {
      if (s.start >= first) break;
      if (
        s.who.includes(n) ||
        s.where === n ||
        re.test(s.desc) ||
        re.test(s.text)
      )
        first = s.start;
    }
    for (const l of index.lines) {
      if (l.start >= first) break;
      if ((l.speaker === n && !l.speakerGuessed) || re.test(l.text))
        first = l.start;
    }
    if (Number.isFinite(first) && first > cut) out.push(n);
  }
  return out.sort();
}

// ---------------------------------------------------------------- words

/** Story-spoiling phrases: each with what it gives away, for the writer's note. */
export const SPOILER_PHRASES: Array<[RegExp, string]> = [
  [
    /\b(?:the|its|true|secret|final|real|alternate|good|bad|both|every|each|multiple)\s+endings?\b/i,
    "the ending",
  ],
  [
    /\bendings?\s+(?:explained|revealed|scene)\b|\bhow\s+(?:it|the\s+story|the\s+game|everything)\s+ends\b/i,
    "the ending",
  ],
  [
    /\bpost[-\s]credits?\b|\bepilogue\b|\bcredits\s+roll\b|\bafter\s+the\s+credits\b/i,
    "the ending",
  ],
  [
    /\bplot\s+twists?\b|\btwist\s+ending\b|\bthe\s+(?:big\s+|final\s+|shock(?:ing)?\s+)?twist\b|\bturns\s+out\s+to\s+be\b|\breal\s+identity\b|\bsecretly\s+(?:was|is|been)\b/i,
    "a plot twist",
  ],
  [/\bbetray(?:s|ed|al)\b|\bdouble[-\s]cross(?:es|ed)?\b/i, "a plot twist"],
  [
    /\b(?:dies|died|death\s+of|is\s+killed|gets\s+killed|was\s+killed|killed\s+off|murdered|sacrifices?\s+(?:him|her|them)sel(?:f|ves)|doesn'?t\s+make\s+it|does\s+not\s+survive|final\s+moments)\b/i,
    "a character's death",
  ],
  [
    /\b(?:final|last|late[-\s]game|endgame|end[-\s]game)\s+(?:mission|missions|chapter|act|boss|heist|scene|cutscene|showdown|level|area)\b/i,
    "a late mission",
  ],
  [
    /\b(?:last|final)\s+(?:hour|hours|third|act)\s+of\s+the\s+(?:story|game|campaign)\b|\bby\s+the\s+end\s+of\s+the\s+(?:story|game|campaign)\b/i,
    "a late part of the story",
  ],
];

/**
 * Early story free only: identity reveals and "who dies" questions, looked for besides SPOILER_PHRASES in an early-free
 * window (its late names are no longer held there), so other games' checks stay exactly as they were.
 */
export const EARLY_FREE_PHRASES: Array<[RegExp, string]> = [
  [
    /\bundercover\s+(?:cop|agent|fed)\b|\b(?:was|is)\s+(?:secretly\s+)?(?:an?\s+)?(?:informant|snitch|mole)\b|\bwho\s+(?:dies|betrays)\b/i,
    "a plot twist",
  ],
];

/** The phrases a window's checks look for (pure). */
const phrasesFor = (w: SpoilerWindow) => (w.earlyFree ? [...SPOILER_PHRASES, ...EARLY_FREE_PHRASES] : SPOILER_PHRASES);

export interface SpoilerHit {
  game: string;
  /** The words that give it away. */
  phrase: string;
  what: string;
}

/**
 * The spoilers in a text (pure). Only open windows count, and only for a text about that game: one that names it,
 * or any text when the caller says the video is about it (`about`). Then the spoiling phrases and the game's late
 * names are looked for. Quotations of the game's own pre-release marketing are not exempt: a viewer cannot tell.
 */
export function spoilerHits(
  text: string,
  windows: readonly SpoilerWindow[],
  now: Date,
  about: Array<string | undefined> = [],
): SpoilerHit[] {
  if (!text.trim()) return [];
  const out: SpoilerHit[] = [];
  for (const w of windows) {
    if (!windowOpen(w, now)) continue;
    const relevant =
      about.some((g) => g && windowFor([w], g, now)) || mentionsGame(w, text);
    if (!relevant) continue;
    for (const [re, what] of phrasesFor(w)) {
      const m = text.match(re);
      if (m) out.push({ game: w.game, phrase: m[0], what });
    }
    for (const term of w.lateTerms) {
      const m = text.match(wordRe(term));
      if (m)
        out.push({
          game: w.game,
          phrase: m[0],
          what: "a character or place from late in the story",
        });
    }
  }
  return out;
}

/** Hits as instructions a rewrite can follow, for the writers' own validators. Empty when clean. */
export function spoilerNotes(hits: readonly SpoilerHit[]): string[] {
  return hits
    .slice(0, 6)
    .map(
      (h) =>
        `"${h.phrase}" gives away ${h.what} of ${h.game}, which has just come out: nobody may be spoiled during its first weeks. Leave out twists, deaths, endings, late missions and late characters or places; talk about the opening hours, the world and how it plays instead.`,
    );
}

// ---------------------------------------------------------------- footage

export type FootageUse =
  | "short"
  | "long"
  | "title"
  | "thumbnail"
  | "cover"
  | "first-frame";

/** Seconds into a long video before late-story footage may appear, after its spoiler warning. */
export const LONG_SPOILER_FREE_SECONDS = 60;


/**
 * Whether a moment of the index's source may be used (pure). Outside the window anything goes. Inside it the
 * opening may be used anywhere except a shot whose own words (its description, writing or dialogue) spoil;
 * later footage only in a long video that warned at its start, placed after its first minute. `placedAt` unknown
 * counts as the first minute.
 */
export function footageAllowed(
  w: SpoilerWindow | undefined,
  index: SceneIndex,
  at: number,
  use: FootageUse,
  now: Date,
  o: { warned?: boolean; placedAt?: number; book?: RevealBook | null } = {},
): { ok: boolean; reason: string } {
  if (!w || !windowOpen(w, now))
    return { ok: true, reason: "no spoiler window" };
  const shot = index.shots.find((s) => at >= s.start && at < s.end);
  const words = [
    shot?.desc ?? "",
    shot?.text ?? "",
    ...index.lines
      .filter((l) => shot && l.start < shot.end && l.end > shot.start)
      .map((l) => l.text),
  ].join(". ");
  const spoils = phrasesFor(w).some(([re]) => re.test(words));
  if (w.earlyFree) return earlyFreeAllowed(w, index, at, use, spoils, o);
  if (inOpening(index, at, w.openingShare) && !spoils)
    return { ok: true, reason: "the opening of the story" };
  if (
    use === "long" &&
    o.warned &&
    (o.placedAt ?? 0) >= LONG_SPOILER_FREE_SECONDS
  )
    return {
      ok: true,
      reason: "late story, after the spoiler warning and the first minute",
    };
  return {
    ok: false,
    reason: spoils
      ? "the shot's own words spoil the story"
      : `beyond the opening ${Math.round(w.openingShare * 100)}% of the story`,
  };
}

/**
 * footageAllowed in an early-free window (pure). Only a long video's body (after its first minute) is out of a viewer's
 * first sight; a Short's every second can open it or become its thumbnail (its stills and cards are cleared as
 * "short"), so a Short, a first frame, a title, a thumbnail, a cover and a long video's first minute all count as an
 * opening. Chapter 1: a moment the reveal check found safe goes anywhere; a reveal (tagged, or the shot's own words)
 * or a moment not checked yet only in a long video's body, or in the opening share as before. Anything else: the
 * opening share as before, then any moment the reveal check found safe; a reveal or an unchecked moment waits.
 */
function earlyFreeAllowed(
  w: SpoilerWindow,
  index: SceneIndex,
  at: number,
  use: FootageUse,
  spoils: boolean,
  o: { placedAt?: number; book?: RevealBook | null },
): { ok: boolean; reason: string } {
  const book = o.book === undefined ? liveRevealBook(index.game) : (o.book ?? undefined);
  const tagged = revealAt(book, index, at);
  const until = w.until.slice(0, 10);
  const body = use === "long" && (o.placedAt ?? 0) >= LONG_SPOILER_FREE_SECONDS;
  const reveal = spoils || tagged === true;
  const kind = revealSceneAt(book, index, at)?.kind;
  if (!reveal && tagged === false) return { ok: true, reason: "a story moment the reveal check found safe" };
  if (!reveal && !index.source.spoiler && inOpening(index, at, w.openingShare))
    return { ok: true, reason: "the opening of the story" };
  if (freeChapter(w, index)) {
    if (body) return { ok: true, reason: reveal ? "a chapter 1 reveal, in a long video's body" : "chapter 1 of the story" };
    return {
      ok: false,
      reason: reveal
        ? "a big reveal: never in a Short, a title, a thumbnail or a video's opening"
        : "chapter 1, not checked for reveals here yet: only a long video's body may use it",
    };
  }
  return {
    ok: false,
    reason: spoils
      ? "the shot's own words spoil the story"
      : tagged === true
        ? `a big reveal${kind ? ` (${kind})` : ""} or a moment not checked yet: held until ${until}`
        : `not checked for reveals yet: held until ${until}`,
  };
}

/** A long video's spoiler warning: in its first two lines, the word spoiler with a warning around it. */
export function hasSpoilerWarning(lines: Array<string | undefined>): boolean {
  return lines
    .slice(0, 2)
    .some(
      (l) =>
        /\bspoilers?\b/i.test(l ?? "") &&
        /\b(warning|ahead|from here|heads[-\s]up|alert|skip|story)\b/i.test(
          l ?? "",
        ) &&
        !/\bspoiler[-\s]free\b|\bno\s+(story\s+|plot\s+)?spoilers\b|\bwithout\s+(any\s+)?(story\s+)?spoilers\b/i.test(l ?? ""),
    );
}

// ---------------------------------------------------------------- the owner's stream clips

/**
 * Where in the story a stream clip's words are (pure): the latest index moment any eight-word run of its transcript
 * matches closely, or undefined when none does (a gameplay moment, or a scene not indexed yet).
 */
export function clipStoryMoment(
  index: SceneIndex,
  transcript: string,
): number | undefined {
  const words = transcript.split(/\s+/).filter(Boolean);
  let latest: number | undefined;
  for (let i = 0; i + 6 <= Math.max(words.length, 6); i += 4) {
    const run = words.slice(i, i + 8).join(" ");
    if (run.split(" ").length < 5) break;
    const hit = findQuote(index, run, { max: 1, minConfidence: 0.8 })[0];
    if (hit) latest = Math.max(latest ?? 0, hit.start);
  }
  return latest;
}

export interface StreamClipSignals {
  /** The reviewer's own "this shows a story cutscene or a mission's plot". */
  reviewSpoiler?: boolean;
  /** 0-1: the share of the clip someone is speaking (Whisper's word timings or Sound Analysis). */
  speechShare?: number;
  /** 0-1: the share of sampled frames with cinema bars. */
  letterboxShare?: number;
  /** Where the clip's words fall in the scene index's source, when they match a line. */
  storyAt?: number;
  /** Early story free: whether that moment is a big reveal (the index's reveal book when unset; unchecked: held). */
  reveal?: boolean;
  /** Early story free: the local vision model's look at the clip's frames found no reveal (false) or one (true). */
  framesReveal?: boolean;
}

/**
 * Whether one of the owner's stream clips is held from Shorts (pure). Outside the window: never. Inside it a clip
 * that looks like a story cutscene (the reviewer says so, cinema bars on most frames, talk over bars on some, or its
 * words are a scene's line) is held unless the scene index places those words in the opening.
 */
export function streamClipHold(
  w: SpoilerWindow | undefined,
  index: SceneIndex | undefined,
  c: StreamClipSignals,
  now: Date,
): { hold: boolean; reason: string } {
  if (!w || !windowOpen(w, now))
    return { hold: false, reason: "no spoiler window" };
  const bars = c.letterboxShare ?? 0;
  const talk = c.speechShare ?? 0;
  const matched = c.storyAt !== undefined;
  const cutscene =
    Boolean(c.reviewSpoiler) ||
    bars >= 0.5 ||
    (talk >= 0.5 && bars >= 0.2) ||
    matched;
  if (!cutscene) return { hold: false, reason: "a gameplay moment" };
  if (w.earlyFree) {
    const reveal = matched && index ? (c.reveal ?? revealAt(liveRevealBook(index.game), index, c.storyAt!)) : undefined;
    // A clip is a whole Short (its opening too): only a moment checked safe, or the opening share, goes on.
    if (matched && reveal === false) return { hold: false, reason: "a story moment the reveal check found safe" };
    if (matched && index && freeChapter(w, index) && reveal === undefined && inOpening(index, c.storyAt!, w.openingShare))
      return { hold: false, reason: "a cutscene from the opening of chapter 1" };
    if (reveal === true) return { hold: true, reason: "a big reveal: held until the spoiler window closes" };
    if (!matched && c.framesReveal === false && !c.reviewSpoiler)
      return { hold: false, reason: "a story scene whose frames show no reveal" };
  }
  if (matched && index && inOpening(index, c.storyAt!, w.openingShare))
    return { hold: false, reason: "a cutscene from the opening of the story" };
  return {
    hold: true,
    reason: matched
      ? "a story cutscene from beyond the opening"
      : c.reviewSpoiler
        ? "the reviewer saw a story cutscene"
        : "looks like a story cutscene (cinema bars or dialogue)",
  };
}

// ---------------------------------------------------------------- the live windows

let live: SpoilerWindow[] = [];

/** The server's latest windows (SPOILER_GUARD on); an empty list turns every check here into a pass. */
export function setSpoilerWindows(windows: SpoilerWindow[]): void {
  live = windows;
}

export function spoilerWindows(): readonly SpoilerWindow[] {
  return live;
}

/** For the writers' validators: spoilers in a text against the live windows, as instructions. */
export function spoilerProblems(
  text: string,
  now = new Date(),
  about: Array<string | undefined> = [],
): string[] {
  return live.length ? spoilerNotes(spoilerHits(text, live, now, about)) : [];
}
