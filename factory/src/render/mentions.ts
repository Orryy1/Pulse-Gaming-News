// Mention insets (owner, 18 Nov 2026, after the people insets: "many more things like that across every format"): when
// the narration names a thing, a small picture of that exact thing pops up on the word that names it. One engine for
// six kinds, each behind its own setting (all off until switched on):
//
//   game       MENTION_GAMES       another game's official Steam capsule, with its title; two games in one breath (or a
//                                  comparison with the video's own game) stand side by side
//   logo       MENTION_LOGOS       a studio's or publisher's own logo, as Wikidata files it on Commons, on its name only
//   character  MENTION_CHARACTERS  a fictional character's official art from the publisher's site, filed under their name
//   realplace  MENTION_REALPLACES  a real place named alongside its game version: a free Commons photo beside the game frame
//   platform   MENTION_PLATFORMS   a row of Pulse-drawn text marks (PS5, Xbox Series X|S, PC, Switch 2) when platforms are listed
//   receipt    MENTION_RECEIPTS    "Bloomberg reported": a chip with the outlet and the date, from the story's own sources
//
// Rules for every kind (owner and the top-creator study, 18 Nov 2026): on screen at least 1.2 s, never two new insets at
// once, about five a Short (MENTION_MAX_PER_SHORT), never over the captions, the hook or another overlay; an inset stands
// in for the card its beat would have drawn, it never adds a layer (src/render/cleanframe.ts); it plays no sound. A
// picture that cannot be found or verified means no inset.
//
// Pure and browser-safe (the Remotion bundle loads it): matching names to the voice's words, the per-video cap, the
// one-at-a-time schedule and where each inset sits. The pictures are found by src/assets/mentions.ts; drawn by
// components/MentionInsets.tsx.

export type MentionKind =
  | "game"
  | "logo"
  | "character"
  | "realplace"
  | "platform"
  | "receipt";

/** One picture in an inset, as the render gets it. */
export interface MentionPicture {
  src: string;
  /** The name under it ("Red Dead Redemption 2", "Miami"). */
  label: string;
  /** A second line ("REAL", "IN THE GAME"). */
  sub?: string;
  /** "Photo: Jane Doe, CC BY-SA 4.0"; absent when nothing needs crediting on screen. */
  credit?: string;
  /** Width over height of the picture as it will show. */
  aspect?: number;
}

/** A mention as the render gets it: what to draw and when its name is first said. */
export interface MentionInset {
  kind: MentionKind;
  /** The thing's key (one inset per thing per Short). */
  key: string;
  /** Seconds into the video of the first spoken word of the name. */
  at: number;
  pictures: MentionPicture[];
  /** A receipt's outlet ("BLOOMBERG"). */
  label?: string;
  /** A receipt's verb and date ("REPORTED · 30 OCT 2026"). */
  sub?: string;
  /** A receipt's carrier ("via Push Square"). */
  note?: string;
  /** The platform row's marks, in the order said. */
  platforms?: string[];
}

/** A placed inset: its kept frames. */
export interface MentionSlot {
  key: string;
  from: number;
  /** Exclusive. */
  to: number;
  m: MentionInset;
}

export type MentionLayout = "short" | "long";

/** Frames an inset holds after its word: 2.8 s in a Short, 4 s in a long video (a small graphic, read at a glance). */
export const MENTION_HOLD: Record<MentionLayout, number> = {
  short: 84,
  long: 120,
};
/** Never shorter than this on screen (1.2 s), or it is not shown at all. */
export const MENTION_MIN_FRAMES = 36;
/** Most insets a Short shows when MENTION_MAX_PER_SHORT is not set. */
export const MENTION_MAX_DEFAULT = 5;
/** A long video's allowance: one inset a minute on top of the Short's cap, and the same thing again after 4 minutes. */
export const LONG_PER_MINUTE = 1;
export const LONG_REPEAT_SECONDS = 240;
/** Two games said this close together share one inset, side by side. */
export const PAIR_SECONDS = 3;

/**
 * Which kinds win when the cap bites (the top-creator study, 18 Nov 2026: in Shorts the picture pays most when it is
 * the noun, so receipts and compared games first; a logo or the platform row last).
 */
export const KIND_RANK: Record<MentionKind, number> = {
  receipt: 6,
  game: 5,
  realplace: 4,
  character: 3,
  logo: 2,
  platform: 1,
};

/** Kinds that give way to a card in their beat instead of replacing it: a logo or the platform row never displaces a fact. */
export const YIELDS_TO_CARD: ReadonlySet<MentionKind> = new Set<MentionKind>([
  "logo",
  "platform",
]);

// ---- Words ---------------------------------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
};
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
  xi: "11",
  xii: "12",
  xiii: "13",
  xiv: "14",
  xv: "15",
  xvi: "16",
};

/** One word as the matcher compares it: lower case, accents and possessives off, numbers as digits ("six", "VI", "6"). */
export function mentionToken(w: string): string {
  const t = w
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9’']+$/, "")
    .replace(/[’']s$/, "")
    .replace(/[^a-z0-9]/g, "");
  return NUMBER_WORDS[t] ?? ROMAN[t] ?? t;
}

/** A phrase's tokens ("The" dropped: "The Witcher 3" and "Witcher three" are the same game). */
export function phraseTokens(phrase: string): string[] {
  return phrase
    .replace(/\([^)]*\)/g, " ")
    .split(/[\s\-–—:/]+/)
    .map(mentionToken)
    .filter((t) => t && t !== "the");
}

type Word = { text: string; start: number; end?: number };

/** The voice's words as tokens, "the" and punctuation-only words left out, each keeping its own time. */
function wordTokens(
  words: Word[],
): Array<{ t: string; start: number; i: number; ends: boolean }> {
  const out: Array<{ t: string; start: number; i: number; ends: boolean }> = [];
  words.forEach((w, i) => {
    // An aligned word can carry two ("PS5," or "Xbox/PC"): each part keeps the word's time.
    const parts = w.text.split(/[\s\-–—/]+/);
    parts.forEach((part, j) => {
      const t = mentionToken(part);
      // Whether a sentence ends on this word ("development.").
      const ends = j === parts.length - 1 && /[.!?]["”’)]?$/.test(w.text);
      if (t && t !== "the") out.push({ t, start: w.start, i, ends });
      else if (ends && out.length) out[out.length - 1]!.ends = true;
    });
  });
  return out;
}

/**
 * Every time a phrase is said (seconds of its first word): the run of words that spells it, or the same letters
 * split or joined differently by the aligner ("PS 5" for "PS5", "Veilguard" for "Veil guard"). Pure.
 */
export function phraseTimes(words: Word[], phrase: string): number[] {
  const toks = phraseTokens(phrase);
  if (!toks.length) return [];
  const ws = wordTokens(words);
  const joined = toks.join("");
  const out: number[] = [];
  for (let k = 0; k < ws.length; k++) {
    if (toks.every((t, j) => ws[k + j]?.t === t)) {
      out.push(ws[k]!.start);
      k += toks.length - 1;
      continue;
    }
    let acc = "";
    for (let j = k; j < Math.min(ws.length, k + toks.length + 2); j++) {
      acc += ws[j]!.t;
      if (acc === joined) {
        out.push(ws[k]!.start);
        k = j;
        break;
      }
      if (!joined.startsWith(acc)) break;
    }
  }
  return out;
}

/** The first time any of the aliases is said, or undefined. */
export function firstSaid(
  words: Word[],
  aliases: string[],
): number | undefined {
  const t = aliases.flatMap((a) => phraseTimes(words, a));
  return t.length ? Math.min(...t) : undefined;
}

// ---- Attribution (receipts) ------------------------------------------------------------------------------------

/** Words that make a name an attribution: "Bloomberg reported", "according to Bloomberg", "per IGN". */
const ATTRIB_AFTER = new Set([
  "report",
  "reports",
  "reported",
  "reporting",
  "confirm",
  "confirms",
  "confirmed",
  "says",
  "said",
  "told",
  "tells",
  "announce",
  "announces",
  "announced",
  "reveal",
  "reveals",
  "revealed",
  "claims",
  "claimed",
  "writes",
  "wrote",
  "notes",
  "noted",
  "adds",
  "added",
  "found",
  "learned",
  "understands",
  "sources",
  "insider",
  "journalist",
  "reporter",
  "spotted",
  "leaked",
  "leaker",
  "datamined",
  "dataminer",
  "posted",
  "shared",
  "listed",
]);
const ATTRIB_BEFORE = new Set([
  "according",
  "per",
  "via",
  "told",
  "telling",
  "from",
]);

/** The receipt's verb as the chip prints it, from the words around the name. */
export function receiptVerb(
  around: string[],
): "REPORTED" | "CONFIRMED" | "ANNOUNCED" | "SAID" {
  if (around.some((w) => /^confirm/.test(w))) return "CONFIRMED";
  if (around.some((w) => /^announc|^reveal/.test(w))) return "ANNOUNCED";
  if (
    around.some((w) =>
      /^(says|said|told|tells|writes|wrote|notes|noted|adds|added)$/.test(w),
    )
  )
    return "SAID";
  return "REPORTED";
}

/**
 * Every time an outlet is said as the source of a fact (seconds), with the verb: an attribution word within the next
 * five words ("Bloomberg's Jason Schreier reports") or the two before ("according to Bloomberg"). A bare mention of the
 * outlet is not a receipt. Pure.
 */
export function attributedTimes(
  words: Word[],
  aliases: string[],
): Array<{ at: number; verb: ReturnType<typeof receiptVerb> }> {
  const ws = wordTokens(words);
  const out: Array<{ at: number; verb: ReturnType<typeof receiptVerb> }> = [];
  for (const a of aliases) {
    const toks = phraseTokens(a);
    if (!toks.length) continue;
    for (let k = 0; k + toks.length <= ws.length; k++) {
      if (!toks.every((t, j) => ws[k + j]!.t === t)) continue;
      // Inside the name's own sentence only: "Bloomberg is a newspaper. Rockstar confirmed" is no receipt for Bloomberg.
      const after: string[] = [];
      if (!ws[k + toks.length - 1]!.ends)
        for (
          let j = k + toks.length;
          j < Math.min(ws.length, k + toks.length + 5);
          j++
        ) {
          after.push(ws[j]!.t);
          if (ws[j]!.ends) break;
        }
      const before: string[] = [];
      for (let j = k - 1; j >= Math.max(0, k - 3) && !ws[j]!.ends; j--)
        before.unshift(ws[j]!.t);
      // "according to Bloomberg": "to" sits between; the matcher sees "according", "to".
      if (
        after.some((w) => ATTRIB_AFTER.has(w)) ||
        before.some((w) => ATTRIB_BEFORE.has(w))
      )
        out.push({
          at: ws[k]!.start,
          verb: receiptVerb([...before, ...after]),
        });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

// ---- Platforms --------------------------------------------------------------------------------------------------

/** The platform marks we draw, with the words that name each. Names only: no console makers' logos. */
export const PLATFORMS: Array<{ mark: string; aliases: string[] }> = [
  { mark: "PS5", aliases: ["PS5", "PlayStation 5", "P S 5"] },
  { mark: "PS4", aliases: ["PS4", "PlayStation 4", "P S 4"] },
  {
    mark: "XBOX SERIES X|S",
    aliases: ["Xbox Series X", "Xbox Series S", "Xbox Series", "Series X"],
  },
  { mark: "XBOX ONE", aliases: ["Xbox One"] },
  { mark: "PS3", aliases: ["PS3", "PlayStation 3", "P S 3"] },
  { mark: "XBOX 360", aliases: ["Xbox 360"] },
  { mark: "SWITCH 2", aliases: ["Switch 2", "Nintendo Switch 2"] },
  { mark: "SWITCH", aliases: ["Nintendo Switch"] },
  // "Steam" and "Windows" are left out: a store or an operating system named in passing is not a platform list.
  { mark: "PC", aliases: ["PC"] },
  { mark: "STEAM DECK", aliases: ["Steam Deck"] },
  // A bare console family last: "PS5 and Xbox" lists two platforms (a longer name at the same word wins).
  { mark: "XBOX", aliases: ["Xbox"] },
  { mark: "PLAYSTATION", aliases: ["PlayStation"] },
  { mark: "MAC", aliases: ["Mac", "macOS"] },
];

/**
 * Where the narration lists platforms (pure): two or more different platforms, each named within four seconds of the
 * other ("on PS5, Xbox Series X and PC"). Each run is one row of marks, appearing on the first platform's word.
 */
export function platformRuns(
  words: Word[],
): Array<{ at: number; platforms: string[] }> {
  const hits: Array<{ at: number; mark: string; n: number }> = [];
  for (const p of PLATFORMS) {
    // The longer name wins where they overlap ("Steam Deck" is not "Steam"; "PlayStation 3" is not "PlayStation").
    for (const a of p.aliases)
      for (const at of phraseTimes(words, a))
        hits.push({ at, mark: p.mark, n: phraseTokens(a).join("").length });
  }
  hits.sort((a, b) => a.at - b.at || b.n - a.n);
  const clean: typeof hits = [];
  for (const h of hits) {
    const same = clean.find((c) => Math.abs(c.at - h.at) < 0.01);
    if (same) continue;
    // "Steam" inside "Steam Deck", "Switch" inside "Switch 2": the shorter mark at the same word is a duplicate.
    clean.push(h);
  }
  const runs: Array<{ at: number; platforms: string[]; last: number }> = [];
  for (const h of clean) {
    const r = runs[runs.length - 1];
    if (r && h.at - r.last <= 4) {
      if (!r.platforms.includes(h.mark)) r.platforms.push(h.mark);
      r.last = h.at;
    } else runs.push({ at: h.at, platforms: [h.mark], last: h.at });
  }
  // A bare family beside one of its own consoles says nothing new ("PS5 ... free on PlayStation").
  const family = (p: string, fam: string) =>
    fam === "PLAYSTATION"
      ? /^PS\d/.test(p)
      : fam === "XBOX"
        ? /^XBOX ./.test(p)
        : false;
  for (const r of runs)
    r.platforms = r.platforms.filter(
      (p) =>
        !(p === "PLAYSTATION" || p === "XBOX") ||
        !r.platforms.some((q) => family(q, p)),
    );
  return runs
    .filter((r) => r.platforms.length >= 2)
    .map(({ at, platforms }) => ({ at, platforms: platforms.slice(0, 5) }));
}

// ---- Comparisons -------------------------------------------------------------------------------------------------

/** Words that make a sentence a comparison: then both games show. */
export const COMPARE_WORDS =
  /\b(than|versus|vs\.?|compared|comparison|compare|like|unlike|bigger|smaller|larger|longer|shorter|faster|slower|cheaper|pricier|dwarfs|outsold|outsells|beat|beats|whereas|while)\b/i;

// ---- Real places and their game versions ----------------------------------------------------------------------

/**
 * A game place and the real one it stands for, only where the studio or the series' own material draws the line
 * (Vice City is Rockstar's Miami). The real one is looked up on Wikidata by its item.
 */
export interface PlacePair {
  game: string[];
  real: string[];
  /** Wikidata item of the real place. */
  qid: string;
  /** The games the pair belongs to (a title match): "Vice City" in a Saints Row story is not Miami. */
  series: RegExp;
}

export const PLACE_PAIRS: PlacePair[] = [
  {
    game: ["Vice City"],
    real: ["Miami"],
    qid: "Q8652",
    series: /grand theft auto|gta/i,
  },
  {
    game: ["Leonida"],
    real: ["Florida"],
    qid: "Q812",
    series: /grand theft auto|gta/i,
  },
  {
    game: ["Grassrivers"],
    real: ["Everglades", "the Everglades"],
    qid: "Q216193",
    series: /grand theft auto|gta/i,
  },
  {
    game: ["Leonida Keys"],
    real: ["Florida Keys", "the Keys"],
    qid: "Q1135015",
    series: /grand theft auto|gta/i,
  },
  {
    game: ["Los Santos"],
    real: ["Los Angeles", "LA"],
    qid: "Q65",
    series: /grand theft auto|gta/i,
  },
  {
    game: ["San Fierro"],
    real: ["San Francisco"],
    qid: "Q62",
    series: /grand theft auto|gta/i,
  },
  {
    game: ["Las Venturas"],
    real: ["Las Vegas"],
    qid: "Q23768",
    series: /grand theft auto|gta/i,
  },
  {
    game: ["Liberty City"],
    real: ["New York City", "New York"],
    qid: "Q60",
    series: /grand theft auto|gta/i,
  },
  {
    game: ["Saint Denis"],
    real: ["New Orleans"],
    qid: "Q34404",
    series: /red dead/i,
  },
];

/**
 * Where a real place is named alongside its game version (pure): both said within eight seconds of each other. The
 * inset appears on whichever is said first.
 */
export function placePairAt(
  words: Word[],
  pair: Pick<PlacePair, "game" | "real">,
): number | undefined {
  const g = pair.game.flatMap((a) => phraseTimes(words, a));
  const r = pair.real.flatMap((a) => phraseTimes(words, a));
  let best: number | undefined;
  for (const a of g)
    for (const b of r)
      if (Math.abs(a - b) <= 8) {
        const t = Math.min(a, b);
        if (best === undefined || t < best) best = t;
      }
  return best;
}

// ---- The schedule ---------------------------------------------------------------------------------------------

/** Seconds a viewer needs to read an inset's words (the graphics audit's measure: 0.6 s + 0.3 s a word, 1.2 s floor). */
export function mentionText(m: MentionInset): string {
  if (m.kind === "receipt") return [m.label, m.sub].filter(Boolean).join(" ");
  if (m.kind === "platform") return (m.platforms ?? []).join(" ");
  // A logo is read as a picture; the other pictures by their names. Credits are legal lines, not counted.
  if (m.kind === "logo") return m.pictures[0]?.label ?? "";
  return m.pictures.map((p) => p.label).join(" ");
}
export function mentionNeedFrames(m: MentionInset, fps: number): number {
  // Words only: the "·" between a receipt's verb and date is not read.
  const n = mentionText(m)
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(
    MENTION_MIN_FRAMES,
    Math.round(Math.max(1.2, 0.6 + 0.3 * n) * fps),
  );
}

/** The cap for a video: the Short's, plus a minute's allowance in a long one. */
export function mentionCap(
  layout: MentionLayout,
  maxPerShort: number,
  seconds: number,
): number {
  const base = Math.max(0, Math.floor(maxPerShort));
  return layout === "short"
    ? base
    : base + Math.floor((seconds / 60) * LONG_PER_MINUTE);
}

/**
 * Two games said within PAIR_SECONDS share one inset (pure): the later one's picture joins the earlier one's, side by
 * side, two at most. Other kinds pass through.
 */
export function pairGames(ms: MentionInset[]): MentionInset[] {
  const sorted = [...ms].sort((a, b) => a.at - b.at);
  const out: MentionInset[] = [];
  for (const m of sorted) {
    const prev = out[out.length - 1];
    // Two games, or two characters ("Jason and Lucia"), said in one breath stand side by side.
    if (
      (m.kind === "game" || m.kind === "character") &&
      prev?.kind === m.kind &&
      prev.pictures.length < 2 &&
      m.at - prev.at <= PAIR_SECONDS &&
      !prev.pictures.some((p) => p.label === m.pictures[0]?.label)
    ) {
      out[out.length - 1] = {
        ...prev,
        key: `${prev.key}+${m.key}`,
        pictures: [...prev.pictures, ...m.pictures].slice(0, 2),
      };
      continue;
    }
    out.push(m);
  }
  return out;
}

/**
 * The insets placed (pure): each on its word, held MENTION_HOLD (or its reading time, if longer); the same thing once
 * (a long video may show it again after LONG_REPEAT_SECONDS); when the cap bites the higher-ranked kinds and then the
 * earlier ones stay; never two at once: an inset that arrives while another is up cuts it short when that one has had
 * its reading time, and is left out otherwise; spans in `taken` (frames something else holds) are never entered;
 * nothing shorter than MENTION_MIN_FRAMES and nothing past the last frames.
 */
export function mentionSlots(
  mentions: MentionInset[],
  o: {
    fps: number;
    totalFrames: number;
    max: number;
    layout: MentionLayout;
    taken?: Array<{ from: number; to: number }>;
  },
): MentionSlot[] {
  const { fps } = o;
  const end = Math.max(0, o.totalFrames - 6);
  const repeat = o.layout === "long" ? LONG_REPEAT_SECONDS : Infinity;
  // A picture must be there to draw: no verified picture, no inset (the platform row and receipts are drawn by us).
  const drawable = mentions.filter(
    (m) =>
      Number.isFinite(m.at) &&
      m.at >= 0 &&
      (m.kind === "platform"
        ? (m.platforms?.length ?? 0) >= 2
        : m.kind === "receipt"
          ? !!m.label?.trim()
          : m.pictures.length > 0 && m.pictures.every((p) => !!p.src)) &&
      (m.kind !== "realplace" || m.pictures.length === 2),
  );
  // The same thing again only after the repeat gap.
  const lastAt = new Map<string, number>();
  const once = pairGames(drawable).filter((m) => {
    // A pair ("a+b") shows unless both of its things were just shown.
    const parts = m.key.split("+");
    if (parts.every((k) => lastAt.has(k) && m.at - lastAt.get(k)! < repeat))
      return false;
    for (const k of parts) lastAt.set(k, m.at);
    return true;
  });
  const hold = MENTION_HOLD[o.layout];
  type P = { m: MentionInset; from: number; to: number; need: number };
  const planned: P[] = once
    .map((m) => {
      const from = Math.round(m.at * fps);
      const need = mentionNeedFrames(m, fps);
      return { m, from, to: Math.min(end, from + Math.max(hold, need)), need };
    })
    .filter((p) => p.to - p.from >= MENTION_MIN_FRAMES)
    // Never into a span something else holds (on its word or not at all).
    .map((p) => {
      let to = p.to;
      for (const t of o.taken ?? []) {
        if (t.from <= p.from && t.to > p.from) return { ...p, to: p.from };
        if (t.from > p.from && t.from < to) to = t.from;
      }
      return { ...p, to };
    })
    .filter((p) => p.to - p.from >= p.need);
  const rank = (p: P) =>
    KIND_RANK[p.m.kind] +
    (p.m.kind === "game" && p.m.pictures.length > 1 ? 0.5 : 0);
  // Two that would arrive before the first has been read: the stronger kind stays (the earlier on a tie).
  const fit: P[] = [];
  for (const p of [...planned].sort((a, b) => a.from - b.from)) {
    const prev = fit[fit.length - 1];
    if (prev && p.from < prev.to && p.from - prev.from < prev.need) {
      if (rank(p) > rank(prev)) fit[fit.length - 1] = p;
      continue;
    }
    fit.push(p);
  }
  // The cap: the stronger kinds, then the earlier ones; each then holds until the next one arrives.
  const out = [...fit]
    .sort((a, b) => rank(b) - rank(a) || a.from - b.from)
    .slice(0, Math.max(0, o.max))
    .sort((a, b) => a.from - b.from)
    .map((p) => ({ ...p }));
  out.forEach((p, k) => {
    const next = out[k + 1];
    if (next && next.from < p.to) p.to = next.from;
  });
  return out
    .filter((p) => p.to - p.from >= MENTION_MIN_FRAMES)
    .map((p, k) => ({ key: `mention${k}`, from: p.from, to: p.to, m: p.m }));
}

// ---- Where each inset sits ---------------------------------------------------------------------------------------

export interface InsetFrame {
  /** The block's right edge and top (px), and its scale against the Short's sizes. */
  right: number;
  top: number;
  scale: number;
}

/**
 * Where the inset block sits. A Short: top right under the brand band, in the hero band's upper part, clear of the
 * headline (gone by then under the one-at-a-time rule), the captions (y 1180+) and the right-hand rail (from y 1000),
 * the people insets' own place (they never show together). A long video: top right under the credit line, larger,
 * clear of the lower-third name tags and the captions along the bottom.
 */
export function insetFrame(layout: MentionLayout): InsetFrame {
  return layout === "short"
    ? { right: 1016, top: 330, scale: 1 }
    : { right: 1824, top: 120, scale: 1.18 };
}

/** The tallest an inset block grows (px, before scale): its bottom stays above the Short's rail and captions. */
export const INSET_MAX_HEIGHT = 620;
