// The 3D game box (components/Box3D.tsx; owner's perfection programme, 1 Nov 2026): a game's cover on a box
// that turns, with a spine and a back in Pulse's style, where a game is introduced. Two places use it: a
// ranking entry's introduction (its lower third turns the box in instead of laying the flat cover down) and a
// documentary's "the game launched" sentence, where the box turns in beside the picture as the narrator says
// it came out. The box is drawn with CSS 3D in the browser, so it costs nothing on the GPU.
//
// Pure: which sentences are launch beats, and the box's turn at each frame.

/** Words that say a game came out. */
export const LAUNCH_WORDS =
  /\b(released|launched|launch(?:ed)? on|came out|comes out|hit (?:the )?shelves|went on sale|arrived on|shipped|debuted|launches)\b/i;

/** A launch beat's box stays at most this long, and needs a sentence at least this long. */
export const BOX_BEAT_MAX_SECONDS = 4.5;
export const BOX_BEAT_MIN_SECONDS = 2.4;

export interface BoxBeat {
  entry: number;
  /** First frame and length of the box's turn. */
  from: number;
  len: number;
}

/**
 * A documentary's launch beats (pure): in each chapter, the first sentence whose spoken words say the game came
 * out, long enough to carry the box and not already carrying a graphic, a name tag or a filler visual.
 */
export function launchBeats(a: {
  windows: Array<{ entry: number; moment: number; start: number; end: number }>;
  words: Array<{ text?: string; start: number }>;
  /** Whether the sentence already has something drawn over it (a graphic, a name tag). */
  busy: (entry: number, moment: number) => boolean;
  /** Whether a frame sits in a filler shot (a kinetic card, a diagram) with its own graphics. */
  filler?: (frame: number) => boolean;
  fps: number;
}): BoxBeat[] {
  const out: BoxBeat[] = [];
  const done = new Set<number>();
  for (const w of a.windows) {
    if (done.has(w.entry) || w.end - w.start < BOX_BEAT_MIN_SECONDS) continue;
    const text = a.words
      .filter((x) => x.start >= w.start - 0.05 && x.start < w.end)
      .map((x) => x.text ?? "")
      .join(" ");
    if (!LAUNCH_WORDS.test(text) || a.busy(w.entry, w.moment)) continue;
    const from = Math.round(w.start * a.fps);
    const len = Math.round(
      Math.min(BOX_BEAT_MAX_SECONDS, w.end - w.start) * a.fps,
    );
    if (a.filler?.(from) || a.filler?.(from + len - 1)) continue;
    out.push({ entry: w.entry, from, len });
    done.add(w.entry);
  }
  return out;
}

/** The box's turn (degrees about its upright axis) at frame f of a turn `len` long. */
// CSS turns: positive brings the box's left side, its spine, towards the camera.
export const BOX_START_DEGREES = 150; // the back faces the camera as it arrives, the spine swings past
export const BOX_REST_DEGREES = 24; // three-quarters: the front and its spine
export const BOX_TURN_FRAMES = 26;
export function boxTurn(f: number, len: number): number {
  const t = Math.max(0, Math.min(1, f / BOX_TURN_FRAMES));
  // Ease out with a little overshoot, as a box set down with a flick settles.
  const c = 1.4;
  const e = 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  const sway =
    Math.sin(
      (Math.max(0, f - BOX_TURN_FRAMES) / Math.max(30, len)) * Math.PI * 1.4,
    ) * 7;
  return (
    BOX_START_DEGREES +
    (BOX_REST_DEGREES - BOX_START_DEGREES) * e +
    (t >= 1 ? sway : 0)
  );
}

/** The box's look for the game's year: a big cardboard PC box to 1999, a DVD-style case after. */
export function boxShape(year: number | undefined): {
  aspect: number;
  depth: number;
  round: number;
} {
  if (year && year < 2000) return { aspect: 0.8, depth: 0.2, round: 3 };
  return { aspect: 0.7, depth: 0.075, round: 8 };
}
