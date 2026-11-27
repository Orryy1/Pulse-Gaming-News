// Moving footage on every long render (owner, 12 Nov 2026: long videos "nearly all moving footage from start to finish …
// vital to keep engagement up"). Two numbers from the finished plan, logged for each long render ("moving_share") and
// shown in the Sunday growth report: the share of the narration that plays over moving footage (a clip, stock
// included, counted apart), and the share of the runtime on stills and the plain plate. Graphics (filler visuals) are
// counted on their own: they move, but they are not footage. The San Andreas proof of 13 Nov 2026 read 25.5% moving;
// the aim is "nearly all", with stills held to brief accents (under about 15 to 20% of the runtime).

export interface MovingShot {
  start: number;
  end: number;
  media: { type: string; index: number };
}

export interface MovingShare {
  /** Seconds of narration (words merged across gaps under 0.35 s). */
  narration: number;
  /** Seconds of that narration over a clip of game footage (stock not counted here). */
  moving: number;
  /** Seconds of narration over a stock clip. */
  stock: number;
  /** moving / narration. */
  movingShare: number;
  /** Seconds on screen by kind of media. */
  screen: { clip: number; image: number; plate: number; filler: number };
  /** (image + plate) / runtime. */
  stillShare: number;
  /** filler / runtime. */
  graphicsShare: number;
}

/** Spoken spans from word timings (pure): words closer than `gap` seconds join one span. */
export function speechSpans(
  words: ReadonlyArray<{ start: number; end: number }>,
  gap = 0.35,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && w.start - last[1] < gap) last[1] = Math.max(last[1], w.end);
    else out.push([w.start, w.end]);
  }
  return out;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The plan's moving share and stills share (pure). */
export function movingShare(o: {
  shots: readonly MovingShot[];
  fps: number;
  words: ReadonlyArray<{ start: number; end: number }>;
  clips: ReadonlyArray<{ stock?: boolean }>;
}): MovingShare {
  const fps = o.fps || 30;
  const screen = { clip: 0, image: 0, plate: 0, filler: 0 };
  for (const s of o.shots) {
    const k = s.media.type as keyof typeof screen;
    if (k in screen) screen[k] += (s.end - s.start) / fps;
  }
  const runtime = o.shots.reduce((n, s) => n + (s.end - s.start) / fps, 0);
  const spans = speechSpans(o.words);
  let narration = 0,
    moving = 0,
    stock = 0;
  for (const [a, b] of spans) narration += b - a;
  for (const s of o.shots) {
    if (s.media.type !== "clip") continue;
    const t0 = s.start / fps,
      t1 = s.end / fps;
    let over = 0;
    for (const [a, b] of spans)
      over += Math.max(0, Math.min(b, t1) - Math.max(a, t0));
    if (o.clips[s.media.index]?.stock) stock += over;
    else moving += over;
  }
  return {
    narration: r3(narration),
    moving: r3(moving),
    stock: r3(stock),
    movingShare: narration ? r3(moving / narration) : 0,
    screen: {
      clip: r3(screen.clip),
      image: r3(screen.image),
      plate: r3(screen.plate),
      filler: r3(screen.filler),
    },
    stillShare: runtime ? r3((screen.image + screen.plate) / runtime) : 0,
    graphicsShare: runtime ? r3(screen.filler / runtime) : 0,
  };
}

/** The moving share a long video aims at, and the most of its runtime stills should take. */
export const MOVING_SHARE_AIM = 0.8;
export const STILL_SHARE_MAX = 0.2;

/**
 * The growth report's line on the week's long renders (pure): how many, their median moving share and stills share,
 * and the lowest by name. Empty when there were none.
 */
export function movingShareLines(
  rows: ReadonlyArray<{ title: string; moving: number; stills: number }>,
): string[] {
  if (!rows.length) return [];
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const low = [...rows]
    .sort((a, b) => a.moving - b.moving)
    .slice(0, 2)
    .filter((r) => r.moving < MOVING_SHARE_AIM)
    .map((r) => `"${r.title.slice(0, 60)}" ${pct(r.moving)}`);
  return [
    `🎞️ **Moving footage in long videos:** ${rows.length} render${rows.length === 1 ? "" : "s"} this week, narration over moving footage ${pct(median(rows.map((r) => r.moving)))} (median; aim ${pct(MOVING_SHARE_AIM)}+), stills ${pct(median(rows.map((r) => r.stills)))} of the runtime (aim under ${pct(STILL_SHARE_MAX)}).${low.length ? ` Lowest: ${low.join(", ")}.` : ""}`,
  ];
}
