// Smart crops for the upright Short (12 Nov 2026, APPLE_SMART_CROP): a wide trailer clip shown full bleed
// in the 9:16 frame keeps only its middle third, so a character standing left of centre walked out of the
// Short. On the Mac mini, Apple's Vision finds the subjects in frames sampled through the clip (where the eye
// goes, things that stand out, people, faces and animals; src/assets/applevision.ts), this file picks the
// subject in each frame and smooths those picks into a crop path, a slow camera operator that holds still
// for small moves, follows at a steady pace and cuts when the shot does. Background.tsx's Clip reads the
// path frame by frame. Pure arithmetic: no Node, so the renderer's bundle can import it.

/** A box as fractions of the picture, origin top-left; c is the detector's confidence. */
export interface VisionBox {
  x: number;
  y: number;
  w: number;
  h: number;
  c: number;
}

/** What Vision found in one frame. */
export interface FrameBoxes {
  /** Where a viewer's eye goes (attention-based saliency). */
  salient: VisionBox[];
  /** Things that stand out from the background (objectness-based saliency). */
  objects: VisionBox[];
  humans: VisionBox[];
  faces: VisionBox[];
  animals: VisionBox[];
}

/** A clip's crop: its aspect and, per sampled moment (seconds into the clip file), the crop's centre across. */
export interface ClipCrop {
  aspect: number;
  path: Array<[number, number]>;
}

/** The zoom Background.tsx's Clip puts on full-bleed trailer clips to hide burned-in subtitles. */
export const CLIP_ZOOM = 1.24;
const FRAME_ASPECT = 1080 / 1920;

/**
 * The upright frame's window on a picture of this aspect: `cover` is the share of its width the cover crop
 * keeps, `view` the share left once the clip zoom is on, `lo`-`hi` where the crop's centre can go.
 */
export function cropWindow(
  aspect: number,
  zoom = CLIP_ZOOM,
): { cover: number; view: number; lo: number; hi: number } {
  const cover = Math.min(1, FRAME_ASPECT / Math.max(aspect, 0.01));
  return { cover, view: cover / zoom, lo: cover / 2, hi: 1 - cover / 2 };
}

/** Each kind of find's pull on the crop: a person or face is what a viewer follows. */
const WEIGHT: Record<keyof FrameBoxes, number> = {
  faces: 3,
  humans: 2.2,
  animals: 2.2,
  objects: 1.2,
  salient: 1,
};

/**
 * Where the crop should centre in one frame (0-1 across), or undefined when Vision found nothing. The
 * strongest find leads (its weight, confidence and size); others join it while they all fit in the
 * window and are worth at least a third as much, and the crop centres on the group.
 */
export function frameTarget(b: FrameBoxes, view: number): number | undefined {
  const all: Array<{ box: VisionBox; score: number }> = [];
  for (const kind of Object.keys(WEIGHT) as Array<keyof FrameBoxes>)
    for (const box of b[kind] ?? [])
      if (box.w > 0 && box.h > 0)
        all.push({
          box,
          score: WEIGHT[kind] * Math.max(0.3, box.c) * Math.sqrt(box.w * box.h),
        });
  if (!all.length) return undefined;
  all.sort((p, q) => q.score - p.score);
  const lead = all[0]!;
  let left = lead.box.x;
  let right = lead.box.x + lead.box.w;
  for (const o of all.slice(1)) {
    if (o.score < lead.score / 3) break;
    const l = Math.min(left, o.box.x);
    const r = Math.max(right, o.box.x + o.box.w);
    if (r - l <= view) [left, right] = [l, r];
  }
  const centre = (left + right) / 2;
  // A face in the lead (a person wider than the window) stays whole in the frame: the crop moves the least
  // it must from the group's centre to keep it in, with a little room either side.
  const face = (b.faces ?? [])
    .filter((f) => overlaps(f, lead.box))
    .sort((p, q) => q.w * q.h - p.w * p.h)[0];
  if (!face) return centre;
  const fc = face.x + face.w / 2;
  const slack = Math.max(0, view / 2 - face.w / 2 - 0.02);
  return Math.min(fc + slack, Math.max(fc - slack, centre));
}

const overlaps = (p: VisionBox, q: VisionBox) =>
  p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

export interface SmoothOptions {
  lo: number;
  hi: number;
  /** Fastest pan, in picture widths a second. */
  maxSpeed?: number;
  /** Moves of the target smaller than this are ignored (picture widths). */
  deadzone?: number;
  /** A sudden jump of the target this big that stays is a cut: the crop cuts with it. */
  cutJump?: number;
}

/**
 * The crop path from per-frame targets (`t` seconds, `x` 0-1 or undefined where nothing was found):
 * gaps take the last subject, single-frame flickers are voted out (median of three), small moves are
 * ignored, larger ones followed at no more than `maxSpeed`, and a sudden lasting jump (a cut, or a new
 * subject) is taken at once. Undefined when no frame had a subject: the clip keeps its centre crop.
 */
export function smoothPath(
  samples: Array<{ t: number; x?: number }>,
  o: SmoothOptions,
): Array<[number, number]> | undefined {
  const maxSpeed = o.maxSpeed ?? 0.3;
  const deadzone = o.deadzone ?? 0.03;
  const cutJump = o.cutJump ?? 0.18;
  const first = samples.find((s) => s.x !== undefined)?.x;
  if (first === undefined || !samples.length) return undefined;
  const clamp = (v: number) => Math.min(o.hi, Math.max(o.lo, v));
  let last = first;
  const raw = samples.map((s) => (last = s.x ?? last));
  const med = raw.map((v, i) => {
    if (i === 0 || i === raw.length - 1) return clamp(v);
    const trio = [raw[i - 1]!, v, raw[i + 1]!].sort((a, b) => a - b);
    return clamp(trio[1]!);
  });
  const out: Array<[number, number]> = [];
  const cuts = new Set<number>();
  let pos = med[0]!;
  out.push([samples[0]!.t, pos]);
  for (let i = 1; i < med.length; i++) {
    const target = med[i]!;
    const dt = Math.max(0, samples[i]!.t - samples[i - 1]!.t);
    const sudden = Math.abs(target - med[i - 1]!) > cutJump;
    const stays =
      i + 1 >= med.length || Math.abs(med[i + 1]! - target) < cutJump / 2;
    if (sudden && stays) {
      pos = target;
      cuts.add(i);
    } else {
      const d = target - pos;
      if (Math.abs(d) > deadzone)
        pos += Math.sign(d) * Math.min(Math.abs(d) - deadzone, maxSpeed * dt);
    }
    out.push([samples[i]!.t, pos]);
  }
  // A last ease: each point averaged with its neighbours, never across a cut, so pans start and stop softly.
  const eased = out.map(([t, x], i): [number, number] => {
    const prev = i > 0 && !cuts.has(i) ? out[i - 1]![1] : x;
    const next = i + 1 < out.length && !cuts.has(i + 1) ? out[i + 1]![1] : x;
    return [round(t, 3), round(clamp((prev + 2 * x + next) / 4), 4)];
  });
  return eased;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** The crop's centre at `t` seconds into the clip: straight lines between the path's points. */
export function cropAt(path: Array<[number, number]>, t: number): number {
  if (!path.length) return 0.5;
  if (t <= path[0]![0]) return path[0]![1];
  for (let i = 1; i < path.length; i++) {
    const [t1, x1] = path[i]!;
    if (t <= t1) {
      const [t0, x0] = path[i - 1]!;
      return t1 > t0 ? x0 + ((x1 - x0) * (t - t0)) / (t1 - t0) : x1;
    }
  }
  return path.at(-1)![1];
}

/** The CSS object-position that puts a crop centre `x` in the middle of the upright frame, at height `y`. */
export function cropPosition(aspect: number, x: number, y = "46%"): string {
  const { cover, lo, hi } = cropWindow(aspect);
  if (cover >= 1) return `50% ${y}`;
  const c = Math.min(hi, Math.max(lo, x));
  return `${(((c - cover / 2) / (1 - cover)) * 100).toFixed(2)}% ${y}`;
}

/** A clip's crop from Vision's finds in frames sampled at `times` (seconds); undefined to keep the centre. */
export function clipCrop(
  aspect: number,
  frames: Array<{ t: number; boxes?: FrameBoxes }>,
): ClipCrop | undefined {
  const win = cropWindow(aspect);
  if (win.cover >= 1) return undefined;
  const path = smoothPath(
    frames.map((f) => ({
      t: f.t,
      x: f.boxes ? frameTarget(f.boxes, win.view) : undefined,
    })),
    { lo: win.lo, hi: win.hi },
  );
  return path ? { aspect: round(aspect, 4), path } : undefined;
}
