// The VOD moment miner (VOD_MINER): the owner's streams searched for moments that answer the open stream asks, even
// when he never said the claim out loud (a car running dry, losing the cops after a change of clothes, a stranger's
// dog going for him). Three kinds of evidence from the stream's index (src/vodindex): what was said (Whisper), what
// was written on screen (the text reader: "WASTED", "Out of fuel") and what the free local vision model saw in each
// shot. A moment that fits an ask well enough is looked at again, frame by frame, by the same local model with the
// claim in front of it, and gets a verdict: proved, disproved or unclear. Only a verdict the model is sure of
// (VOD_MINER_MIN_CONFIDENCE) and that at least two kinds of evidence agree with is called proved or disproved;
// everything else stays "unclear", is kept for the owner to look at, and is never published as a verdict.
// A confident moment becomes a candidate clip for the gameplay lane ("Previews said X. I tested it.", his footage
// first; the lane still waits for his tap in Discord) and a line in the week's running list for the long video. The
// spoiler guard applies: a moment that looks like a story cutscene during the game's window is held.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import {
  LOCAL_VISION_MODEL,
  LOCAL_VISION_URL,
  THINK_ROOM,
  visionAnswer,
} from "../assets/localvision.ts";
import { frameArgs, stripArgs } from "../sceneindex/build.ts";
import { tokens } from "../sceneindex/lookup.ts";
import { loadSceneIndex } from "../sceneindex/schema.ts";
import {
  clipStoryMoment,
  spoilerWindows,
  streamClipHold,
  windowFor,
  type SpoilerWindow,
} from "../sceneindex/spoilers.ts";
import { speechShare } from "../sceneindex/spoilerclips.ts";
import {
  shotsBetween,
  wordsBetween,
  type VodIndex,
} from "../vodindex/schema.ts";
import { applyVerdict, type AskVerdict, type StreamAsk } from "./asks.ts";

const run = promisify(execFile);

export type Signal = "said" | "text" | "seen";

export interface MomentCandidate {
  askId: string;
  vodId: string;
  /** Seconds into the recording. */
  start: number;
  end: number;
  peak: number;
  /** 0-1: how well the moment's evidence fits the ask's cues. */
  cue: number;
  signals: Signal[];
  /** What matched, for the page and the contact sheet. */
  matched: { said: string[]; text: string[]; seen: string[] };
  transcript: string;
}

/** True when every telling word of a phrase is in the words (pure). */
export function phraseIn(phrase: string, words: Set<string>): boolean {
  const t = tokens(phrase);
  return t.length > 0 && t.every((w) => words.has(w));
}

/** The share of a phrase's telling words that are in the words, 0-1 (pure). */
export function phraseShare(phrase: string, words: Set<string>): number {
  const t = [...new Set(tokens(phrase))];
  if (!t.length) return 0;
  return t.filter((w) => words.has(w)).length / t.length;
}

/**
 * The moments of a stream that fit an ask, best first (pure). Every shot is a possible peak; around it a window of
 * `window` seconds is searched: words said (a cue phrase whole, or the owner announcing the test: "testing" with the
 * ask's own words), writing on screen (a cue word read in a shot) and pictures (the vision model's description and
 * search words against the cue scenes, at least half their words). Moments closer than `spacing` seconds are one.
 */
export function findMoments(
  vod: VodIndex,
  ask: Pick<StreamAsk, "id" | "question" | "cues">,
  o: { window?: number; spacing?: number; max?: number; minCue?: number } = {},
): MomentCandidate[] {
  const half = (o.window ?? 40) / 2;
  const spacing = o.spacing ?? 90;
  const askWords = new Set(tokens(ask.question).filter((w) => w.length > 3));
  const scored: MomentCandidate[] = [];
  for (const shot of vod.shots) {
    if (shot.blank || shot.menu) continue;
    const peak = (shot.start + shot.end) / 2;
    const from = Math.max(0, peak - half);
    const to = Math.min(vod.duration, peak + half);
    const transcript = wordsBetween(vod, from, to);
    const said = new Set(tokens(transcript));
    const saidHits = ask.cues.said.filter((p) => phraseIn(p, said));
    const announced =
      /\btest(ing)?\b/i.test(transcript) &&
      [...askWords].filter((w) => said.has(w)).length >=
        Math.min(3, askWords.size);
    const near = shotsBetween(vod, from, to);
    const written = new Set(tokens(near.map((s) => s.text).join(" ")));
    const textHits = ask.cues.text.filter((p) => phraseIn(p, written));
    let seenBest = 0;
    const seenHits: string[] = [];
    for (const s of near) {
      if (!s.desc || s.desc === "-") continue;
      const words = new Set(tokens(`${s.desc} ${s.tags.join(" ")} ${s.where}`));
      for (const p of ask.cues.seen) {
        const share = phraseShare(p, words);
        if (share >= 0.5) {
          seenBest = Math.max(seenBest, share);
          if (!seenHits.includes(p)) seenHits.push(p);
        }
      }
    }
    const saidScore = Math.min(
      1,
      saidHits.length * 0.34 + (announced ? 0.5 : 0),
    );
    const textScore = Math.min(1, textHits.length * 0.5);
    const signals: Signal[] = [
      ...(saidScore >= 0.3 ? (["said"] as const) : []),
      ...(textScore >= 0.5 ? (["text"] as const) : []),
      ...(seenBest >= 0.5 ? (["seen"] as const) : []),
    ];
    if (!signals.length) continue;
    const cue = Math.min(
      1,
      0.4 * saidScore +
        0.25 * textScore +
        0.35 * seenBest +
        (signals.length >= 2 ? 0.15 : 0),
    );
    scored.push({
      askId: ask.id,
      vodId: vod.vodId,
      start: Math.round(from * 10) / 10,
      end: Math.round(to * 10) / 10,
      peak: Math.round(peak * 10) / 10,
      cue: Math.round(cue * 100) / 100,
      signals,
      matched: {
        said: saidHits.concat(announced ? ["(announced the test)"] : []),
        text: textHits,
        seen: seenHits,
      },
      transcript: transcript.slice(0, 600),
    });
  }
  const out: MomentCandidate[] = [];
  for (const c of scored.sort(
    (a, b) => b.cue - a.cue || b.signals.length - a.signals.length,
  )) {
    if (c.cue < (o.minCue ?? 0.45)) break;
    if (out.some((x) => Math.abs(x.peak - c.peak) < spacing)) continue;
    out.push(c);
    if (out.length >= (o.max ?? 3)) break;
  }
  return out;
}

// ---------------------------------------------------------------- the verdict

export interface ModelVerdict {
  verdict: "proved" | "disproved" | "unclear";
  confidence: number;
  reason: string;
  /** Which frame (1-based) shows it best. */
  best: number;
}

export type Decision = {
  result: "proved" | "disproved" | "unclear";
  confidence: number;
  why: string;
};

/**
 * The miner's bar (pure): proved or disproved only when the model says so with at least `minConfidence` and at
 * least two kinds of evidence agree (the words said, the writing on screen, the shot descriptions), or one kind
 * with the model all but certain (0.9). Anything else is unclear, and an unclear moment is never a verdict.
 */
export function decide(
  m: ModelVerdict,
  c: Pick<MomentCandidate, "signals" | "cue">,
  minConfidence: number,
): Decision {
  if (m.verdict === "unclear")
    return {
      result: "unclear",
      confidence: m.confidence,
      why: "the frames do not settle it",
    };
  if (m.confidence < minConfidence)
    return {
      result: "unclear",
      confidence: m.confidence,
      why: `only ${Math.round(m.confidence * 100)}% sure`,
    };
  if (c.signals.length < 2 && m.confidence < 0.9)
    return {
      result: "unclear",
      confidence: m.confidence,
      why: "only one kind of evidence agrees",
    };
  return { result: m.verdict, confidence: m.confidence, why: m.reason };
}

/** The question for the local model (pure). */
export function verdictPrompt(
  ask: Pick<StreamAsk, "question" | "claim" | "game">,
  c: MomentCandidate,
  frames: number,
): string {
  return [
    `${frames} frames in order, about ${Math.round((c.end - c.start) / Math.max(1, frames - 1))} seconds apart, from a livestream of the video game "${ask.game}".`,
    `People ask: "${ask.question}"${ask.claim ? ` (the claim: "${ask.claim.slice(0, 200)}")` : ""}.`,
    c.transcript
      ? `What the streamer and the game said meanwhile: "${c.transcript.slice(0, 500)}"`
      : "",
    `Does this footage answer it? verdict: "proved" when the frames clearly show it happening as claimed; "disproved" when they clearly show it being tried and not happening; "unclear" otherwise (not shown, not tried, or you are guessing).`,
    `confidence: 0 to 1, how sure you are of that verdict from what you can see. reason: one plain sentence about what the frames show. best: the number of the frame that shows it best.`,
    `Judge only what is visible or said; never use what you know about the game from elsewhere.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["proved", "disproved", "unclear"] },
    confidence: { type: "number" },
    reason: { type: "string" },
    best: { type: "integer" },
  },
  required: ["verdict", "confidence", "reason", "best"],
};

/** The model's answer as a verdict (pure); anything malformed is unclear. */
export function parseVerdict(raw: any, frames: number): ModelVerdict {
  const v =
    raw?.verdict === "proved" || raw?.verdict === "disproved"
      ? raw.verdict
      : "unclear";
  const conf = Number(raw?.confidence);
  return {
    verdict: v,
    confidence: Number.isFinite(conf)
      ? Math.min(1, Math.max(0, conf > 1 ? conf / 100 : conf))
      : 0,
    reason: String(raw?.reason ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240),
    best: Math.min(frames, Math.max(1, Math.round(Number(raw?.best) || 1))),
  };
}

/** Asks the free local vision model (never a paid one). Throws when it cannot be reached. */
export async function askLocalVerdict(
  files: string[],
  prompt: string,
): Promise<ModelVerdict> {
  const images = await Promise.all(
    files.map(async (f) => (await fs.readFile(f)).toString("base64")),
  );
  const res = await fetchWithTimeout(
    `${LOCAL_VISION_URL}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: LOCAL_VISION_MODEL,
        stream: false,
        think: false,
        format: VERDICT_SCHEMA,
        keep_alive: "15m",
        options: {
          temperature: 0,
          num_predict: 300 + THINK_ROOM,
          num_ctx: 12288,
        },
        messages: [{ role: "user", content: prompt, images }],
      }),
    },
    240_000,
  );
  if (!res.ok)
    throw new Error(
      `ollama ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return parseVerdict(
    visionAnswer(
      (await res.json()) as {
        message?: { content?: string; thinking?: string };
      },
    ),
    files.length,
  );
}

// ---------------------------------------------------------------- one stream against the open asks

export interface MinedMoment {
  ask: {
    id: string;
    question: string;
    claim: string;
    game: string;
    rumour: boolean;
  };
  candidate: MomentCandidate;
  model?: ModelVerdict;
  decision: Decision;
  /** SPOILER_GUARD: a story cutscene during the game's window. */
  held?: string;
  /** Relative to the data folder. */
  dir: string;
  frames: string[];
  contact?: string;
  /** The gameplay lane's inbox folder made for it, when it went there. */
  inbox?: string;
}

export interface MineSettings {
  dataDir: string;
  minCue: number;
  minConfidence: number;
  toLane: boolean;
  gameplayRoot: string;
  spoilerGuard: boolean;
}

export interface MineDeps {
  verdict?: (files: string[], prompt: string) => Promise<ModelVerdict>;
  frame?: (file: string, time: number, out: string) => Promise<void>;
  strip?: (file: string, times: number[], out: string) => Promise<void>;
  cut?: (
    file: string,
    from: number,
    seconds: number,
    out: string,
  ) => Promise<void>;
  windows?: readonly SpoilerWindow[];
  now?: () => Date;
}

const FRAMES = 6;

export const momentKey = (askId: string, vodId: string, peak: number) =>
  `${askId}-${vodId}-${Math.round(peak)}`;

/** The frames a verdict looks at: evenly across the moment, never on its very edges (pure). */
export function verdictTimes(start: number, end: number, n = FRAMES): number[] {
  const len = end - start;
  return Array.from(
    { length: n },
    (_, i) => Math.round((start + len * ((i + 0.5) / n)) * 100) / 100,
  );
}

/**
 * Searches one stream for every open ask of its game and judges the best moments. Returns the asks with any
 * verdicts applied and the moments found (each saved with its frames, contact sheet and meta.json). A moment
 * already judged is not judged again.
 */
export async function mineVod(
  vod: VodIndex,
  asks: StreamAsk[],
  s: MineSettings,
  deps: MineDeps = {},
): Promise<{ asks: StreamAsk[]; moments: MinedMoment[] }> {
  const now = deps.now?.() ?? new Date();
  const frame =
    deps.frame ??
    (async (file: string, t: number, out: string) =>
      void (await run(FFMPEG, frameArgs(file, t, out), { timeout: 60_000 })));
  const strip =
    deps.strip ??
    (async (file: string, times: number[], out: string) =>
      void (await run(FFMPEG, stripArgs(file, times, out), {
        timeout: 120_000,
      })));
  const verdict = deps.verdict ?? askLocalVerdict;
  let list = asks;
  const moments: MinedMoment[] = [];
  const game = vod.game.toLowerCase();
  for (const ask of asks.filter(
    (a) => a.status === "open" && (!game || a.game.toLowerCase() === game),
  )) {
    for (const c of findMoments(vod, ask, { minCue: s.minCue })) {
      const rel = path.join(
        "streamasks",
        "moments",
        momentKey(ask.id, vod.vodId, c.peak),
      );
      const dir = path.join(s.dataDir, rel);
      const metaFile = path.join(dir, "meta.json");
      const prior = await fs
        .readFile(metaFile, "utf8")
        .then((t) => JSON.parse(t) as MinedMoment)
        .catch(() => undefined);
      if (prior) {
        // Judged before: its verdict is put back (a refresh may have rewritten the list since), never asked again.
        if (prior.decision.result !== "unclear")
          list = applyVerdict(list, ask.id, {
            result: prior.decision.result,
            confidence: prior.decision.confidence,
            vodId: vod.vodId,
            recordedOn: vod.recordedOn,
            at: prior.candidate.peak,
            reason: prior.decision.why,
            moment: rel,
            decidedAt: now.toISOString(),
          });
        moments.push(prior);
        if (prior.decision.result !== "unclear") break;
        continue;
      }
      await fs.mkdir(path.join(dir, "frames"), { recursive: true });
      const times = verdictTimes(c.start, c.end);
      const frames: string[] = [];
      for (const [i, t] of times.entries()) {
        const f = path.join("frames", `${String(i + 1).padStart(2, "0")}.jpg`);
        await frame(vod.file, t, path.join(dir, f));
        frames.push(f);
      }
      let model: ModelVerdict | undefined;
      let decision: Decision;
      try {
        model = await verdict(
          frames.map((f) => path.join(dir, f)),
          verdictPrompt(ask, c, frames.length),
        );
        decision = decide(model, c, s.minConfidence);
      } catch (err) {
        log(
          "warn",
          "stream asks: verdict not asked (vision model not answering)",
          { error: errorMessage(err) },
        );
        await fs.rm(dir, { recursive: true, force: true });
        continue; // tried again on the next pass
      }
      const contact = "contact.jpg";
      await strip(
        vod.file,
        times
          .filter((_, i) => i % 2 === 1 || i === model!.best - 1)
          .slice(0, 4),
        path.join(dir, contact),
      ).catch(() => undefined);
      const held = s.spoilerGuard
        ? await spoilerHeld(vod, c, s, deps.windows, now)
        : undefined;
      const m: MinedMoment = {
        ask: {
          id: ask.id,
          question: ask.question,
          claim: ask.claim,
          game: ask.game,
          rumour: ask.rumour,
        },
        candidate: c,
        model,
        decision,
        ...(held ? { held } : {}),
        dir: rel,
        frames,
        contact,
      };
      if (decision.result !== "unclear") {
        const v: AskVerdict = {
          result: decision.result,
          confidence: decision.confidence,
          vodId: vod.vodId,
          recordedOn: vod.recordedOn,
          at: c.peak,
          reason: decision.why,
          moment: rel,
          decidedAt: now.toISOString(),
        };
        list = applyVerdict(list, ask.id, v);
        await recordTested(s.dataDir, { ...m.ask, verdict: v });
        if (s.toLane && !held)
          m.inbox = await toGameplayInbox(vod, m, s, deps).catch((err) => {
            log("warn", "stream asks: candidate clip not cut", {
              error: errorMessage(err),
            });
            return undefined;
          });
      } else {
        list = list.map((a) =>
          a.id === ask.id ? { ...a, unclear: (a.unclear ?? 0) + 1 } : a,
        );
      }
      await fs.writeFile(metaFile, JSON.stringify(m, null, 1));
      moments.push(m);
      log("info", "stream asks: moment judged", {
        ask: ask.question,
        vod: vod.vodId,
        at: c.peak,
        cue: c.cue,
        signals: c.signals,
        result: decision.result,
        confidence: decision.confidence,
      });
      if (decision.result !== "unclear") break; // one verdict an ask a stream is enough
    }
  }
  return { asks: list, moments };
}

async function spoilerHeld(
  vod: VodIndex,
  c: MomentCandidate,
  s: MineSettings,
  windows: readonly SpoilerWindow[] | undefined,
  now: Date,
): Promise<string | undefined> {
  const w = windowFor(windows ?? spoilerWindows(), vod.game, now);
  if (!w) return undefined;
  const index = await loadSceneIndex(s.dataDir, w.game);
  const words = vod.lines
    .filter((l) => l.end > c.start && l.start < c.end)
    .flatMap((l) => l.words ?? [{ text: l.text, start: l.start, end: l.end }])
    .map((x) => ({
      text: x.text,
      start: x.start - c.start,
      end: x.end - c.start,
    }));
  const verdict = streamClipHold(
    w,
    index,
    {
      speechShare: speechShare(words, c.end - c.start),
      storyAt: index ? clipStoryMoment(index, c.transcript) : undefined,
    },
    now,
  );
  return verdict.hold ? verdict.reason : undefined;
}

/** The week's running list for the long video (data/streamasks/tested.json), one line an ask, newest verdict kept. */
export async function recordTested(
  dataDir: string,
  line: {
    id: string;
    question: string;
    claim: string;
    game: string;
    rumour: boolean;
    verdict: AskVerdict;
  },
): Promise<void> {
  const file = path.join(dataDir, "streamasks", "tested.json");
  const list = JSON.parse(
    await fs.readFile(file, "utf8").catch(() => "[]"),
  ) as Array<typeof line>;
  const next = [...list.filter((x) => x.id !== line.id), line];
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(next, null, 1));
}

/** What the streams settled in the seven days to `now`, for the weekly long video (the guide reads this). */
export async function testedThisWeek(
  dataDir: string,
  now: Date,
  game?: string,
): Promise<
  Array<{
    id: string;
    question: string;
    game: string;
    rumour: boolean;
    verdict: AskVerdict;
  }>
> {
  const file = path.join(dataDir, "streamasks", "tested.json");
  const list = JSON.parse(
    await fs.readFile(file, "utf8").catch(() => "[]"),
  ) as Array<{
    id: string;
    question: string;
    game: string;
    rumour: boolean;
    verdict: AskVerdict;
  }>;
  const since = now.getTime() - 7 * 86_400_000;
  return list.filter(
    (x) =>
      Date.parse(x.verdict.decidedAt) >= since && (!game || x.game === game),
  );
}

/**
 * A confident moment as a candidate in the gameplay lane's inbox (INBOX-CONTRACT.md): a 35-second cut around the
 * moment, eight frames and a meta.json that carries the ask, so the lane writes "Previews said X. I tested it." The
 * lane still reviews it, runs its own spoiler check and waits for the owner's tap.
 */
async function toGameplayInbox(
  vod: VodIndex,
  m: MinedMoment,
  s: MineSettings,
  deps: MineDeps,
): Promise<string> {
  const id = `sa_${crypto.createHash("sha1").update(m.dir).digest("hex").slice(0, 10)}`;
  const dir = path.join(s.gameplayRoot, "inbox", id);
  if (await fs.stat(path.join(dir, "meta.json")).catch(() => undefined))
    return dir;
  await fs.mkdir(path.join(dir, "frames"), { recursive: true });
  const seconds = 35;
  const from = Math.max(
    0,
    Math.min(vod.duration - seconds, m.candidate.peak - 14),
  );
  const cut =
    deps.cut ??
    (async (file: string, start: number, len: number, out: string) =>
      void (await run(
        FFMPEG,
        [
          "-loglevel",
          "error",
          "-y",
          "-ss",
          start.toFixed(2),
          "-t",
          String(len),
          "-i",
          file,
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "16",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
          out,
        ],
        { timeout: 10 * 60_000 },
      )));
  await cut(vod.file, from, seconds, path.join(dir, "clip.mp4"));
  const frames: string[] = [];
  const frame =
    deps.frame ??
    (async (file: string, t: number, out: string) =>
      void (await run(FFMPEG, frameArgs(file, t, out), { timeout: 60_000 })));
  for (let i = 0; i < 8; i++) {
    const f = `frames/${String(i + 1).padStart(2, "0")}.jpg`;
    await frame(vod.file, from + (seconds * (i + 0.5)) / 8, path.join(dir, f));
    frames.push(f);
  }
  const meta = {
    id,
    status: "new",
    source: {
      file: vod.file,
      title: vod.title,
      kind: "twitch_vod",
      duration_seconds: Math.round(vod.duration),
    },
    clip: {
      file: "clip.mp4",
      start_in_source: Math.round(from),
      peak_in_clip: Math.round(m.candidate.peak - from),
      seconds,
    },
    score: 2 + m.decision.confidence,
    frames,
    created_at: (deps.now?.() ?? new Date()).toISOString(),
    stream_ask: {
      question: m.ask.question,
      claim: m.ask.claim,
      rumour: m.ask.rumour,
      verdict: m.decision.result,
      confidence: m.decision.confidence,
      reason: m.decision.why,
    },
  };
  await fs.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify(meta, null, 2),
  );
  return dir;
}
