// The owner's gameplay recordings on the Mac (MAC_GAMEPLAY, Master orchestrator's request, 1 Nov 2026). Two PC
// tasks did this: the hourly highlight finder (a full scan of each new recording) and the 04:30 TinoTV VOD
// download. The factory now starts both on the Mac, on the same timetable, and brings the results home: the new
// clips into the inbox its gameplay lane reads, each finished VOD into the owner's archive folder, after which
// the Mac's copy goes. Short clips that only exist on this PC (Xbox captures, the "Drop clips here" folder)
// are still found here, cheaply, each pass, never the VOD folder: a pulled VOD has been scored already. A Mac
// that does not answer leaves the VODs for the next hour's try (Twitch keeps them for a week at least), with a
// notice. The two PC tasks must be disabled before this setting goes on.
//
// With the factory itself on the Mac (4 Nov 2026, "as much as physically possible on the Mac") there is nothing to
// bring home and nobody to ssh to: the same two scripts run right here, each behind ~/orch/macrun.sh so a render always
// comes first, the clips land straight in the inbox the lane reads, and the VODs stay here until VOD_KEEP_DAYS or the
// free-space floor clears them. The owner's archive of old VODs on the PC is not touched.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { postDiscord } from "./approval/discord.ts";
import type { Config } from "./config.ts";
import { errorMessage, log } from "./lib/util.ts";
import { gameplayDue } from "./macjobs.ts";
import { macGameplayPass, macSettings, shouldTell } from "./macworker.ts";

const run = promisify(execFile);
const FINDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "mac",
  "gameplay",
  "find-highlights.mjs",
);

let running = false;

/** The VODs to clear (pure): scored ones past their days, then oldest first while the disk is under the floor. */
export function vodsToClear(
  vods: Array<{ name: string; mtimeMs: number; bytes: number }>,
  scored: Set<string>,
  o: { now: number; keepDays: number; freeBytes: number; floorGb: number },
): string[] {
  const out: string[] = [];
  let free = o.freeBytes;
  for (const v of [...vods].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (!scored.has(v.name)) continue;
    if (
      o.now - v.mtimeMs > o.keepDays * 86_400_000 ||
      free < o.floorGb * 1e9
    ) {
      out.push(v.name);
      free += v.bytes;
    }
  }
  return out;
}

/** A job behind the Mac's turn-taker, or at background priority where it is not installed. */
function behindRenders(name: string, cmd: string, args: string[]): [string, string[]] {
  const macrun = path.join(os.homedir(), "orch", "macrun.sh");
  return fs.existsSync(macrun)
    ? ["/bin/bash", [macrun, name, cmd, ...args]]
    : ["taskpolicy", ["-b", cmd, ...args]];
}

/** The pass with the factory on this Mac: the VOD download when due, the finder, then the disk rule for VODs. */
export async function localGameplayPass(
  cfg: Pick<Config, "gameplayRoot" | "macMinFreeGb">,
  vods: boolean,
): Promise<void> {
  const home = os.homedir();
  const vodDir = path.join(home, "Videos", "TinoTV VODs");
  fs.mkdirSync(path.join(cfg.gameplayRoot, "inbox"), { recursive: true });
  fs.mkdirSync(vodDir, { recursive: true });
  // No state file makes the finder's first run mark every recording as old footage, new ones included.
  const state = path.join(cfg.gameplayRoot, "state.json");
  if (!fs.existsSync(state)) fs.writeFileSync(state, '{"done":{}}');
  // OneDrive on the Mac, once the owner has signed it in: its Xbox folder is watched as on the PC.
  const oneDrive = path.join(
    home,
    "Library",
    "CloudStorage",
    "OneDrive-Personal",
    "Videos",
    "Xbox Game DVR",
  );
  const env = {
    ...process.env,
    PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}`,
    GAMEPLAY_ROOT: cfg.gameplayRoot,
    GAMEPLAY_WATCH: [vodDir, ...(fs.existsSync(oneDrive) ? [oneDrive] : [])].join(";"),
    VOD_FLOOR_GB: String(cfg.macMinFreeGb + 15),
  };
  const opts = { env, timeout: 6 * 3_600_000, maxBuffer: 16 * 1024 * 1024 };
  const scripts = path.dirname(FINDER);
  if (vods) {
    const [c, a] = behindRenders("pulse-vods", "bash", [
      path.join(scripts, "download-vods.sh"),
    ]);
    await run(c, a, opts);
  }
  const [c, a] = behindRenders("pulse-finder", process.execPath, [FINDER]);
  await run(c, a, opts);
  const done = (() => {
    try {
      return Object.keys(
        (JSON.parse(fs.readFileSync(state, "utf8")) as { done?: object }).done ?? {},
      ).map((k) => path.basename(k.split("|")[0]!));
    } catch {
      return [] as string[];
    }
  })();
  const files = fs.readdirSync(vodDir).flatMap((name) => {
    const st = fs.statSync(path.join(vodDir, name));
    return st.isFile()
      ? [{ name, mtimeMs: st.mtimeMs, bytes: st.size }]
      : [];
  });
  const free = fs.statfsSync(vodDir);
  for (const name of vodsToClear(files, new Set(done), {
    now: Date.now(),
    keepDays: Number(process.env.VOD_KEEP_DAYS || 7),
    freeBytes: free.bavail * free.bsize,
    floorGb: cfg.macMinFreeGb + 15,
  }))
    fs.rmSync(path.join(vodDir, name), { force: true });
}

/** One check of the timetable: at most one pass at a time, its state kept in data/admin/mac_gameplay.json. */
export async function macGameplayTick(cfg: Config): Promise<void> {
  if (running) return;
  const file = path.join(cfg.dataDir, "admin", "mac_gameplay.json");
  const last = (() => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as {
        hour?: string;
        day?: string;
      };
    } catch {
      return {};
    }
  })();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const due = gameplayDue(last, {
    day,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  });
  if (!due.finder && !due.vods) return;
  running = true;
  let vodsDone = false;
  const vodDir = path.join(os.homedir(), "Videos", "TinoTV VODs");
  if (process.platform === "darwin") {
    try {
      await localGameplayPass(cfg, due.vods);
      log("info", "gameplay pass done", { vods: due.vods });
      if (due.vods) vodsDone = true;
    } catch (err) {
      const why = errorMessage(err);
      log("warn", "gameplay pass failed; trying again next hour", { why });
      if (shouldTell("gameplay", Date.now()))
        await postDiscord(cfg.discordWebhookUrl, {
          content: `Mac mini: the gameplay pass did not run (${why.slice(0, 200)}). Recordings wait on Twitch; I try again next hour.`,
        }).catch(() => undefined);
    } finally {
      running = false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ hour: due.hourKey, day: vodsDone ? day : last.day }),
      );
    }
    return;
  }
  try {
    const done = await macGameplayPass(macSettings(cfg), {
      vods: due.vods,
      gameplayRoot: cfg.gameplayRoot,
      vodDir,
    });
    log("info", "gameplay pass on the Mac", { ...done, vods: due.vods });
    if (due.vods) vodsDone = true;
  } catch (err) {
    const why = errorMessage(err);
    log("warn", "gameplay pass on the Mac failed; trying again next hour", {
      why,
    });
    if (shouldTell("gameplay", Date.now()))
      await postDiscord(cfg.discordWebhookUrl, {
        content: `Mac mini: the gameplay pass did not run (${why.slice(0, 200)}). Recordings wait on Twitch; I try again next hour.`,
      }).catch(() => undefined);
  }
  try {
    await run(process.execPath, [FINDER], {
      env: {
        ...process.env,
        GAMEPLAY_ROOT: cfg.gameplayRoot,
        GAMEPLAY_WATCH: path.join(os.homedir(), "Videos", "Captures", "Xbox DVR"),
      },
      timeout: 3_600_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    log("warn", "gameplay finder failed", { error: errorMessage(e) });
  } finally {
    running = false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        hour: due.hourKey,
        day: vodsDone ? day : last.day,
      }),
    );
  }
}
