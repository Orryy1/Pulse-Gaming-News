// Where the owner's TinoTV stream recordings (VODs) live on the Mac (15 Nov 2026). The Mac's own disk sat under its
// floor, so every nightly download was skipped; the owner plugged in a 1 TB SanDisk mounted at /Volumes/Storage.
// VOD_DIR names the folder outright. Otherwise the USB volume is used when it is mounted and writable, else
// ~/Videos/TinoTV VODs as before. It is a USB flash drive: fine for whole VOD files, not for random-access work.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const USB_VOD_DIR = path.join("/Volumes", "Storage", "TinoTV VODs");
export const HOME_VOD_DIR = path.join(os.homedir(), "Videos", "TinoTV VODs");

/** True when the folder can be created and written (a missing mount or a macOS permission refusal is false). */
export function writableDir(dir: string): boolean {
  try {
    if (!fs.existsSync(path.dirname(dir))) return false;
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function vodDirectory(
  env: NodeJS.ProcessEnv = process.env,
  canWrite: (dir: string) => boolean = writableDir,
): string {
  const set = env.VOD_DIR?.trim();
  if (set) return set;
  return canWrite(USB_VOD_DIR) ? USB_VOD_DIR : HOME_VOD_DIR;
}

/** Every folder recordings may sit in, newest home first, so readers find files from before and after the move. */
export function vodDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const main = vodDirectory(env);
  return [...new Set([main, HOME_VOD_DIR])].filter((d) => fs.existsSync(d));
}
