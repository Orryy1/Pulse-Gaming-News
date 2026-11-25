// Where the stream recordings go once the PC is done with them, and the PC's disk floor (owner's storage rules,
// 25 Nov 2026):
//   - a recording fully indexed and past its days leaves D:, but is never deleted outright: these are the owner's and
//     his cousin's originals and Twitch expires its own copies. It moves to the Mac mini's USB drive
//     (/Volumes/Storage/<Channel> VODs) when that drive is there: copied, checked by size, and only then removed
//     here. Already there at the same size: removed here. The drive missing or slow: kept here and said so.
//   - nothing large is written to D: below VOD_MIN_FREE_GB (320) free: the Sleepy Lore Lodge stops at 300.
// The Mac's drive is reached over ssh from the PC's own task (never from the factory's main thread on the Mac), each
// call with a time limit, because the drive hangs at times.

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const DEFAULT_MIN_FREE_GB = 320;

export function minFreeGb(env: NodeJS.ProcessEnv): number {
  const n = Number(env.VOD_MIN_FREE_GB);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_FREE_GB;
}

/**
 * The floor for a folder's drive (pure): VOD_MIN_FREE_GB on the recordings' drive (VOD_ROOT, D:), where the Lore
 * Lodge needs its room; 30 GB on any other drive (the index and clip cache live on C:, small and pruned).
 */
export function floorFor(dir: string, env: NodeJS.ProcessEnv): number {
  const root = (p: string) => path.parse(path.resolve(p)).root.toLowerCase();
  return root(dir) === root(env.VOD_ROOT || "D:/pulse-data/vods") ? minFreeGb(env) : 30;
}

/** Free gigabytes on the drive holding `dir` (the nearest existing folder up the tree). */
export async function freeGb(dir: string): Promise<number> {
  let at = path.resolve(dir);
  while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  const s = await fsp.statfs(at);
  return (Number(s.bavail) * Number(s.bsize)) / 1e9;
}

/** Whether `bytes` more may be written under `dir` and still leave the floor (pure but for the free-space read). */
export async function roomFor(
  dir: string,
  bytes: number,
  floorGb: number,
  free: (d: string) => Promise<number> = freeGb,
): Promise<{ ok: boolean; freeGb: number; why?: string }> {
  const f = await free(dir);
  const after = f - bytes / 1e9;
  return after >= floorGb
    ? { ok: true, freeGb: f }
    : {
        ok: false,
        freeGb: f,
        why: `refused: ${path.parse(path.resolve(dir)).root} has ${f.toFixed(0)} GB free and needs ${floorGb} GB left after ${(bytes / 1e9).toFixed(1)} GB more`,
      };
}

export interface ArchiveDeps {
  /** True when the archive drive answers in time. */
  driveUp: () => Promise<boolean>;
  /** The size of a file on the archive drive, "missing" when it is not there. */
  remoteSize: (remote: string) => Promise<number | "missing">;
  /** Copies the local file to `remote` (a work name first, renamed when complete). */
  copy: (local: string, remote: string) => Promise<void>;
  remove: (local: string) => Promise<void>;
}

export type ArchiveOutcome =
  | { action: "already"; remote: string }
  | { action: "archived"; remote: string }
  | { action: "kept"; why: string };

/** The recording's place on the archive drive (pure): /Volumes/Storage/<its channel's folder>/<file name>. */
export function archivePath(file: string, root = "/Volumes/Storage"): string {
  const name = path.win32.basename(file);
  const folder = path.win32.basename(path.win32.dirname(file));
  return `${root}/${folder}/${name}`;
}

/** Moves one recording to the archive drive, or says why it stays. Never removes it here before the copy checks out. */
export async function archiveRecording(
  r: { file: string; bytes: number },
  deps: ArchiveDeps,
  root = "/Volumes/Storage",
): Promise<ArchiveOutcome> {
  const remote = archivePath(r.file, root);
  if (!(await deps.driveUp().catch(() => false)))
    return {
      action: "kept",
      why: "the Mac's archive drive is not there or not answering",
    };
  const before = await deps.remoteSize(remote).catch(() => undefined);
  if (before === undefined)
    return {
      action: "kept",
      why: "the archive drive did not answer about the file",
    };
  if (before === r.bytes) return removeHere(r.file, deps, { action: "already", remote });
  try {
    await deps.copy(r.file, remote);
  } catch (err) {
    return {
      action: "kept",
      why: `the copy failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const after = await deps.remoteSize(remote).catch(() => undefined);
  if (after !== r.bytes)
    return {
      action: "kept",
      why: `the copy is ${after === undefined || after === "missing" ? "missing" : `${after} bytes, not ${r.bytes}`}`,
    };
  return removeHere(r.file, deps, { action: "archived", remote });
}

/** The PC copy removed once the Mac's copy checks out; in use (ffmpeg reading it), kept for the next run. */
async function removeHere(file: string, deps: ArchiveDeps, done: ArchiveOutcome): Promise<ArchiveOutcome> {
  try {
    await deps.remove(file);
    return done;
  } catch (err) {
    return { action: "kept", why: `copied, but the PC copy is in use: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** A path inside single quotes for the Mac's shell (pure). */
export const shQuote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

function ssh(
  host: string,
  command: string,
  o: { timeoutMs: number; stdin?: fs.ReadStream },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command],
      {
        windowsHide: true,
        stdio: [o.stdin ? "pipe" : "ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      o.stdin?.destroy();
      child.kill("SIGKILL");
      reject(
        new Error(`ssh timed out after ${Math.round(o.timeoutMs / 1000)} s`),
      );
    }, o.timeoutMs);
    child.stdout!.on("data", (d) => (out += String(d)));
    child.stderr!.on("data", (d) => (err += String(d)));
    if (o.stdin) {
      // A read error here, or the far end closing early, ends the call; the exit code then says how it went.
      o.stdin.on("error", (e) => {
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(e);
      });
      child.stdin!.on("error", () => undefined);
      o.stdin.pipe(child.stdin!);
    }
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`ssh exit ${code}: ${err.trim().slice(0, 200)}`));
    });
  });
}

/** The real archive calls: the Mac mini over ssh (VOD_ARCHIVE_HOST, default pulse-mac). */
export function sshArchiveDeps(
  host = "pulse-mac",
  root = "/Volumes/Storage",
): ArchiveDeps {
  const mount = root.split("/").slice(0, 3).join("/") || root;
  return {
    driveUp: async () =>
      (
        await ssh(
          host,
          // The drive itself (/Volumes/<name>) must be its own mounted volume (not a stray folder on the Mac's own
          // disk) and writable; the folders under it are made as needed.
          `test -d ${shQuote(mount)} && test -w ${shQuote(mount)} && [ "$(stat -f %d ${shQuote(mount)})" != "$(stat -f %d /)" ] && echo up`,
          { timeoutMs: 30_000 },
        ).catch(() => "")
      ).trim() === "up",
    remoteSize: async (remote) => {
      const out = (
        await ssh(
          host,
          `if [ -f ${shQuote(remote)} ]; then stat -f %z ${shQuote(remote)}; else echo missing; fi`,
          { timeoutMs: 30_000 },
        )
      ).trim();
      return out === "missing" ? "missing" : Number(out);
    },
    copy: async (local, remote) => {
      const part = `${remote}.part`;
      const bytes = (await fsp.stat(local)).size;
      // The USB flash drive can fall to a few MB/s on long writes: the time limit allows 4 MB/s.
      const timeoutMs = Math.max(600_000, (bytes / 4e6) * 1000);
      await ssh(
        host,
        `mkdir -p ${shQuote(path.posix.dirname(remote))} && cat > ${shQuote(part)} && mv -f ${shQuote(part)} ${shQuote(remote)}`,
        {
          timeoutMs,
          stdin: fs.createReadStream(local),
        },
      );
    },
    remove: (local) => fsp.rm(local, { force: true }),
  };
}
