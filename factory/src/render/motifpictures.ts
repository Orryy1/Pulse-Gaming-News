// Which pictures fill a motif's panels (the GTA cover grid, a console's tiles), on the video's title card and
// on its thumbnail. Until 1 Nov 2026 it was simply the first six wide pictures, and on a documentary those are
// the Steam library heroes (3.1:1 banners) that the media step fetches first. A library hero leaves its middle
// empty and soft for the game's logo; cropped into a tall comic panel, only that middle shows. The thumbnail
// check failed the Vice City grid on every attempt for exactly that ("the large top-left panel is a blurred
// purple-pink wash with slivers of figures at both edges"), and the factory fell back to another design.
// Now pictures near the panels' shape come first, one from each chapter in turn so the grid shows the whole
// series, gameplay before key art (key art and trailer thumbnails carry logos and dates that a panel crops to
// fragments, and the Halo grid's backdrop printed "CAMPAIGN EVOLVED" behind the title), the topic's own
// pictures after the chapters', and the logo banners only fill what is left.

/** What the order needs to know about a picture. */
export interface MotifPictureCandidate {
  kind: string;
  aspect: number;
  /** The entry (chapter) the picture belongs to; undefined for the topic's own. */
  beatIndex?: number;
}

/** The kinds of picture a panel can hold (no capsules, portraits or photos of people). */
export const MOTIF_PICTURE_KINDS = ["hero", "screenshot", "article", "header"];
/** Wider than this, a picture is a logo banner (a Steam library hero) with an empty middle. */
export const LOGO_BANNER_ASPECT = 2.4;
/** Gameplay first; key art, store headers and article pictures (often with words on them) after. */
const KIND_RANK: Record<string, number> = { screenshot: 0, hero: 1, article: 2, header: 3 };

/**
 * Up to `max` pictures for a motif's panels, best first: wide but not banner-wide pictures, one from each
 * chapter in turn (gameplay first within a chapter), then the topic's own; then the banners, in the same
 * rotation.
 */
export function motifPictureOrder<T extends MotifPictureCandidate>(
  images: T[],
  max = 6,
): T[] {
  const eligible = images.filter(
    (i) =>
      Number.isFinite(i.aspect) &&
      i.aspect >= 1.3 &&
      MOTIF_PICTURE_KINDS.includes(i.kind),
  );
  const rotate = (list: T[]): T[] => {
    const groups = new Map<string, T[]>();
    for (const i of list) {
      const key = i.beatIndex === undefined ? "topic" : String(i.beatIndex);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    }
    for (const g of groups.values())
      g.sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9));
    // The chapters in order, then the topic's own pictures.
    const order = [...groups.keys()].sort((a, b) =>
      a === "topic" ? 1 : b === "topic" ? -1 : Number(a) - Number(b),
    );
    const out: T[] = [];
    for (let round = 0; out.length < list.length; round++)
      for (const key of order) {
        const g = groups.get(key)!;
        if (g[round]) out.push(g[round]!);
      }
    return out;
  };
  return [
    ...rotate(eligible.filter((i) => i.aspect <= LOGO_BANNER_ASPECT)),
    ...rotate(eligible.filter((i) => i.aspect > LOGO_BANNER_ASPECT)),
  ].slice(0, Math.max(0, max));
}
