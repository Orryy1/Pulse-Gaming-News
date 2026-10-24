// Canvas geometry for the 1080x1920 Short, shared by every component and by
// the planner. Bands follow the Shorts UI: nothing essential above y 150
// (status bar, Shorts header) or below y 1620 (channel row, carousel), and
// nothing right of x 920 once the right-hand rail of buttons begins at y 1000.

export const WIDTH = 1080;
export const HEIGHT = 1920;

export const BANDS = {
  header: [0, 150], // phone status bar and Shorts header icons: nothing
  brand: [150, 300], // lockup, story chip, source lower-third
  wire: [300, 352], // progress rail
  hero: [360, 900], // headline, primary card, chart, framed footage panel
  shelf: [900, 1180], // evidence shelf: exactly one device per beat
  caption: [1180, 1460], // caption block centred on y 1320
  soft: [1460, 1620], // footage, scrim and the footage credit tag only
  nogo: [1620, 1920], // channel row, carousel, progress bar: nothing
} as const;

export const X = { left: 64, rightHigh: 1016, rightLow: 920 } as const;

/** Content box: full width above the right-hand rail, narrower below it. */
export const SAFE = {
  top: 150,
  bottom: 1500,
  left: 64,
  right: 1016,
  railTop: 1000,
  railRight: 920,
} as const;

export const CONTENT_WIDTH = SAFE.right - SAFE.left; // 952
export const LOW_WIDTH = SAFE.railRight - SAFE.left; // 856

/** Where the hero band content starts (cards, headline). */
export const HERO_TOP = 400;
export const SHELF_TOP = BANDS.shelf[0] + 24;
export const CAPTION_CENTRE = 1320;
export const CREDIT_TOP = 1560;

/** Width inside the ink panel behind data cards (30 px padding each side). */
export const CARD_WIDTH = CONTENT_WIDTH - 60;

/** Anton capitals average about 0.52 em wide; 0.56 keeps a margin for W and M. */
const ANTON_EM = 0.56;

/** Lines a headline wraps to at a font size, laid out word by word as the flex row does. */
export function headlineLines(words: string[], size: number, width = CONTENT_WIDTH, gap = 22): number {
  let lines = 1;
  let used = 0;
  for (const w of words) {
    const wpx = w.length * size * ANTON_EM;
    if (used > 0 && used + gap + wpx > width) {
      lines++;
      used = wpx;
    } else used += (used > 0 ? gap : 0) + wpx;
  }
  return lines;
}

/** The largest headline size whose wrapped lines stay inside the hero band (y 400 to 890). */
export function fitHeadline(words: string[], sizes: number[] = [132, 112, 96, 84, 72], height = 490): number {
  for (const s of sizes) if (headlineLines(words, s) * s * 1.02 <= height && words.every((w) => w.length * s * ANTON_EM <= CONTENT_WIDTH)) return s;
  return sizes[sizes.length - 1]!;
}

/** The source line: at most three outlets, then "+N", so it never runs off the frame. */
export function sourceLine(attribution: string): string {
  const list = attribution.replace(/^sources?:\s*/i, "").toUpperCase().split(/\s*[,/]\s*/).filter(Boolean);
  return list.length > 3 ? `${list.slice(0, 3).join(", ")} +${list.length - 3}` : list.join(", ");
}
