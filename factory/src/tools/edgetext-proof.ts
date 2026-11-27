// Proof for SHORT_CLIP_EDGE_TEXT (20 Nov 2026): runs the Short clip text screen twice on real footage, once as before
// (big lettering only) and once with the edge check, and says which clips the new check trims or drops.
// Usage: node --import tsx src/tools/edgetext-proof.ts <episodeDir | video.mp4>... [--every 6] [--len 3]
//   an episode directory: its footage clips (assets/*.mp4); a video: 3 s segments cut every 6 s, as a library would.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clipBigText } from "../assets/cliptext.ts";
import { videoSeconds } from "../assets/clipscore.ts";
import { runCapped } from "../lib/child.ts";
import { FFMPEG } from "../lib/bin.ts";

const MIN_RUN = 1.6; // clipscore.ts MIN_CLIP_SECONDS

const workDirs: string[] = [];

async function segments(
  video: string,
  every: number,
  len: number,
): Promise<string[]> {
  const total = (await videoSeconds(video).catch(() => undefined)) ?? 0;
  // Footage scratch: EDGEPROOF_WORK (on the PC, a folder under D:\pulse-data\scratch), else the system temp; removed at exit.
  const dir = await fs.mkdtemp(
    path.join(process.env.EDGEPROOF_WORK || os.tmpdir(), "edgeproof-"),
  );
  workDirs.push(dir);
  const out: string[] = [];
  for (let at = 1; at + len < total; at += every) {
    const file = path.join(dir, `${path.basename(video, ".mp4")}_${at}.mp4`);
    await runCapped(FFMPEG, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(at),
      "-i",
      video,
      "-t",
      String(len),
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      file,
    ]);
    out.push(file);
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opt = (name: string, d: number) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args.splice(i, 2)[1]) : d;
  };
  const every = opt("--every", 6);
  const len = opt("--len", 3);
  let clips = 0;
  let before = 0;
  let after = 0;
  let trimmed = 0;
  let dropped = 0;
  let secBefore = 0;
  let secAfter = 0;
  for (const arg of args) {
    const files = arg.endsWith(".mp4")
      ? await segments(arg, every, len)
      : (await fs.readdir(path.join(arg, "assets")).catch(() => [] as string[]))
          .filter((f) => f.endsWith(".mp4") && !f.includes("_opening"))
          .map((f) => path.join(arg, "assets", f));
    for (const file of files.sort()) {
      const seconds = (await videoSeconds(file).catch(() => undefined)) ?? 0;
      if (seconds <= 0) continue;
      clips++;
      const a = await clipBigText(file, seconds, { edge: false });
      const b = await clipBigText(file, seconds, { edge: true });
      const keptA = a.clean
        ? seconds
        : a.run.length >= MIN_RUN
          ? a.run.length
          : 0;
      const keptB = b.clean
        ? seconds
        : b.run.length >= MIN_RUN
          ? b.run.length
          : 0;
      if (!a.clean) before++;
      if (!b.clean) after++;
      secBefore += keptA;
      secAfter += keptB;
      if (keptB < keptA) {
        if (keptB === 0) dropped++;
        else trimmed++;
        const extra = b.words.filter((w) => !a.words.includes(w));
        console.log(
          `${path.basename(file)}: ${keptB === 0 ? "dropped" : `trimmed to ${keptB.toFixed(1)} s`} (was ${keptA.toFixed(1)} s), edge words [${extra.slice(0, 8).join(" | ")}]`,
        );
      }
    }
  }
  console.log(
    `clips ${clips}; faulted before ${before}, after ${after}; newly trimmed ${trimmed}, newly dropped ${dropped}; usable seconds ${secBefore.toFixed(0)} -> ${secAfter.toFixed(0)}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const d of workDirs)
      await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
  });
