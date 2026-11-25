// The hard cap on one picture in a long video (LONG_STILL_MAX_SHOWS, 25 Nov 2026). The Mass Effect ranking
// (UVB7zlh3ssU) showed one IGDB screenshot of Mass Effect Galaxy 11 times for 52 s and another 9 times: the planner
// counted uses per list entry, and the thin-entry top-up had downloaded the same IGDB pictures again into a "more"
// folder (and the sentence top-up into "fill"), so one picture was three entries with three counts. This names a
// picture by where it came from, so every copy counts as one, and holds the rules the planner applies at the cap.
// Pure, and free of node modules: the planner imports it.

/**
 * Where a picture came from, as one name for every copy of it (pure). Only the picture servers whose addresses name
 * one picture are folded together (IGDB's sizes, Steam's sizes and cache-busting queries); any other source keeps its
 * whole address, and a picture cut from footage (a portrait, a trailer frame: their source is the video they came
 * from) is its own file, so two faces cut from one trailer are never one picture.
 */
export function pictureKey(img: {
  sourceUrl?: string;
  file?: string;
  kind?: string;
  frame?: boolean;
}): string {
  const url = img.sourceUrl?.trim();
  const cut = img.kind === "portrait" || img.frame === true;
  if (url && !cut) {
    // IGDB serves one image under many sizes: images.igdb.com/igdb/image/upload/t_1080p/<id>.jpg
    const igdb = url.match(
      /images\.igdb\.com\/.*\/([a-z0-9]+)\.(?:jpe?g|png|webp)(?:$|\?)/i,
    );
    if (igdb) return `igdb:${igdb[1]!.toLowerCase()}`;
    try {
      const u = new URL(url);
      // Steam's store pictures come in sizes (ss_<hash>.1920x1080.jpg, ss_<hash>.600x338.jpg) with varying queries.
      if (
        /(^|\.)(steamstatic\.com|steampowered\.com)$/i.test(u.hostname) &&
        /\.(jpe?g|png|webp)$/i.test(u.pathname)
      )
        return `u:${u.host}${u.pathname.replace(/\.\d+x\d+(?=\.(?:jpe?g|png|webp)$)/i, "")}`.toLowerCase();
    } catch {
      // not an address: the whole string below
    }
    return `u:${url}`;
  }
  const name = img.file?.split(/[\\/]/).pop() ?? "";
  // A picture downloaded twice keeps its source's name (igdb-<id>.jpg): one picture to the viewer.
  if (/^igdb-/i.test(name))
    return `igdb:${name
      .replace(/^igdb-/i, "")
      .replace(/\.[a-z]+$/i, "")
      .toLowerCase()}`;
  return `f:${img.file ?? ""}`;
}

/** How long a picture must have been off screen before the depth camera may show it once more past the cap. */
export const RESHOW_GAP_SECONDS = 60;

/** The result of asking the cap for a still, for the plan's notes. */
export interface StillCapNotes {
  /** Showings past the cap on the depth camera (a picture not seen for RESHOW_GAP_SECONDS, one extra time). */
  reshows: number;
  /** Showings past even that, because the chapter had nothing else at all: what the thin-entry top-up should fix. */
  overCap: number;
}

/**
 * Which of `pool` may go on screen now under the cap (pure): pictures shown fewer than `max` times, least shown first;
 * when none is left, one more showing of a picture off screen for RESHOW_GAP_SECONDS (on the depth camera, which films
 * each shot on a new path), marked `reshow`. Empty when even that is spent: the caller then takes footage, a filler or,
 * last of all, counts a repeat.
 */
export function capPool(
  pool: readonly number[],
  keyOf: (k: number) => string,
  shows: ReadonlyMap<string, number>,
  lastShown: ReadonlyMap<string, number>,
  at: number,
  max: number,
  fps: number,
): { pool: number[]; reshow: boolean } {
  if (max <= 0) return { pool: [...pool], reshow: false };
  const n = (k: number) => shows.get(keyOf(k)) ?? 0;
  const under = pool.filter((k) => n(k) < max);
  if (under.length) return { pool: under, reshow: false };
  const gap = RESHOW_GAP_SECONDS * fps;
  const again = pool.filter((k) => {
    const last = lastShown.get(keyOf(k));
    return n(k) < max + 1 && (last === undefined || at - last >= gap);
  });
  return { pool: again, reshow: again.length > 0 };
}
