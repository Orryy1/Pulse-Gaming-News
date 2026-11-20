// Reading figures for the Data pack: the first number in a value as written, its scale for comparing
// rows (210 million against 67 million), review scores normalised to 0..1, and a count-up that always
// lands on the text exactly as the source wrote it. Pure functions, no rendering.
import { displayText } from "../../../timeline.ts";

/** The long dash, matched by escape so the source never holds the character itself. */
const LONG_DASH = /\s*\u2014\s*/g;

/** Text from g, made safe for screen: "percent" as %, long dashes as a spaced hyphen, single spaces. */
export function clean(t: string | undefined | null): string {
  return displayText(String(t ?? ""))
    .replace(LONG_DASH, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

export type Figure = {
  /** The value as written (cleaned). */
  text: string;
  before: string;
  /** The number as written: "1,000", "7.6". */
  num: string;
  after: string;
  value: number;
  /** value times its unit (thousand, million, billion), for comparing rows. */
  scaled: number;
  percent: boolean;
  decimals: number;
  grouped: boolean;
  /** A bare year ("2013"): a date, not a quantity. */
  year: boolean;
  /** Has a unit word, a currency or a percent sign (so it is a quantity, not a year). */
  unit: string;
};

const UNITS: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  millions: 1e6,
  mn: 1e6,
  m: 1e6,
  billion: 1e9,
  billions: 1e9,
  bn: 1e9,
  b: 1e9,
  trillion: 1e12,
  tn: 1e12,
};

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/;

/** The first figure in a value: "$265 million" -> 265, scaled 265e6. Undefined when there is none. */
export function parseFigure(raw: string): Figure | undefined {
  const text = clean(raw);
  const m = NUMBER.exec(text);
  if (!m) return undefined;
  const num = m[0];
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + num.length);
  const value = Number(num.replace(/,/g, ""));
  if (!Number.isFinite(value)) return undefined;
  const u = after.match(/^\s*(%|percent\b|thousand\b|millions?\b|billions?\b|trillion\b|bn\b|mn\b|tn\b|[kmb]\b)/i);
  const unitWord = u ? u[1]!.toLowerCase() : "";
  const percent = unitWord === "%" || unitWord === "percent";
  const mult = percent ? 1 : (UNITS[unitWord] ?? 1);
  const currency = /[$£€¥]\s*$/.test(before);
  const grouped = num.includes(",");
  const decimals = num.includes(".") ? num.split(".")[1]!.length : 0;
  const negative = /[-\u2212]\s*[$£€¥]?\s*$/.test(before) && !/\w\s*[-\u2212]\s*[$£€¥]?\s*$/.test(before);
  const year = !grouped && !decimals && !unitWord && !currency && /^(19|20)\d\d$/.test(num);
  return {
    text,
    before,
    num,
    after,
    value: negative ? -value : value,
    scaled: (negative ? -value : value) * mult,
    percent,
    decimals,
    grouped,
    year,
    unit: unitWord || (currency ? "currency" : ""),
  };
}

/** The figure partway through counting up (p 0..1); at 1, the value exactly as written. */
export function countText(f: Figure, p: number): string {
  if (p >= 0.999) return f.text;
  const v = Math.max(0, f.value) * Math.max(0, p);
  let shown: string;
  if (f.grouped)
    shown = v.toLocaleString("en-US", {
      minimumFractionDigits: f.decimals,
      maximumFractionDigits: f.decimals,
    });
  else shown = f.decimals ? v.toFixed(f.decimals) : String(Math.round(v));
  return `${f.before}${shown}${f.after}`;
}

export type Row = { label: string; fig: Figure };

/**
 * "Label: value" rows with a quantity in the value. The split is at the last colon whose right side
 * has a digit, so "GTA: San Andreas: 27.5 million" keeps its title. Malformed rows are skipped.
 */
export function figureRows(items: string[] | undefined): Row[] {
  const out: Row[] = [];
  for (const it of items ?? []) {
    const t = clean(it);
    if (!t) continue;
    let at = -1;
    for (let i = t.length - 1; i > 0; i--) {
      if (t[i] === ":" && /\d/.test(t.slice(i + 1))) {
        at = i;
        break;
      }
    }
    if (at <= 0) continue;
    const label = t.slice(0, at).trim();
    const fig = parseFigure(t.slice(at + 1).trim());
    if (!label || !fig) continue;
    out.push({ label, fig });
  }
  return out;
}

/** Rows a chart can compare: positive quantities (no bare years), all percentages or none. */
export function quantityRows(items: string[] | undefined): Row[] {
  const rows = figureRows(items).filter((r) => !r.fig.year && r.fig.scaled > 0);
  const pct = rows.filter((r) => r.fig.percent).length;
  if (pct && pct !== rows.length) return [];
  return rows;
}

/** Bars and high scores: comparable rows, largest first, at most six. */
export function rankedRows(items: string[] | undefined): Row[] {
  return quantityRows(items)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.fig.scaled - a.r.fig.scaled || a.i - b.i)
    .map((x) => x.r)
    .slice(0, 6);
}

export type Shares = {
  rows: Array<Row & { share: number }>;
  /** The part of the whole the rows leave (percentages adding to under 100), drawn unlabelled. */
  rest: number;
};

/**
 * Parts of a whole: every row must read (a missing part would misdraw the whole), 2 to 5 of them,
 * percentages adding to at most about 100 (rounding allowed) or plain numbers shared by their sum.
 */
export function shareRows(items: string[] | undefined): Shares | undefined {
  const raw = (items ?? []).map(clean).filter(Boolean);
  const rows = quantityRows(raw);
  if (rows.length !== raw.length || rows.length < 2 || rows.length > 5) return undefined;
  const sum = rows.reduce((a, r) => a + r.fig.scaled, 0);
  if (!(sum > 0)) return undefined;
  const pct = rows[0]!.fig.percent;
  if (pct && sum > 102) return undefined;
  const whole = pct ? Math.max(100, sum) : sum;
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.fig.scaled - a.r.fig.scaled || a.i - b.i)
    .map(({ r }) => ({ ...r, share: r.fig.scaled / whole }));
  const rest = Math.max(0, 1 - sorted.reduce((a, r) => a + r.share, 0));
  return { rows: sorted, rest: rest > 0.004 ? rest : 0 };
}

export type Score = {
  /** 0..1 */
  n: number;
  /** The figure the needle counts to and its denominator when written ("9.5/10"). */
  x: number;
  den?: number;
};

/** A review score as the source gives it: "10/10", "97/100", "4 out of 5", "92%", "9.5", "97". */
export function parseScore(raw: string): Score | undefined {
  const t = clean(raw);
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/i);
  if (m) {
    const x = Number(m[1]);
    const den = Number(m[2]);
    if (den > 0 && x >= 0 && x <= den) return { n: x / den, x, den };
    return undefined;
  }
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:%|percent\b)/i);
  if (m) {
    const x = Number(m[1]);
    return x >= 0 && x <= 100 ? { n: x / 100, x, den: 100 } : undefined;
  }
  m = t.match(/^[^\d]*?(\d+(?:\.\d+)?)(?![\d.,])\s*[^\d]*$/);
  if (m) {
    const x = Number(m[1]);
    if (x >= 0 && x <= 10) return { n: x / 10, x };
    if (x > 10 && x <= 100) return { n: x / 100, x };
  }
  return undefined;
}

/** "Outlet: score" rows, split at the first colon (outlets rarely have one; scores never). */
export function reviewRows(items: string[] | undefined): Array<{ outlet: string; score: string; parsed?: Score }> {
  const out: Array<{ outlet: string; score: string; parsed?: Score }> = [];
  for (const it of items ?? []) {
    const t = clean(it);
    const i = t.indexOf(":");
    if (i <= 0) continue;
    const outlet = t.slice(0, i).trim();
    const score = t.slice(i + 1).trim();
    if (!outlet || !score) continue;
    out.push({ outlet, score, parsed: parseScore(score) });
  }
  return out;
}

/** A stable 0..1 from a variant and a slot: the pack's only randomness. */
export function seeded(variant: number, slot: number): number {
  const x = Math.sin((variant + 1) * 12.9898 + slot * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
