// The Short's picture in search (growth levers, 5 Nov 2026). The Shorts feed shows no thumbnail, but search does, and
// search is 106,644 of the channel's 123,530 thumbnail impressions in 28 days, at 1.5%. What it shows there today is
// frame 0 or a frame YouTube picked: four lines of small headline over a picture, a source line and a caption. At the
// size of a search tile that reads as grey. The best tile of those 28 days (Dark Souls servers, 8.1%) was one dragon
// filling the frame. So: a thumbnail made for that tile, one picture and the writer's 1-4 hook words, tested against the
// first frame on the same channel in the same weeks. An episode's arm comes from its id, so about half get each.
// SHORT_SEARCH_THUMB_SHARE sets the designed share (0: off, as before). The score is in src/reach.ts.
import { createHash } from "node:crypto";

export type ShortThumbArm = "designed" | "frame";

/** Which arm an episode is in (pure): the same id always lands the same way. */
export function shortThumbArm(episodeId: string, share: number): ShortThumbArm {
  if (share <= 0) return "frame";
  if (share >= 1) return "designed";
  const n = createHash("sha1")
    .update(`short-thumb:${episodeId}`)
    .digest()
    .readUInt16BE(0);
  return n / 65536 < share ? "designed" : "frame";
}

export interface ThumbImage {
  file: string;
  kind: string;
  aspect: number;
  wordy?: boolean;
}

// Kinds in the order a tile reads best: a game's own art, then its footage stills. A person's photo comes last: at this
// size a face without the game's picture says nothing about the game.
const kindRank = (kind: string): number => {
  if (/hero|key|art|cover|capsule|library/i.test(kind)) return 0;
  if (/screenshot|still|frame|shot/i.test(kind)) return 1;
  if (/person|photo|portrait|logo/i.test(kind)) return 3;
  return 2;
};

/** The picture for the tile (pure): no menus or screen text, the plan's hero when it qualifies, else the best kind. */
export function pickThumbImage(
  images: ThumbImage[] | undefined,
  heroIndex?: number,
): ThumbImage | undefined {
  const usable = (images ?? []).filter((i) => !i.wordy && i.file);
  if (!usable.length) return undefined;
  const hero = heroIndex === undefined ? undefined : images?.[heroIndex];
  if (hero && usable.includes(hero) && kindRank(hero.kind) <= 1) return hero;
  return [...usable].sort((a, b) => kindRank(a.kind) - kindRank(b.kind))[0];
}

/** The tile's words (pure): the writer's hook only, or nothing and the Short stays on its first frame. */
export function thumbWords(thumbText: string | undefined): string | undefined {
  const words = thumbText?.trim().replace(/\s+/g, " ");
  if (!words) return undefined;
  if (words.split(" ").length > 4 || words.length > 26) return undefined;
  return words.toUpperCase();
}
