// The weekly stream compilation by hand (the same code the STREAM_WEEKLY job runs), for proofs and re-runs:
//   npx tsx src/tools/streamweekly.ts index "<recording>" [--words <whisper words.json>] [--data <dir>] [--game <name>]
//       builds the recording's stream index (cuts, writing on screen, speech). --words takes word timings made
//       elsewhere (the Mac's Whisper: {"words":[{text,start,end}]}), so no GPU is needed here.
//   npx tsx src/tools/streamweekly.ts compile --out <dir> [--data <dir>] [--vod "<recording>"]... [--week N]
//       [--start YYYY-MM-DD] [--game <name>] [--minutes 5-8] [--codex] [--voice] [--render] [--no-clarity]
//       ranks, plans, writes (--codex: through Codex only, never the paid API), voices (--voice: the factory's
//       ElevenLabs settings; otherwise silent placeholders of the estimated length) and renders (--render).
// Run renders through the orchestrator on the PC:
//   C:\Claude\orchestrator\orch.cmd run --class heavy --project pulse --job "weekly proof" --priority 20 --est 30 -- node --import tsx src/tools/streamweekly.ts compile ...

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "../config.ts";
import { FFMPEG } from "../lib/bin.ts";
import { vodIndexStep } from "../vodindex/build.ts";
import { loadVodIndex, parseVodName } from "../vodindex/schema.ts";
import { createCodexLlm, DEFAULT_RUNNER_DIR } from "../editorial/codex.ts";
import type { Llm } from "../editorial/llm.ts";
import { narrate } from "../voice/index.ts";
import {
  compileWeek,
  gatherStream,
  spoilerRule,
} from "../streamweekly/build.ts";
import { checkWeekRender, contactSheet, cutClips, renderWeek } from "../streamweekly/render.ts";
import { GTA_DAILY_PLAYLIST } from "../gtadaily.ts";
import { spoilerWindows } from "../sceneindex/spoilers.ts";
import type { TimedWord } from "../sceneindex/schema.ts";

const run = promisify(execFile);
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flags = (name: string) =>
  args.flatMap((a, i) =>
    a === `--${name}` && args[i + 1] ? [args[i + 1]!] : [],
  );
const has = (name: string) => args.includes(`--${name}`);
const cfg = loadConfig();
const dataDir = path.resolve(flag("data") ?? cfg.dataDir);
const sw = cfg.streamWeekly;

if (cmd === "index") {
  const file = path.resolve(args[1] ?? "");
  const words = flag("words")
    ? ((
        JSON.parse(await fs.readFile(flag("words")!, "utf8")) as {
          words: TimedWord[];
        }
      ).words ?? [])
    : undefined;
  let offset = 0;
  for (let i = 0; i < 50; i++) {
    const r = await vodIndexStep(
      file,
      flag("game") ?? "",
      {
        dataDir,
        whisperPython: words ? "" : cfg.whisperPython,
        ocrFps: cfg.streamAsks.ocrFps,
        chunkSeconds: 4 * 3600,
        describeBatch: 0,
      },
      {
        ...(words
          ? {
              // One stretch covers the recording, so the words need no shifting; kept general for a chunked run.
              hear: async () =>
                words
                  .filter((w) => w.start >= offset)
                  .map((w) => ({
                    ...w,
                    start: w.start - offset,
                    end: (w.end ?? w.start) - offset,
                  })),
            }
          : {}),
        visionUp: async () => false,
      },
    );
    offset = r.index.coverage.reduce((n, c) => Math.max(n, c.to), 0);
    console.log(
      `${r.did}: ${r.index.shots.length} shots, ${r.index.lines.length} lines`,
    );
    if (r.did !== "stretch") break;
  }
  console.log(
    path.join(dataDir, "vodindex", parseVodName(file).vodId, "index.json"),
  );
} else if (cmd === "compile") {
  const out = path.resolve(flag("out") ?? "streamweekly-out");
  const now = new Date();
  const game = flag("game") ?? sw.game;
  const start = flag("start") ?? sw.start;
  const week = Number(flag("week") ?? 1);
  const [lo, hi] = (flag("minutes") ?? `${sw.minMinutes}-${sw.maxMinutes}`)
    .split("-")
    .map(Number) as [number, number];
  const vods = flags("vod");
  const streams = [];
  for (const f of vods) {
    const v = await loadVodIndex(dataDir, parseVodName(f).vodId);
    if (!v) throw new Error(`no stream index for ${f}: run "index" first`);
    streams.push(await gatherStream(v, { dataDir, now }));
  }
  const llm: Llm | undefined = has("codex")
    ? createCodexLlm(
        {
          structured: async () => {
            throw new Error("the paid API is not used by this proof");
          },
        },
        {
          enabled: true,
          sites: ["*"],
          runnerDir: process.env.CODEX_RUNNER_DIR || DEFAULT_RUNNER_DIR,
          python: cfg.codexPython,
        },
      )
    : undefined;
  const voice = has("voice")
    ? async (key: string, text: string, file: string) => {
        const n = await narrate(cfg, text, file);
        return { key, file, seconds: n.durationSeconds, text, words: n.words };
      }
    : async (key: string, text: string, file: string) => {
        // A silent stand-in of the length the line would take at 155 words a minute.
        const seconds = Math.max(1.5, (text.split(/\s+/).length / 155) * 60);
        await run(FFMPEG, [
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=48000:cl=stereo",
          "-t",
          seconds.toFixed(2),
          "-c:a",
          "libmp3lame",
          file,
        ]);
        return { key, file, seconds, text };
      };
  const rule = spoilerRule({
    game,
    start,
    days: cfg.spoilerWindowDays || 28,
    live: spoilerWindows(),
    now,
  });
  const r = await compileWeek({
    game,
    week,
    start,
    streams,
    outDir: out,
    minSeconds: lo * 60,
    maxSeconds: hi * 60,
    minMoments: Number(flag("min-moments") ?? 4),
    llm,
    voice,
    spoiler: rule,
    now,
    clarity: !has("no-clarity"),
    reuseScript: has("reuse"),
    ...(has("render")
      ? {
          check: async (file: string, tl: Parameters<typeof checkWeekRender>[1]) => {
            const c = await checkWeekRender(file, tl);
            await contactSheet(file, path.join(out, "contact.jpg"), 6);
            return c;
          },
          render: async (tl, o) =>
            renderWeek({
              episodeDir: o.episodeDir,
              timeline: tl,
              game,
              outFile: o.file,
              posterFile: o.poster,
              endLine: o.endLine,
              next: o.next,
              concurrency: cfg.remotionConcurrency,
              gl: cfg.remotionGl,
              browserExecutable: cfg.browserExecutable || undefined,
            }),
        }
      : {}),
  });
  console.log(
    JSON.stringify(
      {
        status: r.status,
        why: r.why,
        moments: r.ranked.length,
        chapters: r.plan.chapters.map(
          (c) => `${c.title} (${c.moments.length})`,
        ),
        seconds: r.timeline?.seconds,
        video: r.video,
        by: r.script?.by,
      },
      null,
      1,
    ),
  );
} else if (cmd === "cut" || cmd === "render") {
  // Re-render a compiled week from its timeline.json: "cut" only cuts the clips (so another machine can render them
  // without the recordings), "render" cuts what is missing, renders, measures and makes the contact sheets.
  const out = path.resolve(flag("out") ?? "streamweekly-out");
  const tl = JSON.parse(await fs.readFile(path.join(out, "timeline.json"), "utf8")) as Parameters<typeof checkWeekRender>[1];
  if (cmd === "cut") {
    const files = await cutClips(tl, out);
    console.log(`${files.size} clips cut into ${path.join(out, "clips")}`);
  } else {
    const game = flag("game") ?? sw.game;
    const file = path.join(out, flag("name") ?? "week.mp4");
    await renderWeek({ episodeDir: out, timeline: tl, game, outFile: file, posterFile: path.join(out, "poster.jpg"), endLine: "Every day of the week has its own Short", next: { title: GTA_DAILY_PLAYLIST, thumbSrc: null }, concurrency: cfg.remotionConcurrency, gl: cfg.remotionGl, browserExecutable: cfg.browserExecutable || undefined });
    const check = await checkWeekRender(file, tl);
    await fs.writeFile(path.join(out, "render-check.json"), JSON.stringify(check, null, 1));
    await contactSheet(file, path.join(out, "contact.jpg"), 6);
    console.log(JSON.stringify({ file, check }, null, 1));
  }
} else {
  console.error(
    "usage: streamweekly.ts index <recording> [--words f] | compile --out <dir> --vod <recording> ...",
  );
  process.exit(2);
}
