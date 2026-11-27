// The checkable claims in a line of script (pure): quotes and who said them, prices, release years and sales counts.

import {
  AT_LEAST,
  AT_MOST,
  COUNT_SPOKEN,
  HEDGE_BEFORE,
  MONEY_SPOKEN,
  MONEY_WRITTEN,
  OUTLET_PATTERN,
  PLAYERS_CONTEXT,
  PORT_CONTEXT,
  QUOTE_SPAN,
  REGION_WORDS,
  RELEASE_CONTEXT,
  SALES_CONTEXT,
  SALES_DIGITS,
  type ClaimKind,
} from "./patterns.ts";
import { currencyOf, moneyValue, wordsToNumber, yearsIn } from "./normalise.ts";

export type Hedge = "at_least" | "at_most" | "about" | undefined;

interface Base {
  kind: ClaimKind;
  /** The exact text in the line, which a fix replaces. */
  span: string;
  line: string;
}
export interface QuoteClaim extends Base {
  kind: "quote";
  words: string;
  outlet?: string;
}
export interface PriceClaim extends Base {
  kind: "price";
  amount: number;
  currency: "USD" | "GBP" | "EUR";
  spoken: boolean;
  hedge: Hedge;
}
export interface YearClaim extends Base {
  kind: "year";
  year: number;
  region?: string;
  port: boolean;
}
export interface SalesClaim extends Base {
  kind: "sales";
  count: number;
  players: boolean;
  hedge: Hedge;
  /** The number part of the span ("25 million"), which a fix replaces. */
  figure: string;
}
export type Claim = QuoteClaim | PriceClaim | YearClaim | SalesClaim;

function hedgeAt(line: string, index: number): Hedge {
  const before = line.slice(Math.max(0, index - 24), index);
  if (AT_LEAST.test(before)) return "at_least";
  if (AT_MOST.test(before)) return "at_most";
  if (HEDGE_BEFORE.test(before)) return "about";
  return undefined;
}

/** The outlet a line credits ("GameSpot's review called it..."), if any. */
export function outletIn(line: string): string | undefined {
  return line.match(OUTLET_PATTERN)?.[1];
}

export function regionIn(line: string): string | undefined {
  for (const [re, key] of REGION_WORDS) if (re.test(line)) return key;
  return undefined;
}

/** Every claim in one line. */
export function extractClaims(line: string): Claim[] {
  const out: Claim[] = [];
  const outlet = outletIn(line);
  for (const m of line.matchAll(QUOTE_SPAN)) {
    const words = m[1]!.trim();
    if (words.split(/\s+/).length < 2) continue; // a single quoted word is a title or a term, not a quotation
    out.push({
      kind: "quote",
      span: m[0],
      words,
      line,
      ...(outlet ? { outlet } : {}),
    });
  }
  for (const m of line.matchAll(MONEY_WRITTEN)) {
    if (m[3]) continue; // "$750 million" is revenue, not a price
    const currency = currencyOf(m[1]!);
    if (!currency) continue;
    out.push({
      kind: "price",
      span: m[0].trim(),
      amount: moneyValue(m[2]!),
      currency,
      spoken: false,
      hedge: hedgeAt(line, m.index ?? 0),
      line,
    });
  }
  for (const m of line.matchAll(MONEY_SPOKEN)) {
    let lead = m[1]!;
    let span = m[0];
    // "fun and two dollars": the joining word is not part of the amount.
    const trimmed = lead.replace(/^(?:(?:and|a)[ -])+/i, "");
    span = span.slice(lead.length - trimmed.length);
    lead = trimmed;
    const whole = wordsToNumber(lead.split(/\s+/));
    if (whole === undefined) continue;
    if (/\b(million|billion)\b/i.test(lead)) continue; // "two million dollars" is revenue, not a price
    const cents = m[3] ? wordsToNumber(m[3].split(/\s+/)) : undefined;
    const currency = currencyOf(m[2]!);
    if (!currency) continue;
    const amount =
      cents !== undefined && cents < 100 ? whole + cents / 100 : whole;
    const index = (m.index ?? 0) + (m[0].length - span.length);
    out.push({
      kind: "price",
      span: span.trim(),
      amount,
      currency,
      spoken: true,
      hedge: hedgeAt(line, index),
      line,
    });
  }
  if (RELEASE_CONTEXT.test(line)) {
    const region = regionIn(line);
    const port = PORT_CONTEXT.test(line);
    for (const y of yearsIn(line))
      out.push({
        kind: "year",
        span: y.span,
        year: y.year,
        line,
        port,
        ...(region ? { region } : {}),
      });
  }
  const sales = SALES_CONTEXT.test(line);
  const players = PLAYERS_CONTEXT.test(line);
  if (sales || players) {
    for (const m of line.matchAll(SALES_DIGITS)) {
      const scale = /^b/i.test(m[2]!) ? 1e9 : 1e6;
      const n = Number(m[1]!.replace(",", ".")) * scale;
      if (!Number.isFinite(n)) continue;
      out.push({
        kind: "sales",
        span: m[0].trim(),
        figure: `${m[1]} ${m[2]}`,
        count: n,
        players: players && !sales,
        hedge: hedgeAt(line, m.index ?? 0),
        line,
      });
    }
    for (const m of line.matchAll(COUNT_SPOKEN)) {
      const n = wordsToNumber([...m[1]!.split(/\s+/), m[2]!]);
      if (n === undefined) continue;
      out.push({
        kind: "sales",
        span: m[0].trim(),
        figure: `${m[1]} ${m[2]}`,
        count: n,
        players: players && !sales,
        hedge: hedgeAt(line, m.index ?? 0),
        line,
      });
    }
  }
  return out;
}

/** A script's lines: everything a viewer hears or reads, one string per line. */
export function linesOf(texts: readonly string[]): string[] {
  return texts
    .flatMap((t) => t.split(/\n+/))
    .flatMap((t) => t.split(/(?<=[.!?][”"’]?)\s+(?=[A-Z“"])/))
    .map((t) => t.trim())
    .filter(Boolean);
}
