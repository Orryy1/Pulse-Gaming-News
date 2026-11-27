// Builds one recording's stream index by hand (the same steps the VOD_MINER job runs in the background):
//   npx tsx src/tools/vodindex.ts "<recording.mp4>" [--game "Grand Theft Auto V"] [--data <dir>] [--steps 50]
// Run GPU work through the orchestrator on the PC (it refuses to start there outside an `orch run` turn, 26 Nov 2026):
//   C:\Claude\orchestrator\orch.cmd run --class gpu --project pulse --kind pulse:vodindex-tool --priority 20 --est 18 -- npx tsx src/tools/vodindex.ts ... --steps 1
// Whisper and SigLIP run on the CPU here as in vodpc.ts (VOD_WHISPER_DEVICE, VOD_SEMANTIC_DEVICE); keep --steps small
// so a turn stays under 20 minutes. The background job is vodpc.ts index, which takes its own turns per slice.
// Prints one line a step and the index's file at the end.

import path from "node:path";
import { loadConfig } from "../config.ts";
import { vodIndexDir } from "../vodindex/schema.ts";
import { vodIndexStep } from "../vodindex/build.ts";
import { detectGame } from "../vodindex/vods.ts";
import { parseVodName } from "../vodindex/schema.ts";
import { loadSceneIndex } from "../sceneindex/schema.ts";
import { Embedder } from "../semantic/embed.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
if (!file) {
  console.error(
    'usage: vodindex.ts "<recording>" [--game <name>] [--data <dir>] [--steps N]',
  );
  process.exit(2);
}
// On the PC every step can reach the GPU (the vision model): only inside an orchestrator turn (ORCH_HELD).
if (process.platform === "win32" && !(process.env.ORCH_HELD ?? "").split(",").includes("gpu")) {
  console.error("vodindex.ts: run it inside an orchestrator turn on the PC (see the usage above), or use vodpc.ts index");
  process.exit(3);
}
const cfg = loadConfig();
const dataDir = path.resolve(flag("data") ?? cfg.dataDir);
const sa = cfg.streamAsks;
const game =
  flag("game") ??
  detectGame(parseVodName(file).title, [...sa.games, ...cfg.ownerGames]) ??
  "";
const steps = Number(flag("steps") ?? 200);
// VOD_TAGS: once described, every stretch is tagged (place, activity, vehicle, brands, time of day, story) and every
// shot gets its meaning vector, on this machine's own model (src/semantic).
const sem = cfg.semantic;
const tags = sem.vodTags
  ? {
      batch: sem.vodTagsBatch,
      places: (await loadSceneIndex(dataDir, game).catch(() => undefined))?.places ?? [],
      embedder: new Embedder({
        python: sem.python,
        model: sem.model,
        device: process.platform === "win32" ? process.env.VOD_SEMANTIC_DEVICE || "cpu" : sem.device,
        cacheDir: path.join(dataDir, "semantic"),
        idleSeconds: 30,
        priority: 20,
      }),
      model: sem.model,
      embedBatch: sem.shotsPerTurn,
    }
  : undefined;
for (let i = 0; i < steps; i++) {
  const r = await vodIndexStep(path.resolve(file), game, {
    dataDir,
    whisperPython: cfg.whisperPython,
    ...(process.platform === "win32"
      ? {
          whisperDevice: process.env.VOD_WHISPER_DEVICE || "cpu",
          // As vodpc: one vision request at a time beside Ollama, and the fast CPU Whisper (the 26 Nov GPU resets).
          describeWorkers: 1,
          whisperModel: process.env.VOD_WHISPER_MODEL || "small.en",
          whisperBeam: Number(process.env.VOD_WHISPER_BEAM) || 1,
        }
      : {}),
    ocrFps: sa.ocrFps,
    chunkSeconds: sa.chunkMinutes * 60,
    describeBatch: sa.describeBatch,
    ...(tags ? { tags } : {}),
  });
  const v = r.index;
  console.log(
    `${r.did}: ${v.shots.length} shots, ${v.shots.filter((s) => s.desc && s.desc !== "-").length} described, ${v.lines.length} lines, covered ${Math.round(v.coverage.reduce((n, c) => n + c.to - c.from, 0))}/${Math.round(v.duration)} s`,
  );
  if (r.did === "done" || r.did === "waiting") break;
}
tags?.embedder.close();
console.log(
  path.join(vodIndexDir(dataDir, parseVodName(file).vodId), "index.json"),
);
