// The "3D photo" camera (components/DepthOrbit.tsx; owner's perfection programme, 1 Nov 2026): instead of three
// flat depth layers sliding past each other, a still becomes a real surface. A finely divided plane is pushed
// towards the camera by the depth model's map (src/render/parallax.py, mesh mode) and filmed with a perspective
// camera that orbits it slowly, so the subject turns a little against the place behind it the way a crane shot
// would. Where the subject's edge tears away from the background, the surface is cut instead of stretched and a
// second surface behind it (the picture with the subject painted out) shows through: no smeared edges.
//
// Everything here is pure maths (the pose at each moment, the matrices, how big the plane must be so its edge
// never shows), so it is tested without a browser.

/** The camera's vertical field of view. A long lens keeps the perspective gentle. */
export const ORBIT_FOV_DEGREES = 32;
/** How far the camera swings round the subject, either side of straight on, in degrees. */
export const ORBIT_YAW_DEGREES = 3.2;
/** A touch of crane: the camera rises (or sinks) this much over the move, in degrees. */
export const ORBIT_PITCH_DEGREES = 0.8;
/** The camera closes in this share of its distance over the move. */
export const ORBIT_PUSH = 0.05;
/** How far the nearest point stands out of the plane, as a share of the frame's height. */
export const ORBIT_RELIEF = 0.22;
/** The plane is this much bigger than the frame needs, so the swing never reveals its edge. */
export const ORBIT_OVERSCAN = 1.2;
/** The surface is cut where the picture's depth jumps more than this inside one triangle (0-1 depth). */
export const ORBIT_TEAR = 0.07;

export interface OrbitPose {
  /** Swing round the pivot, radians (positive: the camera moves right). */
  yaw: number;
  pitch: number;
  /** Camera distance as a share of the starting distance. */
  distance: number;
}

/** Smoothstep: the move starts and lands at rest, an operator's move rather than a linear one. */
const ease = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/**
 * The camera's pose at progress p (0 to 1) of the shot: a swing from one side to the other (dir chooses which),
 * a slight rise and a slow push in.
 */
export function orbitPose(p: number, dir: 1 | -1): OrbitPose {
  const e = ease(p);
  const rad = Math.PI / 180;
  return {
    yaw: dir * (e - 0.5) * 2 * ORBIT_YAW_DEGREES * rad,
    pitch: (e - 0.5) * 2 * ORBIT_PITCH_DEGREES * rad,
    distance: 1 - ORBIT_PUSH * e,
  };
}

/** The camera's distance from the plane at which a plane one unit tall exactly fills the frame's height. */
export const fillDistance = (fovDeg = ORBIT_FOV_DEGREES) =>
  0.5 / Math.tan(((fovDeg / 2) * Math.PI) / 180);

/** The plane's width and height (world units) so a picture of this aspect covers a frame of frameAspect. */
export function planeSize(
  aspect: number,
  frameAspect: number,
  pivotDepth = 0.5,
  overscan = ORBIT_OVERSCAN,
): { w: number; h: number } {
  const h = Math.max(1, frameAspect / Math.max(0.1, aspect));
  // The camera frames the subject, which stands out of the plane: the plane's far edge is further away than
  // the fill distance by the subject's relief, so it is enlarged by that ratio too.
  const d = fillDistance();
  const k = overscan * ((d + reliefZ(pivotDepth)) / d);
  return { w: aspect * h * k, h: h * k };
}

export type Mat4 = Float32Array;

/** Column-major perspective projection (WebGL's convention). */
export function perspective(
  fovDeg: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  const f = 1 / Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

/** Column-major view matrix of a camera at eye looking at target, y up. */
export function lookAt(
  eye: [number, number, number],
  target: [number, number, number],
): Mat4 {
  const [ex, ey, ez] = eye;
  let zx = ex - target[0];
  let zy = ey - target[1];
  let zz = ez - target[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  // x = up × z, with up = (0, 1, 0)
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl;
  xy /= xl;
  xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx;
  m[1] = yx;
  m[2] = zx;
  m[4] = xy;
  m[5] = yy;
  m[6] = zy;
  m[8] = xz;
  m[9] = yz;
  m[10] = zz;
  m[12] = -(xx * ex + xy * ey + xz * ez);
  m[13] = -(yx * ex + yy * ey + yz * ez);
  m[14] = -(zx * ex + zy * ey + zz * ez);
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      m[c * 4 + r] = s;
    }
  return m;
}

/**
 * The view-projection for a pose. The camera swings round a pivot at the subject's depth (pivotZ, world units in
 * front of the plane), so the subject holds its place while the background turns behind it.
 */
export function orbitMatrix(
  pose: OrbitPose,
  frameAspect: number,
  pivotZ: number,
  fovDeg = ORBIT_FOV_DEGREES,
): Mat4 {
  const d = fillDistance(fovDeg) * pose.distance;
  const eye: [number, number, number] = [
    d * Math.sin(pose.yaw) * Math.cos(pose.pitch),
    d * Math.sin(pose.pitch),
    pivotZ + d * Math.cos(pose.yaw) * Math.cos(pose.pitch),
  ];
  return multiply(
    perspective(fovDeg, frameAspect, 0.05, 20),
    lookAt(eye, [0, 0, pivotZ]),
  );
}

/** A point through a column-major matrix to normalised device coordinates. */
export function project(
  m: Mat4,
  p: [number, number, number],
): [number, number] {
  const x = m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!;
  const y = m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!;
  const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
  return [x / w, y / w];
}

/** Where the surface stands (world z, in frame heights) for a depth value (0 far to 1 near). */
export const reliefZ = (depth: number) => depth * ORBIT_RELIEF;

/**
 * Whether the plane's edge stays out of the frame for the whole move: every corner of the plane, at both the
 * nearest and the farthest depth it can take, projects outside the frame (beyond -1..1 on at least the axis
 * it bounds) at every sampled moment.
 */
export function edgesHidden(
  aspect: number,
  frameAspect: number,
  pivotDepth: number,
  dir: 1 | -1 = 1,
): boolean {
  const { w, h } = planeSize(aspect, frameAspect, pivotDepth);
  const pivotZ = reliefZ(pivotDepth);
  for (let k = 0; k <= 20; k++) {
    const m = orbitMatrix(orbitPose(k / 20, dir), frameAspect, pivotZ);
    for (const z of [0, reliefZ(1)])
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        // The edge's midpoints must be off screen on their own axis; the corners follow.
        const [ex] = project(m, [(sx * w) / 2, 0, z]);
        const [, ey] = project(m, [0, (sy * h) / 2, z]);
        if (Math.abs(ex) < 1 || Math.abs(ey) < 1) return false;
      }
  }
  return true;
}

/** Kinds of still that are a subject in front of a place: key art, a store header, an article's lead picture. */
export const ORBIT_KINDS = new Set(["hero", "header", "article"]);

export interface OrbitImage {
  kind: string;
  aspect: number;
  beatIndex?: number;
  layers?: unknown;
  wordy?: boolean;
}

/**
 * Which stills get a 3D photo (mesh) made before the render (pure): wide key art with depth layers, the widest
 * first in each chapter, at most `perChapter` a chapter and `max` in all. A gameplay screenshot's HUD and
 * menus read wrongly in depth, so screenshots qualify only when nothing wordy was seen on them and the chapter
 * has no key art.
 */
export function orbitCandidates(
  images: readonly OrbitImage[],
  max: number,
  perChapter = 2,
): number[] {
  const byChapter = new Map<number, number[]>();
  images.forEach((im, i) => {
    if (!im.layers || im.aspect < 1.2) return;
    const art = ORBIT_KINDS.has(im.kind);
    if (!art && !(im.kind === "screenshot" && !im.wordy)) return;
    const b = im.beatIndex ?? -1;
    byChapter.set(b, [...(byChapter.get(b) ?? []), i]);
  });
  const rank = (i: number) => (ORBIT_KINDS.has(images[i]!.kind) ? 0 : 1);
  const out: number[] = [];
  for (const b of [...byChapter.keys()].sort((x, y) => x - y)) {
    const list = byChapter.get(b)!;
    const hasArt = list.some((i) => rank(i) === 0);
    const pick = list
      .filter((i) => !hasArt || rank(i) === 0)
      .sort((x, y) => rank(x) - rank(y) || x - y)
      .slice(0, perChapter);
    out.push(...pick);
  }
  return out.slice(0, Math.max(0, max));
}
