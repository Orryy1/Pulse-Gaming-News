// The graphics audit (owner, 12 Nov 2026): every graphic, annotation and visual element must be "sensible, logical,
// aligned, being used correctly and staying up long enough to actually be understood, helpful and digested and fully
// read, as well as actually adding something meaningful to the video and narration".
//
// One pure pass over a Short's plan, before the render, measures every overlay as the renderer will draw it (the
// clean frame's one-at-a-time arbitration included, src/render/cleanframe.ts):
// - reading time: words on screen against seconds on screen, at READ_PER_WORD a word plus READ_BASE, never under
//   READ_FLOOR for any text (READ_PER_WORD_MIN is the hard line; between the two is "tight");
// - fit: text the frame cuts (a word moment longer than its 14 letters, a verdict card that wraps down into the
//   captions) and overlays that collide with something drawn outside the arbitration (a character quote);
// - clashes: a card the one-at-a-time rule cuts to a flash or drops because a higher overlay sits on its word;
// - figures: every number on a graphic against the narration and the script's sources; one that the line itself
//   contradicts is wrong, one nobody says or sources is unsupported;
// - alignment: whether the graphic shows on the line that says its words (its key word spoken while it is up, or
//   just before), early, late, on another line, or never said at all;
// - meaning: a card that repeats, word for word, the caption under it, a generic label with nothing in it, or one
//   unrelated to anything said.
// fixShortGraphics then repairs what it can, in this order: drop what adds nothing or shows an unsupported figure,
// move a card to the free stretch next to its word and hold it long enough (visual.span, read by
// src/render/shortcraft.ts cardWindow and src/render/Short.tsx), trim its supporting text when the room is short,
// drop a shelf strip or card that still cannot be read, and re-audit. What stays wrong (a ranked entry card with a
// wrong figure, which cannot be dropped without breaking the ranking) fails the render. GRAPHICS_AUDIT switches it.

import type { RenderPlan } from "../render/plan.ts";
import type { Segment, Visual } from "../render/timeline.ts";
import {
  arbitrate,
  keptSpan,
  overlaySpans,
  PRIORITY,
  shortLayout,
  type ShortLayout,
  type Span,
} from "../render/cleanframe.ts";
import { cardWindow } from "../render/shortcraft.ts";
import { isEntryCard } from "../render/rankcard.ts";
import { keyTime } from "../render/longplan.ts";
import { wrapText } from "../render/components/packs/fit.ts";
import { CARD_WIDTH, HERO_TOP, BANDS } from "../render/layout.ts";
import { speakable } from "../voice/speakable.ts";

/** Seconds a word on screen needs, the base for taking a graphic in, and the floor for any text at all. */
export const READ_PER_WORD = 0.3;
export const READ_PER_WORD_MIN = 0.25;
export const READ_BASE = 0.6;
export const READ_FLOOR = 1.2;
/** A card may start this far before its word is said and still be on its word (seconds). */
export const EARLY_OK = 0.5;
/** ...and this far after it. Later than this, it lands after the viewer has heard the thing. */
export const LATE_OK = 0.6;
/** The word moment's own cut (src/pipeline.ts stampsFor and wordmoment/kit.tsx): longer text is cut. */
export const STAMP_CHARS = 14;
/** How far past its own line a moved card may hold, when the next line draws nothing (seconds). */
export const SPILL_SECONDS = 1.5;

export type GfxKind =
  | "hook"
  | "stamp"
  | "freeze"
  | "filler"
  | "card"
  | "take"
  | "entry"
  | "sting"
  | "shelf";
export type GfxCheck =
  | "reading"
  | "fit"
  | "clash"
  | "figures"
  | "alignment"
  | "meaning";
/** warn: worth knowing; fix: the gate can repair it; wrong: a wrong or misleading graphic. */
export type GfxLevel = "warn" | "fix" | "wrong";

export interface GfxElement {
  key: string;
  kind: GfxKind;
  segment?: number;
  /** Frames as drawn (after arbitration on a clean Short); `shown` 0 when it never shows. */
  from: number;
  to: number;
  planned: { from: number; to: number };
  text: string;
  words: number;
  /** Seconds on screen and the reading need. */
  shown: number;
  need: number;
  /** When its key words are said (seconds) and in which line, when they are. */
  keyAt?: number;
  keyLine?: number;
}

export interface GfxFinding {
  key: string;
  kind: GfxKind;
  check: GfxCheck;
  level: GfxLevel;
  /** Where in the video, seconds. */
  t: number;
  detail: string;
  /** For the fixer: what it would do. */
  action?: "drop" | "hold" | "move" | "trim";
}

export interface GfxStats {
  /** Elements with text, and how many meet the reading rule (READ_PER_WORD). */
  texts: number;
  readable: number;
  /** Below the hard line (READ_PER_WORD_MIN) or under the floor. */
  unreadable: number;
  clashes: number;
  misaligned: number;
  unsupported: number;
  wrong: number;
  meaningless: number;
  fit: number;
}

export interface GfxAudit {
  elements: GfxElement[];
  findings: GfxFinding[];
  stats: GfxStats;
}

export interface ShortGfxInput {
  segments: Segment[];
  words: Array<{ text: string; start: number; end: number }>;
  plan: Pick<
    RenderPlan,
    "fps" | "totalFrames" | "tailFrames" | "shelf" | "craft"
  >;
  stamps: Array<{ at: number; text: string; sub?: string }>;
  /** The script's stamp text as written, before the 14-letter cut (for the fit check). */
  stampWritten?: string;
  clean: boolean;
  headline: string;
  /** The script's own text (hook, beats, take, loop) as written, figures in digits. */
  narration: string;
  /** Everything else that sources a figure: claims, attribution, store facts, the entries' details. */
  sources: string;
  /** Character quotes on the timeline (seconds): they take the frame and hide the captions. */
  quotes?: Array<{ start: number; seconds: number }>;
}

// ---- Text helpers ---------------------------------------------------------------------------------

const STOP = new Set(
  "the a an of and to in on for with its it is was that this his her their at by as from or but be are has have had now just more than so not no yes all new one our we you your i".split(
    " ",
  ),
);
/** Card text that says nothing on its own: a label with no fact, name or figure in it. */
const GENERIC = new Set(
  "big news update breaking here why what how report reported official confirmed rumour rumor story latest details info today this week explained the deal what we know".split(
    " ",
  ),
);
const tok = (t: string) =>
  t
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9$£€%.]+/)
    .map((x) => x.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
const content = (t: string) => tok(t).filter((x) => !STOP.has(x));
const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** Seconds a graphic with `n` words needs on screen. */
export function readNeed(n: number, perWord = READ_PER_WORD): number {
  return n <= 0 ? 0 : Math.max(READ_FLOOR, READ_BASE + perWord * n);
}

/** The words a card shows, as the house card and the vertical styles draw them. */
export function cardText(
  s: Pick<Segment, "kind" | "visual" | "label">,
): string {
  const v = s.visual;
  if (!v || v.kind === "none" || !v.primary.trim()) return "";
  if (s.kind === "take")
    return [s.label ?? "", v.primary].filter(Boolean).join(" ");
  return [
    v.primary,
    v.secondary,
    ...(v.items ?? []).map((x) => x.replace(/^\*/, "").replace(/:/g, " ")),
  ]
    .filter((x) => x && x.trim())
    .join(" ");
}

const FIGURE =
  /[$£€]?\d[\d,]*(?:\.\d+)?\s?(?:%|m\b|bn\b|k\b|million\b|billion\b|fps\b|gb\b|tb\b|hz\b|p\b)?/gi;

/** The figures a text carries ("$942M", "17%", "2027", "30 FPS"). */
export function figuresIn(text: string): string[] {
  const dated = text.replace(/\b((?:19|20)\d\d)-\d\d(?:-\d\d)?\b/g, "$1");
  return [...dated.matchAll(FIGURE)]
    .map((m) => m[0].trim())
    .filter((f) => /\d/.test(f));
}

/** A figure's bare number ("$942M" -> "942", "4,088" -> "4088", "7.19"). */
const bare = (f: string) =>
  (f.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "").replace(/,/g, "");
/** The figure's class, so "$59.99" is weighed against money and "17%" against shares. */
function classOf(f: string): string {
  if (/[$£€]/.test(f)) return "money";
  if (/%/.test(f)) return "share";
  if (/fps|hz|gb|tb|\dp\b/i.test(f)) return "unit";
  const n = Number(bare(f));
  if (/^\d{4}$/.test(bare(f)) && n >= 1970 && n <= 2040) return "year";
  return "count";
}
const numbersOf = (text: string) =>
  new Set(figuresIn(text).map(bare).filter(Boolean));

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
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES: Record<string, number> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
};

/**
 * The numbers said in words ("nine point six nine million", "forty-two", "twenty twenty-six"): each run's value,
 * its value before the scale word (942 of "nine hundred forty-two million") and, for a year said in two halves,
 * the year. Digits the aligner kept as digits count too.
 */
export function spokenNumbers(tokens: string[]): Set<string> {
  const out = new Set<string>();
  const parts = tokens
    .flatMap((t) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9.%$£€-]/g, "")
        .split("-"),
    )
    .filter(Boolean);
  const num = (x: number) => String(Math.round(x * 1000) / 1000);
  let i = 0;
  while (i < parts.length) {
    const p = parts[i]!.replace(/[%$£€]/g, "");
    if (/^\d[\d.,]*$/.test(p)) {
      out.add(p.replace(/,/g, "").replace(/\.$/, ""));
      i++;
      continue;
    }
    if (!(p in UNITS) && !(p in TENS)) {
      i++;
      continue;
    }
    // A run of number words.
    let total = 0;
    let cur = 0;
    let head: number | undefined;
    const halves: number[] = [];
    let j = i;
    for (; j < parts.length; j++) {
      const w = parts[j]!;
      if (w in UNITS) {
        // "twenty nineteen": a year said in two halves.
        if (cur >= 10 && cur < 100 && cur % 10 === 0 && UNITS[w]! >= 10) {
          total += cur * 100;
          cur = UNITS[w]!;
        } else cur += UNITS[w]!;
      }
      else if (w in TENS) {
        if (cur % 100 >= 10 && cur % 100 < 100 && cur > 0 && cur < 100) {
          halves.push(cur);
          total += cur * 100;
          cur = 0;
        }
        cur += TENS[w]!;
      } else if (w === "hundred") cur = (cur || 1) * 100;
      else if (w in SCALES) {
        head = total + cur;
        total = (total + cur) * SCALES[w]!;
        cur = 0;
      } else if (w === "and") continue;
      else if (
        w === "point" &&
        j + 1 < parts.length &&
        parts[j + 1]! in UNITS
      ) {
        let frac = "";
        let k = j + 1;
        for (; k < parts.length && parts[k]! in UNITS; k++)
          frac += String(UNITS[parts[k]!]);
        cur = Number(`${total + cur}.${frac}`);
        total = 0;
        j = k - 1;
      } else break;
    }
    const value = total + cur;
    out.add(num(value));
    if (head !== undefined) out.add(num(head));
    // "seven dollars nineteen": the cents after a currency word.
    if (
      parts[j] === "dollars" ||
      parts[j] === "pounds" ||
      parts[j] === "euros"
    ) {
      const c = parts[j + 1];
      if (c && (c in UNITS || c in TENS)) {
        const cents =
          (TENS[c] ?? UNITS[c] ?? 0) +
          (parts[j + 2] && parts[j + 2]! in UNITS && c in TENS
            ? UNITS[parts[j + 2]!]!
            : 0);
        out.add(num(value + cents / 100));
      }
    }
    i = Math.max(j, i + 1);
  }
  return out;
}

/** Whether `fig` is said or sourced: in the written narration or sources, or spoken (its speakable form). */
export function figureSupported(
  fig: string,
  narration: string,
  sources: string,
  spoken: string[],
): boolean {
  const n = bare(fig);
  if (!n) return true;
  if (numbersOf(narration).has(n) || numbersOf(sources).has(n)) return true;
  // "942" said as "nine hundred and forty-two", "$7.19" as "seven dollars nineteen", "9.69M" as "nine point six nine million".
  const said = spokenNumbers(spoken);
  if (said.has(String(Number(n)))) return true;
  // Nothing at all is said as "no", "none" or "without".
  if (Number(n) === 0 && spoken.some((w) => /^(no|none|without|zero)$/.test(w)))
    return true;
  const want = tok(speakable(fig));
  for (let k = 0; want.length && k + want.length <= spoken.length; k++)
    if (want.every((w, j) => spoken[k + j] === w)) return true;
  // A rounded or scaled figure ("$942M" for "942 million") is the same number: the digits are what matter.
  const digits = n.replace(/\D/g, "");
  return (
    digits.length >= 3 &&
    [...numbersOf(narration), ...numbersOf(sources)].some((x) =>
      x.replace(/\D/g, "").startsWith(digits),
    )
  );
}

// ---- The audit ------------------------------------------------------------------------------------

const segBounds = (
  segments: Segment[],
  i: number,
  fps: number,
  total: number,
) => ({
  start: i === 0 ? 0 : Math.round(segments[i]!.start * fps),
  end:
    i === segments.length - 1
      ? total
      : Math.round(segments[i + 1]!.start * fps),
});

/** The word range of a line in `words`. */
function lineWords(
  segments: Segment[],
  words: ShortGfxInput["words"],
  i: number,
): [number, number] {
  const s = segments[i]!;
  const lo = Math.max(
    0,
    words.findIndex((w) => w.start >= s.start - 0.05),
  );
  const next = segments[i + 1];
  let hi = next
    ? words.findIndex((w) => w.start >= next.start - 0.02)
    : words.length;
  if (hi < 0) hi = words.length;
  return [lo, Math.max(lo, hi)];
}

/** Where a card's words are said: its own line first, then anywhere. */
function keyOf(
  segments: Segment[],
  words: ShortGfxInput["words"],
  i: number,
): { at?: number; line?: number } {
  const v = segments[i]!.visual;
  if (!v) return {};
  const keys = [
    v.primary,
    ...(v.items ?? []).map((x) => x.replace(/^\*/, "").split(":")[0]!),
    v.secondary,
  ].filter((k): k is string => !!k && !!k.trim());
  const [lo, hi] = lineWords(segments, words, i);
  for (const k of keys) {
    const t = keyTime(words, lo, hi, k);
    if (t !== undefined) return { at: t, line: i };
  }
  for (const k of keys) {
    const t = keyTime(words, 0, words.length, k);
    if (t !== undefined) {
      const line = segments.findIndex(
        (s, j) =>
          t >= s.start - 0.05 &&
          (j === segments.length - 1 || t < segments[j + 1]!.start),
      );
      return { at: t, line: line >= 0 ? line : undefined };
    }
  }
  return {};
}

/** The overlays of a Short as drawn, each with its text. */
export function shortElements(input: ShortGfxInput): {
  elements: GfxElement[];
  spans: Span[];
  kept: Span[];
  layout: ShortLayout;
} {
  const { segments, words, plan } = input;
  const fps = plan.fps;
  const layout = shortLayout(segments, fps, plan.totalFrames, plan.tailFrames);
  const spans = overlaySpans({
    segments,
    words,
    plan,
    layout,
    stamps: input.stamps,
    sting: false,
  });
  const kept = input.clean ? arbitrate(spans) : spans;
  const els: GfxElement[] = [];
  for (const sp of spans) {
    let text = "";
    let kind: GfxKind = sp.kind === "card" ? "card" : (sp.kind as GfxKind);
    let segment: number | undefined;
    if (sp.kind === "hook") text = input.headline;
    else if (sp.kind === "stamp") {
      const st = input.stamps[Number(sp.key.slice(5))];
      text = [st?.text, st?.sub].filter(Boolean).join(" ");
    } else if (sp.kind === "freeze") {
      const m = (plan.craft?.moves ?? [])[Number(sp.key.slice(6))];
      text = m && m.kind === "freeze" ? m.label : "";
    } else if (sp.kind === "card" || sp.kind === "entry") {
      segment = Number(sp.key.slice(4));
      const s = segments[segment]!;
      if (s.kind === "take") kind = "take";
      text = cardText(s);
    } else if (sp.kind === "shelf") {
      const it = plan.shelf[Number(sp.key.slice(5))];
      text = it ? Object.values(it.data).join(" ") : "";
    }
    // The kinetic filler's words are timed to the voice and read as they are said; nothing to count.
    const n = sp.kind === "filler" ? 0 : countWords(text);
    const pieces = kept.filter(
      (k) => k.key === sp.key || k.key.startsWith(`${sp.key}#`),
    );
    const longest = pieces.sort((a, b) => b.to - b.from - (a.to - a.from))[0];
    const from = longest?.from ?? sp.from;
    const to = longest?.to ?? sp.from;
    const key = segment !== undefined ? keyOf(segments, words, segment) : {};
    els.push({
      key: sp.key,
      kind,
      segment,
      from,
      to,
      planned: { from: sp.from, to: sp.to },
      text,
      words: n,
      shown: (to - from) / fps,
      need: readNeed(n),
      keyAt: key.at,
      keyLine: key.line,
    });
  }
  return {
    elements: els.sort((a, b) => a.planned.from - b.planned.from),
    spans,
    kept,
    layout,
  };
}

/** Every check on a Short's overlays (pure). */
export function auditShortGraphics(input: ShortGfxInput): GfxAudit {
  const { segments, words, plan } = input;
  const fps = plan.fps;
  const { elements, spans, kept } = shortElements(input);
  const spoken = words.flatMap((w) => tok(w.text));
  const findings: GfxFinding[] = [];
  const add = (
    e: GfxElement,
    check: GfxCheck,
    level: GfxLevel,
    detail: string,
    action?: GfxFinding["action"],
  ) =>
    findings.push({
      key: e.key,
      kind: e.kind,
      check,
      level,
      t: Math.round((e.from / fps) * 10) / 10,
      detail,
      ...(action ? { action } : {}),
    });
  const quoteSpans = (input.quotes ?? []).map(
    (q) =>
      [
        Math.round(q.start * fps),
        Math.round((q.start + q.seconds) * fps),
      ] as const,
  );

  for (const e of elements) {
    const sec = (f: number) => (f / fps).toFixed(1);
    // Reading time. The hook's headline also opens the loop and is the thumbnail: measured, never fixed here.
    if (e.words > 0 && e.key !== "loop") {
      const hard = readNeed(e.words, READ_PER_WORD_MIN);
      // A shelf strip that never shows is the one-at-a-time rule working, not a fault.
      if (e.shown <= 0) {
        if (e.kind !== "shelf")
          add(
            e,
            "clash",
            "fix",
            `never shows: ${clashWith(e, spans, kept)} takes its whole stretch`,
            "move",
          );
      } else if (e.shown < hard)
        add(
          e,
          "reading",
          e.kind === "hook" || e.kind === "entry" ? "warn" : "fix",
          `${e.words} words up ${e.shown.toFixed(1)} s, needs ${e.need.toFixed(1)} s ("${e.text.slice(0, 60)}")`,
          e.kind === "shelf" ? "drop" : "hold",
        );
      else if (e.shown < e.need)
        add(
          e,
          "reading",
          "warn",
          `tight: ${e.words} words up ${e.shown.toFixed(1)} s, ${e.need.toFixed(1)} s at ${READ_PER_WORD} s a word`,
        );
    }
    // Clashes: cut well short of its plan by a higher overlay (not a shelf strip, which always gives way).
    const plannedLen = e.planned.to - e.planned.from;
    if (
      e.kind !== "shelf" &&
      e.kind !== "hook" &&
      e.shown > 0 &&
      plannedLen > 0 &&
      (e.to - e.from) / plannedLen < 0.7 &&
      e.shown < e.need
    )
      add(
        e,
        "clash",
        "fix",
        `cut from ${(plannedLen / fps).toFixed(1)} s to ${e.shown.toFixed(1)} s by ${clashWith(e, spans, kept)}`,
        "move",
      );
    if (
      e.shown > 0 &&
      quoteSpans.some(([a, b]) => e.from < b && e.to > a) &&
      e.kind !== "hook"
    )
      add(
        e,
        "clash",
        "warn",
        `drawn over a character quote ${sec(e.from)}-${sec(e.to)} s`,
      );
    // Fit: the word moment's 14-letter cut, a verdict that wraps into the captions.
    if (
      e.kind === "stamp" &&
      input.stampWritten &&
      input.stampWritten.replace(/\s+/g, " ").trim().length > STAMP_CHARS
    )
      add(
        e,
        "fit",
        "fix",
        `word moment "${input.stampWritten}" is cut to "${input.stampWritten.toUpperCase().slice(0, STAMP_CHARS)}"`,
        "trim",
      );
    if (e.kind === "take" && e.segment !== undefined) {
      const v = segments[e.segment]!.visual!;
      const lines = wrapText(
        v.primary.toUpperCase(),
        "anton",
        96,
        CARD_WIDTH,
      ) ?? [v.primary];
      const bottom = HERO_TOP + 54 + 18 + 52 + lines.length * 96 * 1.04;
      if (bottom > BANDS.caption[0])
        add(
          e,
          "fit",
          "fix",
          `verdict "${v.primary}" wraps to ${lines.length} lines and runs into the captions (to y ${Math.round(bottom)})`,
          "trim",
        );
    }
    // Figures on any graphic with text, against the narration and the sources.
    if (e.kind !== "hook" && e.kind !== "shelf" && e.text) {
      const figs = figuresIn(e.text);
      const ok = figs.filter((f) =>
        figureSupported(f, input.narration, input.sources, spoken),
      );
      for (const f of figs) {
        if (ok.includes(f)) continue;
        // A second figure beside one that is said ("36 km² (14 mi²)", a conversion or a breakdown) is extra, not wrong.
        if (ok.some((x) => classOf(x) === classOf(f))) {
          add(
            e,
            "figures",
            "warn",
            `shows ${f} beside ${ok.find((x) => classOf(x) === classOf(f))}, which is said; ${f} itself is not`,
          );
          continue;
        }
        const line = e.segment !== undefined ? segments[e.segment]!.text : "";
        const lineFigs = figuresIn(line).filter(
          (x) => classOf(x) === classOf(f) && bare(x) !== bare(f),
        );
        const spokenLine =
          e.segment !== undefined
            ? lineFiguresSpoken(segments, words, e.segment)
            : [];
        // Only a price, a share, a year or a measure can be contradicted; a plain count beside other counts is
        // left as unsupported (dropped), never called wrong.
        const contradicted =
          classOf(f) !== "count" &&
          (lineFigs.length > 0 ||
            spokenLine.some(
              (x) => classOf(x) === classOf(f) && bare(x) !== bare(f),
            ));
        if (contradicted)
          add(
            e,
            "figures",
            "wrong",
            `shows ${f} where the line says ${[...lineFigs, ...spokenLine].slice(0, 2).join(", ") || "another figure"}`,
            e.kind === "entry" ? undefined : "drop",
          );
        else
          add(
            e,
            "figures",
            "fix",
            `shows ${f}, which the narration never says and no source gives`,
            e.kind === "entry" ? undefined : "drop",
          );
      }
    }
    // Alignment: on its own line, on its word.
    if (
      (e.kind === "card" || e.kind === "take") &&
      e.segment !== undefined &&
      e.shown > 0
    ) {
      const own = e.segment;
      if (e.kind === "take") {
        const said = new Set(content(segments[own]!.text));
        const mine = content(segments[own]!.visual?.primary ?? "");
        if (
          mine.length &&
          !mine.some((w) => said.has(w) || said.has(w.replace(/s$/, "")))
        )
          add(
            e,
            "alignment",
            "warn",
            `verdict "${segments[own]!.visual?.primary}" shares no word with the take`,
          );
      } else if (e.keyAt === undefined)
        add(
          e,
          "alignment",
          "warn",
          `"${segments[own]!.visual?.primary}" is never said; it shows from the line's start`,
        );
      // Said on another line: worth knowing, but moving it there would cover that line's own card.
      else if (e.keyLine !== own)
        add(
          e,
          "alignment",
          "warn",
          `"${segments[own]!.visual?.primary}" is said in line ${e.keyLine} (${e.keyAt.toFixed(1)} s), not on its own line`,
        );
      else {
        const d = e.from / fps - e.keyAt;
        // The word moment already lands that word: a card that follows it straight after is on time.
        const stampOnWord = kept.some(
          (k) =>
            k.kind === "stamp" &&
            k.from / fps <= e.keyAt! + 0.3 &&
            k.to >= e.from - 6,
        );
        if (d > LATE_OK && !stampOnWord)
          add(
            e,
            "alignment",
            "fix",
            `lands ${d.toFixed(1)} s after its word (said at ${e.keyAt.toFixed(1)} s)`,
            "move",
          );
        else if (d < -EARLY_OK && e.to / fps < e.keyAt)
          add(
            e,
            "alignment",
            "fix",
            `gone before its word is said (${e.keyAt.toFixed(1)} s)`,
            "move",
          );
      }
    }
    // Meaning: a caption repeated word for word, a generic label, or nothing to do with the narration.
    if (e.kind === "card" && e.segment !== undefined) {
      const v = segments[e.segment]!.visual!;
      const mine = content(cardText(segments[e.segment]!));
      const figs = figuresIn(cardText(segments[e.segment]!));
      const during = words
        .filter(
          (w) => w.start >= e.from / fps - 0.5 && w.start < e.to / fps + 0.3,
        )
        .flatMap((w) => tok(w.text));
      const run = longestRun(tok(v.primary), during);
      if (
        !figs.length &&
        tok(v.primary).length >= 5 &&
        run >= 5 &&
        run / tok(v.primary).length >= 0.8 &&
        !["list", "compare", "rank"].includes(v.kind)
      ) {
        // A quote card, or one with a credit line, still says who said it: worth knowing, not a drop.
        if (v.kind === "quote" || v.secondary.trim())
          add(
            e,
            "meaning",
            "warn",
            `repeats the caption word for word ("${v.primary}"); only its credit line adds anything`,
          );
        else
          add(
            e,
            "meaning",
            "fix",
            `repeats the caption word for word ("${v.primary}")`,
            "drop",
          );
      } else if (
        !figs.length &&
        mine.length > 0 &&
        mine.every((w) => GENERIC.has(w))
      )
        add(
          e,
          "meaning",
          "fix",
          `generic label with nothing in it ("${v.primary}")`,
          "drop",
        );
      else if (!figs.length && e.keyAt === undefined) {
        const said = new Set(spoken);
        if (mine.length && !mine.some((w) => said.has(w)))
          add(
            e,
            "meaning",
            "fix",
            `"${v.primary}" ties to nothing said in the Short`,
            "drop",
          );
      }
    }
  }
  // A word moment that only repeats the card it lands on ("FREE THIS WINTER" over "Free Firefight · This winter"):
  // two graphics saying one thing, and the moment's priority cuts the card that says more to a flash. The moment
  // goes; the card keeps its stretch.
  for (const st of elements.filter((x) => x.kind === "stamp")) {
    const mine = stems(st.text);
    if (!mine.length) continue;
    // It lands on a card (and cuts it) and says nothing that card, or another card of the Short, does not.
    const lands = elements.some(
      (c) =>
        (c.kind === "card" || c.kind === "take") &&
        c.planned.from < st.planned.to &&
        c.planned.to > st.planned.from,
    );
    const over = lands
      ? elements.find(
          (c) =>
            (c.kind === "card" || c.kind === "take") &&
            mine.every((w) => stems(c.text).includes(w)),
        )
      : undefined;
    if (over)
      findings.push({
        key: st.key,
        kind: "stamp",
        check: "meaning",
        level: "fix",
        t: Math.round((st.from / fps) * 10) / 10,
        detail: `word moment "${st.text}" only repeats the card it lands on ("${over.text.slice(0, 50)}")`,
        action: "drop",
      });
  }
  return { elements, findings, stats: statsOf(elements, findings) };
}

/** Telling words in a comparable form: number words as digits, plurals and possessives folded. */
function stems(t: string): string[] {
  return content(t.replace(/(\d)\s*(?=[a-z])/gi, "$1 "))
    .map((w) =>
      w in UNITS ? String(UNITS[w]) : w in TENS ? String(TENS[w]) : w,
    )
    .map((w) => w.replace(/^\$|%$/g, "").replace(/(?:'s|s)$/, ""))
    .filter((w) => w.length > 1 || /\d/.test(w));
}

function lineFiguresSpoken(
  segments: Segment[],
  words: ShortGfxInput["words"],
  i: number,
): string[] {
  const [lo, hi] = lineWords(segments, words, i);
  const said = words.slice(lo, hi).map((w) => w.text);
  const toks = said.flatMap(tok);
  // Numbers said in words take their class from the line: "fifty dollars" is a price, "twenty nineteen" a year.
  const money = toks.some((w) => /^(dollars?|pounds?|euros?|bucks)$/.test(w));
  const share = toks.includes("percent");
  const spokenFigs = [...spokenNumbers(said)].flatMap((v) => [
    v,
    ...(money ? [`$${v}`] : []),
    ...(share ? [`${v}%`] : []),
  ]);
  return [...figuresIn(said.join(" ")), ...spokenFigs];
}

function longestRun(a: string[], b: string[]): number {
  let best = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  return best;
}

/** What took an element's stretch: the higher overlays kept over its plan. */
function clashWith(e: GfxElement, spans: Span[], kept: Span[]): string {
  const mine = spans.find((s) => s.key === e.key);
  if (!mine) return "another overlay";
  const over = kept
    .filter(
      (k) =>
        k.key !== e.key &&
        !k.key.startsWith(`${e.key}#`) &&
        k.from < mine.to &&
        k.to > mine.from &&
        PRIORITY[k.kind] >= PRIORITY[mine.kind],
    )
    .map((k) =>
      k.kind === "stamp"
        ? "the word moment"
        : k.kind === "hook"
          ? "the headline"
          : k.kind === "entry"
            ? "a rank card"
            : `the ${k.kind}`,
    );
  return [...new Set(over)].join(" and ") || "another overlay";
}

function statsOf(elements: GfxElement[], findings: GfxFinding[]): GfxStats {
  // Text on screen: every element with words that shows at all (one the arbitration leaves out is a clash, not text).
  // The loop's closing return to the opening poster repeats frame 0 for its last 2 s by design: not counted.
  const texts = elements.filter(
    (e) => e.words > 0 && e.shown > 0 && e.key !== "loop",
  );
  const has = (key: string, check: GfxCheck, levels: GfxLevel[]) =>
    findings.some(
      (f) => f.key === key && f.check === check && levels.includes(f.level),
    );
  return {
    texts: texts.length,
    readable: texts.filter((e) => e.shown >= e.need).length,
    unreadable: texts.filter(
      (e) => e.shown < readNeed(e.words, READ_PER_WORD_MIN),
    ).length,
    clashes: findings.filter((f) => f.check === "clash" && f.level !== "warn")
      .length,
    misaligned: findings.filter(
      (f) => f.check === "alignment" && f.level !== "warn",
    ).length,
    unsupported: findings.filter(
      (f) => f.check === "figures" && f.level === "fix",
    ).length,
    wrong: findings.filter((f) => f.level === "wrong").length,
    meaningless: elements.filter((e) => has(e.key, "meaning", ["fix"])).length,
    fit: findings.filter((f) => f.check === "fit").length,
  };
}

// ---- The fixer ------------------------------------------------------------------------------------

export interface GfxFix {
  key: string;
  kind: GfxKind;
  action: "drop" | "hold" | "move" | "trim";
  /** Seconds, where it shows after the fix (absent when dropped). */
  t?: number;
  detail: string;
}

export interface GfxFixResult {
  segments: Segment[];
  stamps: ShortGfxInput["stamps"];
  /** The shelf with strips that cannot be read taken off (to = from). */
  shelf: RenderPlan["shelf"];
  /** The craft with fillers and freeze labels that cut a card taken off (zero length). */
  craft: RenderPlan["craft"];
  fixes: GfxFix[];
  before: GfxAudit;
  after: GfxAudit;
  /** Wrong or misleading graphics still there after fixing: the render fails on these. */
  wrong: GfxFinding[];
}

const cloneSegments = (segments: Segment[]) =>
  segments.map((s) => ({
    ...s,
    ...(s.visual
      ? {
          visual: {
            ...s.visual,
            ...(s.visual.items ? { items: [...s.visual.items] } : {}),
          },
        }
      : {}),
  }));

/**
 * The stretch a card can hold, from its word: from 6 frames before the word (or its line's start), up to the next
 * card, entry, filler or freeze, the loop's return to the opening frame, and at most SPILL_SECONDS past its own line
 * when the next line draws nothing; less what the word moment and the headline take. The longest free piece that
 * starts by the word wins.
 */
function roomFor(
  input: ShortGfxInput,
  segs: Segment[],
  i: number,
  keyAt: number | undefined,
  spans: Span[],
  minSeconds: number,
): [number, number] | undefined {
  const fps = input.plan.fps;
  const total = input.plan.totalFrames;
  const layout = shortLayout(segs, fps, total, input.plan.tailFrames);
  const { start, end } = segBounds(segs, i, fps, total);
  const anchor =
    keyAt !== undefined && keyAt * fps >= start - 2 && keyAt * fps < end
      ? Math.max(start, Math.round(keyAt * fps) - 6)
      : start;
  let stop = Math.min(end + Math.round(SPILL_SECONDS * fps), layout.loopFrom);
  for (const s of spans) {
    if (s.key === `card${i}`) continue;
    if (
      (s.kind === "card" ||
        s.kind === "entry" ||
        s.kind === "filler" ||
        s.kind === "freeze") &&
      s.from >= anchor
    )
      stop = Math.min(stop, s.from);
  }
  // Never past the line's end when the next line has a card of its own (its window starts on its word, later).
  if (segs[i + 1]?.visual && segs[i + 1]!.visual!.kind !== "none")
    stop = Math.min(stop, Math.max(end, Math.min(stop, end + 6)));
  stop = Math.min(stop, total);
  const blockers = spans.filter(
    (s) =>
      (s.kind === "stamp" || s.kind === "hook") &&
      s.to > anchor &&
      s.from < stop,
  );
  let pieces: Array<[number, number]> = [[anchor, stop]];
  for (const b of blockers) {
    const next: Array<[number, number]> = [];
    for (const [a, z] of pieces) {
      if (b.to <= a || b.from >= z) next.push([a, z]);
      else {
        if (b.from > a) next.push([a, b.from]);
        if (b.to < z) next.push([b.to, z]);
      }
    }
    pieces = next;
  }
  // The earliest piece long enough to read, so the card stays as near its word as it can; else the longest.
  const free = pieces.filter(([a, z]) => z > a);
  const early = free.find(([a, z]) => (z - a) / fps >= minSeconds);
  return (
    early ?? free.sort((x, y) => y[1] - y[0] - (x[1] - x[0]) || x[0] - y[0])[0]
  );
}

/** Shorter supporting text for a card that has too little room: no secondary line, then fewer rows. */
function trimmed(v: Visual, wordsAllowed: number): Visual | undefined {
  const out: Visual = { ...v, ...(v.items ? { items: [...v.items] } : {}) };
  const n = () => countWords(cardText({ kind: "beat", visual: out }));
  if (n() <= wordsAllowed) return out;
  if (
    out.secondary &&
    !["versus", "compare", "price", "score"].includes(out.kind)
  )
    out.secondary = "";
  // A list or comparison needs two rows to be one; any other card can stand on its figure or name alone.
  const rows = [
    "list",
    "compare",
    "versus",
    "timeline",
    "specs",
    "milestones",
    "platforms",
  ].includes(out.kind);
  while (n() > wordsAllowed && (out.items?.length ?? 0) > (rows ? 2 : 0))
    out.items!.pop();
  return n() <= wordsAllowed &&
    n() < countWords(cardText({ kind: "beat", visual: v }))
    ? out
    : undefined;
}

/** Repairs what the audit found (pure): the gate renders what this returns. */
export function fixShortGraphics(input: ShortGfxInput): GfxFixResult {
  const fps = input.plan.fps;
  const before = auditShortGraphics(input);
  const segs = cloneSegments(input.segments);
  let stamps = [...input.stamps];
  const shelf = input.plan.shelf.map((x) => ({ ...x }));
  let craft = input.plan.craft
    ? {
        ...input.plan.craft,
        fillers: [...input.plan.craft.fillers],
        moves: [...input.plan.craft.moves],
      }
    : undefined;
  const fixes: GfxFix[] = [];
  const drop = (e: GfxElement, why: string) => {
    if (e.kind === "stamp")
      stamps = stamps.filter((_, k) => `stamp${k}` !== e.key);
    else if (e.kind === "shelf") {
      const it = shelf[Number(e.key.slice(5))];
      if (it) it.to = it.from;
    } else if (e.segment !== undefined && e.kind !== "entry")
      segs[e.segment]!.visual = undefined;
    else return;
    fixes.push({ key: e.key, kind: e.kind, action: "drop", detail: why });
  };
  const byKey = new Map(before.elements.map((e) => [e.key, e]));
  // 1. What adds nothing or shows a figure nobody gives goes first, so it frees its stretch for the rest.
  const dropped = new Set<string>();
  for (const f of before.findings)
    if (
      f.action === "drop" &&
      (f.check === "meaning" || f.check === "figures") &&
      !dropped.has(f.key) &&
      byKey.get(f.key)
    ) {
      dropped.add(f.key);
      drop(byKey.get(f.key)!, `${f.check}: ${f.detail}`);
    }
  // A word moment cut by its 14 letters keeps only the words that fit.
  for (const f of before.findings)
    if (f.check === "fit" && f.kind === "stamp" && !dropped.has(f.key)) {
      const k = Number(f.key.slice(5));
      const st = stamps[k];
      const whole = (input.stampWritten ?? "")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim();
      const fitted = whole
        .split(" ")
        .reduce(
          (acc, w) =>
            (acc ? `${acc} ${w}` : w).length <= STAMP_CHARS
              ? acc
                ? `${acc} ${w}`
                : w
              : acc,
          "",
        );
      if (st && fitted) {
        stamps[k] = { ...st, text: fitted };
        fixes.push({
          key: f.key,
          kind: "stamp",
          action: "trim",
          t: st.at,
          detail: `"${whole}" shown as "${fitted}" instead of cut mid-word`,
        });
      }
    }
  // A verdict that runs into the captions: its supporting label goes and the line is set smaller by the card (it
  // wraps); failing that, the verdict is cut at a word to three lines.
  for (const f of before.findings)
    if (f.check === "fit" && f.kind === "take") {
      const i = Number(f.key.slice(4));
      const v = segs[i]?.visual;
      if (!v) continue;
      const ws = v.primary.split(/\s+/);
      let cut = ws.length;
      while (
        cut > 2 &&
        (wrapText(
          ws.slice(0, cut).join(" ").toUpperCase(),
          "anton",
          96,
          CARD_WIDTH,
        )?.length ?? 9) > 4
      )
        cut--;
      v.primary = ws
        .slice(0, cut)
        .join(" ")
        .replace(/[,;:]$/, "");
      fixes.push({
        key: f.key,
        kind: "take",
        action: "trim",
        detail: `verdict shortened to "${v.primary}" to stay above the captions`,
      });
    }
  // A filler or freeze-frame label (the craft's extras for a bare line) that cuts a card below its reading time goes:
  // the card is about the line's own words, the extra is decoration.
  if (craft) {
    const dropExtras = new Set<unknown>();
    const now = shortElements({ ...input, segments: segs, stamps, plan: { ...input.plan, shelf, craft } });
    for (const e of now.elements) {
      if ((e.kind !== "card" && e.kind !== "take") || e.shown >= e.need) continue;
      const hits = now.spans.filter(
        (s) => (s.kind === "filler" || s.kind === "freeze") && s.from < e.planned.to && s.to > e.planned.from,
      );
      for (const h of hits) {
        const k = Number(h.key.replace(/^[a-z]+/, ""));
        const gone = h.kind === "filler" ? craft.fillers[k] : craft.moves[k];
        if (!gone) continue;
        dropExtras.add(gone);
        fixes.push({
          key: h.key,
          kind: h.kind as GfxKind,
          action: "drop",
          detail: `cut ${e.key} ("${e.text.slice(0, 40)}") to ${e.shown.toFixed(1)} s`,
        });
      }
    }
    craft.fillers = craft.fillers.filter((f) => !dropExtras.has(f));
    craft.moves = craft.moves.filter((m) => !dropExtras.has(m));
    craft = { ...craft };
  }
  // 2. Cards that are cut, short, late or early: placed in the free stretch on their word, held for their reading time.
  const placed = new Set<string>();
  for (let pass = 0; pass < 2; pass++) {
    const cur = auditShortGraphics({
      ...input,
      segments: segs,
      stamps,
      plan: { ...input.plan, shelf, craft },
    });
    const spans = shortElements({
      ...input,
      segments: segs,
      stamps,
      plan: { ...input.plan, shelf, craft },
    }).spans;
    const todo = new Set(
      cur.findings
        .filter(
          (f) =>
            (f.kind === "card" || f.kind === "take") &&
            (f.action === "hold" || f.action === "move"),
        )
        .map((f) => f.key),
    );
    if (!todo.size) break;
    for (const e of cur.elements) {
      if (!todo.has(e.key) || e.segment === undefined || placed.has(e.key))
        continue;
      const i = e.segment;
      const v = segs[i]!.visual;
      if (!v) continue;
      const keyAt = e.keyLine === i ? e.keyAt : undefined;
      const room = roomFor(
        input,
        segs,
        i,
        keyAt,
        spans,
        readNeed(e.words, READ_PER_WORD_MIN),
      );
      const roomS = room ? (room[1] - room[0]) / fps : 0;
      const want = Math.max(
        e.need,
        e.planned.to - e.planned.from > 0
          ? (e.planned.to - e.planned.from) / fps
          : 0,
      );
      if (room && roomS >= readNeed(e.words, READ_PER_WORD_MIN)) {
        const len = Math.min(room[1] - room[0], Math.round(want * fps));
        // Nothing would change: no fix to log.
        if (room[0] === e.from && room[0] + len <= e.to) continue;
        v.span = [room[0] / fps, (room[0] + len) / fps];
        placed.add(e.key);
        fixes.push({
          key: e.key,
          kind: e.kind,
          action: e.shown < e.need ? "hold" : "move",
          t: Math.round((room[0] / fps) * 10) / 10,
          detail: `${e.shown.toFixed(1)} s at ${(e.from / fps).toFixed(1)} s -> ${(len / fps).toFixed(1)} s at ${(room[0] / fps).toFixed(1)} s`,
        });
        continue;
      }
      // Too little room: less to read, then the room it has.
      const allowed = Math.floor((roomS - READ_BASE) / READ_PER_WORD_MIN);
      const t = room ? trimmed(v, allowed) : undefined;
      if (room && t && roomS >= READ_FLOOR) {
        segs[i]!.visual = { ...t, span: [room[0] / fps, room[1] / fps] };
        placed.add(e.key);
        fixes.push({
          key: e.key,
          kind: e.kind,
          action: "trim",
          t: Math.round((room[0] / fps) * 10) / 10,
          detail: `text cut to ${countWords(cardText({ ...segs[i]!, visual: t }))} words for ${roomS.toFixed(1)} s of room`,
        });
        continue;
      }
      if (pass === 1 && e.kind === "card")
        drop(
          e,
          `unreadable: ${e.words} words, ${roomS.toFixed(1)} s of room at most`,
        );
    }
  }
  // 3. Shelf strips nobody can read in the stretch they are left go.
  const mid = auditShortGraphics({
    ...input,
    segments: segs,
    stamps,
    plan: { ...input.plan, shelf, craft },
  });
  for (const f of mid.findings)
    if (f.kind === "shelf" && f.check === "reading" && f.action === "drop") {
      const e = mid.elements.find((x) => x.key === f.key);
      if (e) drop(e, `unreadable: ${f.detail}`);
    }
  const after = auditShortGraphics({
    ...input,
    segments: segs,
    stamps,
    plan: { ...input.plan, shelf, craft },
  });
  return {
    segments: segs,
    stamps,
    shelf,
    craft,
    fixes,
    before,
    after,
    wrong: after.findings.filter((f) => f.level === "wrong"),
  };
}

/** One line for the logs and the digest: what was measured and what the gate did. */
export function gfxSummary(
  r: Pick<GfxFixResult, "before" | "after" | "fixes">,
): string {
  const b = r.before.stats;
  const a = r.after.stats;
  const n = (k: GfxFix["action"]) =>
    r.fixes.filter((f) => f.action === k).length;
  return `text on screen read in time ${b.readable}/${b.texts} -> ${a.readable}/${a.texts}; unreadable ${b.unreadable} -> ${a.unreadable}; clashes ${b.clashes} -> ${a.clashes}; misaligned ${b.misaligned} -> ${a.misaligned}; fixes: ${n("hold")} held, ${n("move")} moved, ${n("trim")} trimmed, ${n("drop")} dropped${a.wrong ? `; ${a.wrong} still wrong` : ""}`;
}

/** The alert digest's line from the day's graphics_audit events (pure). */
export function graphicsDigestLine(
  events: Array<{
    fixes?: number;
    dropped?: number;
    wrong?: number;
    unreadableBefore?: number;
    unreadableAfter?: number;
    failed?: boolean;
  }>,
): string | undefined {
  if (!events.length) return undefined;
  const sum = (k: keyof (typeof events)[number]) =>
    events.reduce((s, e) => s + (Number(e[k]) || 0), 0);
  const failed = events.filter((e) => e.failed).length;
  return `Graphics audit: ${events.length} video${events.length === 1 ? "" : "s"}, ${sum("fixes")} fixes (${sum("dropped")} dropped), unreadable ${sum("unreadableBefore")} -> ${sum("unreadableAfter")}${failed ? `, ${failed} failed for a wrong graphic` : ""}.`;
}

// ---- Long videos ----------------------------------------------------------------------------------

export interface LongGfxMoment {
  key: string;
  kind: string;
  text: string;
  /** What a viewer is meant to read: a source card's highlight and credit, not its whole quoted passage. */
  checked?: string;
  /** Seconds the renderer draws it from and for (src/render/momentspan.ts sentenceSpan). */
  from: number;
  len: number;
  short: boolean;
  /** The sentence it belongs to, as spoken, and when its key word is said. */
  sentence: string;
  at: number;
  start: number;
  end: number;
}

/** Reading, figures and ties for a long video's sentence graphics (pure); the renderer's own spans are the input. */
export function auditLongGraphics(
  moments: LongGfxMoment[],
  narration: string,
  sources: string,
  spokenWords: string[],
): GfxAudit {
  const spoken = spokenWords.flatMap(tok);
  const elements: GfxElement[] = [];
  const findings: GfxFinding[] = [];
  for (const m of moments) {
    const n = countWords(m.checked ?? m.text);
    const e: GfxElement = {
      key: m.key,
      kind: "card",
      from: Math.round(m.from * 30),
      to: Math.round((m.from + (m.short ? 0 : m.len)) * 30),
      planned: {
        from: Math.round(m.from * 30),
        to: Math.round((m.from + m.len) * 30),
      },
      text: m.text,
      words: n,
      shown: m.short ? 0 : m.len,
      need: readNeed(n),
      keyAt: m.at > m.start ? m.at : undefined,
    };
    elements.push(e);
    const add = (
      check: GfxCheck,
      level: GfxLevel,
      detail: string,
      action?: GfxFinding["action"],
    ) =>
      findings.push({
        key: m.key,
        kind: "card",
        check,
        level,
        t: Math.round(m.from * 10) / 10,
        detail,
        ...(action ? { action } : {}),
      });
    if (m.short)
      add(
        "clash",
        "warn",
        `left out: under 2 s before the next graphic ("${m.text.slice(0, 50)}")`,
      );
    else if (e.shown < readNeed(n, READ_PER_WORD_MIN))
      add(
        "reading",
        "fix",
        `${n} words up ${e.shown.toFixed(1)} s, needs ${e.need.toFixed(1)} s`,
        "drop",
      );
    else if (e.shown < e.need)
      add("reading", "warn", `tight: ${n} words up ${e.shown.toFixed(1)} s`);
    // A source card quotes its article: its passage is the source, so only its highlight and credit are checked.
    const figs = figuresIn(m.kind === "source" ? (m.checked ?? "") : m.text);
    const ok = figs.filter((f) =>
      figureSupported(f, narration, sources, spoken),
    );
    for (const f of figs) {
      if (ok.includes(f)) continue;
      if (ok.some((x) => classOf(x) === classOf(f))) continue;
      const line = figuresIn(m.sentence).filter(
        (x) => classOf(x) === classOf(f) && bare(x) !== bare(f),
      );
      add(
        "figures",
        line.length ? "wrong" : "fix",
        line.length
          ? `shows ${f} where the sentence says ${line[0]}`
          : `shows ${f}, which no narration or source gives`,
        "drop",
      );
    }
    if (m.at <= m.start) {
      const said = new Set(tok(m.sentence));
      const mine = content(m.text);
      if (
        mine.length &&
        !figuresIn(m.text).length &&
        !mine.some((w) => said.has(w))
      )
        add(
          "alignment",
          "warn",
          `shares no word with its sentence ("${m.text.slice(0, 50)}")`,
        );
    } else if (m.from - m.at > LATE_OK)
      add(
        "alignment",
        "warn",
        `lands ${(m.from - m.at).toFixed(1)} s after its word`,
      );
  }
  return { elements, findings, stats: statsOf(elements, findings) };
}
