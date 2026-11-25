// GTA_KIT (default off): three GTA-flavoured overlays, ported from the open-source gta-components kit (MIT,
// github.com/echris6/gta-components; credit in docs/licences/gta-components-MIT.txt) into Pulse's own palette and
// type, and drawn by components/GtaKit.tsx. Each one only where a line calls for it, every word and figure on it
// taken from that line:
//
// - place: a line names a place on the game's map table (src/assets/gamemaps/*.json): the name writes on, its region
//   ("LEONIDA") above it, from the word on (the kit's location card and district pop-up).
// - cash: a line says a dollar figure with a word that says what it is (budget, earned, price): a HUD-style cash
//   readout rolls up to the figure as it is said (the kit's cash counter; the readout's layout after a free GTA HUD
//   project by @cole_editing).
// - versus: a line sets two known names against each other ("GTA 5 versus GTA 6", "Jason or Lucia" is not enough):
//   a head-to-head title, the second name landing on its word (the kit's versus card).
//
// The rules every overlay keeps (memory: graphics must earn their place): never in the hook or the loop's return,
// never over another overlay (a line's own card is the one thing it may stand in for), on screen at least 2.5 s,
// at most two in a Short and six in a long video, 4 s apart in a Short and 20 s in a long one. Pure and
// browser-safe: the pipeline plans a Short's (src/shortupgradestep.ts); Long.tsx plans its own from the same rules.

import { displayWords } from "./timeline.ts";

export type KitKind = "place" | "cash" | "versus";

export interface KitPlace {
  name: string;
  kind?: string;
  aliases?: string[];
  /** The name is also an ordinary word: only after a place word ("in Bonanza"). */
  ambiguous?: boolean;
}

/** What the pipeline hands the planner for a GTA story: the map's places and its name. */
export interface GtaKitInput {
  places: KitPlace[];
  /** The map's own name, shown above a place ("Leonida"). */
  region: string;
}

export type KitData =
  | { kind: "place"; name: string; region: string; label: string }
  | {
      kind: "cash";
      /** The figure as said: `value` of `unit` ("1.5", "BILLION"), or whole dollars with no unit. */
      value: number;
      unit: string;
      decimals: number;
      /** The finished readout ("$1.5 BILLION", "$70"): the box is sized for it. */
      text: string;
      label: string;
    }
  | { kind: "versus"; left: string; right: string };

/** One kit overlay (frames are the video's own). */
export interface KitMoment {
  key: string;
  from: number;
  len: number;
  /** The frame (from `from`) its key word is said: the place lands, the count stops, the second name slams in. */
  at: number;
  /** Which line (a Short's segment, a long video's window). */
  line: number;
  /** A Short: the line's card gives way to it (they would overlap). */
  replacesCard?: boolean;
  data: KitData;
}

export interface KitLine {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
}

export interface KitSpan {
  kind: string;
  from: number;
  to: number;
  /** A line's own card ("card3"): the overlay on that line may stand in for it. */
  key?: string;
}

/** Frames: the least an overlay holds (2.5 s at 30 fps, every word read) and the most. */
export const KIT_MIN = 75;
export const KIT_MAX = 105;
/** Frames before its key word an overlay starts, by kind (the place writes on, the count runs, the left name waits). */
export const KIT_LEAD: Record<KitKind, number> = {
  place: 6,
  cash: 24,
  versus: 18,
};

export const SHORT_KIT_MAX = 2;
export const LONG_KIT_MAX = 6;
/** Seconds between two overlays. */
export const SHORT_KIT_GAP = 4;
export const LONG_KIT_GAP = 20;

/** GTA stories only: the look is the series' own. */
export function isGtaStory(game: string): boolean {
  return /\b(grand theft auto|gta)\b/i.test(game ?? "");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PLACE_WORD_BEFORE =
  /\b(in|at|from|to|into|near|of|through|around|across|toward|towards)\s+(the\s+)?$/i;
const TITLE_BEFORE = /(Grand Theft Auto:?|GTA:?)\s*$/;
const NAME_AFTER = /^\s+[A-Z][a-z]/;

/**
 * The first place a line names, as the map prints it (the same rules as src/assets/gamemaps.ts placesIn): where two
 * names overlap ("Vice City International Airport" and "Vice City") the longer one wins; otherwise the earlier.
 */
export function placeIn(
  text: string,
  places: readonly KitPlace[],
): { place: KitPlace; said: string } | undefined {
  const hits: Array<{
    at: number;
    end: number;
    place: KitPlace;
    said: string;
  }> = [];
  for (const place of places) {
    for (const name of [place.name, ...(place.aliases ?? [])]) {
      if (!name.trim()) continue;
      const re = new RegExp(
        `(^|[^A-Za-z0-9])(${escape(name)})(?![A-Za-z0-9])`,
        "g",
      );
      for (const m of text.matchAll(re)) {
        const at = (m.index ?? 0) + m[1]!.length;
        const before = text.slice(0, at);
        if (
          TITLE_BEFORE.test(before) ||
          NAME_AFTER.test(text.slice(at + name.length))
        )
          continue;
        if (place.ambiguous && !PLACE_WORD_BEFORE.test(before)) continue;
        hits.push({ at, end: at + name.length, place, said: name });
      }
    }
  }
  // Drop a name inside a longer one, then take the earliest.
  const kept = hits.filter(
    (h) =>
      !hits.some(
        (o) =>
          o !== h &&
          o.at <= h.at &&
          o.end >= h.end &&
          o.end - o.at > h.end - h.at,
      ),
  );
  kept.sort((x, y) => x.at - y.at);
  const best = kept[0];
  return best ? { place: best.place, said: best.said } : undefined;
}

const SCALE: Record<string, [number, string]> = {
  thousand: [1e3, "THOUSAND"],
  k: [1e3, "THOUSAND"],
  million: [1e6, "MILLION"],
  m: [1e6, "MILLION"],
  mn: [1e6, "MILLION"],
  billion: [1e9, "BILLION"],
  bn: [1e9, "BILLION"],
  b: [1e9, "BILLION"],
  trillion: [1e12, "TRILLION"],
  tn: [1e12, "TRILLION"],
  t: [1e12, "TRILLION"],
};

/**
 * What a figure is, from the words right round it (at most five before and four after): the nearest telling word
 * wins, and on a tie the first kind listed. A "made" or "costs" further off says nothing about this figure.
 */
const CASH_LABELS: Array<[RegExp, string]> = [
  [
    /\b(budgets?|development costs?|costs? (?:\w+ )?to (?:make|develop|build)|(?:to make|making|to develop|developing) it)\b/gi,
    "BUDGET",
  ],
  [
    /\b(earned|earns|made|makes|revenue|grossed|takings|brought in|raked in|sales (?:of|worth|hit|reached|topped))\b/gi,
    "EARNED",
  ],
  [
    /\b(prices?|priced|costs?|retails?(?: for)?|pre-?orders?|sells? for|sold for|asking)\b/gi,
    "PRICE",
  ],
];

const FIGURE =
  // Whole unit words may follow a space; abbreviations must be attached and not run on ("$20 T-shirt" is no trillion).
  /\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s*(trillion|billion|million|thousand)\b|(tn|bn|mn|[kmbt])(?![A-Za-z-]))?/i;

/**
 * The first dollar figure a line says, with what it is. Lines are read in their written form as voiced
 * (src/render/timeline.ts displayWords: "seventy dollars" reads "$70"), so the readout shows what the narrator says.
 * Millions and up show as said ("$1.5 BILLION"), never ten digits to read in a second. Nothing for a figure with no
 * telling word near it, a unit word the readout does not know ("$3 quadrillion"), or a scaled figure with more
 * than one decimal (the voice rounds those).
 */
export function cashIn(text: string):
  | {
      value: number;
      unit: string;
      decimals: number;
      text: string;
      label: string;
      said: string;
    }
  | undefined {
  const m = FIGURE.exec(text);
  if (!m) return undefined;
  const after = text.slice(m.index + m[0].length);
  const unitWord = m[2] ?? m[3];
  if (!unitWord && /^\s+[a-z]*illion\b/i.test(after)) return undefined;
  const value = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const dec = m[1]!.split(".")[1]?.length ?? 0;
  const scale = unitWord ? SCALE[unitWord.toLowerCase()] : undefined;
  if (scale && dec > 1) return undefined;
  if (!scale && dec > 0 && dec !== 2) return undefined;
  const lo = wordStartBefore(text, m.index, 5);
  const hi = wordEndAfter(text, m.index + m[0].length, 4);
  const figEnd = m.index + m[0].length;
  let label: string | undefined;
  let bestDist = Infinity;
  for (const [re, name] of CASH_LABELS) {
    for (const lm of text.slice(lo, hi).matchAll(re)) {
      const a = lo + (lm.index ?? 0);
      const b = a + lm[0].length;
      const dist = b <= m.index ? m.index - b : a >= figEnd ? a - figEnd : 0;
      if (dist < bestDist) {
        bestDist = dist;
        label = name;
      }
    }
  }
  if (!label) return undefined;
  if (scale) {
    if (value * scale[0] >= 1e15) return undefined;
    return {
      value,
      unit: scale[1],
      decimals: dec,
      text: `$${value.toFixed(dec)} ${scale[1]}`,
      label,
      said: m[0].trim(),
    };
  }
  if (value >= 1e15) return undefined;
  return {
    value,
    unit: "",
    decimals: dec,
    text: cashText(value, dec),
    label,
    said: m[0].trim(),
  };
}

/** Where the word `n` words before `at` starts (a character index). */
function wordStartBefore(text: string, at: number, n: number): number {
  let i = at;
  for (let k = 0; k < n && i > 0; k++) {
    while (i > 0 && /\s/.test(text[i - 1]!)) i--;
    while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  }
  return i;
}

/** Where the word `n` words after `at` ends (a character index). */
function wordEndAfter(text: string, at: number, n: number): number {
  let i = at;
  for (let k = 0; k < n && i < text.length; k++) {
    while (i < text.length && /\s/.test(text[i]!)) i++;
    while (i < text.length && !/\s/.test(text[i]!)) i++;
  }
  return i;
}

/** A whole-dollar or cents figure with commas ("$1,250,000", "$69.99"). */
export function cashText(value: number, decimals = 0): string {
  return (
    "$" +
    value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}
/** Names a versus card may set against each other (the series, its people and the machines it runs on). */
export const VERSUS_NAMES: Array<{ show: string; said: RegExp }> = [
  { show: "GTA 6", said: /\b(?:GTA|Grand Theft Auto) (?:6|VI)\b/ },
  { show: "GTA 5", said: /\b(?:GTA|Grand Theft Auto) (?:5|V)\b/ },
  { show: "GTA 4", said: /\b(?:GTA|Grand Theft Auto) (?:4|IV)\b/ },
  { show: "San Andreas", said: /\bSan Andreas\b/ },
  {
    show: "Red Dead 2",
    said: /\b(?:Red Dead Redemption 2|Red Dead 2|RDR ?2)\b/,
  },
  { show: "Jason", said: /\bJason\b/ },
  { show: "Lucia", said: /\bLucia\b/ },
  { show: "Michael", said: /\bMichael\b/ },
  { show: "Franklin", said: /\bFranklin\b/ },
  { show: "Trevor", said: /\bTrevor\b/ },
  { show: "Niko", said: /\bNiko\b/ },
  { show: "PS5 Pro", said: /\b(?:PS5|PlayStation 5) Pro\b/ },
  { show: "PS5", said: /\b(?:PS5|PlayStation 5)\b(?! Pro)/ },
  { show: "Series X", said: /\b(?:Xbox )?Series X\b/ },
  { show: "Series S", said: /\b(?:Xbox )?Series S\b/ },
];

// Not "against": "Jason turns against Lucia" is a story beat, not a face-off.
const VERSUS_CUE = /\s(?:vs\.?|versus|compared (?:to|with))\s/i;

/** Two names set against each other right round a cue ("GTA 5 versus GTA 6"), each within a few words of it. */
export function versusIn(
  text: string,
): { left: string; right: string; saidRight: string } | undefined {
  const cue = VERSUS_CUE.exec(text);
  if (!cue) return undefined;
  const before = text.slice(Math.max(0, cue.index - 40), cue.index);
  const after = text.slice(
    cue.index + cue[0].length,
    cue.index + cue[0].length + 40,
  );
  let left: { show: string; end: number } | undefined;
  let right: { show: string; at: number; said: string } | undefined;
  for (const n of VERSUS_NAMES) {
    const re = new RegExp(n.said.source, "g");
    for (const m of before.matchAll(re)) {
      const end = (m.index ?? 0) + m[0].length;
      // Its last word at most two words before the cue.
      if (before.slice(end).trim().split(/\s+/).filter(Boolean).length > 2)
        continue;
      if (!left || end > left.end) left = { show: n.show, end };
    }
    // The right-hand name first in what follows, at most one word ("the") before it.
    const ma = n.said.exec(after);
    if (
      ma &&
      after.slice(0, ma.index).trim().split(/\s+/).filter(Boolean).length <=
        1 &&
      (!right || ma.index < right.at)
    )
      right = { show: n.show, at: ma.index, said: ma[0] };
  }
  if (!left || !right || left.show === right.show) return undefined;
  return { left: left.show, right: right.show, saidRight: right.said };
}

/** What a line calls for, if anything: a place first (the most concrete), then a figure, then a face-off. */
export function kitCall(
  text: string,
  kit: GtaKitInput,
): { data: KitData; key: string } | undefined {
  const v = versusIn(text);
  const p = placeIn(text, kit.places);
  if (p && !v)
    return {
      data: {
        kind: "place",
        // The name as said: an alias ("Mount Kalaga") is shown as the narrator says it.
        name: p.said,
        region: kit.region,
        label: (p.place.kind ?? "").toUpperCase(),
      },
      key: p.said,
    };
  const c = cashIn(text);
  if (c)
    return {
      data: {
        kind: "cash",
        value: c.value,
        unit: c.unit,
        decimals: c.decimals,
        text: c.text,
        label: c.label,
      },
      key: c.said,
    };
  if (v)
    return {
      data: { kind: "versus", left: v.left, right: v.right },
      key: v.saidRight,
    };
  return undefined;
}

/**
 * Each line's words as voiced, in written form (src/render/timeline.ts displayWords): what the narrator actually says,
 * so a figure the voice rounded ("$69.99" said "seventy dollars") reads "$70" and the overlay matches the voice.
 */
export function voicedLines(
  spans: ReadonlyArray<{ start: number; end: number }>,
  words: ReadonlyArray<{ text: string; start: number; end?: number }>,
): KitLine[] {
  const shown = displayWords(
    words.map((w) => ({ text: w.text, start: w.start, end: w.end ?? w.start })),
  );
  return spans.map((s) => ({
    start: s.start,
    end: s.end,
    text: shown
      .filter((w) => w.start >= s.start - 0.05 && w.start < s.end)
      .map((w) => w.text)
      .join(" "),
  }));
}

/** The words an overlay puts on screen (vision QA must not read them as burned-in text). */
export function kitTexts(d: KitData): string[] {
  if (d.kind === "place") return [d.name, d.region, d.label].filter(Boolean);
  if (d.kind === "cash") return [d.text, d.label];
  return [d.left, d.right, "VS"];
}

/** The free stretches of [from, to) once the taken spans are cut out (pure). */
function free(
  from: number,
  to: number,
  taken: readonly KitSpan[],
): Array<[number, number]> {
  let pieces: Array<[number, number]> = to > from ? [[from, to]] : [];
  for (const t of taken) {
    const next: Array<[number, number]> = [];
    for (const [a, b] of pieces) {
      if (t.to <= a || t.from >= b) next.push([a, b]);
      else {
        if (t.from > a) next.push([a, t.from]);
        if (t.to < b) next.push([t.to, b]);
      }
    }
    pieces = next;
  }
  return pieces;
}

/**
 * The kit's overlays for a video (pure). `wordAt(line, key)` finds when a line says its key words (seconds);
 * `taken` are the overlays already on screen; `card(line)` names a line's own card span key, which the overlay may
 * stand in for (a Short). Lines are tried in order; each overlay starts KIT_LEAD before its word, at most a beat
 * (8 frames) late, holds up to KIT_MAX and at least KIT_MIN, and stays inside its line plus half a second.
 */
export function planGtaKit(o: {
  lines: readonly KitLine[];
  kit: GtaKitInput;
  wordAt: (line: number, key: string) => number | undefined;
  fps: number;
  /** Frames: nothing before (the hook) or after (the loop's return, the end card). */
  startAfter: number;
  endBefore: number;
  taken: readonly KitSpan[];
  card?: (line: number) => string | undefined;
  max: number;
  gapSeconds: number;
  /** Lines that may not take one (a rank card, an explainer, a graphic of its own). */
  skip?: (line: number) => boolean;
}): KitMoment[] {
  const out: KitMoment[] = [];
  for (const [i, line] of o.lines.entries()) {
    if (out.length >= o.max) break;
    if (o.skip?.(i)) continue;
    const call = kitCall(line.text, o.kit);
    if (!call) continue;
    const said = o.wordAt(i, call.key);
    if (said === undefined) continue;
    const word = Math.round(said * o.fps);
    const ideal = word - KIT_LEAD[call.data.kind];
    const from0 = Math.max(
      ideal,
      o.startAfter,
      Math.round(line.start * o.fps) - KIT_LEAD[call.data.kind],
    );
    const end = Math.min(Math.round((line.end + 0.5) * o.fps), o.endBefore);
    const gap = o.gapSeconds * o.fps;
    const own = o.card?.(i);
    // What is on screen already, and the kit's own overlays with their gap either side.
    const taken: KitSpan[] = [
      ...o.taken.filter((t) => !(own && t.key === own)),
      ...out.map((m) => ({
        kind: "kit",
        from: m.from - gap,
        to: m.from + m.len + gap,
      })),
    ];
    const piece = free(from0, end, taken).find(([a]) => a - from0 <= 8);
    if (!piece) continue;
    const [a, b] = piece;
    const len = Math.min(KIT_MAX, b - a);
    if (len < KIT_MIN) continue;
    // The key word must land inside it, with a second left to read what it brings.
    if (word < a || word > a + len - 30) continue;
    const replacesCard =
      !!own &&
      o.taken.some((t) => t.key === own && t.from < a + len && t.to > a);
    out.push({
      key: `kit${i}`,
      from: a,
      len,
      at: word - a,
      line: i,
      ...(replacesCard ? { replacesCard } : {}),
      data: call.data,
    });
  }
  return out;
}
