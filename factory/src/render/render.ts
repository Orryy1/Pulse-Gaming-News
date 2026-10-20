// Node-side render driver: bundles the Remotion project once per process,
// serves the episode's files over a loopback HTTP server, and renders the MP4
// plus a poster frame.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { ShortProps } from "./props.ts";
import { unloadLocalVision } from "../assets/localvision.ts";
import type { LongProps } from "./Long.tsx";
import type { ThumbProps } from "./Brand.tsx";
import type { EngageProps } from "./Engage.tsx";
import type { CutdownProps } from "./Cutdown.tsx";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(here, "index.ts");
const PUBLIC_DIR = path.join(here, "..", "..", "public");

let bundlePromise: Promise<string> | undefined;
function getBundle(): Promise<string> {
  bundlePromise ??= bundle({ entryPoint: ENTRY, publicDir: PUBLIC_DIR, onProgress: () => undefined });
  return bundlePromise;
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
async function renderMemory(): Promise<{ offthreadVideoCacheSizeInBytes: number }> {
  await unloadLocalVision();
  const GB = 1024 ** 3;
  return { offthreadVideoCacheSizeInBytes: Math.round(Math.min(6 * GB, Math.max(2 * GB, os.freemem() * 0.5))) };
}

/** Read-only loopback file server rooted at one directory. */
async function serveDir(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!).replace(/^\/+/, "");
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": fs.statSync(file).size,
      "access-control-allow-origin": "*",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

export interface RenderInput {
  episodeDir: string;
  props: Omit<ShortProps, "audioSrc" | "images" | "clips" | "logoSrc" | "musicSrc"> & {
    audioFile: string | null;
    imageFiles: Array<{ file: string; kind: string; aspect: number; blurFile?: string; beatIndex?: number }>;
    clipFiles: Array<{ file: string; durationSeconds: number; blurFile?: string; beatIndex?: number; role?: "hook"; motion?: number; luma?: number; stock?: boolean }>;
    musicFile: string | null;
  };
  outFile: string;
  posterFile: string;
  concurrency: number;
  gl?: "swangle" | "angle" | "egl" | "swiftshader" | "vulkan" | "angle-egl";
  browserExecutable?: string;
  onProgress?: (p: number) => void;
}

export interface LongRenderInput {
  episodeDir: string;
  props: Omit<LongProps, "audioSrc" | "images" | "clips" | "logoSrc" | "musicSrc"> & {
    audioFile: string | null;
    imageFiles: Array<{ file: string; kind: string; aspect: number; beatIndex?: number; credit?: string; moment?: number; label?: string }>;
    clipFiles: Array<{ file: string; durationSeconds: number; beatIndex?: number; role?: "hook"; moment?: number; credit?: string; audio?: boolean }>;
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
}

type ThumbInput = Omit<ThumbProps, "imageSrc" | "image2Src"> & { imageFile: string | null; image2File?: string | null };

/** Renders the 16:9 long-form video, a poster frame and a 1280x720 thumbnail. */
export async function renderLong(input: LongRenderInput): Promise<void> {
  const serveUrl = await getBundle();
  const files = await serveDir(input.episodeDir);
  try {
    const { audioFile, imageFiles, clipFiles, musicFile, ...rest } = input.props;
    const props: LongProps = {
      ...rest,
      audioSrc: audioFile ? `${files.url}/${audioFile}` : null,
      images: imageFiles.map((i) => ({ src: `${files.url}/${i.file}`, kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, credit: i.credit, moment: i.moment, label: i.label })),
      clips: clipFiles.map((c) => ({ src: `${files.url}/${c.file}`, durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment, credit: c.credit, audio: c.audio })),
      logoSrc: "logo.png",
      musicSrc: musicFile,
    };
    const browserExecutable = input.browserExecutable || undefined;
    const chromiumOptions = { gl: input.gl ?? "swangle" } as const;
    const composition = await selectComposition({ serveUrl, id: "PulseLong", inputProps: props, browserExecutable });
    await renderMedia({
      ...(await renderMemory()),
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
      // A busy PC can take far longer than the 30 s default to decode a clip frame.
      timeoutInMilliseconds: 180_000,
      onProgress: ({ progress }) => input.onProgress?.(progress),
    });
    await renderStill({ composition, serveUrl, output: input.posterFile, inputProps: props, frame: Math.min(composition.durationInFrames - 1, Math.round(2 * composition.fps)), imageFormat: "jpeg", jpegQuality: 88, browserExecutable, chromiumOptions });
    for (const t of [{ file: input.thumbFile, thumb: input.thumb }, ...(input.thumbVariants ?? [])]) {
      const { imageFile, image2File, ...thumb } = t.thumb;
      const thumbProps: ThumbProps = {
        ...thumb,
        imageSrc: imageFile ? `${files.url}/${imageFile}` : null,
        image2Src: image2File ? `${files.url}/${image2File}` : null,
      };
      const still = await selectComposition({ serveUrl, id: "PulseThumb", inputProps: thumbProps, browserExecutable });
      await renderStill({ composition: still, serveUrl, output: t.file, inputProps: thumbProps, imageFormat: "jpeg", jpegQuality: 90, browserExecutable, chromiumOptions });
    }
  } finally {
    await files.close();
  }
}

export async function renderShort(input: RenderInput): Promise<void> {
  const serveUrl = await getBundle();
  const files = await serveDir(input.episodeDir);
  try {
    const { audioFile, imageFiles, clipFiles, musicFile, ...rest } = input.props;
    const props: ShortProps = {
      ...rest,
      audioSrc: audioFile ? `${files.url}/${audioFile}` : null,
      images: imageFiles.map((i) => ({ src: `${files.url}/${i.file}`, kind: i.kind, aspect: i.aspect, blurSrc: i.blurFile ? `${files.url}/${i.blurFile}` : null, beatIndex: i.beatIndex })),
      clips: clipFiles.map((c) => ({ src: `${files.url}/${c.file}`, durationSeconds: c.durationSeconds, blurSrc: c.blurFile ? `${files.url}/${c.blurFile}` : null, beatIndex: c.beatIndex, role: c.role, motion: c.motion, luma: c.luma, stock: c.stock })),
      // Brand files ship in the bundle's public dir; Short resolves bare
      // names with staticFile().
      logoSrc: "logo.png",
      musicSrc: musicFile,
    };

    const browserExecutable = input.browserExecutable || undefined;
    const composition = await selectComposition({ serveUrl, id: "PulseShort", inputProps: props, browserExecutable });
    await renderMedia({
      ...(await renderMemory()),
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
    const posterFrame = Math.min(composition.durationInFrames - 1, Math.round(0.9 * composition.fps));
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
export async function renderEngage(input: { dir: string; outFile: string; props: Omit<EngageProps, "images"> & { imageFiles: string[] }; browserExecutable?: string }): Promise<void> {
  const serveUrl = await getBundle();
  const files = await serveDir(input.dir);
  try {
    const { imageFiles, ...rest } = input.props;
    const props: EngageProps = { ...rest, images: imageFiles.map((f) => `${files.url}/${f}`) };
    const still = await selectComposition({ serveUrl, id: "PulseEngage", inputProps: props, browserExecutable: input.browserExecutable });
    await renderStill({ composition: still, serveUrl, output: input.outFile, inputProps: props, imageFormat: "jpeg", jpegQuality: 92, browserExecutable: input.browserExecutable });
  } finally {
    await files.close();
  }
}

/** Renders a Short cut from a long ranking: the entry's section reframed for a phone, plus a poster frame. */
export async function renderCutdown(input: {
  episodeDir: string;
  props: Omit<CutdownProps, "videoSrc" | "backgroundSrc" | "logoSrc"> & { videoFile: string; backgroundFile: string | null };
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
      videoSrc: `${files.url}/${videoFile}`,
      backgroundSrc: backgroundFile ? `${files.url}/${backgroundFile}` : null,
      logoSrc: "logo.png",
    };
    const browserExecutable = input.browserExecutable || undefined;
    const chromiumOptions = { gl: input.gl ?? "swangle" } as const;
    const composition = await selectComposition({ serveUrl, id: "PulseCutdown", inputProps: props, browserExecutable });
    await renderMedia({
      ...(await renderMemory()),
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
    await renderStill({ composition, serveUrl, output: input.posterFile, inputProps: props, frame: Math.min(composition.durationInFrames - 1, Math.round(1.5 * composition.fps)), imageFormat: "jpeg", jpegQuality: 88, browserExecutable, chromiumOptions });
  } finally {
    await files.close();
  }
}
