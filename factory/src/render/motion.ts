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
  | "settle";

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
  }
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

/** Incoming shot lands slightly large and settles over five frames. */
export function cutPunch(frame: number): number {
  return interpolate(frame, [0, FRAMES.cutPunch], [1.03, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease.out,
  });
}
