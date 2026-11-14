// The GTA HUD and minimap reader by hand (src/hudreader). Settings come from the HUD_READER_* variables; the runner
// defaults to the orchestrator on the PC and macrun on the Mac (HUD_READER_RUNNER=direct for a quick local try).
//
//   npx tsx src/tools/hudreader.ts read <recording> [--game gta5] [--out <dir>] [--start s] [--duration s]
//       a recording's telemetry (raw.json, track.json, facts.json, signals.json) into --out (default
//       <data>/hud/vods/<vod>/), growing the game's stitched map in <data>/hud/<game>/atlas
//   npx tsx src/tools/hudreader.ts track <raw.json> [--out <dir>]     track, facts and signals from a raw read
//   npx tsx src/tools/hudreader.ts calibrate <recording> --game gta6 [--times a,b,c] [--sequence start,seconds]
//       [--stars seconds:count] [--out <profile.json>]
//       learns a new HUD from a few frames: writes the profile (default src/hudreader/profiles/<game>.json) and a
//       _preview.png with every box drawn, to check by eye before switching anything on
//   npx tsx src/tools/hudreader.ts check <raw.json> <labels.json>     the hand check's accuracy, per field
//   npx tsx src/tools/hudreader.ts selftest                            the Python half's synthetic checks
// A recording's name may hold "%" ("GTA V 100% [v...]"): it is passed through as one argument, never through cmd.

import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { parseVodName } from "../vodindex/schema.ts";
import { hudSettings } from "../hudreader/settings.ts";
import {
  finishVod,
  profileFor,
  profilePath,
  readVod,
} from "../hudreader/job.ts";
import { runHud } from "../hudreader/run.ts";
import { readJson, type RawTelemetry } from "../hudreader/telemetry.ts";
import { scoreHandCheck, type HandLabel } from "../hudreader/evaluate.ts";

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"),
);
const [cmd, a1, a2] = positional;
const s = hudSettings(process.env);
const dataDir = process.env.DATA_DIR || path.resolve("data");

async function main(): Promise<number> {
  switch (cmd) {
    case "read": {
      if (!a1) throw new Error("read <recording>");
      const n = parseVodName(a1);
      const game = arg("game") ?? profileFor(n.title);
      if (!game)
        throw new Error(`which game is "${n.title}"? give --game gta5|gta6`);
      const start = Number(arg("start") ?? 0);
      const duration = Number(arg("duration") ?? 0);
      const out = await readVod(
        s,
        arg("data") ?? dataDir,
        { file: a1, vodId: n.vodId, game, seconds: duration || 3600 },
        { start, duration },
      );
      if (!out) return 1;
      console.log(
        JSON.stringify(
          {
            vod: n.vodId,
            quality: out.track.quality,
            events: out.track.events.length,
          },
          null,
          1,
        ),
      );
      return 0;
    }
    case "track": {
      if (!a1) throw new Error("track <raw.json>");
      const raw = await readJson<RawTelemetry>(a1);
      if (!raw) throw new Error(`cannot read ${a1}`);
      const dir = arg("out") ?? path.dirname(a1);
      const { track } = await finishVod(dir, raw);
      console.log(
        JSON.stringify(
          { quality: track.quality, events: track.events.length, dir },
          null,
          1,
        ),
      );
      return 0;
    }
    case "calibrate": {
      if (!a1) throw new Error("calibrate <recording> --game <name>");
      const game = arg("game");
      if (!game)
        throw new Error("--game is needed (the profile's name, e.g. gta6)");
      const out = arg("out") ?? profilePath(game);
      const args = [
        "calibrate",
        "--video",
        a1,
        "--base",
        profilePath("gta5"),
        "--out",
        out,
        "--game",
        game,
        "--libs",
        s.libs,
        "--ffmpeg",
        FFMPEG,
        "--ffprobe",
        FFPROBE,
      ];
      for (const k of ["times", "sequence", "stars"]) {
        const v = arg(k);
        if (v) args.push(`--${k}`, v);
      }
      const r = await runHud(s, args, { job: `calibrate ${game}`, est: 6 });
      process.stdout.write(r.stdout);
      if (r.code) process.stderr.write(r.stderr);
      return r.code;
    }
    case "check": {
      if (!a1 || !a2) throw new Error("check <raw.json> <labels.json>");
      const raw = await readJson<RawTelemetry>(a1);
      const labels = await readJson<HandLabel[]>(a2);
      if (!raw || !labels) throw new Error("cannot read the files");
      const r = scoreHandCheck(raw, labels);
      const out = arg("out");
      if (out) await fs.writeFile(out, JSON.stringify(r, null, 1));
      console.log(JSON.stringify(r, null, 1));
      return 0;
    }
    case "selftest": {
      const r = await runHud(s, ["selftest"], { job: "selftest", est: 2 });
      process.stdout.write(r.stdout);
      return r.code;
    }
    default:
      console.error(
        "usage: hudreader.ts read|track|calibrate|check|selftest (see the top of the file)",
      );
      return 1;
  }
}

process.exit(await main());
