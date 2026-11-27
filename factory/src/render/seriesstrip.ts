// The series cover strip (format plan, 11 Nov 2026, item 5): fast growers use one cover box on every post, so a
// viewer knows the series before reading a word. On a series Short's opening poster and its search thumbnail an
// amber strip names the series and, when numbering is on, the part ("THE WHY #24"), always in the same place: just
// under the brand band, above the headline. Buy, Wait or Skip adds the price in amber beside it. Pure and
// browser-safe, so the composition, the thumbnail and the tests read the same rules.

/** What a cover's strip says. Absent on Shorts outside a series, or with SERIES_COVER_STYLE off. */
export type SeriesCover = {
  /** The series' name in capitals, e.g. "THE WHY". */
  label: string;
  /** The part number, when SERIES_EPISODE_NUMBERS is on and the count is known. */
  number?: number;
  /** Buy, Wait or Skip: the price the verdict is about, dollars first (e.g. "$9.99"). */
  price?: string;
};

/** The strip's top on the 1080x1920 Short: under the brand band (150-300), above the poster's words (420). */
export const STRIP_TOP = 312;
export const STRIP_HEIGHT = 84;
/** On the 720x1280 search thumbnail, scaled from the Short: the same place on a smaller canvas. */
export const THUMB_STRIP_TOP = 150;
export const THUMB_STRIP_HEIGHT = 64;

/** The strip's words (pure): the series name, then the part number when there is one. */
export function stripText(cover: SeriesCover): string {
  const label = cover.label.trim().toUpperCase();
  const n = cover.number;
  return typeof n === "number" && Number.isInteger(n) && n > 0
    ? `${label} #${n}`
    : label;
}

/** The strip's type size: the largest that fits the width, Anton at about 0.5 em a capital (pure). */
export function stripFontSize(
  text: string,
  width: number,
  max: number,
  min = 34,
): number {
  const per = 0.5;
  const size = Math.floor(width / Math.max(1, text.length * per));
  return Math.max(min, Math.min(max, size));
}
