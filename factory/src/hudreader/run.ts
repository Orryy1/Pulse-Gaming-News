// Running the reader's Python (src/hudreader/py/hudread.py), always as its own process with -I from its own folder.
// Heavy runs take their turn: on the PC through the orchestrator (class gpu, project pulse, priority 20, with an
// estimate), on the Mac through ~/orch/macrun.sh, which waits while Pulse renders. The recording's path is passed as
// one argument with no shell in between, so names with "%" in them ("GTA V 100% [v...]") arrive intact.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { loadOrch, NoOrchestrator } from "../lib/orch.ts";
import { log } from "../lib/util.ts";
import type { HudSettings } from "./settings.ts";

export const PY_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "py",
);
export const PY_SCRIPT = path.join(PY_DIR, "hudread.py");

export interface ReadJob {
  video: string;
  profile: string;
  out: string;
  atlas?: string;
  start?: number;
  duration?: number;
}

/** The reader's arguments for one recording (pure). */
export function readArgs(s: HudSettings, j: ReadJob): string[] {
  const a = [
    "read",
    "--video",
    j.video,
    "--profile",
    j.profile,
    "--out",
    j.out,
    "--fps",
    String(s.fps),
    "--matcher",
    s.matcher,
    "--ocr",
    s.ocr ? "on" : "off",
    "--libs",
    s.libs,
    "--models",
    s.models,
    "--ffmpeg",
    FFMPEG,
    "--ffprobe",
    FFPROBE,
    "--progress",
  ];
  if (j.atlas) a.push("--atlas", j.atlas);
  if (j.start) a.push("--start", String(j.start));
  if (j.duration) a.push("--duration", String(j.duration));
  return a;
}

/** The command line to run (pure): the Mac's turn-taking script in front when that is the runner. */
export function commandFor(
  s: HudSettings,
  runner: HudSettings["runner"],
  job: string,
  args: string[],
): { cmd: string; args: string[] } {
  const py = [s.python, "-I", PY_SCRIPT, ...args];
  if (runner === "mac")
    return { cmd: "/bin/bash", args: [s.macrun, `pulse-hud-${job}`, ...py] };
  return { cmd: py[0]!, args: py.slice(1) };
}

/** Rough minutes a read takes, for the orchestrator's estimate: a sample costs about 60 ms on the CPU. */
export function estimateMinutes(seconds: number, fps: number): number {
  return Math.max(2, Math.ceil((seconds * fps * 0.06) / 60) + 2);
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The last JSON line the script printed. */
  result?: Record<string, unknown>;
}

export function lastJson(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.trim().split(/\r?\n/).reverse();
  for (const l of lines) {
    try {
      const v = JSON.parse(l);
      if (v && typeof v === "object" && !("progress" in v))
        return v as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

/**
 * Runs the reader. `est`: minutes for the orchestrator. Resolves with the exit code and output; never throws for a
 * failed run (the caller decides), only for a process that cannot start.
 */
export async function runHud(
  s: HudSettings,
  args: string[],
  o: {
    job: string;
    est: number;
    runner?: HudSettings["runner"];
    timeoutMs?: number;
    onLine?: (l: string) => void;
  },
): Promise<RunResult> {
  const runner = o.runner ?? s.runner;
  let release: (() => void) | undefined;
  if (runner === "orch") {
    try {
      const orch = await loadOrch();
      release = await orch.lease("gpu", {
        job: `pulse hud: ${o.job}`,
        project: "pulse",
        priority: 20,
        est: o.est,
      });
    } catch (err) {
      if (!(err instanceof NoOrchestrator)) throw err;
      log(
        "info",
        "hud reader: no PC orchestrator here; running without a turn",
      );
    }
  }
  const { cmd, args: argv } = commandFor(s, runner, o.job, args);
  try {
    return await new Promise<RunResult>((resolve, reject) => {
      const child = spawn(cmd, argv, {
        cwd: PY_DIR,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = o.timeoutMs
        ? setTimeout(() => child.kill("SIGKILL"), o.timeoutMs)
        : undefined;
      child.stdout.on("data", (d: Buffer) => {
        const text = d.toString();
        stdout += text;
        if (o.onLine)
          for (const l of text.split(/\r?\n/)) if (l.trim()) o.onLine(l);
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-20_000);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr, result: lastJson(stdout) });
      });
    });
  } finally {
    release?.();
  }
}
