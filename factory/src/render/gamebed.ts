// GAME_AUDIO_BED in the composition (src/assets/gameaudio.ts makes the bed): pure, no node imports, so the
// Remotion bundle can use it.

/** The bed as the Short composition plays it: the mixed file, where the game is heard, and the music's level there. */
export interface GameBed {
  src: string;
  spans: Array<{ from: number; to: number }>;
  dip: number;
}

/**
 * The music bed's level where the game sounds (pure): `dip` inside a span, 1 outside, eased over `ease` frames
 * either side so the music never steps.
 */
export function musicDipAt(
  spans: ReadonlyArray<{ from: number; to: number }>,
  frame: number,
  fps: number,
  dip: number,
  ease = 9,
): number {
  let k = 0;
  for (const s of spans) {
    const a = s.from * fps;
    const b = s.to * fps;
    const inside =
      frame < a
        ? 1 - (a - frame) / ease
        : frame > b
          ? 1 - (frame - b) / ease
          : 1;
    k = Math.max(k, Math.min(1, inside));
  }
  return 1 - (1 - dip) * Math.max(0, k);
}
