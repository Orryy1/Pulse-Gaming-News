// The owner's gameplay recordings on the Mac (MAC_GAMEPLAY, Master orchestrator's request, 1 Nov 2026). Two PC
// tasks did this: the hourly highlight finder (a full scan of each new recording) and the 04:30 TinoTV VOD
// download. The factory now starts both on the Mac, on the same timetable, and brings the results home: the new
// clips into the inbox its gameplay lane reads, each finished VOD into the owner's archive folder, after which
// the Mac's copy goes. Short clips that only exist on this PC (Xbox captures, the "Drop clips here" folder)
// are still found here, cheaply, each pass, never the VOD folder: a pulled VOD has been scored already. A Mac
// that does not answer leaves the VODs for the next hour's try (Twitch keeps them for a week at least), with a
// notice. The two PC tasks must be disabled before this setting goes on.
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
