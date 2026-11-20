// The geometry of the hero poster thumbnail (THUMB_HERO_RULE, src/qa/thumbrule.ts has the rule): where the picture
// sits so its subject lands large on one side, and how big the words can be on the other. Pure, because the design
// (src/render/ThumbStudio.tsx) draws from it and the check measures the finished thumbnail in the same place.

export const POSTER_W = 1280;
export const POSTER_H = 720;
/** Anton's capitals: width per letter and height, in font sizes. */
const CHAR_EM = 0.47;
export const CAP_EM = 0.86;
const LINE_EM = 1.08;
/** The words' column: room for 2-4 big words, clear of the subject. */
const TEXT_W = 680;
const TEXT_H = 520;
const MAX_FONT = 230;
const MARGIN = 46;
/** How far the art may be enlarged to move its subject off the words. */
const MAX_ZOOM = 1.4;

export interface PosterCrop {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Where the subject lands, as a fraction of the thumbnail's width. */
  landX: number;
}

/** The picture full bleed with its subject on its own side (1.0-1.4 times the cover size). */
export function posterCrop(o: {
  aspect: number;
  subjectX?: number;
  subjectY?: number;
  zoom?: number;
}): PosterCrop {
  const aspect = o.aspect > 0 ? o.aspect : POSTER_W / POSTER_H;
  const sx = o.subjectX ?? 0.65;
  const sy = o.subjectY ?? 0.4;
  const target = sx >= 0.5 ? 0.73 : 0.27;
  const cover = (z: number) =>
    aspect >= POSTER_W / POSTER_H
      ? { width: POSTER_H * z * aspect, height: POSTER_H * z }
      : { width: POSTER_W * z, height: (POSTER_W * z) / aspect };
  // The smallest enlargement that lets the subject reach its side, unless a bigger one was asked for.
  const base = cover(1).width;
  const needed =
    sx >= 0.5
      ? (target * POSTER_W) / (sx * base)
      : ((1 - target) * POSTER_W) / ((1 - sx) * base);
  const z = Math.max(o.zoom ?? 1, Math.min(MAX_ZOOM, Math.max(1, needed)));
  const { width, height } = cover(z);
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));
  const left = clamp(target * POSTER_W - sx * width, POSTER_W - width, 0);
  const top = clamp(POSTER_H * 0.42 - sy * height, POSTER_H - height, 0);
  return { left, top, width, height, landX: (left + sx * width) / POSTER_W };
}

export interface PosterWords {
  lines: string[][];
  fontSize: number;
  side: "left" | "right";
  /** The word in the accent: a #1 first, then a number, else the last word (an index into all the words). */
  accent: number;
  /** Where the words are, in thumbnail pixels: x, y, width, height. */
  box: [number, number, number, number];
}

/** The words on the side away from the subject, broken into the lines that let them be biggest. */
export function posterWords(headline: string, landX = 0.73): PosterWords {
  const words = headline.toUpperCase().split(/\s+/).filter(Boolean);
  const n = Math.max(1, words.length);
  let best = { lines: [words], fontSize: 0 };
  // Every way of breaking the words into 1-3 lines in order.
  for (const breaks of lineBreaks(n)) {
    const lines: string[][] = [];
    let at = 0;
    for (const end of [...breaks, n]) {
      lines.push(words.slice(at, end));
      at = end;
    }
    const widest = Math.max(...lines.map((l) => l.join(" ").length));
    const fontSize = Math.min(
      MAX_FONT,
      TEXT_W / (Math.max(1, widest) * CHAR_EM),
      TEXT_H / (lines.length * LINE_EM),
    );
    if (fontSize > best.fontSize + 0.5) best = { lines, fontSize };
  }
  const fontSize = Math.floor(best.fontSize);
  const side = landX >= 0.5 ? "left" : "right";
  const widest = Math.max(...best.lines.map((l) => l.join(" ").length));
  const w = Math.min(TEXT_W, widest * fontSize * CHAR_EM);
  const h = best.lines.length * fontSize * LINE_EM;
  const hash = words.findIndex((x) => x.startsWith("#"));
  const digits = words.reduce((k, x, i) => (/\d/.test(x) ? i : k), -1);
  return {
    lines: best.lines,
    fontSize,
    side,
    accent: hash >= 0 ? hash : digits >= 0 ? digits : words.length - 1,
    box: [
      side === "left" ? MARGIN : POSTER_W - MARGIN - w,
      (POSTER_H - h) / 2,
      w,
      h,
    ],
  };
}

function lineBreaks(n: number): number[][] {
  const out: number[][] = [[]];
  for (let a = 1; a < n; a++) {
    out.push([a]);
    for (let b = a + 1; b < n; b++) out.push([a, b]);
  }
  return out;
}
