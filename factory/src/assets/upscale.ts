// AI upscaling of old games' footage and stills (src/assets/upscale.py; owner's perfection programme, 1 Nov 2026).
// A PS1 or PS2 capture is 480 lines or less, and the gather's plain resize to 1080 leaves it soft and blocky on a
// big screen. Real-ESRGAN, run locally (open weights from the authors' GitHub releases), redraws its edges:
//
// - footage: the footage-first gather (src/assets/footagedeps.ts) keeps a native-size copy ("<clip>.sd.mp4") of
//   every segment cut from a source at most UPSCALE_MAX_HEIGHT lines tall; once the gather is done, one run
//   upscales them to 1080 in place of the plain resize, oldest chapters first, up to UPSCALE_MAX_SECONDS of
//   footage a video (the cap that keeps it inside the gather's time), in a GPU turn from the PC orchestrator.
// - stills: before the depth layers, every small wide still (a store header, an old screenshot) is upscaled
//   into assets/up and the episode's picture points at the sharper copy (the original is kept beside it).
//
// Modern HD footage and pictures are never touched. Everything is cached by the file's own hash, so a rebuild
// or a second video with the same picture costs nothing. A failure leaves the plain resize: it never stops a
// video.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { leaseStrict, loadOrch, NoOrchestrator } from "../lib/orch.ts";

const run = promisify(execFile);
const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "upscale.py",
);

/** The native-size copy the gather keeps beside a clip cut from an old, small source. */
export const sdCopy = (clip: string) => clip.replace(/\.mp4$/i, ".sd.mp4");

/** Whether a picture or video this many lines tall is old enough to upscale (never modern HD). */
export const needsUpscale = (height: number | undefined, maxHeight: number) =>
  !!height && height > 0 && maxHeight > 0 && height <= maxHeight;

export interface UpscaleCandidate {
  file: string;
  seconds: number;
  /** The chapter's place (lower is older in a documentary's order) or the game's year, to go oldest first. */
  order: number;
}

/**
 * The clips to upscale within the budget (pure): oldest first, then in the order given, until the next would
 * pass `budgetSeconds` of footage. A clip that would pass it is skipped, not cut short.
 */
export function pickUpscale<T extends UpscaleCandidate>(
  items: readonly T[],
  budgetSeconds: number,
): T[] {
  const out: T[] = [];
  let used = 0;
  const sorted = items
    .map((x, i) => ({ x, i }))
    .sort((a, b) => a.x.order - b.x.order || a.i - b.i);
  for (const { x } of sorted) {
    if (used + x.seconds > budgetSeconds + 1e-6) continue;
    out.push(x);
    used += x.seconds;
  }
  return out;
}

/** A file's cache key: the hash of its bytes, the model and the height it is made for. */
export async function cacheKey(
  file: string,
  model: string,
  height: number,
): Promise<string> {
  const h = createHash("sha1");
  h.update(await fs.readFile(file));
  h.update(`|${model}|${height}`);
  return h.digest("hex");
}

/** A video's frame height read from ffmpeg's banner, or undefined. */
export async function videoHeight(file: string): Promise<number | undefined> {
  const { stderr } = await run(FFMPEG, ["-hide_banner", "-i", file], {
    maxBuffer: 4 * 1024 * 1024,
  }).catch((e: { stderr?: string }) => ({ stderr: String(e.stderr ?? "") }));
  return parseHeight(String(stderr));
}

/** The first video stream's height in ffmpeg's banner ("Video: h264 ..., 640x480 [SAR 1:1 DAR 4:3], ..."). */
export function parseHeight(banner: string): number | undefined {
  const m = banner.match(/Stream #\S+.*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  return m ? Number(m[2]) : undefined;
}

export interface UpscaleItem {
  kind: "video" | "image";
  src: string;
  dest: string;
  /** The height the result is made at (1080 for footage). */
  height: number;
  /** Stills: skipped by the script when the picture is taller than this. */
  maxHeight?: number;
}

export interface UpscaleResult {
  src: string;
  dest: string;
  ok: boolean;
  seconds: number;
  frames?: number;
  cached?: boolean;
  why?: string;
}

export interface UpscaleRun {
  python: string;
  modelDir: string;
  model: string;
  cacheDir: string;
  items: UpscaleItem[];
  /** A GPU turn from the PC orchestrator around the model's run; absent, none is asked for. */
  lease?: (job: string, estMinutes: number) => Promise<() => void>;
  ffmpeg?: string;
}

/** Runs the model over the items not already in the cache; every result says whether it was made, cached or skipped. */
export async function upscaleFiles(
  o: UpscaleRun,
): Promise<{ results: UpscaleResult[]; gpuSeconds: number }> {
  const results: UpscaleResult[] = [];
  if (!o.python || !o.modelDir || !o.items.length)
    return { results, gpuSeconds: 0 };
  await fs.mkdir(o.cacheDir, { recursive: true });
  const todo: Array<UpscaleItem & { key: string; cached: string }> = [];
  for (const it of o.items) {
    try {
      const key = await cacheKey(it.src, o.model, it.height);
      const cached = path.join(o.cacheDir, `${key}${path.extname(it.dest)}`);
      if (
        await fs.stat(cached).then(
          () => true,
          () => false,
        )
      ) {
        await fs.copyFile(cached, it.dest);
        results.push({
          src: it.src,
          dest: it.dest,
          ok: true,
          seconds: 0,
          cached: true,
        });
      } else todo.push({ ...it, key, cached });
    } catch (err) {
      results.push({
        src: it.src,
        dest: it.dest,
        ok: false,
        seconds: 0,
        why: errorMessage(err),
      });
    }
  }
  if (!todo.length) return { results, gpuSeconds: 0 };
  const stamp = createHash("sha1")
    .update(todo.map((t) => t.key).join())
    .digest("hex")
    .slice(0, 8);
  const jobsFile = path.join(o.cacheDir, `jobs_${stamp}.json`);
  const outFile = path.join(o.cacheDir, `out_${stamp}.json`);
  await fs.writeFile(
    jobsFile,
    JSON.stringify({
      model: o.model,
      modelDir: o.modelDir,
      ffmpeg: o.ffmpeg ?? FFMPEG,
      half: true,
      items: todo.map(({ kind, src, dest, height, maxHeight }) => ({
        kind,
        src,
        dest,
        height,
        maxHeight,
      })),
    }),
  );
  let gpuSeconds = 0;
  let release: () => void = () => undefined;
  if (o.lease) {
    try {
      release = await o.lease(
        `upscale ${todo.length} old pictures and clips`,
        Math.max(2, Math.ceil(todo.length / 6)),
      );
    } catch (err) {
      // No GPU turn, no upscaling: the plain resize stays rather than run Real-ESRGAN on a GPU someone else holds.
      log("warn", "no GPU turn for the upscaling; the plain resize stays", {
        error: errorMessage(err),
      });
      await fs.rm(jobsFile, { force: true }).catch(() => undefined);
      for (const t of todo)
        results.push({
          src: t.src,
          dest: t.dest,
          ok: false,
          seconds: 0,
          why: `no GPU turn: ${errorMessage(err)}`,
        });
      return { results, gpuSeconds: 0 };
    }
  }
  try {
    await run(o.python, ["-I", SCRIPT, jobsFile, outFile], {
      timeout: 40 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    const r = JSON.parse(await fs.readFile(outFile, "utf8")) as {
      loadSeconds: number;
      items: UpscaleResult[];
    };
    gpuSeconds = r.loadSeconds;
    for (const x of r.items) {
      gpuSeconds += x.seconds;
      results.push(x);
      const t = todo.find((t) => t.dest === x.dest);
      if (x.ok && t) await fs.copyFile(x.dest, t.cached).catch(() => undefined);
    }
  } catch (err) {
    log("warn", "upscaling failed; the plain resize stays", {
      error: errorMessage(err),
    });
    for (const t of todo)
      if (!results.some((x) => x.dest === t.dest))
        results.push({
          src: t.src,
          dest: t.dest,
          ok: false,
          seconds: 0,
          why: errorMessage(err),
        });
  } finally {
    release();
    await fs.rm(jobsFile, { force: true }).catch(() => undefined);
    await fs.rm(outFile, { force: true }).catch(() => undefined);
  }
  return { results, gpuSeconds };
}

/** A GPU turn from the PC orchestrator at Pulse's priority; none when it is not installed. */
export function orchUpscaleLease(): (
  job: string,
  est: number,
) => Promise<() => void> {
  return async (job, est) => {
    try {
      const orch = await loadOrch();
      return (await leaseStrict(orch, "gpu", {
        job,
        project: "pulse",
        priority: 60,
        kind: "pulse:upscale",
        est,
        vram: 6,
        ram: 4,
        maxWait: 60,
      })) as () => void;
    } catch (err) {
      // Only the Mac (no orchestrator at all) goes ahead; a refusal or a wait that ran out skips the upscaling.
      if (!(err instanceof NoOrchestrator)) throw err;
      log("info", "no orchestrator here for the upscaling; going ahead", {
        error: errorMessage(err),
      });
      return () => undefined;
    }
  };
}

export interface FootageUpscaleReport {
  /** Clips upscaled (made or from the cache), and those left at the plain resize by the budget. */
  upscaled: number;
  cached: number;
  overBudget: number;
  failed: number;
  footageSeconds: number;
  gpuSeconds: number;
}

/**
 * The footage pass (after the footage-first gather): every clip with a native-size copy beside it, oldest
 * chapter first, within the budget, upscaled to 1080 in place of its plain resize. The copies are removed
 * afterwards either way.
 */
export async function upscaleFootage(o: {
  python: string;
  modelDir: string;
  model: string;
  cacheDir: string;
  episodeDir: string;
  clips: Array<{ file: string; durationSeconds: number; beatIndex?: number }>;
  budgetSeconds: number;
  lease?: UpscaleRun["lease"];
}): Promise<FootageUpscaleReport> {
  const report: FootageUpscaleReport = {
    upscaled: 0,
    cached: 0,
    overBudget: 0,
    failed: 0,
    footageSeconds: 0,
    gpuSeconds: 0,
  };
  const withCopy: Array<UpscaleCandidate & { sd: string; dest: string }> = [];
  for (const c of o.clips) {
    const dest = path.join(o.episodeDir, c.file);
    const sd = sdCopy(dest);
    if (
      await fs.stat(sd).then(
        () => true,
        () => false,
      )
    )
      withCopy.push({
        file: c.file,
        seconds: c.durationSeconds,
        order: c.beatIndex ?? 99,
        sd,
        dest,
      });
  }
  if (!withCopy.length) return report;
  const chosen = pickUpscale(withCopy, o.budgetSeconds);
  report.overBudget = withCopy.length - chosen.length;
  // The result is written beside the clip, then moved over it, so a failed run leaves the plain resize.
  const items: UpscaleItem[] = chosen.map((c) => ({
    kind: "video",
    src: c.sd,
    dest: c.dest.replace(/\.mp4$/i, ".up.mp4"),
    height: 1080,
  }));
  const { results, gpuSeconds } = await upscaleFiles({ ...o, items });
  report.gpuSeconds = Math.round(gpuSeconds);
  for (const c of chosen) {
    const r = results.find((x) => x.src === c.sd);
    if (r?.ok) {
      await fs.rename(r.dest, c.dest).catch(() => undefined);
      report.upscaled++;
      if (r.cached) report.cached++;
      report.footageSeconds += c.seconds;
    } else report.failed++;
  }
  for (const c of withCopy)
    await fs.rm(c.sd, { force: true }).catch(() => undefined);
  for (const it of items)
    await fs.rm(it.dest, { force: true }).catch(() => undefined);
  report.footageSeconds = Math.round(report.footageSeconds);
  return report;
}

/** Kinds of still worth upscaling when small: the wide pictures shown full screen, and box art for the 3D box. */
export const UPSCALE_STILL_KINDS = new Set([
  "hero",
  "header",
  "screenshot",
  "article",
  "capsule",
]);

/**
 * The stills pass: each small picture of these kinds upscaled into assets/up (the script skips any taller than
 * maxHeight); returns, per picture's relative path, the upscaled copy's relative path.
 */
export async function upscaleStills(o: {
  python: string;
  modelDir: string;
  model: string;
  cacheDir: string;
  episodeDir: string;
  files: string[];
  maxHeight: number;
  lease?: UpscaleRun["lease"];
  outDir?: string;
}): Promise<{ made: Map<string, string>; gpuSeconds: number }> {
  const made = new Map<string, string>();
  if (!o.files.length) return { made, gpuSeconds: 0 };
  const outDir = o.outDir ?? path.join(o.episodeDir, "assets", "up");
  await fs.mkdir(outDir, { recursive: true });
  const items: UpscaleItem[] = o.files.map((f) => ({
    kind: "image",
    src: path.join(o.episodeDir, f),
    dest: path.join(
      outDir,
      `${path.basename(f).replace(/\.[^.]+$/, "")}_${createHash("sha1").update(f).digest("hex").slice(0, 8)}.png`,
    ),
    // Four times the size, capped at 2160 lines; the script resizes to this and never past it.
    height: 0,
    maxHeight: o.maxHeight,
  }));
  const { results, gpuSeconds } = await upscaleFiles({ ...o, items });
  for (const r of results)
    if (r.ok) {
      const k = o.files[items.findIndex((x) => x.dest === r.dest)];
      if (k)
        made.set(
          k,
          path.relative(o.episodeDir, r.dest).split(path.sep).join("/"),
        );
    }
  return { made, gpuSeconds };
}
