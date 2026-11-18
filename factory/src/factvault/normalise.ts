// Turning names, numbers, years, prices and quotes into forms the vault can compare (pure).

import { nameWords } from "../assets/steam.ts";
import {
  ARCHIVE_URL,
  DATE_ISO,
  DATE_WORDS,
  MONTHS,
  NUMBER_WORD,
  SOURCE_TYPE_BY_URL,
  REVIEW_URL,
  WAYBACK_ORIGINAL,
  WIKIPEDIA_URL,
  YEAR_DIGITS,
  YEAR_SPOKEN,
  type SourceType,
} from "./patterns.ts";

/** "Fallout: New Vegas" -> "fallout-new-vegas"; "Grand Theft Auto VI" -> "grand-theft-auto-6". */
export function entityKey(name: string): string {
  return nameWords(name.replace(/[™®©]/g, "").replace(/&/g, " and ")).join("-");
}

/** The id an entity is stored under. */
export function entityId(kind: string, name: string): string {
  return `${kind}:${entityKey(name)}`;
}

/** Keys a game is also known by: "grand theft auto 6" is also "gta 6", "call of duty 4" is also "cod 4". */
export function aliasKeys(
  name: string,
  extra: readonly string[] = [],
): string[] {
  const keys = new Set<string>([entityKey(name), ...extra.map(entityKey)]);
  for (const k of [...keys]) {
    if (k.startsWith("grand-theft-auto"))
      keys.add(k.replace(/^grand-theft-auto/, "gta"));
    if (k.startsWith("call-of-duty"))
      keys.add(k.replace(/^call-of-duty/, "cod"));
    if (k.startsWith("legend-of-zelda-"))
      keys.add(k.replace(/^legend-of-zelda-/, "zelda-"));
    if (k.startsWith("pokemon-") || k.startsWith("pokémon-"))
      keys.add(k.replace(/^pok[eé]mon-/, "pokemon-"));
  }
  return [...keys].filter(Boolean);
}

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  a: 1,
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

/** "twenty-five" -> 25, "one hundred" -> 100, "two point five" is not handled (undefined when no number). */
export function wordsToNumber(words: readonly string[]): number | undefined {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const raw of words) {
    for (const w of raw.toLowerCase().split("-")) {
      if (w === "and" || w === "") continue;
      if (w in UNITS) {
        current += UNITS[w]!;
        seen = true;
      } else if (w in TENS) {
        current += TENS[w]!;
        seen = true;
      } else if (w === "hundred") {
        current = (current || 1) * 100;
        seen = true;
      } else if (w === "thousand") {
        total += (current || 1) * 1000;
        current = 0;
        seen = true;
      } else if (w === "million") {
        total += (current || 1) * 1_000_000;
        current = 0;
        seen = true;
      } else if (w === "billion") {
        total += (current || 1) * 1_000_000_000;
        current = 0;
        seen = true;
      } else return undefined;
    }
  }
  return seen ? total + current : undefined;
}

/** Whether a token is a spoken number word ("twenty-five" counts). */
export function isNumberWord(token: string): boolean {
  return token.split("-").every((p) => NUMBER_WORD.test(p));
}

/** A spoken year as a number: "twenty nineteen" -> 2019, "two thousand and eight" -> 2008, "nineteen ninety-seven" -> 1997. */
export function spokenYear(text: string): number | undefined {
  const t = text.toLowerCase().replace(/-/g, " ").trim();
  const thousand = t.match(/^two thousand(?: and)?(?: (\w+))?$/);
  if (thousand) return 2000 + (thousand[1] ? (UNITS[thousand[1]] ?? 0) : 0);
  const [first, ...rest] = t.split(/\s+/);
  const century =
    first === "nineteen" ? 1900 : first === "twenty" ? 2000 : undefined;
  if (century === undefined) return undefined;
  const tail = rest.filter((w) => w !== "o" && w !== "oh");
  const n = wordsToNumber(tail);
  if (n === undefined || n > 99) return undefined;
  return century + n;
}

/** Every year a line names, written or spoken, with the text that names it. */
export function yearsIn(
  text: string,
): Array<{ year: number; span: string; index: number }> {
  const out: Array<{ year: number; span: string; index: number }> = [];
  for (const m of text.matchAll(YEAR_DIGITS))
    out.push({ year: Number(m[1]), span: m[0], index: m.index ?? 0 });
  for (const m of text.matchAll(YEAR_SPOKEN)) {
    const y = spokenYear(m[0]);
    if (y && y >= 1970 && y <= 2049)
      out.push({ year: y, span: m[0], index: m.index ?? 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** A loose date: { year, month?, day? } from "September 30, 1997", "30 Sept 1997", "1997-09-30" or "1997". */
export interface LooseDate {
  year: number;
  month?: number;
  day?: number;
}

export function datesIn(text: string): LooseDate[] {
  const out: LooseDate[] = [];
  for (const m of text.matchAll(DATE_WORDS)) {
    const month =
      MONTHS.findIndex((x) => x.startsWith(m[2]!.toLowerCase().slice(0, 3))) +
      1;
    const day = Number(m[1] ?? m[3] ?? 0) || undefined;
    out.push({
      year: Number(m[4]),
      month,
      ...(day && day <= 31 ? { day } : {}),
    });
  }
  for (const m of text.matchAll(DATE_ISO)) {
    out.push({
      year: Number(m[1]),
      month: Number(m[2]),
      ...(m[3] ? { day: Number(m[3]) } : {}),
    });
  }
  return out;
}

/** "1997-09-30", "1997-09" or "1997". */
export function isoOf(d: LooseDate): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return d.month
    ? d.day
      ? `${d.year}-${p(d.month)}-${p(d.day)}`
      : `${d.year}-${p(d.month)}`
    : String(d.year);
}

/** "30 September 1997" for a writer, British order. */
export function dateWords(d: LooseDate): string {
  const month = d.month ? MONTHS[d.month - 1]! : "";
  const cap = month ? month[0]!.toUpperCase() + month.slice(1) : "";
  return [d.day, cap, d.year].filter(Boolean).join(" ");
}

/** A quote reduced for comparison: case, curly quotes, dashes, spacing and edge punctuation ignored. */
export function normaliseQuote(q: string): string {
  return q
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…|\.\.\./g, " ")
    .replace(/[^a-z0-9'$%£€\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Page text reduced the same way, so a stored quote can be found in it. */
export const normaliseText = normaliseQuote;

/** "$1,299.99" -> 1299.99. */
export function moneyValue(digits: string): number {
  return Number(digits.replace(/,/g, ""));
}

/** The currency for a symbol or word. */
export function currencyOf(
  symbolOrWord: string,
): "USD" | "GBP" | "EUR" | undefined {
  const s = symbolOrWord.toLowerCase();
  if (s === "$" || s.startsWith("dollar") || s === "bucks") return "USD";
  if (s === "£" || s.startsWith("pound") || s === "quid") return "GBP";
  if (s === "€" || s.startsWith("euro")) return "EUR";
  return undefined;
}

/** "$1.99" for a writer and a narrator. */
export function moneyText(amount: number, currency: string): string {
  const sym = currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";
  return `${sym}${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2)}`;
}

/** The address a fact is credited to: the original, never the Wayback copy (the copy is how we read it). */
export function originalUrl(url: string): string {
  return url.match(WAYBACK_ORIGINAL)?.[1] ?? url;
}

/** Whether an address can be a fact's source: never Wikipedia, never an archive with no original inside. */
export function sourceAllowed(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (WIKIPEDIA_URL.test(url)) return false;
  if (ARCHIVE_URL.test(url) && !WAYBACK_ORIGINAL.test(url)) return false;
  return true;
}

/** What kind of source an address is: a review, a publisher's post, an earnings report, a store page, or news. */
export function sourceTypeOf(
  url: string,
  hint?: { review?: boolean; outletIsPublisher?: boolean },
): SourceType {
  const u = originalUrl(url);
  for (const [re, type] of SOURCE_TYPE_BY_URL) if (re.test(u)) return type;
  if (hint?.review || REVIEW_URL.test(u)) return "review";
  if (hint?.outletIsPublisher) return "publisher_post";
  return "news_report";
}

/** How much a source type is trusted before any other evidence (the fact's starting confidence). */
export const SOURCE_TRUST: Record<SourceType, number> = {
  publisher_post: 0.9,
  earnings_call: 0.95,
  press_kit: 0.9,
  official_site: 0.85,
  store_page: 0.85,
  review: 0.9, // for what the review itself says (its score, its words)
  review_aggregate: 0.85,
  interview: 0.8,
  news_report: 0.65,
  database: 0.6,
};

/** Types a fact checker may lean on without a second source. */
export const PRIMARY_TYPES: ReadonlySet<SourceType> = new Set([
  "publisher_post",
  "earnings_call",
  "press_kit",
  "official_site",
  "store_page",
  "review",
  "review_aggregate",
  "interview",
]);
