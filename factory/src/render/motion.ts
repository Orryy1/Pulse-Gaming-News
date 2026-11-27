// Motion signature: three springs, a handful of durations, one easing per
// job. Everything is a pure function of the frame so renders are repeatable.

import { Easing, interpolate, spring } from "remotion";

export const SPRING = {
  ENTER: { damping: 14, stiffness: 160, mass: 0.7 }, // about 18 frames to settle
  POP: { damping: 15, stiffness: 260, mass: 0.5 }, // about 12 frames
  SNAP: { damping: 20, stiffness: 400, mass: 0.4 }, // about 8 frames
} as const;

export const FRAMES = {
  micro: 5,
  chip: 9,
  card: 16,
  chart: 21,
  rule: 12, // the accent rule draws, then the content follows
  ruleLead: 4,
  hold: 45, // minimum before an exit
  exit: 8,
  cutPunch: 5,
  flash: 3,
  sting: 12,
  rise: 13, // a text line rising through its clip mask (0.42 s)
} as const;

export const ease = {
  out: Easing.out(Easing.cubic),
  inOut: Easing.inOut(Easing.cubic),
  in: Easing.in(Easing.quad),
} as const;

export type MovePreset =
  | "pushIn"
  | "pullBack"
  | "pushPan"
  | "driftDown"
  | "settle"
  /** "Move, settle, move" (src/render/camera.ts): eased in and out twice with a held beat between. */
  | "twoStage";

/** One ambient movement per shot; the first shot always pushes in. */
export function movePreset(shotIndex: number, variant: number): MovePreset {
  if (shotIndex === 0) return "pushIn";
  const presets: MovePreset[] = ["pushIn", "pullBack", "pushPan", "driftDown"];
  return presets[(shotIndex * 7 + variant) % 4]!;
}

/** Scale and translate for a shot's ambient move over its duration. */
export function moveTransform(
  preset: MovePreset,
  progress: number,
): { scale: number; x: number; y: number } {
  const p = Math.max(0, Math.min(1, progress));
  switch (preset) {
    case "pushIn":
      return { scale: 1 + 0.06 * p, x: 0, y: 0 };
    case "pullBack":
      return { scale: 1.08 - 0.06 * p, x: 0, y: 0 };
    case "pushPan":
      return { scale: 1.04 + 0.03 * p, x: -28 + 56 * p, y: 0 };
    case "driftDown":
      return { scale: 1.05, x: 0, y: -18 + 36 * p };
    case "settle":
      return { scale: 1.06, x: 0, y: 0 };
    case "twoStage": {
      // An operator's move rather than a linear one: a push and pan, a held beat, then the same again.
      const k = twoStageProgress(p);
      return { scale: 1.03 + 0.06 * k, x: -26 + 52 * k, y: 0 };
    }
  }
}

/**
 * The two-stage Ken Burns curve: 0..1 over the shot, eased out and in over its first 42%, held at a half
 * through the middle 16%, then eased again to 1. Continuous, so the move never jumps.
 */
export function twoStageProgress(p: number): number {
  const x = Math.max(0, Math.min(1, p));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  if (x < 0.42) return 0.5 * smooth(x / 0.42);
  if (x < 0.58) return 0.5;
  return 0.5 + 0.5 * smooth((x - 0.58) / 0.42);
}

/** 0..1 entrance for a component: an accent rule draws first, content follows. */
export function ruleThenContent(
  frame: number,
  fps: number,
): { rule: number; content: number } {
  const rule = interpolate(frame, [0, FRAMES.rule], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease.out,
  });
  const content = spring({
    frame: frame - FRAMES.ruleLead,
    fps,
    config: SPRING.ENTER,
  });
  return { rule, content };
}

/** 1..0 over the last `exitFrames` frames of a sequence of `durationInFrames`. */
export function exitProgress(
  frame: number,
  durationInFrames: number,
  exitFrames = FRAMES.exit,
): number {
  if (!Number.isFinite(durationInFrames) || durationInFrames <= exitFrames * 2)
    return 1;
  return interpolate(
    frame,
    [durationInFrames - exitFrames, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.in },
  );
}

/** 0..1 progress of a text line rising through its mask: ease-out-quint over FRAMES.rise frames. */
export function riseProgress(frame: number): number {
  return interpolate(frame, [0, FRAMES.rise], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.poly(5)),
  });
}

/** Incoming shot lands slightly large and settles over five frames. */
export function cutPunch(frame: number): number {
  return interpolate(frame, [0, FRAMES.cutPunch], [1.03, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease.out,
  });
}

/**
 * Frames each fade of a corner credit takes on a shot `durationFrames` long: 8, or under half a short
 * shot so the fade range stays strictly increasing (Remotion throws otherwise); 0 means show nothing.
 */
export const creditFade = (durationFrames: number) =>
  Math.max(0, Math.min(8, Math.floor((durationFrames - 1) / 2)));

/**
 * How much the spoken caption word may grow (scale), at most 6%: it grows by transform, over the 24 px
 * gap between words, so a long word ("MOUTHWASHING") at 6% covered the gap and read as one with the next.
 * Growth is held to about 9 px a side, using a heavy uppercase face's width of about 0.66 em a letter.
 */
export const captionGrow = (letters: number, fontSize: number) =>
  1 + Math.min(0.06, 18 / Math.max(1, letters * fontSize * 0.66));
