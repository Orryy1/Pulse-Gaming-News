// Whether the long video draws a sentence's graphic at all, the way src/render/Long.tsx picks its style
// (packFor): the house kinds (stat, date, quote, headline and the rest) always have a design, but the suite's
// own kinds (a map, bar chart, share, spec sheet or lineage) draw only when a pack style, or the entry's motif
// style, fits the graphic and the story's years. The graphics check uses it to skip a sentence that draws
// nothing: on Vice City (31 Oct 2026) such a still showed only gameplay, and the checker muted the "graphic"
// for the game's own caption.

import type { Segment } from "./timeline.ts";
import { displayText } from "./timeline.ts";
import { entryOf } from "./longplan.ts";
import { ALL_STYLES } from "./components/packs/index.ts";
import { inEra } from "./components/packs/types.ts";
import { storyYear } from "./components/packs/screen/OldWeb.tsx";
import { motifsFor } from "./components/motifs/index.ts";
import type { MomentGraphic } from "./components/LongMoments.tsx";

/** The graphic kinds with no house design: they draw only through a pack or motif style. */
export const SUITE_KINDS = new Set([
  "map",
  "bars",
  "share",
  "specs",
  "lineage",
]);

/**
 * A predicate for one video: does entry `e`'s sentence graphic `g` get drawn? Mirrors Long.tsx (motifOf,
 * entryTitle and packFor's filters), so a change there belongs here too.
 */
export function graphicDrawsFor(
  segments: Segment[],
  theme: string,
): (entry: number, g: MomentGraphic) => boolean {
  type Entry = { title: string; platforms: string; year?: number; found: boolean };
  const info = new Map<number, Entry>();
  const entryInfo = (e: number): Entry => {
    const known = info.get(e);
    if (known) return known;
    const k = segments.findIndex(
      (x, i) =>
        x.kind === "beat" &&
        (x.visual?.kind === "chapter" || x.visual?.kind === "rank") &&
        entryOf(segments, i) === e,
    );
    const v = k >= 0 ? segments[k]!.visual : undefined;
    const out = {
      title: displayText((v?.kind === "rank" ? v.primary : v?.secondary) ?? ""),
      platforms: v?.items?.[1] ?? "",
      year: Number(v?.items?.[0]) || undefined,
      found: !!v,
    };
    info.set(e, out);
    return out;
  };
  return (entry, g) => {
    if (!SUITE_KINDS.has(g.kind)) return true;
    const e = entryInfo(entry);
    const year = storyYear(g, e.year);
    const fits = (s: (typeof ALL_STYLES)[string]) =>
      s.kind === g.kind && (!s.fits || s.fits(g)) && inEra(s, year);
    if (Object.values(ALL_STYLES).some(fits)) return true;
    const motif = e.found
      ? motifsFor({ title: e.title, platforms: e.platforms, year: e.year, theme })[0]
      : undefined;
    return Object.values(motif?.styles ?? {}).some(fits);
  };
}
