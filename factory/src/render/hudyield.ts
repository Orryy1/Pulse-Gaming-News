// The long video's corner furniture (the PULSE mark and chip, the chapter index and the year counter) gives
// way to the graphics. On Vice City (31 Oct 2026) the graphics check muted 51 of 200 graphics before the
// render, and 21 of them were the furniture, not the graphic: a stat or date card at the top right sat on the
// year counter ("the 32 MEGABYTES card hides the 2001 badge"), and a full-screen filler (a kinetic line, a
// recreated budget sheet) had the mark, the chapter dots and the year printed over its heading. The year
// counter now fades out while any sentence graphic or filler is on screen, and the mark and chapter index
// while a filler shot fills the frame; both come back the moment it has gone.

/** A stretch of frames, [from, to). */
export interface HudSpan {
  from: number;
  to: number;
}

/** Frames the furniture takes to fade out before a span and back in after it. */
export const HUD_FADE = 8;

/**
 * The furniture's opacity at `frame`: 1 clear of every span, 0 inside one, a linear fade over `fade` frames
 * on each side. Spans may overlap and come in any order.
 */
export function hudYield(
  frame: number,
  spans: HudSpan[],
  fade = HUD_FADE,
): number {
  let o = 1;
  for (const s of spans) {
    if (s.to <= s.from) continue;
    if (frame >= s.from && frame < s.to) return 0;
    const d = frame < s.from ? s.from - frame : frame - (s.to - 1);
    if (d < fade) o = Math.min(o, d / fade);
  }
  return o;
}
