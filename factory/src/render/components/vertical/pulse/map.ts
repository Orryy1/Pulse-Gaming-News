// The Short's beat as the Pulse universe's graphics read it (owner, 31 Oct 2026: bring the long videos' Pulse
// universe to the Shorts). The long-form packs (../../packs) draw a documentary sentence's MomentGraphic; a
// Short's beat has its own kinds (src/editorial/schema.ts VISUAL_KINDS). This file is the honest translation
// between the two and nothing more: every word the pack will draw comes from the beat, a date is written out
// from the beat's own ISO date, and a price keeps the beat's caption (or the fixed label "Listed price", which
// is what a price beat is). A beat that cannot be translated without inventing a word returns undefined, so
// the look is simply not offered. Pure: the planner (src/render/shortcraft.ts) imports it from Node.
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { VGfxProps } from "../types.ts";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-11-11" as "November 11, 2026", "2027-03" as "March 2027"; a year alone or nonsense: undefined. */
export function longDate(iso: string | undefined): string | undefined {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return undefined;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return undefined;
  const day = m[3] ? Number(m[3]) : undefined;
  return day
    ? `${MONTHS[month - 1]} ${day}, ${m[1]}`
    : `${MONTHS[month - 1]} ${m[1]}`;
}

/** The first year 1980-2049 a beat names in its credit or text: the year the story is from, when it says. */
export function namedYear(v: VGfxProps["v"]): number | undefined {
  const m = `${v.secondary} ${v.primary}`.match(/\b(19[89]\d|20[0-4]\d)\b/);
  return m ? Number(m[1]) : undefined;
}

/** The year whose look a Pulse card wears: the one the beat names, else the year the Short is made (news is now). */
export function storyYearOf(v: VGfxProps["v"], made: number): number {
  return namedYear(v) ?? made;
}

/** The pack graphic for a beat, as the pack kind `as` asks for, or undefined when the beat cannot be drawn that way. */
export function packGraphic(
  v: VGfxProps["v"],
  as: MomentGraphic["kind"],
): MomentGraphic | undefined {
  const primary = String(v.primary ?? "").trim();
  const secondary = String(v.secondary ?? "").trim();
  const items = (v.items ?? []).map((x) => String(x).trim()).filter(Boolean);
  if (!primary) return undefined;
  switch (as) {
    case "headline":
      return v.kind === "report"
        ? { kind: "headline", primary, secondary, items: [] }
        : undefined;
    case "quote":
      // A quote card shows the words without their quotation marks; the pack draws its own.
      return v.kind === "quote"
        ? {
            kind: "quote",
            primary: primary.replace(/^["“”']+|["“”']+$/g, "").trim(),
            secondary,
            items: [],
          }
        : undefined;
    case "date": {
      if (v.kind !== "date" && v.kind !== "countdown") return undefined;
      const when = longDate(v.date_to) ?? primary;
      return { kind: "date", primary: when, secondary, items: [] };
    }
    case "stat": {
      if (v.kind === "price") {
        const caption = /\b(price|cost|retail)\b/i.test(secondary)
          ? secondary
          : "Listed price";
        return { kind: "stat", primary, secondary: caption, items: [] };
      }
      // A sales figure: the caption already names what it counts.
      return v.kind === "stat"
        ? { kind: "stat", primary, secondary, items: [] }
        : undefined;
    }
    case "specs":
      return v.kind === "specs" && items.length >= 2
        ? {
            kind: "specs",
            primary,
            secondary,
            items: items.map((x) => x.replace(/\s*:\s*/, ": ")),
          }
        : undefined;
    default:
      return undefined;
  }
}
