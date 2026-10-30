// The release gate for documentaries: the shot-by-shot review a lead used to do by hand before one went
// public, done by the factory. After the final render, one frame from the middle of every shot in the long
// plan is paired with the exact words spoken over it and the "mid" tier vision model scores each 0-3 (0 wrong
// or broken, 1 loosely related, 2 the right game and era, 3 shows exactly what is said) with a line of reason.
// The scores go in qa_json.release and an event; a documentary under RELEASE_GATE_MIN_MEAN (time-weighted
// mean) or over RELEASE_GATE_MAX_ZERO (share of screen time at 0) is held for the owner with the worst ten
// shots in Discord, so the lead can fix and re-render (or approve it as it is); one above the gate carries
// on to its usual publish path. Frames are 384 px wide JPEGs, so a 34-minute documentary costs cents.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { Llm, LlmContent } from "../editorial/llm.ts";
import { logEvent, transition, type Episode } from "../episodes.ts";
import type { LongPlan, MomentWindow } from "../render/longplan.ts";
import { momentWindows, momentKeys } from "../render/longplan.ts";
import type { Segment } from "../render/timeline.ts";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { COLOURS, type DiscordMessage } from "../approval/discord.ts";

const run = promisify(execFile);

/** Shots the checker sees in one call. */
export const GATE_BATCH = 8;
/** Frame width sent to the model: the same thumbnail size the picture editor judges stills at. */
export const GATE_FRAME_WIDTH = 384;
/** Shots the owner sees listed when a documentary is held. */
export const WORST_SHOTS = 10;
/** The mid tier's list price, $ per million tokens (input, output), for the estimate logged with each run. */
const MID_PRICE = { input: 2, output: 10 };

export interface Word {
  text: string;
  start: number;
  end: number;
}

/** One shot of the plan with the words spoken over it and the chapter it sits in. */
export interface GateShot {
  index: number; // position in plan.shots
  start: number; // seconds
  end: number;
  seconds: number;
  frame: number; // the frame to look at: the shot's middle
  words: string;
  chapter: string; // "Grand Theft Auto III (2001)" or ""
}

export interface ScoredShot extends GateShot {
  score?: number; // 0-3; absent when the model did not score it
  reason: string;
}

export interface GateStats {
  shots: number; // scored shots
  seconds: number; // their screen time
  mean: number; // time-weighted mean score, 0-3
  zeroShare: number; // share of screen time at 0
  threeShare: number; // share of screen time at 3
}

export interface GateLimits {
  minMean: number;
  maxZero: number;
}

/** "12:34" */
export const mmss = (s: number): string => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/**
 * Every shot with narration over it: its middle frame, the exact words spoken while it is on screen and the
 * chapter the longest-spoken sentence belongs to. Shots with nothing spoken (a breather, the tail) are left
 * out: there is nothing to score them against.
 */
export function gateShots(
  plan: Pick<LongPlan, "fps" | "shots">,
  words: Word[],
  windows: MomentWindow[],
  chapters: Array<{ game: string; year?: number }>,
): GateShot[] {
  const out: GateShot[] = [];
  const fps = plan.fps || 30;
  for (const [index, s] of plan.shots.entries()) {
    const start = s.start / fps;
    const end = s.end / fps;
    const said = words.filter((w) => w.end > start && w.start < end);
    if (!said.length) continue;
    let best: { entry: number; overlap: number } | undefined;
    for (const w of windows) {
      const overlap = Math.min(end, w.end) - Math.max(start, w.start);
      if (overlap > 0.05 && overlap > (best?.overlap ?? 0))
        best = { entry: w.entry, overlap };
    }
    const c = best ? chapters[best.entry] : undefined;
    out.push({
      index,
      start,
      end,
      seconds: end - start,
      frame: Math.floor((s.start + s.end) / 2),
      words: said
        .map((w) => w.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      chapter: c ? `${c.game}${c.year ? ` (${c.year})` : ""}` : "",
    });
  }
  return out;
}

/** Mean and shares weighted by screen time, over the shots that were scored. */
export function gateStats(
  shots: Array<{ seconds: number; score?: number }>,
): GateStats {
  const scored = shots.filter(
    (s) => typeof s.score === "number" && Number.isFinite(s.score),
  );
  const seconds = scored.reduce((n, s) => n + s.seconds, 0);
  if (!scored.length || seconds <= 0)
    return { shots: 0, seconds: 0, mean: 0, zeroShare: 0, threeShare: 0 };
  const at = (v: number) =>
    scored.filter((s) => s.score === v).reduce((n, s) => n + s.seconds, 0) /
    seconds;
  return {
    shots: scored.length,
    seconds,
    mean: scored.reduce((n, s) => n + s.seconds * s.score!, 0) / seconds,
    zeroShare: at(0),
    threeShare: at(3),
  };
}

/** Whether a documentary may go out on its own, and why not when it may not. Nothing scored: held. */
export function gateDecision(
  stats: GateStats,
  limits: GateLimits,
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!stats.shots) reasons.push("no shot could be scored");
  if (stats.shots && stats.mean < limits.minMean)
    reasons.push(
      `mean shot score ${stats.mean.toFixed(2)} of 3 (needs ${limits.minMean.toFixed(1)})`,
    );
  if (stats.shots && stats.zeroShare > limits.maxZero)
    reasons.push(
      `${Math.round(stats.zeroShare * 100)}% of screen time shows the wrong thing (allowed ${Math.round(limits.maxZero * 100)}%)`,
    );
  return { pass: reasons.length === 0, reasons };
}

/** The worst `n` shots: lowest score first, the longest on screen first among equals. Unscored ones never. */
export function worstShots(shots: ScoredShot[], n = WORST_SHOTS): ScoredShot[] {
  return shots
    .filter((s) => typeof s.score === "number")
    .sort(
      (a, b) =>
        a.score! - b.score! || b.seconds - a.seconds || a.start - b.start,
    )
    .slice(0, Math.max(0, n));
}

/**
 * What a run costs, roughly: Claude bills an image at about width × height / 750 tokens, the words and
 * instructions a few hundred more per batch, and each shot's score and reason about 30 tokens back.
 */
export function estimateGateCost(
  shots: number,
  width = GATE_FRAME_WIDTH,
  height = Math.round((width * 9) / 16),
): { calls: number; inputTokens: number; outputTokens: number; usd: number } {
  const calls = Math.ceil(shots / GATE_BATCH);
  const imageTokens = Math.ceil((width * height) / 750);
  const inputTokens = shots * (imageTokens + 70) + calls * 400;
  const outputTokens = shots * 30 + calls * 10;
  const usd =
    (inputTokens * MID_PRICE.input + outputTokens * MID_PRICE.output) / 1e6;
  return {
    calls,
    inputTokens,
    outputTokens,
    usd: Math.round(usd * 1000) / 1000,
  };
}

export const RELEASE_GATE_PROMPT = `You review a gaming documentary shot by shot before it is published. Each frame is one shot of the video, with the exact words the narrator says while it is on screen and the chapter (game and year) it belongs to.
Score every frame 0-3 for how well the picture fits those words:
3: shows exactly what is said (the named game, person, place, screen, document or event).
2: the right game and era, in keeping with the words, without showing the specific thing named.
1: loosely related: the right franchise or subject but a different game or era, or generic footage that only vaguely fits.
0: wrong or broken: a different game or subject, a picture that contradicts the words, a blank or black frame, a broken image, unreadable or cut-off text, or anything advertiser-unfriendly.
A chart, quote card, map, timeline or other graphic that restates the words scores 3 when readable. A plain branded background with nothing on it scores 1. Give one short line of reason for each frame, naming what the frame actually shows. Use the frame numbers given.`;

export const GateBatchSchema = z.object({
  frames: z.array(
    z.object({
      frame: z.number().describe("The frame number as given"),
      score: z.number().describe("0, 1, 2 or 3"),
      reason: z
        .string()
        .describe("One short line: what the frame shows and why the score"),
    }),
  ),
});

/** The text the model reads for one shot. */
export function shotLine(n: number, s: GateShot): string {
  return `Frame ${n}: ${mmss(s.start)} to ${mmss(s.end)}${s.chapter ? `, chapter "${s.chapter}"` : ""}. Narration: "${s.words}"`;
}

/**
 * Scores the shots in batches of GATE_BATCH on the mid tier. `frame` turns a shot into a JPEG file. A batch
 * whose call fails is left unscored and the run goes on; the caller decides what too many unscored shots mean.
 */
export async function scoreShots(
  shots: GateShot[],
  deps: {
    llm: Llm;
    frame: (shot: GateShot) => Promise<string>;
    headline: string;
    game: string;
  },
): Promise<ScoredShot[]> {
  const out: ScoredShot[] = [];
  for (let k = 0; k < shots.length; k += GATE_BATCH) {
    const batch = shots.slice(k, k + GATE_BATCH);
    const content: LlmContent = [];
    const files: string[] = [];
    for (const [i, s] of batch.entries()) {
      const file = await deps.frame(s);
      files.push(file);
      content.push({ type: "text", text: `Frame ${i + 1} of ${batch.length}` });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: (await fs.readFile(file)).toString("base64"),
        },
      });
    }
    content.push({
      type: "text",
      text: `Documentary: ${deps.headline}\nAbout: ${deps.game || "(several games)"}\n${batch.map((s, i) => shotLine(i + 1, s)).join("\n")}`,
    });
    const r = await deps.llm
      .structured({
        tier: "mid",
        effort: "low",
        cache: "1h",
        system: RELEASE_GATE_PROMPT,
        content,
        schema: GateBatchSchema,
      })
      .catch((err) => {
        log("warn", "release gate batch failed", { error: errorMessage(err) });
        return undefined;
      });
    const byFrame = new Map(
      (r?.frames ?? []).map((f) => [Math.round(f.frame), f] as const),
    );
    for (const [i, s] of batch.entries()) {
      const f = byFrame.get(i + 1);
      out.push({
        ...s,
        score: f ? Math.max(0, Math.min(3, Math.round(f.score))) : undefined,
        reason: f ? f.reason.slice(0, 200) : "not scored",
      });
    }
  }
  return out;
}

/** One frame from the middle of a shot, 384 px wide, as the model sees it. */
export async function gateFrame(
  video: string,
  seconds: number,
  dest: string,
): Promise<string> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await run(FFMPEG, [
    "-loglevel",
    "error",
    "-y",
    "-ss",
    Math.max(0, seconds).toFixed(2),
    "-i",
    video,
    "-frames:v",
    "1",
    "-vf",
    `scale=${GATE_FRAME_WIDTH}:-2`,
    "-q:v",
    "5",
    dest,
  ]);
  return dest;
}

/** The Discord card for a held documentary: the numbers, the worst shots with their words and reasons, the links. */
export function heldNotice(
  title: string,
  stats: GateStats,
  reasons: string[],
  worst: ScoredShot[],
  cost: { usd: number },
  links: { approve: string; reject: string; preview: string },
): DiscordMessage {
  const lines = worst.map(
    (s, i) =>
      `${i + 1}. ${mmss(s.start)} to ${mmss(s.end)} · score ${s.score} · "${s.words.slice(0, 110)}${s.words.length > 110 ? "..." : ""}" · ${s.reason.slice(0, 120)}`,
  );
  const description = [
    `Held because: ${reasons.join("; ")}.`,
    `${stats.shots} shots scored over ${mmss(stats.seconds)} of narration: ${Math.round(stats.threeShare * 100)}% of screen time spot on, ${Math.round(stats.zeroShare * 100)}% wrong. About $${cost.usd.toFixed(2)} in checks.`,
    "",
    "Worst shots:",
    ...lines,
    "",
    `▶️ [Watch](${links.preview})  ·  ✅ [Approve (publish as it is)](${links.approve})  ·  ❌ [Reject](${links.reject})`,
    "Fix the shots and re-render, or approve it as it is. Unanswered, it expires after 48 h.",
  ].join("\n");
  return {
    ping: true,
    content: `🛑 Release gate held "${title}" (private, not uploaded).`,
    embeds: [
      {
        title: `🛑 Release gate: ${title}`,
        description: description.slice(0, 4000),
        color: COLOURS.warn,
      },
    ],
  };
}

/** The services the gate step needs (a slice of src/pipeline.ts Services, so tests can fake it). */
export interface GateServices {
  db: Db;
  cfg: Pick<Config, "dataDir" | "releaseGateMinMean" | "releaseGateMaxZero">;
  llm: Llm;
  notify(msg: DiscordMessage): Promise<unknown>;
  now(): Date;
  /** Episode folder, for the final video and the frames (tests point it at a temp folder). */
  episodeDir(id: string): string;
  /** The frame grabber (ffmpeg); tests swap in a stub. */
  frame?: (video: string, seconds: number, dest: string) => Promise<string>;
}

export interface GateResult {
  pass: boolean;
  stats: GateStats;
  reasons: string[];
  shots: ScoredShot[];
  cost: ReturnType<typeof estimateGateCost>;
  checked_at: string;
  /** Which render these scores belong to (the render QA's checked_at), so a retry never pays twice. */
  for: string | null;
}

/** Scores a rendered documentary's shots and decides; nothing is written to the episode here. */
export async function scoreEpisode(
  s: GateServices,
  ep: Episode,
  ctx: {
    segments: Segment[];
    chapters: Array<{ game: string; year?: number }>;
  },
): Promise<GateResult> {
  const assets = ep.assets_json ?? {};
  const script = ep.script_json!;
  const plan = assets.longPlan!;
  const words = assets.words ?? [];
  const moments = [...(script.entries ?? [])]
    .sort((a, b) => b.rank - a.rank)
    .map((e) => e.moments ?? []);
  const windows = momentWindows(
    ctx.segments,
    words,
    moments.map((m) => m.length),
    moments.map((e) => e.map(momentKeys)),
  );
  const shots = gateShots(plan, words, windows, ctx.chapters);
  const cost = estimateGateCost(shots.length);
  const dir = s.episodeDir(ep.id);
  const video = path.join(dir, assets.video ?? "short.mp4");
  const frameDir = path.join(dir, "qa", "gate");
  await fs.rm(frameDir, { recursive: true, force: true });
  const grab = s.frame ?? gateFrame;
  let scored: ScoredShot[];
  try {
    scored = await scoreShots(shots, {
      llm: s.llm,
      headline: script.headline,
      game: script.game_title,
      frame: (shot) =>
        grab(
          video,
          (shot.start + shot.end) / 2,
          path.join(frameDir, `s${shot.index}.jpg`),
        ),
    });
  } finally {
    await fs
      .rm(frameDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
  const unscored = scored.filter((x) => x.score === undefined).length;
  if (shots.length && unscored > shots.length / 2)
    throw new Error(
      `release gate: ${unscored} of ${shots.length} shots could not be scored`,
    );
  const stats = gateStats(scored);
  const { pass, reasons } = gateDecision(stats, {
    minMean: s.cfg.releaseGateMinMean,
    maxZero: s.cfg.releaseGateMaxZero,
  });
  return {
    pass,
    stats,
    reasons,
    shots: scored,
    cost,
    checked_at: s.now().toISOString(),
    for:
      typeof ep.qa_json?.checked_at === "string" ? ep.qa_json.checked_at : null,
  };
}

/**
 * The gate as a pipeline step, run on a rendered documentary before its approval: true when the episode was
 * held (the caller stops), false when it may carry on. A gate that cannot run (the model down, no video) lets
 * the documentary carry on as before the gate existed, and says so on Discord. Scores already on the episode
 * for this render are reused, so a retry never pays twice.
 */
export async function releaseGateStep(
  s: GateServices,
  ep: Episode,
  ctx: {
    segments: Segment[];
    chapters: Array<{ game: string; year?: number }>;
    links: { approve: string; reject: string; preview: string };
  },
): Promise<boolean> {
  const title =
    ep.script_json?.youtube.title ?? ep.script_json?.headline ?? ep.id;
  const prior = ep.qa_json?.release as GateResult | undefined;
  let result: GateResult;
  if (prior && prior.for === (ep.qa_json?.checked_at ?? null) && prior.shots) {
    result = prior;
  } else {
    try {
      result = await scoreEpisode(s, ep, ctx);
    } catch (err) {
      log("warn", "release gate could not run", {
        episode: ep.id,
        error: errorMessage(err),
      });
      await logEvent(s.db, ep.id, "release_gate", {
        skipped: errorMessage(err).slice(0, 300),
      });
      await s.notify({
        content: `⚠️ The release gate could not check "${title}" (${errorMessage(err).slice(0, 160)}). It carries on to its usual publish path unchecked.`,
      });
      return false;
    }
    const qa = { ...(ep.qa_json ?? {}), release: result };
    await s.db.query(`UPDATE episodes SET qa_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(qa),
    ]);
    await logEvent(s.db, ep.id, "release_gate", {
      pass: result.pass,
      reasons: result.reasons,
      ...result.stats,
      cost: result.cost,
      worst: worstShots(result.shots, WORST_SHOTS).map((x) => ({
        at: mmss(x.start),
        score: x.score,
        words: x.words.slice(0, 120),
        reason: x.reason,
      })),
    });
    log(result.pass ? "info" : "warn", "release gate", {
      episode: ep.id,
      pass: result.pass,
      mean: Math.round(result.stats.mean * 100) / 100,
      zero: Math.round(result.stats.zeroShare * 1000) / 1000,
      three: Math.round(result.stats.threeShare * 1000) / 1000,
      shots: result.stats.shots,
      usd: result.cost.usd,
    });
  }
  if (result.pass) {
    await s.notify({
      level: "info",
      content: `✅ "${title}" passed the release gate: mean shot score ${result.stats.mean.toFixed(2)} of 3, ${Math.round(result.stats.zeroShare * 100)}% of screen time wrong, ${result.stats.shots} shots, about $${result.cost.usd.toFixed(2)}.`,
    });
    return false;
  }
  // Held: it waits for the owner like a manual approval (Approve publishes it as it is; a fix and re-render
  // starts the gate afresh). The status moves first so a failed notice can never let it slip through.
  const held = await transition(s.db, ep.id, "rendered", "awaiting_approval", {
    approval_mode: "manual",
    approval_requested_at: s.now(),
  });
  if (!held) return true;
  await logEvent(s.db, ep.id, "release_gate_held", { reasons: result.reasons });
  await s.notify(
    heldNotice(
      title,
      result.stats,
      result.reasons,
      worstShots(result.shots, WORST_SHOTS),
      result.cost,
      ctx.links,
    ),
  );
  return true;
}
