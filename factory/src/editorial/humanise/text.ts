// Small text helpers the humaniser's rules share (pure). Quotations are masked before any rule runs, so a quoted
// person's words are never reworded, counted or shortened.

const OPEN = "";
const CLOSE = "";
const QUOTED = /"[^"]*"|“[^”]*”/g;
const MASK = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");

export interface Masked {
  text: string;
  quotes: string[];
}

/** Quotations replaced by placeholders the rules never match. */
export function maskQuotes(text: string): Masked {
  const quotes: string[] = [];
  const t = text.replace(QUOTED, (q) => `${OPEN}${quotes.push(q) - 1}${CLOSE}`);
  return { text: t, quotes };
}

/** The quotations put back. */
export function unmaskQuotes(text: string, quotes: string[]): string {
  return text.replace(MASK, (_m, i: string) => quotes[Number(i)] ?? "");
}

/** Sentences of one text with their offsets, split the way the captions split them. */
export function sentenceSpans(
  text: string,
): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  const re = /(?<=[.!?]["”]?)\s+(?=[A-Z0-9"“'‘$£€])/g;
  let start = 0;
  for (const m of text.matchAll(re)) {
    const end = m.index!;
    if (text.slice(start, end).trim())
      out.push({ start, end, text: text.slice(start, end) });
    start = end + m[0].length;
  }
  if (text.slice(start).trim())
    out.push({ start, end: text.length, text: text.slice(start) });
  return out;
}

export const sentences = (text: string) =>
  sentenceSpans(text).map((s) => s.text.trim());

export const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** The first letter in upper case. */
export const capitalise = (s: string) =>
  s.replace(/^(\W*)([a-z])/, (_m, p: string, c: string) => p + c.toUpperCase());

/** Whether `index` in `text` starts a sentence (only spaces, quotes or nothing since the last stop). */
export function atSentenceStart(text: string, index: number): boolean {
  const before = text.slice(0, index);
  return /(^|[.!?]["”]?\s+)["“]?$/.test(before);
}

/** Tidy spacing and capitals after words are dropped. */
export function tidy(text: string): string {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(
      /([.!?]["”]?\s+)([a-z])/g,
      (_m, p: string, c: string) => p + c.toUpperCase(),
    )
    .replace(/^\s*,\s*/, "")
    .trim()
    .replace(/^([a-z])/, (c) => c.toUpperCase());
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A crude stem for repetition counting: "campaigns", "campaign's" and "campaign" are one word. */
export function stem(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’']s$/, "")
    .replace(/(?<=\w{4})(ies)$/, "y")
    .replace(/(?<=\w{4})(es|s)$/, "")
    .replace(/(?<=\w{4})(ing|ed)$/, "");
}
