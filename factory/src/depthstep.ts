// The depth and upscaling steps of a long video (owner's perfection programme, 1 Nov 2026), kept out of
// src/pipeline.ts so the steps there stay small:
//
// - upscaleOldFootage, after the footage-first gather: the old games' small sources are redrawn at 1080 by
//   Real-ESRGAN (src/assets/upscale.ts), oldest chapter first, within UPSCALE_MAX_SECONDS a video.
// - upscaleOldStills, before the depth layers: small store headers and old screenshots likewise, so the layers,
//   the 3D photo and the box are made from the sharper copy.
// - meshStills, after the depth layers: the 3D photo maps for the best wide key art of each chapter, which the
//   orbit (DEPTH_ORBIT) and the subject pop-out (SUBJECT_POP) use.
//
// Each is behind its setting, logged with logEvent and told to the owner in one plain line; a failure leaves the
// video as it was before these steps existed.

import path from "node:path";
import type { Config } from "./config.ts";
import { orbitCandidates } from "./render/orbit.ts";
import type { Layers, Mesh } from "./render/parallax.ts";
import {
  UPSCALE_STILL_KINDS,
  type FootageUpscaleReport,
} from "./assets/upscale.ts";

export type DepthConfig = Pick<
  Config,
  | "dataDir"
  | "parallax"
  | "parallaxPython"
  | "depthOrbit"
  | "depthOrbitMax"
  | "subjectPop"
  | "upscale"
  | "upscaleModel"
  | "upscaleModelDir"
  | "upscaleMaxHeight"
  | "upscaleMaxSeconds"
>;

export interface DepthImage {
  file: string;
  kind: string;
  aspect: number;
  beatIndex?: number;
  wordy?: boolean;
  layers?: Layers;
  upscaledFrom?: string;
}

export interface DepthDeps {
  cfg: DepthConfig;
  makeMeshes(
    python: string,
    dir: string,
    files: string[],
  ): Promise<Map<string, Mesh>>;
  upscaleStills(o: {
    python: string;
    modelDir: string;
    model: string;
    cacheDir: string;
    episodeDir: string;
    files: string[];
    maxHeight: number;
  }): Promise<{ made: Map<string, string>; gpuSeconds: number }>;
  upscaleFootage(o: {
    python: string;
    modelDir: string;
    model: string;
    cacheDir: string;
    episodeDir: string;
    clips: Array<{ file: string; durationSeconds: number; beatIndex?: number }>;
    budgetSeconds: number;
  }): Promise<FootageUpscaleReport>;
  logEvent(kind: string, detail: Record<string, unknown>): Promise<void>;
  notify(m: { content: string }): Promise<unknown>;
}

/** Where upscaled files are cached by hash, shared by every video on this machine. */
export const upscaleCache = (cfg: Pick<Config, "dataDir">) =>
  path.join(cfg.dataDir, "cache", "upscale");

const upscaleOn = (cfg: DepthConfig) =>
  cfg.upscale && !!cfg.upscaleModelDir && !!cfg.parallaxPython;

/** The relative path's own spelling, forward slashes, as the maps are keyed. */
const key = (f: string) => f.split(path.sep).join("/");

/** The owner's line about the old footage's upscaling. */
export function footageNotice(
  headline: string,
  r: FootageUpscaleReport,
  model: string,
): string {
  const over = r.overBudget
    ? ` ${r.overBudget} more stayed at the plain resize: the cap is UPSCALE_MAX_SECONDS seconds of footage a video.`
    : "";
  const failed = r.failed
    ? ` ${r.failed} could not be upscaled and kept the plain resize.`
    : "";
  return `"${headline}": ${r.upscaled} old gameplay clip${r.upscaled === 1 ? "" : "s"} (${r.footageSeconds} s of footage) redrawn at 1080 by the local upscaler (Real-ESRGAN ${model}) instead of a plain resize, in ${r.gpuSeconds} s of GPU time${r.cached ? `, ${r.cached} from the cache` : ""}.${over}${failed} Setting: UPSCALE.`;
}

/** After the footage-first gather: the old sources' clips upscaled; a no-op when nothing kept a native copy. */
export async function upscaleOldFootage(
  d: DepthDeps,
  a: {
    headline: string;
    episodeDir: string;
    clips: Array<{ file: string; durationSeconds: number; beatIndex?: number }>;
  },
): Promise<FootageUpscaleReport | undefined> {
  if (!upscaleOn(d.cfg) || !a.clips.length) return undefined;
  const r = await d.upscaleFootage({
    python: d.cfg.parallaxPython,
    modelDir: d.cfg.upscaleModelDir,
    model: d.cfg.upscaleModel,
    cacheDir: upscaleCache(d.cfg),
    episodeDir: a.episodeDir,
    clips: a.clips,
    budgetSeconds: d.cfg.upscaleMaxSeconds,
  });
  if (!r.upscaled && !r.failed && !r.overBudget) return r;
  await d.logEvent("upscale_footage", { ...r, model: d.cfg.upscaleModel });
  if (r.upscaled || r.failed)
    await d.notify({
      content: footageNotice(a.headline, r, d.cfg.upscaleModel),
    });
  return r;
}

/**
 * Before the depth layers: each small still of the kinds shown full screen (or on the 3D box) upscaled; the
 * picture then points at the sharper copy and remembers its original. Stills already layered are left alone
 * (their layers were cut from the original). Returns how many were upscaled.
 */
export async function upscaleOldStills(
  d: DepthDeps,
  a: { headline: string; episodeDir: string; images: DepthImage[] },
): Promise<number> {
  if (!upscaleOn(d.cfg)) return 0;
  const want = a.images.filter(
    (i) => !i.upscaledFrom && !i.layers && UPSCALE_STILL_KINDS.has(i.kind),
  );
  if (!want.length) return 0;
  const { made, gpuSeconds } = await d.upscaleStills({
    python: d.cfg.parallaxPython,
    modelDir: d.cfg.upscaleModelDir,
    model: d.cfg.upscaleModel,
    cacheDir: upscaleCache(d.cfg),
    episodeDir: a.episodeDir,
    files: want.map((i) => i.file),
    maxHeight: d.cfg.upscaleMaxHeight,
  });
  let n = 0;
  for (const i of want) {
    const up = made.get(i.file) ?? made.get(key(i.file));
    if (!up) continue;
    i.upscaledFrom = i.file;
    i.file = up;
    n++;
  }
  if (n) {
    await d.logEvent("upscale_stills", {
      upscaled: n,
      gpuSeconds: Math.round(gpuSeconds),
      model: d.cfg.upscaleModel,
    });
    await d.notify({
      content: `"${a.headline}": ${n} small old picture${n === 1 ? "" : "s"} (store headers, old screenshots) redrawn at four times the size by the local upscaler (Real-ESRGAN ${d.cfg.upscaleModel}) in ${Math.round(gpuSeconds)} s of GPU time; the originals are kept. Setting: UPSCALE.`,
    });
  }
  return n;
}

/**
 * After the depth layers: the 3D photo maps for the stills the orbit and the pop-out may use (orbitCandidates:
 * key art first, two a chapter, DEPTH_ORBIT_MAX in all). Returns how many were made.
 */
export async function meshStills(
  d: DepthDeps,
  a: { headline: string; episodeDir: string; images: DepthImage[] },
): Promise<number> {
  const { cfg } = d;
  if (
    !cfg.parallax ||
    !cfg.parallaxPython ||
    !(cfg.depthOrbit || cfg.subjectPop)
  )
    return 0;
  const picks = orbitCandidates(a.images, cfg.depthOrbitMax).filter(
    (k) => !a.images[k]!.layers?.mesh,
  );
  if (!picks.length) return 0;
  const made = await d.makeMeshes(
    cfg.parallaxPython,
    a.episodeDir,
    picks.map((k) => a.images[k]!.file),
  );
  let n = 0;
  for (const k of picks) {
    const im = a.images[k]!;
    const m = made.get(key(im.file));
    if (m && im.layers) {
      im.layers.mesh = m;
      n++;
    }
  }
  if (n) {
    await d.logEvent("depth_mesh", {
      made: n,
      asked: picks.length,
      orbit: cfg.depthOrbit,
      pop: cfg.subjectPop,
    });
    await d.notify({ content: meshNotice(a.headline, n, cfg) });
  }
  return n;
}

/**
 * The real calls. The footage pass asks the PC orchestrator for a GPU turn (it runs between the gather's own
 * turns); the stills and maps run inside the render's PC turn, like the depth layers, so they ask for none.
 */
export function depthDeps(
  cfg: DepthConfig,
  logEvent: DepthDeps["logEvent"],
  notify: DepthDeps["notify"],
): DepthDeps {
  return {
    cfg,
    makeMeshes: (python, dir, files) =>
      import("./render/parallax.ts").then((m) =>
        m.makeMeshes(python, dir, files),
      ),
    upscaleStills: (o) =>
      import("./assets/upscale.ts").then((m) => m.upscaleStills(o)),
    upscaleFootage: (o) =>
      import("./assets/upscale.ts").then((m) =>
        m.upscaleFootage({ ...o, lease: m.orchUpscaleLease() }),
      ),
    logEvent,
    notify,
  };
}

/** The owner's line when a video first gets its 3D photos and pop-outs. */
export function meshNotice(
  headline: string,
  made: number,
  cfg: Pick<Config, "depthOrbit" | "subjectPop">,
): string {
  const uses = [
    cfg.depthOrbit ? "a slow 3D camera orbit, about once a chapter" : "",
    cfg.subjectPop
      ? "the subject stepping in front of the title drop and every other chapter title where it fits"
      : "",
  ].filter(Boolean);
  return `"${headline}": ${made} key art still${made === 1 ? "" : "s"} turned into 3D photos for ${uses.join(" and ")}. Settings: DEPTH_ORBIT, SUBJECT_POP (DEPTH_ORBIT_MAX caps the stills).`;
}
