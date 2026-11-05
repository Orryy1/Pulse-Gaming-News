// Code scenes (owner, 5 Nov 2026: the explainer channel draws its pictures in code, should Pulse?). Yes, in two
// places only, and gameplay stays first:
//
// 1. A story with too little footage or art: a relevant scene stands in for the bare plate (the Elder Scrolls
//    Short of 4 Nov 2026 was 65% empty panel).
// 2. Things footage cannot show: a delay on a real calendar, a wait to scale, a measured input lag, a share of a
//    crowd, review scores stacking up.
//
// Everything here is pure: the scene and its numbers are decided in Node and stored on the plan, so a retried
// render is identical. A scene exists only when a line carries the data, and every figure it shows must be in
// the narration or the sourced claims (or be plain arithmetic on those figures, such as the days between two
// dates). It takes a plate or a repeated still, never a clip and never a line's own picture. Behind CODE_SCENES,
// default off. The drawings are in components/codescene.

import type { Segment } from "./timeline.ts";
import type { Word } from "../voice/elevenlabs.ts";
import type { RenderPlan, SfxCue } from "./plan.ts";
import { keyTime } from "./longplan.ts";
import { LEVEL, SFX, leadFrames, sfxFile } from "./soundscape.ts";

export type SceneBiome = "desert" | "snow" | "sea";

export type CodeScene =
  | {
      type: "slide";
      /** The game or thing that moved. */
      title: string;
      /** ISO YYYY-MM-DD. */
      from: string;
      to: string;
      /** Other dated games, only when the script sources them. */
      rivals?: Array<{ name: string; date: string }>;
      note?: string;
    }
  | {
      type: "wait";
      title: string;
      /** Months at least, from the words ("more than two years" is 24). */
      months: number;
      /** ISO YYYY-MM the wait runs from. */
      start: string;
      /** Who said so, plainly. */
      note: string;
    }
  | {
      type: "span";
      title: string;
      /** Oldest first; a date is YYYY, YYYY-MM or YYYY-MM-DD. */
      pins: Array<{ date: string; label: string }>;
    }
  | { type: "years"; title: string; years: number; label: string }
  | {
      type: "ladder";
      title: string;
      /** Highest first; `star` is the story's own row. */
      rows: Array<{ label: string; score: number; star?: boolean }>;
      note?: string;
    }
  | {
      type: "lag";
      title: string;
      lanes: Array<{ label: string; ms: number; star?: boolean }>;
      /** The narration names a 60fps target: the ruler ticks one 60fps frame. */
      frameTicks?: boolean;
      note?: string;
    }
  | {
      type: "crowd";
      title: string;
      percent: number;
      /** The share is gone rather than present ("-22%"). */
      lost?: boolean;
      label: string;
    }
  | {
      type: "terrain";
      biome: SceneBiome;
      /** The place's name over it; none when the scene is only a backdrop for the line's own card. */
      title?: string;
      label?: string;
      /** Which view of the place: a later line sees it from elsewhere. */
      view?: number;
    };

export type CodeSceneType = CodeScene["type"];

export interface PlannedScene {
  segment: number;
  /** First and last-exclusive frame on screen. */
  from: number;
  to: number;
  /** Frames after `from` at which the scene's figure lands, on the word that says it. */
  landAt: number;
  scene: CodeScene;
}

/** Scenes showing what footage cannot: a measured delay, a calendar, scores against each other, a history to scale. */
const MEASURED = new Set<CodeSceneType>(["lag", "slide", "ladder", "span"]);
/** A scene with figures needs this many frames to be read; a backdrop has nothing to read. */
export const SCENE_MIN_FRAMES = 90;
export const BACKDROP_MIN_FRAMES = 60;
/** A figure scene holds about this long at most: after 7 s a Short needs another picture. */
export const SCENE_MAX_FRAMES = 210;
/** At most this many figure scenes in a Short. */
export const MAX_FIGURE_SCENES = 3;

const WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** Whether a figure is in the sourced words, whole numbers only ("9" is not found in "1998"). */
export function figureIn(figure: string, hay: string): boolean {
  const norm = figure.replace(/,/g, "").replace(/\.$/, "");
  const esc = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9.])${esc}($|[^0-9])`).test(
    hay.replace(/(\d),(\d)/g, "$1$2"),
  );
}

const fullDate = (s?: string) =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
const parts = (iso: string) => iso.split("-").map(Number);
const dayMs = (iso: string) => {
  const [y, m, d] = parts(iso);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
};
export const daysBetween = (a: string, b: string) =>
  Math.round((dayMs(b) - dayMs(a)) / 86400000);
const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = parts(a);
  const [yb, mb] = parts(b);
  return (yb! - ya!) * 12 + (mb! - ma!);
};

/** A two-part row: "label:value". The subject is marked with a leading star. */
function rowsOf(
  items: string[],
): Array<{ label: string; value: string; star: boolean }> {
  return items
    .map((x) => {
      const at = x.lastIndexOf(":");
      if (at <= 0) return undefined;
      const raw = x.slice(0, at).trim();
      return {
        label: raw.replace(/^\*/, "").trim(),
        value: x.slice(at + 1).trim(),
        star: raw.startsWith("*"),
      };
    })
    .filter(
      (x): x is { label: string; value: string; star: boolean } =>
        !!x?.label && !!x.value,
    );
}

const MS = /^(\d+(?:\.\d+)?)\s*(?:ms|milliseconds?)$/i;
const SCORE = /^(\d{1,3})(?:\s*\/\s*100)?$/;

/** The biome a line's own words name; nothing else draws a landscape. */
export function biomeOf(text: string): SceneBiome | undefined {
  if (/\b(desert|dunes?|sands?|wasteland)\b/i.test(text)) return "desert";
  if (/\b(snow|snowy|frozen|arctic|tundra|blizzard)\b/i.test(text))
    return "snow";
  if (/\b(ocean|underwater|deep sea|seabed|open sea)\b/i.test(text))
    return "sea";
  return undefined;
}

export interface SceneContext {
  /** The narration and the sourced claims of the whole script: where a figure must be found. */
  sourced: string;
  /** The game the Short is about. */
  game: string;
  /** ISO date the Short is made. */
  today: string;
}

/**
 * The scene a line's data can carry, or nothing. Asks only for what the line already has: a delay's two dates,
 * a dated history, "label:value" rows in one unit, a percentage or a span of years in the card, or a stated wait.
 */
export function sceneForSegment(
  seg: Segment,
  ctx: SceneContext,
): CodeScene | undefined {
  const v = seg.visual;
  const sourced = `${seg.text} ${ctx.sourced}`;
  if (seg.kind === "beat" && v) {
    const items = v.items ?? [];
    if (v.kind === "timeline") {
      const from = fullDate(v.date_from);
      const to = fullDate(v.date_to);
      // Both days known, a real slip of under six months' worth of calendar, and the new date said or sourced.
      if (
        from &&
        to &&
        dayMs(to) > dayMs(from) &&
        monthsBetween(from, to) <= 5 &&
        figureIn(String(parts(to)[2]), sourced)
      )
        return { type: "slide", title: ctx.game || v.primary, from, to };
    }
    if (v.kind === "milestones") {
      const pins = items
        .map((x) => {
          const m = x.match(/^(\d{4}(?:-\d{2}(?:-\d{2})?)?)\s*:\s*(.+)$/);
          return m ? { date: m[1]!, label: m[2]!.trim() } : undefined;
        })
        .filter((x): x is { date: string; label: string } => !!x);
      const days = pins.map((p) => dayMs(p.date));
      if (
        pins.length >= 3 &&
        pins.length === items.length &&
        pins.length <= 5 &&
        days.every((d, i) => i === 0 || d > days[i - 1]!) &&
        pins.every((p) => figureIn(p.date.slice(0, 4), sourced)) &&
        // Over two years end to end, or the ruler says nothing a list would not.
        (days.at(-1)! - days[0]!) / 86400000 >= 730
      )
        return { type: "span", title: v.primary, pins };
    }
    const rows = rowsOf(items);
    if (rows.length >= 2 && rows.length === items.length) {
      const ms = rows.map((r) => r.value.match(MS));
      if (rows.length <= 3 && ms.every(Boolean)) {
        const lanes = rows.map((r, i) => ({
          label: r.label,
          ms: Number(ms[i]![1]),
          star: r.star,
        }));
        if (lanes.every((l) => l.ms > 0 && figureIn(String(l.ms), sourced)))
          return {
            type: "lag",
            title: v.primary,
            lanes,
            frameTicks: /\b60\s?fps\b/i.test(sourced) || undefined,
            note: v.secondary || undefined,
          };
      }
      const scores = rows.map((r) => r.value.match(SCORE));
      if (rows.length >= 3 && rows.length <= 6 && scores.every(Boolean)) {
        const out = rows.map((r, i) => ({
          label: r.label,
          score: Number(scores[i]![1]),
          star: r.star || undefined,
        }));
        if (
          out.every((r) => r.score <= 100 && figureIn(String(r.score), sourced))
        )
          return {
            type: "ladder",
            title: v.primary,
            rows: [...out].sort((a, b) => b.score - a.score),
            note: v.secondary || undefined,
          };
      }
    }
    if (v.kind === "stat") {
      const pct = v.primary.match(
        /^(-|−|–)?\s*(\d+(?:\.\d+)?)\s*(?:%|percent)$/i,
      );
      if (
        pct &&
        figureIn(pct[2]!, sourced) &&
        Number(pct[2]) > 0 &&
        Number(pct[2]) < 100 &&
        v.secondary.trim()
      )
        return {
          type: "crowd",
          title: v.primary,
          percent: Number(pct[2]),
          lost: !!pct[1] || undefined,
          label: v.secondary,
        };
      const yrs = v.primary.match(/^(\d{1,2})\s*years?$/i);
      if (
        yrs &&
        Number(yrs[1]) >= 5 &&
        Number(yrs[1]) <= 60 &&
        figureIn(yrs[1]!, sourced)
      )
        return {
          type: "years",
          title: v.primary,
          years: Number(yrs[1]),
          label: v.secondary,
        };
    }
  }
  // A line states a wait: "more than two years away". The words themselves are the data, with who said it.
  if (seg.kind === "take" || seg.kind === "beat") {
    const wait = seg.text.match(
      /\bmore than (two|three|four|five|\d+) years away\b/i,
    );
    if (wait) {
      const years = WORDS[wait[1]!.toLowerCase()] ?? Number(wait[1]);
      const who = seg.text.match(
        /([A-Z][a-z]+ [A-Z][a-z]+)\s+(?:believes|says|expects|reckons|thinks)\b/,
      );
      if (years > 0 && years <= 5 && who)
        return {
          type: "wait",
          title: "No release date",
          months: years * 12,
          start: ctx.today.slice(0, 7),
          note: `${who[1]}'s estimate, not an announced date`,
        };
    }
  }
  return undefined;
}

/** A line's word time as frames after a scene starts, for landing its figure as it is said. */
function landOn(
  scene: CodeScene,
  seg: Segment,
  words: Word[],
  from: number,
  len: number,
  fps: number,
): number {
  const lo = Math.max(
    0,
    words.findIndex((w) => w.start >= seg.start - 0.05),
  );
  let hi = words.findIndex((w) => w.start >= seg.end);
  if (hi < 0) hi = words.length;
  const keys: string[] =
    scene.type === "slide"
      ? [
          new Date(dayMs(scene.to)).toLocaleString("en-US", {
            month: "long",
            timeZone: "UTC",
          }),
        ]
      : scene.type === "wait"
        ? ["years"]
        : scene.type === "crowd"
          ? [`${scene.percent}%`, String(scene.percent)]
          : scene.type === "years"
            ? [String(scene.years)]
            : scene.type === "lag"
              ? scene.lanes.map((l) => String(l.ms))
              : [];
  for (const k of keys) {
    const t = keyTime(words, lo, hi, k);
    if (t !== undefined) {
      const at = Math.round(t * fps) - from;
      if (at >= 30 && at <= len - 45) return at;
    }
  }
  return Math.round(Math.min(len - 45, Math.max(45, len * 0.55)));
}

/**
 * Lays scenes over a plan's shots: a line's shots on the plate, or on a still already seen before, become its
 * scene. A clip is never taken, and nor is the opening (the thumbnail), the closing shot (it meets frame 0 when
 * the Short loops) or a ranking entry (its own art or nothing). A run too short to read is left alone. A biome the
 * script names then covers what plate is left, as a backdrop under the line's own card.
 */
export function applyCodeScenes(
  plan: RenderPlan,
  segments: Segment[],
  words: Word[],
  ctx: SceneContext,
  /** Word moments, in seconds: nothing is laid under one. */
  stampsAt: number[] = [],
  /** The plan's stills: one tagged for its line is that line's own picture, and stays. */
  images: Array<{ beatIndex?: number }> = [],
): RenderPlan {
  const fps = plan.fps;
  const last = plan.shots.length - 1;
  // A still's second showing is a repeat worth replacing.
  const seen = new Map<number, number>();
  const repeats = new Set<number>();
  plan.shots.forEach((s, i) => {
    if (s.media.type !== "image") return;
    const n = (seen.get(s.media.index) ?? 0) + 1;
    seen.set(s.media.index, n);
    if (n > 1) repeats.add(i);
  });
  const free = (i: number, scene: CodeScene) => {
    const s = plan.shots[i]!;
    if (i === 0 || i === last || segments[s.segment]?.visual?.kind === "rank") return false;
    if (s.media.type === "plate" || repeats.has(i)) return true;
    // What footage cannot show may also take a general still: not a clip, and not a picture chosen for this line.
    return MEASURED.has(scene.type) && s.media.type === "image" && images[s.media.index]?.beatIndex === undefined;
  };
  const stampIn = (a: number, b: number) =>
    stampsAt.some(
      (t) => Math.round(t * fps) + 51 > a && Math.round(t * fps) < b,
    );
  const out: PlannedScene[] = [];
  const used = new Set<number>();
  segments.forEach((seg, si) => {
    if (out.length >= MAX_FIGURE_SCENES) return;
    const scene = sceneForSegment(seg, ctx);
    if (!scene) return;
    // The longest run of free shots in the line.
    let best: [number, number] | undefined;
    let i = 0;
    while (i <= last) {
      if (plan.shots[i]!.segment !== si || !free(i, scene)) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 <= last && plan.shots[j + 1]!.segment === si && free(j + 1, scene))
        j++;
      if (
        !best ||
        plan.shots[j]!.end - plan.shots[i]!.start >
          plan.shots[best[1]]!.end - plan.shots[best[0]]!.start
      )
        best = [i, j];
      i = j + 1;
    }
    if (!best) return;
    const from = plan.shots[best[0]]!.start;
    // Ends on a shot's cut, so what follows it is the plan's own next picture.
    let endShot = best[0];
    while (
      endShot < best[1] &&
      plan.shots[endShot]!.end - from < SCENE_MAX_FRAMES - 60
    )
      endShot++;
    const to = plan.shots[endShot]!.end;
    if (to - from < SCENE_MIN_FRAMES || stampIn(from, to)) return;
    for (let k = best[0]; k <= endShot; k++) used.add(k);
    out.push({
      segment: si,
      from,
      to,
      landAt: landOn(scene, seg, words, from, to - from, fps),
      scene,
    });
  });
  // The place the script names, on what plate remains.
  const namer = segments.findIndex((s) => s.kind === "beat" && s.visual?.kind === "title" && biomeOf(s.text));
  const biome = namer >= 0 ? biomeOf(segments[namer]!.text) : undefined;
  if (biome) {
    plan.shots.forEach((s, n) => {
      if (used.has(n) || s.media.type !== "plate" || n === 0 || n === last)
        return;
      const prev = [...out].reverse().find((o) => o.scene.type === "terrain");
      if (prev && prev.to === s.start && prev.segment === s.segment) {
        prev.to = s.end;
        used.add(n);
        return;
      }
      if (s.end - s.start < BACKDROP_MIN_FRAMES || stampIn(s.start, s.end))
        return;
      // The line that names the place carries the name; a later line keeps its own card over the bare land.
      const own = s.segment === namer ? segments[namer]!.visual : undefined;
      out.push({
        segment: s.segment,
        from: s.start,
        to: s.end,
        landAt: 0,
        scene: own
          ? { type: "terrain", biome, title: own.primary, label: own.secondary }
          : { type: "terrain", biome, view: out.filter((o) => o.scene.type === "terrain").length },
      });
      used.add(n);
    });
  }
  if (!out.length) return plan;
  out.sort((a, b) => a.from - b.from);
  const shots = plan.shots.map((s, n) => {
    if (!used.has(n)) return s;
    const at = out.findIndex((o) => s.start >= o.from && s.start < o.to);
    return {
      ...s,
      media: { type: "scene" as const, index: at },
      framed: false,
      luma: 40,
    };
  });
  // One glint as the first figure lands, if the Short's sound has room for it.
  const first = out.find((o) => o.scene.type !== "terrain");
  let sfx: SfxCue[] = plan.sfx;
  if (first) {
    const name = SFX.glint[0];
    const at = Math.max(0, first.from + first.landAt - leadFrames(name, fps));
    if (
      plan.sfx.length < 6 &&
      plan.sfx.every((c) => Math.abs(c.frame - at) >= 75)
    )
      sfx = [
        ...plan.sfx,
        { file: sfxFile(name), frame: at, volume: LEVEL.glint },
      ].sort((a, b) => a.frame - b.frame);
  }
  return { ...plan, shots, scenes: out, sfx };
}

/** The share of a plan under code scenes. */
export function sceneShare(
  plan: Pick<RenderPlan, "scenes" | "totalFrames">,
): number {
  const n = (plan.scenes ?? []).reduce((a, s) => a + (s.to - s.from), 0);
  return plan.totalFrames ? n / plan.totalFrames : 0;
}
