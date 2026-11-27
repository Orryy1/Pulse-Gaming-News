// Where the owner's TinoTV stream recordings (VODs) live on the Mac (15 Nov 2026). The Mac's own disk sat under its
// floor, so every nightly download was skipped; the owner plugged in a 1 TB SanDisk mounted at /Volumes/Storage.
// VOD_DIR names the folder outright. Otherwise the USB volume is used when it is mounted and writable, else
// ~/Videos/TinoTV VODs as before. It is a USB flash drive: fine for whole VOD files, not for random-access work.

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export const USB_VOD_DIR = path.join("/Volumes", "Storage", "TinoTV VODs");
export const HOME_VOD_DIR = path.join(os.homedir(), "Videos", "TinoTV VODs");

/**
 * True when the folder can be created and written (a missing mount or a macOS permission refusal is false).
 * The test runs in a short-lived child process with a time limit: on 20 Nov 2026 the launchd factory's own
 * synchronous open() on /Volumes/Storage waited on macOS's removable-volume permission and the whole factory
 * hung at start-up for 9 minutes. A child that hangs is killed and the answer is "not writable".
 */
export function writableDir(dir: string, timeoutMs = 5000): boolean {
  if (process.platform === "win32") {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.write-test-${process.pid}`);
      fs.writeFileSync(probe, "ok");
      fs.rmSync(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }
  const r = spawnSync(
    "/bin/sh",
    [
      "-c",
      'mkdir -p "$1" && p="$1/.write-test-$$" && echo ok > "$p" && rm -f "$p"',
      "sh",
      dir,
    ],
    { timeout: timeoutMs, stdio: "ignore" },
  );
  return r.status === 0 && !r.error;
}

export function vodDirectory(
  env: NodeJS.ProcessEnv = process.env,
  canWrite: (dir: string) => boolean = writableDir,
): string {
  // Opt-in only: probing /Volumes from the launchd factory made macOS hold the process on a removable-volume
  // permission prompt, and the factory never finished starting (15 Nov 2026, 17:31). VOD_DIR=usb uses the drive
  // once node has that permission; any other value names the folder.
  const set = env.VOD_DIR?.trim();
  if (!set) return HOME_VOD_DIR;
  if (set === "usb") {
    // The drive test spawns a process, so its answer is kept for ten minutes (the default checker only).
    if (
      canWrite === writableDir &&
      usbChecked &&
      Date.now() - usbChecked.at < 10 * 60_000
    )
      return usbChecked.ok ? USB_VOD_DIR : HOME_VOD_DIR;
    const ok = canWrite(USB_VOD_DIR);
    if (canWrite === writableDir) usbChecked = { at: Date.now(), ok };
    return ok ? USB_VOD_DIR : HOME_VOD_DIR;
  }
  return set;
}

let usbChecked: { at: number; ok: boolean } | undefined;

/** Every folder recordings may sit in, newest home first, so readers find files from before and after the move. */
export function vodDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const main = vodDirectory(env);
  return [...new Set([main, HOME_VOD_DIR])].filter((d) => fs.existsSync(d));
}
