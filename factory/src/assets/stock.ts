// Licensed stock footage for the real-world part of a story (Pexels: free for
// commercial use, no attribution required, credited anyway). Only used for
// stories whose point is something in the real world, never in place of game
// footage, and always tagged on screen as illustrative.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import type { VisualAsset } from "./steam.ts";
import type { FootageTarget } from "./clipscore.ts";
import { freeName, samePath } from "./repeats.ts";

const run = promisify(execFile);
const API = "https://api.pexels.com/videos/search";
export const STOCK_CLIP_SECONDS = 4;

export interface PexelsFile {
  link: string;
  width: number;
  height: number;
  quality?: string;
  file_type?: string;
}

export interface PexelsVideo {
  id: number;
  url: string;
  duration: number;
  user?: { name?: string };
  video_files: PexelsFile[];
  /** The video's preview picture. */
  image?: string;
}

/**
 * Looks at the preview pictures of a line's stock results and says which one shows what the line is about,
 * or none: the first search result used to go on screen unseen (29 Oct 2026 review: a woman on a phone for
 * a game's budget, PS4 pads for the PS3 era).
 */
export type StockPicker = (
  target: FootageTarget,
  previews: string[],
) => Promise<number | undefined>;

/** The smallest MP4 that is still at least 1080 px on its long side (or the largest there is). */
export function pickFile(v: PexelsVideo): PexelsFile | undefined {
  const mp4 = v.video_files.filter(
    (f) => (f.file_type ?? "video/mp4") === "video/mp4" && f.link,
  );
  const long = (f: PexelsFile) => Math.max(f.width, f.height);
  const big = mp4
    .filter((f) => long(f) >= 1080)
    .sort((a, b) => long(a) - long(b));
  return big[0] ?? mp4.sort((a, b) => long(b) - long(a))[0];
}

/** A stock search for a line: its keywords minus game words (stock has no games), at most four words. */
export function stockQuery(target: FootageTarget, gameWords: string[]): string {
  const skip = new Set(gameWords.map((w) => w.toLowerCase()));
  const words = target.keywords
    .join(" ")
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9'-]/g, ""))
    .filter((w) => w.length > 1 && !skip.has(w.toLowerCase()));
  return [...new Set(words)].slice(0, 4).join(" ");
}

export async function searchPexels(
  apiKey: string,
  query: string,
  perPage = 6,
): Promise<PexelsVideo[]> {
  const url = `${API}?query=${encodeURIComponent(query)}&per_page=${perPage}&size=medium`;
  const res = await fetchWithTimeout(
    url,
    { headers: { authorization: apiKey } },
    20_000,
  );
  if (!res.ok) throw new Error(`pexels HTTP ${res.status}`);
  return (
    ((await res.json()) as { videos?: PexelsVideo[] }).videos ?? []
  ).filter((v) => v.duration >= STOCK_CLIP_SECONDS + 1);
}

/**
 * One illustrative clip per real-world line, tagged with its beat. Each video
 * is used once; a line with no match gets nothing (the planner falls back).
 * A Pexels video already in the episode (`avoidUrls`, its page URLs) is never
 * picked again, and each clip is written under a name no file in the folder
 * has: a re-run used to restart at stock_0.mp4 and overwrite the clips an
 * earlier run had placed (31 Oct 2026, Vice City documentary).
 */
export async function stockClips(
  apiKey: string,
  episodeDir: string,
  targets: FootageTarget[],
  gameWords: string[],
  maxClips = 4,
  pick?: StockPicker,
  avoidUrls: Iterable<string> = [],
): Promise<VisualAsset[]> {
  const out: VisualAsset[] = [];
  const used = new Set<number>();
  const avoid = new Set(avoidUrls);
  const work = path.join(episodeDir, "stock");
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(path.join(episodeDir, "assets"), { recursive: true });
  const taken = new Set(
    (await fs.readdir(path.join(episodeDir, "assets")).catch(() => [])).map(
      (n) => samePath(n),
    ),
  );
  try {
    for (const t of targets) {
      if (out.length >= maxClips) break;
      const q = stockQuery(t, gameWords);
      if (!q) continue;
      try {
        const videos = (await searchPexels(apiKey, q)).filter(
          (x) => !used.has(x.id) && !avoid.has(x.url),
        );
        let v = videos[0];
        if (pick) {
          // Only a result whose preview shows the line goes on screen; with none, the line keeps its picture.
          const shown: PexelsVideo[] = [];
          const previews: string[] = [];
          for (const x of videos.filter((x) => x.image).slice(0, 6)) {
            const f = path.join(work, `preview_${x.id}.jpg`);
            const r = await fetchWithTimeout(x.image!, {}, 20_000).catch(
              () => undefined,
            );
            if (!r?.ok) continue;
            await fs.writeFile(f, Buffer.from(await r.arrayBuffer()));
            shown.push(x);
            previews.push(f);
          }
          const i = previews.length ? await pick(t, previews) : undefined;
          v = i === undefined ? undefined : shown[i];
          if (!v) {
            log("info", "stock refused: no preview shows the line", {
              query: q,
              line: t.text.slice(0, 120),
            });
            continue;
          }
        }
        const file = v && pickFile(v);
        if (!v || !file) continue;
        used.add(v.id);
        const raw = path.join(work, `stock_${v.id}.mp4`);
        const res = await fetchWithTimeout(file.link, {}, 60_000);
        if (!res.ok) continue;
        await fs.writeFile(raw, Buffer.from(await res.arrayBuffer()));
        const at = Math.max(
          0,
          Math.min(v.duration - STOCK_CLIP_SECONDS - 0.5, v.duration * 0.25),
        );
        const name = freeName(`stock-${v.id}`, ".mp4", taken);
        taken.add(samePath(name));
        const rel = path.join("assets", name);
        await run(FFMPEG, [
          "-loglevel",
          "error",
          "-y",
          "-ss",
          at.toFixed(2),
          "-i",
          raw,
          "-t",
          String(STOCK_CLIP_SECONDS),
          "-an",
          "-vf",
          "scale=-2:1080,fps=30",
          "-c:v",
          "libx264",
          "-crf",
          "18",
          "-preset",
          "fast",
          "-pix_fmt",
          "yuv420p",
          path.join(episodeDir, rel),
        ]);
        const beatIndex = t.key.startsWith("beat:")
          ? Number.parseInt(t.key.slice(5), 10)
          : undefined;
        // "beat:3#m7": a documentary chapter's sentence 7 (its shot list asked for this B-roll).
        const sentence = t.key.match(/#m(\d+)$/)?.[1];
        out.push({
          kind: "clip",
          file: rel,
          sourceUrl: v.url,
          durationSeconds: STOCK_CLIP_SECONDS,
          beatIndex,
          ...(sentence !== undefined ? { moment: Number(sentence) } : {}),
          stock: true,
          label: q,
          reason: `stock: "${q}"`,
          provenance: `Illustrative stock footage from Pexels (${v.url}) by ${v.user?.name ?? "a Pexels contributor"}, free to use under the Pexels licence; chosen for ${t.key}`,
        });
      } catch (err) {
        log("warn", "stock clip failed", {
          query: q,
          error: errorMessage(err),
        });
      }
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
  log("info", "stock clips", { count: out.length, targets: targets.length });
  return out;
}
