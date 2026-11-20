// Apple's on-device picture tools on the Mac mini (12 Nov 2026; the owner's "do all" of 5 Nov): Vision's
// subject finders for the Shorts' smart crop (APPLE_SMART_CROP, src/render/smartcrop.ts) and its foreground
// mask for clean subject cut-outs on thumbnails and the Short's opening poster (APPLE_SUBJECT_LIFT). Runs
// src/assets/applevision.py through the Python that reads picture text (MAC_OCR_PYTHON, made by
// mac/migrate.sh prepare). Anywhere but the Mac, or on any failure, it finds nothing and the factory carries
// on as before: centre crops and the depth model's cut-outs.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage, log } from "../lib/util.ts";
import { FFMPEG } from "../lib/bin.ts";
import { MAC_OCR_PYTHON } from "./ocr.ts";
import { layerName } from "../render/parallax.ts";
import {
  clipCrop,
  type ClipCrop,
  type FrameBoxes,
} from "../render/smartcrop.ts";

const run = promisify(execFile);
const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "applevision.py",
);

/** Frames a second sampled from a clip for the smart crop: enough to follow a run, cheap on a 4-second clip. */
export const CROP_SAMPLE_FPS = 4;

/** The command for one applevision.py run on this machine; undefined off the Mac. */
export function appleVisionCommand(
  platform: string,
  mode: "boxes" | "lift",
  list: string,
  python = MAC_OCR_PYTHON,
): { cmd: string; args: string[] } | undefined {
  if (platform !== "darwin") return undefined;
  return { cmd: python, args: ["-I", SCRIPT, mode, list] };
}

/** applevision.py's boxes output, by file. */
export function parseBoxes(
  raw: string,
): Map<string, FrameBoxes & { width: number; height: number }> {
  const out = new Map<string, FrameBoxes & { width: number; height: number }>();
  const body = JSON.parse(raw) as {
    results?: Array<
      Partial<FrameBoxes> & {
        file: string;
        width?: number;
        height?: number;
        error?: string;
      }
    >;
  };
  for (const r of body.results ?? []) {
    if (r.error) continue;
    out.set(r.file, {
      width: r.width ?? 0,
      height: r.height ?? 0,
      salient: r.salient ?? [],
      objects: r.objects ?? [],
      humans: r.humans ?? [],
      faces: r.faces ?? [],
      animals: r.animals ?? [],
    });
  }
  return out;
}

export interface LiftResult {
  src: string;
  out: string;
  ok: boolean;
  /** The opaque share of the picture. */
  share?: number;
  /** The cut-out's centre across the picture, 0-1. */
  x?: number;
  /** Its box: [left, top, right, bottom] as fractions. */
  box?: [number, number, number, number];
  error?: string;
}

/** A cut-out worth putting in front of words: something lifted, neither a speck nor the whole picture. */
export function usableLift(r: LiftResult | undefined): boolean {
  return !!r?.ok && (r.share ?? 0) >= 0.03 && (r.share ?? 1) <= 0.8;
}

let warned = false;
async function ready(): Promise<boolean> {
  if (process.platform !== "darwin" || process.env.NODE_TEST_CONTEXT)
    return false;
  const ok = await fs
    .access(MAC_OCR_PYTHON)
    .then(() => true)
    .catch(() => false);
  if (!ok && !warned) {
    warned = true;
    log(
      "warn",
      "no Apple Vision Python on this Mac (run mac/migrate.sh prepare); smart crops and lifts are off",
      {
        python: MAC_OCR_PYTHON,
      },
    );
  }
  return ok;
}

async function runVision(
  mode: "boxes" | "lift",
  items: unknown[],
): Promise<string | undefined> {
  const list = path.join(
    os.tmpdir(),
    `pulse-applevision-${process.pid}-${Date.now()}.json`,
  );
  const command = appleVisionCommand(process.platform, mode, list);
  if (!command) return undefined;
  try {
    await fs.writeFile(list, JSON.stringify(items));
    const { stdout } = await run(command.cmd, command.args, {
      timeout: 5 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } finally {
    await fs.rm(list, { force: true }).catch(() => undefined);
  }
}

/** Vision's finds in pictures (absolute paths); an empty map off the Mac or on any failure. */
export async function readBoxes(
  files: string[],
): Promise<Map<string, FrameBoxes & { width: number; height: number }>> {
  if (!files.length || !(await ready())) return new Map();
  try {
    const raw = await runVision("boxes", files);
    return raw ? parseBoxes(raw) : new Map();
  } catch (err) {
    log("warn", "Apple Vision boxes not read", { error: errorMessage(err) });
    return new Map();
  }
}

/**
 * The smart crop of one clip file (absolute path): frames sampled at CROP_SAMPLE_FPS, Vision's finds in
 * each, smoothed into a path. Undefined off the Mac, on failure or when nothing was found.
 */
export async function smartCrop(file: string): Promise<ClipCrop | undefined> {
  if (!(await ready())) return undefined;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-crop-"));
  try {
    await run(FFMPEG, [
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      `fps=${CROP_SAMPLE_FPS},scale=640:-2`,
      "-q:v",
      "4",
      path.join(tmp, "%04d.jpg"),
    ]);
    const frames = (await fs.readdir(tmp))
      .filter((f) => f.endsWith(".jpg"))
      .sort();
    if (!frames.length) return undefined;
    const files = frames.map((f) => path.join(tmp, f));
    const boxes = await readBoxes(files);
    const first = boxes.get(files[0]!) ?? [...boxes.values()][0];
    if (!first?.width || !first.height) return undefined;
    return clipCrop(
      first.width / first.height,
      files.map((f, i) => ({ t: i / CROP_SAMPLE_FPS, boxes: boxes.get(f) })),
    );
  } catch (err) {
    log("warn", "smart crop not made; the clip keeps its centre crop", {
      file: path.basename(file),
      error: errorMessage(err),
    });
    return undefined;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Lifts the subjects out of pictures (absolute paths in and out); an empty map off the Mac or on failure. */
export async function liftSubjects(
  jobs: Array<{ src: string; out: string }>,
): Promise<Map<string, LiftResult>> {
  const out = new Map<string, LiftResult>();
  if (!jobs.length || !(await ready())) return out;
  try {
    const raw = await runVision("lift", jobs);
    const body = JSON.parse(raw ?? "{}") as { results?: LiftResult[] };
    for (const r of body.results ?? []) out.set(r.src, r);
  } catch (err) {
    log("warn", "Apple subject lift failed", { error: errorMessage(err) });
  }
  return out;
}

/**
 * A picture's subject cut out for a thumbnail or the Short's opening poster: written beside the depth
 * layers (assets/px, named as they are) and returned relative to the episode folder with its centre
 * across; undefined when nothing usable was lifted.
 */
export async function appleCut(
  episodeDir: string,
  file: string,
): Promise<{ fg: string; x?: number } | undefined> {
  const rel = path.join("assets", "px", `${layerName(file)}_lift.png`);
  const abs = path.join(episodeDir, rel);
  const src = path.join(episodeDir, file);
  if (!(await ready())) return undefined;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const r = (await liftSubjects([{ src, out: abs }])).get(src);
  if (!usableLift(r)) {
    await fs.rm(abs, { force: true }).catch(() => undefined);
    return undefined;
  }
  return { fg: rel, x: r!.x };
}
