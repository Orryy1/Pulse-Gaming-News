// What the thumbnail check's verdict does to a long video's thumbnails. The owner wants the series grid (the
// motif thumbnail, which is also the video's own title card): on Vice City (31 Oct 2026) the check failed it
// on every attempt and the factory fell straight back to the retro design. The check was right each time (the
// grid's biggest panel was the empty middle of a Steam logo banner, fixed in src/render/motifpictures.ts), but
// one weak picture should not cost the look. Now a failed grid gets one repair before anything else: the same
// grid in its next layout with the pictures in another order, rendered beside it and judged in the same call
// (THUMB_MOTIF_REPAIR). Only when that fails too does a Test & compare design take the main thumbnail's place.

/** The thumbnails after the check: the file to copy over the main one (if any) and the A/B variants kept. */
export interface ThumbOutcome {
  /** The file that becomes thumb.jpg, or undefined to keep it. */
  mainFrom?: string;
  /** The Test & compare designs left (failed ones and the one promoted are dropped). */
  variants: string[];
  /** The grid's own repair took the main thumbnail's place. */
  repaired: boolean;
}

export function thumbOutcome(input: {
  main: string;
  variants: string[];
  /** The motif repair rendered beside the main grid, when there is one; never a Test & compare variant. */
  repair?: string;
  bad: ReadonlySet<string | undefined>;
}): ThumbOutcome {
  const good = input.variants.filter((f) => !input.bad.has(f));
  if (!input.bad.has(input.main)) return { variants: good, repaired: false };
  if (input.repair && !input.bad.has(input.repair))
    return { mainFrom: input.repair, variants: good, repaired: true };
  const [first, ...rest] = good;
  return first
    ? { mainFrom: first, variants: rest, repaired: false }
    : { variants: good, repaired: false };
}

/** The repair's pictures: the same set from its second picture on, so every panel changes. */
export function repairPictures(pictures: string[]): string[] {
  return pictures.length > 1 ? [...pictures.slice(1), pictures[0]!] : pictures;
}
