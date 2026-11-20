// A hard cap on every download child. On 30 Oct 2026 the Halo ranking's trailer gather (yt-dlp downloads and
// the ffmpeg scans that follow) ran for hours inside one long-lane tick and the weekly recap behind it missed
// its slot. Every yt-dlp and ffmpeg child in the footage path now runs through runCapped: a timeout of at most
// DOWNLOAD_TIMEOUT_SECONDS (default 300), the child killed outright on overrun, and a plain error that names
// the cap so the log says why.

import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";
import { guardedYt, isYouTubeCall } from "./ytguard.ts";
import { envSwitch, signedPull } from "./ytsignin.ts";

const exec = promisify(execFile);

/** The cap, in seconds, read once from the environment (the asset modules carry no config object). */
export const DOWNLOAD_TIMEOUT_SECONDS = (() => {
  const n = Number(process.env.DOWNLOAD_TIMEOUT_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 300;
})();

/** The timeout a child gets: the caller's own, never above the cap; the cap when the caller set none. */
export function cappedTimeout(
  requestedMs: number | undefined,
  capSeconds = DOWNLOAD_TIMEOUT_SECONDS,
): number {
  const cap = Math.max(1, capSeconds) * 1000;
  if (!requestedMs || requestedMs <= 0) return cap;
  return Math.min(requestedMs, cap);
}

/** True when an execFile error means the child was killed for running past its timeout. */
export function timedOut(err: unknown): boolean {
  const e = err as { killed?: boolean; signal?: string | null } | undefined;
  return Boolean(e && e.killed && e.signal);
}

/**
 * execFile with the cap applied and SIGKILL on overrun (Windows has no gentler signal anyway). Resolves with
 * the child's stdout and stderr as text, like promisify(execFile). A yt-dlp call to YouTube goes through the
 * YouTube guard (src/lib/ytguard.ts): a kept answer first, then the hourly budget, spacing and any bot-check pause.
 * With SIGNED_CLIPS on (default off), a pull of one video that YouTube age-gated, or that the anonymous lane's
 * bot-check pause refused, is tried once more through the signed-in download account, within its clip share
 * (src/lib/ytsignin.ts signedPull); searches and Pulse's own videos never are.
 */
export function runCapped(
  cmd: string,
  args: readonly string[],
  opts: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const once = (a: readonly string[]) => guardedYt(cmd, a, () => runCappedRaw(cmd, a, opts));
  if (!isYouTubeCall(cmd, args) || !envSwitch("SIGNED_CLIPS")) return once(args);
  return signedPull(args, once, { enabled: true, what: "clip" });
}

async function runCappedRaw(
  cmd: string,
  args: readonly string[],
  opts: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  const timeout = cappedTimeout(opts.timeout);
  try {
    const r = await exec(cmd, args, {
      ...opts,
      timeout,
      killSignal: "SIGKILL",
    });
    return { stdout: String(r.stdout), stderr: String(r.stderr) };
  } catch (err) {
    if (timedOut(err)) {
      const e = err as Error & { stdout?: unknown; stderr?: unknown };
      const cap = timeout === cappedTimeout(undefined);
      const wrapped = new Error(
        `${cmd} killed after ${Math.round(timeout / 1000)}s${cap ? " (DOWNLOAD_TIMEOUT_SECONDS)" : ""}`,
      ) as Error & { stdout?: unknown; stderr?: unknown; killed: boolean };
      wrapped.stdout = e.stdout;
      wrapped.stderr = e.stderr;
      wrapped.killed = true;
      throw wrapped;
    }
    throw err;
  }
}
