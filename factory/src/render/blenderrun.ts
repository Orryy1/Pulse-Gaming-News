// Renders one Blender scene (factory/blender/render_scene.py) to a finished clip: Blender writes PNG frames, FFmpeg
// adds the film grain and a soft vignette and encodes H.264 (or ProRes 4444 with alpha), then FFmpeg checks the
// clip for black or frozen stretches. Used by the PC service (src/render/blenderserve.ts) and the proof tool
// (src/tools/blender.ts). The caller holds the orchestrator turn; this only runs the programs.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KIT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "blender",
);

/** Where Blender is on this machine (BLENDER_BIN overrides). */
export function blenderBin(
  env: Record<string, string | undefined> = process.env,
  platform = process.platform,
): string {
  if (env.BLENDER_BIN) return env.BLENDER_BIN;
  return platform === "win32"
    ? "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
    : `${os.homedir()}/PulseFactory/blender/Blender.app/Contents/MacOS/Blender`;
}

/** The kit's asset folder (fetch_assets.py) on this machine (BLENDER_ASSETS overrides). */
export function blenderAssets(
  env: Record<string, string | undefined> = process.env,
  platform = process.platform,
): string {
  if (env.BLENDER_ASSETS) return env.BLENDER_ASSETS;
  return platform === "win32"
    ? "D:/pulse-data/blender/assets"
    : `${os.homedir()}/PulseFactory/blender/assets`;
}

export interface SceneRun {
  scene: string;
  params: Record<string, unknown>;
  seconds: number;
  width?: number;
  height?: number;
  alpha?: boolean;
  /** A scratch folder for the frames (removed afterwards unless keepFrames). */
  workDir: string;
  /** The finished clip (.mp4, or .mov with alpha). */
  outFile: string;
  ffmpeg?: string;
  keepFrames?: boolean;
  timeoutMs?: number;
  quality?: "final" | "draft";
}

export interface SceneResult {
  file: string;
  renderSeconds: number;
  encodeSeconds: number;
  frames: number;
  /** Black stretches [from, to] seconds and frozen ones, from FFmpeg's detectors. */
  black: Array<[number, number]>;
  frozen: Array<[number, number]>;
  /** What the scene reported (text fitted inside the safe frame, lines, and so on). */
  info: Record<string, unknown>;
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = "";
    const keep = (d: Buffer) => {
      out += d.toString();
      if (out.length > 400_000) out = out.slice(-200_000);
    };
    p.stdout.on("data", keep);
    p.stderr.on("data", keep);
    const t = setTimeout(() => {
      p.kill();
      reject(
        new Error(
          `${path.basename(cmd)} timed out after ${Math.round(timeoutMs / 1000)} s`,
        ),
      );
    }, timeoutMs);
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, out });
    });
  });
}

/** FFmpeg's black and freeze stretches in a clip's log (pure). */
export function parseDetect(log: string): {
  black: Array<[number, number]>;
  frozen: Array<[number, number]>;
} {
  const black: Array<[number, number]> = [];
  for (const m of log.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g))
    black.push([Number(m[1]), Number(m[2])]);
  const frozen: Array<[number, number]> = [];
  let start: number | undefined;
  for (const m of log.matchAll(
    /lavfi\.freezedetect\.freeze_(start|end): ([\d.]+)/g,
  )) {
    if (m[1] === "start") start = Number(m[2]);
    else if (start !== undefined) {
      frozen.push([start, Number(m[2])]);
      start = undefined;
    }
  }
  if (start !== undefined) frozen.push([start, Infinity]);
  return { black, frozen };
}

/** The FFmpeg arguments that turn a frame folder into the finished clip (pure). */
export function encodeArgs(
  framesGlob: string,
  outFile: string,
  alpha: boolean,
): string[] {
  // Grain on the brightness only (no colour noise), changing every frame; a soft vignette on opaque clips.
  const grain = "noise=c0s=7:c0f=t";
  return alpha
    ? [
        "-y",
        "-framerate",
        "30",
        "-i",
        framesGlob,
        "-vf",
        grain,
        "-c:v",
        "prores_ks",
        "-profile:v",
        "4",
        "-pix_fmt",
        "yuva444p10le",
        "-vendor",
        "apl0",
        outFile,
      ]
    : [
        "-y",
        "-framerate",
        "30",
        "-i",
        framesGlob,
        "-vf",
        `${grain},vignette=angle=PI/5:mode=forward,format=yuv420p`,
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "16",
        "-movflags",
        "+faststart",
        outFile,
      ];
}

export async function renderScene(r: SceneRun): Promise<SceneResult> {
  const ffmpeg = r.ffmpeg || process.env.FFMPEG_PATH || "ffmpeg";
  const frames = path.join(r.workDir, "frames");
  await fs.rm(frames, { recursive: true, force: true });
  await fs.mkdir(r.workDir, { recursive: true });
  const params = {
    ...r.params,
    scene: r.scene,
    out: r.workDir,
    seconds: r.seconds,
    width: r.width ?? 1920,
    height: r.height ?? 1080,
    alpha: !!r.alpha,
    quality: r.quality ?? "final",
    assets: blenderAssets(),
  };
  const pfile = path.join(r.workDir, "params.json");
  await fs.writeFile(pfile, JSON.stringify(params));
  const bin = blenderBin();
  if (!existsSync(bin)) throw new Error(`no Blender at ${bin}`);
  const t0 = Date.now();
  const b = await run(
    bin,
    [
      "-b",
      "--factory-startup",
      "-P",
      path.join(KIT_DIR, "render_scene.py"),
      "--",
      "--json",
      pfile,
    ],
    r.timeoutMs ?? 20 * 60_000,
  );
  const done = /PULSE3D_DONE (.+)/.exec(b.out);
  if (b.code !== 0 || !done) {
    const why =
      /PULSE3D_FAILED (.+)/.exec(b.out)?.[1] ??
      b.out.split("\n").filter(Boolean).slice(-3).join(" | ");
    throw new Error(`Blender ${r.scene} failed: ${why.slice(0, 400)}`);
  }
  const renderSeconds = (Date.now() - t0) / 1000;
  const t1 = Date.now();
  await fs.mkdir(path.dirname(r.outFile), { recursive: true });
  // Encoded beside the final name and moved into place only when whole, so a half-written clip is never served.
  const ext = path.extname(r.outFile);
  const part = `${r.outFile.slice(0, -ext.length)}.part${ext}`;
  const e = await run(
    ffmpeg,
    encodeArgs(path.join(frames, "f_%04d.png"), part, !!r.alpha),
    10 * 60_000,
  );
  if (e.code !== 0) {
    await fs.rm(part, { force: true });
    throw new Error(`encoding ${r.scene} failed: ${e.out.slice(-400)}`);
  }
  const encodeSeconds = (Date.now() - t1) / 1000;
  const d = await run(
    ffmpeg,
    [
      "-hide_banner",
      "-i",
      part,
      "-vf",
      "blackdetect=d=0.25:pic_th=0.97,freezedetect=n=0.0015:d=1.2,metadata=mode=print",
      "-an",
      "-f",
      "null",
      "-",
    ],
    5 * 60_000,
  );
  const det = parseDetect(d.out);
  await fs.rename(part, r.outFile);
  if (!r.keepFrames) await fs.rm(frames, { recursive: true, force: true });
  const info = JSON.parse(done[1]!) as Record<string, unknown>;
  return {
    file: r.outFile,
    renderSeconds,
    encodeSeconds,
    frames: Number(info.frames ?? 0),
    info,
    ...det,
  };
}
