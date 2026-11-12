// Builds one recording's stream index by hand (the same steps the VOD_MINER job runs in the background):
//   npx tsx src/tools/vodindex.ts "<recording.mp4>" [--game "Grand Theft Auto V"] [--data <dir>] [--steps 50]
// Run GPU work through the orchestrator on the PC:
//   C:\Claude\orchestrator\orch.cmd run --class gpu --project pulse --priority 20 --est 30 -- npx tsx src/tools/vodindex.ts ...
// Prints one line a step and the index's file at the end.

import path from "node:path";
import { loadConfig } from "../config.ts";
import { vodIndexDir } from "../vodindex/schema.ts";
import { vodIndexStep } from "../vodindex/build.ts";
import { detectGame } from "../vodindex/vods.ts";
import { parseVodName } from "../vodindex/schema.ts";

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
const cfg = loadConfig();
const dataDir = path.resolve(flag("data") ?? cfg.dataDir);
const sa = cfg.streamAsks;
const game =
  flag("game") ??
  detectGame(parseVodName(file).title, [...sa.games, ...cfg.ownerGames]) ??
  "";
const steps = Number(flag("steps") ?? 200);
for (let i = 0; i < steps; i++) {
  const r = await vodIndexStep(path.resolve(file), game, {
    dataDir,
    whisperPython: cfg.whisperPython,
    ocrFps: sa.ocrFps,
    chunkSeconds: sa.chunkMinutes * 60,
    describeBatch: sa.describeBatch,
  });
  const v = r.index;
  console.log(
    `${r.did}: ${v.shots.length} shots, ${v.shots.filter((s) => s.desc && s.desc !== "-").length} described, ${v.lines.length} lines, covered ${Math.round(v.coverage.reduce((n, c) => n + c.to - c.from, 0))}/${Math.round(v.duration)} s`,
  );
  if (r.did === "done" || r.did === "waiting") break;
}
console.log(
  path.join(vodIndexDir(dataDir, parseVodName(file).vodId), "index.json"),
);
