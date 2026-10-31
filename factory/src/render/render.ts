// Node-side render driver: bundles the Remotion project once per process,
// serves the episode's files over a loopback HTTP server, and renders the MP4
// plus a poster frame.

import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import {
  makeCancelSignal,
  openBrowser,
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import type { ShortProps } from "./props.ts";
import { unloadLocalVision } from "../assets/localvision.ts";
import { log } from "../lib/util.ts";
import { PcTurnTimeout } from "../pcschedule.ts";
import type { LongProps } from "./Long.tsx";
import { BEDS, MOOD_BEDS } from "./soundscape.ts";
import { pocketOf } from "./soundfx.ts";
import type { ThumbProps } from "./Brand.tsx";
import type { EngageProps } from "./Engage.tsx";
import type { CutdownProps } from "./Cutdown.tsx";

/**
 * A file name as a URL path: on Windows path.join writes backslashes, and inside a CSS url() a backslash
 * starts an escape ("\\a" is a newline), so "entry_2\\assets\\hero_0.jpg" loaded as "entry_2ssetshero_0.jpg"
 * and the graphic cards that use a background picture showed none (29-30 Oct 2026 renders).
 */
export const webPath = (file: string): string => file.replace(/\\/g, "/");

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(here, "index.ts");
const PUBLIC_DIR = path.join(here, "..", "..", "public");

/**
 * The Epidemic Sound beds (src/assets/epidemic_beds.json, chosen by src/tools/sfxlab/pickepidemic.py) that
 * this bundle carries: they live outside git, so a machine or a bundle without them simply goes without.
 */
function extraBeds(serveUrl: string): NonNullable<LongProps["extraBeds"]> {
  try {
    const list = JSON.parse(
      fs.readFileSync(
        path.join(here, "..", "assets", "epidemic_beds.json"),
        "utf8",
      ),
    ) as { beds: Array<{ file: string; key: "D" | "E"; mood: string }> };
    return list.beds
      .filter((b) => fs.existsSync(path.join(serveUrl, "public", b.file)))
      .map(({ file, key, mood }) => ({ file, key, mood }));
  } catch {
    return [];
  }
}

/**
 * The music beds whose pocketed copy (public/music/pocket, data/smoke/pocketbeds.mts) this bundle carries: a
 * bed without one plays plain, as before, so a machine without the copies simply goes without the dip.
 */
function pocketBeds(serveUrl: string): string[] {
  const all = [
    ...BEDS.map((b) => b.file),
    ...Object.values(MOOD_BEDS)
      .flat()
      .map((b) => b.file),
  ];
  return all.filter((b) =>
    fs.existsSync(path.join(serveUrl, "public", pocketOf(b))),
  );
}

let bundlePromise: Promise<string> | undefined;
let bundleDir: string | undefined;
export function getBundle(): Promise<string> {
  // A bundle swept away from the temp folder is rebuilt rather than rendered from a missing folder.
  if (bundleDir && !fs.existsSync(bundleDir))
    bundlePromise = bundleDir = undefined;
  bundlePromise ??= bundle({
    entryPoint: ENTRY,
    publicDir: PUBLIC_DIR,
    onProgress: () => undefined,
  }).then((dir) => (bundleDir = dir));
  return bundlePromise;
}

/**
 * Deletes the renderer's leftovers in the system temp folder (a webpack bundle per process start, an
 * assets folder per render) older than `hours`, never this process's own bundle. Nothing removed them:
 * 192 folders, 7.7 GB by 23 Oct 2026. Returns the gigabytes freed.
 */
export async function sweepRenderTemp(hours = 6): Promise<number> {
  const tmp = os.tmpdir();
  const cutoff = Date.now() - hours * 3_600_000;
  const keep = bundleDir ? path.resolve(bundleDir) : undefined;
  let freed = 0;
  for (const name of await fsp.readdir(tmp).catch(() => [] as string[])) {
    if (!/^(remotion-|react-motion-render)/.test(name)) continue;
    const dir = path.join(tmp, name);
    if (keep && (keep === dir || keep.startsWith(dir + path.sep))) continue;
    const st = await fsp.stat(dir).catch(() => undefined);
    if (!st?.isDirectory() || st.mtimeMs > cutoff) continue;
    freed += await dirBytes(dir);
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return freed / 1024 ** 3;
}

async function dirBytes(dir: string): Promise<number> {
  let n = 0;
  for (const e of await fsp
    .readdir(dir, { withFileTypes: true })
    .catch(() => [])) {
    const p = path.join(dir, e.name);
    n += e.isDirectory()
      ? await dirBytes(p)
      : ((await fsp.stat(p).catch(() => undefined))?.size ?? 0);
  }
  return n;
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
};

/**
 * Memory for a render. The local vision model stays loaded for 15 minutes after a frame check and
 * holds gigabytes; with it resident Remotion sized its frame cache from the little memory left and
 * evicted frames before they were used ("No frame found at position"). The model is unloaded first
 * and the cache gets a floor.
 */
/**
 * A good neighbour on a shared machine: while another program holds most of the memory (After Effects
 * held 9 GB on 22 Oct 2026 and long renders kept failing), a render waits for room, checking every 30 s,
 * then starts anyway after RENDER_WAIT_MINUTES (default 20) so no slot is missed. The bar is
 * RENDER_MIN_FREE_GB (default 6).
 */
export async function waitForHeadroom(
  freemem: () => number = os.freemem,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
  now: () => number = Date.now,
): Promise<number> {
  const GB = 1024 ** 3;
  const need = Number(process.env.RENDER_MIN_FREE_GB || 6) * GB;
  const until = now() + Number(process.env.RENDER_WAIT_MINUTES || 20) * 60_000;
  const started = now();
  let told = false;
  while (freemem() < need && now() < until) {
    if (!told) {
      log("info", "render waiting for memory", {
        freeGB: Math.round((freemem() / GB) * 10) / 10,
        needGB: need / GB,
      });
      told = true;
    }
    await sleep(30_000);
  }
  return now() - started;
}

/**
 * Martin's PC runs Orryy's After Effects renders, the explainer and other projects too. A render here holds
 * all 8 cores and 3-12 GB for 10-40 min, so it takes a turn from the PC orchestrator (C:\Claude\orchestrator)
 * first, then holds the PC until it's done. Inside the window before one of its slots (src/pcschedule.ts) it
 * goes ahead of everything, and starts regardless at the last moment that still makes the slot; outside one it
 * waits behind Orryy's renders, for up to 3 hours. Without the orchestrator it's a no-op. A long render waits
 * only `yieldAfter` minutes, then hands back (PcTurnTimeout) rather than take a Short's coming slot.
 */
async function withPcTurn<T>(
  job: string,
  fn: (granted: boolean) => Promise<T>,
  yieldAfter?: number,
): Promise<T> {
  let release = () => {};
  let granted = false;
  try {
    const orch: any = await import(
      process.env.ORCH_CLIENT || "file:///C:/Claude/orchestrator/orch.mjs"
    );
    release = await orch.lease("heavy", {
      job,
      project: "pulse",
      priority: 60,
      kind: `pulse:${job.split(" ")[0]}`,
      ram: 6,
      maxWait: yieldAfter ?? 180,
      onWait: (why: string) =>
        log("info", "render waiting for the PC", { why }),
    });
    granted = true;
  } catch (e) {
    if (yieldAfter !== undefined && String(e).includes("orchestrator:"))
      throw new PcTurnTimeout(
        `${job}: no turn within ${Math.round(yieldAfter)} min`,
      );
    log(
      "warn",
      "PC orchestrator unavailable or wait ran out; rendering anyway",
      {
        error: String(e),
      },
    );
  }
  try {
    return await fn(granted);
  } finally {
    release();
  }
}

/** renderMedia inside a PC turn; the frame cache is sized from the memory free once the turn starts. */
async function renderWithTurn(
  job: string,
  options: Omit<
    Parameters<typeof renderMedia>[0],
    "offthreadVideoCacheSizeInBytes"
  >,
  yieldAfter?: number,
): Promise<void> {
  await withPcTurn(
    job,
    async (granted) => {
      rendersActive++;
      try {
        await renderMediaWatched({
          ...(await renderMemory(granted)),
          ...options,
        });
      } finally {
        rendersActive--;
      }
    },
    yieldAfter,
  );
}

/** Renders drawing frames right now (the wait for a PC turn does not count): the lane watchdog never acts during one. */
let rendersActive = 0;
export const activeRenders = (): number => rendersActive;

/** Minutes without a new frame before a render counts as frozen (before the first frame, and after it). */
export const STALL_MINUTES = { first: 15, between: 10 };

/** Whether a render whose last frame (or start) was at `since` has frozen by `now`. */
export function renderStalled(
  now: number,
  since: number,
  framesSeen: boolean,
): boolean {
  const limit = framesSeen ? STALL_MINUTES.between : STALL_MINUTES.first;
  return now - since > limit * 60_000;
}

/** Thread wait states of the renderer's processes, e.g. "Suspended=180 UserRequest=12" (Windows only). */
async function threadStates(): Promise<string> {
  if (process.platform !== "win32") return "";
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      'Get-Process chrome-headless-shell,remotion,ffmpeg -ErrorAction SilentlyContinue | ForEach-Object { $_.Threads } | ForEach-Object { if ($_.ThreadState -eq "Wait") { [string]$_.WaitReason } else { [string]$_.ThreadState } } | Group-Object | ForEach-Object { "$($_.Name)=$($_.Count)" }',
    ],
    { timeout: 20_000 },
  );
  return stdout.trim().split(/\r?\n/).join(" ");
}

/**
 * renderMedia with a freeze guard. 30 Oct 2026: the Vice City documentary's render stopped at about a fifth
 * of the way with Chrome, the decoder and ffmpeg all at zero CPU and no error; Remotion's per-frame timeout
 * never fired and the episode sat for 85 minutes. Now the render is cancelled when no frame arrives for
 * STALL_MINUTES, and the error lets the pipeline's normal retry start it again.
 */
async function renderMediaWatched(
  options: Parameters<typeof renderMedia>[0],
): Promise<void> {
  const { cancelSignal, cancel } = makeCancelSignal();
  let since = Date.now();
  let frames = -1;
  let stalled = false;
  const timer = setInterval(() => {
    if (!renderStalled(Date.now(), since, frames > 0)) return;
    stalled = true;
    clearInterval(timer);
    // Whether something outside froze it (a "sleep mode" optimiser suspends programs): the renderer's
    // threads' wait states, logged before the cancel tears them down.
    void threadStates()
      .then((states) => log("warn", "render frozen", { frames, states }))
      .catch(() => undefined)
      .finally(() => cancel());
  }, 30_000);
  const report = options.onProgress;
  try {
    await renderMedia({
      ...options,
      cancelSignal,
      onProgress: (p) => {
        if (p.renderedFrames !== frames) {
          frames = p.renderedFrames;
          since = Date.now();
        }
        report?.(p);
      },
    });
  } catch (err) {
    if (stalled) {
      const minutes = frames > 0 ? STALL_MINUTES.between : STALL_MINUTES.first;
      throw new Error(
        `render froze: no new frame for ${minutes} min after frame ${Math.max(0, frames)}`,
      );
    }
    throw err;
  } finally {
    clearInterval(timer);
  }
}

async function renderMemory(turnGranted = false): Promise<{
  offthreadVideoCacheSizeInBytes: number;
}> {
  await unloadLocalVision();
  // The orchestrator already weighed memory when it gave the turn (and lets a slot's render through
  // regardless), so waiting again here only made slots late (28 Oct: 20 min on a breaking Short). On a
  // Mac the factory has the machine to itself, and os.freemem() leaves out the memory macOS keeps as
  // cache, so it would read "short" before every render.
  if (!turnGranted && process.platform !== "darwin") await waitForHeadroom();
  const GB = 1024 ** 3;
  // The old 6 GB ceiling sat below Remotion's own default (half the free memory) and a long video
  // drawing on ~100 clips and their blurred plates evicted frames mid-render ("No frame found at
  // position"), three attempts running. Now 60% of free memory, between 3 and 12 GB.
  return {
    offthreadVideoCacheSizeInBytes: Math.round(
      Math.min(12 * GB, Math.max(3 * GB, os.freemem() * 0.6)),
    ),
  };
}

/** Read-only loopback file server rooted at one directory. */
export async function serveDir(
  root: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!).replace(
      /^\/+/,
      "",
    );
    const file = path.resolve(root, rel);
    if (
      !file.startsWith(path.resolve(root) + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type":
        MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": fs.statSync(file).size,
      "access-control-allow-origin": "*",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export interface RenderInput {
  episodeDir: string;
  props: Omit<
    ShortProps,
    "audioSrc" | "images" | "clips" | "logoSrc" | "musicSrc"
  > & {
    audioFile: string | null;
    imageFiles: Array<{
      file: string;
      kind: string;
      aspect: number;
      blurFile?: string;
      beatIndex?: number;
      credit?: string;
    }>;
    clipFiles: Array<{
      file: string;
      durationSeconds: number;
      blurFile?: string;
      beatIndex?: number;
      role?: "hook";
      motion?: number;
      luma?: number;
      stock?: boolean;
      credit?: string;
    }>;
    musicFile: string | null;
    /** The new-look opening's cut-out of the hero art, relative to the episode folder. */
    heroCutFile?: { fg: string; x?: number };
  };
  outFile: string;
  posterFile: string;
  /** The new-look Shorts' custom thumbnail: frame 0, the opening poster, as its own image. */
  thumbFile?: string;
  concurrency: number;
  gl?: "swangle" | "angle" | "egl" | "swiftshader" | "vulkan" | "angle-egl";
  browserExecutable?: string;
  onProgress?: (p: number) => void;
}

export interface LongRenderInput {
  episodeDir: string;
  props: Omit<
    LongProps,
    | "audioSrc"
    | "images"
    | "clips"
    | "logoSrc"
    | "musicSrc"
    | "next"
    | "voiceFx"
    | "pocketBeds"
  > & {
    audioFile: string | null;
    /** The narration's texture slices (src/render/voicefx.ts makeVoiceFx), relative to the episode folder. */
    voiceFxFiles?: Array<{
      kind: "phone" | "reverb";
      from: number;
      to: number;
      file: string;
    }>;
    /** A documentary's end card: the next documentary and its thumbnail file (null: a card with no next; absent: no card). */
    next?: { title: string; thumbFile: string | null } | null;
    imageFiles: Array<{
      file: string;
      kind: string;
      aspect: number;
      beatIndex?: number;
      credit?: string;
      moment?: number;
      label?: string;
      layers?: { bg: string; mid: string; fg: string };
    }>;
    clipFiles: Array<{
      file: string;
      durationSeconds: number;
      beatIndex?: number;
      role?: "hook";
      moment?: number;
      credit?: string;
      audio?: boolean;
      label?: string;
    }>;
    musicFile: string | null;
  };
  outFile: string;
  posterFile: string;
  thumbFile: string;
  thumb: ThumbInput;
  /** Extra designs for YouTube's Test & compare, each rendered beside the main thumbnail. */
  thumbVariants?: Array<{ file: string; thumb: ThumbInput }>;
  concurrency: number;
  gl?: "swangle" | "angle" | "egl" | "swiftshader" | "vulkan" | "angle-egl";
  browserExecutable?: string;
  onProgress?: (p: number) => void;
  /** Only these frames (a preview excerpt); the whole video when absent. */
  frameRange?: [number, number];
  /** How long the PC turn may wait before it is handed back (PcTurnTimeout); 3 hours, then render anyway, when absent. */
  turnWaitMinutes?: number;
}

type ThumbInput = Omit<
  ThumbProps,
  "imageSrc" | "image2Src" | "fgSrc" | "pictureSrcs"
> & {
  imageFile: string | null;
  image2File?: string | null;
  fgFile?: string | null; // depth: the art's foreground layer
  pictureFiles?: string[]; // motif: pictures for its panels and screens
};

/** The long composition's props with every episode file as a URL on the loopback server. */
export function longProps(
  filesUrl: string,
  serveUrl: string,
  p: LongRenderInput["props"],
): LongProps {
  const {
    audioFile,
    imageFiles,
    clipFiles,
    musicFile,
    next,
    voiceFxFiles,
    ...rest
  } = p;
  return {
    ...rest,
    // The narration's texture slices (src/render/voicefx.ts), made in the episode's folder before the render.
    ...(voiceFxFiles?.length
      ? {
          voiceFx: voiceFxFiles.map((v) => ({
            kind: v.kind,
            from: v.from,
            to: v.to,
            src: `${filesUrl}/${webPath(v.file)}`,
          })),
        }
      : {}),
    pocketBeds: pocketBeds(serveUrl),
    // The end card's thumbnail: a copy of the next documentary's thumb inside this episode's folder.
    ...(next === undefined
      ? {}
      : {
          next: next && {
            title: next.title,
            thumbSrc: next.thumbFile
              ? `${filesUrl}/${webPath(next.thumbFile)}`
              : null,
          },
        }),
    audioSrc: audioFile ? `${filesUrl}/${webPath(audioFile)}` : null,
      images: imageFiles.map((i) => ({
      src: `${filesUrl}/${webPath(i.file)}`,
        kind: i.kind,
        aspect: i.aspect,
        beatIndex: i.beatIndex,
        credit: i.credit,
        moment: i.moment,
        label: i.label,
        layers: i.layers
          ? {
            bg: `${filesUrl}/${webPath(i.layers.bg)}`,
            mid: `${filesUrl}/${webPath(i.layers.mid)}`,
            fg: `${filesUrl}/${webPath(i.layers.fg)}`,
            }
          : undefined,
      })),
      clips: clipFiles.map((c) => ({
      src: `${filesUrl}/${webPath(c.file)}`,
        durationSeconds: c.durationSeconds,
        beatIndex: c.beatIndex,
        role: c.role,
        moment: c.moment,
        credit: c.credit,
        audio: c.audio,
        label: c.label,
      })),
      logoSrc: "logo.png",
      musicSrc: musicFile,
      extraBeds: extraBeds(serveUrl),
    };
}

export interface LongStillsInput {
  episodeDir: string;
  props: LongRenderInput["props"];
  /** The frames wanted and where each JPEG goes. */
  stills: Array<{ frame: number; file: string }>;
  /** Output width as a share of 1920 (0.28 gives the 540 px the frame checks use). */
  scale?: number;
  gl?: "swangle" | "angle" | "egl" | "swiftshader" | "vulkan" | "angle-egl";
  browserExecutable?: string;
}

/**
 * Single frames of the long composition, from the same bundle and props as the full render, through one
 * browser: the graphics check looks at every graphic this way before the render (src/qa/graphicscheck.ts),
 * seconds a frame instead of an hour a pass. No PC turn is taken: one headless Chrome drawing one frame at
 * a time is far lighter than a render.
 */
export async function renderLongStills(input: LongStillsInput): Promise<void> {
  if (!input.stills.length) return;
  const serveUrl = await getBundle();
  const files = await serveDir(input.episodeDir);
  const browserExecutable = input.browserExecutable || undefined;
  const chromiumOptions = { gl: input.gl ?? "swangle" } as const;
  const browser = await openBrowser("chrome", {
    browserExecutable,
    chromiumOptions,
  });
  try {
    const props = longProps(files.url, serveUrl, input.props);
    const composition = await selectComposition({
      serveUrl,
      id: "PulseLong",
      inputProps: props,
      browserExecutable,
      puppeteerInstance: browser,
    });
    for (const s of input.stills) {
      await fsp.mkdir(path.dirname(s.file), { recursive: true });
      await renderStill({
        composition,
        serveUrl,
        output: s.file,
        inputProps: props,
        frame: Math.min(composition.durationInFrames - 1, Math.max(0, s.frame)),
        imageFormat: "jpeg",
        jpegQuality: 82,
        scale: input.scale ?? 540 / 1920,
        browserExecutable,
        chromiumOptions,
        puppeteerInstance: browser,
        timeoutInMilliseconds: 180_000,
      });
    }
  } finally {
    await browser.close({ silent: true }).catch(() => undefined);
    await files.close();
  }
}

/** Renders the 16:9 long-form video, a poster frame and a 1280x720 thumbnail. */
export async function renderLong(input: LongRenderInput): Promise<void> {
  const serveUrl = await getBundle();
  const files = await serveDir(input.episodeDir);
  try {
    const props = longProps(files.url, serveUrl, input.props);
    const browserExecutable = input.browserExecutable || undefined;
    const chromiumOptions = { gl: input.gl ?? "swangle" } as const;
    const composition = await selectComposition({
      serveUrl,
      id: "PulseLong",
      inputProps: props,
      browserExecutable,
    });
    await renderWithTurn(
      `long ${path.basename(input.outFile)}`,
      {
        composition,
        serveUrl,
        codec: "h264",
        crf: 20,
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        audioBitrate: "192k",
        outputLocation: input.outFile,
        inputProps: props,
        concurrency: input.concurrency,
        browserExecutable,
        chromiumOptions,
        frameRange: input.frameRange ?? null,
        // A busy PC can take far longer than the 30 s default to decode a clip frame.
        timeoutInMilliseconds: 180_000,
        onProgress: ({ progress }) => input.onProgress?.(progress),
      },
      input.turnWaitMinutes,
    );
    await renderStill({
      composition,
      serveUrl,
      output: input.posterFile,
      inputProps: props,
      frame: Math.min(
        composition.durationInFrames - 1,
        Math.round(2 * composition.fps),
      ),
      imageFormat: "jpeg",
      jpegQuality: 88,
      browserExecutable,
      chromiumOptions,
    });
    for (const t of [
      { file: input.thumbFile, thumb: input.thumb },
      ...(input.thumbVariants ?? []),
    ]) {
      const { imageFile, image2File, fgFile, pictureFiles, ...thumb } = t.thumb;
      const thumbProps: ThumbProps = {
        ...thumb,
        imageSrc: imageFile ? `${files.url}/${webPath(imageFile)}` : null,
        image2Src: image2File ? `${files.url}/${webPath(image2File)}` : null,
        fgSrc: fgFile ? `${files.url}/${webPath(fgFile)}` : null,
        pictureSrcs: pictureFiles?.map((f) => `${files.url}/${webPath(f)}`),
      };
      const still = await selectComposition({
        serveUrl,
        id: "PulseThumb",
        inputProps: thumbProps,
        browserExecutable,
      });
      await renderStill({
        composition: still,
        serveUrl,
        output: t.file,
        inputProps: thumbProps,
        imageFormat: "jpeg",
        jpegQuality: 90,
        browserExecutable,
        chromiumOptions,
      });
    }
  } finally {
    await files.close();
  }
}

export async function renderShort(input: RenderInput): Promise<void> {
  const serveUrl = await getBundle();
  const files = await serveDir(input.episodeDir);
  try {
    const {
      audioFile,
      imageFiles,
      clipFiles,
      musicFile,
      heroCutFile,
      ...rest
    } = input.props;
    const props: ShortProps = {
      ...rest,
      heroCut: heroCutFile
        ? { fg: `${files.url}/${webPath(heroCutFile.fg)}`, x: heroCutFile.x }
        : undefined,
      audioSrc: audioFile ? `${files.url}/${webPath(audioFile)}` : null,
      images: imageFiles.map((i) => ({
        src: `${files.url}/${webPath(i.file)}`,
        kind: i.kind,
        aspect: i.aspect,
        blurSrc: i.blurFile ? `${files.url}/${webPath(i.blurFile)}` : null,
        beatIndex: i.beatIndex,
        credit: i.credit,
      })),
      clips: clipFiles.map((c) => ({
        src: `${files.url}/${webPath(c.file)}`,
        durationSeconds: c.durationSeconds,
        blurSrc: c.blurFile ? `${files.url}/${webPath(c.blurFile)}` : null,
        beatIndex: c.beatIndex,
        role: c.role,
        motion: c.motion,
        luma: c.luma,
        stock: c.stock,
        credit: c.credit,
      })),
      // Brand files ship in the bundle's public dir; Short resolves bare
      // names with staticFile().
      logoSrc: "logo.png",
      musicSrc: musicFile,
    };

    const browserExecutable = input.browserExecutable || undefined;
    const composition = await selectComposition({
      serveUrl,
      id: "PulseShort",
      inputProps: props,
      browserExecutable,
    });
    await renderWithTurn(`short ${path.basename(input.outFile)}`, {
      composition,
      serveUrl,
      codec: "h264",
      crf: 19,
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioBitrate: "192k",
      outputLocation: input.outFile,
      inputProps: props,
      concurrency: input.concurrency,
      browserExecutable,
      chromiumOptions: { gl: input.gl ?? "swangle" },
      // A busy PC can take far longer than the 30 s default to decode a clip frame.
      timeoutInMilliseconds: 180_000,
      onProgress: ({ progress }) => input.onProgress?.(progress),
    });
    const posterFrame = Math.min(
      composition.durationInFrames - 1,
      Math.round(0.9 * composition.fps),
    );
    if (input.thumbFile)
      await renderStill({
        composition,
        serveUrl,
        output: input.thumbFile,
        inputProps: props,
        frame: 0,
        imageFormat: "jpeg",
        jpegQuality: 90,
        browserExecutable,
        chromiumOptions: { gl: input.gl ?? "swangle" },
      });
    await renderStill({
      composition,
      serveUrl,
      output: input.posterFile,
      inputProps: props,
      frame: posterFrame,
      imageFormat: "jpeg",
      jpegQuality: 88,
      browserExecutable,
      chromiumOptions: { gl: input.gl ?? "swangle" },
    });
  } finally {
    await files.close();
  }
}

/** A community post graphic (1080x1350 jpeg) from pictures in `dir`, named relative to it. */
export async function renderEngage(input: {
  dir: string;
  outFile: string;
  props: Omit<EngageProps, "images"> & { imageFiles: string[] };
  browserExecutable?: string;
}): Promise<void> {
  const serveUrl = await getBundle();
  const files = await serveDir(input.dir);
  try {
    const { imageFiles, ...rest } = input.props;
    const props: EngageProps = {
      ...rest,
      images: imageFiles.map((f) => `${files.url}/${webPath(f)}`),
    };
    const still = await selectComposition({
      serveUrl,
      id: "PulseEngage",
      inputProps: props,
      browserExecutable: input.browserExecutable,
    });
    await renderStill({
      composition: still,
      serveUrl,
      output: input.outFile,
      inputProps: props,
      imageFormat: "jpeg",
      jpegQuality: 92,
      browserExecutable: input.browserExecutable,
    });
  } finally {
    await files.close();
  }
}

/** Renders a Short cut from a long ranking: the entry's section reframed for a phone, plus a poster frame. */
export async function renderCutdown(input: {
  episodeDir: string;
  props: Omit<CutdownProps, "videoSrc" | "backgroundSrc" | "logoSrc"> & {
    videoFile: string;
    backgroundFile: string | null;
  };
  outFile: string;
  posterFile: string;
  concurrency: number;
  gl?: "swangle" | "angle" | "egl" | "swiftshader" | "vulkan" | "angle-egl";
  browserExecutable?: string;
  onProgress?: (p: number) => void;
}): Promise<void> {
  const serveUrl = await getBundle();
  const files = await serveDir(input.episodeDir);
  try {
    const { videoFile, backgroundFile, ...rest } = input.props;
    const props: CutdownProps = {
      ...rest,
      videoSrc: `${files.url}/${webPath(videoFile)}`,
      backgroundSrc: backgroundFile
        ? `${files.url}/${webPath(backgroundFile)}`
        : null,
      logoSrc: "logo.png",
    };
    const browserExecutable = input.browserExecutable || undefined;
    const chromiumOptions = { gl: input.gl ?? "swangle" } as const;
    const composition = await selectComposition({
      serveUrl,
      id: "PulseCutdown",
      inputProps: props,
      browserExecutable,
    });
    await renderWithTurn(`cutdown ${path.basename(input.outFile)}`, {
      composition,
      serveUrl,
      codec: "h264",
      crf: 20,
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioBitrate: "192k",
      outputLocation: input.outFile,
      inputProps: props,
      concurrency: input.concurrency,
      browserExecutable,
      chromiumOptions,
      timeoutInMilliseconds: 180_000,
      onProgress: ({ progress }) => input.onProgress?.(progress),
    });
    await renderStill({
      composition,
      serveUrl,
      output: input.posterFile,
      inputProps: props,
      frame: Math.min(
        composition.durationInFrames - 1,
        Math.round(1.5 * composition.fps),
      ),
      imageFormat: "jpeg",
      jpegQuality: 88,
      browserExecutable,
      chromiumOptions,
    });
  } finally {
    await files.close();
  }
}
