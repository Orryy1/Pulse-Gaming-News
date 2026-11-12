// Looking a moment up in a game's scene index (pure, no model call, no network):
//   findShots: a footage target (a narration line and its keywords) -> the shots that show it, best first, each
//              with its start, end and a confidence from 0 to 1;
//   findQuote: a quoted line -> the exact dialogue line (or the two consecutive lines it runs across), with the
//              start and end of the words asked for when the voice gives word timings.
// Ranking is by the words a target shares with what is known about a shot: who is in it, where it is, what
// happens, the writing on screen and the dialogue said during it. Names count most ("Ganondorf", "Master Sword",
// "Hyrule Castle": a shot without the named character is rarely the moment), rare words count more than common
// ones, and a shot borrows a little from its neighbours, because a scene's close-up of a hand on a sword hilt
// belongs to "Link draws the Master Sword" even though the close-up alone shows neither name.

import type { DialogueLine, SceneIndex, SceneShot } from "./schema.ts";

const STOP = new Set(
  "a an the and or but of in on at to for from by with as is are was were be been being it its this that these those he she they them his her their you your we our i me my not no so do does did has have had will would can could should than then there here over under into out up down off about after before again just very also only when while where who whom which what why how all any each every some more most other such own same too s t".split(
    " ",
  ),
);

/** A word as it is compared: lower case, plural and tense endings off ("rises", "rising", "rose" stay close enough). */
export function stem(word: string): string {
  let w = word
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4 && /(s|x|z|ch|sh)es$/.test(w))
    w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3)
    w = w.slice(0, -1);
  // "rise" and "rising", "raise" and "raised" meet on the form without a final e.
  if (w.endsWith("e") && w.length > 4) w = w.slice(0, -1);
  // Doubled consonant left by "-ing"/"-ed": "grabb" -> "grab".
  if (/([bdgmnprt])\1$/.test(w) && w.length > 4) w = w.slice(0, -1);
  return w;
}

/** The telling words of a text, stemmed, in order, without the common ones. */
export function tokens(text: string): string[] {
  return text
    .replace(/['’]s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.toLowerCase())
    .filter((w) => w && !STOP.has(w))
    .map(stem)
    .filter(Boolean);
}

/** Words that mean the same picture: a target says "draws", the description says "pulls". Stemmed both ways. */
const SAME: string[][] = [
  ["draw", "pull", "unsheath", "lift", "remov", "tak", "grab"],
  ["ris", "ascend", "float", "hover", "emerg", "loom", "tower", "appear"],
  ["castl", "fortres", "palac", "tower", "keep"],
  ["sword", "blad"],
  ["fall", "collaps", "crumbl", "tumbl", "drop"],
  ["fight", "battl", "duel", "attack", "clash", "strik"],
  ["rid", "gallop", "horseback"],
  ["hors", "steed", "mare", "stallion"],
  ["run", "sprint", "flee", "escap", "chas"],
  ["cry", "weep", "tear", "sob"],
  ["smil", "grin", "laugh"],
  ["burn", "fire", "flam", "blaz"],
  ["dark", "shadow", "night", "gloom"],
  ["king", "ruler", "lord"],
  ["princes", "royal"],
  ["open", "unlock", "reveal"],
  ["hold", "rais", "wield", "carry"],
  ["look", "gaz", "star", "watch"],
  ["speak", "talk", "say", "tell"],
  ["die", "dead", "death", "kill", "slain", "defeat"],
  ["fly", "soar", "glid"],
  ["car", "vehicl", "sedan", "truck"],
  ["gun", "pistol", "rifl", "weapon", "shoot", "fir"],
];
const SAME_OF = new Map<string, string[]>();
for (const group of SAME)
  for (const w of group)
    SAME_OF.set(w, [
      ...(SAME_OF.get(w) ?? []),
      ...group.filter((x) => x !== w),
    ]);

interface ShotDoc {
  who: Set<string>;
  where: Set<string>;
  seen: Set<string>; // description, tags, writing on screen
  said: Set<string>; // dialogue during the shot and its speakers
}

function shotDocs(index: SceneIndex): ShotDoc[] {
  const docs = index.shots.map((s) => ({
    who: new Set(s.who.flatMap(tokens)),
    where: new Set(tokens(s.where)),
    seen: new Set([
      ...tokens(s.desc),
      ...s.tags.flatMap(tokens),
      ...tokens(s.text),
      ...tokens(s.mood),
    ]),
    said: new Set<string>(),
  }));
  for (const line of index.lines) {
    // A line belongs to every shot it is on screen during.
    for (
      let i = line.shot;
      i < index.shots.length && index.shots[i]!.start < line.end;
      i++
    ) {
      const d = docs[i];
      if (!d) break;
      for (const t of tokens(line.text)) d.said.add(t);
      // The speaker is on screen or at least in the scene: weaker than being seen, stronger than being mentioned.
      if (line.speaker) for (const t of tokens(line.speaker)) d.who.add(t);
    }
  }
  return docs;
}

export interface ShotTarget {
  text: string;
  keywords?: string[];
}

export interface ShotHit {
  shot: number;
  start: number;
  end: number;
  /** 0 to 1: the share of what the target names that the shot (and a little, its neighbours) is known to show. */
  confidence: number;
  score: number;
  /** The target's words the shot matched, for the log and the contact sheet. */
  matched: string[];
  desc: string;
}

export interface FindShotsOptions {
  max?: number;
  /** Hits closer together than this many seconds are one moment: the best is kept. */
  spacing?: number;
  /** Shots shorter than this cannot carry a line: left out. */
  minSeconds?: number;
  minConfidence?: number;
  /** Only shots inside this stretch of the source, in seconds (a retrospective's story act). */
  within?: { from: number; to: number };
}

/**
 * The act's own shot nearest a place in it (pure): `at` 0 to 1 across [from, to), clean and long enough to carry a line.
 * For a story line whose words name nothing the index knows, the scene at the same point of the story still shows it.
 */
export function shotAtPlace(
  index: SceneIndex,
  within: { from: number; to: number; at?: number },
  minSeconds = 0,
): number | undefined {
  const at = within.from + Math.min(1, Math.max(0, within.at ?? 0.5)) * (within.to - within.from);
  let best: { id: number; d: number } | undefined;
  for (const s of index.shots) {
    if (s.blank || s.menu || s.start < within.from || s.end > within.to) continue;
    if (s.end - s.start < minSeconds) continue;
    const d = Math.abs((s.start + s.end) / 2 - at);
    if (!best || d < best.d) best = { id: s.id, d };
  }
  return best?.id;
}

/** Every stemmed word of the game's cast and place names: a target word among them is a name. */
function nameWords(index: SceneIndex): Set<string> {
  const out = new Set<string>();
  for (const name of [...index.cast, ...index.places])
    for (const t of tokens(name)) out.add(t);
  for (const s of index.shots) {
    for (const w of s.who) for (const t of tokens(w)) out.add(t);
  }
  for (const l of index.lines)
    if (l.speaker) for (const t of tokens(l.speaker)) out.add(t);
  return out;
}

const FIELD = { who: 1, where: 1, seen: 0.9, said: 0.6 } as const;
/** What a shot borrows from the shots beside it (same scene), per step away. */
const NEIGHBOUR = [0.45, 0.25];
const NEIGHBOUR_SECONDS = 25;

/** The shots that show a footage target, best first. Blank frames and menus are never returned. */
export function findShots(
  index: SceneIndex,
  target: ShotTarget,
  o: FindShotsOptions = {},
): ShotHit[] {
  const max = o.max ?? 5;
  const spacing = o.spacing ?? 4;
  const minSeconds = o.minSeconds ?? 0;
  const minConfidence = o.minConfidence ?? 0.2;
  const names = nameWords(index);
  const keywordTokens = new Set((target.keywords ?? []).flatMap(tokens));
  const terms = [...new Set([...tokens(target.text), ...keywordTokens])];
  if (!terms.length || !index.shots.length) return [];
  const docs = shotDocs(index);
  const N = docs.length;
  const has = (d: ShotDoc, t: string): number => {
    let best = 0;
    for (const f of ["who", "where", "seen", "said"] as const)
      if (d[f].has(t)) best = Math.max(best, FIELD[f]);
    return best;
  };
  const match = (d: ShotDoc, t: string): number => {
    const own = has(d, t);
    if (own >= 0.9) return own;
    let alt = 0;
    for (const s of SAME_OF.get(t) ?? []) alt = Math.max(alt, has(d, s) * 0.75);
    return Math.max(own, alt);
  };
  // Rare words tell more: a name said in every scene of the game narrows nothing.
  const weight = new Map<string, number>();
  for (const t of terms) {
    let df = 0;
    for (const d of docs) if (match(d, t) > 0) df++;
    const idf = Math.log(1 + N / (1 + df));
    weight.set(t, idf * (names.has(t) ? 2.5 : keywordTokens.has(t) ? 1.5 : 1));
  }
  const total = [...weight.values()].reduce((a, b) => a + b, 0) || 1;
  const wantsName = terms.some((t) => names.has(t));
  const hits: ShotHit[] = [];
  for (let i = 0; i < N; i++) {
    const shot = index.shots[i]!;
    if (shot.blank || shot.menu) continue;
    if (shot.end - shot.start < minSeconds) continue;
    if (o.within && (shot.start < o.within.from || shot.end > o.within.to)) continue;
    let score = 0;
    let named = 0;
    const matched: string[] = [];
    for (const t of terms) {
      let m = match(docs[i]!, t);
      // What the neighbouring shots of the same scene show, at a discount.
      for (
        let step = 1;
        step <= NEIGHBOUR.length && m < NEIGHBOUR[step - 1]!;
        step++
      )
        for (const j of [i - step, i + step]) {
          const other = index.shots[j];
          if (!other || other.blank || other.menu || Math.abs(other.start - shot.start) > NEIGHBOUR_SECONDS)
            continue;
          m = Math.max(m, match(docs[j]!, t) * NEIGHBOUR[step - 1]!);
        }
      if (m <= 0) continue;
      score += m * weight.get(t)!;
      if (m >= 0.4) matched.push(t);
      if (names.has(t) && m >= 0.4) named++;
    }
    if (score <= 0) continue;
    let confidence = score / total;
    // The target names someone or somewhere and this shot has none of them: at best a look-alike.
    if (wantsName && !named) confidence *= 0.5;
    if (confidence < minConfidence) continue;
    hits.push({
      shot: shot.id,
      start: shot.start,
      end: shot.end,
      confidence: Math.round(Math.min(1, confidence) * 100) / 100,
      score: Math.round(score * 1000) / 1000,
      matched,
      desc: shot.desc,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.start - b.start);
  const kept: ShotHit[] = [];
  for (const h of hits) {
    if (kept.length >= max) break;
    if (kept.some((k) => Math.abs(k.start - h.start) < spacing)) continue;
    kept.push(h);
  }
  return kept;
}

const quoteWords = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** The longest run of words two lists share in order (not necessarily touching). */
function lcs(a: string[], b: string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j]!;
      row[j] =
        a[i - 1] === b[j - 1] ? prev + 1 : Math.max(row[j]!, row[j - 1]!);
      prev = keep;
    }
  }
  return row[b.length]!;
}

/** Where `q` sits inside `l` as consecutive words; -1 when it does not. */
function runAt(l: string[], q: string[]): number {
  outer: for (let i = 0; i + q.length <= l.length; i++) {
    for (let k = 0; k < q.length; k++) if (l[i + k] !== q[k]) continue outer;
    return i;
  }
  return -1;
}

export interface QuoteHit {
  /** The dialogue lines the quote runs across (one, or two consecutive ones). */
  lines: number[];
  start: number;
  end: number;
  /** The words as the game has them. */
  text: string;
  speaker?: string;
  shot: number;
  /** 1 when the quote's words are in the line exactly, in order; lower for a near match. */
  confidence: number;
  /** True when start and end are the quote's own words (voice timings), false when they are the whole line's. */
  wordTimed: boolean;
}

export interface FindQuoteOptions {
  max?: number;
  speaker?: string;
  minConfidence?: number;
}

/**
 * The exact line for a quote. An exact run of the quote's words inside a line wins; otherwise the line sharing
 * the most of its words in order. A quote can run across two consecutive lines (a text box that turns the page
 * mid-sentence). Naming the speaker breaks ties and rules out the same words said by someone else.
 */
export function findQuote(
  index: SceneIndex,
  quote: string,
  o: FindQuoteOptions = {},
): QuoteHit[] {
  const q = quoteWords(quote);
  if (q.length < 1) return [];
  const minConfidence = o.minConfidence ?? 0.6;
  const wantSpeaker = o.speaker ? tokens(o.speaker).join(" ") : "";
  const spans: Array<{ lines: DialogueLine[] }> = [];
  index.lines.forEach((line, i) => {
    spans.push({ lines: [line] });
    const next = index.lines[i + 1];
    if (
      next &&
      next.start - line.end <= 3 &&
      (!line.speaker || !next.speaker || line.speaker === next.speaker)
    )
      spans.push({ lines: [line, next] });
  });
  const hits: QuoteHit[] = [];
  for (const span of spans) {
    const words = span.lines.flatMap((l) => quoteWords(l.text));
    if (!words.length) continue;
    const at = runAt(words, q);
    let confidence: number;
    if (at >= 0) confidence = 1;
    else {
      const shared = lcs(q, words);
      // Most of the quote must be there, and the line must not be mostly something else when the quote is short.
      confidence =
        (shared / q.length) *
        (q.length >= 4
          ? 1
          : shared / Math.max(shared, Math.min(words.length, q.length + 2)));
      if (confidence >= 0.999) confidence = 0.95;
    }
    // Two lines only when one alone does not hold the quote.
    if (span.lines.length === 2) {
      const single = span.lines.some((l) => {
        const w = quoteWords(l.text);
        return runAt(w, q) >= 0 || lcs(q, w) / q.length >= confidence - 1e-9;
      });
      if (single) continue;
    }
    const speaker = span.lines[0]!.speaker;
    if (wantSpeaker) {
      const said = speaker ? tokens(speaker).join(" ") : "";
      if (
        said &&
        said !== wantSpeaker &&
        !said.includes(wantSpeaker) &&
        !wantSpeaker.includes(said)
      )
        confidence *= 0.6;
      else if (said) confidence = Math.min(1, confidence + 0.02);
    }
    if (confidence < minConfidence) continue;
    let start = span.lines[0]!.start;
    let end = span.lines[span.lines.length - 1]!.end;
    let wordTimed = false;
    const timed = span.lines.flatMap((l) => l.words ?? []);
    if (at >= 0 && timed.length) {
      // Whisper's words and the line's words can differ in number (the screen's spelling was kept): find the
      // quote among the timed words themselves.
      const tw = timed.map((w) => quoteWords(w.text).join(""));
      const flat = q.join("");
      for (let i = 0; i < tw.length && !wordTimed; i++) {
        let acc = "";
        for (let k = i; k < tw.length && acc.length < flat.length; k++) {
          acc += tw[k];
          if (acc === flat) {
            start = timed[i]!.start;
            end = timed[k]!.end;
            wordTimed = true;
          }
        }
      }
    }
    hits.push({
      lines: span.lines.map((l) => l.id),
      start,
      end,
      text: span.lines.map((l) => l.text).join(" "),
      ...(speaker ? { speaker } : {}),
      shot: span.lines[0]!.shot,
      confidence: Math.round(confidence * 100) / 100,
      wordTimed,
    });
  }
  hits.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.lines.length - b.lines.length ||
      a.start - b.start,
  );
  return hits.slice(0, o.max ?? 3);
}

/** The shot a quote is said in, as a footage hit: the quote's line pins the moment better than any description. */
export function quoteShot(
  index: SceneIndex,
  hit: QuoteHit,
): SceneShot | undefined {
  return index.shots[hit.shot];
}

/** A line a video may quote, in the shape the character-quote feature takes (src/editorial/quotes.ts CutsceneQuote on codex/scenes). */
export interface QuotableLine {
  id: string;
  videoId: string;
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

/**
 * The game's lines worth quoting, for the writer's brief: said by a named speaker, three to fifteen words, a
 * complete sentence, each once (the first time it is said), longest speakers' lines first up to `max`. The ID is
 * stable across rebuilds of the same source ("q" and the line's start in tenths of a second).
 */
export function quotableLines(index: SceneIndex, max = 40): QuotableLine[] {
  const seen = new Set<string>();
  const out: QuotableLine[] = [];
  for (const line of index.lines) {
    const words = line.text.trim().split(/\s+/);
    if (!line.speaker || words.length < 3 || words.length > 15) continue;
    if (!/[.!?]["'”’]?$/.test(line.text.trim()) || /\.\.\.$|…$/.test(line.text.trim())) continue;
    const k = quoteWords(line.text).join(" ");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      id: `q${Math.round(line.start * 10)}`,
      videoId: index.source.videoId,
      text: line.text.trim(),
      start: line.start,
      end: line.end,
      speaker: line.speaker,
    });
  }
  // Spread across the game rather than its first ten minutes: every nth line when there are too many.
  if (out.length <= max) return out;
  const step = out.length / max;
  return Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]!);
}
