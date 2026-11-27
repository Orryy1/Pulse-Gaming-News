// Which picture sits behind a kinetic card or a diagram (coordinator review, 31 Oct 2026: the first stills put
// the same piece of character key art, a cartoon woman with a pistol, behind card after card). Type reads best
// over a place: a skyline, a street, a car on a road. So the chooser scores the chapter's pictures by their
// kind and their label: game screenshots and photos of places first, key art, posters and capsules last,
// any label that names or shows a character pushed down, another game's pictures (fill/other) left out when
// the chapter's own will do, and pictures used on recent cards skipped so consecutive cards differ. Pure.

import { hash01 } from "./types.ts";

/** A picture as the episode stores it (src/assets/fill.ts Image, loosened). */
export interface BackdropImage {
  file: string;
  kind: string;
  label?: string;
  aspect?: number;
}

const SCENERY =
  /\b(skyline|street|streets|city|town|road|highway|freeway|bridge|traffic|car|cars|truck|van|bus|taxi|vehicle|vehicles|sedans?|pickup|helicopter|plane|boat|subway|train|downtown|building|buildings|tower|towers|beach|desert|coast|harbou?r|water|river|ocean|sunset|dusk|dawn|night|alley|neighbou?rhood|district|island|islands|map|aerial|skyscrapers?|office|offices|rooftops?|chase|blockade|landscape|mountains?|forest|countryside|interior|room|studio)\b/i;
const CHARACTER =
  /\b(woman|man|men|women|girl|boy|guy|person|character|protagonist|portrait|face|close-?up|cartoon|comic|stylized|stylised|illustration|artwork|poster|cover|logo|holding|aiming|firing|posing|pistol|shotgun|rifle|gun|weapon)\b/i;
// A capitalised first word followed by what a person does ("Claude holding", "Niko beside") is a named
// character, unless the word is a plain noun ("Cars in traffic", "Police officer").
const NAMED =
  /^([A-Z][a-z]+)\s+(holding|with|beside|running|standing|firing|sitting|walking|driving|aiming|in|on|at|and|looking|smiling)\b/;
const PLAIN_FIRST = new Set(
  "cars car police red green blue black white yellow orange grey gray pink purple subway train traffic city street empty busy night old new two three people players crowd office lower upper aerial".split(
    " ",
  ),
);

/** How well a picture carries type: higher is better. */
export function backdropScore(img: BackdropImage): number {
  const label = img.label ?? "";
  const path = img.file.replace(/\\/g, "/");
  let s = 0;
  if (img.kind === "screenshot") s += 2;
  else if (img.kind === "photo") s += 1;
  else s -= 3; // hero key art, capsules, posters
  if ((img.aspect ?? 1.78) < 1.2) s -= 6; // portrait art crops to a face
  if (/\/other\//.test(path)) s -= 4; // another game's pictures
  if (SCENERY.test(label)) s += 3;
  if (CHARACTER.test(label)) s -= 3;
  const named = label.match(NAMED);
  if (named && !PLAIN_FIRST.has(named[1]!.toLowerCase())) s -= 3;
  return s;
}

/**
 * The picture for the next card: the best-scoring one not among `used` (the files on recent cards, most
 * recent last), ties broken by the seed; when every picture has been used, the one used longest ago. Only
 * landscape pictures are considered. Undefined when there are none (the card then sits on brand ink).
 */
export function backdropFor(
  images: BackdropImage[],
  seed: number,
  used: string[] = [],
): string | undefined {
  const pool = images.filter(
    (i) => /\.(jpe?g|png|webp)$/i.test(i.file) && (i.aspect ?? 1.78) >= 1.2,
  );
  if (!pool.length) return undefined;
  const ranked = [...pool].sort(
    (a, b) =>
      backdropScore(b) - backdropScore(a) ||
      hash01(a.file, seed) - hash01(b.file, seed),
  );
  const fresh = ranked.filter((i) => !used.includes(i.file));
  // Rotate among the best few fresh ones, so a run of cards walks through the chapter's scenery.
  if (fresh.length) {
    const top = fresh
      .filter((i) => backdropScore(i) >= backdropScore(fresh[0]!) - 1)
      .slice(0, 4);
    return top[Math.floor(hash01(String(used.length), seed) * top.length)]!
      .file;
  }
  // All used: the one whose last use is oldest.
  return [...ranked].sort(
    (a, b) => used.lastIndexOf(a.file) - used.lastIndexOf(b.file),
  )[0]!.file;
}
