// The footage pre-screen by hand (FOOTAGE_SCREEN_CACHE): every 1.5 s keyframe of a source video goes through the local
// vision screen (src/assets/localvision.ts, the same questions the matcher asks, including FOOTAGE_AD_SCREEN's
// suggestive one) and the verdicts land in the screen cache (src/assets/screencache.ts), keyed by the video and the
// time. Every later Short that cuts from the video reuses them, even while the PC vision relay is down. Free: the local
// model only, never the paid API.
//
//   npx tsx src/tools/prescreen.ts [videoId|url ...]      download each (yt-dlp, 1080p) and screen it
//   npx tsx src/tools/prescreen.ts --file <mp4> --url <youtube url>   screen a file already on disk under that video
//   (no ids: the GTA VI official trailers)
//
// On the PC run it through the orchestrator (gpu, p20, with --est), for example:
//   C:\Claude\orchestrator\orch.cmd run --class gpu --project pulse --job "GTA VI trailer pre-screen" --priority 20 --est 25 -- npx tsx src/tools/prescreen.ts
// The cache file (DATA_DIR/screen_cache.json, or SCREEN_CACHE_FILE) can be copied to the Mac as it is.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyseTrailer } from "../assets/clipscore.ts";
import { downloadTrailer } from "../assets/officialTrailer.ts";
import { screenFrames } from "../assets/localvision.ts";
import {
  cacheFile,
  cachedVerdicts,
  frameKey,
  sourceKey,
} from "../assets/screencache.ts";

/** Rockstar Games' GTA VI trailers (Trailer 1, 5 Dec 2023; Trailer 2, 6 May 2025). */
export const GTA6_TRAILERS = ["QdBZY2fkU-0", "VQRLujxTm3c"];

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ids = argv.filter(
  (a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"),
);

async function screenOne(file: string, url: string): Promise<void> {
  const src = sourceKey(url)!;
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "prescreen-"));
  try {
    const kf = await analyseTrailer(file, 0, work, 0);
    const keys = kf.map((c) => frameKey(src, c.time));
    const before = cachedVerdicts(keys).filter(Boolean).length;
    const flags = await screenFrames(
      kf.map((c) => c.frame),
      2,
      keys,
    );
    const at = (pred: (i: number) => boolean) =>
      kf.filter((_, i) => pred(i)).map((c) => c.time.toFixed(1));
    console.log(
      JSON.stringify({
        source: src,
        keyframes: kf.length,
        alreadyCached: before,
        judged: flags.filter(Boolean).length,
        suggestive: at((i) => Boolean(flags[i]?.suggestive)),
        gore: at((i) => Boolean(flags[i]?.gore)),
        text: at((i) => Boolean(flags[i]?.text)).length,
        dark: at((i) => Boolean(flags[i]?.dark)).length,
      }),
    );
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const file = arg("file");
  if (file) {
    const url = arg("url");
    if (!url)
      throw new Error(
        "--file needs --url, the video it came from (the cache key)",
      );
    await screenOne(path.resolve(file), url);
  } else {
    const list = ids.length ? ids : GTA6_TRAILERS;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prescreen-dl-"));
    try {
      for (const id of list) {
        const url = /^https?:/.test(id)
          ? id
          : `https://www.youtube.com/watch?v=${id}`;
        const dest = path.join(
          dir,
          `${sourceKey(url)!.replace(/[^\w-]/g, "_")}.mp4`,
        );
        try {
          await downloadTrailer(id, dest, process.env.YTDLP ?? "yt-dlp");
        } catch (err) {
          console.log(
            JSON.stringify({
              source: sourceKey(url),
              error: String((err as Error).message)
                .split("\n")
                .slice(-2)
                .join(" ")
                .slice(0, 300),
            }),
          );
          continue;
        }
        await screenOne(dest, url);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  console.log(JSON.stringify({ cache: cacheFile() }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
