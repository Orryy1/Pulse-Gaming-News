// The Short's opening on the game's own moving footage, with an ad-safe first seven seconds (upgrade queue item 15,
// SHORT_OPEN_FOOTAGE). Frame one is gameplay or a cutscene of the story's game, never a still, logo, store art or text
// card: the strongest moment the local vision model finds among the episode's clips, cut out as its own clip and
// tagged for the hook, so the planner (src/render/plan.ts, untouched) opens on it with the hook text over it. Then
// everything on screen in the first seven seconds is screened for what YouTube limits ads on (gore, blood, nudity,
// a weapon aimed at the viewer, shocking imagery); a failed candidate gives way to the next, a failed later shot
// in the window to a picture that passed. The model is the free local one (LOCAL_VISION_URL, think: false); with
// the relay down nothing is screened and the opening stays as the planner made it. No paid fallback.
//
// Order of preference: the owner's own capture, the moment the picture editor chose for the hook, the scene index's
// cutscenes, then any trailer clip of the game. A ranking never opens on its number one's footage, and while a
// game's spoiler window is open (SPOILER_GUARD) no cutscene or playthrough clip opens a Short about it. A clip is
// split, never copied, so the footage seconds (and the Rockstar cap) never grow.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "./lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "./lib/util.ts";
import { extractFrames, probe } from "./qa/media.ts";
import {
  LOCAL_VISION_MODEL,
  LOCAL_VISION_URL,
  THINK_ROOM,
  visionAnswer,
  visionModelProblem,
} from "./assets/localvision.ts";
import { LOCALVIDEO_PROVENANCE } from "./assets/localvideo.ts";
import type { EpisodeAssets } from "./episodes.ts";
import type { RenderPlan } from "./render/plan.ts";

const run = promisify(execFile);

/** Seconds from the start in which everything on screen must be ad-safe. */
export const AD_SAFE_SECONDS = 7;
/** The opening clip cut for the hook: long enough for the hook's held shot (5 s) and a little over. */
export const OPENING_SECONDS = 6;
/** A remainder shorter than this goes: a scrap that short is a flicker wherever it lands. */
export const MIN_REMAINDER_SECONDS = 2;
/** Candidate clips looked at, best first. */
export const MAX_CANDIDATES = 6;

type Clip = NonNullable<EpisodeAssets["clips"]>[number];
type Image = NonNullable<EpisodeAssets["images"]>[number];

export interface OpeningLook {
  gameplay: boolean; // the game's own picture filling the frame
  gore: boolean;
  nudity: boolean;
  weapon: boolean; // a weapon aimed straight at the viewer
  shocking: boolean;
  strength: number; // 0-10, how striking as a first frame
}

/** Why a frame may not be in the first seven seconds, or undefined when it may (pure). */
export function adSafeProblem(l: OpeningLook | undefined): string | undefined {
  if (!l) return "not screened";
  if (l.gore) return "gore or blood";
  if (l.nudity) return "nudity";
  if (l.weapon) return "a weapon aimed at the viewer";
  if (l.shocking) return "shocking imagery";
  return undefined;
}

/** Why a frame may not open the Short, or undefined (pure): ad-safe and the game's own picture. */
export function openerProblem(l: OpeningLook | undefined): string | undefined {
  return (
    adSafeProblem(l) ??
    (l!.gameplay
      ? undefined
      : "not the game's own picture (a card, logo or art)")
  );
}

const OWN = /^Pulse's own gameplay capture/;
const CUTSCENE = /^Cutscenes for "/;
const PLAYTHROUGH = /^Gameplay "/;
const NOT_FOOTAGE = /^Portrait of |shown on (?:the )?hardware|not footage/i;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** True when the clip's provenance names the game (its distinctive words, at least two of them or all there are). */
export function clipOfGame(
  clip: Pick<Clip, "provenance" | "label">,
  game: string,
): boolean {
  const words = norm(game)
    .split(" ")
    .filter(
      (w) =>
        w.length > 2 &&
        !["the", "and", "of", "edition", "remake", "remastered"].includes(w),
    );
  if (!words.length) return true;
  const hay = ` ${norm(`${clip.provenance} ${clip.label ?? ""}`)} `;
  const hits = words.filter((w) => hay.includes(` ${w} `)).length;
  return hits >= Math.min(2, words.length);
}

export interface CandidateOpts {
  game: string;
  /** A ranking or every-game Short: entries, with the last beat the number one. */
  entries: number;
  /** The game's spoiler window is open (SPOILER_GUARD): no cutscene or playthrough clip opens it. */
  spoilerWindow: boolean;
}

/**
 * The clips that may open the Short, best first (pure): own capture, then the hook's chosen moment, then cutscenes,
 * then trailers; within a tier, clips naming the game, then livelier ones. Never stock, an illustration, a cut-out
 * portrait or hardware, never shorter than 2.5 s, never a ranking's number one.
 */
export function openingCandidates(
  clips: readonly Clip[],
  o: CandidateOpts,
): number[] {
  const winner = o.entries > 0 ? o.entries - 1 : undefined;
  const tier = (c: Clip) =>
    OWN.test(c.provenance)
      ? 0
      : c.role === "hook"
        ? 1
        : CUTSCENE.test(c.provenance)
          ? 2
          : 3;
  return clips
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.stock && c.durationSeconds >= 2.5)
    .filter(
      ({ c }) =>
        c.provenance !== LOCALVIDEO_PROVENANCE &&
        !NOT_FOOTAGE.test(c.provenance),
    )
    .filter(({ c }) => winner === undefined || c.beatIndex !== winner)
    .filter(
      ({ c }) =>
        !(
          o.spoilerWindow &&
          (CUTSCENE.test(c.provenance) || PLAYTHROUGH.test(c.provenance))
        ),
    )
    .sort(
      (a, b) =>
        tier(a.c) - tier(b.c) ||
        // In a list, a clip nobody's entry needs before one that is.
        Number(a.c.beatIndex !== undefined) -
          Number(b.c.beatIndex !== undefined) ||
        Number(!clipOfGame(b.c, o.game)) - Number(!clipOfGame(a.c, o.game)) ||
        (b.c.motion ?? 0) - (a.c.motion ?? 0) ||
        a.i - b.i,
    )
    .map(({ i }) => i)
    .slice(0, MAX_CANDIDATES);
}

/** Where to look inside a clip for its strongest moment (pure): three points clear of the ends. */
export function sampleTimes(duration: number): number[] {
  const pad = Math.min(0.4, duration / 6);
  return [0.15, 0.45, 0.75].map(
    (f) =>
      Math.round(Math.max(pad, Math.min(duration - pad, duration * f)) * 100) /
      100,
  );
}

/** The opening window around the strongest moment (pure): it starts a beat before it and runs OPENING_SECONDS. */
export function openingWindow(
  duration: number,
  at: number,
  seconds = OPENING_SECONDS,
): { from: number; to: number } {
  const len = Math.min(seconds, duration);
  const from = Math.max(0, Math.min(duration - len, at - 0.3));
  return {
    from: Math.round(from * 100) / 100,
    to: Math.round((from + len) * 100) / 100,
  };
}

/** Frame times that screen a window (pure): its start, then every second, then its last moment. */
export function windowTimes(from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = from + 0.1; t < to - 0.15; t += 1)
    out.push(Math.round(t * 100) / 100);
  out.push(Math.round(Math.max(from, to - 0.15) * 100) / 100);
  return [...new Set(out)];
}

/** The piece of the clip left for the rest of the Short after the opening is cut out (pure): the longer side. */
export function remainder(
  duration: number,
  w: { from: number; to: number },
): { from: number; to: number } | undefined {
  const before = w.from;
  const after = duration - w.to;
  const best =
    after >= before ? { from: w.to, to: duration } : { from: 0, to: w.from };
  return best.to - best.from >= MIN_REMAINDER_SECONDS ? best : undefined;
}

/** The plan's shots on screen in the first `seconds` (pure), with the source seconds each one plays. */
export function shotsInFirst(
  plan: Pick<RenderPlan, "fps" | "shots">,
  seconds = AD_SAFE_SECONDS,
): Array<{ index: number; from: number; to: number }> {
  const limit = Math.round(seconds * plan.fps);
  return plan.shots
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s.start < limit)
    .map(({ s, index }) => {
      const trim = (s.media.trimFrom ?? 0) / plan.fps;
      return {
        index,
        from: trim,
        to: trim + (Math.min(s.end, limit) - s.start) / plan.fps,
      };
    });
}

// ---------------------------------------------------------------- the local vision model

const PROMPT = `You check one frame from the first seconds of a YouTube Short about a video game, for advertisers. Answer with JSON.
gameplay: true when the frame is the game's own moving picture (gameplay or an in-game cutscene) filling the frame; false for a logo, a title or text card, a menu, a store page, box art or a key art poster, a real-world photo or person, or a black or blank frame.
gore: blood, wounds, gore, dead bodies, dismemberment or an execution.
nudity: nudity or sexual content.
weapon: a gun or weapon aimed straight at the viewer.
shocking: disturbing or shocking imagery: torture, a horror creature's face filling the frame, drug use, self-harm.
strength: 0 to 10, how striking this is as the very first frame a viewer sees: one clear subject near the centre, bright and readable on a phone, in action or a striking view; 0 for an empty, muddy or dark frame.`;

const SCHEMA = {
  type: "object",
  properties: {
    gameplay: { type: "boolean" },
    gore: { type: "boolean" },
    nudity: { type: "boolean" },
    weapon: { type: "boolean" },
    shocking: { type: "boolean" },
    strength: { type: "number" },
  },
  required: ["gameplay", "gore", "nudity", "weapon", "shocking", "strength"],
};

/** The model's answer read into a look (pure); anything missing or unreadable is no look at all. */
export function openingLookAnswer(parsed: any): OpeningLook | undefined {
  const keys = ["gameplay", "gore", "nudity", "weapon", "shocking"] as const;
  if (!parsed || keys.some((k) => typeof parsed[k] !== "boolean"))
    return undefined;
  const strength = Number(parsed.strength);
  return {
    gameplay: parsed.gameplay,
    gore: parsed.gore,
    nudity: parsed.nudity,
    weapon: parsed.weapon,
    shocking: parsed.shocking,
    strength: Number.isFinite(strength)
      ? Math.max(0, Math.min(10, strength))
      : 0,
  };
}

/** One frame through the local model; undefined when it cannot judge. */
export async function lookOpeningFrame(
  file: string,
): Promise<OpeningLook | undefined> {
  if (process.env.NODE_TEST_CONTEXT || process.env.LOCAL_VISION === "off")
    return undefined;
  if (await visionModelProblem()) return undefined;
  try {
    const image = (await fs.readFile(file)).toString("base64");
    const res = await fetchWithTimeout(
      `${LOCAL_VISION_URL}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: LOCAL_VISION_MODEL,
          stream: false,
          think: false,
          format: SCHEMA,
          keep_alive: "15m",
          options: {
            temperature: 0,
            num_predict: 120 + THINK_ROOM,
            num_ctx: 8192,
          },
          messages: [{ role: "user", content: PROMPT, images: [image] }],
        }),
      },
      90_000,
    );
    if (!res.ok) return undefined;
    return openingLookAnswer(
      visionAnswer(
        (await res.json()) as {
          message?: { content?: string; thinking?: string };
        },
      ),
    );
  } catch (err) {
    log("warn", "opening frame check failed", {
      file,
      error: errorMessage(err),
    });
    return undefined;
  }
}

// ---------------------------------------------------------------- choosing the opening

export interface OpeningDeps {
  look?: (file: string) => Promise<OpeningLook | undefined>;
  /** Frames at these times of a clip, as jpegs in `dir`. */
  frames?: (file: string, dir: string, times: number[]) => Promise<string[]>;
  /** Cuts [from, to) of a clip into `out`; returns its real length. */
  cut?: (
    file: string,
    out: string,
    from: number,
    to: number,
    audio: boolean,
  ) => Promise<number>;
  /** A blurred plate for a new clip (src/assets/plates.ts). */
  blur?: (dir: string, file: string) => Promise<string | undefined>;
}

export interface OpeningResult {
  ok: boolean;
  why: string;
  clip?: string; // the opening clip's file
  from?: string; // the clip it was cut from
  window?: { from: number; to: number };
  strength?: number;
  tried: Array<{ file: string; problem?: string; strength?: number }>;
}

async function cutClip(
  file: string,
  out: string,
  from: number,
  to: number,
  audio: boolean,
): Promise<number> {
  await run(FFMPEG, [
    "-loglevel",
    "error",
    "-y",
    "-ss",
    from.toFixed(3),
    "-i",
    file,
    "-t",
    (to - from).toFixed(3),
    "-map",
    "0:v:0",
    ...(audio ? ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out,
  ]);
  return (await probe(out)).durationSeconds;
}

/**
 * Picks and cuts the opening clip, in place on `assets.clips`: the opening first, tagged for the hook, the clip's
 * remainder in its old place with its old tags, and any other hook tag cleared so the planner opens on this one.
 * Nothing changes when no candidate passes or the model cannot judge.
 */
export async function chooseOpening(
  episodeDir: string,
  assets: EpisodeAssets,
  o: CandidateOpts,
  deps: OpeningDeps = {},
): Promise<OpeningResult> {
  const look = deps.look ?? lookOpeningFrame;
  const frames = deps.frames ?? extractFrames;
  const cut = deps.cut ?? cutClip;
  const clips = assets.clips ?? [];
  const order = openingCandidates(clips, o);
  const tried: OpeningResult["tried"] = [];
  if (!order.length)
    return { ok: false, why: "no footage of the game to open on", tried };
  const work = path.join(episodeDir, "opening");
  await fs.mkdir(work, { recursive: true });
  for (const i of order) {
    const c = clips[i]!;
    const src = path.join(episodeDir, c.file);
    const tag = `c${i}`;
    // The strongest moment that passes.
    const times = sampleTimes(c.durationSeconds);
    const files = await frames(src, path.join(work, `${tag}_s`), times);
    const looks = await Promise.all(files.map((f) => look(f)));
    if (looks.every((l) => !l)) {
      tried.push({
        file: c.file,
        problem: "the vision model could not judge it",
      });
      // Nothing judged yet and nothing now: the relay is down, and every other clip would go the same way.
      if (tried.every((t) => t.problem === "the vision model could not judge it")) break;
      continue;
    }
    const moments = times
      .map((t, k) => ({ t, l: looks[k] }))
      .filter((m) => !openerProblem(m.l))
      .sort((a, b) => b.l!.strength - a.l!.strength);
    if (!moments.length) {
      tried.push({
        file: c.file,
        problem: openerProblem(
          looks.find((l) => openerProblem(l) !== "not screened"),
        ),
      });
      continue;
    }
    let chosen:
      | { w: { from: number; to: number }; strength: number }
      | undefined;
    let problem: string | undefined;
    for (const m of moments) {
      const w = openingWindow(c.durationSeconds, m.t);
      // Every second of the window: ad-safe and the game's own picture (a trailer's title card mid-window fails it).
      const wt = windowTimes(w.from, w.to);
      const wf = await frames(
        src,
        path.join(work, `${tag}_w${Math.round(m.t * 10)}`),
        wt,
      );
      const wl = await Promise.all(wf.map((f) => look(f)));
      problem = wl.map(openerProblem).find(Boolean);
      if (!problem) {
        chosen = { w, strength: m.l!.strength };
        break;
      }
    }
    if (!chosen) {
      tried.push({
        file: c.file,
        problem: `its opening window: ${problem}`,
        strength: moments[0]!.l!.strength,
      });
      continue;
    }
    // Split, never copy: the opening becomes its own clip, the rest keeps the clip's place and tags.
    const base = path.basename(c.file, path.extname(c.file));
    const openFile = path.posix.join(
      path.posix.dirname(c.file.replace(/\\/g, "/")),
      `${base}_opening.mp4`,
    );
    const openLen = await cut(
      src,
      path.join(episodeDir, openFile),
      chosen.w.from,
      chosen.w.to,
      Boolean(c.audio),
    );
    const opening: Clip = {
      ...c,
      file: openFile,
      durationSeconds: openLen,
      role: "hook",
      beatIndex: undefined,
      blurFile: deps.blur
        ? await deps.blur(episodeDir, openFile).catch(() => undefined)
        : undefined,
      crop: undefined,
      startSeconds:
        c.startSeconds !== undefined
          ? c.startSeconds + chosen.w.from
          : undefined,
      span: c.span
        ? {
            ...c.span,
            from: c.span.from + chosen.w.from,
            to: c.span.from + chosen.w.to,
          }
        : undefined,
      provenance: `${c.provenance}; opening ${chosen.w.from.toFixed(1)}-${chosen.w.to.toFixed(1)}s of the clip`,
      reason:
        "the Short's opening: the strongest ad-safe moment of the game's own footage",
    };
    const rest = remainder(c.durationSeconds, chosen.w);
    let restClip: Clip | undefined;
    if (rest) {
      const restFile = path.posix.join(
        path.posix.dirname(c.file.replace(/\\/g, "/")),
        `${base}_rest.mp4`,
      );
      const restLen = await cut(
        src,
        path.join(episodeDir, restFile),
        rest.from,
        rest.to,
        Boolean(c.audio),
      );
      restClip = {
        ...c,
        file: restFile,
        durationSeconds: restLen,
        // The hook's moment is now the opening; what is left is free footage.
        role: undefined,
        blurFile: deps.blur
          ? await deps.blur(episodeDir, restFile).catch(() => undefined)
          : c.blurFile,
        crop: undefined,
        startSeconds:
          c.startSeconds !== undefined ? c.startSeconds + rest.from : undefined,
        span: c.span
          ? {
              ...c.span,
              from: c.span.from + rest.from,
              to: c.span.from + rest.to,
            }
          : undefined,
        provenance: `${c.provenance}; ${rest.from.toFixed(1)}-${rest.to.toFixed(1)}s of the clip`,
      };
    }
    const others = clips
      .map((x, k) => (k === i ? restClip : x))
      .filter((x): x is Clip => !!x)
      .map((x) =>
        x.role === "hook" && x !== restClip ? { ...x, role: undefined } : x,
      );
    assets.clips = [opening, ...others];
    tried.push({ file: c.file, strength: chosen.strength });
    return {
      ok: true,
      why: `opens on ${c.file} at ${chosen.w.from.toFixed(1)}s`,
      clip: openFile,
      from: c.file,
      window: chosen.w,
      strength: chosen.strength,
      tried,
    };
  }
  // The relay is down or the model cannot read these frames: nothing was screened, so no opening is made.
  const why = tried.every((t) => t.problem === "the vision model could not judge it")
    ? "the local vision model did not answer: opening left as planned"
    : "no candidate passed the opening check";
  return { ok: false, why, tried };
}

// ---------------------------------------------------------------- the first seven seconds

export interface SecondsResult {
  checked: number;
  replaced: Array<{ shot: number; problem: string; with?: string }>;
  /** The first shot is not moving footage (the planner had no room for the opening clip). */
  openingStill: boolean;
  unchecked: boolean;
}

/**
 * Screens every shot in the first AD_SAFE_SECONDS and swaps a failing one for a picture that passes (in place on
 * `plan`); a failing first shot is left for the caller to report, since nothing else is safe footage of the game.
 */
export async function checkFirstSeconds(
  episodeDir: string,
  plan: RenderPlan,
  assets: Pick<EpisodeAssets, "clips" | "images">,
  o: { openingChecked?: string } = {},
  deps: OpeningDeps = {},
): Promise<SecondsResult> {
  const look = deps.look ?? lookOpeningFrame;
  const frames = deps.frames ?? extractFrames;
  const clips = assets.clips ?? [];
  const images = assets.images ?? [];
  const work = path.join(episodeDir, "opening");
  await fs.mkdir(work, { recursive: true });
  const out: SecondsResult = {
    checked: 0,
    replaced: [],
    openingStill: plan.shots[0]?.media.type !== "clip",
    unchecked: false,
  };
  const imageLook = new Map<number, OpeningLook | undefined>();
  const lookImage = async (k: number) => {
    if (!imageLook.has(k))
      imageLook.set(k, await look(path.join(episodeDir, images[k]!.file)));
    return imageLook.get(k);
  };
  const window = shotsInFirst(plan);
  const inWindow = new Set(window.map((w) => w.index));
  for (const w of window) {
    const shot = plan.shots[w.index]!;
    const m = shot.media;
    let problem: string | undefined;
    if (m.type === "clip") {
      const c = clips[m.index];
      if (!c) continue;
      // The opening clip's whole window was screened when it was chosen.
      if (w.index === 0 && o.openingChecked && c.file === o.openingChecked) {
        out.checked++;
        continue;
      }
      const fs_ = await frames(
        path.join(episodeDir, c.file),
        path.join(work, `p${w.index}`),
        windowTimes(w.from, Math.min(w.to, c.durationSeconds)),
      );
      const ls = await Promise.all(fs_.map((f) => look(f)));
      if (ls.every((l) => !l)) out.unchecked = true;
      problem = ls.map(adSafeProblem).find(Boolean);
    } else if (m.type === "image") {
      const l = await lookImage(m.index);
      if (!l) out.unchecked = true;
      problem = adSafeProblem(l);
    } else continue; // plates and code scenes are the channel's own graphics
    out.checked++;
    if (!problem || problem === "not screened") continue;
    if (w.index === 0) {
      out.replaced.push({ shot: 0, problem });
      continue;
    }
    // A picture that passes and is not already in the window, not the shot either side.
    const used = new Set(
      plan.shots
        .filter((_, k) => inWindow.has(k) || Math.abs(k - w.index) <= 1)
        .flatMap((s) => (s.media.type === "image" ? [s.media.index] : [])),
    );
    let swap: number | undefined;
    for (const k of images
      .map((_, k) => k)
      .filter(
        (k) => !used.has(k) && !["capsule", "logo"].includes(images[k]!.kind),
      )) {
      if (!adSafeProblem(await lookImage(k))) {
        swap = k;
        break;
      }
    }
    if (swap === undefined) {
      out.replaced.push({ shot: w.index, problem });
      continue;
    }
    const img: Image = images[swap]!;
    plan.shots[w.index] = {
      ...shot,
      media: { type: "image", index: swap },
      framed: img.aspect > 2.1 || (img.aspect >= 0.9 && img.aspect < 1.2),
    };
    out.replaced.push({ shot: w.index, problem, with: img.file });
  }
  return out;
}
