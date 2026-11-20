// The explainers' guard and clock (pure). groundExplainer keeps an explainer only when every word and figure it puts
// on screen comes from the script or its sources: a label word the text never uses, or a number it never states, is
// dropped with its item, and an explainer left with too few items is dropped whole, so nothing is invented. A price
// build whose sum does not add up is dropped too. explainerAt times each item to the narrator's words (the cue the
// writer chose, else the item's own words), and explainerWindow says how long a Short shows it.

import { keyTime } from "../../longplan.ts";
import { ICONS } from "./icons.ts";
import { layoutProblems, type Orientation } from "./layout.ts";
import {
  EXPLAINER_TYPES,
  ITEM_COUNTS,
  LABEL_CHARS,
  LABEL_WORDS,
  OBJECT_KINDS,
  TITLE_WORDS,
  UNTIMED_STEP,
  VALUE_CHARS,
  VALUE_TYPES,
  type Explainer,
  type ExplainerItem,
} from "./types.ts";

// Words that carry no claim: an on-screen label may use them freely.
const STOP = new Set(
  "a an and are as at be but by for from had has have he her his i if in into is it its me my of on or our she so than that the their them then there they this to too up us was we were what when where which who will with you your yours via vs versus per each every any all just only also new now one".split(
    " ",
  ),
);

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  dozen: 12,
};
const SCALES: Record<string, number> = {
  hundred: 100,
  thousand: 1000,
  million: 1e6,
  billion: 1e9,
};

/** Lower case, apostrophes and accents gone, split on anything else. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

const SUFFIXES = [
  "ations",
  "ation",
  "ings",
  "ing",
  "ies",
  "ied",
  "ers",
  "er",
  "ery",
  "es",
  "ed",
  "age",
  "s",
  "y",
  "e",
];

/**
 * A word's light stems: the word and every form with one common ending taken off (keeping at least four letters),
 * so "deliver", "delivers", "delivered" and "delivery" or "stored" and "storage" share one.
 */
export function stems(w: string): string[] {
  const s = w.replace(/\./g, "");
  const out = [s];
  for (const suf of SUFFIXES)
    if (s.length - suf.length >= 4 && s.endsWith(suf))
      out.push(s.slice(0, -suf.length));
  return out;
}

/** True when two words share a stem. */
export function sameWord(a: string, b: string): boolean {
  const x = stems(a);
  return stems(b).some((s) => x.includes(s));
}

/** The numbers a text states, as digits ("79.99", "3", "1950"), from figures and from number words alike. */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    if (Number.isFinite(n)) out.add(String(Math.round(n * 100) / 100));
  };
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g))
    add(Number(m[0].replace(/,/g, "")));
  // Number words: "three hours", "twenty five", "two thousand".
  const words = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  let cur = -1;
  let total = 0;
  const flush = () => {
    if (cur >= 0) add(total + cur);
    cur = -1;
    total = 0;
  };
  for (const w of words) {
    if (w in UNITS) {
      const v = UNITS[w]!;
      if (cur >= 20 && cur % 10 === 0 && v < 10) cur += v;
      else if (cur >= 0 && v < 100) {
        flush();
        cur = v;
      } else cur = v;
    } else if (w in SCALES && cur >= 0) {
      const s = SCALES[w]!;
      if (s === 100) cur *= 100;
      else {
        total += cur * s;
        cur = 0;
      }
    } else if (w === "and" && cur >= 100) continue;
    else flush();
  }
  flush();
  return out;
}

const CURRENCY_WORDS: Record<string, string> = {
  dollars: "$",
  dollar: "$",
  pounds: "£",
  pound: "£",
  euros: "€",
  euro: "€",
  percent: "%",
};

/**
 * Figures as written, with their currency or percent kept ("$79.99", "£69.99", "20%", "30"): a value's figure must
 * appear in this exact form, so pounds never become dollars and 20 never becomes 20%. Spoken forms count too ("twenty
 * dollars" is "$20"). The sign is not part of the key: a change is checked by its sum instead.
 */
export function figuresIn(text: string): Set<string> {
  const out = new Set<string>();
  const key = (n: number, sym = "") =>
    sym === "%"
      ? `${Math.round(n * 100) / 100}%`
      : `${sym}${Math.round(n * 100) / 100}`;
  const flat = text.replace(/(\d),(?=\d{3}\b)/g, "$1");
  for (const m of flat.matchAll(
    /([$£€¥])?\s?(\d+(?:\.\d+)?)\s?(%|percent\b)?/gi,
  ))
    out.add(key(Number(m[2]), m[3] ? "%" : (m[1] ?? "")));
  for (const m of flat
    .toLowerCase()
    .matchAll(
      /((?:[a-z]+[ -]){0,3}[a-z]+|\d+(?:\.\d+)?)\s+(dollars?|pounds?|euros?|percent)\b/g,
    ))
    for (const n of numbersIn(m[1]!))
      out.add(key(Number(n), CURRENCY_WORDS[m[2]!]));
  return out;
}

/** True for a figure key that carries a currency or percent mark ("$79.99", "20%"). */
function marked(fig: string): boolean {
  return /^[$£€¥]|%$/.test(fig);
}

/** The haystack a beat is checked against: the whole script's words and its sources, stemmed, plus every number. */
export interface Haystack {
  stems: Set<string>;
  numbers: Set<string>;
  /** Figures with their currency or percent. */
  figures: Set<string>;
  /** Two-letter words (UK, PC, VR), which the stems skip. */
  short: Set<string>;
}

export function haystackOf(texts: string[]): Haystack {
  const all = texts.filter(Boolean).join(" \n ");
  return {
    stems: new Set(
      tokens(all)
        .filter((t) => !/^\d/.test(t))
        .flatMap(stems),
    ),
    numbers: numbersIn(all),
    figures: figuresIn(all),
    short: new Set(tokens(all).filter((x) => x.length === 2)),
  };
}

// Anything but Latin letters, digits, punctuation, symbols and spaces: a label the guard cannot read is not shown.
const UNREADABLE = /[^\p{Script=Latin}\p{N}\p{P}\p{S}\p{Zs}]/u;

/** The content words of a label or value that the haystack does not have; empty when all of it is grounded. */
export function ungrounded(text: string, hay: Haystack): string[] {
  const miss: string[] = [];
  for (const t of tokens(text)) {
    if (/^\d/.test(t)) continue;
    if (t.length < 3 || STOP.has(t)) continue;
    if (!stems(t).some((s) => hay.stems.has(s))) miss.push(t);
  }
  for (const n of numbersIn(text)) if (!hay.numbers.has(n)) miss.push(n);
  for (const g of figuresIn(text))
    if (marked(g) && !hay.figures.has(g)) miss.push(g);
  for (const m of text.matchAll(/\b[A-Z]{2}\b/g))
    if (!hay.short.has(m[0].toLowerCase())) miss.push(m[0]);
  if (UNREADABLE.test(text)) miss.push("unreadable characters");
  return miss;
}

/** The text's sentences, for checking that a label and its figure are said together. */
function sentencesOf(texts: string[]): string[] {
  return texts.flatMap((x) => x.split(/(?<=[.!?])\s+|\n+/)).filter(Boolean);
}

const contentWords = (label: string) =>
  tokens(label).filter((x) => !/^\d/.test(x) && x.length >= 3 && !STOP.has(x));

/** How far a label sits from the figure at token `f`: a word before it ("Standard at $79.99") is nearer than after. */
function reach(toks: string[], f: number, label: string): number {
  let best = Infinity;
  const words = contentWords(label);
  toks.forEach((t, p) => {
    if (!words.some((w) => sameWord(w, t))) return;
    best = Math.min(best, p < f ? f - p : p - f + 3);
  });
  return best;
}

/**
 * True when one sentence of the text says this label with this value: both are in it, and where the figure is written
 * out, this label is the nearest of the explainer's labels to it (`others`), within eight words. So "the standard
 * edition is £69.99 and the deluxe edition adds £20" pairs Standard with £69.99 and Deluxe with £20, never the reverse.
 */
export function saidTogether(
  label: string,
  value: string,
  texts: string[],
  others: string[] = [],
): boolean {
  const nums = [...numbersIn(value)];
  const words = contentWords(label);
  return sentencesOf(texts).some((s) => {
    const n = numbersIn(s);
    if (nums.length && !nums.every((x) => n.has(x))) return false;
    if (!words.length) return true;
    const toks = tokens(s);
    if (!words.some((w) => toks.some((t) => sameWord(w, t)))) return false;
    // The figure as written in digits; a number said in words is checked by the sentence alone.
    const at = toks
      .map((t, i) =>
        nums.includes(String(Math.round(Number(t) * 100) / 100)) ? i : -1,
      )
      .filter((i) => i >= 0);
    if (!at.length || !nums.length) return true;
    return at.some((f) => {
      const own = reach(toks, f, label);
      return own <= 8 && others.every((o) => reach(toks, f, o) >= own);
    });
  });
}

/** The first number in a value ("$79.99" 79.99, "+$20" 20), signed when the value starts with + or -. */
export function figure(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value
    .replace(/,/g, "")
    .match(/([+\-−])?\s*[^\d+\-−]{0,3}(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const n = Number(m[2]);
  return m[1] === "-" || m[1] === "−" ? -n : n;
}

const isDelta = (v: string | undefined) => /^\s*[+\-−]/.test(v ?? "");

/**
 * Why a price or number build cannot be drawn, or undefined (pure): every row needs a figure, all in one currency, no
 * change given as a percentage; a row after a change must equal the running total, and a build that ends on a change
 * must have the total it reaches stated in the text (the counter would otherwise show a sum nobody said).
 */
export function buildProblem(
  values: string[],
  hay: Haystack,
): string | undefined {
  const nums = values.map((v) => figure(v));
  if (nums.some((n) => n === undefined)) return "a value has no figure";
  if (values.some((v) => /%|percent/i.test(v)))
    return "a percentage cannot be stacked";
  const sym = (v: string) => v.match(/[$£€¥]/)?.[0] ?? "";
  if (new Set(values.map(sym)).size > 1) return "the rows mix currencies";
  const round = (n: number) => Math.round(n * 100) / 100;
  let running = Math.abs(nums[0]!);
  for (let i = 1; i < values.length; i++) {
    if (isDelta(values[i])) running += nums[i]!;
    else if (isDelta(values[i - 1]) && Math.abs(nums[i]! - running) > 0.011)
      return `the changes make ${round(running)}, not ${nums[i]}`;
    else running = nums[i]!;
  }
  if (isDelta(values.at(-1))) {
    const total = `${sym(values[0]!)}${round(running)}`;
    if (
      !(marked(total)
        ? hay.figures.has(total)
        : hay.numbers.has(String(round(running))))
    )
      return `the total the change reaches (${total}) is never stated`;
  }
  return undefined;
}

export interface Grounded {
  explainer?: Explainer;
  /** What was dropped and why, for the log. */
  dropped: string[];
}

/**
 * The explainer with only what the text supports: items whose words or figures the script and sources never use go,
 * a cue the line does not say goes (the item then times from its own words), an unknown icon goes. Undefined, with
 * the reasons, when too few items remain, a price build does not add up, or the board cannot fit its words.
 */
export function groundExplainer(
  raw: Explainer,
  ctx: { line: string; texts: string[]; orientation: Orientation },
): Grounded {
  const dropped: string[] = [];
  if (!EXPLAINER_TYPES.includes(raw.type))
    return { dropped: [`unknown type ${String(raw.type)}`] };
  const hay = haystackOf([ctx.line, ...ctx.texts]);
  const lineToks = tokens(ctx.line);
  const said = (cue: string) => {
    const c = tokens(cue);
    if (!c.length) return false;
    for (let i = 0; i + c.length <= lineToks.length; i++)
      if (c.every((t, k) => sameWord(lineToks[i + k]!, t))) return true;
    return false;
  };
  const items: ExplainerItem[] = [];
  raw.items.forEach((it, i) => {
    const label = (it.label ?? "").replace(/\s+/g, " ").trim();
    let value = (it.value ?? "").replace(/\s+/g, " ").trim();
    const name = `item ${i + 1} "${label}"`;
    // Only the shapes that set a figure beside each label draw one; elsewhere the label carries the words.
    if (value && !VALUE_TYPES.has(raw.type)) {
      dropped.push(`${name}: a ${raw.type} draws no value ("${value}")`);
      value = "";
    }
    if (!label) return void dropped.push(`item ${i + 1}: no label`);
    if (label.split(" ").length > LABEL_WORDS || label.length > LABEL_CHARS)
      return void dropped.push(
        `${name}: longer than ${LABEL_WORDS} words or ${LABEL_CHARS} characters`,
      );
    if (value.length > VALUE_CHARS)
      return void dropped.push(`${name}: value "${value}" too long`);
    const miss = [...ungrounded(label, hay), ...ungrounded(value, hay)];
    if (miss.length)
      return void dropped.push(
        `${name}: not in the script or sources (${miss.join(", ")})`,
      );
    if (
      value &&
      !saidTogether(
        label,
        value,
        [ctx.line, ...ctx.texts],
        raw.items.filter((_, k) => k !== i).map((x) => x.label ?? ""),
      )
    )
      return void dropped.push(
        `${name}: "${label}" and "${value}" are never said together`,
      );
    const out: ExplainerItem = { label };
    if (value) out.value = value;
    if (it.icon && it.icon in ICONS) out.icon = it.icon;
    else if (it.icon) dropped.push(`${name}: unknown icon ${it.icon}`);
    const cue = (it.cue ?? "").trim();
    // A cue that says a number the item does not show is another item's moment ("November 19" for a November 18 stop).
    const own = numbersIn(`${label} ${value}`);
    const foreign = [...numbersIn(cue)].filter((x) => !own.has(x));
    if (cue && said(cue) && !foreign.length) out.cue = cue;
    else if (cue && foreign.length)
      dropped.push(
        `${name}: cue "${cue}" names ${foreign.join(", ")}, which the item does not show`,
      );
    else if (cue) dropped.push(`${name}: cue "${cue}" is not in the line`);
    if (it.lead) out.lead = true;
    items.push(out);
  });
  const [lo, hi] = ITEM_COUNTS[raw.type];
  if (items.length < lo)
    return {
      dropped: [
        ...dropped,
        `${raw.type}: ${items.length} grounded items, needs ${lo}`,
      ],
    };
  if (items.length > hi) {
    dropped.push(`${raw.type}: kept the first ${hi} of ${items.length} items`);
    items.length = hi;
  }
  // Each shape's own needs.
  if (
    raw.type === "versus" ||
    raw.type === "timeline" ||
    raw.type === "howmuch"
  ) {
    const bare = items.findIndex((x) => !x.value);
    if (bare >= 0)
      return {
        dropped: [...dropped, `${raw.type}: item ${bare + 1} has no value`],
      };
  }
  if (raw.type === "howmuch") {
    const why = buildProblem(
      items.map((x) => x.value!),
      hay,
    );
    if (why) return { dropped: [...dropped, `howmuch: ${why}`] };
  }
  if (raw.type === "object3d" && !OBJECT_KINDS.includes(raw.object as never))
    return {
      dropped: [...dropped, `object3d: unknown object ${String(raw.object)}`],
    };
  let title = (raw.title ?? "").replace(/\s+/g, " ").trim();
  if (
    title &&
    (title.split(" ").length > TITLE_WORDS || ungrounded(title, hay).length)
  ) {
    dropped.push(
      `title "${title}": ${ungrounded(title, hay).length ? "not in the script or sources" : "too long"}`,
    );
    title = "";
  }
  const e: Explainer = { type: raw.type, title, items };
  if (raw.type === "object3d") e.object = raw.object;
  if (raw.type === "anatomy") {
    if (raw.picture) e.picture = raw.picture;
    if (raw.points?.length === items.length) e.points = raw.points;
    if (raw.aspect) e.aspect = raw.aspect;
  }
  const fit = layoutProblems(e, ctx.orientation);
  if (fit.length) return { dropped: [...dropped, ...fit] };
  return { explainer: e, dropped };
}

/** True when an anatomy explainer has its picture and a point for every item (the vision pass placed them). */
export function anatomyReady(e: Explainer): boolean {
  return (
    e.type !== "anatomy" ||
    (!!e.picture &&
      e.points?.length === e.items.length &&
      e.points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1))
  );
}

export type TimedWord = { text: string; start: number; end?: number };

/**
 * Per item, the frame (from the explainer's first frame) it lands on: a few frames before the narrator says its cue
 * (or, without one, the item's value or label), so the picture leads the word slightly. Items the voice does not
 * name are spaced between their neighbours. Always increasing, at least 8 frames apart, inside the window.
 * `words` are the window's words in seconds from the explainer's first frame.
 */
export function explainerAt(
  e: Explainer,
  words: TimedWord[],
  fps: number,
  len: number,
): number[] {
  const n = e.items.length;
  const first = 6;
  const last = Math.max(first + 8 * n, len - 36);
  const found: Array<number | undefined> = [];
  let from = 0;
  for (const it of e.items) {
    let t: number | undefined;
    for (const key of [it.cue, it.value, it.label].filter(
      (k): k is string => !!k,
    )) {
      t = keyTime(words, from, words.length, key);
      if (t !== undefined) break;
    }
    if (t !== undefined) {
      const k = words.findIndex((w) => w.start >= t! - 1e-6);
      if (k >= 0) from = k + 1;
    }
    found.push(t === undefined ? undefined : Math.round(t * fps) - 4);
  }
  // No word heard at all: an even build over the first part of the window.
  if (found.every((f) => f === undefined)) {
    const step = Math.max(
      8,
      Math.min(UNTIMED_STEP + 8, Math.floor((last - first) / Math.max(1, n))),
    );
    return e.items.map((_, i) => Math.min(last, first + i * step));
  }
  // Fill the gaps by spacing between known neighbours.
  const out = found.slice();
  for (let i = 0; i < n; i++) {
    if (out[i] !== undefined) continue;
    let a = i - 1;
    while (a >= 0 && found[a] === undefined) a--;
    let b = i + 1;
    while (b < n && found[b] === undefined) b++;
    const fa = a >= 0 ? found[a]! : first - UNTIMED_STEP;
    const fb = b < n ? found[b]! : fa + UNTIMED_STEP * (b - a);
    out[i] = Math.round(fa + ((fb - fa) * (i - a)) / (b - a));
  }
  // Increasing, at least 8 frames apart, inside [first, last].
  const res: number[] = [];
  for (let i = 0; i < n; i++) {
    const want = Math.max(first, out[i]!);
    res.push(
      i === 0
        ? Math.min(want, last)
        : Math.min(Math.max(want, res[i - 1]! + 8), last),
    );
  }
  return res;
}

/** The longest and shortest an explainer stays up in a Short. */
export const EXPLAINER_MAX_SECONDS = 9;
export const EXPLAINER_MIN_SECONDS = 2.5;
/** The hook's seconds: no explainer starts before this (owner, 20 Nov 2026). */
export const EXPLAINER_HOOK_SECONDS = 2;
/** Shorter than this a board cannot be read: the line keeps its ordinary card. */
export const EXPLAINER_SHORTEST_FRAMES = 45;

/** The explainer a Short draws for a line, or undefined when its window would be too short to read (pure). */
export function shortExplainer(
  e: Explainer | undefined,
  words: TimedWord[],
  line: { start: number; end: number },
  fps: number,
): { from: number; len: number } | undefined {
  if (!e) return undefined;
  const w = explainerWindow(e, words, line, fps);
  return w.len >= EXPLAINER_SHORTEST_FRAMES ? w : undefined;
}

/**
 * Where a Short shows a line's explainer, in frames: from a beat before its first item is said to the end of the
 * line (it explains the whole line, unlike a fact card that lands on one word and goes), at most
 * EXPLAINER_MAX_SECONDS. `words` are the Short's words in seconds; start and end are the line's frames.
 */
export function explainerWindow(
  e: Explainer,
  words: TimedWord[],
  line: { start: number; end: number },
  fps: number,
): { from: number; len: number } {
  const s = line.start / fps;
  const lo = Math.max(
    0,
    words.findIndex((w) => w.start >= s - 0.05),
  );
  let hi = words.findIndex((w) => w.start >= line.end / fps);
  if (hi < 0) hi = words.length;
  // Never over the hook: the opening seconds belong to the footage and the headline.
  const floor = Math.max(line.start, Math.round(EXPLAINER_HOOK_SECONDS * fps));
  let at = floor;
  const it = e.items[0];
  for (const key of [it?.cue, it?.value, it?.label].filter(
    (k): k is string => !!k,
  )) {
    const t = keyTime(words, lo, hi, key);
    if (t !== undefined) {
      at = Math.max(floor, Math.round(t * fps) - Math.round(0.6 * fps));
      break;
    }
  }
  // Never so late that the explainer cannot be read before the line ends.
  const minLen = Math.round(EXPLAINER_MIN_SECONDS * fps);
  if (line.end - at < minLen) at = Math.max(floor, line.end - minLen);
  const len = Math.max(
    1,
    Math.min(line.end - at, Math.round(EXPLAINER_MAX_SECONDS * fps)),
  );
  return { from: at, len };
}
