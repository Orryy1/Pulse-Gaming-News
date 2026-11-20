// How an AI motion clip (src/assets/localvideo.ts) sits in a documentary shot: pure functions of the shot's
// length, the clip's length and a seed, so the render is deterministic and tests can pin every number.
//
// The clip is about five seconds; a sentence's shot is often longer or shorter. A longer shot slows the clip
// a little (never below 0.6x, where motion starts to look like slow motion) and then holds its last frame,
// which reads as the drawing settling, not as a freeze. A shorter shot simply cuts the clip early.

export type LocalVideoTreatment = "print" | "bleed";

/** Slowest the clip plays: below this slow motion shows. */
export const MIN_RATE = 0.6;

export interface ClipTiming {
  /** The clip's playback rate. */
  rate: number;
  /** Shot frames the clip plays for; after them its last frame holds. */
  playFrames: number;
  /** Whether the shot holds a last frame at all. */
  holds: boolean;
}

/** The timing of a clip of clipSeconds in a shot of len frames at fps. */
export function clipTiming(
  len: number,
  fps: number,
  clipSeconds: number,
): ClipTiming {
  const clipFrames = Math.max(1, Math.floor(clipSeconds * fps));
  const rate = Math.max(MIN_RATE, Math.min(1, clipFrames / Math.max(1, len)));
  // One frame short of the end: the clip's very last frame is sometimes a decoder's repeat.
  const playFrames = Math.max(1, Math.floor(clipFrames / rate) - 1);
  return {
    rate: Math.round(rate * 1000) / 1000,
    playFrames,
    holds: len > playFrames,
  };
}

/** A sketch brought to life sits on the desk as its print; a screenshot brought to life fills the frame. */
export function treatmentFor(
  source: "sketch" | "screenshot",
): LocalVideoTreatment {
  return source === "sketch" ? "print" : "bleed";
}

/** The print's tilt in degrees, small and seeded, alternating sides. */
export function printTilt(seed: number): number {
  const s = Math.abs(Math.floor(seed));
  const mag = 0.6 + (s % 5) * 0.2; // 0.6 to 1.4 degrees
  return Math.round((s % 2 ? -mag : mag) * 100) / 100;
}

/** The slow push over the shot: scale from 1 to this, so even the held frame keeps breathing. */
export const PUSH = 0.035;

/** The scale at frame f of a len-frame shot. */
export function pushScale(f: number, len: number): number {
  const t = Math.max(0, Math.min(1, f / Math.max(1, len)));
  return Math.round((1 + PUSH * t) * 10000) / 10000;
}

/** The print's size in the 1920x1080 frame: as wide as the sketch print (1240 px), the clip's aspect. */
export const PRINT_W = 1240;
export function printSize(aspect: number): { w: number; h: number } {
  return { w: PRINT_W, h: Math.round(PRINT_W / Math.max(1, aspect)) };
}

/** Clip files are named so the render can tell an AI motion clip from footage without a new field. */
export const LOCALVIDEO_PREFIX = "localvideo_";

/** Whether an assets.clips record is an AI motion clip, by its file name (no node imports: the bundle uses it). */
export function isLocalVideo(clip: { file: string }): boolean {
  const base = clip.file.split(/[\\/]/).pop() ?? "";
  return base.startsWith(LOCALVIDEO_PREFIX);
}
