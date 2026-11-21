// The factory's side of the PC's GPU picture service (src/gpuvis/server.ts), and the step that uses it on an
// episode's pictures before a render: FILL_FRAME and UPSCALE_STILLS. Every failure is quiet: a picture the service
// cannot improve keeps its usual treatment (the blurred plate, the original resolution). A service that is down, or
// busy waiting for a GPU turn, is given up on for the whole episode at the first sign, so a busy PC (an Orryy render)
// costs a render a few minutes at most, never hours.

import fs from "node:fs/promises";
import path from "node:path";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import type { Ask } from "./vision.ts";

export interface GpuvisSwitches {
  fillFrame: boolean;
  upscaleStills: boolean;
  gpuvisUrl: string;
}

/** Minutes the service may wait for a GPU turn on the factory's behalf before answering "busy". */
export const FACTORY_MAX_WAIT = Number(
  process.env.GPUVIS_FACTORY_MAX_WAIT || 4,
);
/** One call's limit: the turn's wait plus the job (a fill with two attempts is under two minutes once loaded). */
const CALL_MS = (FACTORY_MAX_WAIT + 8) * 60_000;

/** True when the service answers and is not itself stuck waiting for a GPU turn. */
export async function gpuvisUp(
  url: string,
  timeoutMs = 5000,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `${url.replace(/\/$/, "")}/health`,
      {},
      timeoutMs,
    );
    if (!res.ok) return false;
    const body = (await res.json().catch(() => ({}))) as { busy?: boolean };
    return !body.busy;
  } catch {
    return false;
  }
}

/** What one call came back with: a picture, nothing needed, refused by its own check, or the service unable to help. */
export type GpuvisAnswer = "ok" | "none" | "rejected" | "busy";

async function call(
  url: string,
  route: string,
  file: string | undefined,
  dest: string,
): Promise<GpuvisAnswer> {
  const sep = route.includes("?") ? "&" : "?";
  const res = await fetchWithTimeout(
    `${url.replace(/\/$/, "")}${route}${sep}maxWait=${FACTORY_MAX_WAIT}`,
    {
      method: "POST",
      body: file ? await fs.readFile(file) : undefined,
      headers: { "content-type": "application/octet-stream" },
    },
    CALL_MS,
  );
  if (res.status === 200) {
    await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return "ok";
  }
  if (res.status === 204) return "none";
  if (res.status === 422) return "rejected";
  return "busy";
}

/** Fills src to outW x outH into dest. */
export function remoteFill(
  url: string,
  src: string,
  dest: string,
  o: { outW: number; outH: number; place: string },
): Promise<GpuvisAnswer> {
  return call(
    url,
    `/fill?outW=${o.outW}&outH=${o.outH}&place=${o.place}`,
    src,
    dest,
  );
}

/** Upscales src for a frameW x frameH frame into dest. */
export function remoteUpscale(
  url: string,
  src: string,
  dest: string,
  o: { frameW: number; frameH: number; year?: number },
): Promise<GpuvisAnswer> {
  return call(
    url,
    `/upscale?frameW=${o.frameW}&frameH=${o.frameH}${o.year ? `&year=${o.year}` : ""}`,
    src,
    dest,
  );
}

/** A light plate for a thumbnail (thumbs.ts PLATE_PROMPTS) into dest. */
export function remotePlate(
  url: string,
  dest: string,
  seed: number,
  variant: number,
): Promise<GpuvisAnswer> {
  return call(url, `/plate?seed=${seed}&variant=${variant}`, undefined, dest);
}

/**
 * The thumbnail judge through the GPU service (POST /ask): the service runs the big vision model inside its own
 * orchestrator GPU turn, so a 30B model never lands on the PC's 4090 without one. Throws when the service cannot.
 */
export function remoteAsk(url: string): Ask {
  return async (files, prompt, schema) => {
    const images = await Promise.all(
      files.map(async (f) => (await fs.readFile(f)).toString("base64")),
    );
    const res = await fetchWithTimeout(
      `${url.replace(/\/$/, "")}/ask?maxWait=${FACTORY_MAX_WAIT}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, schema, images }),
      },
      CALL_MS,
    );
    if (!res.ok) throw new Error(`GPU service ask ${res.status}`);
    return res.json();
  };
}

export interface PreparedImage {
  file: string;
  aspect: number;
  fillFile?: string;
  /** The enlarged copy; the file itself when the service said it needs nothing (so a retry does not ask again). */
  upFile?: string;
  /** The fill was refused by its own margin check: not asked again on a retry. */
  fillRejected?: boolean;
  year?: number;
}

/**
 * Which pictures a lane fills (pure): in a Short anything from square to wide (0.9 and over; the framed panel shows
 * square and 4:3 stills as well as 16:9 ones), tall ones in a long video (under 0.9).
 */
export function wantsFill(lane: "short" | "long", aspect: number): boolean {
  if (!Number.isFinite(aspect) || aspect <= 0) return false;
  return lane === "short" ? aspect >= 0.9 : aspect < 0.9;
}

/**
 * The stills a Short's plan shows in the framed panel (pure), by index: the only ones a fill can show on (a still
 * shown full-bleed is cover-cropped to the frame and keeps the original). Filling the others would spend a minute of
 * the PC's GPU each for nothing.
 */
export function framedStills(plan: {
  shots: Array<{ framed: boolean; media: { type: string; index: number } }>;
}): Set<number> {
  return new Set(
    plan.shots
      .filter((s) => s.framed && s.media.type === "image")
      .map((s) => s.media.index),
  );
}

/** Most pictures sent per episode: a bound on how long one episode can hold the PC's GPU (a Short has fewer). */
export const MAX_PICTURES = 40;
export const MAX_PICTURES_SHORT = 12;
/** The whole step's time per episode, minutes: past it the rest of the pictures keep their usual look. */
export const STEP_MINUTES = { short: 6, long: 15 } as const;

/** A derived file's name (pure): the picture's own name with its extension kept, so x.jpg and x.png never collide. */
export const derivedName = (file: string, kind: "up" | "fill"): string =>
  `${file.replace(/\.([a-z0-9]+)$/i, "_$1")}.${kind === "up" ? "up.png" : "fill.jpg"}`;

const exists = (f: string) =>
  fs.access(f).then(
    () => true,
    () => false,
  );

/**
 * FILL_FRAME and UPSCALE_STILLS on an episode's pictures (paths relative to dir), in place: an enlarged copy goes in
 * upFile, a filled copy in fillFile. Pictures whose copies are still on disk are skipped, so a retry costs nothing;
 * pictures the lane fills go first, so the per-episode cap never starves them.
 */
export async function prepareImages(
  cfg: GpuvisSwitches,
  dir: string,
  images: PreparedImage[],
  lane: "short" | "long",
  deps: {
    up?: typeof gpuvisUp;
    fill?: typeof remoteFill;
    upscale?: typeof remoteUpscale;
  } = {},
  opts: {
    /** Only these pictures (indices into images) are filled: a Short's framed stills (framedStills). */
    fillOnly?: Set<number>;
    /** The game's release year, for pictures without their own: before 2010 they are always upscaled. */
    year?: number;
    /** The step's own deadline (epoch ms); STEP_MINUTES from now by default. */
    until?: number;
  } = {},
): Promise<{ filled: number; upscaled: number; skipped?: string }> {
  if (!cfg.fillFrame && !cfg.upscaleStills) return { filled: 0, upscaled: 0 };
  // Copies recorded but gone from disk (a pruned folder) are made again rather than pointing the render at nothing.
  for (const i of images) {
    if (
      i.upFile &&
      i.upFile !== i.file &&
      !(await exists(path.join(dir, i.upFile)))
    )
      i.upFile = undefined;
    if (i.fillFile && !(await exists(path.join(dir, i.fillFile))))
      i.fillFile = undefined;
  }
  const wantFill = (i: PreparedImage) =>
    cfg.fillFrame &&
    !i.fillFile &&
    !i.fillRejected &&
    wantsFill(lane, i.aspect) &&
    (!opts.fillOnly || opts.fillOnly.has(images.indexOf(i)));
  const wantUp = (i: PreparedImage) => cfg.upscaleStills && !i.upFile;
  const todo = [
    ...images.filter(wantFill),
    ...images.filter((i) => !wantFill(i) && wantUp(i)),
  ].slice(0, lane === "short" ? MAX_PICTURES_SHORT : MAX_PICTURES);
  if (!todo.length) return { filled: 0, upscaled: 0 };
  if (!(await (deps.up ?? gpuvisUp)(cfg.gpuvisUrl))) {
    log(
      "info",
      "GPU picture service not answering or busy; pictures keep their usual look",
      { url: cfg.gpuvisUrl },
    );
    return { filled: 0, upscaled: 0, skipped: "service down" };
  }
  let filled = 0;
  let upscaled = 0;
  const until = opts.until ?? Date.now() + STEP_MINUTES[lane] * 60_000;
  // The frame the picture is shown in: a Short's still is cover-cropped into 1080x1920, a long video's into 1920x1080.
  const [frameW, frameH] = lane === "short" ? [1080, 1920] : [1920, 1080];
  for (const img of todo) {
    if (Date.now() > until) {
      log(
        "info",
        "GPU picture step out of time; the rest keep their usual look",
        { lane },
      );
      return { filled, upscaled, skipped: "time limit" };
    }
    try {
      if (wantUp(img)) {
        const up = derivedName(img.file, "up");
        const a = await (deps.upscale ?? remoteUpscale)(
          cfg.gpuvisUrl,
          path.join(dir, img.file),
          path.join(dir, up),
          {
            frameW,
            frameH,
            year: img.year ?? opts.year,
          },
        );
        if (a === "busy") return { filled, upscaled, skipped: "service busy" };
        if (a === "ok") {
          img.upFile = up;
          upscaled++;
        } else if (a === "none") img.upFile = img.file;
      }
      if (wantFill(img)) {
        const fill = derivedName(img.file, "fill");
        const [outW, outH, place] =
          lane === "short" ? [1080, 1920, "hero"] : [1920, 1080, "centre"];
        const a = await (deps.fill ?? remoteFill)(
          cfg.gpuvisUrl,
          path.join(dir, img.upFile ?? img.file),
          path.join(dir, fill),
          {
            outW: outW as number,
            outH: outH as number,
            place: place as string,
          },
        );
        if (a === "busy") return { filled, upscaled, skipped: "service busy" };
        if (a === "ok") {
          img.fillFile = fill;
          filled++;
        } else if (a === "rejected") img.fillRejected = true;
      }
    } catch (err) {
      // A timeout or a dropped connection: the service cannot help this episode.
      log("warn", "GPU picture step stopped for this episode", {
        file: img.file,
        error: errorMessage(err),
      });
      return { filled, upscaled, skipped: "service failed" };
    }
  }
  return { filled, upscaled };
}
