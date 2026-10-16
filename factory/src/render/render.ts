// Node-side render driver: bundles the Remotion project once per process,
// serves the episode's files over a loopback HTTP server, and renders the MP4
// plus a poster frame.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { ShortProps } from "./props.ts";

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
  ".wav": "audio/wav",
};

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
  props: Omit<ShortProps, "audioSrc" | "images" | "logoSrc" | "musicSrc"> & {
    audioFile: string | null;
    imageFiles: Array<{ file: string; kind: string; aspect: number }>;
    musicFile: string | null;
  };
  outFile: string;
  posterFile: string;
  concurrency: number;
  browserExecutable?: string;
  onProgress?: (p: number) => void;
}

export async function renderShort(input: RenderInput): Promise<void> {
  const serveUrl = await getBundle();
  const files = await serveDir(input.episodeDir);
  try {
    const { audioFile, imageFiles, musicFile, ...rest } = input.props;
    const props: ShortProps = {
      ...rest,
      audioSrc: audioFile ? `${files.url}/${audioFile}` : null,
      images: imageFiles.map((i) => ({ src: `${files.url}/${i.file}`, kind: i.kind, aspect: i.aspect })),
      // Brand files ship in the bundle's public dir; Short resolves bare
      // names with staticFile().
      logoSrc: "logo.png",
      musicSrc: musicFile,
    };

    const browserExecutable = input.browserExecutable || undefined;
    const composition = await selectComposition({ serveUrl, id: "PulseShort", inputProps: props, browserExecutable });
    await renderMedia({
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
      chromiumOptions: { gl: "swangle" },
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
      chromiumOptions: { gl: "swangle" },
    });
  } finally {
    await files.close();
  }
}
