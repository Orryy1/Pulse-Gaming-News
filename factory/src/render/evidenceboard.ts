// The documentary evidence board style (EVIDENCE_STYLE, off by default; owner, 26 Nov 2026: "Go for it"). The look of
// the crime-documentary explainers: game stills pinned up as old prints joined by red string, a big date card when a
// line carries a date, a typed case card at a chapter's or the Short's start, and red rubber stamps that land with a
// small shake. The pipeline plans it (src/evidencestyle.ts: which episodes, which words, which pictures); this module
// is the plan's shape and the geometry the components share (components/EvidenceStyle.tsx draws it). Browser-safe and
// pure: the Remotion bundle loads it.

/** The two layouts: the upright Short and the wide long video. */
export type BoardFrame = "short" | "long";

/** A big date card: the day or year as said, with the rest of the date typed under it. */
export interface BoardDate {
  /** Frame it lands on (the spoken date's first word). */
  from: number;
  frames: number;
  /** The big figure: a day ("26") or a year ("2013"). */
  big: string;
  /** The rest of the spoken date, typed ("SEPTEMBER 2013"); absent for a bare year. */
  sub?: string;
}

/** A typed case card: "CASE:" and the topic as the script names it. */
export interface BoardCase {
  from: number;
  frames: number;
  /** The topic, from the script's headline or the chapter's title (never written for the card). */
  topic: string;
}

/** A red rubber stamp: a word of the spoken line in the neutral evidence vocabulary (src/evidencestyle.ts). */
export interface BoardStamp {
  from: number;
  frames: number;
  text: string;
}

/** One picture pinned to the board, on screen while its shot plays. */
export interface BoardPin {
  /** Index into the composition's images. */
  image: number;
  /** The shot's frames: the camera arrives at this pin at `from` and holds until `to`. */
  from: number;
  to: number;
  /** Where the string to this pin from the one before draws on (a linking word, else just after it lands). */
  stringAt: number;
}

/** A stretch of the video shown on the board (consecutive still shots), the camera moving pin to pin. */
export interface BoardWindow {
  from: number;
  to: number;
  /** Indices into `pins`, in order. */
  pins: number[];
}

export interface EvidenceBoardPlan {
  version: 1;
  frame: BoardFrame;
  /** Board mode (a mystery or lore episode): stills play on the board. Off: only the cards and stamps. */
  mode: boolean;
  dates: BoardDate[];
  cases: BoardCase[];
  stamps: BoardStamp[];
  pins: BoardPin[];
  windows: BoardWindow[];
  /** Images that may go on any board (Pulse's own, no likeness): a long video's chapter breathers pin only these. */
  allowed: number[];
  /** Seeds the layout so two episodes never share a board. */
  seed: number;
}

/** How long each element holds, in frames at 30 fps. */
export const DATE_FRAMES = 78; // 2.6 s: the figure and the typed line read in time
export const CASE_FRAMES = 84; // 2.8 s: the typing plays out and holds a second
export const STAMP_HOLD = 66; // 2.2 s
/** The stamp's shake on landing, frames. */
export const SHAKE_FRAMES = 7;
/** Frames the camera takes from one pin to the next. */
export const MOVE_FRAMES = 20;
/** Frames a string takes to draw on. */
export const STRING_FRAMES = 18;

/** The virtual board's size and a print's width for each layout, in px of the board. */
export const BOARD_GEOMETRY: Record<
  BoardFrame,
  {
    w: number;
    h: number;
    print: number;
    viewW: number;
    viewH: number;
    centreY: number;
  }
> = {
  // The upright Short: the pin sits above the captions' band.
  short: {
    w: 2600,
    h: 3800,
    print: 720,
    viewW: 1080,
    viewH: 1920,
    centreY: 840,
  },
  long: {
    w: 4600,
    h: 2800,
    print: 860,
    viewW: 1920,
    viewH: 1080,
    centreY: 520,
  },
};

/** A small seeded random (mulberry32), so the layout is the same every render. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PinSpot {
  /** Centre of the print on the board. */
  x: number;
  y: number;
  /** Tilt, degrees. */
  r: number;
}

/**
 * Where the n pins sit on the board (pure): a seeded walk, each pin a print's width or so from the last in a
 * new direction, kept inside the board's margins, so the camera always travels and the string always shows.
 */
export function pinSpots(
  n: number,
  frame: BoardFrame,
  seed: number,
): PinSpot[] {
  const g = BOARD_GEOMETRY[frame];
  const rnd = seeded(seed || 1);
  const margin = g.print * 0.75;
  const out: PinSpot[] = [];
  let x = g.w / 2;
  let y = g.h / 2;
  let angle = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // Turn between 70 and 150 degrees each step, so the walk zig-zags rather than runs off one edge.
      angle += (Math.PI / 180) * (70 + rnd() * 80) * (rnd() < 0.5 ? -1 : 1);
      const step = g.print * (1.05 + rnd() * 0.35);
      // Try the turn, then other headings round the compass, until the next pin lands a good way off, inside.
      let best = { x, y, d: -1 };
      for (let k = 0; k < 8; k++) {
        const a = angle + (k * Math.PI) / 4;
        const nx = Math.min(g.w - margin, Math.max(margin, x + Math.cos(a) * step));
        const ny = Math.min(g.h - margin, Math.max(margin, y + Math.sin(a) * step));
        const d = Math.hypot(nx - x, ny - y);
        if (d > best.d) best = { x: nx, y: ny, d };
        if (d >= g.print * 0.9) {
          angle = a;
          break;
        }
      }
      x = best.x;
      y = best.y;
    }
    out.push({ x, y, r: (rnd() - 0.5) * 9 });
  }
  return out;
}

const ease = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * The camera over the board at a frame (pure): centred on the current pin, a slow push while it holds, and on
 * the way to the next pin a pull back that shows the string and the pins around, then in again. Returns the
 * board point at the frame's centre and the zoom.
 */
export function boardCamera(
  frameNow: number,
  win: BoardWindow,
  pins: BoardPin[],
  spots: PinSpot[],
  frame: BoardFrame,
): { x: number; y: number; zoom: number } {
  const g = BOARD_GEOMETRY[frame];
  const ids = win.pins;
  // The pin being arrived at or held: the last whose shot has started.
  let k = 0;
  for (let i = 0; i < ids.length; i++)
    if (pins[ids[i]!]!.from <= frameNow) k = i;
  const cur = spots[ids[k]!]!;
  const prev = k > 0 ? spots[ids[k - 1]!]! : undefined;
  const at = pins[ids[k]!]!;
  const since = frameNow - at.from;
  const hold = Math.max(1, at.to - at.from);
  // The slow push starts once the camera has arrived, so the zoom never jumps on arrival.
  const push = 1 + 0.05 * clamp01((since - MOVE_FRAMES) / Math.max(1, hold - MOVE_FRAMES));
  // A window opens on its first pin already framed, pushed in a touch more, settling.
  if (!prev) {
    const open = 1.08 - 0.08 * ease(clamp01(since / MOVE_FRAMES));
    return { x: cur.x, y: cur.y, zoom: open * push };
  }
  const t = ease(clamp01(since / MOVE_FRAMES));
  const x = prev.x + (cur.x - prev.x) * t;
  const y = prev.y + (cur.y - prev.y) * t;
  // Pull back mid-move so both prints and the string between them are in frame.
  const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
  const need = Math.min(1, (g.viewW * 0.92) / Math.max(1, dist + g.print));
  const dip = 1 - (1 - Math.max(0.55, need)) * Math.sin(Math.PI * t);
  return { x, y, zoom: dip * push };
}

/** The window showing at a frame, if any (pure). */
export function windowAt(
  plan: Pick<EvidenceBoardPlan, "windows">,
  f: number,
): BoardWindow | undefined {
  return plan.windows.find((w) => f >= w.from && f < w.to);
}

/** How far a string has drawn on at a frame, 0-1 (pure). */
export function stringDrawn(f: number, at: number): number {
  return ease(clamp01((f - at) / STRING_FRAMES));
}
