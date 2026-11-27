// The timing of a documentary's two fixed bookends, kept free of Remotion so the pipeline (which adds the
// end card's seconds to the render and writes the hook line) and the tests can import it in Node:
//  - the signature cold open (src/render/components/ColdOpen.tsx): three seconds of the sting, the mark
//    and one line of white type with the hook, the same shape on every documentary;
//  - the end card (src/render/components/EndCard.tsx): the last twenty seconds, "Up next" with the newest
//    public documentary, the mark and a subscribe nudge, since the Data API cannot set end screens.

/** Seconds the signature opening holds before the pictures take over. */
export const COLD_OPEN_SECONDS = 3;
/** The longest line of type the opening shows; a longer first sentence is cut at a clause or a word. */
export const COLD_OPEN_LINE_MAX = 110;
/** Seconds the end card holds at the end of a documentary. */
export const END_CARD_SECONDS = 20;

export interface ColdOpenTiming {
  /** Frames the card runs for. */
  frames: number;
  /** Frame the mark lands. */
  markIn: number;
  /** Frame the line of type starts to appear. */
  lineIn: number;
  /** Frame the whole card starts to fade into the opening pictures. */
  fadeOutFrom: number;
}

export function coldOpenTiming(fps: number): ColdOpenTiming {
  const frames = Math.round(COLD_OPEN_SECONDS * fps);
  return {
    frames,
    markIn: 0,
    lineIn: Math.round(fps * 0.6),
    fadeOutFrom: frames - Math.round(fps * 0.4),
  };
}

/**
 * The line of white type: the hook's first sentence, without its full stop. Past COLD_OPEN_LINE_MAX
 * characters it ends at the last clause break before the limit, else at the last word.
 */
export function coldOpenLine(hook: string): string {
  const text = hook.replace(/\s+/g, " ").trim();
  const first = (text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text).trim();
  let line = first.replace(/[.]+$/, "").trim();
  if (line.length > COLD_OPEN_LINE_MAX) {
    const cut = line.slice(0, COLD_OPEN_LINE_MAX);
    const clause = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "));
    const word = cut.lastIndexOf(" ");
    const at = clause > 40 ? clause : word > 40 ? word : COLD_OPEN_LINE_MAX;
    line = cut.slice(0, at).replace(/[\s,;:]+$/, "");
  }
  return line;
}

export interface EndCardTiming {
  /** First frame of the card. */
  from: number;
  /** Frames it runs for (to the last frame of the video). */
  frames: number;
  /** Frames the card's background takes to fade in over the outro's last picture. */
  fadeIn: number;
  /** Frame (within the card) the next title and its thumbnail land. */
  nextIn: number;
  /** Frame (within the card) the subscribe nudge lands. */
  subscribeIn: number;
}

/** Where the card sits in a video of durationInFrames; a video shorter than two cards gets a card half its length. */
export function endCardTiming(
  durationInFrames: number,
  fps: number,
): EndCardTiming {
  const want = Math.round(END_CARD_SECONDS * fps);
  const frames = Math.min(want, Math.max(1, Math.floor(durationInFrames / 2)));
  return {
    from: Math.max(0, durationInFrames - frames),
    frames,
    fadeIn: Math.min(Math.round(fps * 0.7), frames),
    nextIn: Math.min(Math.round(fps * 0.4), frames),
    subscribeIn: Math.min(Math.round(fps * 1.2), frames),
  };
}
