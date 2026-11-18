// One week's compilation from start to finish: gather what is known about each recording, rank the moments, plan the
// chapters, write and judge the links, voice them, lay out the timeline, audit its graphics, render, and write the
// package and a report beside the video. Used by the weekly job (src/streamweekly/job.ts) and by the hand tool
// (src/tools/streamweekly.ts), so the proof and the live run are the same code. Every outside call is injectable.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "../lib/bin.ts";
import type { Llm } from "../editorial/llm.ts";
import { letterboxed } from "../assets/footagefirst.ts";
import { measure } from "../liveclips/recorder.ts";
import { liveDir, type LiveState } from "../liveclips/job.ts";
import { testedThisWeek } from "../streamasks/miner.ts";
import { loadVodIndex, type VodIndex } from "../vodindex/schema.ts";
import { describeVodShots } from "../vodindex/build.ts";
import { visionUp } from "../sceneindex/describe.ts";
import { loadSceneIndex } from "../sceneindex/schema.ts";
import {
  clipStoryMoment,
  spoilerHits,
  spoilerNotes,
  spoilerWindow,
  streamClipHold,
  windowOpen,
  type SpoilerWindow,
} from "../sceneindex/spoilers.ts";
import {
  rankWeek,
  type SettledAsk,
  type StreamChat,
  type StreamSecond,
  type WeekMoment,
  type WeekStream,
} from "./moments.ts";
import {
  planProblems,
  planWeek,
  shortGameName,
  type WeekPlan,
} from "./chapters.ts";
import {
  playOrder,
  scriptLines,
  planKey,
  scriptProblems,
  withSignOff,
  writeWeek,
  type WeekScript,
} from "./script.ts";
import {
  auditTimeline,
  buildTimeline,
  fixLabels,
  weekPackage,
  type DayLink,
  type Timeline,
  type Voice,
  type WeekPackage,
} from "./timeline.ts";
import { GTA_DAILY_PLAYLIST } from "../gtadaily.ts";
import type { WeekCheck } from "./render.ts";

const runRaw = (args: string[]) =>
  promisify(execFile)(FFMPEG, args, {
    encoding: "buffer",
    maxBuffer: 1 << 20,
    timeout: 30_000,
    windowsHide: true,
  }) as Promise<{ stdout: Buffer }>;

export const weeklyDir = (dataDir: string) =>
  path.join(dataDir, "streamweekly");

/** The recording's second-by-second sound and action, measured once and kept (data/streamweekly/signals/<vod>.json). */
export async function streamSeconds(
  dataDir: string,
  v: VodIndex,
  m: typeof measure = measure,
): Promise<StreamSecond[]> {
  const file = path.join(
    weeklyDir(dataDir),
    "signals",
    `${v.vodId.replace(/[^\w-]/g, "_")}.json`,
  );
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as StreamSecond[];
  } catch {
    /* measured below */
  }
  const raw = await m(FFMPEG, v.file, 0, Math.ceil(v.duration));
  const seconds = raw.map((s, i) => ({ t: i, loud: s.loud, motion: s.motion }));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(seconds));
  return seconds;
}

/** The share of frames with cinema bars across a stretch of a recording (eight 9x8 greyscale samples). */
export async function barsShare(
  file: string,
  from: number,
  to: number,
  samples = 8,
): Promise<number> {
  let bars = 0;
  let seen = 0;
  for (let k = 0; k < samples; k++) {
    const at = from + ((k + 0.5) / samples) * Math.max(1, to - from);
    try {
      const { stdout } = await runRaw([
        "-v",
        "error",
        "-ss",
        at.toFixed(2),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "scale=9:8,format=gray",
        "-f",
        "rawvideo",
        "-",
      ]);
      if (stdout.length >= 72) {
        seen++;
        if (letterboxed(new Uint8Array(stdout.subarray(0, 72)))) bars++;
      }
    } catch {
      /* a frame that will not decode is not counted */
    }
  }
  return seen ? bars / seen : 0;
}

/** The live job's chat for the stream this recording is of, as seconds from the recording's start (best effort). */
export async function streamChat(
  dataDir: string,
  v: VodIndex,
): Promise<{ chat: StreamChat[]; live: Array<{ t: number; score: number }> }> {
  const state = JSON.parse(
    await fs
      .readFile(path.join(liveDir(dataDir), "state.json"), "utf8")
      .catch(() => "{}"),
  ) as Partial<LiveState>;
  const id = v.vodId.replace(/^v/, "");
  const entry = Object.entries(state.streams ?? {}).find(
    ([, s]) => s.vod && s.vod.replace(/^v/, "") === id,
  );
  if (!entry) return { chat: [], live: [] };
  const [streamId, s] = entry;
  const started = Date.parse(s.startedAt);
  const live = s.taken.map(([a, b]) => ({ t: (a + b) / 2, score: 1.5 }));
  const file = path.join(
    liveDir(dataDir),
    "chat",
    `${s.startedAt.slice(0, 10)}_${streamId}.jsonl`,
  );
  const chat = (await fs.readFile(file, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        const o = JSON.parse(l) as { at: number; user: string; text: string };
        return [{ t: (o.at - started) / 1000, user: o.user, text: o.text }];
      } catch {
        return [];
      }
    })
    .filter((c) => c.t >= 0 && c.t <= v.duration);
  return { chat, live };
}

/** The stream asks the miner settled on this recording in the week (data/streamasks/tested.json). */
export async function streamAsksSettled(
  dataDir: string,
  v: VodIndex,
  now: Date,
): Promise<SettledAsk[]> {
  const list = await testedThisWeek(dataDir, now).catch(() => []);
  return list
    .filter((x) => x.verdict.vodId === v.vodId)
    .map((x) => ({
      id: x.id,
      question: x.question,
      result: x.verdict.result,
      confidence: x.verdict.confidence,
      at: x.verdict.at,
      rumour: x.rumour,
    }));
}

export interface GatherOptions {
  dataDir: string;
  now: Date;
  /** Measures a recording (tests pass a stand-in). */
  measure?: typeof measure;
}

/** Everything known about one recording. */
export async function gatherStream(
  v: VodIndex,
  o: GatherOptions,
): Promise<WeekStream> {
  const seconds = await streamSeconds(o.dataDir, v, o.measure);
  const { chat, live } = await streamChat(o.dataDir, v);
  const asks = await streamAsksSettled(o.dataDir, v, o.now);
  return { index: v, seconds, chat, live, asks };
}

/**
 * The spoiler rule for the owner's moments: the series' own window (launch to SPOILER_WINDOW_DAYS later) always,
 * plus the spoiler guard's live windows. A moment is held when its words give the story away, or when the game's
 * scene index places its words (a cutscene line) beyond the opening.
 */
export function spoilerRule(o: {
  game: string;
  start: string;
  days: number;
  live: readonly SpoilerWindow[];
  now: Date;
  scene?: Awaited<ReturnType<typeof loadSceneIndex>>;
}) {
  const own = spoilerWindow(o.game, `${o.start}T00:00:00Z`, {
    days: o.days,
    openingShare: 0.1,
  });
  const windows = [...(own ? [own] : []), ...o.live];
  const open = windows.some((w) => windowOpen(w, o.now));
  return {
    open,
    check: (
      text: string,
      m: { start: number; end: number },
    ): string | undefined => {
      if (!open) return undefined;
      const hits = spoilerNotes(spoilerHits(text, windows, o.now, [o.game]));
      if (hits.length) return `spoiler: ${hits[0]!.slice(0, 120)}`;
      if (o.scene && own) {
        const at = clipStoryMoment(o.scene, text);
        const hold = streamClipHold(own, o.scene, { storyAt: at }, o.now);
        if (hold.hold) return `spoiler: ${hold.reason}`;
      }
      void m;
      return undefined;
    },
  };
}

export interface CompileInput {
  game: string;
  week: number;
  /** Day 1 of the series (YYYY-MM-DD). */
  start: string;
  streams: WeekStream[];
  outDir: string;
  minSeconds: number;
  maxSeconds: number;
  minMoments: number;
  llm?: Llm;
  /** Voices one line into a file; returns its length. */
  voice: (key: string, text: string, file: string) => Promise<Voice>;
  render?: (
    tl: Timeline,
    out: {
      file: string;
      poster: string;
      episodeDir: string;
      endLine: string;
      next: { title: string; thumbSrc: string | null } | null;
    },
  ) => Promise<void>;
  /**
   * Has the free local vision model look at the shots of these windows that it has not seen yet (src/vodindex/build.ts
   * describeVodShots), and returns the index with what it saw: menus, maps and loading screens are then known, and the
   * writer has the pictures as material. Absent, or the model away: the ranking goes ahead on what is known.
   */
  look?: (v: VodIndex, windows: Array<{ from: number; to: number }>) => Promise<VodIndex>;
  /** Measures the finished file (src/streamweekly/render.ts checkWeekRender); its problems stop an upload. */
  check?: (file: string, tl: Timeline) => Promise<WeekCheck>;
  spoiler: {
    open: boolean;
    check?: (
      text: string,
      m: { start: number; end: number },
    ) => string | undefined;
  };
  days?: DayLink[];
  playlistId?: string;
  now: Date;
  clarity?: boolean;
  /** Keep the script already written in outDir when it still fits the plan (a re-run after a failed render). */
  reuseScript?: boolean;
}

export interface CompileResult {
  status: "rendered" | "planned" | "skipped";
  why?: string[];
  ranked: WeekMoment[];
  plan: WeekPlan;
  script?: WeekScript;
  timeline?: Timeline;
  pkg?: WeekPackage;
  video?: string;
  check?: WeekCheck;
}

const write = (dir: string, name: string, v: unknown) =>
  fs.writeFile(
    path.join(dir, name),
    typeof v === "string" ? v : JSON.stringify(v, null, 1),
  );

/** The whole week, step by step; each step's output is written to outDir as it is made. */
export async function compileWeek(c: CompileInput): Promise<CompileResult> {
  await fs.mkdir(c.outDir, { recursive: true });
  if (c.look) {
    const first = rankWeek(c.streams, { spoilerWindowOpen: c.spoiler.open, storyCheck: c.spoiler.check });
    for (const w of c.streams) {
      // The best windows of each stream and the 40 s before them (their lead-ins).
      const windows = first
        .filter((m) => m.vodId === w.index.vodId && !m.blocked)
        .slice(0, 24)
        .map((m) => ({ from: Math.max(0, m.start - 40), to: m.end }));
      if (windows.length) w.index = await c.look(w.index, windows).catch(() => w.index);
    }
  }
  // Cinema bars are measured only for the moments that could make the cut, and only while the window is open.
  let ranked = rankWeek(c.streams, {
    spoilerWindowOpen: c.spoiler.open,
    storyCheck: c.spoiler.check,
  });
  if (c.spoiler.open) {
    for (const m of ranked.filter((x) => !x.blocked).slice(0, 40)) {
      const w = c.streams.find((s) => s.index.vodId === m.vodId)!;
      (w.letterbox ??= {})[`${Math.round(m.start)}-${Math.round(m.end)}`] =
        await barsShare(m.file, m.start, m.end);
    }
    ranked = rankWeek(c.streams, {
      spoilerWindowOpen: true,
      storyCheck: c.spoiler.check,
    });
  }
  await write(c.outDir, "ranking.json", ranked);
  const plan = planWeek(ranked, {
    game: c.game,
    week: c.week,
    start: c.start,
    minSeconds: c.minSeconds,
    maxSeconds: c.maxSeconds,
  });
  await write(c.outDir, "plan.json", plan);
  const why = planProblems(plan, {
    minSeconds: c.minSeconds,
    maxSeconds: c.maxSeconds,
    minMoments: c.minMoments,
  });
  if (why.length) {
    await write(
      c.outDir,
      "report.md",
      report(c, ranked, plan, undefined, undefined, undefined, why),
    );
    return { status: "skipped", why, ranked, plan };
  }
  const kept = c.reuseScript ? await keptScript(c.outDir, plan, c.now) : undefined;
  const script = kept ?? (await writeWeek(plan, c.llm, { now: c.now, clarity: c.clarity }));
  await write(c.outDir, "script.json", script);
  const voices = new Map<string, Voice>();
  for (const [key, text] of Object.entries(scriptLines(script))) {
    const rel = path.join("voice", `${key}.mp3`);
    await fs.mkdir(path.join(c.outDir, "voice"), { recursive: true });
    voices.set(key, { ...(await voiceOnce(c, key, text, path.join(c.outDir, rel))), file: rel });
  }
  const durations = new Map(
    c.streams.map((s) => [s.index.file, s.index.duration]),
  );
  let timeline = buildTimeline(plan, script, voices, {
    duration: (f) => durations.get(f) ?? 0,
  });
  const audit = auditTimeline(timeline, script, plan);
  timeline = fixLabels(timeline, audit);
  await write(c.outDir, "timeline.json", timeline);
  await write(c.outDir, "graphics-audit.json", {
    stats: audit.stats,
    findings: audit.findings,
  });
  const pkg = weekPackage(plan, script, timeline, {
    days: c.days,
    playlistId: c.playlistId,
  });
  await write(c.outDir, "package.json", pkg);
  let video: string | undefined;
  let check: WeekCheck | undefined;
  if (c.render) {
    video = path.join(
      c.outDir,
      `${shortGameName(c.game).replace(/\s+/g, "")}_week${c.week}.mp4`,
    );
    await c.render(timeline, {
      file: video,
      poster: path.join(c.outDir, "poster.jpg"),
      episodeDir: c.outDir,
      endLine: "Every day of the week has its own Short",
      next: { title: GTA_DAILY_PLAYLIST, thumbSrc: null },
    });
    if (c.check) {
      check = await c.check(video, timeline);
      await write(c.outDir, "render-check.json", check);
    }
  }
  await write(
    c.outDir,
    "report.md",
    report(c, ranked, plan, script, timeline, pkg, [], audit.findings.length),
  );
  return {
    status: video ? "rendered" : "planned",
    ranked,
    plan,
    script,
    timeline,
    pkg,
    ...(video ? { video } : {}),
    ...(check ? { check } : {}),
  };
}

/** The script already in outDir, when it covers exactly this plan's moments and still passes the house checks. */
async function keptScript(dir: string, plan: WeekPlan, now: Date): Promise<WeekScript | undefined> {
  try {
    const s = JSON.parse(await fs.readFile(path.join(dir, "script.json"), "utf8")) as WeekScript;
    if (s.planKey !== planKey(plan)) return undefined;
    const fixed = withSignOff(s);
    return scriptProblems(fixed, plan, now).length ? undefined : fixed;
  } catch {
    return undefined;
  }
}

/**
 * A line voiced once: the take, its text and its length are kept beside each other, so a re-run of the same week
 * (after a render failure, say) never pays for the same words twice.
 */
async function voiceOnce(c: Pick<CompileInput, "voice">, key: string, text: string, file: string): Promise<Voice> {
  const meta = `${file}.json`;
  try {
    const kept = JSON.parse(await fs.readFile(meta, "utf8")) as Voice;
    if (kept.text === text && (await fs.stat(file)).size > 0) return kept;
  } catch {
    /* voiced below */
  }
  const v = await c.voice(key, text, file);
  await fs.writeFile(meta, JSON.stringify(v));
  return v;
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The plain-English report written beside the video (pure). */
export function report(
  c: Pick<CompileInput, "game" | "week">,
  ranked: WeekMoment[],
  plan: WeekPlan,
  script?: WeekScript,
  tl?: Timeline,
  pkg?: WeekPackage,
  why: string[] = [],
  gfxFindings = 0,
): string {
  const lines = [`# ${shortGameName(c.game)} Week ${c.week}`, ""];
  if (why.length) lines.push("Skipped:", ...why.map((w) => `- ${w}`), "");
  lines.push(
    `## Moment ranking (top 25 of ${ranked.length})`,
    "",
    "| # | stream | at | len | kind | score | why |",
    "|---|---|---|---|---|---|---|",
  );
  ranked
    .slice(0, 25)
    .forEach((m, i) =>
      lines.push(
        `| ${i + 1} | ${m.recordedOn || m.vodId} | ${mmss(m.start)} | ${Math.round(m.end - m.start)} s | ${m.kind} | ${m.score} | ${m.blocked ? `BLOCKED: ${m.blocked}` : m.why.join("; ")} |`,
      ),
    );
  lines.push("", "## Chapter plan", "");
  const order = playOrder(plan);
  for (const ch of plan.chapters) {
    lines.push(`### ${ch.title}`);
    for (const m of ch.moments) {
      const key = order.find((x) => x.m === m)?.key ?? "";
      const s = script?.moments.find((x) => x.key === key);
      lines.push(
        `- ${key} ${m.recordedOn} ${mmss(m.start)}-${mmss(m.end)} (${m.kind}, ${m.score})${s ? `: "${s.label}". Setup: ${s.setup}` : ""}`,
      );
    }
    lines.push("");
  }
  if (script)
    lines.push(
      "## Narration",
      "",
      `By: ${script.by}`,
      `Intro: ${script.intro}`,
      `Outro: ${script.outro}`,
      `Clarity: ${JSON.stringify(script.clarity ?? "not judged")}`,
      "",
    );
  if (tl)
    lines.push(
      "## Cut",
      "",
      `Length ${mmss(tl.seconds)}, ${tl.clips.length} clips, ${tl.labels.length} labels, ${tl.cards.length} chapter cards, graphics findings ${gfxFindings}`,
      "",
    );
  if (pkg)
    lines.push(
      "## Package",
      "",
      `Title: ${pkg.title}`,
      "",
      "```",
      pkg.description,
      "```",
      "",
      `Pinned comment: ${pkg.pinnedComment}`,
      "",
    );
  return lines.join("\n");
}

/** The free local vision model on the shots inside the windows that have not been looked at yet (see CompileInput.look). */
export async function describeWindows(
  dataDir: string,
  v: VodIndex,
  windows: Array<{ from: number; to: number }>,
  o: { batch?: number; describe?: typeof describeVodShots; up?: () => Promise<boolean> } = {},
): Promise<VodIndex> {
  if (!(await (o.up ?? visionUp)())) return v;
  const inside = (s: { start: number; end: number }) => windows.some((w) => s.end > w.from && s.start < w.to);
  const subset: VodIndex = { ...v, shots: v.shots.filter(inside) };
  const r = await (o.describe ?? describeVodShots)(subset, { dataDir, whisperPython: "", ocrFps: 0, chunkSeconds: 0, describeBatch: o.batch ?? 400 }, o.batch ?? 400);
  return (await loadVodIndex(dataDir, v.vodId)) ?? r.index;
}

/** A recording's index only when it covers the whole recording (the miner builds it; descriptions are optional). */
export async function readyIndex(
  dataDir: string,
  vodId: string,
): Promise<VodIndex | undefined> {
  const v = await loadVodIndex(dataDir, vodId);
  if (!v) return undefined;
  const covered = v.coverage.reduce((n, x) => n + (x.to - x.from), 0);
  return covered >= v.duration - 60 ? v : undefined;
}

