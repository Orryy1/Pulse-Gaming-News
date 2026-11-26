// The back catalogue mined for gameplay Short candidates (src/liveclips/vodmine.ts): each GTA recording of the
// owner's channel and his cousin's gets a HUD read (src/hudreader, on the CPU: sift and RapidOCR on ONNX Runtime's
// CPU provider) and a per-second loudness and action measure, both kept, then the live-clip detector picks its
// moments, and the best are cut as inbox folders (clip.mp4, frames/, meta.json) for the gameplay lane's review and
// the owner's tap. Run it inside one orchestrator turn of class cpu at priority 20 (it starts the reader directly):
//
//   node --import tsx src/tools/hudmine.ts --vods "<dir>[;<dir>]" --data <dir> --out <staging> [--taken taken.json]
//       [--only v1,v2] [--top 3] [--dry] [--held-until 2026-12-18T00:00:00Z]
//
// --vods: recording folders; the cousin's folder is told by its name (src/vodindex/sources.ts KNOWN_CHANNELS) and his
// clips carry his credit. --data: where the HUD reads and measures are kept (<data>/hud/vods/<vod>/, <data>/mine/).
// --taken: {vod: [[start, end], ...]} of windows already in the inbox (the nightly finder's, live clips'), built from the
// Mac's inbox. --dry: the plan only (plan.json), nothing cut. Folders are written to --out/<id>/ whole, ready to copy
// into the Mac's inbox.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { readVod } from "../hudreader/job.ts";
import { hudSettings } from "../hudreader/settings.ts";
import { hudSignals, type HudSignal } from "../hudreader/signal.ts";
import {
  buildTrack,
  loadProfile,
  readJson,
  vodHudDir,
  writeJson,
  type RawTelemetry,
} from "../hudreader/telemetry.ts";
import { measure } from "../liveclips/recorder.ts";
import type { SecondSample } from "../liveclips/detect.ts";
import {
  backMeta,
  backMoments,
  escapeSignals,
  pickMoments,
  type BackMoment,
} from "../liveclips/vodmine.ts";
import { KNOWN_CHANNELS } from "../vodindex/sources.ts";
import { vodServeContext } from "../vodindex/serve.ts";
import { parseVodName } from "../vodindex/schema.ts";
import { profileFor } from "../hudreader/job.ts";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const arg = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const vodDirs = (arg("vods") ?? "").split(";").filter(Boolean);
const dataDir = arg("data");
const outDir = arg("out");
if (!vodDirs.length || !dataDir || !outDir) {
  console.error(
    "usage: hudmine.ts --vods <dir;dir> --data <dir> --out <dir> [--taken f] [--only ids] [--top n] [--dry]",
  );
  process.exit(1);
}
const only = new Set((arg("only") ?? "").split(",").filter(Boolean));
const top = Number(arg("top") ?? 3);
const dry = argv.includes("--dry");
// The GTA VI spoiler window as the stream library works it out (GAME_FETCH_TITLES, else its default), so the two
// cannot drift; --held-until overrides it.
const gtaWindow = vodServeContext(process.env, { model: "" })
  .windows()
  .find((w) => /grand theft auto vi\b/i.test(w.game));
const heldUntil = arg("held-until") ?? gtaWindow?.until;
// Without the inbox's taken windows the nightly finder's clips would be filed again under new ids.
// Story moments are filed held until the window closes: with no window known, nothing is filed.
if (!heldUntil && !dry) {
  console.error("no GTA VI spoiler window found: give --held-until <ISO>");
  process.exit(1);
}
if (!arg("taken") && !dry) {
  console.error("--taken <file> is needed (the inbox's windows); --dry only plans");
  process.exit(1);
}
const taken: Record<string, Array<[number, number]>> = arg("taken")
  ? JSON.parse(await fs.readFile(arg("taken")!, "utf8"))
  : {};
// The reader runs here directly: this tool is the orchestrator turn.
const hs = {
  ...hudSettings(process.env),
  runner: "direct" as const,
  matcher: "sift" as const,
  // Two threads: the PC is shared, and a whole recording is not in a hurry.
  threads: hudSettings(process.env).threads || 2,
};

const creditFor = (dir: string) =>
  Object.values(KNOWN_CHANNELS).find((c) => path.basename(dir) === c.folder)
    ?.credit ?? "";
const probe = async (file: string) =>
  Number(
    (
      await run(FFPROBE, [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ])
    ).stdout.trim(),
  );

async function hudFor(
  file: string,
  vodId: string,
  seconds: number,
): Promise<HudSignal[]> {
  const dir = vodHudDir(dataDir!, vodId);
  let raw = await readJson<RawTelemetry>(path.join(dir, "raw.json"));
  if (!raw) {
    const t0 = Date.now();
    const out = await readVod(
      hs,
      dataDir!,
      { file, vodId, game: "gta6", seconds },
      { keyframes: true },
    );
    raw = out?.raw;
    console.log(
      `  hud read ${Math.round(seconds / 60)} min in ${Math.round((Date.now() - t0) / 1000)} s`,
    );
  }
  if (!raw) return [];
  const track = buildTrack(raw, await loadProfile(raw.game));
  return [...hudSignals(track.events), ...escapeSignals(track.events)];
}

async function samplesFor(
  file: string,
  vodId: string,
  startMs: number,
  seconds: number,
) {
  const f = path.join(dataDir!, "mine", `${vodId}.samples.json`);
  const kept = await readJson<SecondSample[]>(f);
  if (kept) return kept;
  const s = await measure(FFMPEG, file, startMs, seconds);
  await writeJson(f, s);
  return s;
}

async function cut(
  file: string,
  m: BackMoment,
  dir: string,
): Promise<string[]> {
  await fs.mkdir(path.join(dir, "frames"), { recursive: true });
  const clip = path.join(dir, "clip.mp4");
  // Seeking before the input keeps a cut hours into a recording quick; the copy is re-encoded from the exact second.
  await run(
    FFMPEG,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(m.start),
      "-i",
      file,
      "-t",
      "40",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "17",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      clip,
    ],
    { timeout: 10 * 60_000 },
  );
  await run(
    FFMPEG,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      clip,
      "-vf",
      "fps=8/40,scale=480:-2",
      "-frames:v",
      "8",
      path.join(dir, "frames", "%02d.jpg"),
    ],
    { timeout: 5 * 60_000 },
  );
  return (await fs.readdir(path.join(dir, "frames")))
    .filter((n) => n.endsWith(".jpg"))
    .sort()
    .map((n) => `frames/${n}`);
}

const plan: Array<Record<string, unknown>> = [];
for (const dir of vodDirs) {
  const credit = creditFor(dir);
  const files = (await fs.readdir(dir))
    .filter((n) => /\.mp4$/i.test(n) && !/\.temp\./i.test(n))
    .sort();
  for (const name of files) {
    const file = path.join(dir, name);
    const n = parseVodName(file);
    if (only.size && !only.has(n.vodId)) continue;
    // Only GTA VI recordings: both channels' titles name it ("GTA 6 | ...", "GTA VI Chapter 3!").
    if (profileFor(n.title) !== "gta6") continue;
    const seconds = await probe(file);
    if (!(seconds >= 20 * 60)) continue; // short pieces (a crash restart) hold no stretch worth a read
    const startMs = Date.parse(`${n.recordedOn || "2026-01-01"}T00:00:00Z`);
    console.log(
      `${n.vodId} ${Math.round(seconds / 60)} min${credit ? ` (${credit})` : ""}`,
    );
    const hud = await hudFor(file, n.vodId, seconds);
    const samples = await samplesFor(file, n.vodId, startMs, seconds);
    const moments = backMoments(samples, hud, { startMs, minScore: 1 });
    const picked = pickMoments(moments, taken[n.vodId] ?? [], {
      top,
      hudOnly: !credit,
      gapSeconds: 120,
      minScore: 1,
    });
    console.log(
      `  ${hud.length} hud signals, ${moments.length} moments, ${picked.length} picked`,
    );
    for (const m of picked) {
      const entry: Record<string, unknown> = {
        vod: n.vodId,
        title: n.title,
        credit,
        ...m,
      };
      if (!dry) {
        const now = new Date();
        const meta = backMeta(
          m,
          { file, title: n.title, vodId: n.vodId, seconds, credit },
          [],
          now,
          heldUntil,
        );
        const target = path.join(outDir!, meta.id);
        if (
          await fs.stat(target).then(
            () => true,
            () => false,
          )
        ) {
          entry.id = meta.id;
          entry.already = true;
        } else {
          const tmp = path.join(outDir!, `.tmp_${meta.id}`);
          meta.frames = await cut(file, m, tmp);
          await fs.writeFile(
            path.join(tmp, "meta.json"),
            JSON.stringify(meta, null, 2),
          );
          await fs.rename(tmp, target);
          entry.id = meta.id;
          entry.status = meta.status;
        }
      }
      plan.push(entry);
    }
  }
}
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(
  path.join(outDir, "plan.json"),
  JSON.stringify(plan, null, 2),
);
console.log(
  `${plan.length} moment(s); plan in ${path.join(outDir, "plan.json")}`,
);
