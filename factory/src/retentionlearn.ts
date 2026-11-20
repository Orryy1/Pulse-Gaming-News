// Retention curve learning (RETENTION_LEARN, off by default; owner, 12 Nov 2026). The factory already kept each
// video's YouTube retention curve a week after it went live and told the news writer which parts of a Short lost
// viewers (src/analytics.ts dropLessons). This goes further: the curve is read once a video is 48 hours old, every
// drop in it is found, and each drop is lined up with what was on screen and in the narration at that moment, from
// the episode's own records: the words being spoken (word timings), the part of the Short, the picture (moving
// footage, a trailer still, store art, a plain plate), the card or shelf graphic up, the stamp, a cut, a sound
// effect, a character quote, the game's own sound and the opening's style. Across videos the moments become plain
// lessons with their numbers ("a card in the first 2 s loses 8 points more", "the take line loses 5 points"), never a
// model: every figure is a reading of the curves. The lessons go into the weekly analytics report (latest.md and
// latest.json, so ANALYTICS_LOOP_LESSONS hands them to the writers and the PC's pull files them in lessons.md) and the
// Sunday growth report. A pattern needs MIN_VIDEOS videos on each side before it is stated.

import type { Db } from "./db.ts";
import type { Script } from "./editorial/schema.ts";
import type { Word } from "./voice/elevenlabs.ts";
import {
  buildSegments,
  type Segment,
  type SegmentInput,
} from "./render/timeline.ts";
import { LIVE_AT, type RetentionSource } from "./analytics.ts";
import { log } from "./lib/util.ts";

export type Curve = Array<{ at: number; watch: number; relative: number }>;

/** The label a 48-hour curve is stored under in video_metrics (the week-old one stays "curve"). */
export const EARLY_LABEL = "curve_2d";
/** How old a video must be before its curve is read (Analytics lags about two days). */
export const EARLY_HOURS = 48;
/** The opening window: the swipe-away that every Short has, judged on its own. */
export const OPENING_SECONDS = 2;
/** No pattern is stated with fewer videos than this on each side. */
export const MIN_VIDEOS = 3;
/** A drop must cost at least this share of the viewers watching as it began, beyond the video's own pace. */
export const MIN_DROP = 0.02;
/** Curves read per tick, oldest first, so a backlog clears over a day without a burst. */
export const CURVES_PER_TICK = 8;

const pctOf = (x: number) => Math.round(x * 100);
const median = (xs: number[]) => {
  if (!xs.length) return 1;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/** The share watching at a point (seconds), interpolated between the curve's points. */
export function watchAtSeconds(
  curve: Curve,
  seconds: number,
  duration: number,
): number {
  if (!curve.length || duration <= 0) return 0;
  const r = Math.min(1, Math.max(0, seconds / duration));
  const pts = [...curve].sort((a, b) => a.at - b.at);
  if (r <= pts[0]!.at) return pts[0]!.watch;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (r <= b.at) {
      const span = b.at - a.at;
      return span > 0
        ? a.watch + ((b.watch - a.watch) * (r - a.at)) / span
        : b.watch;
    }
  }
  return pts.at(-1)!.watch;
}

export interface Drop {
  /** Seconds into the video. */
  from: number;
  to: number;
  /** Of the viewers watching at `from`, the share gone by `to`. */
  loss: number;
  /** That loss beyond what our Shorts usually lose at the same point of their length (or the video's own pace). */
  excess: number;
  /** YouTube's relativeRetentionPerformance at the drop's end (0.5 = typical for similar videos). */
  relative: number;
}

export interface Step {
  /** The step's place on YouTube's 1% grid of the video's length (0-99). */
  key: number;
  from: number;
  to: number;
  /** Of the viewers watching at `from`, the share gone by `to`. */
  loss: number;
  rel: number;
}

/** The curve's steps from point to point, after a three-point smoothing: a Short with few views moves in stairs. */
export function curveSteps(curve: Curve, duration: number): Step[] {
  const pts = [...curve].sort((a, b) => a.at - b.at);
  const w = pts.map(
    (p, i) =>
      ((pts[i - 1]?.watch ?? p.watch) +
        p.watch +
        (pts[i + 1]?.watch ?? p.watch)) /
      3,
  );
  const out: Step[] = [];
  for (let i = 1; i < pts.length; i++) {
    const w0 = w[i - 1]!;
    const w1 = w[i]!;
    out.push({
      key: Math.round(pts[i - 1]!.at * 100),
      from: pts[i - 1]!.at * duration,
      to: pts[i]!.at * duration,
      loss: w0 > 0 ? (w0 - w1) / w0 : 0,
      rel: pts[i]!.relative,
    });
  }
  return out;
}

/** Our Shorts' typical loss at each point of their length (the median step at each 1% of the grid). */
export type Baseline = Map<number, number>;

export function baselineOf(
  curves: Array<{ curve: Curve; duration: number }>,
): Baseline {
  const by = new Map<number, number[]>();
  for (const c of curves)
    for (const s of curveSteps(c.curve, c.duration)) {
      const xs = by.get(s.key) ?? [];
      xs.push(s.loss);
      by.set(s.key, xs);
    }
  const out: Baseline = new Map();
  for (const [k, xs] of by) {
    if (xs.length < MIN_VIDEOS) continue;
    const s = [...xs].sort((a, b) => a - b);
    out.set(k, s[Math.floor(s.length / 2)]!);
  }
  return out;
}

/**
 * The video's own pace: the share of viewers it loses a second, between the end of the opening and its last tenth
 * (where rewatches and the end screen bend the curve). Never negative. Used where there is no baseline (long videos).
 */
export function ownPace(curve: Curve, duration: number): number {
  const a = Math.min(
    duration * 0.5,
    Math.max(OPENING_SECONDS, duration * 0.05),
  );
  const b = duration * 0.9;
  const wa = watchAtSeconds(curve, a, duration);
  const wb = watchAtSeconds(curve, b, duration);
  if (b - a <= 0 || wa <= 0) return 0;
  return Math.max(0, (wa - wb) / wa / (b - a));
}

/** Each step with what it lost beyond the baseline at its point of the length (or beyond the video's own pace). */
export function excessSteps(
  curve: Curve,
  duration: number,
  baseline?: Baseline,
): Array<Step & { expected: number; excess: number }> {
  const pace = ownPace(curve, duration);
  return curveSteps(curve, duration).map((s) => {
    const expected = baseline?.get(s.key) ?? pace * (s.to - s.from);
    return { ...s, expected, excess: s.loss - expected };
  });
}

/** Whether a step counts for the drops and the effects: after the opening, before the last tenth. */
const inBody = (s: { from: number; to: number }, duration: number) =>
  s.to > OPENING_SECONDS && s.from < duration * 0.9;

/**
 * The drops in a curve (pure): runs of steps where viewers left at more than twice what our Shorts usually lose at that
 * point (the baseline; the video's own pace without one), merged, kept when they cost at least MIN_DROP beyond it. The
 * opening's first 2 s are judged apart (`openingLoss`) so the swipe never hides what comes after it, and the last tenth
 * is left out: rewatches lift it and the end screen drops it.
 */
export function findDrops(
  curve: Curve,
  duration: number,
  baseline?: Baseline,
): Drop[] {
  if (curve.length < 5 || duration <= 0) return [];
  const steps = excessSteps(curve, duration, baseline);
  const out: Drop[] = [];
  let run: Array<(typeof steps)[number]> = [];
  const close = () => {
    if (!run.length) return;
    const lost = 1 - run.reduce((k, s) => k * (1 - Math.max(0, s.loss)), 1);
    const excess = run.reduce((a, s) => a + s.excess, 0);
    if (excess >= MIN_DROP)
      out.push({
        from: +Math.max(OPENING_SECONDS, run[0]!.from).toFixed(2),
        to: +run.at(-1)!.to.toFixed(2),
        loss: +lost.toFixed(4),
        excess: +excess.toFixed(4),
        relative: run.at(-1)!.rel,
      });
    run = [];
  };
  for (const s of steps) {
    if (
      inBody(s, duration) &&
      s.loss > 0.002 &&
      s.loss > 2 * Math.max(0, s.expected)
    )
      run.push(s);
    else close();
  }
  close();
  return out;
}
/** Of the viewers there at frame one, the share gone after OPENING_SECONDS. */
export function openingLoss(curve: Curve, duration: number): number {
  const w0 = watchAtSeconds(curve, 0, duration);
  const w2 = watchAtSeconds(
    curve,
    Math.min(OPENING_SECONDS, duration),
    duration,
  );
  return w0 > 0 ? Math.max(0, (w0 - w2) / w0) : 0;
}

// ---------------------------------------------------------------- what was on screen

/** One video's timeline, reduced to what can be named at any second (built from the episode's records). */
export interface Timeline {
  duration: number;
  words: Word[];
  /** Spans with the names of what was on screen or heard; `event` spans are short moments (a cut, a card landing). */
  spans: Array<{ from: number; to: number; tag: string; event?: boolean }>;
  /** Tags true of the whole video (its opening style, game sound, narrator). */
  video: string[];
  /** The part of a Short (hook, first card...) at each second, for the report. */
  parts: Array<{ from: number; to: number; part: string; text: string }>;
}

/** The part of a Short a segment belongs to, as the writer knows it. */
export function partName(kind: string, beat: number): string {
  if (kind !== "beat")
    return kind === "take" ? "take" : kind === "loop" ? "last line" : kind;
  return beat === 0 ? "first card" : beat === 1 ? "second card" : "later cards";
}

const STILL_KIND: Record<string, string> = {
  capsule: "store art",
  hero: "store art",
  header: "store art",
  library: "store art",
  screenshot: "a screenshot",
  article: "an article picture",
  photo: "a photo of a person",
};

/** Episode records as stored (loosely typed: older episodes lack newer fields). */
export interface EpisodeRecords {
  id: string;
  lane: string;
  script: Script | null;
  assets: any;
  /** The latest game_audio event's detail, when the game-sound test ran on it. */
  gameAudio?: { on?: boolean; seconds?: number; heard?: unknown } | null;
  /** The share of viewers who stayed to watch rather than swiping away (engaged views over views), when read. */
  stayed?: number;
}

/**
 * Everything nameable on a Short's timeline (pure). `segmentsOf` is the pipeline's segmentInputs, injected to keep
 * this module free of the pipeline. Undefined when the records lack word timings or a script.
 */
export function shortTimeline(
  ep: EpisodeRecords,
  segmentsOf: (script: Script, desk: boolean) => SegmentInput[],
): Timeline | undefined {
  const script = ep.script;
  const a = ep.assets ?? {};
  const words: Word[] = Array.isArray(a.words) ? a.words : [];
  const duration = Number(a.durationSeconds ?? 0);
  if (!script?.beats || !words.length || !duration) return undefined;
  let segments: Segment[];
  try {
    segments = buildSegments(segmentsOf(script, !!a.desk), words, duration);
  } catch {
    return undefined;
  }
  const spans: Timeline["spans"] = [];
  const parts: Timeline["parts"] = [];
  const add = (from: number, to: number, tag: string, event = false) => {
    if (to > from) spans.push({ from, to, tag, event });
  };
  const moment = (at: number, tag: string) =>
    add(Math.max(0, at - 0.6), Math.min(duration, at + 0.9), tag, true);
  let beat = 0;
  segments.forEach((g) => {
    const part = partName(g.kind, beat);
    if (g.kind === "beat") beat++;
    parts.push({ from: g.start, to: g.end, part, text: g.text });
    add(g.start, g.end, `during the ${part}`);
    if (g.kind === "take") {
      moment(g.start, "the take line starting");
      add(g.start, g.end, "the take card");
    }
    if (g.kind === "loop") moment(g.start, "the last line starting");
    if (g.kind === "desk") add(g.start, g.end, "the desk partner's question");
    const kind = g.visual?.kind;
    if (g.kind === "beat" && kind && kind !== "none") {
      add(g.start, g.end, `a ${kind} card`);
      moment(g.start, "a card landing");
    }
  });
  const plan = a.plan ?? {};
  const fps = Number(plan.fps ?? 30) || 30;
  const clips: any[] = Array.isArray(a.clips) ? a.clips : [];
  const images: any[] = Array.isArray(a.images) ? a.images : [];
  const shots: any[] = Array.isArray(plan.shots) ? plan.shots : [];
  shots.forEach((s, k) => {
    const from = Number(s.start) / fps;
    const to = Math.min(duration, Number(s.end) / fps);
    const type = s.media?.type;
    if (type === "clip") {
      const c = clips[s.media.index] ?? {};
      const prov = String(c.provenance ?? "");
      add(from, to, "moving footage");
      if (/own (capture|footage|recording)|owner/i.test(prov) || c.own)
        add(from, to, "the owner's own footage");
      else if (/trailer/i.test(prov)) add(from, to, "trailer footage");
      else if (/gameplay|playthrough|cutscene/i.test(prov))
        add(from, to, "gameplay footage");
      if (c.stock) add(from, to, "stock footage");
    } else if (type === "image") {
      const im = images[s.media.index] ?? {};
      add(from, to, "a still picture");
      const kind = STILL_KIND[String(im.kind ?? "")];
      if (kind) add(from, to, kind);
      if (/trailer/i.test(String(im.provenance ?? "")))
        add(from, to, "a trailer still");
    } else if (type === "plate") add(from, to, "a plain plate (no picture)");
    else if (type) add(from, to, `a ${type} shot`);
    if (s.move === "settle") add(from, to, "a static frame");
    if (k > 0) moment(from, "a cut");
  });
  for (const d of Array.isArray(plan.shelf) ? plan.shelf : [])
    if (d?.device && d.device !== "rail")
      add(
        Number(d.from) / fps,
        Math.min(duration, Number(d.to) / fps),
        `the ${d.device} shelf graphic`,
      );
  for (const c of Array.isArray(plan.craft?.cards) ? plan.craft.cards : []) {
    const g = segments[Number(c.segment)];
    if (g && c.look) add(g.start, g.end, `the ${c.look} card look`);
  }
  for (const cue of Array.isArray(plan.sfx) ? plan.sfx : []) {
    const name = String(cue.file ?? "")
      .split("/")
      .pop()
      ?.replace(/\.\w+$/, "")
      .replace(/-\d+$/, "");
    if (name) moment(Number(cue.frame) / fps, `the "${name}" sound effect`);
  }
  // The stamp lands on its word (the first time it is said after the hook).
  const stampWord = String((script as any).stamp?.word ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (stampWord) {
    const hookEnd = segments[0]?.end ?? 0;
    const w =
      words.find(
        (x) =>
          x.start >= hookEnd &&
          x.text.toLowerCase().replace(/[^a-z0-9]/g, "") === stampWord,
      ) ??
      words.find(
        (x) => x.text.toLowerCase().replace(/[^a-z0-9]/g, "") === stampWord,
      );
    if (w) add(w.start, Math.min(duration, w.start + 1.5), "the word stamp");
  }
  // Character quotes, when the Short played any (CHARACTER_QUOTES): their windows on the Short's timeline.
  for (const q of Array.isArray(a.quotes) ? a.quotes : [])
    if (Number.isFinite(Number(q.start)))
      add(
        Number(q.start),
        Number(q.start) + Number(q.seconds ?? 0),
        "a character quote",
      );
  // The whole video: its opening and sound.
  const video: string[] = [];
  const first = shots[0];
  const firstClip =
    first?.media?.type === "clip" ? clips[first.media.index] : undefined;
  if (first?.media?.type === "clip") video.push("opens on moving footage");
  else if (first?.media?.type === "image") {
    video.push("opens on a still picture");
    if (/trailer/i.test(String(images[first.media.index]?.provenance ?? "")))
      video.push("opens on a trailer still");
    if (
      STILL_KIND[String(images[first.media.index]?.kind ?? "")] === "store art"
    )
      video.push("opens on store art");
  } else if (first?.media?.type === "plate")
    video.push("opens on a plain plate");
  if (firstClip && /_opening\./.test(String(firstClip.file ?? "")))
    video.push("opens on the picked opening moment");
  if (firstClip && /trailer/i.test(String(firstClip.provenance ?? "")))
    video.push("opens on trailer footage");
  const shelf0 = (Array.isArray(plan.shelf) ? plan.shelf : []).find(
    (d: any) => Number(d.from) / fps < OPENING_SECONDS,
  );
  if (shelf0) video.push("a card in the first 2 s");
  const firstCard = segments.find(
    (g) => g.kind === "beat" && g.visual && g.visual.kind !== "none",
  );
  if (firstCard && firstCard.start < OPENING_SECONDS)
    video.push("a card in the first 2 s");
  if (a.suite) video.push("the new-look opening poster");
  const hook = String(script.hook ?? "");
  if (/\?\s*$/.test(hook)) video.push("a question hook");
  const hookWords = hook.split(/\s+/).filter(Boolean).length;
  if (hookWords)
    video.push(
      hookWords <= 8 ? "a hook of 8 words or fewer" : "a hook over 8 words",
    );
  if (a.test?.key === "hook_style" && a.test?.label)
    video.push(`the "${a.test.label}" hook style`);
  const firstWord = words[0]?.start ?? 0;
  if (firstWord > 0.6) video.push("a silent first half-second");
  if (ep.gameAudio) {
    const heard =
      Number(ep.gameAudio.seconds ?? 0) > 0 ||
      (typeof ep.gameAudio.heard === "number" && ep.gameAudio.heard > 0);
    video.push(
      ep.gameAudio.on && heard
        ? "the game's own sound under the voice"
        : "no game sound",
    );
  }
  return { duration, words, spans, video: [...new Set(video)], parts };
}

/** A long video's timeline (pure): its entries, chapter breathers and words; the shot list is not read yet. */
export function longTimeline(ep: EpisodeRecords): Timeline | undefined {
  const a = ep.assets ?? {};
  const words: Word[] = Array.isArray(a.words) ? a.words : [];
  const duration = Number(a.durationSeconds ?? 0);
  if (!words.length || !duration) return undefined;
  const spans: Timeline["spans"] = [];
  const parts: Timeline["parts"] = [];
  const starts: number[] = Array.isArray(a.entryStarts)
    ? a.entryStarts.map(Number)
    : [];
  if (starts.length) {
    spans.push({ from: 0, to: starts[0]!, tag: "during the intro" });
    parts.push({ from: 0, to: starts[0]!, part: "intro", text: "" });
  }
  starts.forEach((s, k) => {
    const to = starts[k + 1] ?? duration;
    parts.push({ from: s, to, part: `entry ${k + 1}`, text: "" });
    spans.push({
      from: Math.max(0, s - 1),
      to: s + 4,
      tag: "an entry starting",
      event: true,
    });
  });
  for (const b of (Array.isArray(a.breaks) ? a.breaks : []) as Array<{
    start: number;
    end: number;
  }>)
    spans.push({
      from: Number(b.start),
      to: Number(b.end),
      tag: "a chapter breather",
    });
  return { duration, words, spans, video: [], parts };
}

/** The tags on screen or heard anywhere between two seconds. */
export function tagsBetween(tl: Timeline, from: number, to: number): string[] {
  return [
    ...new Set(
      tl.spans.filter((s) => s.from < to && s.to > from).map((s) => s.tag),
    ),
  ];
}

/** The words spoken between two seconds (a little either side, so a drop shows the line it fell on). */
export function saidBetween(tl: Timeline, from: number, to: number): string {
  return tl.words
    .filter((w) => w.end > from - 0.8 && w.start < to + 0.4)
    .map((w) => w.text)
    .join(" ")
    .slice(0, 160);
}

export function partAt(tl: Timeline, t: number): string {
  return tl.parts.find((p) => t >= p.from && t < p.to)?.part ?? "";
}

// ---------------------------------------------------------------- one video, then all of them

export interface VideoStudy {
  id: string;
  videoId: string;
  title: string;
  kind: "short" | "long";
  duration: number;
  /** Which curve this is: the 48-hour one ("curve_2d"), the week-old one ("curve") or one read live. */
  label: string;
  curve: Curve;
  openingLoss: number;
  /** The share of viewers who swiped away rather than stayed to watch (YouTube's engaged views), when read. */
  swiped?: number;
  endWatch: number;
  video: string[];
  drops: Array<Drop & { part: string; said: string; tags: string[] }>;
}

export function studyVideo(
  ep: EpisodeRecords & { videoId: string; label: string },
  curve: Curve,
  tl: Timeline,
  baseline?: Baseline,
): VideoStudy {
  const drops = findDrops(curve, tl.duration, baseline).map((d) => ({
    ...d,
    part: partAt(tl, (d.from + d.to) / 2),
    said: saidBetween(tl, d.from, d.to),
    tags: tagsBetween(tl, d.from, d.to),
  }));
  return {
    id: ep.id,
    videoId: ep.videoId,
    title: ep.script?.youtube?.title ?? ep.script?.headline ?? ep.id,
    kind: ep.lane === "longform" ? "long" : "short",
    duration: +tl.duration.toFixed(2),
    label: ep.label,
    curve,
    openingLoss: +openingLoss(curve, tl.duration).toFixed(4),
    ...(ep.stayed !== undefined
      ? { swiped: +Math.max(0, 1 - ep.stayed).toFixed(4) }
      : {}),
    endWatch: +watchAtSeconds(curve, tl.duration * 0.97, tl.duration).toFixed(
      4,
    ),
    video: tl.video,
    drops,
  };
}

/** What a tag did to viewers while it was up, against the rest of the same Short, across Shorts. */
export interface TagEffect {
  tag: string;
  /** Viewers left this many times as fast while it was up as in the rest of the same Short (averaged over Shorts). */
  ratio: number;
  /** The extra share of the audience lost a second while it was up, beyond the baseline. */
  perSecond: number;
  /** Seconds a Short had it, on average (after the opening). */
  seconds: number;
  /** Points of the audience it cost a Short: perSecond x seconds x 100 (negative: it held them). */
  points: number;
  videos: number;
  /** How many of those Shorts lost faster while it was up. */
  worse: number;
}

/**
 * Each tag's effect (pure): in every Short, the loss a second beyond the baseline while the tag was up against the
 * rest of the same Short (so a weak Short and an early moment are both allowed for), then averaged over the Shorts
 * that had both. Steps are judged at their middle. A tag needs MIN_VIDEOS Shorts.
 */
export function tagEffects(
  items: Array<{ study: VideoStudy; timeline: Timeline }>,
  baseline?: Baseline,
): TagEffect[] {
  const acc = new Map<
    string,
    { diff: number[]; ratio: number[]; secs: number[]; worse: number }
  >();
  for (const { study, timeline } of items) {
    if (study.kind !== "short") continue;
    const d = timeline.duration;
    const steps = excessSteps(study.curve, d, baseline).filter((s) =>
      inBody(s, d),
    );
    if (steps.length < 10) continue;
    const per = new Map<
      string,
      { inEx: number; inLoss: number; inExp: number; inDt: number }
    >();
    let allEx = 0;
    let allLoss = 0;
    let allExp = 0;
    let allDt = 0;
    for (const s of steps) {
      const dt = s.to - s.from;
      allEx += s.excess;
      allLoss += Math.max(0, s.loss);
      allExp += Math.max(1e-4, s.expected);
      allDt += dt;
      const mid = (s.from + s.to) / 2;
      for (const tag of new Set(
        timeline.spans
          .filter((x) => x.from <= mid && x.to > mid)
          .map((x) => x.tag),
      )) {
        const p = per.get(tag) ?? { inEx: 0, inLoss: 0, inExp: 0, inDt: 0 };
        p.inEx += s.excess;
        p.inLoss += Math.max(0, s.loss);
        p.inExp += Math.max(1e-4, s.expected);
        p.inDt += dt;
        per.set(tag, p);
      }
    }
    for (const [tag, p] of per) {
      const outDt = allDt - p.inDt;
      if (p.inDt < 0.5 || outDt < 2) continue;
      const diff = p.inEx / p.inDt - (allEx - p.inEx) / outDt;
      // Both sides against what our Shorts usually lose at those points, so an early tag is not blamed for being early.
      const outRate = (allLoss - p.inLoss) / Math.max(1e-6, allExp - p.inExp);
      const g = acc.get(tag) ?? { diff: [], ratio: [], secs: [], worse: 0 };
      g.diff.push(diff);
      if (outRate > 0) g.ratio.push(p.inLoss / p.inExp / outRate);
      g.secs.push(p.inDt);
      if (diff > 0) g.worse++;
      acc.set(tag, g);
    }
  }
  return [...acc.entries()]
    .filter(([, g]) => g.diff.length >= MIN_VIDEOS)
    .map(([tag, g]) => {
      const perSecond = mean(g.diff);
      const seconds = mean(g.secs);
      return {
        tag,
        ratio: +median(g.ratio).toFixed(2),
        perSecond: +perSecond.toFixed(5),
        seconds: +seconds.toFixed(1),
        points: +(perSecond * seconds * 100).toFixed(2),
        videos: g.diff.length,
        worse: g.worse,
      };
    })
    .sort((a, b) => b.points - a.points);
}

export interface Cause {
  /** What was on screen or heard ("trailer footage", "the take line starting", "opens on a still picture"). */
  tag: string;
  /** "drop": costs viewers while it is up; "opening": a whole-video trait judged on the swipe and the first 2 s. */
  kind: "drop" | "opening";
  /** Extra share of the audience lost a Short, in points. */
  points: number;
  videos: number;
  /** The comparison in words, for the report. */
  detail: string;
  /** Up to three moments it was in: video title, time, loss and the words said. */
  examples: Array<{ title: string; at: number; said: string; loss: number }>;
}

/** How a tag reads inside a sentence: "the first card", "a cut", "the take line starting". */
export function phrase(tag: string): string {
  return tag.replace(/^during the /, "the ");
}

/** A whole-video trait's comparison (pure): the mean of `metric` with it and without it, MIN_VIDEOS a side. */
function traitGap(
  shorts: VideoStudy[],
  trait: string,
  metric: (v: VideoStudy) => number | undefined,
): { yes: number; no: number; nYes: number; nNo: number } | undefined {
  const pick = (has: boolean) =>
    shorts
      .filter((v) => v.video.includes(trait) === has)
      .map(metric)
      .filter((x): x is number => x !== undefined);
  const yes = pick(true);
  const no = pick(false);
  if (yes.length < MIN_VIDEOS || no.length < MIN_VIDEOS) return undefined;
  return { yes: mean(yes), no: mean(no), nYes: yes.length, nNo: no.length };
}

/**
 * The causes of lost viewers across Shorts (pure), biggest first. A drop cause is a tag that lost viewers faster while
 * it was up than the rest of the same Short did, in most of the Shorts that had it (`tagEffects`). An opening cause is a
 * whole-video trait whose Shorts were swiped away more (or lost more in the first 2 s) than the Shorts without it.
 */
export function dropCauses(
  items: Array<{ study: VideoStudy; timeline: Timeline }>,
  effects: TagEffect[],
): Cause[] {
  const shorts = items.filter((x) => x.study.kind === "short");
  if (!shorts.length) return [];
  const causes: Cause[] = [];
  for (const e of effects) {
    if (e.points < 0.5 || e.ratio <= 1.05 || e.worse / e.videos < 0.6) continue;
    const examples = shorts
      .flatMap((x) =>
        x.study.drops
          .filter((d) => d.tags.includes(e.tag))
          .map((d) => ({
            title: x.study.title,
            at: d.from,
            said: d.said,
            loss: d.loss,
          })),
      )
      .sort((a, b) => b.loss - a.loss)
      .slice(0, 3);
    causes.push({
      tag: e.tag,
      kind: "drop",
      points: e.points,
      videos: e.videos,
      detail: `viewers left ${e.ratio.toFixed(1)} times as fast while ${phrase(e.tag)} was up as in the rest of the same Short (faster in ${e.worse} of ${e.videos} Shorts; about ${e.seconds.toFixed(1)} s a Short)`,
      examples,
    });
  }
  const studies = shorts.map((x) => x.study);
  for (const t of new Set(studies.flatMap((v) => v.video))) {
    const swipe = traitGap(studies, t, (v) => v.swiped);
    const open = traitGap(studies, t, (v) => v.openingLoss);
    const sw = swipe && swipe.yes - swipe.no >= 0.02 ? swipe : undefined;
    const op = open && open.yes - open.no >= 0.01 ? open : undefined;
    if (!sw && !op) continue;
    const points =
      100 * ((sw ? sw.yes - sw.no : 0) + (op ? op.yes - op.no : 0));
    const parts = [
      sw &&
        `${pctOf(sw.yes)}% swiped away against ${pctOf(sw.no)}% for the rest (${sw.nYes} against ${sw.nNo} Shorts)`,
      op &&
        `${pctOf(op.yes)}% of those who stayed were gone after 2 s against ${pctOf(op.no)}% (${op.nYes} against ${op.nNo})`,
    ].filter(Boolean);
    causes.push({
      tag: t,
      kind: "opening",
      points: +points.toFixed(2),
      videos: (sw ?? op)!.nYes,
      detail: parts.join("; "),
      examples: shorts
        .filter((x) => x.study.video.includes(t))
        .sort(
          (a, b) =>
            (b.study.swiped ?? b.study.openingLoss) -
            (a.study.swiped ?? a.study.openingLoss),
        )
        .slice(0, 3)
        .map((x) => ({
          title: x.study.title,
          at: 0,
          said: saidBetween(x.timeline, 0, OPENING_SECONDS),
          loss: x.study.swiped ?? x.study.openingLoss,
        })),
    });
  }
  // Two tags true of the same moments (the take and its card, a question hook and the question-gap style) are one
  // finding: the more specific one stays.
  const seen = new Set<string>();
  const key = (c: Cause) => `${c.kind}|${c.points}|${c.videos}|${c.detail.replace(/while .*? was up/, "")}`;
  return causes
    .sort((a, b) => b.points - a.points || Number(a.tag.startsWith("during")) - Number(b.tag.startsWith("during")))
    .filter((c) => (seen.has(key(c)) ? false : (seen.add(key(c)), true)));
}

/** "Shorts that open on a still picture", "Shorts with a question hook". */
export function openingSubject(trait: string): string {
  return /^opens on /.test(trait) ? `Shorts that ${trait.replace(/^opens/, "open")}` : `Shorts with ${trait}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The lessons in plain text (pure): the strongest causes first, then what held viewers best. Each names its numbers and
 * sample; at most `max` lines; the date marks them for the weekly report (and its blocklist).
 */
export function retentionLessonLines(
  causes: Cause[],
  effects: TagEffect[],
  date: string,
  max = 4,
): string[] {
  const out: string[] = [];
  const pts = (p: number) => `${p.toFixed(p < 10 ? 1 : 0)} points`;
  for (const c of causes.slice(0, 3)) {
    if (c.kind === "opening")
      out.push(
        `${openingSubject(c.tag)} lose ${pts(c.points)} more of their viewers at the start: ${c.detail}. Avoid it in the opening (retention curves ${date}).`,
      );
    else
      out.push(
        `${cap(phrase(c.tag))} costs about ${pts(c.points)} of a Short's audience: ${c.detail}. Keep it shorter or give viewers a reason to stay through it (retention curves ${date}).`,
      );
  }
  const best = effects
    .filter((e) => e.points < -0.5 && e.ratio < 0.95 && e.worse / e.videos <= 0.4)
    .sort((a, b) => a.points - b.points)[0];
  if (best)
    out.push(
      `${cap(phrase(best.tag))} holds viewers: they left ${best.ratio.toFixed(1)} times as fast while it was up as in the rest of the same Short (slower in ${best.videos - best.worse} of ${best.videos} Shorts). Lean on it (retention curves ${date}).`,
    );
  return out.slice(0, max);
}

export interface RetentionStudy {
  version: 1;
  at: string;
  videos: VideoStudy[];
  causes: Cause[];
  effects: TagEffect[];
  lessons: string[];
  /** Videos with a curve but no usable records (no word timings or plan). */
  skipped: string[];
}

/** Builds the study from curves and records (pure once the rows are read). */
export function buildStudy(
  rows: Array<
    EpisodeRecords & { videoId: string; label: string; curve: Curve }
  >,
  segmentsOf: (script: Script, desk: boolean) => SegmentInput[],
  now: Date,
): RetentionStudy {
  const ready: Array<{ row: (typeof rows)[number]; timeline: Timeline }> = [];
  const skipped: string[] = [];
  for (const r of rows) {
    const tl =
      r.lane === "longform" ? longTimeline(r) : shortTimeline(r, segmentsOf);
    if (!tl || r.curve.length < 20) skipped.push(r.id);
    else ready.push({ row: r, timeline: tl });
  }
  const baseline = baselineOf(
    ready
      .filter((x) => x.row.lane !== "longform")
      .map((x) => ({ curve: x.row.curve, duration: x.timeline.duration })),
  );
  const items = ready.map(({ row, timeline }) => ({
    study: studyVideo(
      row,
      row.curve,
      timeline,
      row.lane === "longform" ? undefined : baseline,
    ),
    timeline,
  }));
  const effects = tagEffects(items, baseline);
  const causes = dropCauses(items, effects);
  return {
    version: 1,
    at: now.toISOString(),
    videos: items.map((x) => x.study),
    causes,
    effects,
    lessons: retentionLessonLines(
      causes,
      effects,
      now.toISOString().slice(0, 10),
    ),
    skipped,
  };
}

/** The week's section for the analytics report and the growth report (pure): a few short lines. */
export function retentionSection(
  st: RetentionStudy | undefined,
  max = 5,
): string[] {
  if (!st) return [];
  const shorts = st.videos.filter((v) => v.kind === "short");
  if (!shorts.length)
    return [
      "Retention curves: none read yet (RETENTION_LEARN reads each video's curve at 48 hours).",
    ];
  const swiped = shorts
    .filter((v) => v.swiped !== undefined)
    .map((v) => v.swiped!);
  const lines = [
    `Retention curves: ${shorts.length} Shorts${st.videos.length > shorts.length ? ` and ${st.videos.length - shorts.length} long videos` : ""}.${swiped.length ? ` ${pctOf(mean(swiped))}% of viewers swiped away;` : ""} of those who stayed, ${pctOf(mean(shorts.map((v) => v.openingLoss)))}% were gone after 2 seconds and the curve ended at ${pctOf(mean(shorts.map((v) => v.endWatch)))}% (over 100% means rewatches).`,
  ];
  if (!st.causes.length)
    lines.push("No drop cause has three Shorts behind it yet.");
  st.causes
    .slice(0, max)
    .forEach((c, k) =>
      lines.push(
        `${k + 1}. ${cap(phrase(c.tag))} (${c.kind === "opening" ? "opening" : "while on screen"}): ${c.points.toFixed(1)} points a Short; ${c.detail}.`,
      ),
    );
  return lines;
}
// ---------------------------------------------------------------- reading and storing

/**
 * RETENTION_LEARN's capture: each Short and long video's curve once it is EARLY_HOURS old (one Analytics request each,
 * CURVES_PER_TICK a tick, oldest first), stored as a "curve_2d" row. A video with too few views for a curve gets no row
 * and is tried again on later ticks until it is a week old, when captureCurves' week-old reading takes over.
 */
export async function captureEarlyCurves(
  db: Db,
  yt: RetentionSource,
  now: Date,
): Promise<number> {
  if (!yt.retentionCurve) return 0;
  const eps = await db.query<{
    id: string;
    youtube_video_id: string;
    live_at: string;
  }>(
    `SELECT e.id, e.youtube_video_id, ${LIVE_AT("e")} AS live_at FROM episodes e
      WHERE e.status = 'published' AND e.lane <> 'twin' AND e.youtube_video_id IS NOT NULL
        AND ${LIVE_AT("e")} < $1::timestamptz - make_interval(hours => $2)
        AND ${LIVE_AT("e")} > $1::timestamptz - interval '7 days'
        AND NOT EXISTS (SELECT 1 FROM video_metrics m WHERE m.episode_id = e.id AND m.label IN ('${EARLY_LABEL}', 'curve'))
      ORDER BY 3 LIMIT $3`,
    [now, EARLY_HOURS, CURVES_PER_TICK],
  );
  let n = 0;
  for (const e of eps) {
    const curve = await yt.retentionCurve(
      e.youtube_video_id,
      new Date(e.live_at).toISOString().slice(0, 10),
      now.toISOString().slice(0, 10),
    );
    if (curve.length < 20) continue;
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, $2, $3, 0, 0, 0, $4)
       ON CONFLICT (episode_id, label) DO NOTHING`,
      [e.id, EARLY_LABEL, now, JSON.stringify(curve)],
    );
    n++;
  }
  if (n) log("info", "48-hour retention curves captured", { videos: n });
  return n;
}

/** The stored curves of the last `days` (the week-old one where there is one, else the 48-hour one), with their records. */
export async function studyRows(
  db: Db,
  now: Date,
  o: { days?: number; limit?: number; shortsOnly?: boolean } = {},
): Promise<
  Array<EpisodeRecords & { videoId: string; label: string; curve: Curve }>
> {
  const rows = await db.query<{
    id: string;
    lane: string;
    youtube_video_id: string;
    script_json: any;
    assets_json: any;
    label: string;
    raw: unknown;
    game_audio: unknown;
  }>(
    `SELECT DISTINCT ON (e.id) e.id, e.lane, e.youtube_video_id, e.script_json, e.assets_json, m.label, m.raw,
            (SELECT v.detail FROM events v WHERE v.episode_id = e.id AND v.kind = 'game_audio' ORDER BY v.id DESC LIMIT 1) AS game_audio,
            ${LIVE_AT("e")} AS live_at
       FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label IN ('curve', '${EARLY_LABEL}') AND e.lane <> 'twin'
        AND ${LIVE_AT("e")} > $1::timestamptz - make_interval(days => $2)
        ${o.shortsOnly ? "AND e.lane <> 'longform'" : ""}
      ORDER BY e.id, (m.label = 'curve') DESC`,
    [now, o.days ?? 60],
  );
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  return rows
    .map((r) => ({
      id: r.id,
      lane: r.lane,
      videoId: r.youtube_video_id,
      script: parse(r.script_json) as Script | null,
      assets: parse(r.assets_json),
      label: r.label,
      curve: (parse(r.raw) ?? []) as Curve,
      gameAudio: parse(r.game_audio) as EpisodeRecords["gameAudio"],
      liveAt: new Date((r as any).live_at).getTime(),
    }))
    .sort((a, b) => b.liveAt - a.liveAt)
    .slice(0, o.limit ?? 200)
    .map(({ liveAt: _l, ...r }) => r);
}

/** The study over the stored curves, or undefined when RETENTION_LEARN is off. Never throws. */
export async function retentionStudy(
  db: Db,
  cfg: { retentionLearn: boolean },
  now: Date,
  segmentsOf: ((script: Script, desk: boolean) => SegmentInput[]) | undefined,
): Promise<RetentionStudy | undefined> {
  if (!cfg.retentionLearn || !segmentsOf) return undefined;
  try {
    return buildStudy(await studyRows(db, now), segmentsOf, now);
  } catch (err) {
    log("warn", "retention study failed", { error: (err as Error).message });
    return undefined;
  }
}

// ---------------------------------------------------------------- the login's scope

export const ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics.readonly";

/**
 * Whether an access token carries the Analytics scope (Google's tokeninfo). The factory's stored login was granted it
 * at connect time (src/youtube/oauth.ts SCOPES); the old .env token was not, so a missing stored login is reported.
 */
export async function analyticsScopeOk(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; scopes: string[] }> {
  const res = await fetchFn(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) return { ok: false, scopes: [] };
  const body = (await res.json()) as { scope?: string };
  const scopes = String(body.scope ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return { ok: scopes.includes(ANALYTICS_SCOPE), scopes };
}

let loginCheck: { at: number; ok: boolean; why: string } | undefined;

/** Forgets the day's login check (tests). */
export function resetLoginCheck(): void {
  loginCheck = undefined;
}

/**
 * RETENTION_LEARN's tick: once a day it checks that the factory's own stored login (never the .env token, which lacks
 * scopes) carries yt-analytics.readonly, then reads the curves that are due. A failed check logs once and skips the day.
 */
export async function retentionLearnTick(s: {
  db: Db;
  now: Date;
  yt: RetentionSource;
  /** The stored login's access token, or undefined when the factory has no stored login. */
  storedToken: () => Promise<string | undefined>;
  fetchFn?: typeof fetch;
}): Promise<number> {
  const t = s.now.getTime();
  if (!loginCheck || t - loginCheck.at > 86_400_000) {
    const token = await s.storedToken().catch(() => undefined);
    if (!token) loginCheck = { at: t, ok: false, why: "no stored YouTube login (the .env token lacks the Analytics scope)" };
    else {
      const got = await analyticsScopeOk(token, s.fetchFn).catch(() => ({ ok: false, scopes: [] as string[] }));
      loginCheck = { at: t, ok: got.ok, why: got.ok ? "" : "the stored login lacks yt-analytics.readonly: reconnect at /oauth/start" };
    }
    if (!loginCheck.ok) log("warn", "retention curves not read", { why: loginCheck.why });
  }
  if (!loginCheck.ok) return 0;
  return captureEarlyCurves(s.db, s.yt, s.now);
}
