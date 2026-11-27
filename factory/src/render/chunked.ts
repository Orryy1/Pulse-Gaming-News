// Chunked, resumable renders (RENDER_CHUNKED, 14 Nov 2026). A long video is drawn as a run of frame-range chunks,
// each saved to its own file the moment it is finished, with a manifest beside them. A render that fails, freezes
// or is stopped part-way picks up at the first missing chunk on its next attempt instead of starting again from
// frame 0. The picture chunks are joined without re-encoding (ffmpeg's concat demuxer, stream copy) and the sound,
// drawn once for the whole range, is laid under them.
//
// Everything that touches Remotion or ffmpeg is passed in, so the planning, the manifest and the resume rules are
// tested without a browser (tests/renderchunks.test.ts). render.ts wires the real renderer.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** One chunk: frames `from` to `to`, both included. */
export interface Chunk {
  index: number;
  from: number;
  to: number;
}

/** What is on disk: which chunks are finished, and for which render. */
export interface ChunkManifest {
  version: 1;
  /** Fingerprint of everything that decides the pixels and the sound (chunkKey). A different key starts afresh. */
  key: string;
  range: [number, number];
  chunkFrames: number;
  /** Finished chunks by index: their frame count and file size, checked again before they are trusted. */
  done: Record<string, { frames: number; bytes: number }>;
  /** The sound for the whole range, once drawn. */
  audio?: { bytes: number };
}

/** Manifest and chunk file names (the patterns live here so the clean-up and the tests agree). */
export const MANIFEST = "manifest.json";
export const CHUNK_FILE = (i: number): string =>
  `c${String(i).padStart(4, "0")}.mp4`;
export const PART_FILE = (i: number): string =>
  `c${String(i).padStart(4, "0")}.part.mp4`;
export const AUDIO_FILE = "audio.m4a";
export const AUDIO_PART = "audio.part.m4a";
/** Files a stopped render leaves half-written: never trusted, removed before a resume. */
export const PARTIAL_RE = /\.part\.(mp4|m4a)$/;

/** The folder a render's chunks live in: beside its output, so a retry of the same step finds them. */
export const chunkDirFor = (outFile: string): string => `${outFile}.chunks`;

/**
 * Splits frames first..last (both included) into chunks of `size` frames (pure). The last chunk takes the
 * remainder; a remainder under a quarter of a chunk joins the one before, so no chunk is a sliver.
 */
export function planChunks(first: number, last: number, size: number): Chunk[] {
  if (!Number.isInteger(first) || !Number.isInteger(last) || last < first)
    throw new Error(`planChunks: bad range ${first}-${last}`);
  const step = Math.max(1, Math.floor(size));
  const chunks: Chunk[] = [];
  for (let from = first, index = 0; from <= last; from += step, index++)
    chunks.push({ index, from, to: Math.min(last, from + step - 1) });
  const tail = chunks[chunks.length - 1]!;
  if (chunks.length > 1 && tail.to - tail.from + 1 < step / 4) {
    chunks.pop();
    chunks[chunks.length - 1]!.to = tail.to;
  }
  return chunks;
}

/**
 * The render's fingerprint (pure): a hash of whatever decides the output. Callers pass the composition, the props
 * with the loopback server's address taken out (its port changes every run), the encoder settings, the code's
 * bundle hash and the sizes and times of the episode files the props name. Key order does not matter.
 */
export function chunkKey(parts: Record<string, unknown>): string {
  return crypto
    .createHash("sha256")
    .update(stableJson(parts))
    .digest("hex")
    .slice(0, 32);
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** The episode files a props object names through the loopback server (`<url>/<file>`), each once (pure). */
export function servedFiles(propsJson: string, filesUrl: string): string[] {
  const out = new Set<string>();
  const prefix = filesUrl.endsWith("/") ? filesUrl : `${filesUrl}/`;
  let at = propsJson.indexOf(prefix);
  while (at >= 0) {
    const start = at + prefix.length;
    const end = propsJson.indexOf('"', start);
    if (end < 0) break;
    out.add(decodeURIComponent(propsJson.slice(start, end)));
    at = propsJson.indexOf(prefix, end);
  }
  return [...out].sort();
}

/** Size and modification time of each named file under `root` ("missing" when absent): part of the key. */
export function fileStamps(
  root: string,
  files: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    try {
      const st = fs.statSync(path.join(root, f));
      out[f] = `${st.size}:${Math.round(st.mtimeMs)}`;
    } catch {
      out[f] = "missing";
    }
  }
  return out;
}

/** A hash of the Remotion bundle's code (its top-level .js and index.html): new code, new chunks. */
export function bundleHash(serveUrl: string): string {
  const h = crypto.createHash("sha256");
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(serveUrl)
      .filter((n) => BUNDLE_CODE_RE.test(n))
      .sort();
  } catch {
    return "unreadable";
  }
  for (const n of names) {
    h.update(n);
    h.update(fs.readFileSync(path.join(serveUrl, n)));
  }
  return h.digest("hex").slice(0, 16);
}
export const BUNDLE_CODE_RE = /^(index\.html|.*\.js)$/;

export interface ChunkedRenderDeps {
  /** Draws frames from..to (both included), picture only, into `file`. */
  renderVideo: (
    from: number,
    to: number,
    file: string,
    onProgress: (share: number) => void,
  ) => Promise<void>;
  /** Draws the sound for the whole range into `file`. */
  renderAudio: (file: string) => Promise<void>;
  /** How many picture frames a finished file holds. */
  countFrames: (file: string) => Promise<number>;
  /** Joins the picture chunks in order with the sound into `out`, without re-encoding the picture. */
  join: (chunkFiles: string[], audioFile: string, out: string) => Promise<void>;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface ChunkedRenderInput {
  dir: string;
  key: string;
  range: [number, number];
  chunkFrames: number;
  outFile: string;
  onProgress?: (share: number) => void;
  /** Keep the chunk folder after a successful join (the proofs compare chunks); removed by default. */
  keepChunks?: boolean;
}

export interface ChunkedRenderResult {
  chunks: number;
  rendered: number;
  reused: number;
  audioReused: boolean;
}

/** Reads the manifest, or undefined when there is none or it is unreadable. */
export async function readManifest(
  dir: string,
): Promise<ChunkManifest | undefined> {
  try {
    const m = JSON.parse(
      await fsp.readFile(path.join(dir, MANIFEST), "utf8"),
    ) as ChunkManifest;
    return m && m.version === 1 && typeof m.key === "string" && m.done
      ? m
      : undefined;
  } catch {
    return undefined;
  }
}

/** Writes the manifest through a temporary file and a rename, so a stop mid-write never leaves half a manifest. */
export async function writeManifest(
  dir: string,
  m: ChunkManifest,
): Promise<void> {
  const tmp = path.join(dir, `${MANIFEST}.tmp`);
  await fsp.writeFile(tmp, JSON.stringify(m, null, 1));
  await fsp.rename(tmp, path.join(dir, MANIFEST));
}

/**
 * Renders a frame range in chunks, reusing every chunk a previous attempt finished for the same key, then joins
 * them into `outFile`. A chunk counts as finished only when its file is in the manifest with the same size and
 * frame count it had when it was recorded; anything else is drawn again. A different key (new props, new code,
 * other settings, a changed episode file) clears the folder first.
 */
export async function renderChunked(
  input: ChunkedRenderInput,
  deps: ChunkedRenderDeps,
): Promise<ChunkedRenderResult> {
  const { dir, key, range, chunkFrames } = input;
  const plan = planChunks(range[0], range[1], chunkFrames);
  const total = range[1] - range[0] + 1;
  await fsp.mkdir(dir, { recursive: true });
  let m = await readManifest(dir);
  if (
    !m ||
    m.key !== key ||
    m.chunkFrames !== chunkFrames ||
    m.range[0] !== range[0] ||
    m.range[1] !== range[1]
  ) {
    if (m)
      deps.log?.("render chunks: settings or inputs changed, starting afresh", {
        dir,
      });
    for (const name of await fsp.readdir(dir))
      await fsp.rm(path.join(dir, name), { recursive: true, force: true });
    m = { version: 1, key, range, chunkFrames, done: {} };
    await writeManifest(dir, m);
  }
  for (const name of await fsp.readdir(dir))
    if (PARTIAL_RE.test(name))
      await fsp.rm(path.join(dir, name), { force: true });

  let rendered = 0;
  let reused = 0;
  let doneFrames = 0;
  for (const c of plan) {
    const frames = c.to - c.from + 1;
    const file = path.join(dir, CHUNK_FILE(c.index));
    const rec = m.done[String(c.index)];
    if (rec && (await sizeOf(file)) === rec.bytes && rec.frames === frames) {
      reused++;
      doneFrames += frames;
      input.onProgress?.(doneFrames / total);
      continue;
    }
    delete m.done[String(c.index)];
    const part = path.join(dir, PART_FILE(c.index));
    await deps.renderVideo(c.from, c.to, part, (share) =>
      input.onProgress?.((doneFrames + share * frames) / total),
    );
    const got = await deps.countFrames(part);
    if (got !== frames)
      throw new Error(
        `render chunk ${c.index}: ${got} frames, expected ${frames}`,
      );
    await fsp.rename(part, file);
    m.done[String(c.index)] = { frames, bytes: (await sizeOf(file))! };
    await writeManifest(dir, m);
    rendered++;
    doneFrames += frames;
    deps.log?.("render chunk done", {
      chunk: c.index + 1,
      of: plan.length,
      frames: `${c.from}-${c.to}`,
    });
  }

  const audio = path.join(dir, AUDIO_FILE);
  const audioReused = !!m.audio && (await sizeOf(audio)) === m.audio.bytes;
  if (!audioReused) {
    const part = path.join(dir, AUDIO_PART);
    await deps.renderAudio(part);
    await fsp.rename(part, audio);
    m.audio = { bytes: (await sizeOf(audio))! };
    await writeManifest(dir, m);
  }

  const joined = `${input.outFile}.joining.mp4`;
  await fsp.rm(joined, { force: true });
  await deps.join(
    plan.map((c) => path.join(dir, CHUNK_FILE(c.index))),
    audio,
    joined,
  );
  const got = await deps.countFrames(joined);
  if (got !== total) {
    await fsp.rm(joined, { force: true });
    throw new Error(`render chunks joined to ${got} frames, expected ${total}`);
  }
  await fsp.rename(joined, input.outFile);
  if (!input.keepChunks) await fsp.rm(dir, { recursive: true, force: true });
  return { chunks: plan.length, rendered, reused, audioReused };
}

async function sizeOf(file: string): Promise<number | undefined> {
  try {
    return (await fsp.stat(file)).size;
  } catch {
    return undefined;
  }
}

/** The concat demuxer's list file for these chunk files (pure): one quoted line each, quotes escaped. */
export function concatList(files: string[]): string {
  return (
    files
      .map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
      .join("\n") + "\n"
  );
}

/** ffmpeg arguments that join the listed chunks with the sound, copying both streams (pure). */
export function joinArgs(
  listFile: string,
  audioFile: string,
  out: string,
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-i",
    audioFile,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    out,
  ];
}

/** ffprobe arguments that count a file's picture packets (fast: no decode) (pure). */
export function countArgs(file: string): string[] {
  return [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-count_packets",
    "-show_entries",
    "stream=nb_read_packets",
    "-of",
    "csv=p=0",
    file,
  ];
}
