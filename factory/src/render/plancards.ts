// The shot plan as a critic reads it, and the plan's measurements (SHOT_PLAN_PANEL, src/render/planpanel.ts).
// Evidence, 1 to 17 Nov 2026: some Shorts were 94% stills with one picture shown seven times, and 93% of the newest 30
// shared one effect sequence; the owner's standing rule is that every line shows its own subject, both games in a
// comparison and no reused stills. This file turns a RenderPlan into one plain-text row per spoken line (the line, what
// is on screen, for how long, whether that media shows elsewhere, the card) and measures the plan with no model:
// moving share, distinct media, the longest run and the most uses of one media, the first shot's length, lines whose
// media does not carry the line's subject, comparison lines showing one game, and sameness with recent Shorts' plans.
// Everything here is pure and deterministic.

import { STING_FRAMES, type RenderPlan, type Shot } from "./plan.ts";
import type { Segment } from "./timeline.ts";
import { shortMediaRichness } from "../qa/mediarich.ts";

/** What a critic is told about one piece of media. */
export interface CardMedia {
  moving: boolean;
  /** The picture's kind (hero, screenshot, capsule) or "clip". */
  kind: string;
  /** Its source's title: the upload's or the label the gather gave it. */
  title?: string;
  /** The game it shows, as far as its own text says. */
  game?: string;
  /** Words it carries (its label, the words it was chosen for, its source title). */
  keywords: string[];
  /** Where it came from (steam, igdb, youtube, publisher, library). */
  source?: string;
  /** Tagged for this beat (0, 1, 2...) by the gather. */
  beatIndex?: number;
  /** Chosen for the opening line. */
  role?: string;
  /** The sentence the gather chose it for. */
  forWords?: string;
  /** A located moment for a line (cutsceneMatch.targetKey): never moved to another line. */
  targetKey?: string;
  /** The old version of a remade game (kept for the words about the old one). */
  then?: boolean;
  /** A trailer frame used as a last-resort still. */
  frame?: boolean;
  /** Clip length in seconds. */
  seconds?: number;
  /** A still's width over height (the planner frames squares and panoramas). */
  aspect?: number;
  /** Mean brightness, 0-255, when known. */
  luma?: number;
}

/** The panel's view of one Short: its lines, its media and the games it names. */
export interface PanelContext {
  segments: Segment[];
  /** Per segment: the beat's footage keywords (empty for hook, take and loop). */
  lineKeywords: string[][];
  images: CardMedia[];
  clips: CardMedia[];
  /** The Short's game. */
  game: string;
  /** Every game the script names (the Short's game first), for the comparison check. */
  games: string[];
}

/** Every threshold the measurements use, in one place. */
export const CARD = {
  /** Words shorter than this never count as a match. */
  minTokenLength: 3,
  /** A first shot longer than this many seconds is slow (the feed decides in the first two seconds). */
  firstShotSlow: 3,
  /** Recent plans compared for sameness. */
  recentPlans: 8,
  /** Shots of the layout and the moves compared for sameness. */
  layoutShots: 6,
  moveShots: 8,
  /** Words of a line kept in a card row. */
  lineWords: 40,
} as const;

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "over",
  "your",
  "you",
  "its",
  "his",
  "her",
  "their",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "but",
  "not",
  "all",
  "out",
  "off",
  "now",
  "new",
  "official",
  "trailer",
  "gameplay",
  "game",
  "games",
  "video",
  "clip",
  "image",
  "screenshot",
  "hero",
  "art",
  "key",
  "capsule",
  "header",
  "logo",
  "https",
  "http",
  "www",
  "com",
  "jpg",
  "png",
  "mp4",
  "webm",
]);

/** The words a text carries for matching (pure): lower case, no stop words, no short words. */
export function tokens(text: string | undefined): string[] {
  return [
    ...new Set(
      String(text ?? "")
        .toLowerCase()
        .replace(/['’]s\b/g, "")
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= CARD.minTokenLength && !STOP.has(w)),
    ),
  ];
}

/** Whether a game is named in a text (pure): every word of the game's name with three letters or more, in order free. */
export function namesGame(text: string, game: string): boolean {
  const want = tokens(game);
  if (!want.length) return false;
  const have = new Set(tokens(text));
  return want.every((w) => have.has(w));
}

type AssetImage = {
  kind?: string;
  aspect?: number;
  luma?: number;
  label?: string;
  provenance?: string;
  sourceUrl?: string;
  forWords?: string;
  beatIndex?: number;
  role?: string;
  then?: boolean;
  frame?: boolean;
};
type AssetClip = {
  luma?: number;
  label?: string;
  reason?: string;
  provenance?: string;
  forWords?: string;
  beatIndex?: number;
  role?: string;
  durationSeconds?: number;
  youtubeSource?: { title?: string; uploader?: string };
  cutsceneMatch?: { targetKey?: string };
  credit?: string;
  stock?: boolean;
};

/** The file name at the end of a URL, decoded when it can be. */
const lastPart = (url: string): string => {
  const tail = url.split(/[?#]/)[0]!.split("/").pop() ?? "";
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
};

const gameOf = (text: string, games: string[]): string | undefined =>
  games.find((g, k) => k > 0 && namesGame(text, g)) ??
  (games[0] && namesGame(text, games[0]) ? games[0] : undefined);

/**
 * The critic's description of the episode's media (pure), in the order of assets.images and assets.clips so plan
 * indices line up. A picture with no game in its own text is taken as the Short's game: the gather looks for that game
 * first, and a second game's media normally says whose it is.
 */
export function cardMedia(
  images: readonly AssetImage[],
  clips: readonly AssetClip[],
  games: string[],
): { images: CardMedia[]; clips: CardMedia[] } {
  const img = images.map((i): CardMedia => {
    const text = [
      i.label,
      i.forWords,
      i.sourceUrl ? lastPart(i.sourceUrl) : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      moving: false,
      kind: i.kind ?? "still",
      ...(i.label ? { title: i.label } : {}),
      game: gameOf(text, games) ?? games[0],
      keywords: tokens(`${text} ${i.kind ?? ""}`),
      ...(i.provenance ? { source: i.provenance } : {}),
      ...(i.beatIndex !== undefined ? { beatIndex: i.beatIndex } : {}),
      ...(i.role ? { role: i.role } : {}),
      ...(i.forWords ? { forWords: i.forWords } : {}),
      ...(i.then ? { then: true } : {}),
      ...(i.frame ? { frame: true } : {}),
      ...(i.aspect !== undefined ? { aspect: i.aspect } : {}),
      ...(i.luma !== undefined ? { luma: i.luma } : {}),
    };
  });
  const clp = clips.map((c): CardMedia => {
    const title = c.youtubeSource?.title ?? c.label;
    const text = [c.youtubeSource?.title, c.label, c.reason, c.forWords]
      .filter(Boolean)
      .join(" ");
    return {
      moving: true,
      kind: c.stock ? "stock clip" : "clip",
      ...(title ? { title } : {}),
      game: c.stock ? undefined : (gameOf(text, games) ?? games[0]),
      keywords: tokens(text),
      ...(c.provenance ? { source: c.provenance } : {}),
      ...(c.beatIndex !== undefined ? { beatIndex: c.beatIndex } : {}),
      ...(c.role ? { role: c.role } : {}),
      ...(c.forWords ? { forWords: c.forWords } : {}),
      ...(c.cutsceneMatch?.targetKey
        ? { targetKey: c.cutsceneMatch.targetKey }
        : {}),
      ...(c.durationSeconds !== undefined
        ? { seconds: c.durationSeconds }
        : {}),
      ...(c.luma !== undefined ? { luma: c.luma } : {}),
    };
  });
  return { images: img, clips: clp };
}

/** A media key a plan uses ("image:3", "clip:1"); the plate and code scenes are not media. */
export const mediaKey = (s: Pick<Shot, "media">): string | undefined =>
  s.media.type === "image" || s.media.type === "clip"
    ? `${s.media.type}:${s.media.index}`
    : undefined;

export const mediaOf = (
  ctx: Pick<PanelContext, "images" | "clips">,
  s: Pick<Shot, "media">,
): CardMedia | undefined =>
  s.media.type === "image"
    ? ctx.images[s.media.index]
    : s.media.type === "clip"
      ? ctx.clips[s.media.index]
      : undefined;

/** Which beat (0, 1, 2...) each segment is (pure). */
export function beatOf(
  segments: readonly Pick<Segment, "kind">[],
): Array<number | undefined> {
  let n = 0;
  return segments.map((s) => (s.kind === "beat" ? n++ : undefined));
}

/**
 * The words a line is about (pure): its footage keywords, or, when the writer named none, the games the line names
 * (the Short's game when it names none).
 */
export function subjectOf(ctx: PanelContext, segment: number): string[] {
  const kw = tokens((ctx.lineKeywords[segment] ?? []).join(" "));
  if (kw.length) return kw;
  const named = gamesNamed(ctx, segment);
  return tokens((named.length ? named : [ctx.game]).join(" "));
}

/** Whether one shot's media carries its line (pure): chosen for the line, or sharing a subject word with it. */
export function carriesLine(
  ctx: PanelContext,
  shot: Pick<Shot, "media" | "segment">,
): boolean {
  const m = mediaOf(ctx, shot);
  if (!m) return shot.media.type === "scene";
  const seg = ctx.segments[shot.segment];
  const beat = beatOf(ctx.segments)[shot.segment];
  if (beat !== undefined && m.beatIndex === beat) return true;
  if (seg?.kind === "hook" && m.role === "hook") return true;
  if (
    m.targetKey &&
    (m.targetKey === `beat:${beat}` ||
      m.targetKey.startsWith(`beat:${beat}#`) ||
      m.targetKey === seg?.kind)
  )
    return true;
  const subject = new Set(subjectOf(ctx, shot.segment));
  return m.keywords.some((w) => subject.has(w));
}

/** The games a line names (pure), at most two matter. */
export function gamesNamed(ctx: PanelContext, segment: number): string[] {
  const text = ctx.segments[segment]?.text ?? "";
  return ctx.games.filter(
    (g, k, all) => all.indexOf(g) === k && namesGame(text, g),
  );
}

const secs = (frames: number, fps: number) =>
  Math.round((frames / fps) * 10) / 10;

/** The visual card on a segment, as text ("title: THE VERDICT"), or undefined. */
function cardText(seg: Segment | undefined): string | undefined {
  const v = seg?.visual;
  if (!v || v.kind === "none") return undefined;
  const words = [v.primary, v.secondary, ...(v.items ?? [])]
    .filter((x) => x && String(x).trim())
    .join(" / ");
  return `${v.kind}${words ? `: ${words}` : ""}`;
}

/**
 * The plan as plain text (pure): one row per spoken line with what is on screen under it, in order. Deterministic:
 * the same plan and context always give the same text. The critic sees this and nothing else.
 */
export function planCard(
  plan: Pick<RenderPlan, "shots" | "fps" | "totalFrames">,
  ctx: PanelContext,
): string {
  const uses = new Map<string, number>();
  for (const s of plan.shots) {
    const k = mediaKey(s);
    if (k) uses.set(k, (uses.get(k) ?? 0) + 1);
  }
  const label = new Map<string, string>();
  let nImg = 0;
  let nClip = 0;
  for (const s of plan.shots) {
    const k = mediaKey(s);
    if (k && !label.has(k))
      label.set(k, s.media.type === "clip" ? `F${++nClip}` : `P${++nImg}`);
  }
  const rows: string[] = [
    `SHORT about ${ctx.game}: ${secs(plan.totalFrames, plan.fps)} s, ${plan.shots.length} shots. F = moving footage, P = still picture.`,
  ];
  ctx.segments.forEach((seg, i) => {
    const shots = plan.shots.filter((s) => s.segment === i);
    if (!shots.length) return;
    const words = seg.text.split(/\s+/).filter(Boolean);
    const said =
      words.slice(0, CARD.lineWords).join(" ") +
      (words.length > CARD.lineWords ? " ..." : "");
    const kw = (ctx.lineKeywords[i] ?? []).filter(Boolean);
    rows.push("");
    rows.push(`LINE ${i + 1} (${seg.kind}): "${said}"`);
    if (kw.length) rows.push(`  subject: ${kw.join(", ")}`);
    const card = cardText(seg);
    if (card) rows.push(`  card on screen: ${card}`);
    for (const s of shots) {
      const k = mediaKey(s);
      const m = mediaOf(ctx, s);
      const len = `${secs(s.end - s.start, plan.fps)} s`;
      if (!k || !m) {
        rows.push(
          `  - ${len}: ${s.media.type === "scene" ? "drawn graphic made for this line" : "empty brand background, captions only"}`,
        );
        continue;
      }
      const bits = [
        m.moving ? "moving footage" : `still (${m.kind})`,
        m.title ? `"${m.title}"` : "",
        m.game ? `game: ${m.game}` : "",
        m.keywords.length ? `about: ${m.keywords.slice(0, 8).join(", ")}` : "",
        m.source ? `from ${m.source}` : "",
      ].filter(Boolean);
      const n = uses.get(k) ?? 1;
      rows.push(
        `  - ${len}: ${label.get(k)} ${bits.join("; ")}${n > 1 ? ` [shown ${n} times in this Short]` : ""}`,
      );
    }
  });
  return rows.join("\n");
}

/** The plan's signature for sameness (pure): layout, opening media, camera moves and sound order. */
export interface PlanSignature {
  layout: string;
  opening: string;
  moves: string;
  sound: string;
}

export function planSignature(
  plan: Pick<RenderPlan, "shots"> & { sfx?: RenderPlan["sfx"] },
): PlanSignature {
  const shots = plan.shots ?? [];
  return {
    layout: shots
      .slice(0, CARD.layoutShots)
      .map((s) => `${s.media?.type ?? "?"}${s.framed ? "/framed" : ""}`)
      .join(">"),
    opening: shots[0]?.media?.type ?? "",
    moves: shots
      .slice(0, CARD.moveShots)
      .map((s) => s.move ?? "")
      .join(">"),
    sound: [...(plan.sfx ?? [])]
      .sort((a, b) => a.frame - b.frame)
      .map((c) => String(c.file).replace(/^.*[\\/]/, ""))
      .join(">"),
  };
}

/** How alike a plan is to recent plans (pure): the mean share of the four signature parts it shares with each, 0-1. */
export function sameness(
  sig: PlanSignature,
  recent: readonly PlanSignature[],
): number {
  const xs = recent.slice(0, CARD.recentPlans);
  if (!xs.length) return 0;
  const parts: Array<keyof PlanSignature> = [
    "layout",
    "opening",
    "moves",
    "sound",
  ];
  const one = (r: PlanSignature) =>
    parts.filter((p) => sig[p] === r[p]).length / parts.length;
  return (
    Math.round((xs.reduce((a, r) => a + one(r), 0) / xs.length) * 100) / 100
  );
}

/** The plan's measurements, no model. */
export interface PlanMeasures {
  /** Share of the Short's frames on moving footage. */
  moving: number;
  /** Distinct media over shots (the plate and drawn scenes are not media). */
  distinct: number;
  /** The longest unbroken run of one media, in seconds. */
  longestRun: number;
  /** Shots of the most used media. */
  maxUses: number;
  /** The first shot's length in seconds; behind the brand sting (its own 12-frame shot), the first full shot's. */
  firstShot: number;
  /** Spoken lines with shots. */
  lines: number;
  /** Lines (segment numbers, 1 is the first) with no shot whose media carries the line's subject. */
  offSubject: number[];
  /** Lines naming two games. */
  comparisons: number;
  /** Comparison lines that show only one of the two games named (or neither). */
  oneGame: number[];
  /** Sameness with the recent plans, 0-1. */
  sameness: number;
  /** shortMediaRichness's own share: narration time on footage or a picture chosen for its line. */
  own: number;
}

export function measurePlan(
  plan: Pick<RenderPlan, "shots" | "fps" | "totalFrames"> & {
    sfx?: RenderPlan["sfx"];
  },
  ctx: PanelContext,
  recent: readonly PlanSignature[] = [],
): PlanMeasures {
  const shots = plan.shots;
  const total = Math.max(1, plan.totalFrames);
  const moving =
    shots
      .filter((s) => s.media.type === "clip")
      .reduce((n, s) => n + (s.end - s.start), 0) / total;
  const keys = shots.map(mediaKey);
  const media = keys.filter((k): k is string => !!k);
  const distinct = shots.length ? new Set(media).size / shots.length : 1;
  const uses = new Map<string, number>();
  for (const k of media) uses.set(k, (uses.get(k) ?? 0) + 1);
  let longest = 0;
  let run = 0;
  shots.forEach((s, n) => {
    const k = keys[n];
    run =
      k && n > 0 && keys[n - 1] === k
        ? run + (s.end - s.start)
        : k
          ? s.end - s.start
          : 0;
    longest = Math.max(longest, run);
  });
  const offSubject: number[] = [];
  const oneGame: number[] = [];
  let lines = 0;
  let comparisons = 0;
  ctx.segments.forEach((_, i) => {
    const mine = shots.filter((s) => s.segment === i);
    if (!mine.length) return;
    lines++;
    if (!mine.some((s) => carriesLine(ctx, s))) offSubject.push(i + 1);
    const named = gamesNamed(ctx, i).slice(0, 2);
    if (named.length === 2) {
      comparisons++;
      const shown = new Set(
        mine.map((s) => mediaOf(ctx, s)?.game).filter(Boolean),
      );
      if (!named.every((g) => shown.has(g))) oneGame.push(i + 1);
    }
  });
  const rich = shortMediaRichness(
    ctx.segments,
    { shots: shots as Shot[], fps: plan.fps },
    ctx.images.map((m) => ({ beatIndex: m.beatIndex })),
    ctx.clips.map((m) => ({ beatIndex: m.beatIndex, role: m.role })),
  );
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    moving: r2(moving),
    distinct: r2(distinct),
    longestRun: secs(longest, plan.fps),
    maxUses: Math.max(0, ...uses.values()),
    firstShot: ((f) => (f ? secs(f.end - f.start, plan.fps) : 0))(
      shots[0] && shots[0].end - shots[0].start === STING_FRAMES && shots[1] ? shots[1] : shots[0],
    ),
    lines,
    offSubject,
    comparisons,
    oneGame,
    sameness: sameness(planSignature(plan), recent),
    own: rich.own,
  };
}

/** The measurements as one short line for the log and the proof tool (pure). */
export function measuresLine(m: PlanMeasures): string {
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  return [
    `moving ${pc(m.moving)}`,
    `distinct ${pc(m.distinct)}`,
    `longest run ${m.longestRun} s`,
    `most used x${m.maxUses}`,
    `first shot ${m.firstShot} s`,
    `off subject ${m.offSubject.length}/${m.lines}`,
    `one game ${m.oneGame.length}/${m.comparisons}`,
    `sameness ${pc(m.sameness)}`,
    `own ${pc(m.own)}`,
  ].join(", ");
}
