// The stream-asks list and the moment miner by hand (the server runs the same steps when STREAM_ASKS / VOD_MINER are on):
//   npx tsx src/tools/streamasks.ts refresh [--data <dir>] [--codex]     read the sources, rewrite the list and its page
//   npx tsx src/tools/streamasks.ts daily [--data <dir>]                 the daily message (to a file unless live)
//   npx tsx src/tools/streamasks.ts mine <vod-id> [--data <dir>] [--asks <asks.json>]
//                                                                        search one indexed stream for the open asks
// --codex sends the tidying call to Codex (site streamasks.extract) with no Claude fallback; without it the rules
// alone write the list. Nothing is posted anywhere from here unless the daily message has a live webhook and no
// STREAM_ASKS_DRY_RUN: run it with STREAM_ASKS_DRY_RUN=true to see the message.

import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { createCodexLlm } from "../editorial/codex.ts";
import type { Llm } from "../editorial/llm.ts";
import { loadVodIndex } from "../vodindex/schema.ts";
import { refreshList } from "../streamasks/asks.ts";
import { mineVod } from "../streamasks/miner.ts";
import {
  readAsks,
  refreshAsks,
  sendDaily,
  writeAsks,
} from "../streamasks/job.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = loadConfig();
const cfg = { ...base, dataDir: path.resolve(flag("data") ?? base.dataDir) };
const cmd = args[0];
const now = new Date();

if (cmd === "refresh") {
  const noClaude: Llm = {
    structured: async () => {
      throw new Error("no Claude from the hand tool");
    },
  };
  const llm = args.includes("--codex")
    ? createCodexLlm(noClaude, {
        enabled: true,
        sites: ["streamasks"],
        python: cfg.codexPython,
        runnerDir: cfg.codexRunnerDir,
        timeoutMs: cfg.codexTimeoutMinutes * 60_000,
      })
    : undefined;
  const store = await refreshAsks(cfg, { llm, now });
  const open = store.asks.filter((a) => a.status === "open");
  console.log(`${open.length} open asks; ${store.notes.join("; ")}`);
  for (const [i, a] of open.slice(0, 10).entries())
    console.log(
      `${i + 1}. ${a.rumour ? "[rumour] " : ""}${a.question}  (${(a.why ?? []).join(", ")}; ${a.score})`,
    );
  console.log(path.join(cfg.dataDir, "streamasks", "asks.md"));
} else if (cmd === "daily") {
  const sent = await sendDaily(cfg, now.toISOString().slice(0, 10));
  console.log(sent.text);
  console.log(`-> ${sent.to}`);
} else if (cmd === "mine") {
  const vod = await loadVodIndex(cfg.dataDir, args[1] ?? "");
  if (!vod) throw new Error(`no stream index for ${args[1]} in ${cfg.dataDir}`);
  const file = flag("asks");
  const store = file
    ? {
        updatedAt: now.toISOString(),
        notes: [],
        asks: JSON.parse(await fs.readFile(file, "utf8")).asks,
      }
    : await readAsks(cfg.dataDir);
  const r = await mineVod(vod, store.asks, {
    dataDir: cfg.dataDir,
    minCue: cfg.streamAsks.minCue,
    minConfidence: cfg.streamAsks.minConfidence,
    toLane: args.includes("--to-lane"),
    gameplayRoot: flag("inbox") ?? path.join(cfg.dataDir, "gameplay"),
    spoilerGuard: cfg.spoilerGuard,
  });
  await writeAsks(
    cfg.dataDir,
    {
      ...store,
      asks: refreshList(r.asks, now, { staleDays: cfg.streamAsks.staleDays }),
    },
    now,
  );
  for (const m of r.moments)
    console.log(
      `${m.ask.question} @ ${Math.round(m.candidate.peak)} s: ${m.decision.result} (${Math.round(m.decision.confidence * 100)}%, cue ${m.candidate.cue}, ${m.candidate.signals.join("+")}) ${m.decision.why}${m.held ? ` [held: ${m.held}]` : ""} -> ${m.dir}`,
    );
} else {
  console.error(
    "usage: streamasks.ts refresh|daily|mine <vod-id> [--data <dir>]",
  );
  process.exit(2);
}
