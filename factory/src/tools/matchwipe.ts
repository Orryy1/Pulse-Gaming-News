// MATCH_WIPE proof and tool: finds the moments two games' footage libraries share (src/gpuvis/framematch.ts) and
// renders them as one wipe comparison (src/render/MatchWipe.tsx). Changes nothing anywhere.
//
//   node --import tsx src/tools/matchwipe.ts <library A dir> <library B dir> <out dir> --a "GTA V · 2013" --b "GTA VI · 2026" [--pairs 3] [--tall]
//
// Uses the PC's vision model (Ollama) and Remotion, so run it through the orchestrator:
//   C:\Claude\orchestrator\orch.cmd run --class heavy --project pulse --job "match wipe" --priority 20 --est 15 -- node --import tsx src/tools/matchwipe.ts ...

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import {
  judgeMatches,
  libraryScenes,
  pairSeconds,
  shortlist,
  usable,
  type Match,
} from "../gpuvis/framematch.ts";
import { stack } from "../gpuvis/sheet.ts";
import { askVision } from "../gpuvis/vision.ts";

const run = promisify(execFile);
const ff = (args: string[]) =>
  run(FFMPEG, ["-v", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });

const flag = (name: string, fallback?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};


async function cut(
  scene: Match["a"],
  seconds: number,
  dest: string,
  tall: boolean,
): Promise<void> {
  const len = scene.end - scene.at;
  const slow = len < seconds ? seconds / len : 1;
  const [w, h] = tall ? [1080, 1920] : [1920, 1080];
  await ff([
    "-ss",
    scene.at.toFixed(2),
    "-t",
    Math.min(len, seconds).toFixed(2),
    "-i",
    scene.file,
    "-an",
    "-vf",
    `setpts=${slow.toFixed(4)}*PTS,fps=30,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`,
    "-c:v",
    "libx264",
    "-crf",
    "16",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    dest,
  ]);
}

async function main(): Promise<void> {
  const [libA, libB, outDir] = process.argv.slice(2);
  if (!libA || !libB || !outDir)
    throw new Error(
      "usage: matchwipe.ts <library A> <library B> <out dir> --a NAME --b NAME [--pairs 3] [--tall]",
    );
  const out = path.resolve(outDir);
  const clips = path.join(out, "clips");
  await fs.mkdir(clips, { recursive: true });
  const tall = process.argv.includes("--tall");
  const want = Number(flag("pairs", "3"));
  const started = Date.now();
  const A = (await libraryScenes(libA)).filter((s) => usable(s, 1.9));
  const B = (await libraryScenes(libB)).filter((s) => usable(s, 1.9));
  const short = shortlist(A, B, 14);
  const t1 = Date.now();
  const judged = await judgeMatches(
    short,
    askVision,
    path.join(out, "frames"),
    8,
  );
  const t2 = Date.now();
  const picked = judged.filter((m) => (m.place ?? 0) >= 6).slice(0, want);
  if (!picked.length) throw new Error("no pair scored 6 or more on place");
  const seconds = Math.min(...picked.map(pairSeconds));
  const pairs: Array<{
    aFile: string;
    aFrom: number;
    bFile: string;
    bFrom: number;
    label: string;
  }> = [];
  for (const [i, m] of picked.entries()) {
    await cut(m.a, seconds, path.join(clips, `p${i}_a.mp4`), tall);
    await cut(m.b, seconds, path.join(clips, `p${i}_b.mp4`), tall);
    pairs.push({
      aFile: `p${i}_a.mp4`,
      aFrom: 0,
      bFile: `p${i}_b.mp4`,
      bFrom: 0,
      label: m.label || "Same place",
    });
  }
  // The pairs' middle frames side by side, for review.
  const sheets: string[] = [];
  for (const m of picked)
    sheets.push(path.join(out, "frames", `m${short.indexOf(m)}_pair.jpg`));
  await ff([
    ...sheets.flatMap((s) => ["-i", s]),
    "-filter_complex",
    stack(sheets.length, "v"),
    "-frames:v",
    "1",
    "-q:v",
    "3",
    path.join(out, "pairs.jpg"),
  ]);
  const { renderMatchWipe } = await import("../render/render.ts");
  const file = path.join(out, tall ? "matchwipe_tall.mp4" : "matchwipe.mp4");
  await renderMatchWipe({
    clipDir: clips,
    outFile: file,
    aName: flag("a", "Game A")!,
    bName: flag("b", "Game B")!,
    pairs,
    secondsPerPair: seconds,
    tall,
  });
  const t3 = Date.now();
  const report = {
    shortlist: short.length,
    judged: judged.map((m) => ({
      a: `${path.basename(m.a.file)}@${m.a.at}`,
      aSeen: m.a.seen,
      b: `${path.basename(m.b.file)}@${m.b.at}`,
      bSeen: m.b.seen,
      notes: m.notes,
      frames: m.frames,
      place: m.place,
      framing: m.framing,
      label: m.label,
      score: m.score,
    })),
    picked: picked.map((m) => m.label),
    secondsPerPair: seconds,
    timings: {
      shortlistSeconds: (t1 - started) / 1000,
      visionSeconds: (t2 - t1) / 1000,
      renderSeconds: (t3 - t2) / 1000,
    },
    file,
  };
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 1),
  );
  console.log(
    JSON.stringify({ picked: report.picked, timings: report.timings, file }),
  );
}

await main();
