// MAP_PINS: the in-game map a sentence's place sits on, and the 3D camera that flies down to it
// (src/render/components/GameMap3D.tsx). Browser-safe and pure, so tests check the framing: the pipeline
// resolves the places (src/assets/gamemaps.ts), and the graphic carries everything the renderer needs.

/** One pin on a game's map, as a share of the map image's width (x) and height (y). */
export interface GameMapPin {
  name: string;
  x: number;
  y: number;
  kind: "district" | "city" | "landmark" | "region";
}

/** What a map graphic carries (MomentGraphic.gameMap): the map picture, its size, its credit and the pins. */
export interface GameMapGraphic {
  /** The table's id ("gta6"). */
  map: string;
  /** The game as the video names it. */
  game: string;
  /** The map picture, relative to the episode's folder ("gamemaps/gta6.jpg"); the renderer reads src. */
  file?: string;
  /** Its URL on the render's file server, filled in by src/render/render.ts longProps. */
  src?: string;
  width: number;
  height: number;
  /** Shown small in the corner: "MAP: ROCKSTAR GAMES". */
  credit: string;
  /** The part of the picture that is map (shares: left, top, right, bottom), when it carries a game's own menu around it. */
  crop?: [number, number, number, number];
  /** One to three places, in the order the story moves (shares of the crop when there is one). */
  pins: GameMapPin[];
}

export type Vec3 = [number, number, number];

/** The map plane's height in world units; its width follows the picture's shape. */
export const PLANE_H = 10;

export function planeSize(
  width: number,
  height: number,
): { w: number; h: number } {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  return { w: PLANE_H * aspect, h: PLANE_H };
}

/** A pin's place on the plane (which lies flat in x and z, north towards -z). */
export function pinWorld(
  pin: { x: number; y: number },
  width: number,
  height: number,
): Vec3 {
  const { w, h } = planeSize(width, height);
  return [(pin.x - 0.5) * w, 0, (pin.y - 0.5) * h];
}

export interface MapShot {
  /** Where the camera looks. */
  target: Vec3;
  /** How far it sits from the target. */
  distance: number;
  /** Its height angle in degrees: 90 is straight down. */
  elevation: number;
  /** Vertical field of view in degrees. */
  fov: number;
}

export const FOV = 38;
/** Frames: the camera starts on the whole map, flies from FLY_FROM to FLY_TO, then drifts in a little. */
export const FLY_FROM = 8;
export const FLY_TO = 62;

const rad = (d: number) => (d * Math.PI) / 180;

/** The opening shot: the whole map in view, from high and nearly overhead. */
export function wideShot(
  width: number,
  height: number,
  aspect = 16 / 9,
): MapShot {
  const { w, h } = planeSize(width, height);
  const elevation = 72;
  // The distance at which the plane's height (and, for a wide map, its width) fills the view, with room.
  const half = Math.tan(rad(FOV / 2));
  const forH = (h * 0.5) / half;
  const forW = (w * 0.5) / (half * aspect);
  return {
    target: [0, 0, h * 0.03],
    distance: Math.max(forH, forW),
    elevation,
    fov: FOV,
  };
}

/**
 * The closing shot: the pins with room around them, tilted so the map reads as ground. Never closer than the picture
 * holds detail for: at most MAX_UPSCALE screen pixels to one map pixel (a small in-game screenshot stays further out).
 */
export const MAX_UPSCALE = 2.5;
/** A tall frame (a Short, aspect under 1) needs the camera further out for places side by side, and the pins stand a
 * little higher, in the hero band above the captions. */
export function closeShot(pins: Vec3[], heightPx = 4000, aspect = 16 / 9, frameH = 1080): MapShot {
  const xs = pins.map((p) => p[0]);
  const zs = pins.map((p) => p[2]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(
    (Math.max(...xs) - Math.min(...xs)) * Math.max(1, 16 / 9 / aspect),
    (Math.max(...zs) - Math.min(...zs)) * 1.4,
  );
  const tall = aspect < 1;
  const distance = Math.max(
    tall ? 4.2 : 3.4,
    span * 1.25 + 1.5,
    frameH / MAX_UPSCALE / ((heightPx / PLANE_H) * 2 * Math.tan(rad(FOV / 2))),
  );
  // One place sits a little above the middle of the frame, leaving room under it for its label and beam.
  if (!tall) return { target: [cx, 0, cz - 0.15], distance, elevation: 50, fov: FOV };
  return tallClose(pins, cx, cz, distance, aspect);
}

/** Where a tall frame's pins must stand (shares of the frame): the hero and shelf bands, clear of the captions. */
export const TALL_PIN_BOX = { left: 0.11, right: 0.83, top: 0.24, bottom: 0.56 } as const;

/**
 * A tall frame's closing shot: the camera backs off from `d0` until every pin's foot stands inside TALL_PIN_BOX, with
 * the pins' middle at about 40% down the frame (Shorts: the hero band, above the captions' lower third).
 */
function tallClose(pins: Vec3[], cx: number, cz: number, d0: number, aspect: number): MapShot {
  const W = 1000;
  const H = W / aspect;
  let shot: MapShot = { target: [cx, 0, cz], distance: d0, elevation: 50, fov: FOV };
  for (let n = 0; n < 40; n++) {
    // Slide the target along north-south until the pins' middle sits at 40% down (a few steps: nearly linear).
    for (let k = 0; k < 6; k++) {
      const ys = pins.map((p) => project(p, shot, W, H).y / H);
      const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
      const err = mid - 0.4;
      if (Math.abs(err) < 0.005) break;
      // A point further north stands higher: moving the target south (+z) lifts the pins, by about dz / distance.
      shot = { ...shot, target: [cx, 0, shot.target[2] + err * shot.distance * 0.9] };
    }
    const fits = pins.every((p) => {
      const q = project(p, shot, W, H);
      return (
        q.z > 0 &&
        q.x / W >= TALL_PIN_BOX.left &&
        q.x / W <= TALL_PIN_BOX.right &&
        q.y / H >= TALL_PIN_BOX.top &&
        q.y / H <= TALL_PIN_BOX.bottom
      );
    });
    if (fits) return shot;
    shot = { ...shot, distance: shot.distance * 1.08 };
  }
  return shot;
}

const ease = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** The camera at a frame: distance eased in log space so the dive feels even, then a slow drift in. */
export function shotAt(
  frame: number,
  wide: MapShot,
  close: MapShot,
  holdTo: number,
): MapShot {
  const t = ease(
    Math.min(1, Math.max(0, (frame - FLY_FROM) / (FLY_TO - FLY_FROM))),
  );
  const drift =
    1 -
    0.06 *
      Math.min(1, Math.max(0, (frame - FLY_TO) / Math.max(1, holdTo - FLY_TO)));
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    target: [
      mix(wide.target[0], close.target[0]),
      0,
      mix(wide.target[2], close.target[2]),
    ],
    distance:
      Math.exp(
        Math.log(wide.distance) +
          (Math.log(close.distance) - Math.log(wide.distance)) * t,
      ) * drift,
    elevation: mix(wide.elevation, close.elevation),
    fov: FOV,
  };
}

/** The camera's position for a shot (looking along -z towards north, from the south). */
export function cameraPosition(s: MapShot): Vec3 {
  const e = rad(s.elevation);
  return [
    s.target[0],
    s.target[1] + s.distance * Math.sin(e),
    s.target[2] + s.distance * Math.cos(e),
  ];
}

/**
 * A world point on screen for a shot (pixels, top left origin), without three.js: a look-at camera with the
 * shot's field of view. Used to place the labels in the page over the canvas, and by tests to prove a shot's
 * pins land inside the frame.
 */
export function project(
  p: Vec3,
  s: MapShot,
  width = 1920,
  height = 1080,
): { x: number; y: number; z: number } {
  const eye = cameraPosition(s);
  // Camera basis: forward towards the target, right = forward x up, up' = right x forward.
  const f = norm(sub(s.target, eye));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(p, eye);
  const cx = dot(d, r);
  const cy = dot(d, u);
  const cz = dot(d, f);
  const k = 1 / Math.tan(rad(s.fov / 2));
  const aspect = width / height;
  const ndcX = (cx * k) / (cz * aspect);
  const ndcY = (cy * k) / cz;
  return { x: ((ndcX + 1) / 2) * width, y: ((1 - ndcY) / 2) * height, z: cz };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Whether a graphic is a game map the renderer can draw: a picture and one to three pins inside it. */
export function drawableGameMap(
  g: { gameMap?: GameMapGraphic } | undefined,
): boolean {
  const m = g?.gameMap;
  return (
    !!m &&
    !!(m.src || m.file) &&
    m.width > 0 &&
    m.height > 0 &&
    m.pins.length >= 1 &&
    m.pins.length <= 3 &&
    m.pins.every(
      (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && !!p.name.trim(),
    )
  );
}
