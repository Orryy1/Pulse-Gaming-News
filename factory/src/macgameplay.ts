// The owner's gameplay recordings on the Mac (MAC_GAMEPLAY, Master orchestrator's request, 1 Nov 2026). Two PC
// tasks did this: the hourly highlight finder (a full scan of each new recording) and the 04:30 TinoTV VOD
// download. The factory now starts both on the Mac, on the same timetable, and brings the results home: the new
// clips into the inbox its gameplay lane reads, each finished VOD into the owner's archive folder, after which
// the Mac's copy goes. If the Mac does not answer, the finder runs here, as it did. The two PC tasks must be
// disabled before this setting goes on, or the PC would score the pulled VODs a second time.
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
  const vodDir = path.join(os.homedir(), "Videos", "TinoTV VODs");
  try {
    const done = await macGameplayPass(macSettings(cfg), {
      vods: due.vods,
      gameplayRoot: cfg.gameplayRoot,
      vodDir,
    });
    log("info", "gameplay pass on the Mac", { ...done, vods: due.vods });
  } catch (err) {
    const why = errorMessage(err);
    log("warn", "gameplay pass fell back to the PC", { why });
    if (shouldTell("gameplay", Date.now()))
      await postDiscord(
        cfg.discordWebhookUrl,
        { content: `Mac mini: the gameplay highlight finder ran on the PC instead (${why.slice(0, 200)}).` },
      ).catch(() => undefined);
    await run(process.execPath, [FINDER], {
      env: { ...process.env, GAMEPLAY_ROOT: cfg.gameplayRoot },
      timeout: 3 * 3_600_000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch((e) =>
      log("warn", "gameplay finder failed", { error: errorMessage(e) }),
    );
  } finally {
    running = false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        hour: due.hourKey,
        day: due.vods ? day : last.day,
      }),
    );
  }
}
