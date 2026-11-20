// The depth camera (PARALLAX_DEEP; owner, 20 Nov 2026: "beautiful parallax"). Today's 2.5D look slides three flat
// cut-outs past each other; this films the still's 3D photo (src/render/parallax.py mesh mode, the same maps the
// orbit uses) with a real perspective camera on a gentle path, so every point moves by its own depth: no seams
// between slabs, and where the subject's edge tears away the place behind it shows, painted from the background
// only (parallax.py fill_bg), never a stretched edge. On top, a cinema lens: the background racks out of focus as
// the camera settles on the subject, a little atmospheric haze on the far depths, and now and then a warm light
// leak. The move is timed to the narration: it travels fastest, and the focus lands, on the line's stressed word.
//
// Pure maths and planning only (components/DepthCam.tsx draws), so it is tested without a browser and loads in
// the Remotion bundle.

import {
  fillDistance,
  lookAt,
  multiply,
  perspective,
  project,
  reliefZ,
  type Mat4,
} from "./orbit.ts";

/** A long lens: gentle perspective, the look of a crane or slider shot rather than a phone. */
export const DEPTH_CAM_FOV_DEGREES = 30;
/** The surface is cut where its depth jumps more than this inside one triangle (0-1 depth), as the orbit does. */
export const DEPTH_CAM_TEAR = 0.07;

export type DepthCamKind = "dolly" | "truck" | "rise" | "drift";

/** The paths in turn: a push in, a slide sideways, a crane up, a slow diagonal float. */
export const DEPTH_CAM_KINDS: readonly DepthCamKind[] = [
  "dolly",
  "truck",
  "rise",
  "truck",
  "drift",
  "dolly",
];

export interface DepthCamPlan {
  kind: DepthCamKind;
  dir: 1 | -1;
  /** Where in the shot (0-1) the stressed word lands: the move is fastest and the focus arrives here. */
  emphasis: number;
  /** "in": the focus pulls from the far wall to the subject at the stressed word; "open": the subject holds
   * focus while the background softens as the lens opens. */
  rack: "in" | "open";
  /** Haze on the far depths, 0-1 of the full strength. */
  haze: number;
  /** A warm light leak drifts across this shot. */
  leak: boolean;
}

/** The emphasis when a shot has no stressed word: a little past the middle, an operator's natural beat. */
export const DEFAULT_EMPHASIS = 0.55;

/**
 * One shot's plan (pure): the path by the shot's place in the video, the direction alternating, the rack
 * alternating every other shot, a light leak on every third, and the emphasis from the stressed word's frame
 * (relative to the shot's start) when there is one, kept away from the very ends so the move can build and settle.
 */
export function depthCamPlan(
  index: number,
  lenFrames: number,
  emphasisFrame?: number,
): DepthCamPlan {
  const i = Math.max(0, Math.floor(index));
  const e =
    emphasisFrame !== undefined && lenFrames > 0
      ? emphasisFrame / lenFrames
      : DEFAULT_EMPHASIS;
  return {
    kind: DEPTH_CAM_KINDS[i % DEPTH_CAM_KINDS.length]!,
    dir: i % 2 ? -1 : 1,
    emphasis: Math.min(
      0.85,
      Math.max(0.2, Number.isFinite(e) ? e : DEFAULT_EMPHASIS),
    ),
    rack: i % 2 ? "open" : "in",
    haze: 0.75 + (0.25 * ((i * 7) % 3)) / 2,
    leak: i % 3 === 1,
  };
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * The move's progress at time t (0-1 of the shot), 0 to 1 (pure): a steady base drift so the picture never
 * freezes, plus an S-curve whose steepest point is the stressed word. Monotonic, starts at 0 and ends at 1.
 */
export function camProgress(t: number, emphasis: number): number {
  const x = Math.min(1, Math.max(0, t));
  const k = 0.16;
  const f = (u: number) => logistic((u - emphasis) / k);
  const s = (f(x) - f(0)) / Math.max(1e-6, f(1) - f(0));
  return 0.3 * x + 0.7 * s;
}

export interface CamPose {
  /** Camera position, world units (the frame's height is 1 at the fill distance). */
  x: number;
  y: number;
  /** Distance as a share of the fill distance. */
  distance: number;
}

/** How far each path travels over the shot, in frame heights (small: a slider, not a fly-through). */
const TRAVEL = { truck: 0.06, rise: 0.045, drift: 0.04, dollyPush: 0.1 };

/** The camera's pose at progress p of the move (pure). */
export function camPose(
  plan: Pick<DepthCamPlan, "kind" | "dir">,
  p: number,
): CamPose {
  const c = Math.min(1, Math.max(0, p)) - 0.5;
  switch (plan.kind) {
    case "dolly":
      return {
        x: plan.dir * 0.012 * c,
        y: 0,
        distance: 1.04 - TRAVEL.dollyPush * (c + 0.5),
      };
    case "truck":
      return {
        x: plan.dir * TRAVEL.truck * c,
        y: 0,
        distance: 1.02 - 0.03 * (c + 0.5),
      };
    case "rise":
      return { x: 0, y: TRAVEL.rise * c, distance: 1.02 - 0.03 * (c + 0.5) };
    case "drift":
      return {
        x: plan.dir * TRAVEL.drift * c,
        y: TRAVEL.drift * 0.55 * c,
        distance: 1.03 - 0.05 * (c + 0.5),
      };
  }
}

/**
 * The view-projection for a pose (pure). The camera looks at the subject's depth, aimed a little less far than it
 * travels, so the subject holds its place while the near and far depths slide apart.
 */
export function camMatrix(
  pose: CamPose,
  frameAspect: number,
  pivotZ: number,
  fovDeg = DEPTH_CAM_FOV_DEGREES,
): Mat4 {
  const d = fillDistance(fovDeg) * pose.distance;
  const eye: [number, number, number] = [pose.x, pose.y, pivotZ + d];
  return multiply(
    perspective(fovDeg, frameAspect, 0.05, 20),
    lookAt(eye, [pose.x * 0.45, pose.y * 0.45, pivotZ]),
  );
}

/**
 * The plane's size (world units) for a picture of this aspect in a frame of frameAspect, cover-fitted and then
 * enlarged by `overscan`; `offsetX` slides the picture sideways (world units) so a tall frame crops round the
 * subject (focusX, 0 left to 1 right), never past the picture's own edge.
 */
export function camPlane(
  aspect: number,
  frameAspect: number,
  overscan: number,
  focusX = 0.5,
): { w: number; h: number; offsetX: number } {
  const a = Math.max(0.1, aspect);
  // Cover: the plane is at least the frame's width (frameAspect) and height (1).
  const h0 = Math.max(1, frameAspect / a);
  const h = h0 * overscan;
  const w = a * h;
  const spare = Math.max(0, (w - frameAspect * overscan) / 2);
  const offsetX = Math.max(-spare, Math.min(spare, (0.5 - focusX) * w));
  return { w, h, offsetX };
}

/**
 * Whether the plane's edges stay out of frame for the whole move (pure): the edges' midpoints, at the nearest and
 * farthest depth the surface takes, project outside the frame at every sampled moment.
 */
export function camEdgesHidden(
  plan: Pick<DepthCamPlan, "kind" | "dir" | "emphasis">,
  aspect: number,
  frameAspect: number,
  pivotDepth: number,
  overscan: number,
  focusX = 0.5,
): boolean {
  const { w, h, offsetX } = camPlane(aspect, frameAspect, overscan, focusX);
  const pivotZ = reliefZ(pivotDepth);
  for (let k = 0; k <= 24; k++) {
    const m = camMatrix(
      camPose(plan, camProgress(k / 24, plan.emphasis)),
      frameAspect,
      pivotZ,
    );
    for (const z of [0, reliefZ(1)]) {
      for (const sx of [-1, 1]) {
        const [ex] = project(m, [(sx * w) / 2 + offsetX, 0, z]);
        if (Math.abs(ex) < 1) return false;
      }
      for (const sy of [-1, 1]) {
        const [, ey] = project(m, [offsetX, (sy * h) / 2, z]);
        if (Math.abs(ey) < 1) return false;
      }
    }
  }
  return true;
}

/** The least overscan (in steps of 0.02 from 1.04) that hides the plane's edges for this shot (pure). */
export function camOverscan(
  plan: Pick<DepthCamPlan, "kind" | "dir" | "emphasis">,
  aspect: number,
  frameAspect: number,
  pivotDepth: number,
  focusX = 0.5,
): number {
  for (let o = 1.04; o < 1.6; o += 0.02)
    if (camEdgesHidden(plan, aspect, frameAspect, pivotDepth, o, focusX))
      return Math.round(o * 100) / 100;
  return 1.6;
}

/** The lens at progress t of the shot (pure): where the focus sits (0 far to 1 near) and how strong the blur is. */
export function camLens(
  plan: Pick<DepthCamPlan, "rack" | "emphasis">,
  t: number,
  pivotDepth: number,
): { focus: number; strength: number } {
  const x = Math.min(1, Math.max(0, t));
  const s = (u: number) => {
    const v = Math.min(1, Math.max(0, u));
    return v * v * (3 - 2 * v);
  };
  // The rack takes about a fifth of the shot and lands on the stressed word.
  const r = s((x - (plan.emphasis - 0.2)) / 0.2);
  if (plan.rack === "in")
    return { focus: 0.12 + (pivotDepth - 0.12) * r, strength: 0.55 + 0.45 * r };
  return { focus: pivotDepth, strength: 0.15 + 0.85 * r };
}

/** The light leak's strength at time t (pure): it swells in round the stressed word and fades by the end. */
export function leakAt(t: number, emphasis: number): number {
  const x = Math.min(1, Math.max(0, t));
  const d = (x - emphasis) / 0.28;
  return Math.exp(-d * d);
}

const STOP = new Set(
  "the a an and or but of to in on at for with by from as is was were be been it its this that these those he she they we you i his her their our your not no so if then than into over after before about".split(
    " ",
  ),
);

/**
 * The stressed word of a shot (pure), as a frame from the shot's start: the first word inside the shot that
 * begins the writer's emphasis phrase for that line; otherwise the first figure or mid-sentence proper noun (the
 * words a narrator leans on); otherwise none. Words are in seconds.
 */
export function stressedFrame(
  shot: { start: number; end: number },
  fps: number,
  words: ReadonlyArray<{ start: number; text?: string }>,
  emphases: ReadonlyArray<{ start: number; end: number; text: string }> = [],
): number | undefined {
  const inShot = words.filter((w) => {
    const f = w.start * fps;
    return f >= shot.start + 6 && f < shot.end - 6;
  });
  if (!inShot.length) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const e of emphases) {
    const first = e.text
      .split(/\s+/)
      .map(norm)
      .find((x) => x && !STOP.has(x));
    if (!first) continue;
    const hit = inShot.find(
      (w) =>
        w.start >= e.start - 0.05 &&
        w.start <= e.end + 0.05 &&
        norm(w.text ?? "") === first,
    );
    if (hit) return Math.round(hit.start * fps) - shot.start;
  }
  for (let k = 0; k < inShot.length; k++) {
    const raw = (inShot[k]!.text ?? "").trim();
    const prev = k > 0 ? (inShot[k - 1]!.text ?? "").trim() : "";
    const sentenceStart = k === 0 || /[.!?]$/.test(prev);
    if (
      /\d/.test(raw) ||
      (!sentenceStart && /^[A-Z][a-z]/.test(raw) && !STOP.has(norm(raw)))
    )
      return Math.round(inShot[k]!.start * fps) - shot.start;
  }
  return undefined;
}
