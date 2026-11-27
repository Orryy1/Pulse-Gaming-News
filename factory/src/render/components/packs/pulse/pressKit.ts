// Pure helpers for the Pulse press styles (./press.ts): who the story is credited to, which period look a
// year gets, and the fits rules. No React here, so the tests can check every rule without a renderer.
import type { MomentGraphic } from "../../LongMoments.tsx";
import { txt, wordCount } from "../screen/common.ts";
import { outletOf } from "../screen/PhoneStory.tsx";

const YEAR = /\b(19[89]\d|20[0-4]\d)\b/;

/**
 * A headline's credit split up: the outlet the SOURCE names (none when the credit is only a year), and the
 * year written in the credit itself. A year inside the headline ("GTA IV delayed to 2008") is not a cover date.
 */
export function pressCredit(g: MomentGraphic): {
  credit: string;
  outlet?: string;
  year?: number;
} {
  const credit = txt(g.secondary);
  const m = credit.match(YEAR);
  const o = credit ? outletOf(credit, "headline") : "NEWS";
  return {
    credit,
    outlet: o === "NEWS" || YEAR.test(o) ? undefined : o,
    year: m ? Number(m[0]) : undefined,
  };
}

/** The magazine's period: chunky chrome in the 80s, loud and outlined in the 90s, glossy photo covers after. */
export type CoverLook = "eighties" | "nineties" | "glossy";

export function coverLook(year: number | undefined): CoverLook {
  const y = year ?? 1998;
  return y <= 1989 ? "eighties" : y <= 1999 ? "nineties" : "glossy";
}

/** The television's period: a wood-grain cabinet with dials, then a black plastic set with buttons. */
export type TvLook = "wood" | "plastic";

export function tvLook(year: number | undefined): TvLook {
  return (year ?? 1998) <= 1992 ? "wood" : "plastic";
}

/** A games shop's shelf by year: big cardboard boxes, then slim plastic cases; a storefront app from 2009. */
export type StoreLook = "bigbox" | "case" | "glossy" | "flat";

export function storeLook(year: number | undefined): StoreLook {
  const y = year ?? 2012;
  if (y <= 1999) return "bigbox";
  if (y <= 2008) return "case";
  return y <= 2015 ? "glossy" : "flat";
}

const MONEY = /[$£€¥]|\b(dollars?|pounds?|euros?)\b/i;
const PRICE_WORDS =
  /\b(price[ds]?|pricing|costs?|costing|retail(ed|s|ing)?|launch price)\b/i;
const SALES_WORDS = /\b(copies|sold|sales|units)\b/i;
const NUMBER = /\d|\b(million|billion|thousand|hundred)\b/i;

/**
 * Which shop graphic a stat is: a price (the figure holds a currency sign or the word dollars, pounds or euros
 * and the caption says price, cost or retail) or a sales figure (the caption says copies, sold, sales or units).
 * Anything else is not a shop's to show.
 */
export function storeCase(g: MomentGraphic): "price" | "sales" | undefined {
  if (g.kind !== "stat") return undefined;
  const fig = txt(g.primary);
  const what = txt(g.secondary);
  if (!fig || !what || !NUMBER.test(fig)) return undefined;
  if (fig.length > 24 || what.length > 48) return undefined;
  const n = wordCount(what);
  if (n < 2 || n > 8) return undefined;
  if (MONEY.test(fig) && PRICE_WORDS.test(what)) return "price";
  if (SALES_WORDS.test(what)) return "sales";
  return undefined;
}

/**
 * A sales figure earns the BEST SELLER ribbon only when it counts copies in the millions; a smaller one, or
 * money taken, gets a plain SALES ribbon, so the badge never claims more than the figure says.
 */
export function bestSeller(g: MomentGraphic): boolean {
  const fig = txt(g.primary);
  const what = txt(g.secondary);
  if (MONEY.test(fig) || !/\b(copies|units|sold)\b/i.test(what)) return false;
  if (/\b(million|billion)\b/i.test(fig)) return true;
  const digits = fig.replace(/[^\d.]/g, "");
  return (
    /^\d[\d,]*$/.test(fig.replace(/\s/g, "")) && Number(digits) >= 1_000_000
  );
}

/** A headline of 4-12 words as the cover line; a credit short enough for the story strip. */
export const fitsPulseMonthly = (g: MomentGraphic) => {
  if (g.kind !== "headline") return false;
  const h = txt(g.primary);
  const n = wordCount(h);
  return n >= 4 && n <= 12 && h.length <= 90 && txt(g.secondary).length <= 48;
};

/** A headline of 3-14 words for the lower third and the ticker; a short credit line. */
export const fitsPulseTV = (g: MomentGraphic) => {
  if (g.kind !== "headline") return false;
  const h = txt(g.primary);
  const n = wordCount(h);
  return n >= 3 && n <= 14 && h.length <= 110 && txt(g.secondary).length <= 48;
};

/** A price or a sales figure (see storeCase); any other stat is drawn by another style. */
export const fitsPulseStore = (g: MomentGraphic) => storeCase(g) !== undefined;
