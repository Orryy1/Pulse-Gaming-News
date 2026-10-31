// The real outside calls behind the footage-first gather (src/assets/footagefirst.ts): yt-dlp for the search
// page, the licence and the download (no YouTube API quota), ffmpeg for the scene scan, frames and cuts, the
// local vision model for the looks, and a GPU turn from the PC orchestrator around them. Kept apart from the
// pass so its flow is tested with fakes and these stay thin.

import path from "node:path";
import fs from "node:fs/promises";
import { runCapped } from "../lib/child.ts";
import { FFMPEG, YTDLP_TEXT } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import {
  parseSignalStats,
  darkestLuma,
  DARK_LUMA,
  videoSeconds,
} from "./clipscore.ts";
import { lookFrames } from "./localvision.ts";
import type { Llm } from "../editorial/llm.ts";
import { judgeGameplay } from "./gameplay.ts";
import { dHash, type FootageFirstDeps, type SourceHit } from "./footagefirst.ts";
import { readText } from "./ocr.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** A child whose stdout is bytes (the hash thumbnail), not text. */
const runRaw = (cmd: string, args: string[]) =>
  promisify(execFile)(cmd, args, { encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 30_000 }) as Promise<{ stdout: Buffer; stderr: Buffer }>;

const run = runCapped;

/** YouTube's search-page filter for Creative Commons videos. */
const CC_FILTER = "&sp=EgIwAQ%253D%253D";

/** Rows of `id \t channel \t title` from yt-dlp's flat listing of a search page. */
export function parseSearchRows(stdout: string): SourceHit[] {
  return String(stdout)
    .split(/\r?\n/)
    .map((l) => l.split("\t"))
    .filter((r) => r.length >= 3 && /^[\w-]{11}$/.test(r[0]!))
    .map(([videoId, channel, ...title]) => ({
      videoId: videoId!,
      channel: channel === "NA" ? "" : channel!,
      title: title.join("\t"),
    }));
}

/** A GPU turn from the PC orchestrator for the looks, at Pulse's priority; none when it is not installed. */
export function orchVisionLease(): (
  job: string,
  est: number,
) => Promise<() => void> {
  return async (job, est) => {
    try {
      const orch: any = await import(
        process.env.ORCH_CLIENT || "file:///C:/Claude/orchestrator/orch.mjs"
      );
      return (await orch.lease("gpu", {
        job,
        project: "pulse",
        priority: 60,
        kind: "pulse:vision",
        est,
        vram: 10,
        ram: 8,
        maxWait: 60,
        onWait: (why: string) =>
          log("info", "footage-first looks waiting for the GPU", { why }),
      })) as () => void;
    } catch (err) {
      log("info", "no orchestrator turn for the footage looks; going ahead", {
        error: errorMessage(err),
      });
      return () => undefined;
    }
  };
}

export function footageFirstDeps(o: {
  ytdlp: string;
  llm?: Llm;
  lease?: boolean;
}): FootageFirstDeps {
  const ytdlp = o.ytdlp || "yt-dlp";
  return {
    search: async (q) => {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}${CC_FILTER}`;
      const { stdout } = await run(
        ytdlp,
        [
          ...YTDLP_TEXT.args,
          "--no-warnings",
          "--flat-playlist",
          "--playlist-end",
          "20",
          "--print",
          "%(id)s\t%(channel)s\t%(title)s",
          url,
        ],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: YTDLP_TEXT.env },
      );
      return parseSearchRows(stdout);
    },
    details: async (id) => {
      const { stdout } = await run(
        ytdlp,
        [
          ...YTDLP_TEXT.args,
          "--no-warnings",
          "--skip-download",
          "--print",
          "%(license)s\t%(duration)s\t%(channel)s\t%(title)s",
          `https://www.youtube.com/watch?v=${id}`,
        ],
        { timeout: 60_000, maxBuffer: 1024 * 1024, env: YTDLP_TEXT.env },
      );
      const [license, seconds, channel, ...title] = String(stdout)
        .trim()
        .split("\t");
      if (!seconds) return undefined;
      return {
        license: license === "NA" ? "" : (license ?? ""),
        seconds: Number(seconds) || 0,
        channel: channel ?? "",
        title: title.join("\t"),
      };
    },
    judge: o.llm
      ? (game, year, items) =>
          judgeGameplay(
            o.llm!,
            game,
            year,
            items.map((i) => ({
              title: i.title,
              description: "",
              channelTitle: i.channel,
            })),
          )
      : undefined,
    download: async (url, from, to, dest) => {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await run(
        ytdlp,
        [
          "--no-playlist",
          "--no-warnings",
          "-f",
          "bv*[height<=720][ext=mp4][vcodec^=avc1]/bv*[height<=720][ext=mp4]/b[height<=720][ext=mp4]",
          "--download-sections",
          `*${from}-${to}`,
          "-o",
          dest,
          url,
        ],
        { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
      );
      return (await fs.stat(dest)).size;
    },
    scan: async (file) => {
      const dir = path.dirname(file);
      const stats = `${path.basename(file)}.scenes.txt`;
      // Bare names from inside the folder: a drive letter's colon would split the filter's options.
      await run(
        FFMPEG,
        [
          "-v",
          "error",
          "-y",
          "-i",
          path.basename(file),
          "-vf",
          `fps=10,scale=320:-2,select='gte(scene,0)',signalstats,metadata=print:file=${stats}`,
          "-an",
          "-f",
          "null",
          "-",
        ],
        { cwd: dir, maxBuffer: 32 * 1024 * 1024, timeout: 300_000 },
      );
      const rows = parseSignalStats(
        await fs.readFile(path.join(dir, stats), "utf8"),
      );
      await fs.rm(path.join(dir, stats), { force: true });
      return rows;
    },
    frames: async (file, at, seconds, prefix) => {
      // One pass for the whole segment: about a frame a second, a little in from each end, at least three.
      const n = Math.max(3, Math.min(7, Math.round(seconds)));
      const fps = n / Math.max(0.5, seconds - 0.2);
      await run(FFMPEG, [
        "-v", "error", "-y", "-ss", (at + 0.1).toFixed(2), "-i", file, "-t", (seconds - 0.2).toFixed(2),
        "-vf", `fps=${fps.toFixed(4)},scale=640:-2`, "-frames:v", String(n), "-q:v", "4", `${prefix}_%02d.jpg`,
      ]);
      const out: string[] = [];
      for (let k = 1; k <= n; k++) {
        const f = `${prefix}_${String(k).padStart(2, "0")}.jpg`;
        if (await fs.stat(f).then(() => true, () => false)) out.push(f);
      }
      return out;
    },
    compose: async (files, dest) => {
      const inputs = files.flatMap((f) => ["-i", f]);
      const scaled = files.map((_, i) => `[${i}:v]scale=512:288,setsar=1[v${i}]`).join(";");
      await run(FFMPEG, [
        "-v", "error", "-y", ...inputs,
        "-filter_complex", `${scaled};${files.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${files.length}`,
        "-frames:v", "1", "-q:v", "4", dest,
      ]);
    },
    hash: async (file) => {
      const { stdout } = await runRaw(FFMPEG, ["-v", "error", "-i", file, "-vf", "scale=9:8,format=gray", "-f", "rawvideo", "-"]);
      return stdout.length >= 72 ? dHash(new Uint8Array(stdout.subarray(0, 72))) : undefined;
    },
    ocr: (files) => readText(files),
    look: (files) => lookFrames(files),
    cut: async (file, at, seconds, dest) => {
      await run(FFMPEG, [
        "-v",
        "error",
        "-y",
        "-ss",
        at.toFixed(3),
        "-i",
        file,
        "-t",
        seconds.toFixed(3),
        "-an",
        "-vf",
        "scale=-2:1080,fps=30",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        dest,
      ]);
      // A segment that sinks into darkness reads as a broken video.
      const dark = await darkestLuma(dest);
      if (dark !== undefined && dark < DARK_LUMA) {
        await fs.rm(dest, { force: true });
        return undefined;
      }
      const real = await videoSeconds(dest);
      return real === undefined
        ? seconds
        : Math.min(seconds, Math.max(0, real - 0.05));
    },
    lease: o.lease === false ? undefined : orchVisionLease(),
  };
}
