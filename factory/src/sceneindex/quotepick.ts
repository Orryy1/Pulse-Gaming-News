// Character quotes (CHARACTER_QUOTES, owner, 12 Nov 2026, after the hand-made Deku Tree demo): the narrator sets up a
// moment, one real line plays in the game's own voice with its cutscene, and the narrator answers it. This file is
// the pure half of choosing that line from the game's scene index (src/sceneindex/schema.ts):
//   quoteCandidates: the lines a script could use, best fit first: voiced (heard by Whisper, with word timings), said
//                    by a named character the game itself names (never a guessed speaker, never the game's own
//                    narrator), one short complete sentence, advertiser-safe, and inside the story's opening while
//                    the game's spoiler window is open (SPOILER_GUARD);
//   verifyQuote:     the exact words, checked again against the index after the writer has used them;
//   quoteSpan:       the stretch of the source to play, from just before the first word to just after the last,
//                    never into the line before or after;
//   quietCut:        a cut point moved onto the quietest moment near it (a clean cut at silence).
// The writer is never trusted with the words: it picks a quote by ID and the text played and captioned is the
// index's own.

import { advertiserProblems } from "../editorial/voice.ts";
import { findQuote, stem, tokens } from "./lookup.ts";
import type { DialogueLine, SceneIndex } from "./schema.ts";
import {
  footageAllowed,
  gameAliases,
  type FootageUse,
  type SpoilerWindow,
} from "./spoilers.ts";

/** One line a script may quote: the index's exact words, who says them and where they are in the source. */
export interface QuoteCandidate {
  /** Stable across rebuilds of the same source: "q" and the line's start in tenths of a second. */
  id: string;
  game: string;
  videoId: string;
  sourceTitle: string;
  uploader: string;
  /** The index's line number (renumbered on rebuilds: the ID is what stays). */
  line: number;
  text: string;
  speaker: string;
  /** Seconds into the source of the first and last spoken word (Whisper's timings). */
  start: number;
  end: number;
  /** How well the line fits the story (0 when it only fills the list), and the story words it shares. */
  score: number;
  matched: string[];
  fit: "story" | "general";
}

/** A quote longer than this is a speech, not a line: a Short has no room for it. */
export const QUOTE_MAX_SECONDS = 7.5;
export const QUOTE_MIN_SECONDS = 0.8;
export const QUOTE_MIN_WORDS = 3;
export const QUOTE_MAX_WORDS = 18;

/** Violence, gore and slurs: never played, whatever the story (advertiser-friendly, as every caption). */
const UNSAFE_QUOTE =
  /\b(?:kill\w*|murder\w*|slay\w*|slain|slaughter\w*|blood\w*|gore|gory|guts|wounds?|stab\w*|shoot\w*|gunfire|tortur\w*|execut\w*|rape\w*|suicid\w*|die|dies|died|dying|dead|death|corpse\w*|weapon\w*|war|violence|violent|fuck\w*|shit\w*|bitch\w*|bastard\w*|damn\w*|hell|nigg\w*|fagg\w*|retard\w*)\b/i;

const plainWords = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** The spoken span of a line: its first and last timed word. */
function spoken(
  line: DialogueLine,
): { start: number; end: number } | undefined {
  const w = line.words ?? [];
  if (!w.length) return undefined;
  return { start: w[0]!.start, end: w[w.length - 1]!.end };
}

/**
 * Why a line cannot be quoted, or undefined when it can (pure). The voice must be heard and timed: a line only read
 * off a text box has no sound to play. The heard words must agree with the line (Whisper's "Vig" for "Link" is
 * fine; a timing that belongs to another line is not).
 */
export function unquotable(
  index: SceneIndex,
  line: DialogueLine,
): string | undefined {
  if (line.via === "textbox") return "read off the screen, never heard";
  const span = spoken(line);
  if (!span) return "no word timings";
  if (!line.speaker) return "no speaker";
  if (line.speakerGuessed) return "speaker guessed from the picture";
  if (/^(?:narrator|narration|unknown|voice)$/i.test(line.speaker.trim()))
    return "the game's own narrator";
  const text = line.text.trim();
  const n = plainWords(text).length;
  if (n < QUOTE_MIN_WORDS || n > QUOTE_MAX_WORDS) return `${n} words`;
  if (!/[.!?]["'”’]?$/.test(text) || /(?:\.\.\.|…)["'”’]?$/.test(text))
    return "not a finished sentence";
  if (/^(?:\.\.\.|…)/.test(text)) return "starts mid-sentence";
  if (/[[\]<>{}]/.test(text)) return "markup in the line";
  const seconds = span.end - span.start;
  if (seconds < QUOTE_MIN_SECONDS || seconds > QUOTE_MAX_SECONDS)
    return `${seconds.toFixed(1)} s long`;
  if (UNSAFE_QUOTE.test(text) || advertiserProblems(text).length)
    return "not advertiser-safe";
  const shot = index.shots[line.shot];
  if (shot && (shot.blank || shot.menu)) return "a blank or menu picture";
  const heard = new Set((line.words ?? []).flatMap((w) => plainWords(w.text)));
  const said = plainWords(text);
  const agree =
    said.filter((w) => heard.has(w)).length / Math.max(1, said.length);
  if (agree < 0.6) return "the heard words do not match the line";
  return undefined;
}

export interface QuoteCandidateOptions {
  /** At most this many candidates (default 10). */
  max?: number;
  /** Story candidates need at least this score (default 1). */
  minScore?: number;
  /** Lines that only fill the list when too few fit the story (default: up to max). 0 for story fits only. */
  general?: number;
  /** SPOILER_GUARD: the game's open window, if any; with `now`, `use` and the long video's warning. */
  window?: SpoilerWindow;
  now?: Date;
  use?: FootageUse;
  warned?: boolean;
  placedAt?: number;
}

/** Story words that never tell a line apart: the game's own name, and words every script uses. */
const GENERIC = new Set(
  "game games play player players remake remaster version new year years time week day today now fan fans"
    .split(" ")
    .map(stem),
);

/** Words that mean the same thing in a story and a line ("sprint" in the script, "run" in the line). */
const NEAR: string[][] = [
  [
    "go",
    "travel",
    "journey",
    "walk",
    "run",
    "sprint",
    "ride",
    "head",
    "leav",
    "move",
  ],
  ["look", "see", "wonder", "explor", "discover", "find", "search"],
  ["help", "assist", "aid", "save", "rescu"],
  ["hurry", "quick", "fast", "rush", "speed"],
  ["wake", "awak", "sleep", "dream", "nightmar"],
  ["forest", "wood", "tree"],
  ["hors", "ride", "rid", "gallop"],
  ["song", "music", "play", "ocarina", "melody"],
  ["danger", "trial", "challeng", "hard", "difficult"],
  ["friend", "brother", "companion", "partner"],
];
const NEAR_OF = new Map<string, string[]>();
for (const group of NEAR)
  for (const w of group.map(stem))
    NEAR_OF.set(w, [
      ...(NEAR_OF.get(w) ?? []),
      ...group.map(stem).filter((x) => x !== w),
    ]);

/**
 * The lines a script about the game could quote, best fit first (pure). The fit is the story words a line shares
 * (its words or its speaker's name; names count most, words rare in the game count more, a near word counts a
 * little), so a quote is offered because the script talks about what it says. When too few fit, a spread of the
 * other quotable lines fills the list, marked "general": the writer may still decline every one.
 */
export function quoteCandidates(
  index: SceneIndex,
  storyText: string,
  o: QuoteCandidateOptions = {},
): QuoteCandidate[] {
  const max = o.max ?? 10;
  const minScore = o.minScore ?? 1;
  const now = o.now ?? new Date();
  const own = new Set(gameAliases(index.game).flatMap(tokens));
  const eligible = index.lines.filter((line) => {
    if (unquotable(index, line)) return false;
    if (!o.window) return true;
    const span = spoken(line)!;
    const use = o.use ?? "short";
    const opts = { warned: o.warned, placedAt: o.placedAt };
    return (
      footageAllowed(o.window, index, span.start, use, now, opts).ok &&
      footageAllowed(o.window, index, span.end, use, now, opts).ok
    );
  });
  if (!eligible.length) return [];
  const names = new Set<string>();
  for (const n of [...index.cast, ...index.places])
    for (const t of tokens(n)) names.add(t);
  for (const l of index.lines)
    if (l.speaker) for (const t of tokens(l.speaker)) names.add(t);
  const terms = [...new Set(tokens(storyText))].filter(
    (t) => t.length > 1 && !own.has(t) && !GENERIC.has(t),
  );
  // How rare each word is across the game's lines: "Epona" narrows, "Link" does not.
  const docs = index.lines.map(
    (l) =>
      new Set([...tokens(l.text), ...(l.speaker ? tokens(l.speaker) : [])]),
  );
  const idf = (t: string) => {
    let df = 0;
    for (const d of docs) if (d.has(t)) df++;
    return Math.log(1 + docs.length / (1 + df));
  };
  const weight = new Map(
    terms.map((t) => [t, idf(t) * (names.has(t) ? 2.5 : 1)]),
  );
  const seen = new Set<string>();
  const scored: QuoteCandidate[] = [];
  for (const line of eligible) {
    const key = plainWords(line.text).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    const said = new Set(tokens(line.text));
    const who = new Set(tokens(line.speaker!));
    let score = 0;
    const matched: string[] = [];
    // A near word in the line counts once, for the best story word it stands for ("go" for "travel" or "sprint").
    const near = new Map<string, { t: string; w: number }>();
    for (const t of terms) {
      if (said.has(t) || who.has(t)) {
        score += weight.get(t)!;
        matched.push(t);
        continue;
      }
      for (const x of NEAR_OF.get(t) ?? [])
        if (said.has(x) && (near.get(x)?.w ?? 0) < weight.get(t)!)
          near.set(x, { t, w: weight.get(t)! });
    }
    for (const { t, w } of near.values()) {
      score += 0.6 * w;
      if (!matched.includes(t)) matched.push(t);
    }
    const span = spoken(line)!;
    scored.push({
      id: `q${Math.round(line.start * 10)}`,
      game: index.game,
      videoId: index.source.videoId,
      sourceTitle: index.source.title,
      uploader: index.source.uploader,
      line: line.id,
      text: line.text.trim(),
      speaker: line.speaker!.trim(),
      start: span.start,
      end: span.end,
      score: Math.round(score * 100) / 100,
      matched,
      fit: score >= minScore ? "story" : "general",
    });
  }
  const story = scored
    .filter((c) => c.fit === "story")
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, max);
  const room = Math.min(max - story.length, o.general ?? max);
  if (room <= 0) return story;
  // The rest spread across the allowed story, the most-heard characters first within each stretch.
  const rest = scored
    .filter((c) => c.fit === "general")
    .map((c) => ({ ...c, score: 0, matched: [] }));
  const voiced = new Map<string, number>();
  for (const l of index.lines)
    if (l.speaker && l.via !== "textbox")
      voiced.set(l.speaker, (voiced.get(l.speaker) ?? 0) + 1);
  const general: QuoteCandidate[] = [];
  if (rest.length) {
    const step = rest.length / room;
    for (let k = 0; k < room && k * step < rest.length; k++) {
      const stretch = rest.slice(
        Math.floor(k * step),
        Math.max(Math.floor(k * step) + 1, Math.floor((k + 1) * step)),
      );
      const pick = [...stretch].sort(
        (a, b) =>
          (voiced.get(b.speaker) ?? 0) - (voiced.get(a.speaker) ?? 0) ||
          a.start - b.start,
      )[0];
      if (pick && !general.includes(pick)) general.push(pick);
    }
  }
  return [...story, ...general];
}

/**
 * Whether a quote a writer used is the index's own line, word for word (pure): the line with its ID still says
 * exactly that, and looking the words up finds that line with full confidence. Run after every rewrite.
 */
export function verifyQuote(
  index: SceneIndex,
  q: Pick<QuoteCandidate, "id" | "text" | "speaker" | "videoId">,
): { ok: boolean; reason: string; line?: DialogueLine } {
  if (index.source.videoId !== q.videoId)
    return { ok: false, reason: "the index was rebuilt from another upload" };
  const line = index.lines.find((l) => `q${Math.round(l.start * 10)}` === q.id);
  if (!line) return { ok: false, reason: `no line ${q.id} in the index` };
  if (line.text.trim() !== q.text.trim())
    return { ok: false, reason: "the words differ from the index's line" };
  if ((line.speaker ?? "").trim() !== q.speaker.trim())
    return { ok: false, reason: "another speaker says it" };
  const why = unquotable(index, line);
  if (why) return { ok: false, reason: why };
  const hit = findQuote(index, q.text, { speaker: q.speaker, max: 1 })[0];
  if (!hit || hit.confidence < 1 || !hit.lines.includes(line.id))
    return {
      ok: false,
      reason: "the words are not found exactly in the index",
    };
  return { ok: true, reason: "exact", line };
}

/** Lead-in before the first word and tail after the last, and the gap kept from a neighbouring line. */
export const QUOTE_PAD_IN = 0.3;
export const QUOTE_PAD_OUT = 0.45;
export const QUOTE_NEIGHBOUR_GUARD = 0.12;

/**
 * The stretch of the source a quote plays (pure): its spoken words with a short lead-in and tail, cut short of the
 * line before and the line after so nobody else's voice comes in. Seconds into the source.
 */
export function quoteSpan(
  index: SceneIndex,
  line: DialogueLine,
): { from: number; to: number; wordsFrom: number; wordsTo: number } {
  const span = spoken(line) ?? { start: line.start, end: line.end };
  const before = index.lines
    .filter(
      (l) =>
        l.id !== line.id && l.end <= span.start + 0.05 && l.via !== "textbox",
    )
    .at(-1);
  const after = index.lines.find(
    (l) =>
      l.id !== line.id && l.start >= span.end - 0.05 && l.via !== "textbox",
  );
  const prevEnd = before ? (spoken(before)?.end ?? before.end) : -Infinity;
  const nextStart = after ? (spoken(after)?.start ?? after.start) : Infinity;
  const from = Math.max(
    0,
    span.start - QUOTE_PAD_IN,
    prevEnd + QUOTE_NEIGHBOUR_GUARD,
  );
  const to = Math.min(
    index.source.duration || Infinity,
    span.end + QUOTE_PAD_OUT,
    nextStart - QUOTE_NEIGHBOUR_GUARD,
  );
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    from: r(Math.min(from, span.start)),
    to: r(Math.max(to, span.end)),
    wordsFrom: r(span.start),
    wordsTo: r(span.end),
  };
}

/**
 * A cut point moved onto the quietest moment between `lo` and `hi` seconds (pure): `envelope` is the loudness in
 * dB of each `step` seconds of audio from the section's start. Ties go to the point nearest `prefer`. Returns
 * `prefer` when the window holds no measurement.
 */
export function quietCut(
  envelope: readonly number[],
  step: number,
  lo: number,
  hi: number,
  prefer: number,
): number {
  let best = prefer;
  let bestDb = Infinity;
  const a = Math.max(0, Math.ceil(lo / step));
  const b = Math.min(envelope.length - 1, Math.floor(hi / step));
  for (let i = a; i <= b; i++) {
    const db = envelope[i]!;
    const t = i * step + step / 2;
    if (
      db < bestDb - 0.5 ||
      (Math.abs(db - bestDb) <= 0.5 &&
        Math.abs(t - prefer) < Math.abs(best - prefer))
    ) {
      best = t;
      bestDb = Math.min(bestDb, db);
    }
  }
  return Math.round(best * 1000) / 1000;
}
