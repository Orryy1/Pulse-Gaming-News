// Pure helpers for the data cards. No Remotion imports, so the pipeline and
// the tests can use them without a composition context.

import { COLOUR } from "../../brand.ts";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2027-03" or "2027-03-14" or "2027" -> "MAR 2027" / "14 MAR 2027" / "2027"; anything else is shown as typed. */
export function dateLabel(iso: string): string {
  const m = iso.trim().match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return iso.toUpperCase();
  const [, y, mo, d] = m;
  if (!mo) return y!;
  const month = MONTHS_SHORT[Number(mo) - 1] ?? mo;
  return `${d ? `${Number(d)} ` : ""}${month} ${y}`.toUpperCase();
}

/** Months between two ISO dates (year-month precision), signed. */
export function monthsBetween(from: string, to: string): number | undefined {
  const a = from.match(/^(\d{4})(?:-(\d{2}))?/);
  const b = to.match(/^(\d{4})(?:-(\d{2}))?/);
  if (!a || !b) return undefined;
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2] ?? "6") - Number(a[2] ?? "6"));
}

/** Whole days from `renderDate` to `target` (both ISO), or undefined when either is not a full date. */
export function daysUntil(target: string, renderDate: string): number | undefined {
  const a = target.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const b = renderDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!a || !b) return undefined;
  const t = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const r = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((t - r) / 86_400_000);
}

/** Review-score band colour: 80+ green, 60-79 amber, below 60 red. */
export function bandColour(score: number): string {
  return score >= 80 ? COLOUR.up : score >= 60 ? COLOUR.amber : COLOUR.alert;
}

export interface BarRow {
  label: string;
  value: number;
  display: string; // as written in the script, e.g. "£69.99" or "12m"
  highlight?: boolean;
}

/** Parses "label:value" rows; a leading "*" marks the highlighted row. Non-numeric values are skipped. */
export function parseBars(items: string[]): BarRow[] {
  const rows: BarRow[] = [];
  for (const raw of items) {
    const i = raw.lastIndexOf(":");
    if (i < 0) continue;
    let label = raw.slice(0, i).trim();
    const display = raw.slice(i + 1).trim();
    // "1.4k", "12m", "2bn" and "3 million" scale the number; a bare currency or count does not.
    const unit = /\d\s*(bn|b)\b/i.test(display) ? 1e9 : /\d\s*(m|million)\b/i.test(display) ? 1e6 : /\d\s*k\b/i.test(display) ? 1e3 : 1;
    const num = Number(display.replace(/[^\d.]/g, "")) * unit;
    if (!label || !Number.isFinite(num) || !/\d/.test(display)) continue;
    const highlight = label.startsWith("*");
    if (highlight) label = label.slice(1).trim();
    rows.push({ label, value: num, display, highlight });
  }
  if (rows.length && !rows.some((r) => r.highlight)) rows[0]!.highlight = true;
  return rows.slice(0, 5);
}

/**
 * The same price in the other currencies: the writer's own figures from the
 * sources first, else Steam's regional prices, but only when the card's price
 * is one of Steam's (so a DLC price never borrows the base game's).
 */
export function otherCurrencies(primary: string, items: string[] | undefined, steam?: { usd?: string; gbp?: string; eur?: string }): string[] {
  const p = primary.trim();
  const money = (x: string) => /^[$£€]\s?\d/.test(x.trim());
  const own = (items ?? []).map((x) => x.trim()).filter((x) => money(x) && x !== p);
  if (own.length) return own.slice(0, 2);
  const all = [steam?.usd, steam?.gbp, steam?.eur].filter((x): x is string => Boolean(x));
  if (!all.includes(p)) return [];
  return all.filter((x) => x !== p).slice(0, 2);
}
