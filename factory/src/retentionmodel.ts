// The retention prediction model (owner, 14 Nov 2026). src/retentionlearn.ts reads each video's YouTube retention
// curve and states what the curves show, one tag at a time. This learns from the same curves which moments make
// viewers leave, all features together, so a Short can be judged BEFORE it goes out (src/retentiondirector.ts).
//
// The unit is one step of a curve: YouTube gives the share still watching at each 1% of a video's length, so a 30 s
// Short has 99 steps of 0.3 s. Each step's leaving rate (the hazard: the share of those watching who leave, a second)
// is compared with what our Shorts usually lose at that point of their length (the baseline, from every Short on the
// channel, the old pipeline's too). The model predicts that excess from what was on screen and said at that moment,
// read from the episode's own records: the words with their timings, the shot list (moving footage, stills, plain
// plates, static frames, cuts), the cards and their text, the stamp, sound effects, the part of the Short and the
// whole Short's traits (its hook, how it opens, its pace). Adding the predicted excess to the baseline and walking
// the steps gives the predicted curve.
//
// The learner is gradient-boosted regression trees (small, depth 3, written here: no dependency, a few seconds to
// train), with a ridge regression beside it as the plain, readable check. Both are judged on videos held out of
// training, never on the videos they learnt from.

import type { Curve } from "./retentionlearn.ts";
import type { Script } from "./editorial/schema.ts";
import type { Word } from "./voice/elevenlabs.ts";
import {
  buildSegments,
  type Segment,
  type SegmentInput,
} from "./render/timeline.ts";

// ---------------------------------------------------------------- data

/** One upload in the dataset (src/tools/retention-dataset.ts), with its records when the factory made it. */
export interface DatasetVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  duration: number;
  views: number;
  privacy?: string;
  curve: Curve;
  episode?: {
    id: string;
    lane: string;
    script: Script | null;
    assets: any;
    gameAudio?: unknown;
    stayed?: number;
    stored?: { week?: Curve; early?: Curve };
  };
}

/** The records a Short's features are read from: the same shape before upload (the director) and after (training). */
export interface ShortRecords {
  lane: string;
  script: Script | null;
  assets: any;
  gameAudio?: unknown;
}

export type SegmentsOf = (script: Script, desk: boolean) => SegmentInput[];

const TAIL_SECONDS = 1.0;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// ---------------------------------------------------------------- the curve as steps

/** Tuning knobs (the trained model stores the values it was trained with). */
export const MODEL_SETTINGS = { smooth: 1 };

/** The curve's points in order on the 1% grid, smoothed over 2k+1 points (a Short with few views moves in stairs). */
export function smoothCurve(curve: Curve, k = MODEL_SETTINGS.smooth): Array<{ at: number; watch: number }> {
  const pts = [...curve].filter((p) => Number.isFinite(p.at) && Number.isFinite(p.watch)).sort((a, b) => a.at - b.at);
  return pts.map((p, i) => {
    const win = pts.slice(Math.max(0, i - k), i + k + 1);
    return { at: p.at, watch: win.reduce((a, q) => a + q.watch, 0) / win.length };
  });
}

export interface CurveStep {
  /** Grid key: the step's end on the 1% grid (1-100). */
  key: number;
  from: number;
  to: number;
  /** The share of those watching who leave a second over the step (negative: rewatches lifted it). */
  hazard: number;
}

const MAX_HAZARD = 3;

/** A curve's steps with their leaving rate (pure). */
export function hazardSteps(curve: Curve, duration: number): CurveStep[] {
  const w = smoothCurve(curve);
  const out: CurveStep[] = [];
  for (let i = 1; i < w.length; i++) {
    const a = w[i - 1]!;
    const b = w[i]!;
    const dt = (b.at - a.at) * duration;
    if (dt <= 0) continue;
    const h = Math.log(Math.max(1e-3, a.watch) / Math.max(1e-3, b.watch)) / dt;
    out.push({
      key: Math.round(b.at * 100),
      from: a.at * duration,
      to: b.at * duration,
      hazard: clamp(h, -MAX_HAZARD, MAX_HAZARD),
    });
  }
  return out;
}

/** Our Shorts' usual leaving rate at each point of their length: the median at each grid key, then lightly smoothed. */
export type HazardBaseline = number[];

export function hazardBaseline(
  curves: Array<{ curve: Curve; duration: number }>,
): HazardBaseline {
  const by: number[][] = Array.from({ length: 101 }, () => []);
  for (const c of curves)
    for (const s of hazardSteps(c.curve, c.duration)) by[s.key]?.push(s.hazard);
  const raw = by.map((xs) => (xs.length >= 3 ? median(xs) : NaN));
  // Fill gaps from the neighbours, then a five-point running median keeps the shape without the noise.
  for (let k = 0; k <= 100; k++)
    if (!Number.isFinite(raw[k]!)) {
      let j = 1;
      while (
        j < 100 &&
        !Number.isFinite(raw[k - j] ?? NaN) &&
        !Number.isFinite(raw[k + j] ?? NaN)
      )
        j++;
      raw[k] = Number.isFinite(raw[k - j] ?? NaN)
        ? raw[k - j]!
        : (raw[k + j] ?? 0);
    }
  return raw.map((_, k) =>
    median(raw.slice(Math.max(0, k - 2), k + 3).filter(Number.isFinite)),
  );
}

/** The relative curve (1 at the first point) from leaving rates over the steps (pure). */
export function curveFromHazards(
  steps: Array<{ from: number; to: number }>,
  hazards: number[],
): number[] {
  let r = 1;
  const out = [1];
  steps.forEach((s, i) => {
    r *= Math.exp(-(hazards[i] ?? 0) * (s.to - s.from));
    out.push(r);
  });
  return out;
}

/** The share of the video watched on average, on the relative curve (the mean of its points). */
export const avgWatched = (rel: number[]): number => mean(rel);

// ---------------------------------------------------------------- what was on screen and said

/** Everything about a Short the features read, built once from its records (pure). */
export interface ShortFrame {
  duration: number;
  words: Word[];
  segments: Segment[];
  shots: Array<{
    from: number;
    to: number;
    type: string;
    clip: boolean;
    trailer: boolean;
    gameplay: boolean;
    own: boolean;
    static: boolean;
    framed: boolean;
    index: number;
  }>;
  shelf: Array<{ from: number; to: number }>;
  cards: Array<{
    from: number;
    to: number;
    chars: number;
    items: number;
    digits: number;
    kind: string;
    segment: number;
  }>;
  stampAt?: number;
  sfx: number[];
  video: Record<string, number>;
}

const NUM_RE = /\d/;
const TOKEN_CLEAN_RE = /[^A-Za-z0-9£$%']/g;
const QUESTION_END_RE = /\?\s*$/;
const TRAILER_RE = /trailer/i;
const GAMEPLAY_RE = /gameplay|playthrough|cutscene/i;
const OWN_RE = /own (capture|footage|recording)|owner/i;
const SPACE_RE = /\s+/;

/** Card text as seen: primary, secondary and list items. */
export function cardText(v: Segment["visual"]): string {
  if (!v || v.kind === "none") return "";
  return [v.primary, v.secondary, ...(v.items ?? [])].filter(Boolean).join(" ");
}

/** The Short's frame from its records (pure), or undefined when they lack a script, word timings or a shot plan. */
export function shortFrame(
  ep: ShortRecords,
  segmentsOf: SegmentsOf,
  videoSeconds?: number,
  /** The segments as the pipeline built them (the director's case); otherwise they are rebuilt from the script. */
  given?: Segment[],
): ShortFrame | undefined {
  const script = ep.script;
  const a = ep.assets ?? {};
  const words: Word[] = Array.isArray(a.words) ? a.words : [];
  const plan = a.plan ?? {};
  const shotsIn: any[] = Array.isArray(plan.shots) ? plan.shots : [];
  const spoken = Number(a.durationSeconds ?? 0);
  if (!script?.beats || !words.length || !spoken || !shotsIn.length)
    return undefined;
  const fps = Number(plan.fps ?? 30) || 30;
  const duration =
    videoSeconds && videoSeconds > 0
      ? videoSeconds
      : Number(plan.totalFrames) / fps || spoken + TAIL_SECONDS;
  let segments: Segment[];
  if (given) segments = structuredClone(given);
  else try {
    segments = buildSegments(
      segmentsOf(script, Boolean(a.desk)),
      words,
      spoken + TAIL_SECONDS,
    );
  } catch {
    return undefined;
  }
  // The fixes the director made to card text are part of what was on screen.
  for (const t of Array.isArray(a.retention?.cardTrims)
    ? a.retention.cardTrims
    : [])
    applyCardTrim(segments, t);
  const clips: any[] = Array.isArray(a.clips) ? a.clips : [];
  const shots = shotsIn.map((s) => {
    const type = String(s.media?.type ?? "plate");
    const c = type === "clip" ? (clips[s.media.index] ?? {}) : {};
    const prov = String(c.provenance ?? "");
    return {
      from: Number(s.start) / fps,
      to: Math.min(duration, Number(s.end) / fps),
      type,
      clip: type === "clip" || type === "scene",
      trailer: type === "clip" && TRAILER_RE.test(prov),
      gameplay: type === "clip" && GAMEPLAY_RE.test(prov),
      own: type === "clip" && (OWN_RE.test(prov) || Boolean(c.own)),
      static: s.move === "settle",
      framed: Boolean(s.framed),
      index: Number(s.media?.index ?? -1),
    };
  });
  const shelf = (Array.isArray(plan.shelf) ? plan.shelf : [])
    .filter((d: any) => d?.device && d.device !== "rail")
    .map((d: any) => ({
      from: Number(d.from) / fps,
      to: Math.min(duration, Number(d.to) / fps),
    }));
  const cards = segments.flatMap((g, k) => {
    const txt = cardText(g.visual);
    if (!txt || g.kind === "hook") return [];
    const span = g.visual?.span;
    return [
      {
        from: span ? span[0] : g.start,
        to: span ? span[1] : g.end,
        chars: txt.length,
        items: g.visual?.items?.length ?? 0,
        digits: (txt.match(/\d/g) ?? []).length,
        kind: g.visual!.kind,
        segment: k,
      },
    ];
  });
  const stampWord = String((script as any).stamp?.word ?? "")
    .toLowerCase()
    .replace(TOKEN_CLEAN_RE, "");
  const hookEnd = segments[0]?.end ?? 0;
  const norm = (x: string) => x.toLowerCase().replace(TOKEN_CLEAN_RE, "");
  const stampAt = stampWord
    ? (
        words.find((w) => w.start >= hookEnd && norm(w.text) === stampWord) ??
        words.find((w) => norm(w.text) === stampWord)
      )?.start
    : undefined;
  const sfx = (Array.isArray(plan.sfx) ? plan.sfx : [])
    .map((c: any) => Number(c.frame) / fps)
    .filter((x: number) => x > 0.05);
  const hook = String(script.hook ?? "");
  const hookWords = hook.split(SPACE_RE).filter(Boolean).length;
  const clipSeconds = shots
    .filter((s) => s.clip)
    .reduce((n, s) => n + (s.to - s.from), 0);
  const plateSeconds = shots
    .filter((s) => s.type === "plate")
    .reduce((n, s) => n + (s.to - s.from), 0);
  const first = shots.find((s) => s.to > 0.4) ?? shots[0]!;
  const loopWords = String(script.loop_line ?? "")
    .split(SPACE_RE)
    .filter(Boolean).length;
  const video: Record<string, number> = {
    v_hook_words: hookWords,
    v_question: QUESTION_END_RE.test(hook) ? 1 : 0,
    v_open_clip: first.clip ? 1 : 0,
    v_open_plate: first.type === "plate" ? 1 : 0,
    v_first_card_early:
      cards.some((c) => c.from < 2) || shelf.some((d: { from: number }) => d.from < 2) ? 1 : 0,
    v_silent_start: (words[0]?.start ?? 0) > 0.6 ? 1 : 0,
    v_game_sound: (ep.gameAudio as any)?.on ? 1 : 0,
    v_duration: duration,
    v_breaking: ep.lane === "news_breaking" ? 1 : 0,
    v_evergreen: ep.lane === "evergreen" ? 1 : 0,
    v_loop_words: loopWords,
    v_wps: words.length / Math.max(1, spoken),
    v_clip_share: clipSeconds / duration,
    v_plate_share: plateSeconds / duration,
    v_cut_rate: Math.max(0, shots.length - 1) / duration,
    v_rumour: script.is_rumour ? 1 : 0,
    v_beats: script.beats.length,
  };
  return {
    duration,
    words,
    segments,
    shots,
    shelf,
    cards,
    stampAt,
    sfx,
    video,
  };
}

/** A card text trim the director made: its secondary line dropped, its list cut to `items`. */
export interface CardTrim {
  segment: number;
  dropSecondary?: boolean;
  items?: number;
}

export function applyCardTrim(segments: Segment[], t: CardTrim): void {
  const v = segments[t.segment]?.visual;
  if (!v) return;
  if (t.dropSecondary) v.secondary = "";
  if (t.items !== undefined && v.items && v.items.length > t.items)
    v.items = v.items.slice(0, t.items);
}

export const PART_NAMES = [
  "hook",
  "beat0",
  "beat1",
  "later",
  "take",
  "loop",
] as const;

export const FEATURES = [
  "pos",
  "t",
  "opening",
  "first3",
  ...PART_NAMES.map((p) => `part_${p}`),
  "shot_clip",
  "shot_still",
  "shot_plate",
  "shot_static",
  "shot_trailer",
  "shot_gameplay",
  "shot_own",
  "shot_framed",
  "shot_age",
  "shot_len",
  "since_cut",
  "cut_here",
  "cuts_near",
  "card_up",
  "card_chars",
  "card_items",
  "card_digits",
  "card_age",
  "shelf_up",
  "stamp_up",
  "wps",
  "in_pause",
  "pause_len",
  "numbers_said",
  "long_words",
  "names_said",
  "sfx_near",
  "v_hook_words",
  "v_question",
  "v_open_clip",
  "v_open_plate",
  "v_first_card_early",
  "v_silent_start",
  "v_game_sound",
  "v_duration",
  "v_breaking",
  "v_evergreen",
  "v_loop_words",
  "v_wps",
  "v_clip_share",
  "v_plate_share",
  "v_cut_rate",
  "v_rumour",
  "v_beats",
] as const;
export type FeatureName = (typeof FEATURES)[number];

/** The features of the moment from `t0` to `t1` (pure), in FEATURES order. */
export function featuresAt(f: ShortFrame, t0: number, t1: number): number[] {
  const t = (t0 + t1) / 2;
  const d = f.duration;
  const x: Record<string, number> = { ...f.video };
  x.pos = t / d;
  x.t = t;
  x.opening = t < 1.5 ? 1 : 0;
  x.first3 = t < 3 ? 1 : 0;
  // The part of the Short.
  let beat = 0;
  let part: (typeof PART_NAMES)[number] = "loop";
  for (const g of f.segments) {
    const name =
      g.kind === "beat"
        ? beat === 0
          ? "beat0"
          : beat === 1
            ? "beat1"
            : "later"
        : g.kind === "hook"
          ? "hook"
          : g.kind === "take"
            ? "take"
            : g.kind === "loop"
              ? "loop"
              : "later";
    if (g.kind === "beat") beat++;
    if (t >= g.start && t < g.end) {
      part = name;
      break;
    }
  }
  for (const p of PART_NAMES) x[`part_${p}`] = p === part ? 1 : 0;
  // The shot.
  const k = Math.max(
    0,
    f.shots.findIndex((s) => t >= s.from && t < s.to),
  );
  const s = f.shots[k] ?? f.shots.at(-1)!;
  x.shot_clip = s.clip ? 1 : 0;
  x.shot_still = s.type === "image" ? 1 : 0;
  x.shot_plate = s.type === "plate" ? 1 : 0;
  x.shot_static = s.static ? 1 : 0;
  x.shot_trailer = s.trailer ? 1 : 0;
  x.shot_gameplay = s.gameplay ? 1 : 0;
  x.shot_own = s.own ? 1 : 0;
  x.shot_framed = s.framed ? 1 : 0;
  x.shot_age = Math.max(0, t - s.from);
  x.shot_len = s.to - s.from;
  const cuts = f.shots.slice(1).map((c) => c.from);
  const before = cuts.filter((c) => c <= t);
  x.since_cut = before.length ? t - before.at(-1)! : t;
  x.cut_here = cuts.some((c) => c >= t0 - 0.15 && c < t1 + 0.15) ? 1 : 0;
  x.cuts_near = cuts.filter((c) => Math.abs(c - t) <= 2).length;
  // Cards and graphics.
  const card = f.cards.find((c) => t >= c.from && t < c.to);
  x.card_up = card ? 1 : 0;
  x.card_chars = card?.chars ?? 0;
  x.card_items = card?.items ?? 0;
  x.card_digits = card?.digits ?? 0;
  x.card_age = card ? t - card.from : 0;
  x.shelf_up = f.shelf.some((d) => t >= d.from && t < d.to) ? 1 : 0;
  x.stamp_up =
    f.stampAt !== undefined && t >= f.stampAt && t < f.stampAt + 1.5 ? 1 : 0;
  // The words.
  const near = f.words.filter((w) => w.end > t - 1.5 && w.start < t + 1.5);
  x.wps = near.length / 3;
  const speaking = f.words.some((w) => t >= w.start - 0.05 && t < w.end + 0.05);
  x.in_pause = speaking || t > (f.words.at(-1)?.end ?? 0) ? 0 : 1;
  if (x.in_pause) {
    const prev = [...f.words].reverse().find((w) => w.end <= t);
    const next = f.words.find((w) => w.start > t);
    x.pause_len = (next?.start ?? t) - (prev?.end ?? 0);
  } else x.pause_len = 0;
  const toks = near.map((w) => w.text.replace(TOKEN_CLEAN_RE, ""));
  x.numbers_said = toks.filter((w) => NUM_RE.test(w)).length;
  x.long_words = toks.length
    ? toks.filter((w) => w.length >= 10).length / toks.length
    : 0;
  x.names_said = toks.length
    ? toks.filter((w, i) => i > 0 && /^[A-Z]/.test(w)).length / toks.length
    : 0;
  x.sfx_near = f.sfx.some((c) => Math.abs(c - t) <= 0.6) ? 1 : 0;
  return FEATURES.map((n) => (Number.isFinite(x[n]) ? x[n]! : 0));
}

/** One training row: a step of one video's curve, its features and its excess leaving rate. */
export interface Sample {
  video: string;
  key: number;
  from: number;
  to: number;
  x: number[];
  hazard: number;
  base: number;
  /** hazard - base: what the model predicts. */
  y: number;
  weight: number;
}

/** Weight of a video's steps: a curve from few views is mostly noise. */
export const viewWeight = (views: number): number =>
  clamp(Math.sqrt(Math.max(1, views) / 1500), 0.25, 1);

/** The steps of a Short as features (pure); with a curve, also the targets. */
export function samplesOf(
  video: string,
  frame: ShortFrame,
  base: HazardBaseline,
  curve?: Curve,
  views = 1500,
): Sample[] {
  const steps = curve
    ? hazardSteps(curve, frame.duration)
    : gridSteps(frame.duration);
  const weight = viewWeight(views);
  return steps.map((s) => {
    const b = base[s.key] ?? 0;
    return {
      video,
      key: s.key,
      from: s.from,
      to: s.to,
      x: featuresAt(frame, s.from, s.to),
      hazard: s.hazard,
      base: b,
      y: s.hazard - b,
      weight,
    };
  });
}

/** The 1% grid's steps for a video with no curve yet (the director's case). */
export function gridSteps(duration: number): CurveStep[] {
  return Array.from({ length: 99 }, (_, i) => ({
    key: i + 2,
    from: ((i + 1) / 100) * duration,
    to: ((i + 2) / 100) * duration,
    hazard: 0,
  }));
}

// ---------------------------------------------------------------- gradient-boosted trees

export interface TreeNode {
  /** Feature index; -1 for a leaf. */
  f: number;
  thr: number;
  left: number;
  right: number;
  value: number;
  gain: number;
}

export interface Gbm {
  kind: "gbm";
  init: number;
  rate: number;
  trees: TreeNode[][];
  features: readonly string[];
}

export interface GbmOptions {
  trees: number;
  depth: number;
  rate: number;
  minLeaf: number;
  subsample: number;
  lambda: number;
  bins: number;
  seed: number;
}

export const GBM_DEFAULTS: GbmOptions = {
  trees: 220,
  depth: 3,
  rate: 0.05,
  minLeaf: 80,
  subsample: 0.8,
  lambda: 5,
  bins: 24,
  seed: 7,
};

/** A small seeded random generator (mulberry32), so training is repeatable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Candidate split points per feature: quantiles of its values. */
function binEdges(xs: number[][], nf: number, bins: number): number[][] {
  const out: number[][] = [];
  for (let j = 0; j < nf; j++) {
    const vals = xs.map((r) => r[j]!).sort((a, b) => a - b);
    const edges = new Set<number>();
    for (let b = 1; b < bins; b++) {
      const v = vals[Math.floor((b / bins) * (vals.length - 1))]!;
      edges.add(v);
    }
    // A threshold "x <= edge" must leave something on the right.
    out.push([...edges].filter((e) => e < vals.at(-1)!).sort((a, b) => a - b));
  }
  return out;
}

/** Trains the boosted trees on (x, y, weight) (pure, repeatable with the seed). */
export function trainGbm(
  x: number[][],
  y: number[],
  w: number[],
  features: readonly string[],
  o: Partial<GbmOptions> = {},
): Gbm {
  const opt = { ...GBM_DEFAULTS, ...o };
  const n = x.length;
  const nf = features.length;
  const wsum = w.reduce((a, b) => a + b, 0) || 1;
  const init = y.reduce((a, v, i) => a + v * w[i]!, 0) / wsum;
  const pred = new Array<number>(n).fill(init);
  const edges = binEdges(x, nf, opt.bins);
  // Each sample's bin per feature: the number of edges below its value.
  const binOf: Uint8Array[] = edges.map((e, j) => {
    const arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = x[i]![j]!;
      let lo = 0;
      let hi = e.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (e[mid]! < v) lo = mid + 1;
        else hi = mid;
      }
      arr[i] = lo;
    }
    return arr;
  });
  const rand = rng(opt.seed);
  const trees: TreeNode[][] = [];
  for (let t = 0; t < opt.trees; t++) {
    const g = y.map((v, i) => v - pred[i]!);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (rand() < opt.subsample) idx.push(i);
    const nodes: TreeNode[] = [];
    const grow = (rows: number[], depth: number): number => {
      let sw = 0;
      let sg = 0;
      for (const i of rows) {
        sw += w[i]!;
        sg += w[i]! * g[i]!;
      }
      const id = nodes.length;
      nodes.push({
        f: -1,
        thr: 0,
        left: -1,
        right: -1,
        value: sg / (sw + opt.lambda),
        gain: 0,
      });
      if (depth >= opt.depth || sw < 2 * opt.minLeaf) return id;
      const parentScore = (sg * sg) / (sw + opt.lambda);
      let best = { gain: 1e-9, f: -1, b: -1 };
      for (let j = 0; j < nf; j++) {
        const e = edges[j]!;
        if (!e.length) continue;
        const hw = new Float64Array(e.length + 1);
        const hg = new Float64Array(e.length + 1);
        const bj = binOf[j]!;
        for (const i of rows) {
          const b = bj[i]!;
          hw[b] = hw[b]! + w[i]!;
          hg[b] = hg[b]! + w[i]! * g[i]!;
        }
        let lw = 0;
        let lg = 0;
        for (let b = 0; b < e.length; b++) {
          lw += hw[b]!;
          lg += hg[b]!;
          const rw = sw - lw;
          if (lw < opt.minLeaf || rw < opt.minLeaf) continue;
          const rg = sg - lg;
          const gain =
            (lg * lg) / (lw + opt.lambda) +
            (rg * rg) / (rw + opt.lambda) -
            parentScore;
          if (gain > best.gain) best = { gain, f: j, b };
        }
      }
      if (best.f < 0) return id;
      const bj = binOf[best.f]!;
      const L = rows.filter((i) => bj[i]! <= best.b);
      const R = rows.filter((i) => bj[i]! > best.b);
      const node = nodes[id]!;
      node.f = best.f;
      node.thr = edges[best.f]![best.b]!;
      node.gain = best.gain;
      node.left = grow(L, depth + 1);
      node.right = grow(R, depth + 1);
      return id;
    };
    grow(idx, 0);
    for (const nd of nodes) nd.value *= opt.rate;
    trees.push(nodes);
    for (let i = 0; i < n; i++) pred[i]! += treeValue(nodes, x[i]!);
  }
  return { kind: "gbm", init, rate: opt.rate, trees, features };
}

function treeValue(nodes: TreeNode[], x: number[]): number {
  let k = 0;
  for (;;) {
    const nd = nodes[k]!;
    if (nd.f < 0) return nd.value;
    k = x[nd.f]! <= nd.thr ? nd.left : nd.right;
  }
}

export function predictGbm(m: Gbm, x: number[]): number {
  let v = m.init;
  for (const t of m.trees) v += treeValue(t, x);
  return v;
}

/** Each feature's share of the trees' total split gain. */
export function gbmImportance(
  m: Gbm,
): Array<{ feature: string; share: number }> {
  const acc = new Array<number>(m.features.length).fill(0);
  for (const t of m.trees)
    for (const nd of t) if (nd.f >= 0) acc[nd.f]! += nd.gain;
  const total = acc.reduce((a, b) => a + b, 0) || 1;
  return acc
    .map((g, j) => ({ feature: m.features[j]!, share: g / total }))
    .sort((a, b) => b.share - a.share);
}

// ---------------------------------------------------------------- ridge regression (the plain check)

export interface Ridge {
  kind: "ridge";
  mu: number[];
  sd: number[];
  coef: number[];
  intercept: number;
  features: readonly string[];
}

/** Weighted ridge regression on standardised features (normal equations, Gaussian elimination). */
export function trainRidge(
  x: number[][],
  y: number[],
  w: number[],
  features: readonly string[],
  lambda = 50,
): Ridge {
  const nf = features.length;
  const wsum = w.reduce((a, b) => a + b, 0) || 1;
  const mu = Array.from(
    { length: nf },
    (_, j) => x.reduce((a, r, i) => a + r[j]! * w[i]!, 0) / wsum,
  );
  const sd = Array.from(
    { length: nf },
    (_, j) =>
      Math.sqrt(
        x.reduce((a, r, i) => a + w[i]! * (r[j]! - mu[j]!) ** 2, 0) / wsum,
      ) || 1,
  );
  const ym = y.reduce((a, v, i) => a + v * w[i]!, 0) / wsum;
  const A = Array.from({ length: nf }, () => new Array<number>(nf).fill(0));
  const b = new Array<number>(nf).fill(0);
  x.forEach((r, i) => {
    const z = r.map((v, j) => (v - mu[j]!) / sd[j]!);
    for (let p = 0; p < nf; p++) {
      b[p]! += w[i]! * z[p]! * (y[i]! - ym);
      for (let q = p; q < nf; q++) A[p]![q]! += w[i]! * z[p]! * z[q]!;
    }
  });
  for (let p = 0; p < nf; p++) {
    for (let q = 0; q < p; q++) A[p]![q] = A[q]![p]!;
    A[p]![p]! += lambda;
  }
  const coef = solve(A, b);
  return { kind: "ridge", mu, sd, coef, intercept: ym, features };
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const d = M[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r]![c]! / d;
      if (k) for (let q = c; q <= n; q++) M[r]![q]! -= k * M[c]![q]!;
    }
  }
  return M.map((r, i) => r[n]! / (r[i]! || 1e-12));
}

export function predictRidge(m: Ridge, x: number[]): number {
  return (
    m.intercept +
    x.reduce((a, v, j) => a + ((v - m.mu[j]!) / m.sd[j]!) * m.coef[j]!, 0)
  );
}

// ---------------------------------------------------------------- the model as stored

export interface RetentionModel {
  version: 1;
  trainedAt: string;
  videos: number;
  samples: number;
  baseline: HazardBaseline;
  /** The moments: each step's leaving against the rest of the same Short. */
  gbm: Gbm;
  /** The whole Short's level (its traits: hook, opening, pace, footage share), one row per Short. */
  level?: Ridge;
  /** The plain check: one ridge regression over everything. */
  ridge: Ridge;
  /** The curve smoothing it was trained with (MODEL_SETTINGS.smooth). */
  smooth?: number;
  /** The held-out scores at training time (evaluate), so the director can say how far to trust it. */
  validation?: Validation;
  findings?: Finding[];
}

export interface TrainItem {
  video: string;
  frame: ShortFrame;
  curve: Curve;
  views: number;
  publishedAt?: string;
}

/** Shorts of the old pipeline or with no records: their curves still teach the baseline shape. */
export interface BaselineItem {
  curve: Curve;
  duration: number;
}

/** Splits a dataset (pure): Shorts with records become training items (oldest first); the rest teach the baseline. */
export function datasetItems(videos: DatasetVideo[], segmentsOf: SegmentsOf): { items: TrainItem[]; extra: BaselineItem[]; skipped: number } {
  const items: TrainItem[] = [];
  const extra: BaselineItem[] = [];
  let skipped = 0;
  for (const v of videos) {
    if (v.curve.length < 20 || !v.duration || v.duration > 65 || v.episode?.lane === "longform") continue;
    const frame = v.episode ? shortFrame(v.episode, segmentsOf) : undefined;
    if (frame) items.push({ video: v.videoId, frame, curve: v.curve, views: v.views, publishedAt: v.publishedAt });
    else {
      if (v.episode) skipped++;
      extra.push({ curve: v.curve, duration: v.duration });
    }
  }
  items.sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
  return { items, extra, skipped };
}

/** The whole-Short features (the level model's inputs), as indices into FEATURES. */
export const VIDEO_FEATURES = FEATURES.map((n, j) => [n, j] as const).filter(([n]) => n.startsWith("v_")).map(([, j]) => j);

const videoRow = (x: number[]) => VIDEO_FEATURES.map((j) => x[j]!);

/** A step's predicted excess leaving: the Short's level plus the moment's own (pure). */
export function excessOf(m: RetentionModel, x: number[]): number {
  return (m.level ? predictRidge(m.level, videoRow(x)) : 0) + predictGbm(m.gbm, x);
}

export function trainModel(items: TrainItem[], extraCurves: BaselineItem[], now: Date, o: Partial<GbmOptions> = {}): RetentionModel {
  const baseline = hazardBaseline([...extraCurves, ...items.map((i) => ({ curve: i.curve, duration: i.frame.duration }))]);
  const perVideo = items.map((i) => samplesOf(i.video, i.frame, baseline, i.curve, i.views));
  const ys = winsorise(perVideo.flat().map((s) => s.y));
  // Each Short's own level (its mean excess) is learnt from its traits; the trees learn the moments within it.
  let k = 0;
  const levels: number[] = [];
  const within: number[] = [];
  for (const steps of perVideo) {
    const own = ys.slice(k, k + steps.length);
    k += steps.length;
    const lv = mean(own);
    levels.push(lv);
    within.push(...own.map((v) => v - lv));
  }
  const samples = perVideo.flat();
  const x = samples.map((s) => s.x);
  const w = samples.map((s) => s.weight);
  const vrows = perVideo.map((steps) => videoRow(steps[0]?.x ?? FEATURES.map(() => 0)));
  const vw = perVideo.map((steps) => steps[0]?.weight ?? 1);
  return {
    version: 1,
    trainedAt: now.toISOString(),
    videos: items.length,
    samples: samples.length,
    baseline,
    gbm: trainGbm(x, within, w, FEATURES, o),
    level: trainRidge(vrows, levels, vw, VIDEO_FEATURES.map((j) => FEATURES[j]!), 20),
    ridge: trainRidge(x, ys, w, FEATURES),
    smooth: MODEL_SETTINGS.smooth,
  };
}

/** Targets clipped to their 1st and 99th percentiles: a single noisy step must not steer a tree. */
export function winsorise(ys: number[]): number[] {
  const s = [...ys].sort((a, b) => a - b);
  const lo = s[Math.floor(0.01 * (s.length - 1))] ?? 0;
  const hi = s[Math.floor(0.99 * (s.length - 1))] ?? 0;
  return ys.map((v) => clamp(v, lo, hi));
}

export interface Prediction {
  steps: Array<{
    key: number;
    from: number;
    to: number;
    excess: number;
    hazard: number;
    x: number[];
  }>;
  /** The predicted relative curve (1 at the first point), one point per step plus the start. */
  rel: number[];
  /** The baseline's relative curve for a Short of this length. */
  baseRel: number[];
  /** Predicted average share watched, and the baseline's (points of the relative curve). */
  avg: number;
  baseAvg: number;
}

export function predictFrame(
  m: RetentionModel,
  frame: ShortFrame,
  which: "gbm" | "ridge" = "gbm",
): Prediction {
  const steps = gridSteps(frame.duration).map((s) => {
    const x = featuresAt(frame, s.from, s.to);
    const excess =
      which === "gbm" ? excessOf(m, x) : predictRidge(m.ridge, x);
    const b = m.baseline[s.key] ?? 0;
    return {
      key: s.key,
      from: s.from,
      to: s.to,
      excess,
      hazard: b + excess,
      x,
    };
  });
  const rel = curveFromHazards(
    steps,
    steps.map((s) => s.hazard),
  );
  const baseRel = curveFromHazards(
    steps,
    steps.map((s) => m.baseline[s.key] ?? 0),
  );
  return {
    steps,
    rel,
    baseRel,
    avg: avgWatched(rel),
    baseAvg: avgWatched(baseRel),
  };
}

// ---------------------------------------------------------------- weak moments

export interface WeakMoment {
  from: number;
  to: number;
  /** Predicted extra share of those watching lost over the moment, beyond our usual curve (0-1). */
  excess: number;
}

/**
 * The predicted weakest moments (pure): windows of about `seconds` where the predicted excess leaving adds up to most,
 * non-overlapping, strongest first, kept while they cost at least `minExcess` beyond the usual curve.
 */
export function weakMoments(
  steps: Array<{ from: number; to: number; excess: number }>,
  o: {
    n?: number;
    seconds?: number;
    minExcess?: number;
    skipEnd?: number;
  } = {},
): WeakMoment[] {
  const n = o.n ?? 3;
  const sec = o.seconds ?? 1.5;
  const minEx = o.minExcess ?? 0.01;
  if (!steps.length) return [];
  const dur = steps.at(-1)!.to;
  const end = dur * (1 - (o.skipEnd ?? 0.08));
  const cost = steps.map((s) =>
    s.to <= end ? Math.max(0, s.excess) * (s.to - s.from) : 0,
  );
  const taken = new Array<boolean>(steps.length).fill(false);
  const out: WeakMoment[] = [];
  for (let r = 0; r < n; r++) {
    let best = { v: 0, i: -1, j: -1 };
    for (let i = 0; i < steps.length; i++) {
      let v = 0;
      let j = i;
      for (
        ;
        j < steps.length && steps[j]!.to - steps[i]!.from <= sec + 1e-9;
        j++
      ) {
        if (taken[j]) {
          v = -1;
          break;
        }
        v += cost[j]!;
      }
      if (v > best.v) best = { v, i, j: j - 1 };
    }
    if (best.i < 0 || best.v < minEx) break;
    // Tight: no costless steps at either end.
    while (best.i < best.j && cost[best.i] === 0) best.i++;
    while (best.j > best.i && cost[best.j] === 0) best.j--;
    for (let k = best.i; k <= best.j; k++) taken[k] = true;
    out.push({
      from: +steps[best.i]!.from.toFixed(2),
      to: +steps[best.j]!.to.toFixed(2),
      excess: +best.v.toFixed(4),
    });
  }
  return out;
}

/** The real drops of a curve on the same terms: windows where the measured excess adds up most (for scoring). */
export function actualWeakMoments(
  curve: Curve,
  duration: number,
  base: HazardBaseline,
  o: Parameters<typeof weakMoments>[1] = {},
): WeakMoment[] {
  return weakMoments(
    hazardSteps(curve, duration).map((s) => ({
      from: s.from,
      to: s.to,
      excess: s.hazard - (base[s.key] ?? 0),
    })),
    { minExcess: 0.03, ...o },
  );
}

// ---------------------------------------------------------------- validation

export interface Validation {
  folds: number;
  videos: number;
  samples: number;
  /** Step-level R² of the excess on held-out videos: the boosted trees, the ridge and "always the baseline" (0). */
  stepR2: { gbm: number; ridge: number };
  /** Within each held-out video, the rank correlation of predicted and measured excess over its steps (mean). */
  withinSpearman: { gbm: number; ridge: number };
  /** Mean absolute error of the relative curve, in points: the model against the baseline curve alone. */
  curveMae: { gbm: number; ridge: number; baseline: number };
  /** Across held-out videos, rank correlation of predicted and measured average share watched. */
  avgSpearman: { gbm: number; ridge: number };
  /** Of the measured worst moments, the share a flagged moment overlapped (±1 s); and the share of flags that hit one. */
  drops: {
    recall: number;
    precision: number;
    randomRecall: number;
    randomPrecision: number;
    real: number;
    flagged: number;
  };
}

export function spearman(a: number[], b: number[]): number {
  if (a.length < 3) return 0;
  const rank = (xs: number[]) => {
    const order = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
      for (let k = i; k <= j; k++) r[order[k]![1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  return pearson(rank(a), rank(b));
}

export function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < a.length; i++) {
    sab += (a[i]! - ma) * (b[i]! - mb);
    saa += (a[i]! - ma) ** 2;
    sbb += (b[i]! - mb) ** 2;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

const overlaps = (a: WeakMoment, b: WeakMoment, slack = 1) =>
  a.from < b.to + slack && a.to > b.from - slack;

/** Scores flagged moments against the real ones: recall (real ones caught) and precision (flags that were real). */
export function dropScore(
  real: WeakMoment[],
  flagged: WeakMoment[],
): { hit: number; caught: number } {
  return {
    caught: real.filter((r) => flagged.some((f) => overlaps(r, f))).length,
    hit: flagged.filter((f) => real.some((r) => overlaps(r, f))).length,
  };
}

/** Random flags of the same size, for the chance level of dropScore (repeatable). */
export const RANDOM_SETS = 20;

export function randomFlags(
  duration: number,
  n: number,
  seconds: number,
  rand: () => number,
): WeakMoment[] {
  const out: WeakMoment[] = [];
  for (let k = 0; k < n * 20 && out.length < n; k++) {
    const from = rand() * Math.max(0.1, duration * 0.92 - seconds);
    const m = { from, to: from + seconds, excess: 0 };
    if (!out.some((o) => o.from < m.to && o.to > m.from)) out.push(m);
  }
  return out;
}

/** Held-out scores for models trained on the other videos (pure). `split` gives each item its fold (or -1: train only). */
export function evaluateSplit(
  items: TrainItem[],
  extra: BaselineItem[],
  split: (item: TrainItem, k: number) => number,
  folds: number,
  o: Partial<GbmOptions> = {},
): { validation: Validation; perVideo: HeldOut[]; models: RetentionModel[] } {
  const perVideo: HeldOut[] = [];
  const models: RetentionModel[] = [];
  const rand = rng(99);
  for (let f = 0; f < folds; f++) {
    const test = items.filter((it, k) => split(it, k) === f);
    const train = items.filter((it, k) => split(it, k) !== f);
    if (!test.length || train.length < 10) continue;
    const m = trainModel(train, extra, new Date(0), o);
    models.push(m);
    for (const it of test) perVideo.push(heldOut(m, it, rand));
  }
  return { validation: summarise(perVideo, folds), perVideo, models };
}

export interface HeldOut {
  video: string;
  title?: string;
  duration: number;
  /** Measured and predicted (gbm, ridge) excess per step. */
  y: number[];
  g: number[];
  r: number[];
  w: number;
  rel: number[];
  relG: number[];
  relR: number[];
  relB: number[];
  real: WeakMoment[];
  flagged: WeakMoment[];
  random: WeakMoment[][];
}

export function heldOut(
  m: RetentionModel,
  it: TrainItem,
  rand: () => number,
): HeldOut {
  const s = samplesOf(it.video, it.frame, m.baseline, it.curve, it.views);
  const g = s.map((q) => excessOf(m, q.x));
  const r = s.map((q) => predictRidge(m.ridge, q.x));
  const rel = curveFromHazards(
    s,
    s.map((q) => q.hazard),
  );
  const relG = curveFromHazards(
    s,
    s.map((q, i) => q.base + g[i]!),
  );
  const relR = curveFromHazards(
    s,
    s.map((q, i) => q.base + r[i]!),
  );
  const relB = curveFromHazards(
    s,
    s.map((q) => q.base),
  );
  const real = actualWeakMoments(it.curve, it.frame.duration, m.baseline);
  const flagged = weakMoments(
    s.map((q, i) => ({ from: q.from, to: q.to, excess: g[i]! })),
  );
  return {
    video: it.video,
    duration: it.frame.duration,
    y: s.map((q) => q.y),
    g,
    r,
    w: s[0]?.weight ?? 1,
    rel,
    relG,
    relR,
    relB,
    real,
    flagged,
    // Twenty random sets of the same size: the chance level, averaged so it is steady.
    random: Array.from({ length: RANDOM_SETS }, () => randomFlags(it.frame.duration, Math.max(1, flagged.length), 1.5, rand)),
  };
}

export function summarise(per: HeldOut[], folds: number): Validation {
  const r2 = (pick: (h: HeldOut) => number[]) => {
    let ss = 0;
    let st = 0;
    let wsum = 0;
    let ym = 0;
    for (const h of per)
      for (const v of h.y) {
        ym += v * h.w;
        wsum += h.w;
      }
    ym /= wsum || 1;
    for (const h of per) {
      const p = pick(h);
      h.y.forEach((v, i) => {
        ss += h.w * (v - p[i]!) ** 2;
        st += h.w * (v - ym) ** 2;
      });
    }
    return st ? 1 - ss / st : 0;
  };
  const mae = (pick: (h: HeldOut) => number[]) =>
    100 *
    mean(per.map((h) => mean(pick(h).map((v, i) => Math.abs(v - h.rel[i]!)))));
  let caught = 0;
  let hit = 0;
  let rc = 0;
  let rh = 0;
  let real = 0;
  let flagged = 0;
  let randomN = 0;
  for (const h of per) {
    const d = dropScore(h.real, h.flagged);
    caught += d.caught;
    hit += d.hit;
    for (const set of h.random) {
      const q = dropScore(h.real, set);
      rc += q.caught / h.random.length;
      rh += q.hit / h.random.length;
      randomN += set.length / h.random.length;
    }
    real += h.real.length;
    flagged += h.flagged.length;
  }
  const r3 = (v: number) => +v.toFixed(3);
  return {
    folds,
    videos: per.length,
    samples: per.reduce((n, h) => n + h.y.length, 0),
    stepR2: { gbm: r3(r2((h) => h.g)), ridge: r3(r2((h) => h.r)) },
    withinSpearman: {
      gbm: r3(mean(per.map((h) => spearman(h.g, h.y)))),
      ridge: r3(mean(per.map((h) => spearman(h.r, h.y)))),
    },
    curveMae: {
      gbm: r3(mae((h) => h.relG)),
      ridge: r3(mae((h) => h.relR)),
      baseline: r3(mae((h) => h.relB)),
    },
    avgSpearman: {
      gbm: r3(
        spearman(
          per.map((h) => avgWatched(h.relG)),
          per.map((h) => avgWatched(h.rel)),
        ),
      ),
      ridge: r3(
        spearman(
          per.map((h) => avgWatched(h.relR)),
          per.map((h) => avgWatched(h.rel)),
        ),
      ),
    },
    drops: {
      recall: r3(real ? caught / real : 0),
      precision: r3(flagged ? hit / flagged : 0),
      randomRecall: r3(real ? rc / real : 0),
      randomPrecision: r3(randomN ? rh / randomN : 0),
      real,
      flagged,
    },
  };
}

/** K-fold by video (every Short held out once), folds assigned by a seeded shuffle. */
export function crossValidate(
  items: TrainItem[],
  extra: BaselineItem[],
  folds = 5,
  o: Partial<GbmOptions> = {},
) {
  const rand = rng(11);
  const order = items
    .map((_, k) => ({ k, r: rand() }))
    .sort((a, b) => a.r - b.r);
  const fold = new Map(order.map((x, i) => [x.k, i % folds]));
  return evaluateSplit(items, extra, (_, k) => fold.get(k)!, folds, o);
}

// ---------------------------------------------------------------- findings for the writers and editors

export interface Finding {
  feature: string;
  /** In words: what the feature is. */
  what: string;
  /** Predicted points of the audience it costs a Short (negative: it holds them), at the typical exposure. */
  points: number;
  share: number;
}

/** Plain names for the features a lesson can be about (the rest are context: position, part, whole-Short traits). */
export const FEATURE_WORDS: Partial<
  Record<FeatureName, { on: string; off?: string; seconds?: boolean }>
> = {
  shot_plate: { on: "a plain plate (no picture) on screen", seconds: true },
  shot_still: { on: "a still picture on screen", seconds: true },
  shot_clip: { on: "moving footage on screen", seconds: true },
  shot_static: { on: "a static frame (no camera move)", seconds: true },
  shot_trailer: { on: "trailer footage", seconds: true },
  shot_gameplay: { on: "gameplay footage", seconds: true },
  shot_own: { on: "the owner's own footage", seconds: true },
  card_up: { on: "a card on screen", seconds: true },
  shelf_up: { on: "a shelf graphic on screen", seconds: true },
  stamp_up: { on: "the word stamp", seconds: true },
  in_pause: { on: "a pause in the narration", seconds: true },
  sfx_near: { on: "a sound effect landing", seconds: true },
  cut_here: { on: "a cut", seconds: true },
  v_question: { on: "a question hook" },
  v_open_clip: { on: "opening on moving footage" },
  v_open_plate: { on: "opening on a plain plate" },
  v_first_card_early: { on: "a card in the first 2 seconds" },
  v_silent_start: { on: "a silent first half-second" },
  v_game_sound: { on: "the game's own sound under the voice" },
  v_rumour: { on: "a rumour story" },
};

/** Numeric features judged from their low to their high end (q10 to q90 of the training rows). */
export const NUMERIC_WORDS: Partial<Record<FeatureName, string>> = {
  card_chars: "longer card text",
  wps: "faster narration",
  numbers_said: "more numbers said",
  long_words: "more long words (jargon)",
  names_said: "more names said",
  shot_age: "holding one shot longer",
  since_cut: "longer since the last cut",
  pause_len: "longer pauses",
  v_hook_words: "a longer hook",
  v_cut_rate: "a faster cut rate overall",
  v_clip_share: "more of the Short on moving footage",
  v_loop_words: "a longer last line",
};

/**
 * What the model learnt, in points of a Short's audience (pure): for each nameable feature, the mean predicted change
 * in leaving rate when it is switched on (or moved from its low to its high end) across the training rows, turned
 * into points of the curve over the seconds a Short typically has it.
 */
export function modelFindings(m: RetentionModel, rows: number[][]): Finding[] {
  if (!rows.length) return [];
  const imp = new Map(gbmImportance(m.gbm).map((x) => [x.feature, x.share]));
  const sample = rows.filter(
    (_, i) => i % Math.max(1, Math.floor(rows.length / 1500)) === 0,
  );
  const out: Finding[] = [];
  const delta = (
    j: number,
    a: number,
    b: number,
    keep?: (r: number[]) => boolean,
  ) => {
    const rs = keep ? sample.filter(keep) : sample;
    if (rs.length < 30) return undefined;
    return mean(
      rs.map(
        (r) =>
          excessOf(m, Object.assign([...r], { [j]: b })) -
          excessOf(m, Object.assign([...r], { [j]: a })),
      ),
    );
  };
  const dur = median(rows.map((r) => r[FEATURES.indexOf("v_duration")]!)) || 35;
  for (const [name, words] of Object.entries(FEATURE_WORDS) as Array<
    [FeatureName, NonNullable<(typeof FEATURE_WORDS)[FeatureName]>]
  >) {
    const j = FEATURES.indexOf(name);
    const on = rows.filter((r) => r[j]! > 0.5).length / rows.length;
    // A whole-Short trait needs a tenth of the Shorts on each side; a moment, a fiftieth of the moments.
    const floor = name.startsWith("v_") ? 0.1 : 0.02;
    if (on < floor || on > 1 - floor) continue;
    const d = delta(j, 0, 1);
    if (d === undefined) continue;
    // Points over the seconds a Short has it: per-second effects times typical exposure; whole-Short traits over the
    // whole Short.
    const seconds = words.seconds ? on * dur : dur;
    out.push({
      feature: name,
      what: words.on,
      points: +(100 * (1 - Math.exp(-d * seconds))).toFixed(2),
      share: +(imp.get(name) ?? 0).toFixed(4),
    });
  }
  for (const [name, words] of Object.entries(NUMERIC_WORDS) as Array<
    [FeatureName, string]
  >) {
    const j = FEATURES.indexOf(name);
    const vals = rows.map((r) => r[j]!).sort((a, b) => a - b);
    const lo = vals[Math.floor(0.1 * (vals.length - 1))]!;
    const hi = vals[Math.floor(0.9 * (vals.length - 1))]!;
    if (hi <= lo) continue;
    const d = delta(j, lo, hi);
    if (d === undefined) continue;
    out.push({
      feature: name,
      what: words,
      points: +(100 * (1 - Math.exp(-d * dur))).toFixed(2),
      share: +(imp.get(name) ?? 0).toFixed(4),
    });
  }
  return out.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

/**
 * The findings that hold up (pure): the full model's, kept only where the models trained on the cross-validation folds
 * agree on the direction (at least `agree` of them), so a lesson never rests on a handful of Shorts.
 */
export function stableFindings(full: RetentionModel, folds: RetentionModel[], rows: number[][], agree = 0.8): Finding[] {
  const all = modelFindings(full, rows);
  if (!folds.length) return all;
  const per = folds.map((m) => new Map(modelFindings(m, rows).map((f) => [f.feature, f.points])));
  return all.filter((f) => {
    const same = per.filter((p) => Math.sign(p.get(f.feature) ?? 0) === Math.sign(f.points)).length;
    return same / folds.length >= agree;
  });
}

/** The findings as lesson lines (pure): only effects of at least `minPoints`, with the held-out caveat. */
export function modelLessonLines(
  m: RetentionModel,
  date: string,
  max = 4,
  minPoints = 1,
): string[] {
  const v = m.validation;
  if (!v || v.withinSpearman.gbm < 0.05) return [];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return (m.findings ?? [])
    .filter((f) => Math.abs(f.points) >= minPoints)
    .slice(0, max)
    .map((f) =>
      f.points > 0
        ? `${cap(f.what)} costs a Short about ${f.points.toFixed(1)} points of its audience, all else equal (retention model ${date}, ${m.videos} Shorts). Cut it back.`
        : `${cap(f.what)} holds about ${(-f.points).toFixed(1)} points more of a Short's audience, all else equal (retention model ${date}, ${m.videos} Shorts). Lean on it.`,
    );
}
